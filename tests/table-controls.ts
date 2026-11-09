/** 表格的搜索、排序、焊接勾选和列宽拖动均使用真实浏览器输入。 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, offline: true });
const errors: string[] = [];
const results: Record<string, unknown> = {};
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
try {
  await page.goto(
    pathToFileURL(resolve('test-results/display-fixes/中山勤奋光电图片传输模块.html')).href,
  );
  await page.waitForFunction(
    () => document.querySelector('canvas')?.className.includes('canvas-mode-3D'),
    null,
    { timeout: 90000 },
  );
  const rows = page.locator('[data-jlcf-table] tbody tr');
  const total = await rows.count();
  const search = page.getByPlaceholder('可搜索位号、参数、型号、封装、编号');
  await search.fill('H1');
  await page.waitForFunction(
    (total) => document.querySelectorAll('[data-jlcf-table] tbody tr').length < total,
    total,
  );
  const filtered = await rows.count();
  assert(filtered > 0 && filtered < total);
  await search.fill('');
  await page.waitForFunction(
    (total) => document.querySelectorAll('[data-jlcf-table] tbody tr').length === total,
    total,
  );
  results.search = { total, filtered };
  const firstCheckbox = rows.first().locator('input[type=checkbox]');
  await firstCheckbox.check();
  assert(await firstCheckbox.isChecked());
  await firstCheckbox.uncheck();
  assert(!(await firstCheckbox.isChecked()));
  results.checkbox = true;
  const beforeSort = await rows.first().innerText();
  const topHeader = page.locator('[data-jlcf-table] th').nth(1);
  await topHeader.click();
  const afterSort = await rows.first().innerText();
  assert.notEqual(beforeSort, afterSort);
  results.sort = true;
  const rect = (await topHeader.boundingBox())!;
  await page.mouse.move(rect.x + rect.width - 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width + 45, rect.y + rect.height / 2, { steps: 8 });
  await page.mouse.up();
  const resized = (await topHeader.boundingBox())!;
  assert(resized.width > rect.width + 10);
  const measure = () => {
    const cells = (selector: string) =>
      [...document.querySelectorAll(selector)].map((element) => ({
        x: element.getBoundingClientRect().x,
        width: element.getBoundingClientRect().width,
      }));
    return {
      head: cells('[data-jlcf-table] th'),
      row: cells('[data-jlcf-table] tbody tr:first-child td'),
    };
  };
  const boundaries = await page.evaluate<ReturnType<typeof measure>>(
    `(()=>{const __name=fn=>fn;return (${measure.toString()})();})()`,
  );
  assert.equal(boundaries.head.length, boundaries.row.length);
  boundaries.head.forEach((head, index) =>
    assert(
      Math.abs(head.x - boundaries.row[index].x) <= 1 &&
        Math.abs(head.width - boundaries.row[index].width) <= 1,
    ),
  );
  results.resize = { before: rect.width, after: resized.width, boundaries };
  await page.setViewportSize({ width: 2560, height: 900 });
  const paneHandle = (await page.locator('[data-jlcf-pane=left]>.jlcf-pane-resize').boundingBox())!;
  await page.mouse.move(paneHandle.x + paneHandle.width / 2, paneHandle.y + 30);
  await page.mouse.down();
  await page.mouse.move(paneHandle.x + paneHandle.width / 2 + 500, paneHandle.y + 30, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: '位号不聚合', exact: true }).click();
  await page.locator('[data-jlcf-table=individual]').first().waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll<HTMLTableColElement>('[data-jlcf-table] col')].every(
      (col) => !!col.style.width,
    ),
  );
  const individual = await page.locator('[data-jlcf-table]').evaluateAll((tables) =>
    tables.map((table) => ({
      width: table.getBoundingClientRect().width,
      available: table.parentElement!.clientWidth,
      cells: [...(table as HTMLTableElement).rows[0].cells].map((cell) => ({
        x: cell.getBoundingClientRect().x,
        width: cell.getBoundingClientRect().width,
      })),
      columns: [...table.querySelectorAll('col')].map((col) => ({
        base: Number(col.getAttribute('width')),
        width: col.getBoundingClientRect().width,
      })),
    })),
  );
  results.individual = individual;
  individual.forEach((table) => {
    assert(Math.abs(table.width - table.available) <= 1);
    const extras = table.columns.map((col) => col.width - col.base);
    assert(Math.max(...extras) - Math.min(...extras) <= 1);
  });
  individual[0].cells.forEach((cell, index) =>
    assert(
      Math.abs(cell.x - individual[1].cells[index].x) <= 1 &&
        Math.abs(cell.width - individual[1].cells[index].width) <= 1,
    ),
  );
  results.individual = individual;
  await page.screenshot({ path: 'test-results/display-fixes/table-controls.png' });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      search: results.search,
      checkbox: results.checkbox,
      sort: results.sort,
      resize: resized.width,
      individualWidths: individual.map((table) => table.width),
      errors,
    }),
  );
} finally {
  await writeFile(
    'test-results/table-controls-report.json',
    JSON.stringify({ results, errors }, null, 2),
    'utf8',
  );
  await browser.close();
}
