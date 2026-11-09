/** 批量部分成功、同名文件与取消任务均通过实际 HTTPS 接口和界面验证。 */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { inspectHtml } from '../src/core/html.js';
const info = JSON.parse(await readFile('.runtime/service.json', 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const source = await readFile(
  'C:/Users/Administrator/Desktop/HTML测试样本/图片传输模块.html',
  'utf8',
);
const ui = inspectHtml(source).scripts.find((script) =>
  script.code.includes('\\u79BB\\u7EBF\\u710A\\u63A5'),
)!;
const broken = source.slice(0, ui.start) + 'window.ui = "损坏的界面脚本";' + source.slice(ui.end);
const results: Record<string, unknown> = {};
try {
  await page.goto(info.urls[0]);
  const paths = [
    resolve('test-results/input-a/同名模型.html'),
    resolve('test-results/input-b/同名模型.html'),
    resolve('test-results/input-a/损坏模型.html'),
  ];
  await mkdir(resolve('test-results/input-a'), { recursive: true });
  await mkdir(resolve('test-results/input-b'), { recursive: true });
  await Promise.all(
    paths.map((path, index) => writeFile(path, index === 2 ? broken : source, 'utf8')),
  );
  await page.locator('input[type=file]').first().setInputFiles(paths);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/conversions') && response.request().method() === 'POST',
  );
  const downloaded = page.waitForEvent('download', { timeout: 300000 });
  await page.getByRole('button', { name: '转换并下载', exact: true }).click();
  const created = await (await responsePromise).json();
  const download = await downloaded;
  await download.saveAs(resolve('test-results/partial-duplicates.zip'));
  await page.getByText('部分文件转换成功', { exact: true }).waitFor();
  const job = await (
    await context.request.get(`${info.urls[0]}/api/conversions/${created.id}`)
  ).json();
  assert.equal(job.state, 'partial');
  assert.equal(job.files.filter((f: { state: string }) => f.state === 'success').length, 2);
  assert.equal(job.files[2].state, 'failed');
  await page.screenshot({ path: 'test-results/partial-results.png', fullPage: true });
  results.partial = job;
  const stranger = await browser.newContext();
  assert.equal(
    (await stranger.request.get(`${info.urls[0]}/api/conversions/${created.id}`)).status(),
    404,
  );
  results.sessionIsolation = true;
  const newJob = await (
    await context.request.post(`${info.urls[0]}/api/conversions`, {
      data: {
        fileIds: [job.files[0].id, job.files[1].id],
        options: {
          logo: { kind: 'text', text: '取消测试' },
          title: { kind: 'filename' },
          optimizePage: true,
          optimizeInteraction: true,
        },
      },
    })
  ).json();
  const cancelled = await (
    await context.request.delete(`${info.urls[0]}/api/conversions/${newJob.id}`)
  ).json();
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(
    (await context.request.get(`${info.urls[0]}/api/conversions/${newJob.id}/download`)).status(),
    409,
  );
  assert.equal((await context.request.get(`${info.urls[0]}/api/health`)).status(), 200);
  results.cancelled = cancelled;
} finally {
  await writeFile('test-results/edge-report.json', JSON.stringify(results, null, 2), 'utf8');
  await browser.close();
}
