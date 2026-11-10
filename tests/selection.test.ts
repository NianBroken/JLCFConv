/** 选择范围、稳定身份和生命周期独立于画布渲染验证，真实拾取由浏览器回归覆盖。 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { parse } from '@babel/parser';
import MagicString from 'magic-string';
import { createSelection, type SelectionContext } from '../src/preview/selection.js';
import { adaptInteractions } from '../src/core/interactions.js';

function fixture() {
  const group = {
    topUniqueIDs: ['a', 'b', 'c'],
    bottomUniqueIDs: ['d'],
    dataT: [['C111', 'C109', 'C109']] as [string[]],
    dataB: [['R1']] as [string[]],
    value: '真实参数',
    dataEle: ['', '器件'],
    package: ['', '封装'],
    dataId: ['', '编号'],
    checked: false,
  };
  const context: SelectionContext = {
    ids: {},
    engineLeftClickId: '-1',
    netlistSelectedId: '-1',
    render: vi.fn(),
    uniqueIdIndex: Object.fromEntries(
      [
        ['a', 'C111'],
        ['b', 'C109'],
        ['c', 'C109'],
        ['d', 'R1'],
        ['e', 'U12'],
      ].map(([id, name]) => [
        id,
        { UniqueID: id, Designator: name, Layer: id === 'd' ? 'B' : 'T' },
      ]),
    ),
    edaWeldingToolsDataArr: [group],
  };
  const report = vi.fn();
  return { group, context, report, selection: createSelection(report) };
}
beforeEach(() => {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('统一选择状态', () => {
  test('聚合入口选择完整顶底层组，活动 ID 保留实际点击成员', () => {
    const { context, selection } = fixture();
    selection.commit(context, ['b']);
    expect(Object.keys(context.ids)).toEqual(['a', 'b', 'c', 'd']);
    expect(context.engineLeftClickId).toBe('b');
    expect(context.netlistSelectedId).toBe('b');
  });
  test('非聚合选择单个对象，视图切换保留选择而后续点击遵循当前模式', () => {
    const { context, selection } = fixture();
    selection.commit(context, ['a']);
    selection.registerTable(context, { mode: 'individual', search: () => '', clearSearch() {} });
    expect(Object.keys(context.ids)).toHaveLength(4);
    selection.fromModel(context, 'b');
    expect(Object.keys(context.ids)).toEqual(['b']);
    selection.table(context, ['c']);
    expect(Object.keys(context.ids)).toEqual(['c']);
  });
  test('重复选择独立提交定位序号，空白清空两个主标识与集合', () => {
    const { context, selection } = fixture();
    selection.fromModel(context, 'e');
    selection.fromModel(context, 'e');
    expect(context.selectionRevision).toBe(2);
    selection.fromModel(context, '-1');
    expect(context.ids).toEqual({});
    expect(context.engineLeftClickId).toBe('-1');
    expect(context.netlistSelectedId).toBe('-1');
    expect(context.render).toHaveBeenCalledTimes(3);
  });
  test('整组多选添加与取消使用相同范围且成员不重复', () => {
    const { context, selection } = fixture();
    selection.commit(context, ['e']);
    selection.commit(context, ['b'], true);
    expect(Object.keys(context.ids)).toEqual(['e', 'a', 'b', 'c', 'd']);
    selection.commit(context, ['c'], true);
    expect(Object.keys(context.ids)).toEqual(['e']);
  });
  test('未知身份被明确拒绝，已有选择不被错误映射覆盖', () => {
    const { context, selection, report } = fixture();
    selection.commit(context, ['e']);
    expect(selection.commit(context, ['missing'])).toBe(false);
    expect(Object.keys(context.ids)).toEqual(['e']);
    expect(report).toHaveBeenCalledTimes(1);
  });
  test('焦点离开画布后文档按键释放与窗口失焦均清除多选状态', () => {
    const documentTarget = Object.assign(new EventTarget(), { body: {}, hidden: false });
    const windowTarget = new EventTarget();
    class Observer {
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('document', documentTarget);
    vi.stubGlobal('window', windowTarget);
    vi.stubGlobal('MutationObserver', Observer);
    vi.stubGlobal('ResizeObserver', Observer);
    const { context, selection } = fixture();
    selection.attach(
      context,
      { rpcCall: async () => ({ message: true }) },
      { currentCamera: 'default', cameras: { default: { isFront: true } } },
    );
    documentTarget.dispatchEvent(
      Object.assign(new Event('keydown'), { ctrlKey: true, metaKey: false }),
    );
    expect(context.multiSelect).toBe(true);
    documentTarget.dispatchEvent(
      Object.assign(new Event('keyup'), { ctrlKey: false, metaKey: false }),
    );
    expect(context.multiSelect).toBe(false);
    context.multiSelect = true;
    windowTarget.dispatchEvent(new Event('blur'));
    expect(context.multiSelect).toBe(false);
    selection.dispose();
  });
  test('旧控制器清理不会解除当前控制器，当前控制器卸载后不残留模式', () => {
    const { context, selection } = fixture();
    const old = selection.registerTable(context, {
      mode: 'aggregate',
      search: () => '',
      clearSearch() {},
    });
    const current = selection.registerTable(context, {
      mode: 'individual',
      search: () => '',
      clearSearch() {},
    });
    old();
    expect(selection.expand(context, ['a'])).toEqual(['a']);
    current();
    expect(selection.expand(context, ['a'])).toEqual(['a', 'b', 'c', 'd']);
  });
  test('排序携带完整记录，重复位号不串换物理 ID', () => {
    const { context, selection, group } = fixture();
    selection.sortMembers(context, group, 'dataT', (a, b) => a.localeCompare(b));
    expect(group.topUniqueIDs).toEqual(['b', 'c', 'a']);
    expect(group.dataT[0]).toEqual(['C109', 'C109', 'C111']);
    selection.sortMembers(context, group, 'dataT', (a, b) => b.localeCompare(a));
    expect(group.topUniqueIDs).toEqual(['a', 'b', 'c']);
    expect(group.dataT[0]).toEqual(['C111', 'C109', 'C109']);
    expect(context.uniqueIdIndex.a.Designator).toBe('C111');
  });
  test('模型选择使尚未提交的表格单击失效，快速点击只提交最新请求', () => {
    vi.useFakeTimers();
    const { context, selection } = fixture();
    const event = {
      target: {
        isConnected: true,
        closest: (selector: string) =>
          selector.startsWith('tr') ? { dataset: { jlcfIds: '["e"]' } } : null,
      } as unknown as Element,
    };
    const callback = vi.fn();
    selection.deferTable(context, callback, 300, event);
    selection.fromModel(context, 'a');
    vi.runAllTimers();
    expect(callback).not.toHaveBeenCalled();
    const older = vi.fn();
    selection.deferTable(context, older, 300, event);
    selection.deferTable(context, callback, 300, event);
    vi.runAllTimers();
    expect(older).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe('编译脚本的结构适配', () => {
  test.each([true, false])('网页优化 %s 时必要订阅各保留一次且逐项取消', (optimizePage) => {
    const topics = [
      '/engine/leftClick',
      '/engine/model/update/param',
      '/engine/camera/changeDirect',
      '/engine/camera/changeChecked',
      '/engine/mouse/moved',
    ];
    const wrappers = topics
      .map(
        (topic, index) =>
          `function hook${index}(callback){bus.subscribe(${JSON.stringify(topic)},callback)}`,
      )
      .join('');
    const source =
      wrappers +
      `function Component(){React.useEffect(()=>{hook0(id=>{const item=ctx.uniqueIdIndex[id];toggle(id,ctx,view)});hook1(()=>{});hook2(()=>{});hook3(()=>{});hook4(position=>{const x=document.getElementById("canvasX");x.innerText=position.x;document.getElementById("canvasY").innerText=position.y})},[])}`;
    const output = new MagicString(source);
    adaptInteractions(
      parse(source),
      source,
      (node, value) => {
        if (node.start === node.end) output.appendLeft(node.start!, value);
        else output.overwrite(node.start!, node.end!, value);
      },
      optimizePage,
    );
    const cancel = vi.fn(),
      subscribe = vi.fn(() => ({ cancel }));
    const selection = { attach: vi.fn(), detach: vi.fn(), fromModel: vi.fn() };
    const context = {};
    let cleanup: () => void;
    const Component = new Function(
      'React',
      'bus',
      'ctx',
      'view',
      'window',
      output.toString() + ';return Component',
    )(
      {
        useEffect: (callback: () => () => void) => {
          cleanup = callback();
        },
      },
      { subscribe },
      context,
      {},
      { __JLCFConv: { selection } },
    );
    Component();
    expect(subscribe.mock.calls.map((call) => (call as unknown[])[0])).toEqual(
      optimizePage ? topics.slice(0, 4) : topics,
    );
    cleanup!();
    expect(cancel).toHaveBeenCalledTimes(optimizePage ? 4 : 5);
    expect(selection.attach).toHaveBeenCalledTimes(1);
    expect(selection.detach).toHaveBeenCalledWith(context);
  });
  test.each(['aggregate', 'individual'])('变量重命名后的 %s 搜索接口按结构接入', (mode) => {
    const dataKey = mode === 'aggregate' ? 'edaWeldingToolsData' : 'noAggregationData';
    const source = `function Controller({${dataKey}:renamed,handleCheckAll:check}){let state=React.useContext(Context),field=React.useRef(null);const reset=()=>{field.current.value="";search()};function search(){}return React.useEffect(()=>search(),[]),jsx("input",{type:"text",ref:field,onChange:search,placeholder:state.languageData[1]})}`;
    const edits = new MagicString(source);
    adaptInteractions(
      parse(source),
      source,
      (node, value) => {
        if (node.start === node.end) edits.appendLeft(node.start!, value);
        else edits.overwrite(node.start!, node.end!, value);
      },
      true,
    );
    const output = edits.toString();
    expect(output).toContain(`mode:"${mode}"`);
    expect(output).toContain('clearSearch:()=>reset()');
    expect(output).toContain('search:()=>field.current?.value??""');
    expect(() => parse(output)).not.toThrow();
  });
});
