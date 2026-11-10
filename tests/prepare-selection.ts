/** 六份真实输入及配置组合分别生成文件，源文件与内嵌数据均执行摘要核对。 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import assert from 'node:assert/strict';
import { convertHtml } from '../src/core/convert.js';
import { digest, inspectHtml } from '../src/core/html.js';
import { DEFAULT_OPTIONS, OUTPUT_PREFIX } from '../src/shared/config.js';

const INPUT = resolve(
  process.env.JLCF_SAMPLE_DIRECTORY ?? join(homedir(), 'Desktop', 'HTML测试样本'),
);
const OUTPUT = resolve('test-results/selection-final/generated');
const reports: unknown[] = [];
const payload = (html: string) =>
  inspectHtml(html)
    .scripts.filter((script) =>
      /^\s*window\.(?:files|__ENGING_OBJ_PRELOAD__)\s*=/.test(script.code),
    )
    .map((script) => digest(script.code));
await mkdir(OUTPUT, { recursive: true });
const files = (await readdir(INPUT)).filter((name) => /\.html?$/i.test(name));
for (const filename of files) {
  const file = join(INPUT, filename),
    original = await readFile(file, 'utf8');
  const result = await convertHtml({ html: original, filename, options: DEFAULT_OPTIONS });
  assert.equal(result.filename, OUTPUT_PREFIX + filename);
  assert.deepEqual(payload(result.html), payload(original));
  assert.equal(digest(await readFile(file)), digest(original));
  await writeFile(join(OUTPUT, result.filename), result.html, 'utf8');
  reports.push({
    filename,
    bytes: Buffer.byteLength(result.html),
    report: result.report,
    originalUnchanged: true,
    payloadUnchanged: true,
  });
}
const representative = files.find((filename) => filename.includes('图片传输')) ?? files[0];
for (const [optimizePage, optimizeInteraction] of [
  [false, false],
  [false, true],
  [true, false],
] as const) {
  const directory = join(OUTPUT, `options-${Number(optimizePage)}${Number(optimizeInteraction)}`);
  await mkdir(directory, { recursive: true });
  const result = await convertHtml({
    html: await readFile(join(INPUT, representative), 'utf8'),
    filename: representative,
    options: { ...DEFAULT_OPTIONS, optimizePage, optimizeInteraction },
  });
  await writeFile(join(directory, result.filename), result.html, 'utf8');
  reports.push({
    configuration: { optimizePage, optimizeInteraction },
    file: join(directory, result.filename),
    report: result.report,
  });
}
await writeFile(join(OUTPUT, 'report.json'), JSON.stringify(reports, null, 2), 'utf8');
console.log(
  JSON.stringify({
    samples: files.length,
    configurations: 4,
    reports: reports.length,
    output: OUTPUT,
  }),
);
