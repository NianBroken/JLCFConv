/**
 * 显示回归使用真实输出文件和浏览器原生输入。
 * 量测覆盖列边界、滚动视口、悬浮轨道、触控尺寸和页面提示。
 */
import type { Page, BrowserContext } from 'playwright';
import { launchBrowser } from './browser.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const DIRECTORY = resolve(process.env.JLCF_DISPLAY_RESULTS ?? 'test-results/display-fixes');
const FILE = process.env.JLCF_DISPLAY_FILE ?? join(DIRECTORY, '中山勤奋光电图片传输模块.html');
const PHONE_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const browser = await launchBrowser(process.env.JLCF_BROWSER ?? 'chrome');
const records: unknown[] = [];
const failures: string[] = [];
const errors: string[] = [];

function check(condition: unknown, message: string) {
  if (!condition) failures.push(message);
}

/** 输入由浏览器产生，指针捕获、取消和原生滚动均参与实际运行。 */
async function drag(context: BrowserContext, page: Page, side: string, dx: number, dy: number) {
  const handle = (await page
    .locator(`[data-jlcf-pane=${side}] > .jlcf-pane-resize`)
    .boundingBox())!;
  const x = handle.x + handle.width / 2,
    y = handle.y + Math.min(40, handle.height / 2);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let index = 1; index <= 5; index++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + (dx * index) / 5, y: y + (dy * index) / 5 }],
    });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** 收集原有 DOM 边界，断言不依赖截图中的文字识别。 */
async function inspect(page: Page, label: string) {
  const measure = () => {
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        w: rect.width,
        h: rect.height,
        right: rect.right,
        bottom: rect.bottom,
      };
    };
    const tables = [...document.querySelectorAll<HTMLTableElement>('[data-jlcf-table]')].filter(
      (element) => element.getBoundingClientRect().width,
    );
    const header = tables.find((element) => element.querySelector('thead'))?.rows[0];
    const data = tables.find((element) => !element.querySelector('thead'))?.rows[0];
    const pane = document.querySelector<HTMLElement>('[data-jlcf-pane][data-open=true]');
    const viewport = pane?.querySelector<HTMLElement>(
      '[class*="bom-table-MatchingTools_"],[class*="coordinate-container_"]',
    );
    return {
      width: innerWidth,
      height: innerHeight,
      header: header
        ? [...header.cells].map((cell) => ({ text: cell.innerText, ...box(cell) }))
        : [],
      row: data
        ? [...data.cells].map((cell) => ({ text: cell.innerText.slice(0, 100), ...box(cell) }))
        : [],
      pane: pane ? box(pane) : null,
      viewport: viewport
        ? {
            ...box(viewport),
            clientW: viewport.clientWidth,
            clientH: viewport.clientHeight,
            scrollW: viewport.scrollWidth,
            scrollH: viewport.scrollHeight,
          }
        : null,
      buttons: [...document.querySelectorAll('.jlcf-pane-toggle')].map(box),
      nativeGutter: viewport ? viewport.offsetWidth - viewport.clientWidth : 0,
      overlayCount: document.querySelectorAll('.os-scrollbar').length,
      handles: [
        ...document.querySelectorAll<HTMLElement>(
          '.os-scrollbar-visible:not(.os-scrollbar-unusable) .os-scrollbar-handle',
        ),
      ]
        .filter((element) => element.getBoundingClientRect().width > 0)
        .map((element) => ({
          ...box(element),
          vertical: element.closest('.os-scrollbar')!.classList.contains('os-scrollbar-vertical'),
        })),
      notices: [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .filter((rule) => /供参考|以实物为准/.test(rule.cssText))
        .map((rule) => rule.cssText),
      names: [...document.querySelectorAll('[class*="weld_phone_name_"]')].map(
        (element) => element.textContent,
      ),
      radios: [...document.querySelectorAll<HTMLInputElement>('input[type=radio]')]
        .filter((element) => element.getBoundingClientRect().width)
        .map((element) => ({ input: box(element), label: box(element.closest('label')!) })),
      body: document.body.innerText.slice(-1500),
    };
  };
  // 浏览器执行独立函数文本，测试运行器的名称辅助函数在页面内明确提供。
  const value = await page.evaluate<ReturnType<typeof measure>>(
    `(()=>{const __name=fn=>fn;return (${measure.toString()})();})()`,
  );
  if (value.header.length && value.row.length) {
    check(value.header.length === value.row.length, `${label} 表头与数据列数不一致`);
    value.header.forEach((cell, index) => {
      const data = value.row[index];
      check(
        data && Math.abs(cell.x - data.x) <= 1 && Math.abs(cell.w - data.w) <= 1,
        `${label} 列 ${cell.text} 边界不一致`,
      );
    });
  }
  if (value.pane && value.viewport) {
    check(value.viewport.right <= value.pane.right + 1, `${label} 滚动视口超出侧栏右边界`);
    check(value.viewport.bottom <= value.pane.bottom + 1, `${label} 滚动视口超出侧栏底边界`);
    check(value.viewport.h > 20, `${label} 滚动视口没有可用高度`);
  }
  check(
    value.buttons.every((button) => button.w >= 44 && button.h >= 44),
    `${label} 按钮热区不足`,
  );
  check(value.nativeGutter === 0, `${label} 滚动轨道占用布局宽度`);
  check(value.overlayCount > 0, `${label} 未初始化悬浮滚动条`);
  check(
    value.handles.every((handle) => Math.abs((handle.vertical ? handle.w : handle.h) - 4) <= 0.1),
    `${label} 可见滑块不是4像素细线`,
  );
  check(value.notices.length === 0, `${label} 原提示残留`);
  check(!value.names.includes('PCB3'), `${label} 手机标题残留`);
  check(
    value.radios.every(
      (radio) => radio.input.y >= radio.label.y && radio.input.bottom <= radio.label.bottom,
    ),
    `${label} 单选输入与文字分离`,
  );
  records.push({ label, value });
  await page.screenshot({ path: join(DIRECTORY, `${label}.png`) });
  return value;
}

