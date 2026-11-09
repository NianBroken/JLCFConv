/** 浏览器真实流程检查，下载文件保存到测试结果目录。 */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const info = JSON.parse(await readFile('.runtime/service.json', 'utf8'));
const origin = info.urls[0];
const output = resolve('test-results');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await page.goto(origin);
await page.screenshot({ path: join(output, 'tool-desktop.png'), fullPage: true });
await page
  .locator('input[type=file]')
  .first()
  .setInputFiles('C:/Users/Administrator/Desktop/HTML测试样本/图片传输模块.html');
await page.getByRole('button', { name: '转换并下载', exact: true }).waitFor();
await page.waitForFunction(
  () => !(document.querySelector('.convert-button') as HTMLButtonElement)?.disabled,
  { timeout: 20000 },
);
const downloadPromise = page.waitForEvent('download', { timeout: 300000 });
await page.getByRole('button', { name: '转换并下载', exact: true }).click();
try {
  const download = await downloadPromise;
  await download.saveAs(join(output, download.suggestedFilename()));
  await page.screenshot({ path: join(output, 'tool-converted.png'), fullPage: true });
  await writeFile(join(output, 'smoke-ui.txt'), await page.locator('body').innerText(), 'utf8');
  console.log('DOWNLOADED', download.suggestedFilename());
  console.log(await page.locator('a[href*="/preview/"]').first().getAttribute('href'));
} catch (e) {
  console.log(await page.locator('body').innerText());
  throw e;
} finally {
  await browser.close();
}
