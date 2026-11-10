/** 工具栏保留模型操作，桌面与手机共用按功能键精简的配置。 */
import * as t from '@babel/types';
import { traverse } from './ast.js';
const REMOVED_KEYS = new Set(['driver', 'export-bom', 'screen-shot', 'export-3d']);

export function adaptToolbar(
  tree: t.File,
  source: string,
  edit: (node: t.Node, text: string) => void,
) {
  const text = (node: t.Node) => source.slice(node.start!, node.end!);
  const has = (node: t.Node, name: string) => {
    let found = false;
    t.traverseFast(node, (part) => {
      if (t.isStringLiteral(part) && (part.value === name || part.value.startsWith(name + '_')))
        found = true;
      if (t.isIdentifier(part, { name })) found = true;
    });
    return found;
  };
  traverse(tree, {
    ObjectExpression(path) {
      const properties = path.node.properties;
      const name = (property: t.ObjectExpression['properties'][number]) =>
        t.isObjectProperty(property)
          ? t.isIdentifier(property.key)
            ? property.key.name
            : t.isStringLiteral(property.key)
              ? property.key.value
              : ''
          : '';
      if (
        !properties.some((p) => name(p) === 'reverse') ||
        !properties.some((p) => REMOVED_KEYS.has(name(p)))
      )
        return;
      edit(
        path.node,
        `{${properties
          .filter((p) => !REMOVED_KEYS.has(name(p)))
          .map(text)
          .join(',')}}`,
      );
    },
    CallExpression(path) {
      const props = path.node.arguments[1];
      if (
        !t.isStringLiteral(path.node.arguments[0], { value: 'ul' }) ||
        !t.isObjectExpression(props)
      )
        return;
      const className = props.properties.find(
        (item) => t.isObjectProperty(item) && t.isIdentifier(item.key, { name: 'className' }),
      );
      if (!t.isObjectProperty(className) || !has(className.value, 'smt-preview-header-nav-bar'))
        return;
      const owner = path.getFunctionParent();
      if (!owner) return;
      const toolbar = text(path.node);
      owner.traverse({
        CallExpression(candidate) {
          const attributes = candidate.node.arguments[1];
          if (!t.isObjectExpression(attributes)) return;
          const style = attributes.properties.find(
            (item) => t.isObjectProperty(item) && t.isIdentifier(item.key, { name: 'className' }),
          );
          const children = attributes.properties.find(
            (item) => t.isObjectProperty(item) && t.isIdentifier(item.key, { name: 'children' }),
          );
          if (
            !t.isObjectProperty(style) ||
            !t.isObjectProperty(children) ||
            !t.isArrayExpression(children.value)
          )
            return;
          if (has(style.value, 'radioArea_column'))
            edit(
              { start: children.value.end! - 1, end: children.value.end! - 1 } as t.Node,
              ',' + toolbar,
            );
          if (!has(style.value, 'smt-preview-header-wrap')) return;
          const modals: t.LogicalExpression[] = [];
          t.traverseFast(children.value, (part) => {
            if (
              t.isLogicalExpression(part) &&
              t.isCallExpression(part.right) &&
              t.isObjectExpression(part.right.arguments[1]) &&
              part.right.arguments[1].properties.some(
                (item) =>
                  t.isObjectProperty(item) && t.isIdentifier(item.key, { name: 'closeModalCb' }),
              )
            )
              modals.push(part);
          });
          for (const modal of modals) edit(modal, 'null');
        },
      });
    },
  });
}
