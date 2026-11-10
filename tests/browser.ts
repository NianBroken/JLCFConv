/** Windows 浏览器从设备级安装目录发现，其他平台使用 Playwright 的浏览器通道。 */
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

export async function launchBrowser(channel = 'chrome') {
  const suffix =
    channel === 'msedge'
      ? ['Microsoft', 'Edge', 'Application', 'msedge.exe']
      : ['Google', 'Chrome', 'Application', 'chrome.exe'];
  for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
    const executablePath = join(root!, ...suffix);
    const exists = await access(executablePath).then(
      () => true,
      () => false,
    );
    if (exists) return chromium.launch({ executablePath });
  }
  return chromium.launch({ channel });
}
