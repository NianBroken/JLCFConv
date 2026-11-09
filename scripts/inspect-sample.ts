import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { inspectHtml } from '../src/core/html.js';
const path = process.argv[2];
if (!path) throw new Error('请传入样本绝对路径。');
const source = await readFile(path, 'utf8');
const { scripts } = inspectHtml(source);
await mkdir('.runtime', { recursive: true });
for (const [index, script] of scripts.entries()) {
  console.log(
    JSON.stringify({ index, length: script.code.length, first: script.code.slice(0, 70) }),
  );
  if (script.code.length > 1_000_000 && !/^\s*window\.files\s*=/.test(script.code))
    await writeFile(`.runtime/script-${index}.js`, script.code, 'utf8');
}
