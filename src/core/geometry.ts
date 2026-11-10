/** 几何接入只位于模型管理器、解析回调和定位服务边界，不改变原始模型数据。 */
import * as t from '@babel/types';
import { traverse } from './ast.js';

export function adaptGeometry(
  tree: t.File,
  source: string,
  edit: (node: t.Node, text: string) => void,
) {
  const text = (node: t.Node) => source.slice(node.start!, node.end!);
  let modelCallbacks = 0;
  let focusServices = 0;
  traverse(tree, {
    ClassMethod(path) {
      const node = path.node;
      if (!t.isIdentifier(node.key, { name: 'onModel' })) return;
      const body = text(node.body);
      if (
        !body.includes('this.componentsWithoutAnything.push(') ||
        !body.includes('this.modelManager.prepare3dModel(')
      )
        return;
      if (node.params.length !== 4 || !node.params.every((p) => t.isIdentifier(p)))
        throw new Error('元器件几何解析回调无法识别。');
      edit(
        { start: node.body.start! + 1, end: node.body.start! + 1 } as t.Node,
        `window.__JLCFConv.geometry.register(${node.params.map((p) => text(p)).join(',')});`,
      );
      modelCallbacks++;
    },
    CallExpression(path) {
      const node = path.node;
      if (
        !t.isMemberExpression(node.callee) ||
        !t.isIdentifier(node.callee.property, { name: 'rpcService' }) ||
        !t.isStringLiteral(node.arguments[0], { value: '/engine/model/focus' })
      )
        return;
      const handler = node.arguments[1];
      if (!t.isArrowFunctionExpression(handler) || !t.isIdentifier(handler.params[0]))
        throw new Error('引擎定位服务无法识别。');
      edit(handler.body, `{return window.__JLCFConv.geometry.focus(...${handler.params[0].name})}`);
      focusServices++;
    },
  });
  if (source.includes('/engine/model/focus') && (modelCallbacks !== 1 || focusServices !== 1))
    throw new Error('引擎的元器件位置解析与定位服务未完整匹配。');
}
