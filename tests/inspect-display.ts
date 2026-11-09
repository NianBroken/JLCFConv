/** 保存滚动容器的真实层级、计算尺寸和边界，供布局回归诊断使用。 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  userAgent:
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
});
await page.goto(
  pathToFileURL(resolve('test-results/display-fixes/中山勤奋光电图片传输模块.html')).href,
);
await page.locator('.jlcf-pane').first().waitFor();
const data = await page.locator('[class*="bom-table-MatchingTools_"]').evaluate((element) => {
  const result = [];
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current),
      rect = current.getBoundingClientRect();
    result.push({
      class: current.className,
      display: style.display,
      flex: style.flex,
      direction: style.flexDirection,
      minW: style.minWidth,
      minH: style.minHeight,
      height: style.height,
      width: style.width,
      overflow: style.overflow,
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      children: [...current.children].map((child) => child.className),
    });
  }
  return result;
});
await writeFile(
  'test-results/display-fixes/dom-layout.json',
  JSON.stringify(data, null, 2),
  'utf8',
);
console.log(JSON.stringify(data.slice(0, 6)));
await browser.close();
