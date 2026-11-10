import * as t from '@babel/types';
import { traverse } from './ast.js';
import MagicString from 'magic-string';

const SELECTION = 'window.__JLCFConv.selection';
const TOPICS = new Set([
  '/engine/leftClick',
  '/engine/model/update/param',
  '/engine/camera/changeDirect',
  '/engine/camera/changeChecked',
  '/engine/mouse/moved',
]);
type Edit = (node: t.Node, text: string) => void;

/** 从结构节点提取语义成员，打包变量名和声明顺序不参与适配判断。 */
function memberObject(node: t.Node, name: string) {
  let object: t.Expression | undefined;
  t.traverseFast(node, (part) => {
    if (
      !object &&
      t.isMemberExpression(part) &&
      t.isIdentifier(part.property, { name }) &&
      t.isExpression(part.object)
    )
      object = part.object;
  });
  return object;
}
function namedProperty(node: t.ObjectExpression, name: string) {
  return node.properties.find(
    (part): part is t.ObjectProperty =>
      t.isObjectProperty(part) && t.isIdentifier(part.key, { name }),
  );
}
function methodName(node: t.Node) {
  const target = t.isSequenceExpression(node) ? node.expressions.at(-1) : node;
  return t.isMemberExpression(target) && t.isIdentifier(target.property)
    ? target.property.name
    : '';
}

