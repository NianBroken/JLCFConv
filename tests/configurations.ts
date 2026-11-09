/** 配置组合检查通过工具界面提交，逐份取得自动下载的 HTML。 */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const service = JSON.parse(await readFile('.runtime/service.json', 'utf8'));
const output = resolve('test-results');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const results: unknown[] = [];
try {
  await page.goto(service.urls[0]);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (width === 390)
      await page.screenshot({ path: join(output, 'tool-mobile.png'), fullPage: true });
  }
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles('C:/Users/Administrator/Desktop/HTML测试样本/图片传输模块.html');
  await page.getByRole('button', { name: '自定义文字', exact: true }).click();
  await page.getByLabel('网站标题文字').fill('模型 "示例" <2026>');
  for (const [index, optimizePage, optimizeInteraction, image] of [
    [0, false, false, false],
    [1, true, false, true],
    [2, false, true, false],
  ] as const) {
    await page.getByRole('switch', { name: '优化网页', exact: true }).setChecked(optimizePage);
    await page
      .getByRole('switch', { name: '优化交互', exact: true })
      .setChecked(optimizeInteraction);
    if (image) {
      await page.getByRole('button', { name: '图片 LOGO', exact: true }).click();
      await page
        .locator('input[type=file]')
        .nth(1)
        .setInputFiles({
          name: '品牌.svg',
          mimeType: 'image/svg+xml',
          buffer: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="260" height="46"><rect width="260" height="46" rx="8" fill="#2563eb"/><text x="130" y="30" text-anchor="middle" font-size="22" fill="white">勤奋光电</text></svg>',
          ),
        });
      await page.locator('.logo-upload img').waitFor();
    } else {
      await page.getByRole('button', { name: '文字 LOGO', exact: true }).click();
      await page.getByLabel('LOGO 文字').fill('勤奋 <展示> & PCB');
    }
    const promised = page.waitForEvent('download', { timeout: 300000 });
    await page.getByRole('button', { name: '转换并下载', exact: true }).click();
    const download = await promised;
    assert.equal(download.suggestedFilename(), '中山勤奋光电图片传输模块.html');
    const file = join(output, `configuration-${index}.html`);
    await download.saveAs(file);
    const offline = await browser.newContext({
      offline: true,
      viewport: { width: 1440, height: 1000 },
    });
    const preview = await offline.newPage();
    const errors: string[] = [];
    preview.on('pageerror', (e) => errors.push(e.message));
    preview.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await preview.goto(pathToFileURL(file).href);
    await preview.locator('canvas').waitFor();
    await preview.waitForTimeout(5000);
    assert.equal(await preview.title(), '模型 "示例" <2026>');
    assert.equal(
      (await preview.locator('[class*="matchingTools-header_"]').count()) > 0,
      !optimizePage,
    );
    assert.equal((await preview.locator('.jlcf-pane').count()) > 0, optimizeInteraction);
    if (image)
      assert(
        (await preview.locator('.jlcf-logo img').getAttribute('src'))?.startsWith(
          'data:image/png;base64,',
        ),
      );
    else assert.equal(await preview.locator('.jlcf-logo').innerText(), '勤奋 <展示> & PCB');
    const originalUrl = preview.url();
    await preview.locator('.jlcf-logo').click();
    await preview.locator('.jlcf-logo').dblclick();
    assert.equal(preview.url(), originalUrl);
    await preview.screenshot({ path: join(output, `configuration-${index}.png`) });
    assert.deepEqual(errors, []);
    results.push({ optimizePage, optimizeInteraction, image, errors });
    await offline.close();
    console.log('配置通过', index);
  }
} finally {
  await writeFile(
    join(output, 'configuration-report.json'),
    JSON.stringify(results, null, 2),
    'utf8',
  );
  await browser.close();
}
