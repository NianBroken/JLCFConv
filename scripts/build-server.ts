import { build } from 'esbuild';
import { mkdir, readFile, copyFile } from 'node:fs/promises';
/** 构建产物和离线脚本保留第三方组件的完整授权文本。 */
const scrollbarLicense = await readFile('assets/vendor/OverlayScrollbars-LICENSE.txt', 'utf8');
await mkdir('dist-server', { recursive: true });
await copyFile('assets/vendor/OverlayScrollbars-LICENSE.txt', 'dist/OverlayScrollbars-LICENSE.txt');
await build({
  entryPoints: ['src/preview/entry.ts'],
  outfile: 'dist-server/preview-runtime.js',
  bundle: true,
  format: 'iife',
  globalName: 'JLCFPreview',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'inline',
  banner: { js: `/*! OverlayScrollbars 2.17.0\n${scrollbarLicense}\n*/` },
});
await build({
  entryPoints: ['src/server/main.ts', 'src/server/worker.ts'],
  outdir: 'dist-server',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  sourcemap: true,
});
