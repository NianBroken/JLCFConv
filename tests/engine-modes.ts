/** 在真实页面中切换简图，分别核验 HTTPS 和离线文件的渲染引擎。 */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const info = JSON.parse(await readFile('.runtime/service.json', 'utf8'));
const job =
  process.env.JLCF_TEST_JOB ??
  JSON.parse(await readFile('test-results/e2e-report.json', 'utf8')).jobId;
if (!job) throw new Error('请先执行样本验收或指定 JLCF_TEST_JOB。');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results: unknown[] = [];
try {
  for (const mode of ['https-auto', 'https-rust', 'offline-auto', 'offline-rust']) {
    const offline = mode.startsWith('offline');
    const rust = mode.endsWith('rust');
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, offline });
    const page = await context.newPage();
    const errors: string[] = [],
      logs: string[] = [],
      requests: string[] = [];
    page.on('pageerror', (e) => {
      if (errors.length < 20) errors.push(e.message);
    });
    page.on('console', (m) => {
      if (m.type() === 'error' && errors.length < 20) errors.push(m.text());
      else if (m.text().includes('RustWasm') || m.text().includes('render engine'))
        logs.push(m.text());
    });
    page.on('request', (r) => {
      if (
        r.url().startsWith('http') &&
        !r.url().startsWith(`https://${info.addresses[0]}:${info.previewPort}/preview/`)
      )
        requests.push(r.url());
    });
    const url = offline
      ? pathToFileURL(resolve('test-results/中山勤奋光电图片传输模块.html')).href
      : `https://${info.addresses[0]}:${info.previewPort}/preview/${job}/0`;
    await page.goto(url + (rust ? '?rustEngine' : ''));
    await page.waitForTimeout(5000);
    await page
      .locator('[class*="smt-preview-header-right_"]')
      .getByText('简图', { exact: true })
      .click();
    await page.waitForTimeout(12000);
    const record = {
      mode,
      logs,
      errors,
      requests,
      secure: await page.evaluate(() => ({
        secure: isSecureContext,
        isolated: crossOriginIsolated,
        gpu: !!navigator.gpu,
      })),
      canvas: await page.locator('canvas').count(),
    };
    results.push(record);
    console.log(JSON.stringify(record));
    await page.screenshot({ path: resolve(`test-results/engine-${mode}.png`) });
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.equal(requests.length, 0, requests.join('\n'));
    assert(logs.some((s) => s.includes('render engine')));
    if (rust) assert(logs.some((s) => s.includes('RustWasm')));
    await context.close();
  }
} finally {
  await writeFile(
    'test-results/engine-modes-report.json',
    JSON.stringify(results, null, 2),
    'utf8',
  );
  await browser.close();
}
