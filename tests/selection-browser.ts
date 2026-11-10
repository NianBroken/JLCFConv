/** 真实画布颜色拾取、表格操作、搜索定位和触控共用同一组状态断言。 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { launchBrowser } from './browser.js';
import { PROBE, VIEWPORT, stablePoint as point, type State } from './selection-probe.js';

const CHANNEL = process.env.JLCF_BROWSER ?? 'chrome';
const OUTPUT = resolve('test-results/selection-final', CHANNEL);
const FILE = resolve(
  process.env.JLCF_SELECTION_FILE ?? 'test-results/display-fixes/中山勤奋光电图片传输模块.html',
);
const records: unknown[] = [];
const errors: string[] = [];
const external: string[] = [];
await mkdir(OUTPUT, { recursive: true });
const browser = await launchBrowser(CHANNEL);

async function state(page: Page) {
  return page.evaluate<State>('window.__selectionTest.state()');
}
async function expectSelection(page: Page, previous: number, id: string, expected?: string[]) {
  await page.waitForFunction(
    ({ previous, id, expected }) => {
      const probe = (window as any).__selectionTest;
      const value = probe.state();
      return (
        value?.revision > previous &&
        value.active === id &&
        value.net === id &&
        (!expected ||
          JSON.stringify([...value.ids].sort()) === JSON.stringify([...expected].sort()))
      );
    },
    { previous, id, expected },
  );
  const result = await state(page);
  assert.equal(result.active, result.net);
  return result;
}
const rowLocator = (page: Page, id: string) =>
  page.locator(`tr[data-jlcf-ids*='${JSON.stringify(id)}']`).first();
async function clickTable(page: Page, id: string, expected?: string[]) {
  const revision = (await state(page)).revision;
  const row = rowLocator(page, id);
  const span = row.locator(`[data-jlcf-component="${id}"]`).first();
  if (await span.count()) await span.click();
  else await row.locator('td').nth(1).click();
  const selected = await expectSelection(page, revision, id, expected);
  await page.waitForFunction(
    (ids) =>
      (window as any).__JLCFConv.geometry
        .inspect(ids)
        .filter((item: any) => item.kind === 'model')
        .every((item: any) => item.highlighted),
    selected.ids,
  );
  return selected;
}
async function clickModel(page: Page, id: string, expected?: string[], touch = false) {
  const position = await point(page, id);
  const before = await state(page);
  const picks = await page.evaluate<number>('window.__selectionTest.picks.length');
  if (touch) await page.touchscreen.tap(position.x, position.y);
  else await page.mouse.click(position.x, position.y);
  const result = await expectSelection(page, before.revision, id, expected);
  const published = await page.evaluate<string[]>('window.__selectionTest.picks');
  assert.equal(published.length, picks + 1, '一次点击只发布一次拾取事件');
  assert.equal(published.at(-1), id);
  records.push({
    operation: '模型点击',
    position,
    published: published.at(-1),
    result,
    row: await page.evaluate('window.__selectionTest.row()'),
  });
  return result;
}
async function ready(page: Page) {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) errors.push(message.text());
  });
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) external.push(request.url());
  });
  await page.goto(pathToFileURL(FILE).href);
  await page.waitForFunction(
    () => {
      let element: any = document.querySelector('#smt-engine-canvas');
      while (element && !Object.keys(element).some((key) => key.startsWith('__reactFiber$')))
        element = element.parentElement;
      let fiber = element?.[Object.keys(element).find((key) => key.startsWith('__reactFiber$'))!];
      while (fiber) {
        if (fiber.memoizedProps?.value?.initFinished) return true;
        fiber = fiber.return;
      }
      return false;
    },
    null,
    { timeout: 120000 },
  );
  await page.evaluate(PROBE);
}
try {
  const context = await browser.newContext({
    offline: true,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await ready(page);
  const subscriptions = await page.evaluate(() =>
    Object.fromEntries(
      [
        '/engine/leftClick',
        '/engine/camera/changeChecked',
        '/engine/camera/changeDirect',
        '/engine/model/update/param',
      ].map((topic) => [
        topic,
        (window as any)._MSG_BUS_.subscribed[topic].length -
          (topic === '/engine/leftClick' ? 1 : 0),
      ]),
    ),
  );
  assert(Object.values(subscriptions).every((count) => count === 1));
  records.push({ subscriptions });
  await clickTable(page, 'top-default-2', ['top-default-2']);
  await page.screenshot({ path: join(OUTPUT, 'table-U12-model-highlight.jpg') });
  await clickTable(page, 'top-default-196', ['top-default-196']);
  await page.waitForFunction('window.__selectionTest.row()?.visible');
  const search = page.getByPlaceholder('可搜索位号、参数、型号、封装、编号');
  const beforeSearch = await state(page);
  await search.fill('U12');
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll<HTMLElement>('tr[data-jlcf-ids]')];
    return rows.length === 1 && rows[0].dataset.jlcfIds?.includes('top-default-2');
  });
  // 等待筛选提交与布局观察完成，用户输入不被已有选中项清除。
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  assert.equal(await search.inputValue(), 'U12');
  assert.equal((await state(page)).revision, beforeSearch.revision);
  records.push({
    operation: '已有选择允许手动搜索其他对象',
    state: await state(page),
    search: 'U12',
  });
  await page.screenshot({ path: join(OUTPUT, 'manual-filter-retained.jpg') });
  await clickModel(page, 'top-default-196', ['top-default-196']);
  await page.waitForFunction(() =>
    [...document.querySelectorAll<HTMLInputElement>('input')]
      .filter((input) => input.placeholder.startsWith('可搜索'))
      .every((input) => !input.value),
  );
  await page.waitForFunction('window.__selectionTest.row()?.visible');
  records.push({
    operation: '搜索自动清除与定位',
    row: await page.evaluate('window.__selectionTest.row()'),
  });
  await page.screenshot({ path: join(OUTPUT, 'model-R101-search-cleared.jpg') });
  await page
    .locator(VIEWPORT)
    .first()
    .evaluate((element) => {
      element.scrollTop = 0;
    });
  await clickModel(page, 'top-default-196', ['top-default-196']);
  await page.waitForFunction('window.__selectionTest.row()?.visible');
  await clickTable(page, 'top-default-8', [
    'top-default-8',
    'top-default-30',
    'top-default-31',
    'top-default-32',
  ]);
  await clickModel(page, 'top-default-8', [
    'top-default-8',
    'top-default-30',
    'top-default-31',
    'top-default-32',
  ]);
  await page.screenshot({ path: join(OUTPUT, 'aggregate-U18-group.jpg') });
  await page.getByText('位号不聚合', { exact: true }).click();
  await clickTable(page, 'top-default-30', ['top-default-30']);
  await clickModel(page, 'top-default-30', ['top-default-30']);
  await page.screenshot({ path: join(OUTPUT, 'individual-U19-single.jpg') });
  const modifierBefore = (await state(page)).revision;
  await rowLocator(page, 'top-default-8')
    .locator('td')
    .nth(1)
    .click({ modifiers: ['Control'] });
  await expectSelection(page, modifierBefore, 'top-default-8', ['top-default-8', 'top-default-30']);
  const modifierRemove = (await state(page)).revision;
  await rowLocator(page, 'top-default-8')
    .locator('td')
    .nth(1)
    .click({ modifiers: ['Control'] });
  await expectSelection(page, modifierRemove, 'top-default-30', ['top-default-30']);
  records.push({ operation: '非聚合修饰键添加与取消', state: await state(page) });
  const bottomId = await page.evaluate(() => {
    const test = (window as any).__selectionTest;
    return (window as any).__JLCFConv.geometry
      .inspect(Object.keys(test.context().uniqueIdIndex))
      .find((item: any) => !item.top && item.kind === 'model')?.id as string | undefined;
  });
  assert(bottomId, '样本包含底层元器件模型');
  await clickTable(page, bottomId, [bottomId]);
  await page
    .locator('div[class*="nav-bar-item_"]')
    .filter({ hasText: /^底层$/ })
    .first()
    .click();
  await clickModel(page, bottomId, [bottomId]);
  records.push({ operation: '底层模型双向单选', state: await state(page) });
  await page.screenshot({ path: join(OUTPUT, 'bottom-component.jpg') });
  await page
    .locator('div[class*="nav-bar-item_"]')
    .filter({ hasText: /^顶层$/ })
    .first()
    .click();
  await clickTable(page, 'top-default-30', ['top-default-30']);
  await search.fill('U12');
  await clickModel(page, 'top-default-30', ['top-default-30']);
  await page.waitForFunction('window.__selectionTest.row()?.visible');
  await page.getByText('位号聚合', { exact: true }).click();
  const header = page.locator('th').filter({ hasText: '顶层位号' }).first();
  for (let step = 0; step < 3; step++) {
    await header.click();
    const mismatch = await page.evaluate(() => {
      const ctx = (window as any).__selectionTest.context();
      return [...document.querySelectorAll<HTMLElement>('[data-jlcf-component]')]
        .filter(
          (element) =>
            element.textContent?.replace(/^[、\s]+/, '') !==
            ctx.uniqueIdIndex[element.dataset.jlcfComponent!]?.Designator,
        )
        .map((element) => ({ text: element.textContent, id: element.dataset.jlcfComponent }));
    });
    assert.deepEqual(mismatch, []);
    records.push({ operation: '顶层位号排序', step, mismatch });
  }
  await page.screenshot({ path: join(OUTPUT, 'sorted-stable-identities.jpg') });
  await clickTable(page, 'top-default-196', ['top-default-196']);
  const beforeControl = await state(page);
  await rowLocator(page, 'top-default-2').locator('input[type=checkbox]').check();
  await page.waitForFunction(
    () =>
      !!document.querySelector<HTMLInputElement>('tr[data-jlcf-ids*=\'"top-default-2"\'] input')
        ?.checked,
  );
  assert.equal((await state(page)).active, beforeControl.active);
  await rowLocator(page, 'top-default-2').locator('input[type=checkbox]').uncheck();
  const pane = page.locator('[data-jlcf-pane="left"]');
  await pane.locator('.jlcf-pane-toggle').click();
  await clickModel(page, 'top-default-196', ['top-default-196']);
  await pane.locator('.jlcf-pane-toggle').click();
  await page.waitForFunction('window.__selectionTest.row()?.visible');
  for (const width of [1024, 768, 390, 320, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    if ((await pane.getAttribute('data-open')) === 'true')
      await pane.locator('.jlcf-pane-toggle').click();
    await clickModel(page, 'top-default-196', ['top-default-196']);
    await pane.locator('.jlcf-pane-toggle').click();
    await page.waitForFunction('window.__selectionTest.row()?.visible');
    await page.screenshot({ path: join(OUTPUT, `responsive-${width}.jpg`) });
  }
  const blank = await page.evaluate(() => {
    const test = (window as any).__selectionTest;
    const canvas = document.querySelector('#smt-engine-canvas')!;
    const rect = canvas.getBoundingClientRect();
    const boxes = (window as any).__JLCFConv.geometry
      .inspect(Object.keys(test.context().uniqueIdIndex))
      .map((item: any) => ({
        left: Math.min(...item.projected.map((p: any) => p.x)),
        right: Math.max(...item.projected.map((p: any) => p.x)),
        top: Math.min(...item.projected.map((p: any) => p.y)),
        bottom: Math.max(...item.projected.map((p: any) => p.y)),
      }));
    for (const fy of [0.1, 0.9, 0.25, 0.75, 0.5])
      for (const fx of [0.1, 0.9, 0.25, 0.75, 0.5]) {
        const x = rect.width * fx,
          y = rect.height * fy;
        if (
          document.elementFromPoint(rect.x + x, rect.y + y) === canvas &&
          boxes.every((box: any) => x < box.left || x > box.right || y < box.top || y > box.bottom)
        )
          return { x: rect.x + x, y: rect.y + y };
      }
    return null;
  });
  assert(blank, '画布存在不覆盖元器件和控件的空白位置');
  const beforeBlank = await state(page);
  await page.mouse.click(blank.x, blank.y);
  await expectSelection(page, beforeBlank.revision, '-1', []);
  records.push({ operation: '模型空白完整清空', state: await state(page) });
  const dragStart = await point(page, 'top-default-196');
  const dragRevision = (await state(page)).revision;
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragStart.x + 50, dragStart.y + 30, { steps: 8 });
  await page.mouse.up();
  assert.equal((await state(page)).revision, dragRevision, '拖动画布不提交点击选择');
  await page.screenshot({ path: join(OUTPUT, 'blank-clears-selection.jpg') });
  await context.close();

  const phone = await browser.newContext({
    offline: true,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  });
  const mobile = await phone.newPage();
  await ready(mobile);
  const bottom = mobile.locator('[data-jlcf-pane="bottom"]');
  await clickTable(mobile, 'top-default-2', ['top-default-2']);
  await bottom.locator('.jlcf-pane-toggle').tap();
  await clickModel(mobile, 'top-default-2', ['top-default-2'], true);
  await bottom.locator('.jlcf-pane-toggle').tap();
  await mobile.waitForFunction('window.__selectionTest.row()?.visible');
  await mobile.screenshot({ path: join(OUTPUT, 'touch-portrait.jpg') });
  await mobile.setViewportSize({ width: 844, height: 390 });
  await bottom.locator('.jlcf-pane-toggle').tap();
  await clickModel(mobile, 'top-default-2', ['top-default-2'], true);
  await bottom.locator('.jlcf-pane-toggle').tap();
  await mobile.waitForFunction('window.__selectionTest.row()?.visible');
  await mobile.screenshot({ path: join(OUTPUT, 'touch-landscape.jpg') });
  await phone.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(JSON.stringify({ channel: CHANNEL, records: records.length, errors, external }));
} catch (error) {
  for (const context of browser.contexts())
    for (const page of context.pages()) {
      await page.screenshot({ path: join(OUTPUT, 'failure.jpg') });
      records.push({
        failure: String(error),
        state: await page.evaluate('window.__selectionTest?.state()'),
        picks: await page.evaluate('window.__selectionTest?.picks'),
      });
    }
  throw error;
} finally {
  await writeFile(
    join(OUTPUT, 'report.json'),
    JSON.stringify({ file: FILE, channel: CHANNEL, records, errors, external }, null, 2),
    'utf8',
  );
  await browser.close();
}
