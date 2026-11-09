/** 服务端限制从环境读取，前端通过 capabilities 接口取得同一份有效值。 */
import { LIMITS as DEFAULT_LIMITS } from '../shared/config.js';
import { join } from 'node:path';
export const TLS_DIRECTORY =
  process.env.JLCF_TLS_DIR ?? join(process.env.ProgramData ?? 'C:/ProgramData', 'JLCFConv/tls');
function positive(name: string, fallback: number) {
  const text = process.env[name];
  if (!text) return fallback;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`环境配置 ${name} 必须是正整数。`);
  return value;
}
export const LIMITS = {
  fileBytes: positive('JLCF_MAX_FILE_BYTES', DEFAULT_LIMITS.fileBytes),
  batchBytes: positive('JLCF_MAX_BATCH_BYTES', DEFAULT_LIMITS.batchBytes),
  files: positive('JLCF_MAX_FILES', DEFAULT_LIMITS.files),
  logoBytes: positive('JLCF_MAX_LOGO_BYTES', DEFAULT_LIMITS.logoBytes),
  logoPixels: positive('JLCF_MAX_LOGO_PIXELS', DEFAULT_LIMITS.logoPixels),
  retentionMs: positive('JLCF_RETENTION_MS', DEFAULT_LIMITS.retentionMs),
  timeoutMs: positive('JLCF_TIMEOUT_MS', DEFAULT_LIMITS.timeoutMs),
};
