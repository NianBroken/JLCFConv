import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('dist-server', { recursive: true });
await build({
  entryPoints: ['src/preview/runtime.ts'],
  outfile: 'dist-server/preview-runtime.js',
  bundle: true,
  format: 'iife',
  globalName: 'JLCFPreview',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'inline',
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
