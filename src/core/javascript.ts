import { parse } from '@babel/parser';
import traverseImport from '@babel/traverse';
import * as t from '@babel/types';
import MagicString from 'magic-string';
import postcss from 'postcss';
import { minify } from 'terser';
import { COMPANY, type ConversionOptions } from '../shared/config.js';
import { digest, scriptJson } from './html.js';
import type { ResourceBundle } from './resources.js';

const traverse =
  typeof traverseImport === 'function'
    ? traverseImport
    : (traverseImport as unknown as { default: typeof traverseImport }).default;
const cache = new Map<string, string>();
const RUST_MAX_THREADS = 4;
const PRIVATE_SELECTOR =
  /\.(?:matchingTools-header|smt-preview-header-nav-bar|smt-preview-header-nav-disabled|open-editor|driver)_/;
const TEXT_CHANGES = new Map([
  ['立创商城元件名', '元件名'],
  ['嘉立创库类别', '库类别'],
]);
const NOTICE = /(?:3D\s*图|预览视图|3D\s*视图)(?:仅)?供参考[，,\s]*具体以实物为准/g;
const ENGLISH_NOTICE =
  /(?:the\s*)?3d\s*(?:p?review|view)\s*(?:is\s*)?(?:only\s*)?for reference(?:\s*only)?/gi;
interface Edit {
  start: number;
  end: number;
  text: string;
}

/** SVG 内的分段文字作为一个显示标签处理，保留图像尺寸与背景。 */
function replaceNotice(value: string) {
  const replace = (text: string) => text.replace(NOTICE, COMPANY).replace(ENGLISH_NOTICE, COMPANY);
  if (!value.startsWith('data:image/svg+xml')) return replace(value);
  const comma = value.indexOf(',');
  const prefix = value.slice(0, comma + 1);
  const base64 = prefix.includes(';base64');
  const svg = base64
    ? Buffer.from(value.slice(comma + 1), 'base64').toString('utf8')
    : decodeURIComponent(value.slice(comma + 1));
  const transformed = svg.replace(
    /(<text\b[^>]*>)([\s\S]*?)(<\/text>)/gi,
    (whole, start, content, end) => {
      const visible = content.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
      return replace(visible).includes(COMPANY) ? `${start}${COMPANY}${end}` : whole;
    },
  );
  return transformed === svg
    ? value
    : prefix +
        (base64 ? Buffer.from(transformed).toString('base64') : encodeURIComponent(transformed));
}

/** 修改区间先去除被整段替换覆盖的子项，再统一交给 MagicString。 */
function applyEdits(source: string, edits: Edit[]) {
  const ordered = edits.sort((a, b) => a.start - b.start || b.end - a.end);
  const selected: Edit[] = [];
  for (const edit of ordered) {
    const previous = selected.at(-1);
    if (previous && edit.start < previous.end) {
      if (edit.end <= previous.end) continue;
      throw new Error('转换规则产生交叠区间，文件未输出。');
    }
    selected.push(edit);
  }
  const result = new MagicString(source);
  for (const edit of selected) result.overwrite(edit.start, edit.end, edit.text);
  return result.toString();
}
function nodeText(source: string, node: t.Node) {
  return source.slice(node.start!, node.end!);
}
function hasSemantic(node: t.Node, value: string) {
  let found = false;
  t.traverseFast(node, (child) => {
    if (
      t.isMemberExpression(child) &&
      !child.computed &&
      t.isIdentifier(child.property, { name: value })
    )
      found = true;
    if (
      t.isStringLiteral(child) &&
      child.value.split(/\s+/).some((token) => token === value || token.startsWith(value + '_'))
    )
      found = true;
  });
  return found;
}

