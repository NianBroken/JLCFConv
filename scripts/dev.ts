/** 开发命令在同一 HTTPS 服务加载前端与服务端构建结果。 */
import { execFileSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
execFileSync(npmExecutable, ['run', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
const child = spawn(process.execPath, [resolve('dist-server/main.js')], { stdio: 'inherit' });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
