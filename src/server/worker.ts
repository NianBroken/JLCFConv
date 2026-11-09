import { parentPort, workerData } from 'node:worker_threads';
import { readFile, writeFile } from 'node:fs/promises';
import { convertHtml } from '../core/convert.js';

/** 工作线程隔离大型脚本分析，错误作为单文件结果返回。 */
try {
  const bytes = await readFile(workerData.inputPath);
  const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const result = await convertHtml({
    html,
    filename: workerData.filename,
    options: workerData.options,
    logoData: workerData.logoData,
  });
  await writeFile(workerData.outputPath, result.html, 'utf8');
  parentPort?.postMessage({ report: result.report });
} catch (error) {
  parentPort?.postMessage({ error: error instanceof Error ? error.message : '转换失败' });
} finally {
  parentPort?.close();
}