/** 使用组件属性识别动态界面，不依赖打包后的变量名称或 class 散列。 */
export async function transformUi(source: string, options: ConversionOptions) {
  const key = `ui:${digest(source)}:${options.optimizePage}:${options.optimizeInteraction}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const tree = parse(source, { sourceType: 'script' });
  const edits: Edit[] = [];
  const processedStyles = new Set<t.Node>();
  let logos = 0,
    headers = 0,
    navigations = 0,
    sidebars = 0,
    initializations = 0;
  const edit = (node: t.Node, text: string) =>
    edits.push({ start: node.start!, end: node.end!, text });
  traverse(tree, {
    CallExpression(path) {
      const node = path.node;
      // CSS 资源由连续 push 拼成完整样式，资源占位符使 URL 与所属规则一起清理。
      if (
        options.optimizePage &&
        t.isMemberExpression(node.callee) &&
        t.isIdentifier(node.callee.object) &&
        t.isIdentifier(node.callee.property, { name: 'push' }) &&
        node.arguments.some(
          (argument) => t.isStringLiteral(argument) && PRIVATE_SELECTOR.test(argument.value),
        )
      ) {
        const owner = path.getFunctionParent();
        const binding = path.scope.getBinding(node.callee.object.name);
        if (owner && binding && !processedStyles.has(binding.identifier)) {
          processedStyles.add(binding.identifier);
          const parts: t.CallExpression[] = [];
          owner.traverse({
            CallExpression(candidate) {
              const call = candidate.node;
              if (
                t.isMemberExpression(call.callee) &&
                t.isIdentifier(call.callee.object, { name: binding.identifier.name }) &&
                t.isIdentifier(call.callee.property, { name: 'push' }) &&
                candidate.scope.getBinding(binding.identifier.name) === binding
              )
                parts.push(call);
            },
          });
          if (
            parts.length &&
            parts.every((part) => part.arguments.length === 1 && t.isExpression(part.arguments[0]))
          ) {
            const resources: string[] = [];
            const css = parts
              .map((part) => {
                const argument = part.arguments[0];
                if (t.isStringLiteral(argument)) return replaceNotice(argument.value);
                resources.push(nodeText(source, argument));
                return `JLCF_RESOURCE_${resources.length - 1}_END`;
              })
              .join('');
            const sheet = postcss.parse(css);
            sheet.walkRules((rule) => {
              const retained = rule.selectors.filter(
                (selector) => !PRIVATE_SELECTOR.test(selector),
              );
              if (!retained.length) rule.remove();
              else rule.selectors = retained;
            });
            const fragments = sheet.toString().split(/JLCF_RESOURCE_(\d+)_END/g);
            const expression = fragments
              .map((fragment, index) =>
                index % 2 ? `(${resources[Number(fragment)]})` : scriptJson(fragment),
              )
              .join('+');
            edit(parts[0], `${binding.identifier.name}.push(${expression})`);
            parts.slice(1).forEach((part) => edit(part, 'void 0'));
          }
        }
      }
      const callback = node.arguments[0];
      const owner = path.getFunctionParent();
      if (t.isFunction(callback) && owner && hasSemantic(owner.node, 'open-editor')) {
        const body = nodeText(source, callback);
        if (
          /window\.addEventListener\("mouseup"/.test(body) &&
          /window\.removeEventListener\("mouseup"/.test(body)
        ) {
          // 原编辑器按钮的鼠标状态订阅仅服务于该按钮的按压外观。
          edit(node, 'void 0');
          return;
        }
      }
      // 坐标显示属于被删除的头部，相关事件注册与其界面一并移除。
      if (
        options.optimizePage &&
        node.arguments.some(
          (argument) =>
            t.isFunction(argument) &&
            hasSemantic(argument, 'canvasX') &&
            hasSemantic(argument, 'canvasY'),
        )
      ) {
        edit(node, 'void 0');
        return;
      }
      const props = node.arguments[1];
      if (t.isObjectExpression(props)) {
        const className = props.properties.find(
          (p) => t.isObjectProperty(p) && t.isIdentifier(p.key, { name: 'className' }),
        );
        if (className && t.isObjectProperty(className)) {
          if (
            hasSemantic(className.value, 'open-editor') ||
            hasSemantic(className.value, 'weld_phone_icon')
          ) {
            const jsx = nodeText(source, node.callee);
            const mobile = hasSemantic(className.value, 'weld_phone_icon');
            edit(
              node,
              `(${jsx})("div",{className:"jlcf-logo${mobile ? ' jlcf-logo-mobile' : ''}",children:window.__JLCFConv.settings.logo.kind==="image"?(${jsx})("img",{src:window.__JLCFConv.settings.logo.data,alt:"LOGO",draggable:false}):window.__JLCFConv.settings.logo.text})`,
            );
            logos++;
          }
          if (options.optimizePage && hasSemantic(className.value, 'matchingTools-header')) {
            edit(node, 'null');
            headers++;
          }
          if (options.optimizePage && hasSemantic(className.value, 'smt-preview-header-nav-bar')) {
            edit(node, 'null');
            navigations++;
          }
        }
      }
      if (options.optimizeInteraction && t.isSequenceExpression(node.callee)) {
        const member = node.callee.expressions.at(-1);
        const callback = node.arguments[0];
        if (
          t.isMemberExpression(member) &&
          t.isIdentifier(member.property, { name: 'forwardRef' }) &&
          t.isFunction(callback) &&
          hasSemantic(callback, 'layout-toggler-box')
        ) {
          edit(
            callback,
            `(props,ref)=>window.__JLCFConv.sidebar(${nodeText(source, member.object)},props,ref)`,
          );
          sidebars++;
        }
      }
      if (
        (t.isMemberExpression(node.callee) &&
          t.isIdentifier(node.callee.property, { name: 'useState' })) ||
        (t.isSequenceExpression(node.callee) &&
          node.callee.expressions.some(
            (p) => t.isMemberExpression(p) && t.isIdentifier(p.property, { name: 'useState' }),
          ))
      ) {
        const fn = path.getFunctionParent();
        if (
          fn &&
          hasSemantic(fn.node, '离线焊接辅助工具数据错误') &&
          t.isObjectExpression(node.arguments[0]) &&
          node.arguments[0].properties.length === 0
        ) {
          edit(node.arguments[0], 'window.files||{}');
          initializations++;
        }
      }
    },
    StringLiteral(path) {
      const node = path.node;
      if (options.optimizePage) {
        let value = TEXT_CHANGES.get(node.value) ?? replaceNotice(node.value);
        if (
          /\.(?:matchingTools-header|smt-preview-header-nav-bar|open-editor|driver)_/.test(value)
        ) {
          value = value.replace(/([^{}]+)\{([^{}]*)\}/g, (whole, selectors, declarations) => {
            const rule = postcss.parse(selectors + '{' + declarations + '}').first;
            if (!rule || rule.type !== 'rule') return whole;
            const retained = rule.selectors.filter(
              (selector) =>
                !/\.(?:matchingTools-header|smt-preview-header-nav-bar|open-editor|driver)_/.test(
                  selector,
                ),
            );
            if (retained.length === rule.selectors.length) return whole;
            if (!retained.length) return '';
            rule.selectors = retained;
            return rule.toString();
          });
        }
        if (value !== node.value) edit(node, scriptJson(value));
      }
      // 缺失编号保持为空，禁止将虚构商城编号写入组件运行数据。
      if (
        node.value === '1234' &&
        t.isAssignmentExpression(path.parent) &&
        nodeText(source, path.parent.left).endsWith('.Code')
      )
        edit(node, '""');
    },
    TemplateElement(path) {
      if (!options.optimizePage) return;
      const value = path.node.value.raw.replace(NOTICE, COMPANY);
      if (value !== path.node.value.raw) edit(path.node, value);
    },
  });
  if (
    logos === 0 ||
    (options.optimizePage && (headers === 0 || navigations === 0)) ||
    (options.optimizeInteraction && sidebars === 0) ||
    initializations === 0
  )
    throw new Error('该 HTML 的动态界面结构未匹配完整转换规则。');
  let result = applyEdits(source, edits);
  // 局部组件移除后，仅压缩清理无引用声明，关闭所有会重写业务算法的压缩开关。
  const compressed = await minify(result, {
    compress: { defaults: false, unused: true, dead_code: true, side_effects: true, passes: 2 },
    mangle: false,
    format: { comments: /^!|@license|@preserve/ },
  });
  if (!compressed.code) throw new Error('界面脚本生成失败。');
  result = compressed.code;
  parse(result, { sourceType: 'script' });
  if (cache.size > 12) cache.clear();
  cache.set(key, result);
  return result;
}

/** 引擎资源入口和离线库查询独立处理，几何、材质与模型算法保持原样。 */
export function transformEngine(source: string, resources: ResourceBundle) {
  const key = `engine:${digest(source)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const required = source.match(/https:\/\/modules\.lceda\.cn\/[^\s"'<>\\`]+\.wasm/g) ?? [];
  if (required.some((url) => !resources.content.has(url)))
    throw new Error('该引擎版本的离线资源尚未准备，请使用对应样本执行 npm run resources。');
  const tree = parse(source, { sourceType: 'script' });
  const edits: Edit[] = [];
  const edit = (node: t.Node, text: string) =>
    edits.push({ start: node.start!, end: node.end!, text });
  traverse(tree, {
    StringLiteral(path) {
      const resource = resources.manifest.find((r) => r.url === path.node.value);
      if (resource)
        edit(
          path.node,
          scriptJson(
            `data:${resource.mime};base64,${resources.content.get(resource.url)!.toString('base64')}`,
          ),
        );
    },
    FunctionDeclaration(path) {
      const node = path.node,
        body = nodeText(source, node.body);
      // Rust 渲染线程池按设备能力分配，最多四个线程共享页面的处理预算。
      if (body.includes('[RustWasm]')) {
        path.traverse({
          LogicalExpression(candidate) {
            const expression = candidate.node;
            if (
              expression.operator === '||' &&
              t.isMemberExpression(expression.left) &&
              t.isIdentifier(expression.left.object, { name: 'navigator' }) &&
              t.isIdentifier(expression.left.property, { name: 'hardwareConcurrency' })
            )
              edit(
                expression,
                `Math.max(1,Math.min(${RUST_MAX_THREADS},navigator.hardwareConcurrency||1))`,
              );
          },
        });
      }
      if (body.includes('wasm_bindgen_worker_init') || body.includes('wasm_bindgen_worker_ready'))
        return;
      if (
        body.includes('importScripts(') &&
        body.includes('workerHelpers.js') &&
        body.includes('new Error')
      )
        edit(node.body, '{return window.__JLCFConv.workerUrl()}');
      if (
        body.includes('/api/products/getPackageUuidByCodes') ||
        body.includes('/api/components/searchByUuids')
      ) {
        const parameters = node.params.filter(t.isIdentifier).map((p) => p.name);
        const argument = parameters[0];
        if (!argument) throw new Error('离线库查询参数无法识别。');
        const lookup = body.includes('getPackageUuidByCodes')
          ? '__ENGING_CODE_PRELOAD__'
          : '__ENGING_OBJ_PACKGE_PRELOAD__';
        const original = body.slice(1, -1);
        edit(
          node.body,
          `{if(window['META-engine-offline']){const stored=window.${lookup}||{};const result=${argument}.filter(key=>Object.prototype.hasOwnProperty.call(stored,key)).map(key=>stored[key]);return Promise.resolve(new Response(JSON.stringify({success:true,result}),{headers:{'Content-Type':'application/json'}}));}${original}}`,
        );
      }
    },
  });
  const result = applyEdits(source, edits).replace(/\/\/# sourceMappingURL=[^\r\n]*$/m, '');
  cache.set(key, result);
  return result;
}

/** 样式使用 PostCSS 校验后注入，阻止无效适配规则进入下载文件。 */
export function validateStyles(source: string) {
  postcss.parse(source);
  return source;
}
