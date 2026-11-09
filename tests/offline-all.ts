/** 六份实际下载文件在无网络上下文中逐一加载并操作模型。 */
import { chromium } from 'playwright';
import { readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const directory = resolve('test-results/batch');
const names = (await readdir(directory)).filter((name) => name.endsWith('.html'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results: unknown[] = [];
try {
  for (const [index, name] of names.entries()) {
    const context = await browser.newContext({
      offline: true,
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    const errors: string[] = [],
      requests: string[] = [],
      modes: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
      if (message.text().includes('[RustWasm]')) modes.push(message.text());
    });
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) requests.push(request.url());
    });
    await page.goto(pathToFileURL(join(directory, name)).href);
    await page.locator('canvas').waitFor();
    await page.waitForTimeout(6500);
    await page.getByRole('button', { name: '收起左侧栏', exact: true }).click();
    const canvas = (await page.locator('canvas').boundingBox())!;
    await page.mouse.move(canvas.x + canvas.width * 0.55, canvas.y + canvas.height * 0.55);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width * 0.65, canvas.y + canvas.height * 0.62, {
      steps: 12,
    });
    await page.mouse.up();
    await page.mouse.wheel(0, -120);
    await page.getByRole('button', { name: '展开左侧栏', exact: true }).click();
    await page.waitForTimeout(300);
    assert.deepEqual(errors, [], name);
    assert.deepEqual(requests, [], name);
    await page.screenshot({ path: resolve(`test-results/offline-${index}.png`) });
    results.push({ name, errors, requests, modes });
    await context.close();
    console.log('断网直接打开通过', name);
  }
} finally {
  await writeFile('test-results/offline-all-report.json', JSON.stringify(results, null, 2), 'utf8');
  await browser.close();
}
