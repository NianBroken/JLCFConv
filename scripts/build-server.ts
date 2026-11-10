import { build } from 'esbuild';
import { mkdir, readFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

/** 独立构建目录用于验证完整产物，服务部署目录不参与验证构建的写入。 */
const outputRoot = resolve(process.env.JLCF_BUILD_DIRECTORY ?? '.');
const serverDirectory = join(outputRoot, 'dist-server');
const frontendDirectory = join(outputRoot, 'dist');
/** 构建产物和离线脚本保留第三方组件的完整授权文本。 */
const scrollbarLicense = await readFile('assets/vendor/OverlayScrollbars-LICENSE.txt', 'utf8');
await mkdir(serverDirectory, { recursive: true });
await mkdir(frontendDirectory, { recursive: true });
await copyFile(
  'assets/vendor/OverlayScrollbars-LICENSE.txt',
  join(frontendDirectory, 'OverlayScrollbars-LICENSE.txt'),
);
await build({
  entryPoints: ['src/preview/entry.ts'],
  outfile: join(serverDirectory, 'preview-runtime.js'),
  bundle: true,
  format: 'iife',
  globalName: 'JLCFPreview',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'inline',
  sourcemap: 'external',
  banner: { js: `/*! OverlayScrollbars 2.17.0\n${scrollbarLicense}\n*/` },
});
await build({
  entryPoints: ['src/server/main.ts', 'src/server/worker.ts'],
  outdir: serverDirectory,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  sourcemap: true,
});
