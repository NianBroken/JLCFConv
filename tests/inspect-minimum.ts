/** 用浏览器命中结果定位极窄侧栏中的触摸入口。 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  hasTouch: true,
  viewport: { width: 1440, height: 900 },
  offline: true,
});
const page = await context.newPage();
await page.goto(
  pathToFileURL(resolve('test-results/display-fixes/中山勤奋光电图片传输模块.html')).href,
);
await page.locator('.jlcf-pane-resize').first().waitFor();
const box = (await page.locator('.jlcf-pane-resize').first().boundingBox())!;
const cdp = await context.newCDPSession(page);
const x = box.x + 12,
  y = box.y + 40;
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 0, y }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.mouse.move(80, 440);
await page.mouse.wheel(0, 900);
await page.waitForTimeout(250);
const button = page.getByRole('button', { name: '位号不聚合', exact: true });
console.log(
  await button.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
      hit: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.outerHTML,
      parents: [e.parentElement?.outerHTML.slice(0, 700)],
    };
  }),
);
await button.tap();
await page.waitForTimeout(200);
console.log(
  await page.locator('[class*="router-switch_"]').evaluate((e) => ({
    html: e.outerHTML.slice(0, 1600),
    parent: e.parentElement?.outerHTML.slice(0, 500),
  })),
);
console.log(
  await page
    .locator('[data-jlcf-table=individual]')
    .first()
    .evaluate((e) => {
      const a = [];
      for (let n: Element | null = e; n && a.length < 7; n = n.parentElement) {
        const r = n.getBoundingClientRect(),
          s = getComputedStyle(n);
        a.push({
          class: n.className,
          style: n.getAttribute('style'),
          h: r.height,
          w: r.width,
          display: s.display,
          minH: s.minHeight,
          flex: s.flex,
          overflow: s.overflow,
        });
      }
      return a;
    }),
);
await page.screenshot({ path: 'test-results/display-fixes/minimum-diagnostic.png' });
await browser.close();
