/** 边界验收覆盖服务端超限和浏览器上传中断后的恢复。 */
import https from 'node:https';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { readFile, writeFile, stat, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const info = JSON.parse(await readFile('.runtime/service.json', 'utf8'));
const origin = info.urls[0];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report: Record<string, unknown> = {};
try {
  const health = await fetch(origin + '/api/health');
  const cookie = health.headers.get('set-cookie')!.split(';')[0];
  const boundary = 'JLCFConvBoundary';
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="filename"\r\n\r\n超限.html\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="large.html"\r\nContent-Type: text/html\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  const size = 128 * 1024 ** 2 + 1;
  const response = await new Promise<{ status: number; body: string }>(
    async (resolveResponse, reject) => {
      const req = https.request(
        origin + '/api/uploads',
        {
          method: 'POST',
          headers: {
            Cookie: cookie,
            Origin: origin,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': prefix.length + size + suffix.length,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () =>
            resolveResponse({
              status: res.statusCode!,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        },
      );
      req.on('error', reject);
      try {
        req.write(prefix);
        const block = Buffer.alloc(1024 * 1024, 32);
        for (let sent = 0; sent < size; sent += block.length)
          if (!req.write(block.subarray(0, Math.min(block.length, size - sent))))
            await once(req, 'drain');
        req.end(suffix);
      } catch (error) {
        reject(error);
      }
    },
  );
  assert(response.status >= 400 && response.status < 500);
  assert(JSON.parse(response.body).error.includes('超过'));
  report.serverLimit = response;
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin);
  const large = resolve('test-results/超限输入.html');
  const handle = await open(large, 'w');
  await handle.truncate(size);
  await handle.close();
  await page.locator('input[type=file]').first().setInputFiles(large);
  await page.getByText('请选择非空 HTML 文件，单份不超过 128.0 MB。', { exact: true }).waitFor();
  assert(await stat(large));
  report.clientLimit = true;
  await page.getByRole('button', { name: '清空', exact: true }).click();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 40,
    downloadThroughput: 1024 * 1024,
    uploadThroughput: 64 * 1024,
  });
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles('C:/Users/Administrator/Desktop/HTML测试样本/图片传输模块.html');
  await page.getByRole('button', { name: '移除 图片传输模块.html', exact: true }).click();
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles('C:/Users/Administrator/Desktop/HTML测试样本/图片传输模块.html');
  await page.waitForFunction(
    () => !(document.querySelector('.convert-button') as HTMLButtonElement)?.disabled,
    { timeout: 30000 },
  );
  assert.equal((await fetch(origin + '/api/health')).status, 200);
  report.abortAndRecover = true;
  await page.screenshot({ path: resolve('test-results/upload-recovery.png'), fullPage: true });
  console.log(JSON.stringify(report));
} finally {
  await writeFile(
    'test-results/upload-boundaries-report.json',
    JSON.stringify(report, null, 2),
    'utf8',
  );
  await browser.close();
}