/** 选择入口、订阅生命周期和表格身份在源代码层接入同一个运行模块。 */
export function adaptInteractions(tree: t.File, source: string, edit: Edit, optimizePage: boolean) {
  const text = (node: t.Node) => source.slice(node.start!, node.end!);
  adaptTableControllers(tree, source, edit);
  const wrappers = new Map<string, { topic: string; bus: string }>();
  traverse(tree, {
    FunctionDeclaration(path) {
      if (!path.node.id || path.node.end! - path.node.start! > 1500) return;
      path.traverse({
        CallExpression(candidate) {
          const call = candidate.node;
          if (!t.isStringLiteral(call.arguments[0]) || !t.isMemberExpression(call.callee)) return;
          if (methodName(call.callee) === 'subscribe' && TOPICS.has(call.arguments[0].value))
            wrappers.set(path.node.id!.name, {
              topic: call.arguments[0].value,
              bus: text(call.callee.object),
            });
        },
      });
    },
  });
  let connected = 0;
  traverse(tree, {
    CallExpression(path) {
      const call = path.node;
      if (methodName(call.callee) === 'useEffect' && t.isFunction(call.arguments[0])) {
        const callback = call.arguments[0];
        if (!t.isBlockStatement(callback.body)) return;
        const subscriptions: t.CallExpression[] = [];
        t.traverseFast(callback.body, (part) => {
          if (
            t.isCallExpression(part) &&
            t.isIdentifier(part.callee) &&
            wrappers.has(part.callee.name)
          )
            subscriptions.push(part);
        });
        const pick = subscriptions.find(
          (part) => wrappers.get((part.callee as t.Identifier).name)?.topic === '/engine/leftClick',
        );
        if (pick && t.isFunction(pick.arguments[0])) {
          for (const topic of TOPICS) {
            if (topic === '/engine/mouse/moved') continue;
            if (
              !subscriptions.some(
                (part) => wrappers.get((part.callee as t.Identifier).name)?.topic === topic,
              )
            )
              throw new Error(`必要交互订阅无法识别：${topic}`);
          }
          const handler = pick.arguments[0];
          const context = memberObject(handler, 'uniqueIdIndex');
          const toggleCall = (() => {
            let found: t.CallExpression | undefined;
            t.traverseFast(handler, (part) => {
              if (
                !found &&
                t.isCallExpression(part) &&
                part.arguments.length >= 3 &&
                t.isIdentifier(part.arguments[1]) &&
                context &&
                text(part.arguments[1]) === text(context)
              )
                found = part;
            });
            return found;
          })();
          if (!context || !toggleCall || !t.isExpression(toggleCall.arguments[2]))
            throw new Error('模型选择上下文无法识别。');
          const ctx = text(context),
            view = text(toggleCall.arguments[2]);
          const bus = wrappers.get((pick.callee as t.Identifier).name)!.bus;
          const calls = subscriptions
            .filter(
              (part) =>
                !(
                  optimizePage &&
                  wrappers.get((part.callee as t.Identifier).name)!.topic === '/engine/mouse/moved'
                ),
            )
            .map((part) => {
              if (part === pick)
                return `${text(part.callee)}(id=>${SELECTION}.fromModel(${ctx},id))`;
              if (wrappers.get((part.callee as t.Identifier).name)!.topic !== '/engine/mouse/moved')
                return text(part);
              const guarded = new MagicString(text(part));
              const coordinateAliases = new Set<string>();
              t.traverseFast(part, (node) => {
                if (
                  t.isVariableDeclarator(node) &&
                  t.isIdentifier(node.id) &&
                  t.isCallExpression(node.init) &&
                  t.isMemberExpression(node.init.callee) &&
                  t.isIdentifier(node.init.callee.property, { name: 'getElementById' }) &&
                  t.isStringLiteral(node.init.arguments[0]) &&
                  ['canvasX', 'canvasY'].includes(node.init.arguments[0].value)
                )
                  coordinateAliases.add(node.id.name);
              });
              // 坐标元素只在对应视图挂载时存在，未挂载期间没有文字显示目标。
              t.traverseFast(part, (node) => {
                if (!t.isAssignmentExpression(node) || !t.isMemberExpression(node.left)) return;
                const target = node.left.object;
                if (t.isIdentifier(target) && coordinateAliases.has(target.name)) {
                  guarded.overwrite(
                    node.start! - part.start!,
                    node.end! - part.start!,
                    `${target.name}&&(${text(node)})`,
                  );
                  return;
                }
                if (
                  !t.isCallExpression(target) ||
                  !t.isMemberExpression(target.callee) ||
                  !t.isIdentifier(target.callee.property, { name: 'getElementById' }) ||
                  !t.isStringLiteral(target.arguments[0]) ||
                  !['canvasX', 'canvasY'].includes(target.arguments[0].value)
                )
                  return;
                guarded.overwrite(
                  node.start! - part.start!,
                  node.end! - part.start!,
                  `((element)=>element&&(element.${text(node.left.property)}=${text(node.right)}))(${text(target)})`,
                );
              });
              return guarded.toString();
            });
          edit(
            callback.body,
            `{${SELECTION}.attach(${ctx},${bus},${view});const subscriptions=[${calls.join(',')}];return()=>{subscriptions.forEach(token=>token?.cancel());${SELECTION}.detach(${ctx})}}`,
          );
          connected++;
          path.skip();
          return;
        }
        // 表格定位由选择序号及实际行身份驱动，连续选择相同 ID 仍会执行。
        const ctx = memberObject(callback, 'engineLeftClickId');
        if (ctx && text(callback).includes('querySelectorAll("tr")')) {
          edit(callback.body, `{${SELECTION}.reveal(${text(ctx)})}`);
          if (t.isArrayExpression(call.arguments[1]))
            edit(call.arguments[1], `[${text(ctx)}.selectionRevision]`);
          path.skip();
          return;
        }
      }
      // JSX 行与位号携带真实 ID，事件的业务对象不通过可见文本推断。
      const props = call.arguments[1];
      if (!t.isObjectExpression(props)) return;
      const tag = call.arguments[0];
      if (t.isStringLiteral(tag, { value: 'tr' })) {
        const render = path.getFunctionParent();
        if (
          !render ||
          !t.isIdentifier(render.node.params[0]) ||
          !render.parentPath.isCallExpression() ||
          methodName(render.parentPath.node.callee) !== 'map'
        )
          return;
        const context = memberObject(props, 'languageData');
        const group = memberObject(props, 'dataT');
        const item = memberObject(props, 'Designator');
        const rowName = render.node.params[0].name;
        if (
          !context ||
          (!t.isIdentifier(group, { name: rowName }) && !t.isIdentifier(item, { name: rowName }))
        )
          return;
        const ids = group ? `${SELECTION}.members(${text(group)})` : `[${text(item!)}.UniqueID]`;
        edit(
          { start: props.start! + 1, end: props.start! + 1 } as t.Node,
          `"data-jlcf-ids":JSON.stringify(${ids}),`,
        );
        const click = namedProperty(props, 'onClick')?.value;
        if (t.isFunction(click) && t.isIdentifier(click.params[0])) {
          const event = click.params[0].name;
          t.traverseFast(click, (part) => {
            if (
              t.isCallExpression(part) &&
              t.isIdentifier(part.callee, { name: 'setTimeout' }) &&
              t.isFunction(part.arguments[0]) &&
              t.isExpression(part.arguments[1])
            )
              edit(
                part,
                `${SELECTION}.deferTable(${text(context)},${text(part.arguments[0])},${text(part.arguments[1])},${event})`,
              );
          });
        }
        const style = namedProperty(props, 'style');
        if (style && t.isObjectExpression(style.value)) {
          const background = namedProperty(style.value, 'backgroundColor');
          if (background)
            edit(background.value, `${ids}.some(id=>${text(context)}.ids[id])?"#e6f7ff":""`);
        }
      }
      if (
        namedProperty(props, 'clickDesignator') &&
        namedProperty(props, 'doubleClickDesignator')
      ) {
        const data = namedProperty(props, 'data')?.value;
        if (
          t.isMemberExpression(data) &&
          t.isIdentifier(data.property) &&
          ['dataT', 'dataB'].includes(data.property.name)
        )
          edit(
            { start: props.start! + 1, end: props.start! + 1 } as t.Node,
            `uniqueIDs:${text(data.object)}.${data.property.name === 'dataT' ? 'topUniqueIDs' : 'bottomUniqueIDs'},`,
          );
      }
      if (!t.isStringLiteral(tag, { value: 'span' })) return;
      const parentMap = path.findParent(
        (parent) =>
          parent.isCallExpression() &&
          t.isMemberExpression(parent.node.callee) &&
          t.isIdentifier(parent.node.callee.property, { name: 'map' }),
      );
      if (!parentMap?.isCallExpression() || !t.isMemberExpression(parentMap.node.callee)) return;
      const mapping = parentMap.node.arguments[0];
      if (!t.isFunction(mapping) || !t.isIdentifier(mapping.params[1])) return;
      const children = namedProperty(props, 'children')?.value;
      if (!children || !t.isIdentifier(mapping.params[0])) return;
      const name = mapping.params[0].name;
      const showsName =
        t.isIdentifier(children, { name }) ||
        (t.isConditionalExpression(children) && t.isIdentifier(children.alternate, { name }));
      if (!showsName) return;
      const owner = parentMap.getFunctionParent();
      if (!owner) return;
      const list = parentMap.node.callee.object;
      let id: string | undefined;
      let context = memberObject(props, 'ids') ?? memberObject(owner.node, 'languageData');
      if (
        t.isMemberExpression(list) &&
        t.isMemberExpression(list.object) &&
        t.isIdentifier(list.object.property) &&
        ['dataT', 'dataB'].includes(list.object.property.name)
      )
        id = `${text(list.object.object)}.${list.object.property.name === 'dataT' ? 'topUniqueIDs' : 'bottomUniqueIDs'}.filter(Boolean)[${mapping.params[1].name}]`;
      else if (
        namedProperty(props, 'onDoubleClick') &&
        text(owner.node).includes('selectedItem') &&
        t.isIdentifier(owner.node.params[0])
      )
        id = `${owner.node.params[0].name}.uniqueIDs.filter(Boolean)[${mapping.params[1].name}]`;
      if (id && context)
        edit(
          { start: props.end! - 1, end: props.end! - 1 } as t.Node,
          `,...${SELECTION}.componentProps(${text(context)},${id})`,
        );
    },
    Function(path) {
      const node = path.node;
      const body = text(node.body);
      if (!t.isBlockStatement(node.body)) return;
      if (t.isFunctionDeclaration(node) && node.id && wrappers.has(node.id.name)) {
        const statement = node.body.body[0];
        if (t.isExpressionStatement(statement) && t.isCallExpression(statement.expression))
          edit(statement, `return ${text(statement.expression)};`);
        return;
      }
      const returned = node.body.body.find((statement) => t.isReturnStatement(statement));
      const contract =
        t.isReturnStatement(returned) && t.isObjectExpression(returned.argument)
          ? returned.argument
          : undefined;
      if (
        contract &&
        (namedProperty(contract, 'hoverCurrentTr') ||
          namedProperty(contract, 'judgeComponentIsClick'))
      ) {
        const [view, context] = node.params;
        if (!t.isIdentifier(view) || !t.isIdentifier(context))
          throw new Error('表格选择接口无法识别。');
        let flip: string | undefined;
        t.traverseFast(node.body, (part) => {
          if (
            t.isCallExpression(part) &&
            t.isIdentifier(part.callee) &&
            t.isIdentifier(part.arguments[0], { name: view.name }) &&
            t.isIdentifier(part.arguments[1], { name: context.name }) &&
            t.isStringLiteral(part.arguments[2], { value: 'bottom' })
          )
            flip = part.callee.name;
        });
        if (!flip) throw new Error('表格顶底面切换接口无法识别。');
        edit(
          node.body,
          `{return ${SELECTION}.aggregate(${view.name},${context.name},{flip:side=>${flip}(${view.name},${context.name},side)})}`,
        );
        path.skip();
        return;
      }
      if (node.params.length === 1 && t.isIdentifier(node.params[0])) {
        const parameter = node.params[0].name;
        let context: t.Expression | undefined;
        path.traverse({
          Function(child) {
            child.skip();
          },
          AssignmentExpression(child) {
            const assignment = child.node;
            if (
              t.isIdentifier(assignment.right, { name: parameter }) &&
              t.isMemberExpression(assignment.left) &&
              t.isIdentifier(assignment.left.property, { name: 'lastFocusArr' }) &&
              t.isExpression(assignment.left.object)
            )
              context = assignment.left.object;
          },
        });
        if (context) {
          edit(
            node.body,
            `{${SELECTION}.table(${text(context)},${node.params[0].name}.filter(Boolean))}`,
          );
          path.skip();
          return;
        }
      }
      if (
        body.length < 1200 &&
        body.includes('Customer_Component_Name:') &&
        body.includes('useMemo') &&
        body.includes('edaWeldingToolsDataArr') &&
        !body.includes('jsx')
      ) {
        const ctx = memberObject(node.body, 'edaWeldingToolsDataArr');
        const first = node.body.body[0];
        if (ctx && t.isVariableDeclaration(first)) {
          edit(node.body, `{${text(first)}return ${SELECTION}.individualRows(${text(ctx)})}`);
          path.skip();
        }
      }
      if (
        t.isFunctionDeclaration(node) &&
        body.includes('rpcCall("/engine/draw/clear"') &&
        body.includes('rpcCall("/engine/draw/polyline"')
      ) {
        const bus = (() => {
          let found: t.Expression | undefined;
          t.traverseFast(node.body, (part) => {
            if (
              t.isCallExpression(part) &&
              t.isMemberExpression(part.callee) &&
              t.isExpression(part.callee.object) &&
              t.isStringLiteral(part.arguments[0], { value: '/engine/draw/clear' })
            )
              found = part.callee.object;
          });
          return found;
        })();
        if (bus)
          edit(
            node.body,
            `{window.__JLCFConv.drawing.request(${text(bus)},[${node.params.map((param) => text(t.isAssignmentPattern(param) ? param.left : param)).join(',')}])}`,
          );
        path.skip();
      }
    },
    AwaitExpression(path) {
      const call = path.node.argument;
      if (
        t.isCallExpression(call) &&
        t.isStringLiteral(call.arguments[0], { value: '/engine/init' })
      )
        edit(
          path.node,
          `await window.__JLCFConv.drawing.initialize(async()=>{window.__JLCFConv.geometry.clear();const result=await ${text(call)};window.__JLCFConv.geometry.initialize();return result})`,
        );
    },
  });
  return connected;
}

