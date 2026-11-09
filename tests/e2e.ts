/** 用真实样本完成批量上传、自动下载、HTTPS 预览与断网直开检查。 */
import { chromium, type Page } from 'playwright';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { digest, inspectHtml } from '../src/core/html.js';
import { COMPANY, DEFAULT_LOGO, OUTPUT_PREFIX } from '../src/shared/config.js';

const SAMPLES = process.env.JLCF_TEST_SAMPLES ?? 'C:/Users/Administrator/Desktop/HTML测试样本';
const OUTPUT = resolve('test-results');
const service = JSON.parse(await readFile('.runtime/service.json', 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1440, height: 1000 },
});
const report: Record<string, unknown> = {
  started: new Date().toISOString(),
  origin: service.urls[0],
  samples: [],
};
await mkdir(OUTPUT, { recursive: true });
const names = (await readdir(SAMPLES)).filter((name) => /\.html?$/i.test(name));
const hashes = new Map(
  await Promise.all(
    names.map(async (name) => [name, digest(await readFile(join(SAMPLES, name)))] as const),
  ),
);

/** 画面完成条件采用引擎完成日志，截图和后续操作同时确认模型可见。 */
async function inspectResult(page: Page, url: string, name: string, index: number) {
  const errors: string[] = [],
    failures: string[] = [],
    diagnostics: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
    if (message.type() === 'warning') diagnostics.push(message.text());
  });
  page.on('requestfailed', (request) => failures.push(request.url()));
  await page.goto(url, { timeout: 120000 });
  await page.locator('canvas').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => !document.body.innerText.includes('正在加载'), {
    timeout: 120000,
  });
  await page.waitForTimeout(6000);
  assert.equal(await page.title(), name);
  assert.equal(await page.locator('.jlcf-logo').innerText(), DEFAULT_LOGO);
  assert.equal(await page.locator('[class*="matchingTools-header_"]').count(), 0);
  assert.equal(await page.locator('[class*="smt-preview-header-nav-bar_"]').count(), 0);
  const svgBackgrounds = await page
    .locator('[class*="canvas-mode-"]')
    .evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).backgroundImage),
    );
  assert(svgBackgrounds.some((text) => text.includes('data:image/svg')));
  await page.screenshot({ path: join(OUTPUT, `converted-${index}.png`) });
  assert.deepEqual(errors, [], `${name} 页面错误`);
  assert.deepEqual(failures, [], `${name} 请求失败`);
  return {
    name,
    errors: [...errors],
    failures: [...failures],
    diagnostics: [...diagnostics],
    secure: await page.evaluate(() => ({
      secure: isSecureContext,
      isolated: crossOriginIsolated,
      gpu: 'gpu' in navigator,
    })),
  };
}
try {
  const page = await context.newPage();
  await page.goto(service.urls[0]);
  let previews: string[];
  const archive = join(OUTPUT, 'batch.zip');
  if (process.env.JLCF_RESUME_JOB) {
    previews = names.map(
      (_, i) =>
        `https://${service.addresses[0]}:${service.previewPort}/preview/${process.env.JLCF_RESUME_JOB}/${i}`,
    );
  } else {
    await page
      .locator('input[type=file]')
      .first()
      .setInputFiles(names.map((name) => join(SAMPLES, name)));
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('.file-copy')).filter((e) =>
          e.textContent?.includes('已就绪'),
        ).length === 6,
      { timeout: 45000 },
    );
    const downloadPromise = page.waitForEvent('download', { timeout: 300000 });
    await page.getByRole('button', { name: '转换并下载', exact: true }).click({ timeout: 45000 });
    const download = await downloadPromise;
    await download.saveAs(archive);
    await page.screenshot({ path: join(OUTPUT, 'batch-success.png'), fullPage: true });
    previews = await page
      .locator('a[href*="/preview/"]')
      .evaluateAll((elements) => elements.map((element) => (element as HTMLAnchorElement).href));
  }
  const destination = join(OUTPUT, 'batch');
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
  assert.equal(previews.length, names.length);
  report.jobId = new URL(previews[0]).pathname.split('/')[2];
  for (const [index, name] of names.entries()) {
    const output = await readFile(join(destination, OUTPUT_PREFIX + name), 'utf8');
    const original = await readFile(join(SAMPLES, name), 'utf8');
    const payload = (source: string) =>
      inspectHtml(source)
        .scripts.filter((s) => /^\s*window\.files\s*=/.test(s.code))
        .map((s) => digest(s.code));
    assert.deepEqual(payload(output), payload(original));
    const resultPage = await context.newPage();
    (report.samples as unknown[]).push(
      await inspectResult(resultPage, previews[index], name, index),
    );
    await resultPage.close();
    console.log('已验证', name);
  }
  const offline = await browser.newContext({
    offline: true,
    viewport: { width: 1440, height: 1000 },
  });
  const local = await offline.newPage();
  report.offline = await inspectResult(
    local,
    pathToFileURL(join(destination, OUTPUT_PREFIX + names[5])).href,
    names[5],
    6,
  );
  await local.locator('.jlcf-pane-toggle').first().click();
  assert.equal(await local.locator('[data-jlcf-pane=left]').getAttribute('data-open'), 'false');
  await local.locator('.jlcf-pane-toggle').first().click();
  assert.equal(await local.locator('[data-jlcf-pane=left]').getAttribute('data-open'), 'true');
  await local.screenshot({ path: join(OUTPUT, 'offline-model.png') });
  await offline.close();
  for (const name of names)
    assert.equal(digest(await readFile(join(SAMPLES, name))), hashes.get(name));
  report.originalsUnchanged = true;
  report.company = COMPANY;
  report.finished = new Date().toISOString();
} finally {
  await writeFile(join(OUTPUT, 'e2e-report.json'), JSON.stringify(report, null, 2), 'utf8');
  await browser.close();
}
