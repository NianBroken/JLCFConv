import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import MagicString from 'magic-string';
import { inspectHtml, digest, escapeHtml, scriptJson } from './html.js';
import { transformUi, transformEngine, validateStyles } from './javascript.js';
import { loadResources } from './resources.js';
import { logoStyles, pageStyles, interactionStyles } from '../preview/runtime.js';
import {
  OUTPUT_PREFIX,
  COMPANY,
  type ConversionOptions,
  type ConversionReport,
} from '../shared/config.js';

export interface ConvertInput {
  html: string;
  filename: string;
  options: ConversionOptions;
  logoData?: string;
}
/** 单份转换的纯内容接口，不接触用户源文件路径。 */
export async function convertHtml(input: ConvertInput) {
  const { html, filename, options } = input;
  const parsed = inspectHtml(html);
  const payloads = parsed.scripts.filter((s) => /^\s*window\.files\s*=/.test(s.code));
  const ui = parsed.scripts.find(
    (s) =>
      s.code.includes('离线焊接辅助工具数据错误') ||
      s.code.includes('\\u79BB\\u7EBF\\u710A\\u63A5'),
  );
  const engine = parsed.scripts.find((s) => s.code.includes('rust_core_single_bg.wasm'));
  if (!payloads.length || !ui || !engine)
    throw new Error('文件不是受支持的嘉立创 PCB 3D 模型 HTML。');
  const protectedHashes = payloads.map((s) => digest(s.code));
  const resources = await loadResources();
  const runtimeCode = await readFile(resolve('dist-server/preview-runtime.js'), 'utf8');
  const scrollbarStyles = await readFile(resolve('dist-server/preview-runtime.css'), 'utf8');
  const title = options.title.kind === 'filename' ? filename : options.title.text;
  const worker = resources.manifest.find((r) => r.url.endsWith('/workerHelpers.js'))!;
  const settings = {
    logo: options.logo.kind === 'text' ? options.logo : { kind: 'image', data: input.logoData },
    title,
    optimizePage: options.optimizePage,
    optimizeInteraction: options.optimizeInteraction,
    worker: resources.content.get(worker.url)!.toString('utf8'),
  };
  if (options.logo.kind === 'image' && !input.logoData)
    throw new Error('LOGO 图片已失效，请重新上传。');
  const edits = new MagicString(html);
  const titleElement = parsed.elements.find(
    (e) => e.tagName === 'title' && e.parentNode?.nodeName === 'head',
  );
  if (titleElement?.sourceCodeLocation)
    edits.overwrite(
      titleElement.sourceCodeLocation.startOffset,
      titleElement.sourceCodeLocation.endOffset,
      `<title>${escapeHtml(title)}</title>`,
    );
  else
    edits.appendLeft(
      parsed.elements.find((e) => e.tagName === 'head')?.sourceCodeLocation?.startTag?.endOffset ??
        0,
      `<title>${escapeHtml(title)}</title>`,
    );
  edits.overwrite(ui.start, ui.end, await transformUi(ui.code, options));
  edits.overwrite(engine.start, engine.end, transformEngine(engine.code, resources));
  // 字体所在的 UI 脚本单独替换资源地址，避免触碰受保护数据。
  let result = edits.toString();
  const prepared = inspectHtml(result);
  const runtimeStart = prepared.scripts.find(
    (s) => s.code.includes('rust_core_single_bg.wasm') || s.code.includes('data:application/wasm'),
  )!.element.sourceCodeLocation!.startOffset;
  const finish = new MagicString(result);
  const actualUi = prepared.scripts.find((s) =>
    s.code.includes('window.__JLCFConv.settings.logo'),
  )!;
  let uiWithFonts = actualUi.code;
  for (const resource of resources.manifest.filter((r) => r.mime.startsWith('font/')))
    uiWithFonts = uiWithFonts.replaceAll(
      resource.url,
      `data:${resource.mime};base64,${resources.content.get(resource.url)!.toString('base64')}`,
    );
  finish.overwrite(actualUi.start, actualUi.end, uiWithFonts);
  const styles = validateStyles(
    scrollbarStyles +
      logoStyles +
      (options.optimizePage ? pageStyles : '') +
      (options.optimizeInteraction ? interactionStyles : ''),
  );
  finish.appendLeft(
    runtimeStart,
    `<script>${runtimeCode.replace(/<\/script/gi, '<\\/script')}\nJLCFPreview.installRuntime(${scriptJson(settings)});</script><style id="jlcfconv-styles">${styles}</style>`,
  );
  result = finish.toString();
  const outputParsed = inspectHtml(result);
  const actualHashes = outputParsed.scripts
    .filter((s) => /^\s*window\.files\s*=/.test(s.code))
    .map((s) => digest(s.code));
  if (JSON.stringify(actualHashes) !== JSON.stringify(protectedHashes))
    throw new Error('模型数据完整性检查失败，文件未输出。');
  const report: ConversionReport = {
    adapter: '嘉立创离线 PCB 语义适配器',
    changes: [
      '静态 LOGO，无跳转事件',
      `网站标题：${title}`,
      '引擎、字体与线程资源内嵌',
      '离线初始化与元件查询逻辑',
      '统一悬浮滚动条，轨道不占布局空间',
      ...(options.optimizePage
        ? ['页面头部与目标导航清理', '参数字段名称替换', `提示文案：${COMPANY}`, '窄屏头部自动排版']
        : []),
      ...(options.optimizeInteraction ? ['侧栏 Pointer Events 与独立触控热区'] : []),
    ],
    protectedHashes,
    inputHash: digest(html),
    outputHash: digest(result),
    resources: resources.manifest.length,
  };
  return { filename: OUTPUT_PREFIX + filename, html: result, report };
}