/** 拖动可见滑块，核对内容移动、边界可达性和悬浮轨道的细度。 */
async function scrollHandles(context: BrowserContext, page: Page, label: string, touch: boolean) {
  const viewport = page
    .locator('[class*="bom-table-MatchingTools_"],[class*="coordinate-container_"]')
    .first();
  for (const vertical of [true, false]) {
    const handle = viewport
      .locator(`.os-scrollbar-${vertical ? 'vertical' : 'horizontal'} .os-scrollbar-handle`)
      .first();
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    const area = (await viewport.boundingBox())!;
    const destination = vertical
      ? { x, y: area.y + area.height - 22 }
      : { x: area.x + area.width - 22, y };
    if (touch) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [destination] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(destination.x, destination.y, { steps: 8 });
      await page.mouse.up();
    }
    // 组件在拖动结束后保留150毫秒的误点击保护，后续独立点击在该窗口结束后执行。
    await page.waitForTimeout(170);
    const position = await viewport.evaluate(
      (element, vertical) => (vertical ? element.scrollTop : element.scrollLeft),
      vertical,
    );
    check(position > 0, `${label} ${vertical ? '纵向' : '横向'}滑块无法拖动`);
    await inspect(page, `${label}-${vertical ? 'vertical' : 'horizontal'}`);
  }
}

await mkdir(DIRECTORY, { recursive: true });
try {
  for (const phone of [false, true]) {
    const context = await browser.newContext({
      offline: true,
      hasTouch: true,
      isMobile: phone,
      ...(phone ? { userAgent: PHONE_UA } : {}),
      viewport: { width: phone ? 390 : 1440, height: phone ? 844 : 900 },
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(pathToFileURL(FILE).href);
    await page.locator('.jlcf-pane').first().waitFor();
    await page.screenshot({
      path: join(DIRECTORY, phone ? 'phone-loading.png' : 'desktop-loading.png'),
    });
    console.log(
      JSON.stringify({
        phase: '界面已加载',
        phone,
        canvas: await page.locator('canvas').getAttribute('class'),
      }),
    );
    await page.waitForFunction(
      () => document.querySelector('canvas')?.className.includes('canvas-mode-3D'),
      null,
      { timeout: 90000 },
    );
    await inspect(page, phone ? 'phone-default' : 'desktop-default');
    if (phone) {
      await page.locator('#showDialog img').tap();
      const menu = await inspect(page, 'phone-menu');
      const xs = menu.radios.map((radio) => radio.input.x);
      check(Math.max(...xs) - Math.min(...xs) <= 1, '手机菜单单选按钮没有左对齐');
      await page.getByText('简图', { exact: true }).tap();
      await inspect(page, 'phone-simple');
      await page.locator('#showDialog img').tap();
      await drag(context, page, 'bottom', 0, 700);
      await inspect(page, 'phone-minimum');
      await scrollHandles(context, page, 'phone-drag', true);
      await page.getByRole('button', { name: '收起底部栏', exact: true }).tap();
      await inspect(page, 'phone-collapsed');
      await page.getByRole('button', { name: '展开底部栏', exact: true }).tap();
      await page.setViewportSize({ width: 844, height: 390 });
      await inspect(page, 'phone-landscape');
    } else {
      await page.getByRole('button', { name: '位号不聚合', exact: true }).tap();
      await page.locator('[data-jlcf-table=individual]').first().waitFor();
      await inspect(page, 'desktop-individual-wide');
      await page.getByRole('button', { name: '位号聚合', exact: true }).tap();
      await page.locator('[data-jlcf-table=aggregate]').first().waitFor();
      await drag(context, page, 'left', -1500, 0);
      await inspect(page, 'desktop-minimum');
      await page.mouse.move(80, 440);
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(250);
      check(
        await page
          .locator('[class*="bom-table-MatchingTools_"]')
          .evaluate((element) => element.scrollTop > 0),
        '最小侧栏不能滚动',
      );
      await scrollHandles(context, page, 'desktop-drag', false);
      // 桌面鼠标拖动之后继续使用鼠标切换表格，手机流程全部使用触摸输入。
      await page.getByRole('button', { name: '位号不聚合', exact: true }).click();
      await page.locator('[data-jlcf-table=individual]').first().waitFor();
      await inspect(page, 'desktop-individual');
      await page.getByRole('button', { name: '收起左侧栏', exact: true }).tap();
      await page.getByRole('button', { name: '展开右侧栏', exact: true }).tap();
      await drag(context, page, 'right', 1000, 0);
      await inspect(page, 'desktop-right-minimum');
      await page.getByRole('button', { name: '收起右侧栏', exact: true }).tap();
      for (const width of [1024, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await inspect(page, `desktop-${width}`);
      }
    }
    await context.close();
  }
  check(errors.length === 0, `控制台真实错误：${errors.join('\n')}`);
} finally {
  await writeFile(
    join(DIRECTORY, 'display-report.json'),
    JSON.stringify(
      {
        records,
        failures,
        errors,
        baseline: JSON.parse(
          await readFile('test-results/planning-display-20261109/baseline-assertions.json', 'utf8'),
        ).checks.map((check: { name: string }) => check.name),
      },
      null,
      2,
    ),
    'utf8',
  );
  await browser.close();
}
console.log(JSON.stringify({ states: records.length, failures, errors }));
assert.equal(failures.length, 0, failures.join('\n'));
