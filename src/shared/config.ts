import { z } from 'zod';

/** 项目标识与业务默认值只在本模块定义，前后端共同使用。 */
export const PROJECT = {
  name: '嘉立创文件转换',
  englishName: 'JLCFConv',
  author: 'NianBroken',
  github: 'https://github.com/NianBroken/JLCFConv',
} as const;
export const OUTPUT_PREFIX = '中山勤奋光电';
export const DEFAULT_LOGO = '中山勤奋光电PCB模型预览';
export const COMPANY = '中山市勤奋光电科技有限公司';
export const LIMITS = {
  fileBytes: 128 * 1024 ** 2,
  batchBytes: 1024 ** 3,
  files: 32,
  logoBytes: 8 * 1024 ** 2,
  logoPixels: 4096,
  retentionMs: 60 * 60 * 1000,
  timeoutMs: 300_000,
} as const;
export const optionsSchema = z.object({
  logo: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('text'), text: z.string().trim().min(1).max(500) }),
    z.object({ kind: z.literal('image'), assetId: z.string().uuid() }),
  ]),
  title: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('filename') }),
    z.object({ kind: z.literal('text'), text: z.string().trim().min(1).max(500) }),
  ]),
  optimizePage: z.boolean(),
  optimizeInteraction: z.boolean(),
});
export type ConversionOptions = z.infer<typeof optionsSchema>;
export const DEFAULT_OPTIONS: ConversionOptions = {
  logo: { kind: 'text', text: DEFAULT_LOGO },
  title: { kind: 'filename' },
  optimizePage: true,
  optimizeInteraction: true,
};
export type FileState = 'queued' | 'processing' | 'success' | 'failed' | 'cancelled';
export interface ConversionReport {
  adapter: string;
  changes: string[];
  protectedHashes: string[];
  inputHash: string;
  outputHash: string;
  resources: number;
}
export interface UploadInfo {
  id: string;
  name: string;
  bytes: number;
  sha256: string;
  supported: boolean;
}
export interface FileResult {
  id: string;
  name: string;
  outputName: string;
  state: FileState;
  error?: string;
  report?: ConversionReport;
}
export interface JobInfo {
  id: string;
  state: FileState | 'partial';
  progress: number;
  files: FileResult[];
  downloadUrl?: string;
  previewUrls?: string[];
  expiresAt: number;
}
