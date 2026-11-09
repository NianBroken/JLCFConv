import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { digest } from './html.js';

export interface Resource {
  url: string;
  file: string;
  hash: string;
  mime: string;
  bytes: number;
}
export interface ResourceBundle {
  manifest: Resource[];
  content: Map<string, Buffer>;
}
const RESOURCE_DIRECTORY = resolve('assets/vendor');
/** 资源只从样本已经引用的官方模块目录读取，禁止任意目标请求。 */
export async function prepareResources(samplePath: string) {
  const source = await readFile(samplePath, 'utf8');
  const urls = [
    ...new Set(source.match(/https:\/\/modules\.lceda\.cn\/[^\s"'<>\\`]+\.(?:wasm|woff2)/g) ?? []),
  ];
  const engineBase = urls.find((url) => url.includes('/smt-gl-engine/'))?.replace(/[^/]+$/, '');
  if (!engineBase) throw new Error('无法识别引擎资源版本。');
  urls.push(engineBase + 'workerHelpers.js');
  await mkdir(RESOURCE_DIRECTORY, { recursive: true });
  const manifest = await Promise.all(
    urls.map(async (url) => {
      const file = `${digest(url).slice(0, 16)}-${new URL(url).pathname.split('/').pop()}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`官方资源读取失败，HTTP ${response.status}。`);
      const bytes = Buffer.from(await response.arrayBuffer());
      await writeFile(resolve(RESOURCE_DIRECTORY, file), bytes);
      return {
        url,
        file,
        bytes: bytes.length,
        hash: digest(bytes),
        mime: url.endsWith('.wasm')
          ? 'application/wasm'
          : url.endsWith('.woff2')
            ? 'font/woff2'
            : 'text/javascript',
      };
    }),
  );
  await writeFile(
    resolve(RESOURCE_DIRECTORY, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
  return manifest;
}
/** 摘要检查使损坏的本地资源在转换前被识别。 */
export async function loadResources(): Promise<ResourceBundle> {
  const manifest: Resource[] = JSON.parse(
    await readFile(resolve(RESOURCE_DIRECTORY, 'manifest.json'), 'utf8'),
  );
  const content = new Map<string, Buffer>();
  await Promise.all(
    manifest.map(async (resource) => {
      const bytes = await readFile(resolve(RESOURCE_DIRECTORY, resource.file));
      if (digest(bytes) !== resource.hash) throw new Error(`资源校验失败：${resource.file}`);
      content.set(resource.url, bytes);
    }),
  );
  return { manifest, content };
}
