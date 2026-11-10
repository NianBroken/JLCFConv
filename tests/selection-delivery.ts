/** 生产 HTTPS 页面实际上传、自动下载、预览及数据完整性共同构成交付检查。 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { PROBE, stablePoint, type State } from './selection-probe.js';
import { digest, inspectHtml } from '../src/core/html.js';
import { OUTPUT_PREFIX } from '../src/shared/config.js';

const INPUT = resolve(
  process.env.JLCF_SAMPLE_DIRECTORY ?? join(homedir(), 'Desktop', 'HTML测试样本'),
);
const OUTPUT = resolve('test-results/selection-final/downloads');
const service = JSON.parse(await readFile('.runtime/service.json', 'utf8'));
const names = (await readdir(INPUT)).filter((name) => /\.html?$/i.test(name));
const representative = names.find((name) => name.includes('图片传输')) ?? names[0];
const browser = await launchBrowser();
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1440, height: 1000 },
});
const report: Record<string, unknown> = {
  origin: service.urls[0],
  started: new Date().toISOString(),
};
const errors: string[] = [];
const hashes = new Map(
  await Promise.all(
    names.map(async (name) => [name, digest(await readFile(join(INPUT, name)))] as const),
  ),
);
await mkdir(OUTPUT, { recursive: true });
const payload = (source: string) =>
  inspectHtml(source)
    .scripts.filter((script) =>
      /^\s*window\.(?:files|__ENGING_OBJ_PRELOAD__)\s*=/.test(script.code),
    )
    .map((script) => digest(script.code));
try {
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type())) errors.push(message.text());
  });
  await page.goto(service.urls[0]);
  report.health = await page.evaluate(() =>
    fetch('/api/health').then((response) => response.json()),
  );
  await page.locator('input[type=file]').first().setInputFiles(join(INPUT, representative));
  const singlePromise = page.waitForEvent('download', { timeout: 300000 });
  await page.getByRole('button', { name: '转换并下载', exact: true }).click();
  const single = await singlePromise;
  assert.equal(single.suggestedFilename(), OUTPUT_PREFIX + representative);
  await single.saveAs(join(OUTPUT, single.suggestedFilename()));
  await page.screenshot({ path: join(OUTPUT, 'single-success.jpg'), fullPage: true });
  const previewUrl = await page.locator('a[href*="/preview/"]').first().getAttribute('href');
  assert(previewUrl);
  const preview = await context.newPage();
  preview.on('pageerror', (error) => errors.push(error.message));
  preview.on('console', (message) => {
    if (['warning', 'error'].includes(message.type())) errors.push(message.text());
  });
  await preview.goto(previewUrl);
  await preview.evaluate(PROBE);
  await preview.waitForFunction('Boolean(window.__selectionTest.state())', null, {
    timeout: 120000,
  });
  const secure = await preview.evaluate(() => ({
    secure: isSecureContext,
    isolated: crossOriginIsolated,
  }));
  assert(secure.secure && secure.isolated);
  await preview.locator('[data-jlcf-component="top-default-2"]').first().click();
  await preview.waitForFunction('window.__selectionTest.state().active==="top-default-2"');
  const before = await preview.evaluate<State>('window.__selectionTest.state()');
  const point = await stablePoint(preview, 'top-default-2');
  await preview.mouse.click(point.x, point.y);
  await preview.waitForFunction(
    (revision) => (window as any).__selectionTest.state().revision > revision,
    before.revision,
  );
  const after = await preview.evaluate<State>('window.__selectionTest.state()');
  assert.equal(after.active, 'top-default-2');
  assert.equal(await preview.evaluate('window.__selectionTest.picks.at(-1)'), 'top-default-2');
  await preview.waitForFunction('window.__selectionTest.row()?.visible');
  await preview.screenshot({ path: join(OUTPUT, 'https-bidirectional.jpg') });
  report.single = {
    filename: single.suggestedFilename(),
    previewUrl,
    secure,
    before,
    after,
    point,
  };
  await preview.close();
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles(names.map((name) => join(INPUT, name)));
  const zipPromise = page.waitForEvent('download', { timeout: 300000 });
  await page.getByRole('button', { name: '转换并下载', exact: true }).click();
  const zip = await zipPromise;
  const archive = join(OUTPUT, 'batch.zip'),
    destination = join(OUTPUT, 'batch');
  await zip.saveAs(archive);
  execFileSync(
    'pwsh',
    [
      '-NoProfile',
      '-Command',
      'Expand-Archive -LiteralPath $env:JLCF_TEST_ZIP -DestinationPath $env:JLCF_TEST_DESTINATION -Force',
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, JLCF_TEST_ZIP: archive, JLCF_TEST_DESTINATION: destination },
    },
  );
  const outputNames = (await readdir(destination)).filter((name) => /\.html?$/i.test(name));
  assert.deepEqual(outputNames.sort(), names.map((name) => OUTPUT_PREFIX + name).sort());
  for (const name of names) {
    const original = await readFile(join(INPUT, name), 'utf8');
    const result = await readFile(join(destination, OUTPUT_PREFIX + name), 'utf8');
    assert.deepEqual(payload(result), payload(original));
    assert.equal(digest(await readFile(join(INPUT, name))), hashes.get(name));
    assert(
      result.includes('.registerTable(') &&
        result.includes('.sortMembers(') &&
        result.includes('.deferTable('),
    );
  }
  await page.screenshot({ path: join(OUTPUT, 'batch-success.jpg'), fullPage: true });
  report.batch = {
    filename: zip.suggestedFilename(),
    files: outputNames,
    sourceAndModelUnchanged: true,
  };
  report.errors = errors;
  assert.deepEqual(errors, []);
  report.finished = new Date().toISOString();
  console.log(
    JSON.stringify({
      single: single.suggestedFilename(),
      batch: outputNames.length,
      secure,
      errors,
    }),
  );
} finally {
  await writeFile(join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  await browser.close();
}
