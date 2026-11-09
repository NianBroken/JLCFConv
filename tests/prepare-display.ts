/** 为浏览器显示回归生成独立结果，输入目录只执行读取。 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { convertHtml } from '../src/core/convert.js';
import { DEFAULT_OPTIONS } from '../src/shared/config.js';

const directory = resolve('test-results/display-fixes');
const file =
  process.env.JLCF_DISPLAY_SAMPLE ??
  'C:/Users/Administrator/Desktop/HTML测试样本/图片传输模块.html';
await mkdir(directory, { recursive: true });
const result = await convertHtml({
  html: await readFile(file, 'utf8'),
  filename: basename(file),
  options: DEFAULT_OPTIONS,
});
await writeFile(join(directory, result.filename), result.html, 'utf8');
await writeFile(join(directory, 'conversion.json'), JSON.stringify(result.report, null, 2), 'utf8');
console.log(
  JSON.stringify({
    filename: result.filename,
    bytes: Buffer.byteLength(result.html),
    report: result.report,
  }),
);
