/** 单份默认配置通过工具页面转换，实际取得下载文件并在断网状态打开。 */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { digest, inspectHtml } from '../src/core/html.js';
import { OUTPUT_PREFIX } from '../src/shared/config.js';
const info = JSON.parse(await readFile('.runtime/service.json', 'utf8'));
const sample = resolve(
  process.env.JLCF_TEST_SAMPLE ?? 'C:/Users/Administrator/Desktop/HTML测试样本/图片传输模块.html',
);
const destination = resolve('test-results/single');
const original = await readFile(sample);
const browser = await chromium.launch({ channel: 'chrome' });
const results: Record<string, unknown> = { origin: info.urls[0] };
await mkdir(destination, { recursive: true });
try {
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto(info.urls[0]);
  await page.locator('input[type=file]').first().setInputFiles(sample);
  const downloaded = page.waitForEvent('download', { timeout: 300000 });
  await page.getByRole('button', { name: '转换并下载', exact: true }).click();
  const download = await downloaded;
  assert.equal(download.suggestedFilename(), OUTPUT_PREFIX + basename(sample));
  const file = join(destination, download.suggestedFilename());
  await download.saveAs(file);
  await page.screenshot({ path: join(destination, 'success.png'), fullPage: true });
  const output = await readFile(file, 'utf8');
  const payload = (source: string) =>
    inspectHtml(source)
      .scripts.filter((script) => /^\s*window\.files\s*=/.test(script.code))
      .map((script) => digest(script.code));
  assert.deepEqual(payload(output), payload(original.toString('utf8')));
  assert.equal(digest(await readFile(sample)), digest(original));
  const offline = await browser.newContext({
    offline: true,
    isMobile: true,
    hasTouch: true,
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  });
  const preview = await offline.newPage();
  const errors: string[] = [],
    requests: string[] = [];
  preview.on('pageerror', (error) => errors.push(error.message));
  preview.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  preview.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  await preview.goto(pathToFileURL(file).href);
  await preview.waitForFunction(
    () => document.querySelector('canvas')?.className.includes('canvas-mode-3D'),
    null,
    { timeout: 90000 },
  );
  await preview.locator('#showDialog img').tap();
  await preview.screenshot({ path: join(destination, 'phone-menu.png') });
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  results.filename = basename(file);
  results.bytes = Buffer.byteLength(output);
  results.originalUnchanged = true;
  results.modelProtected = true;
  results.errors = errors;
  results.externalRequests = requests;
  results.finished = new Date().toISOString();
  console.log(JSON.stringify(results));
} finally {
  await writeFile(join(destination, 'report.json'), JSON.stringify(results, null, 2), 'utf8');
  await browser.close();
}
