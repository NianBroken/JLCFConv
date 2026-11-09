/** 原样样本的 HTTPS 基线保留真实错误，用于区分协议变化与转换行为。 */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
const info = JSON.parse(await readFile('.runtime/service.json', 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs: Array<{ type: string; text: string }> = [];
const failures: string[] = [];
page.on('console', (message) => {
  if (['error', 'warning'].includes(message.type()) || message.text().includes('[RustWasm]'))
    logs.push({ type: message.type(), text: message.text() });
});
page.on('pageerror', (error) => logs.push({ type: 'exception', text: error.message }));
page.on('requestfailed', (request) => failures.push(request.url()));
try {
  await page.goto(
    `https://${info.addresses[0]}:${info.previewPort}/baseline/${encodeURIComponent('图片传输模块.html')}`,
  );
  await page.waitForTimeout(15000);
  await page.screenshot({ path: 'test-results/https-original-baseline.png' });
  await writeFile(
    'test-results/https-original-baseline.json',
    JSON.stringify(
      {
        logs,
        failures,
        secure: await page.evaluate(() => ({
          secure: isSecureContext,
          isolated: crossOriginIsolated,
        })),
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(
    'HTTPS 原样基线已记录',
    logs.filter((log) => log.type === 'error' || log.type === 'exception').length,
    '项错误',
  );
} finally {
  await browser.close();
}