/** 表格控制器通过数据属性与搜索输入识别，编译变量名不参与模式和身份判断。 */
function adaptTableControllers(tree: t.File, source: string, edit: Edit) {
  const text = (node: t.Node) => source.slice(node.start!, node.end!);
  traverse(tree, {
    Function(path) {
      const node = path.node;
      if (!t.isBlockStatement(node.body)) return;
      const patterns = [
        ...node.params,
        ...node.body.body.flatMap((statement) =>
          t.isVariableDeclaration(statement) ? statement.declarations.map((item) => item.id) : [],
        ),
      ].filter(t.isObjectPattern);
      const propertyNames = patterns.flatMap((pattern) =>
        pattern.properties.flatMap((property) =>
          t.isObjectProperty(property) && t.isIdentifier(property.key) ? [property.key.name] : [],
        ),
      );
      const mode = propertyNames.includes('edaWeldingToolsData')
        ? 'aggregate'
        : propertyNames.includes('noAggregationData')
          ? 'individual'
          : undefined;
      if (!mode || !propertyNames.includes('handleCheckAll')) return;
      const context = memberObject(node.body, 'languageData');
      const returned = node.body.body.find((statement) => t.isReturnStatement(statement));
      let input: t.Expression | undefined;
      let effect: t.Expression | undefined;
      path.traverse({
        CallExpression(candidate) {
          const call = candidate.node;
          if (methodName(call.callee) === 'useEffect' && t.isExpression(call.callee))
            effect ??= call.callee;
          if (!t.isStringLiteral(call.arguments[0], { value: 'input' })) return;
          const props = call.arguments[1];
          if (!t.isObjectExpression(props) || !namedProperty(props, 'onChange')) return;
          const type = namedProperty(props, 'type')?.value;
          const ref = namedProperty(props, 'ref')?.value;
          if (t.isStringLiteral(type, { value: 'text' }) && t.isExpression(ref)) input = ref;
        },
      });
      let clear: t.Identifier | undefined;
      if (input) {
        const target = `${text(input)}.current.value`;
        path.traverse({
          VariableDeclarator(candidate) {
            if (!t.isIdentifier(candidate.node.id) || !t.isFunction(candidate.node.init)) return;
            t.traverseFast(candidate.node.init, (part) => {
              if (
                t.isAssignmentExpression(part) &&
                text(part.left) === target &&
                t.isStringLiteral(part.right, { value: '' })
              )
                clear = candidate.node.id as t.Identifier;
            });
          },
        });
      }
      if (!context || !effect || !input || !clear || !returned?.argument)
        throw new Error('表格模式与搜索清除接口未完整匹配。');
      const ctx = text(context);
      edit(
        { start: returned.argument.start!, end: returned.argument.start! } as t.Node,
        `(${text(effect)}(()=>${SELECTION}.registerTable(${ctx},{mode:${JSON.stringify(mode)},search:()=>${text(input)}.current?.value??"",clearSearch:()=>${clear.name}()})),`,
      );
      edit({ start: returned.argument.end!, end: returned.argument.end! } as t.Node, ')');
      if (mode === 'aggregate') {
        path.traverse({
          CallExpression(candidate) {
            const call = candidate.node;
            if (!t.isMemberExpression(call.callee) || methodName(call.callee) !== 'sort') return;
            const list = call.callee.object;
            if (
              !t.isMemberExpression(list) ||
              !t.isNumericLiteral(list.property, { value: 0 }) ||
              !t.isMemberExpression(list.object) ||
              !list.object.computed ||
              !t.isExpression(list.object.property) ||
              !t.isExpression(call.arguments[0])
            )
              return;
            edit(
              call,
              `${SELECTION}.sortMembers(${ctx},${text(list.object.object)},${text(list.object.property)},${text(call.arguments[0])})`,
            );
          },
        });
      }
    },
  });
}
