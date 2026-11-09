/** 左右侧栏与手机底栏使用原生触摸事件，覆盖拖动、取消和连续操作。 */
import { chromium, type Page, type BrowserContext } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const info = JSON.parse(await readFile('.runtime/service.json', 'utf8'));
const jobId =
  process.env.JLCF_TEST_JOB ??
  JSON.parse(await readFile('test-results/e2e-report.json', 'utf8')).jobId;
if (!jobId) throw new Error('请先执行六份样本验收，或设置 JLCF_TEST_JOB。');
const url = `https://${info.addresses[0]}:${info.previewPort}/preview/${jobId}/${process.env.JLCF_TEST_INDEX ?? 0}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results: unknown[] = [];
async function drag(
  context: BrowserContext,
  page: Page,
  side: string,
  dx: number,
  dy: number,
  cancel = false,
) {
  const pane = page.locator(`[data-jlcf-pane=${side}]`),
    handle = (await pane.getByRole('separator').boundingBox())!;
  const x = handle.x + handle.width / 2,
    y = handle.y + handle.height / 2;
  const before = await pane.boundingBox();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: x + dx, y: y + dy }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: cancel ? 'touchCancel' : 'touchEnd',
    touchPoints: [],
  });
  await page.waitForTimeout(200);
  const after = await pane.boundingBox();
  assert(
    before &&
      after &&
      (side === 'bottom' ? after.height > before.height + 20 : after.width > before.width + 20),
  );
  results.push({ side, cancel, before, after });
}
try {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(url);
  await page.waitForTimeout(6000);
  await page.getByRole('button', { name: '展开右侧栏', exact: true }).tap();
  await page.waitForFunction(
    () => document.querySelector('[data-jlcf-pane=right]')?.getAttribute('data-open') === 'true',
  );
  await drag(context, page, 'right', -65, 0);
  await drag(context, page, 'right', -45, 0, true);
  await page.getByRole('button', { name: '收起右侧栏', exact: true }).tap();
  await page.getByText('详情', { exact: true }).nth(1).tap();
  await page.getByText('参数详情', { exact: true }).first().waitFor();
  const body = await page.locator('body').innerText();
  assert(body.includes('元件名') && body.includes('库类别'));
  assert(!body.includes('立创商城元件名') && !body.includes('嘉立创库类别'));
  assert(body.includes('未提供'));
  assert(!/(?:^|\n)\s*(?:null|undefined|\[object Object\])\s*(?:\n|$)/.test(body));
  await page.screenshot({ path: resolve('test-results/parameter-details.png') });
  assert.equal(errors.length, 0, errors.join('\n'));
  const phone = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    viewport: { width: 390, height: 844 },
  });
  const mobile = await phone.newPage();
  mobile.on('pageerror', (e) => errors.push(e.message));
  await mobile.goto(url);
  await mobile.waitForTimeout(6000);
  assert.equal(await mobile.locator('.jlcf-logo-mobile').innerText(), '中山勤奋光电PCB模型预览');
  const mobileLogo = await mobile.locator('.jlcf-logo-mobile').boundingBox();
  assert(mobileLogo && mobileLogo.x >= 0 && mobileLogo.x + mobileLogo.width <= 391);
  await mobile.locator('[data-jlcf-pane=bottom]').waitFor();
  await drag(phone, mobile, 'bottom', 0, -65);
  await mobile.getByRole('button', { name: '收起底部栏', exact: true }).tap();
  await mobile.waitForFunction(
    () => document.querySelector('[data-jlcf-pane=bottom]')?.getAttribute('data-open') === 'false',
  );
  await mobile.getByRole('button', { name: '展开底部栏', exact: true }).tap();
  await mobile.waitForFunction(
    () => document.querySelector('[data-jlcf-pane=bottom]')?.getAttribute('data-open') === 'true',
  );
  await mobile.screenshot({ path: resolve('test-results/mobile-bottom-panel.png') });
  await mobile.setViewportSize({ width: 844, height: 390 });
  await mobile.waitForTimeout(350);
  assert((await mobile.locator('canvas').boundingBox())!.height >= 150);
  await mobile.screenshot({ path: resolve('test-results/mobile-landscape.png') });
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify(results));
} finally {
  await writeFile('test-results/panels-report.json', JSON.stringify(results, null, 2), 'utf8');
  await browser.close();
}
