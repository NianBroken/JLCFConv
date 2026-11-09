import https from 'node:https';
import net from 'node:net';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import express from 'express';
import { createApp, prepareStorage, saveRuntimeInfo } from './app.js';
import { jobs, cleanup, cancelJob } from './store.js';
import { TLS_DIRECTORY } from './config.js';

const TOOL_PORT = Number(process.env.PORT) || 3443;
const PREVIEW_PORT = Number(process.env.PREVIEW_PORT) || 3444;
if (!process.release.lts)
  throw new Error('HTTPS 服务需要 Node.js LTS，请使用设备级 LTS 运行时启动。');
/** 空闲端口探测只处理真实占用，其他监听错误直接报告。 */
async function freePort(start: number) {
  for (let port = start; port < start + 100; port++) {
    const free = await new Promise<boolean>((resolvePort, reject) => {
      const tester = net.createServer();
      tester.once('error', (error: NodeJS.ErrnoException) =>
        error.code === 'EADDRINUSE' ? resolvePort(false) : reject(error),
      );
      tester.listen(port, '0.0.0.0', () => tester.close(() => resolvePort(true)));
    });
    if (free) return port;
  }
  throw new Error('指定范围内没有空闲端口。');
}
await prepareStorage();
const tls = {
  key: await readFile(join(TLS_DIRECTORY, 'server-key.pem')),
  cert: await readFile(join(TLS_DIRECTORY, 'server-cert.pem')),
};
const port = await freePort(TOOL_PORT),
  previewPort = await freePort(Math.max(PREVIEW_PORT, port + 1));
const addresses = Object.entries(networkInterfaces())
  .filter(([name]) => !/vEthernet|WSL|Clash|VPN/i.test(name))
  .flatMap(([, entries]) => entries ?? [])
  .filter(
    (e) =>
      !e.internal &&
      e.family === 'IPv4' &&
      /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(e.address),
  )
  .map((e) => e.address);
if (!addresses.length) throw new Error('未找到局域网 IPv4 地址。');
const preview = express();
preview.disable('x-powered-by');
preview.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  next();
});
preview.get('/preview/:id/:index', (req, res) => {
  const job = jobs.get(req.params.id),
    index = Number(req.params.index);
  if (!job || !Number.isInteger(index) || job.files[index]?.state !== 'success') {
    res.status(404).send('预览不存在或已过期。');
    return;
  }
  res.type('html').sendFile(join(job.directory, `${index}.html`), { dotfiles: 'allow' });
});
preview.get('/favicon.ico', (_req, res) => res.status(204).end());
// 基线目录仅在显式测试环境变量存在时开放，生产服务不访问样本目录。
if (process.env.JLCF_BASELINE_DIR)
  preview.use('/baseline', express.static(resolve(process.env.JLCF_BASELINE_DIR)));
const server = https.createServer(tls, createApp(`https://${addresses[0]}:${previewPort}`));
const previewServer = https.createServer(tls, preview);
await Promise.all([
  new Promise<void>((r) => server.listen(port, '0.0.0.0', r)),
  new Promise<void>((r) => previewServer.listen(previewPort, '0.0.0.0', r)),
]);
const info = {
  pid: process.pid,
  port,
  previewPort,
  addresses,
  urls: addresses.map((ip) => `https://${ip}:${port}`),
  startedAt: new Date().toISOString(),
  runtime: process.version,
  lts: process.release.lts,
};
await saveRuntimeInfo(info);
console.log(JSON.stringify(info));
const timer = setInterval(() => {
  void cleanup().catch(console.error);
}, 60_000);
timer.unref();
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  await Promise.all([...jobs.values()].filter((j) => j.workers.size).map(cancelJob));
  server.close();
  previewServer.close();
}
process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
