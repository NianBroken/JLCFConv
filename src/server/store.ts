import { randomUUID } from 'node:crypto';
import { mkdir, rm, stat, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { availableParallelism, freemem } from 'node:os';
import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { ZipArchive } from 'archiver';
import {
  OUTPUT_PREFIX,
  type UploadInfo,
  type JobInfo,
  type ConversionOptions,
} from '../shared/config.js';
import { LIMITS } from './config.js';

export const DATA_ROOT = resolve(process.env.JLCF_DATA_DIR ?? '.runtime/data');
export const MAX_WORKERS = Math.max(
  1,
  Math.min(
    Number(process.env.JLCF_WORKERS) || 4,
    availableParallelism(),
    Math.floor(freemem() / (1536 * 1024 ** 2)),
  ),
);
export interface StoredUpload extends UploadInfo {
  path: string;
  session: string;
  created: number;
}
export interface StoredAsset {
  id: string;
  data: string;
  session: string;
  created: number;
}
export interface StoredJob extends JobInfo {
  session: string;
  directory: string;
  archive?: string;
  downloads: number;
  workers: Set<Worker>;
  created: number;
}
export const uploads = new Map<string, StoredUpload>();
export const assets = new Map<string, StoredAsset>();
export const jobs = new Map<string, StoredJob>();
let running = 0;
const waiting: Array<() => void> = [];
async function slot() {
  if (running >= MAX_WORKERS) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
}
function release() {
  running--;
  waiting.shift()?.();
}

/** 任务只通过 ID 引用输入副本，文件名不参与磁盘路径拼接。 */
export async function createJob(
  session: string,
  fileIds: string[],
  options: ConversionOptions,
  logoData?: string,
) {
  const id = randomUUID(),
    directory = join(DATA_ROOT, id);
  await mkdir(directory, { recursive: true });
  const selected = fileIds.map((fileId) => uploads.get(fileId)!);
  const job: StoredJob = {
    id,
    session,
    directory,
    state: 'queued',
    progress: 0,
    files: selected.map((file) => ({
      id: file.id,
      name: file.name,
      outputName: OUTPUT_PREFIX + file.name,
      state: 'queued',
    })),
    downloads: 0,
    workers: new Set(),
    created: Date.now(),
    expiresAt: Date.now() + LIMITS.retentionMs,
  };
  jobs.set(id, job);
  void processJob(job, selected, options, logoData).catch((error) => {
    job.state = 'failed';
    job.files
      .filter((file) => file.state === 'processing' || file.state === 'queued')
      .forEach((file) => {
        file.state = 'failed';
        file.error = error instanceof Error ? error.message : '任务处理失败';
      });
  });
  return job;
}
async function processJob(
  job: StoredJob,
  selected: StoredUpload[],
  options: ConversionOptions,
  logoData?: string,
) {
  await Promise.all(
    selected.map(async (file, index) => {
      await slot();
      try {
        if (job.state === 'cancelled') return;
        job.state = 'processing';
        job.files[index].state = 'processing';
        const outputPath = join(job.directory, `${index}.html`);
        await new Promise<void>((resolveTask, reject) => {
          const worker = new Worker(new URL('./worker.js', import.meta.url), {
            workerData: {
              inputPath: file.path,
              outputPath,
              filename: file.name,
              options,
              logoData,
            },
          });
          job.workers.add(worker);
          const timer = setTimeout(() => {
            void worker.terminate();
            reject(new Error('该文件转换超时，请缩小文件后重试。'));
          }, LIMITS.timeoutMs);
          worker.once('message', (result) => {
            clearTimeout(timer);
            job.workers.delete(worker);
            if (result.error) reject(new Error(result.error));
            else {
              job.files[index].report = result.report;
              resolveTask();
            }
          });
          worker.once('error', (error) => {
            clearTimeout(timer);
            job.workers.delete(worker);
            reject(error);
          });
          worker.once('exit', (code) => {
            clearTimeout(timer);
            job.workers.delete(worker);
            if (code !== 0)
              reject(new Error(job.state === 'cancelled' ? '任务已取消' : '转换工作线程异常结束'));
          });
        });
        if ((job as StoredJob).state !== 'cancelled') job.files[index].state = 'success';
      } catch (error) {
        job.files[index].state = job.state === 'cancelled' ? 'cancelled' : 'failed';
        job.files[index].error = error instanceof Error ? error.message : '文件处理失败';
      } finally {
        release();
        job.progress = Math.round(
          (job.files.filter((f) => ['success', 'failed', 'cancelled'].includes(f.state)).length /
            job.files.length) *
            100,
        );
      }
    }),
  );
  if (job.state === 'cancelled') return;
  const successful = job.files.filter((f) => f.state === 'success');
  if (successful.length === 0) {
    job.state = 'failed';
    return;
  }
  if (job.files.length > 1) {
    const archivePath = join(job.directory, 'results.zip');
    const output = createWriteStream(archivePath);
    const archive = new ZipArchive({ zlib: { level: 3 } });
    const archiveError = new Promise<never>((_, reject) => {
      archive.once('error', reject);
      archive.once('warning', reject);
    });
    archive.pipe(output);
    const names = new Map<string, number>();
    job.files.forEach((file, index) => {
      if (file.state !== 'success') return;
      const count = names.get(file.outputName) ?? 0;
      names.set(file.outputName, count + 1);
      archive.file(join(job.directory, `${index}.html`), {
        name: count ? `${count + 1}/${file.outputName}` : file.outputName,
      });
    });
    archive.append(
      JSON.stringify(
        {
          ...publicJob(job),
          state: successful.length === job.files.length ? 'success' : 'partial',
        },
        null,
        2,
      ),
      { name: '转换报告.json' },
    );
    try {
      await Promise.race([Promise.all([archive.finalize(), finished(output)]), archiveError]);
    } catch (error) {
      archive.abort();
      output.destroy();
      throw error;
    }
    job.archive = archivePath;
  }
  if ((job as StoredJob).state === 'cancelled') return;
  job.state = successful.length === job.files.length ? 'success' : 'partial';
  job.downloadUrl = `/api/conversions/${job.id}/download`;
  job.previewUrls = job.files.map((f, i) =>
    f.state === 'success' ? `/preview/${job.id}/${i}` : '',
  );
  job.expiresAt = Date.now() + LIMITS.retentionMs;
}
export function publicJob(job: StoredJob): JobInfo {
  return {
    id: job.id,
    state: job.state,
    progress: job.progress,
    files: job.files,
    downloadUrl: job.downloadUrl,
    previewUrls: job.previewUrls,
    expiresAt: job.expiresAt,
  };
}
export async function cancelJob(job: StoredJob) {
  job.state = 'cancelled';
  job.files
    .filter((f) => f.state === 'queued' || f.state === 'processing')
    .forEach((f) => {
      f.state = 'cancelled';
    });
  await Promise.all([...job.workers].map((worker) => worker.terminate()));
}
/** 活动任务和下载持有资源引用，清理器只移除过期且无人使用的副本。 */
export async function cleanup() {
  const now = Date.now();
  for (const [id, job] of jobs)
    if (
      job.expiresAt < now &&
      !job.workers.size &&
      !job.downloads &&
      !['processing', 'queued'].includes(job.state)
    ) {
      await rm(job.directory, { recursive: true, force: true });
      jobs.delete(id);
    }
  const activeIds = new Set(
    [...jobs.values()]
      .filter((j) => j.state === 'processing' || j.state === 'queued')
      .flatMap((j) => j.files.map((f) => f.id)),
  );
  for (const [id, file] of uploads)
    if (now - file.created > LIMITS.retentionMs && !activeIds.has(id)) {
      await rm(file.path, { force: true });
      uploads.delete(id);
    }
  for (const [id, asset] of assets) if (now - asset.created > LIMITS.retentionMs) assets.delete(id);
  // 重启前留下的副本同样遵守保留期限，范围限定为项目数据目录的 UUID 子目录。
  for (const entry of await readdir(DATA_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name) || jobs.has(entry.name))
      continue;
    const path = join(DATA_ROOT, entry.name);
    if (now - (await stat(path)).mtimeMs > LIMITS.retentionMs)
      await rm(path, { recursive: true, force: true });
  }
  const knownPaths = new Set([...uploads.values()].map((file) => file.path));
  for (const entry of await readdir(join(DATA_ROOT, 'incoming'), { withFileTypes: true })) {
    const path = join(DATA_ROOT, 'incoming', entry.name);
    if (
      entry.isFile() &&
      !knownPaths.has(path) &&
      now - (await stat(path)).mtimeMs > LIMITS.retentionMs
    )
      await rm(path, { force: true });
  }
}
export async function outputExists(path: string) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
