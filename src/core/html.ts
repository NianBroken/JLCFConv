import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { createHash } from 'node:crypto';

type Node = DefaultTreeAdapterMap['node'];
export type Element = DefaultTreeAdapterMap['element'];
/** HTML 容错树负责定位，原始字符串负责输出，避免改变内嵌模型字节。 */
export function inspectHtml(source: string) {
  const document = parse(source, { sourceCodeLocationInfo: true });
  const elements: Element[] = [];
  const visit = (node: Node) => {
    if ('tagName' in node) elements.push(node);
    if ('childNodes' in node) node.childNodes.forEach(visit);
  };
  visit(document);
  const scripts = elements
    .filter(
      (e) =>
        e.tagName === 'script' && e.sourceCodeLocation?.startTag && e.sourceCodeLocation?.endTag,
    )
    .map((element) => {
      const location = element.sourceCodeLocation!;
      const start = location.startTag!.endOffset,
        end = location.endTag!.startOffset;
      return { element, start, end, code: source.slice(start, end) };
    });
  return { document, elements, scripts };
}
export function digest(source: string | Buffer) {
  return createHash('sha256').update(source).digest('hex');
}
export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
/** script 原始文本中必须转义小于号，防止用户文字终止脚本标签。 */
export function scriptJson(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
