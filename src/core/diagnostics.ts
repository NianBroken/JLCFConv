import * as t from '@babel/types';
import { traverse } from './ast.js';

const SUCCESS_NAMES = new Set([
  '添加env',
  'load gerber....',
  '清理缓存图元',
  '/worker/runBoolean',
  '/worker/runBoolean decode',
  '/worker/runBoolean start',
  'bool result',
  'bool encode',
]);
// 工作线程没有页面运行模块，摘要通过专用消息交给创建它的页面。
const RECORD =
  '(globalThis.__JLCFDiagnostics??={record:(name,...args)=>globalThis.postMessage({__jlcfDiagnostics:{name,time:performance.now(),args:args.map(value=>value!==null&&typeof value==="object"?{type:value.constructor?.name,length:value.length,byteLength:value.byteLength}:value)}})}).record';

/** 仅识别成功路径的具名诊断，真实告警和异常分支保持原有报告能力。 */
export function adaptDiagnostics(
  tree: t.File,
  source: string,
  edit: (node: t.Node, text: string) => void,
) {
  const text = (node: t.Node) => source.slice(node.start!, node.end!);
  traverse(tree, {
    CallExpression(path) {
      const node = path.node;
      if (
        !t.isMemberExpression(node.callee) ||
        !t.isIdentifier(node.callee.object, { name: 'console' }) ||
        !t.isIdentifier(node.callee.property, { name: 'warn' })
      )
        return;
      let name: t.Node | undefined = node.arguments[0];
      while (t.isBinaryExpression(name)) name = name.left;
      if (!t.isStringLiteral(name)) return;
      if (SUCCESS_NAMES.has(name.value) || name.value.startsWith('run into syncComponents2Engine'))
        edit(node.callee, RECORD);
    },
    NewExpression(path) {
      const node = path.node;
      if (t.isIdentifier(node.callee, { name: 'Worker' }))
        edit(
          node,
          `(globalThis.__JLCFConv?globalThis.__JLCFConv.createWorker(${node.arguments.map(text).join(',')}):${text(node)})`,
        );
    },
    ClassMethod(path) {
      const node = path.node;
      if (
        !t.isIdentifier(node.key, { name: 'updatePhys' }) ||
        !t.isIdentifier(node.params[0]) ||
        !t.isIdentifier(node.params[1])
      )
        return;
      const id = node.params[0].name,
        material = node.params[1].name;
      path.traverse({
        CallExpression(candidate) {
          const call = candidate.node;
          if (
            !t.isMemberExpression(call.callee) ||
            !t.isThisExpression(call.callee.object) ||
            !t.isIdentifier(call.callee.property, { name: 'setMaterial' })
          )
            return;
          // setMaterial 内第一个变量从材质注册表读取，注册表名称由绑定结构取得。
          const owner = path.parentPath;
          if (!owner.isClassBody()) return;
          const setter = owner.node.body.find(
            (member) =>
              t.isClassMethod(member) && t.isIdentifier(member.key, { name: 'setMaterial' }),
          );
          if (!setter || !t.isClassMethod(setter)) throw new Error('板层渲染材质接口无法识别。');
          let registry: string | undefined;
          t.traverseFast(setter.body, (part) => {
            if (
              !registry &&
              t.isVariableDeclarator(part) &&
              t.isMemberExpression(part.init) &&
              part.init.computed &&
              t.isIdentifier(part.init.object)
            )
              registry = part.init.object.name;
          });
          if (!registry) throw new Error('板层渲染材质注册表无法识别。');
          edit(
            call,
            `(${registry}[${material}]||["TOP_STIFFENER","BOTTOM_STIFFENER"].includes(this.layerIndex[${id}].config.typeConfig.type)?${text(call)}:(this.layerIndex[${id}].config.materialDescription=${material},${RECORD}("板层工艺描述",${id},${material})))`,
          );
        },
      });
    },
  });
}
