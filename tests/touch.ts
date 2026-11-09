/** 触摸设备检查使用浏览器原生触摸输入，不派发合成 DOM 事件。 */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const service = JSON.parse(await readFile('.runtime/service.json', 'utf8'));
const jobId =
  process.env.JLCF_TEST_JOB ??
  JSON.parse(await readFile('test-results/e2e-report.json', 'utf8')).jobId;
if (!jobId) throw new Error('请先执行六份样本验收，或设置 JLCF_TEST_JOB。');
const output = resolve('test-results');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  hasTouch: true,
  isMobile: true,
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const results: unknown[] = [];
try {
  await page.goto(
    `https://${service.addresses[0]}:${service.previewPort}/preview/${jobId}/${process.env.JLCF_TEST_INDEX ?? 5}`,
  );
  await page.locator('[data-jlcf-pane=left]').waitFor();
  await page.waitForTimeout(5000);
  const cdp = await context.newCDPSession(page);
  assert(
    await page.evaluate(
      () => matchMedia('(hover: none)').matches && matchMedia('(pointer: coarse)').matches,
    ),
  );
  for (const width of [1440, 1024, 768, 390, 320]) {
    console.log('检查触摸视口', width);
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(400);
    const bounds = await page.locator('[class*="smt-preview-header-right_"]').boundingBox();
    assert(
      bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
      `头部越界 ${width} ${JSON.stringify(bounds)}`,
    );
    assert(bounds && bounds.width >= 290, '保留的视图切换控件应保持完整样式');
    const pane = page.locator('[data-jlcf-pane=left]');
    const toggle = pane.locator(':scope > .jlcf-pane-toggle');
    const target = await toggle.boundingBox();
    assert(target && target.width >= 44 && target.height >= 44);
    await toggle.tap();
    await page.waitForFunction(
      () => document.querySelector('[data-jlcf-pane=left]')?.getAttribute('data-open') === 'false',
    );
    assert.equal(await pane.getAttribute('data-open'), 'false');
    await toggle.tap();
    await page.waitForFunction(
      () => document.querySelector('[data-jlcf-pane=left]')?.getAttribute('data-open') === 'true',
    );
    assert.equal(await pane.getAttribute('data-open'), 'true');
    const before = (await pane.boundingBox())!.width;
    const handle = (await pane.getByRole('separator').boundingBox())!;
    const x = handle.x + 12,
      y = handle.y + 40;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x - 65, y }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(100);
    const after = (await pane.boundingBox())!.width;
    assert(after < before - 20, `左侧触摸拖动未生效 ${width} ${before} ${after}`);
    await toggle.tap();
    await page.waitForFunction(
      () => document.querySelector('[data-jlcf-pane=left]')?.getAttribute('data-open') === 'false',
    );
    await page.screenshot({ path: join(output, `touch-${width}.png`) });
    await toggle.tap();
    await page.waitForFunction(
      () => document.querySelector('[data-jlcf-pane=left]')?.getAttribute('data-open') === 'true',
    );
    results.push({ width, bounds, before, after });
  }
  console.log(JSON.stringify(results));
} finally {
  await writeFile(join(output, 'touch-report.json'), JSON.stringify(results, null, 2), 'utf8');
  await browser.close();
}
