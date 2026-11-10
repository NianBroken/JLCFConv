/** 每份样本及优化开关组合均在断网浏览器内执行真实表格点击和模型拾取。 */
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { PROBE, stablePoint, type State } from './selection-probe.js';

const DIRECTORY = resolve(
  process.env.JLCF_MATRIX_DIRECTORY ?? 'test-results/selection-final/generated',
);
const OUTPUT = resolve('test-results/selection-final/matrix');
const files: string[] = [];
for (const item of await readdir(DIRECTORY, { withFileTypes: true })) {
  if (item.isFile() && /\.html$/.test(item.name)) files.push(join(DIRECTORY, item.name));
  if (item.isDirectory())
    for (const name of await readdir(join(DIRECTORY, item.name)))
      if (/\.html$/.test(name)) files.push(join(DIRECTORY, item.name, name));
}
await mkdir(OUTPUT, { recursive: true });
const browser = await launchBrowser();
const records: unknown[] = [];
const errors: string[] = [],
  external: string[] = [];
try {
  for (const [index, file] of files.entries()) {
    const context = await browser.newContext({
      offline: true,
      viewport: { width: 1440, height: 1000 },
    });
    try {
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(`${basename(file)}: ${error.message}`));
      page.on('console', (message) => {
        if (['error', 'warning'].includes(message.type()))
          errors.push(`${basename(file)}: ${message.text()}`);
      });
      page.on('request', (request) => {
        if (/^https?:/.test(request.url())) external.push(request.url());
      });
      await page.goto(pathToFileURL(file).href);
      await page.evaluate(PROBE);
      await page.waitForFunction('Boolean(window.__selectionTest.state())', null, {
        timeout: 120000,
      });
      const candidate = await page.evaluate(() => {
        const test = (window as any).__selectionTest,
          ctx = test.context();
        const entries = (window as any).__JLCFConv.geometry.inspect(Object.keys(ctx.uniqueIdIndex));
        for (const entry of entries.filter((item: any) => item.top && item.kind === 'model')) {
          const element = document.querySelector<HTMLElement>(
            `[data-jlcf-component="${entry.id}"]`,
          );
          if (element)
            return {
              id: entry.id,
              name: ctx.uniqueIdIndex[entry.id].Designator,
              ids: JSON.parse(element.closest<HTMLElement>('tr')!.dataset.jlcfIds!),
            };
        }
        return null;
      });
      assert(candidate, '样本包含能够实际拾取的元器件模型');
      await page.locator(`[data-jlcf-component="${candidate.id}"]`).first().click();
      await page.waitForFunction(
        (id) => (window as any).__selectionTest.state().active === id,
        candidate.id,
      );
      const table = await page.evaluate<State>('window.__selectionTest.state()');
      assert.deepEqual([...table.ids].sort(), [...candidate.ids].sort());
      const point = await stablePoint(page, candidate.id);
      await page.mouse.click(point.x, point.y);
      await page.waitForFunction(
        (revision) => (window as any).__selectionTest.state().revision > revision,
        table.revision,
      );
      const model = await page.evaluate<State>('window.__selectionTest.state()');
      const picked = await page.evaluate<string>('window.__selectionTest.picks.at(-1)');
      assert.equal(picked, candidate.id);
      assert.equal(model.active, candidate.id);
      assert.equal(model.net, candidate.id);
      assert.deepEqual([...model.ids].sort(), [...candidate.ids].sort());
      await page.waitForFunction('window.__selectionTest.row()?.visible');
      await page.screenshot({ path: join(OUTPUT, `${index + 1}.jpg`) });
      records.push({
        file,
        candidate,
        point,
        picked,
        table,
        model,
        row: await page.evaluate('window.__selectionTest.row()'),
      });
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(JSON.stringify({ files: files.length, passed: records.length, errors, external }));
} finally {
  await writeFile(
    join(OUTPUT, 'report.json'),
    JSON.stringify({ records, errors, external }, null, 2),
    'utf8',
  );
  await browser.close();
}
