/** Firefox 与 WebKit 使用实际转换文件检查表格、细滚动条及响应式布局。 */
import { firefox, webkit } from 'playwright';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const directory = resolve('test-results/compatibility-display');
const file = resolve('test-results/display-fixes/中山勤奋光电图片传输模块.html');
const reports: unknown[] = [];
await mkdir(directory, { recursive: true });
for (const type of [firefox, webkit].filter(
  (type) => !process.env.JLCF_COMPAT || type.name() === process.env.JLCF_COMPAT,
)) {
  const browser = await type.launch();
  const errors: string[] = [];
  try {
    const context = await browser.newContext({
      offline: true,
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(pathToFileURL(file).href);
    await page.locator('.jlcf-pane').first().waitFor();
    await page.screenshot({ path: join(directory, `${type.name()}-loading.png`) });
    console.log(
      JSON.stringify({
        browser: type.name(),
        errors,
        body: (await page.locator('body').innerText()).slice(0, 200),
        logs: await page.locator('canvas').getAttribute('class'),
      }),
    );
    await page.waitForFunction(
      () => document.querySelector('canvas')?.className.includes('canvas-mode-3D'),
      null,
      { timeout: 90000 },
    );
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const value = await page.evaluate(() => ({
        width: innerWidth,
        handles: [
          ...document.querySelectorAll(
            '.os-scrollbar-visible:not(.os-scrollbar-unusable) .os-scrollbar-handle',
          ),
        ]
          .filter((e) => e.getBoundingClientRect().width > 0)
          .map((e) =>
            e.closest('.os-scrollbar-vertical')
              ? e.getBoundingClientRect().width
              : e.getBoundingClientRect().height,
          ),
        header: [...document.querySelectorAll('[data-jlcf-table] thead th')].map((e) => ({
          x: e.getBoundingClientRect().x,
          w: e.getBoundingClientRect().width,
        })),
        row: [...document.querySelectorAll('[data-jlcf-table] tbody tr:first-child td')].map(
          (e) => ({ x: e.getBoundingClientRect().x, w: e.getBoundingClientRect().width }),
        ),
        radio: [...document.querySelectorAll('input[type=radio]')].map((e) => ({
          input: e.getBoundingClientRect().y,
          label: e.closest('label')!.getBoundingClientRect().y,
        })),
      }));
      assert(value.handles.every((size) => Math.abs(size - 4) <= 0.1));
      assert.equal(value.header.length, value.row.length);
      value.header.forEach((cell, index) =>
        assert(
          Math.abs(cell.x - value.row[index].x) <= 1 && Math.abs(cell.w - value.row[index].w) <= 1,
        ),
      );
      reports.push({ browser: type.name(), ...value, errors: [...errors] });
      await page.screenshot({ path: join(directory, `${type.name()}-${width}.png`) });
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await writeFile(
      join(directory, `${type.name()}.json`),
      JSON.stringify(reports, null, 2),
      'utf8',
    );
  }
  console.log(`${type.name()} 显示检查通过`);
}
