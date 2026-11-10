/** 界面间距、空余列宽和单行省略使用实际下载结果进行量测与截图。 */
import { firefox, webkit } from 'playwright';
import { launchBrowser } from './browser.js';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const baseline = process.env.JLCF_LAYOUT_BASELINE === '1';
const engine = process.env.JLCF_LAYOUT_BROWSER ?? 'chrome';
const directory = resolve(
  baseline
    ? 'test-results/layout-baseline'
    : `test-results/layout-${engine === 'chrome' ? 'final' : engine}`,
);
const file = resolve(
  process.env.JLCF_LAYOUT_FILE ?? 'test-results/batch/中山勤奋光电图片传输模块.html',
);
const browser =
  engine === 'firefox'
    ? await firefox.launch()
    : engine === 'webkit'
      ? await webkit.launch()
      : await launchBrowser(engine);
const records: unknown[] = [];
const failures: string[] = [];
const errors: string[] = [];
await mkdir(directory, { recursive: true });
try {
  for (const [phone, width] of [
    [false, 2560],
    [true, 1640],
    [true, 390],
    [true, 320],
  ] as const) {
    const context = await browser.newContext({
      offline: true,
      hasTouch: phone,
      ...(engine === 'firefox' ? {} : { isMobile: phone }),
      viewport: { width, height: 900 },
      ...(phone
        ? {
            userAgent:
              'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
          }
        : {}),
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(pathToFileURL(file).href);
    await page.locator('[data-jlcf-table]').first().waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll<HTMLTableColElement>('[data-jlcf-table] col')].every(
        (col) => !!col.style.width,
      ),
    );
    const tables = await page.locator('[data-jlcf-table]').evaluateAll((elements) =>
      elements.map((element) => {
        const parent = element.parentElement!;
        const style = getComputedStyle(parent);
        return {
          width: element.getBoundingClientRect().width,
          available:
            parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
          parent: { class: parent.className, width: parent.clientWidth, padding: style.padding },
          columns: [...element.querySelectorAll('col')].map((col, index) => ({
            base: Number(col.getAttribute('width')),
            width: (element as HTMLTableElement).rows[0].cells[index].getBoundingClientRect().width,
          })),
          longText: [...element.querySelectorAll<HTMLElement>('td p')]
            .filter((p) => p.innerText.length > 15)
            .slice(0, 10)
            .map((p) => ({
              text: p.innerText,
              width: p.clientWidth,
              scrollWidth: p.scrollWidth,
              height: p.clientHeight,
              whiteSpace: getComputedStyle(p).whiteSpace,
              overflow: getComputedStyle(p).overflow,
              textOverflow: getComputedStyle(p).textOverflow,
            })),
        };
      }),
    );
    for (const table of tables) {
      if (
        Math.abs(
          table.width -
            Math.max(
              table.available,
              table.columns.reduce((sum, col) => sum + col.base, 0),
            ),
        ) > 1
      )
        failures.push(`${phone ? '手机' : '桌面'}${width}表格未铺满可用宽度`);
      const extras = table.columns.map((col) => col.width - col.base);
      if (Math.max(...extras) - Math.min(...extras) > 1)
        failures.push(`${width}额外宽度未平均分配`);
      if (
        table.longText.some(
          (p) =>
            p.whiteSpace !== 'nowrap' || p.textOverflow !== 'ellipsis' || p.overflow !== 'hidden',
        )
      )
        failures.push(`${width}长内容未使用单行省略`);
    }
    const styleChanges = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let changes = 0;
          const observer = new MutationObserver((records) => {
            changes += records.length;
          });
          document
            .querySelectorAll('[data-jlcf-table] col')
            .forEach((col) =>
              observer.observe(col, { attributes: true, attributeFilter: ['style'] }),
            );
          setTimeout(() => {
            observer.disconnect();
            resolve(changes);
          }, 250);
        }),
    );
    if (styleChanges > 0) failures.push(`${width}稳定布局仍反复写入列宽`);
    await page.screenshot({
      path: join(directory, `${phone ? 'phone' : 'desktop'}-${width}-table.png`),
    });
    let menu: unknown = null;
    if (phone && width <= 390) {
      await page.locator('#showDialog img').tap();
      menu = await page.locator('[class*="dialog_panel_"]').evaluate((element) => ({
        html: element.outerHTML.replace(/data:image[^"\s]+/g, '图片数据').slice(0, 9000),
        children: [
          ...element.querySelectorAll<HTMLElement>(
            '.jlcf-display-option,[class*="nav-bar_"],[class*="radioArea_column_"]',
          ),
        ].map((child) => ({
          class: child.className,
          text: child.innerText,
          top: child.getBoundingClientRect().top,
          bottom: child.getBoundingClientRect().bottom,
          height: child.getBoundingClientRect().height,
          gap: getComputedStyle(child).gap,
          margin: getComputedStyle(child).margin,
        })),
      }));
      const spacing = await page.locator('[class*="dialog_panel_"]').evaluate((element) => {
        const nav = element.querySelector('[class*="nav-bar_"]')!;
        const header = document.querySelector('[class*="weld_phone_header_"]')!;
        const options = [...element.querySelectorAll('.jlcf-display-option')].map((item) =>
          item.getBoundingClientRect(),
        );
        return {
          navGap: nav.getBoundingClientRect().top - element.getBoundingClientRect().top,
          headerGap: nav.getBoundingClientRect().top - header.getBoundingClientRect().bottom,
          optionGaps: options.slice(1).map((item, index) => item.top - options[index].bottom),
        };
      });
      if (spacing.navGap < 10 || spacing.headerGap < 8)
        failures.push(`${width}视图切换上方间距不足`);
      if (spacing.optionGaps.some((gap) => gap < 2 || gap > 5))
        failures.push(`${width}显示选项间距不协调`);
      await page.screenshot({ path: join(directory, `phone-${width}-menu.png`) });
    }
    records.push({ phone, width, tables, menu });
    await context.close();
  }
} finally {
  await writeFile(
    join(directory, 'report.json'),
    JSON.stringify({ baseline, records, failures, errors }, null, 2),
    'utf8',
  );
  await browser.close();
}
console.log(JSON.stringify({ baseline, failures, errors }));
if (!baseline) {
  assert.deepEqual(failures, []);
  assert.deepEqual(errors, []);
}
