/** 图片 LOGO 在手机头部的实际边界用于验证菜单入口与图片互不遮挡。 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({
    offline: true,
    isMobile: true,
    hasTouch: true,
    viewport: { width: 320, height: 844 },
    userAgent:
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  });
  await page.goto(pathToFileURL(resolve('test-results/configuration-1.html')).href);
  await page.locator('.jlcf-logo-mobile').waitFor();
  const data = await page
    .locator('.jlcf-logo-mobile,#showDialog,.jlcf-logo img')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        class: element.className,
        id: element.id,
        x: element.getBoundingClientRect().x,
        width: element.getBoundingClientRect().width,
        min: getComputedStyle(element).minWidth,
        max: getComputedStyle(element).maxWidth,
      })),
    );
  await page.screenshot({ path: 'test-results/display-fixes/image-logo-diagnostic.png' });
  await writeFile(
    'test-results/display-fixes/image-logo-diagnostic.json',
    JSON.stringify(data, null, 2),
    'utf8',
  );
  console.log(JSON.stringify(data));
} finally {
  await browser.close();
}
