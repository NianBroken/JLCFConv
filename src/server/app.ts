import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { decodeIco, isIco } from 'icojs';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { PROJECT, optionsSchema } from '../shared/config.js';
import { LIMITS, TLS_DIRECTORY } from './config.js';
import { digest } from '../core/html.js';
import { DATA_ROOT, uploads, assets, jobs, createJob, publicJob, cancelJob } from './store.js';

const SESSIONS = new WeakMap<Request, string>();
const UUID = /^[0-9a-f-]{36}$/i;
const SESSION_COOKIE = 'jlcf-session';
const upload = multer({
  dest: join(DATA_ROOT, 'incoming'),
  limits: { fileSize: LIMITS.fileBytes, files: 1, fields: 3, fieldSize: 4096 },
});
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.logoBytes, files: 1 },
});
const requestSchema = z.object({
  fileIds: z.array(z.string().uuid()).min(1).max(LIMITS.files),
  options: optionsSchema,
});
/** 输入错误明确返回中文，运行错误集中交由错误处理中间件处理。 */
export function createApp(previewOrigin = '') {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const cookie = req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(SESSION_COOKIE + '='))
      ?.split('=')[1];
    const session = cookie && UUID.test(cookie) ? cookie : randomUUID();
    SESSIONS.set(req, session);
    // 活动请求延续同一会话的有效期，文件与结果的保留期限由存储层独立控制。
    res.cookie(SESSION_COOKIE, session, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: LIMITS.retentionMs,
      path: '/',
    });
    if (
      !['GET', 'HEAD'].includes(req.method) &&
      req.headers.origin &&
      req.headers.origin !== `https://${req.headers.host}`
    ) {
      res.status(403).json({ error: '请求来源与工具地址不一致。' });
      return;
    }
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.get('/api/health', (_req, res) =>
    res.json({
      ok: true,
      project: PROJECT.englishName,
      runtime: process.version,
      lts: process.release.lts ?? null,
    }),
  );
  app.get('/api/capabilities', (_req, res) =>
    res.json({ limits: LIMITS, project: PROJECT, previewOrigin }),
  );
  app.post('/api/uploads', upload.single('file'), async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: '请选择 HTML 文件。' });
      return;
    }
    try {
      const name = String(
        req.body.filename ?? Buffer.from(file.originalname, 'latin1').toString('utf8'),
      );
      if (!/\.html?$/i.test(name) || /[\\/\x00-\x1f]/.test(name) || name.length > 240)
        throw new Error('文件名必须是有效的 HTML 文件名。');
      if (file.size === 0) throw new Error('HTML 文件为空。');
      const bytes = await readFile(file.path);
      const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const supported = /window\.files\s*=/.test(html) && html.includes('rust_core_single_bg.wasm');
      if (!supported) throw new Error('文件不是受支持的嘉立创 PCB 3D 模型 HTML。');
      const id = randomUUID();
      const info = { id, name, bytes: file.size, sha256: digest(bytes), supported };
      uploads.set(id, {
        ...info,
        path: file.path,
        session: SESSIONS.get(req)!,
        created: Date.now(),
      });
      res.status(201).json(info);
    } catch (error) {
      await rm(file.path, { force: true });
      res.status(400).json({ error: error instanceof Error ? error.message : '文件读取失败。' });
    }
  });
  app.post('/api/logo-assets', logoUpload.single('file'), async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: '请选择 LOGO 文件。' });
      return;
    }
    try {
      let input = req.file.buffer;
      if (isIco(input)) {
        const frames = await decodeIco(input, 'image/png');
        const largest = frames.sort((a, b) => b.width * b.height - a.width * a.height)[0];
        if (!largest) throw new Error('图标不含有效图像。');
        input = Buffer.from(largest.buffer);
      }
      const png = await sharp(input, {
        animated: false,
        limitInputPixels: LIMITS.logoPixels ** 2,
      })
        .rotate()
        .resize({
          width: LIMITS.logoPixels,
          height: LIMITS.logoPixels,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
      const id = randomUUID(),
        data = 'data:image/png;base64,' + png.toString('base64');
      assets.set(id, { id, data, session: SESSIONS.get(req)!, created: Date.now() });
      res.status(201).json({ assetId: id, preview: data });
    } catch {
      res.status(400).json({
        error: '无法读取此图片，请使用 PNG、JPEG、WebP、GIF、SVG、ICO 或其他受支持的静态图片。',
      });
    }
  });
  app.post('/api/conversions', async (req, res) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: '转换配置不完整或格式错误。' });
      return;
    }
    const { fileIds, options } = parsed.data,
      session = SESSIONS.get(req)!;
    if (new Set(fileIds).size !== fileIds.length) {
      res.status(400).json({ error: '文件 ID 重复。' });
      return;
    }
    const files = fileIds.map((id) => uploads.get(id));
    if (files.some((file) => !file || file.session !== session)) {
      res.status(404).json({ error: '上传文件已失效，请重新上传。' });
      return;
    }
    if (files.reduce((sum, file) => sum + file!.bytes, 0) > LIMITS.batchBytes) {
      res.status(413).json({ error: '本批文件总大小超过限制。' });
      return;
    }
    const logo = options.logo.kind === 'image' ? assets.get(options.logo.assetId) : undefined;
    if (options.logo.kind === 'image' && (!logo || logo.session !== session)) {
      res.status(400).json({ error: 'LOGO 图片已失效。' });
      return;
    }
    res.status(202).json(publicJob(await createJob(session, fileIds, options, logo?.data)));
  });
  app.get('/api/conversions/:id', (req, res) => {
    const job = jobs.get(String(req.params.id));
    if (!job || job.session !== SESSIONS.get(req)) {
      res.status(404).json({ error: '转换任务不存在或已过期。' });
      return;
    }
    res.json(publicJob(job));
  });
  app.delete('/api/conversions/:id', async (req, res) => {
    const job = jobs.get(String(req.params.id));
    if (!job || job.session !== SESSIONS.get(req)) {
      res.status(404).json({ error: '转换任务不存在。' });
      return;
    }
    await cancelJob(job);
    res.json(publicJob(job));
  });
  app.get('/api/conversions/:id/download', (req, res, next) => {
    const job = jobs.get(String(req.params.id));
    if (!job || job.session !== SESSIONS.get(req)) {
      res.status(404).json({ error: '结果已过期，请重新转换。' });
      return;
    }
    if (!job.downloadUrl) {
      res.status(409).json({ error: '转换结果尚未就绪。' });
      return;
    }
    const first = job.files.findIndex((f) => f.state === 'success');
    job.downloads++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        job.downloads--;
      }
    };
    res.once('close', release);
    res.download(
      job.archive ?? join(job.directory, `${first}.html`),
      job.archive ? '嘉立创文件转换结果.zip' : job.files[first].outputName,
      { dotfiles: 'allow' },
      (error) => {
        release();
        if (error && !res.headersSent) next(error);
      },
    );
  });
  app.get('/root-ca.cer', (_req, res) =>
    res.download(join(TLS_DIRECTORY, 'root-ca.cer'), 'JLCFConv根证书.cer'),
  );
  app.use(express.static(resolve('dist')));
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在。' }));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const inputError = error instanceof multer.MulterError || error instanceof SyntaxError;
    if (!inputError) console.error(error);
    res.status(inputError ? 400 : 500).json({
      error:
        error instanceof multer.MulterError
          ? '上传内容超过允许限制或字段错误。'
          : inputError
            ? '请求内容格式错误。'
            : '服务处理失败，请重试。',
    });
  });
  return app;
}
export async function prepareStorage() {
  await mkdir(join(DATA_ROOT, 'incoming'), { recursive: true });
}
export async function saveRuntimeInfo(info: unknown) {
  await mkdir(resolve('.runtime'), { recursive: true });
  await writeFile(resolve('.runtime/service.json'), JSON.stringify(info, null, 2), 'utf8');
}
