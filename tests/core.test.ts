/** 结构识别测试覆盖散列变化、事件清理、SVG 分段文案和独立开关。 */
import { describe, expect, test } from 'vitest';
import { transformUi, transformEngine } from '../src/core/javascript.js';
import { inspectHtml, escapeHtml } from '../src/core/html.js';
import { DEFAULT_OPTIONS, COMPANY, optionsSchema } from '../src/shared/config.js';
import { columns, tableWidth } from '../src/preview/columns.js';
import { distributeWidths } from '../src/preview/tables.js';

const FIXTURE = `var R=window.React,J=window.jsx;
var Pane=(0,R.forwardRef)((props,ref)=>{var target="layout-toggler-box_changed";return J("div",{className:target,children:props.children})});
function Application(){var state=R.useState({});console.error("离线焊接辅助工具数据错误",state);return J("div",{children:[J("a",{className:"open-editor_changed",onClick:()=>location.href="https://editor.example",children:"返回编辑器"}),J("div",{className:"matchingTools-header_changed",children:"顶部"}),J("ul",{className:"smt-preview-header-nav-bar_changed",children:"导出"}),J(Pane,{children:"内容"}),"立创商城元件名","嘉立创库类别","3D图供参考，具体以实物为准"]})}window.Application=Application;`;

describe('动态页面转换', () => {
  test('带 CSS 引号的百分号编码 SVG 分段提示完整替换', async () => {
    const svg =
      '<svg><text><tspan>预览视图</tspan><tspan>仅供参考，具体以实物为准</tspan></text></svg>';
    const input =
      FIXTURE +
      ';window.css=' +
      JSON.stringify('background:url("data:image/svg+xml,' + encodeURIComponent(svg) + '")') +
      ';';
    const output = await transformUi(input, DEFAULT_OPTIONS);
    expect(decodeURIComponent(output)).toContain(COMPANY);
    expect(decodeURIComponent(output)).not.toContain('以实物为准');
  });
  test('逗号形式的 JSX 工厂保持回调作用域', async () => {
    const extra =
      ';window.table=(0,J)("table",{children:(0,J)("colgroup",{children:[0,1,2,3,4,5,6].map(()=>null).concat([(0,J)("col",{width:w[0]}),(0,J)("col",{}),(0,J)("col",{}),(0,J)("col",{}),(0,J)("col",{}),(0,J)("col",{}),(0,J)("col",{})])})});';
    // 表格使用与生产样本相同的直接列节点。
    const source = extra
      .replace('[0,1,2,3,4,5,6].map(()=>null).concat([', '[')
      .replace('])})});', ']})});');
    const output = await transformUi(FIXTURE + source, DEFAULT_OPTIONS);
    expect(output).toContain('.map(column=>J("col",{width:column.width');
  });
  test('转义模板与带引号的 SVG 背景使用解码文字替换', async () => {
    const source =
      FIXTURE +
      ';window.background=`"data:image/svg+xml,%3Csvg%3E\\u9884\\u89c8\\u89c6\\u56fe仅供参考，具体以实物为准%3C/svg%3E"`;';
    const output = await transformUi(source, DEFAULT_OPTIONS);
    expect(output).toContain(COMPANY);
    expect(output).not.toContain('供参考');
    expect(output).not.toContain('以实物为准');
    const disabled = await transformUi(source, { ...DEFAULT_OPTIONS, optimizePage: false });
    expect(disabled).toContain('供参考');
  });
  test('手机标题只删除界面节点，不替换合法数据', async () => {
    const source =
      FIXTURE +
      ';window.phone=J("div",{className:`${styles.weld_phone_name_panel}`,children:"PCB3"});window.part="PCB3";';
    const output = await transformUi(source, DEFAULT_OPTIONS);
    expect(output).toContain('window.phone=null');
    expect(output).toContain('window.part="PCB3"');
  });
  test('显示选项的输入与标签保持同一组', async () => {
    const output = await transformUi(
      FIXTURE +
        ';window.radio=J("div",{className:`${styles.radioArea}`,children:[J("input",{type:"radio",onChange:handler}),J("label",{children:"选项"})]});',
      DEFAULT_OPTIONS,
    );
    expect(output).toContain('jlcf-display-option');
    expect(output).toContain('onChange:handler');
  });
  test('缺失值展示保留零值与真实参数', async () => {
    const output = await transformUi(
      FIXTURE +
        ';window.detail=function(data){return J("p",{className:`${style["coent-right"]}`,children:data.value||"null"})};',
      DEFAULT_OPTIONS,
    );
    expect(output).toContain('data.value??"未提供"');
  });
  test('跨资源片段删除专用样式并保留其他背景', async () => {
    const output = await transformUi(
      FIXTURE +
        ';window.sheet=(()=>{var pieces=[];pieces.push(".matchingTools-header_changed .icon{background:url(");pieces.push(JSON.stringify("https://private.example/icon.svg"));pieces.push(")}.kept{color:blue}");return pieces.join("")})();',
      DEFAULT_OPTIONS,
    );
    expect(output).not.toContain('private.example');
    expect(output).toContain('.kept{color:blue}');
  });
  test('Rust 线程预算使用设备能力且有明确上限', () => {
    const source =
      'async function initialize(){let count=navigator.hardwareConcurrency||4;console.log("[RustWasm]",count)}';
    const output = transformEngine(source, { manifest: [], content: new Map() });
    expect(output).toContain('Math.max(1,Math.min(4,navigator.hardwareConcurrency||1))');
  });
  test('手机品牌区域接入静态 LOGO', async () => {
    const source =
      FIXTURE +
      ';window.phone=J("div",{className:`${styles.weld_phone_icon}`,children:J("img",{src:"original.svg"})});';
    const result = await transformUi(source, DEFAULT_OPTIONS);
    expect(result).toContain('jlcf-logo-mobile');
    expect(result).not.toContain('original.svg');
  });
  test('以语义键识别 class 后缀并移除原 LOGO 导航', async () => {
    const output = await transformUi(FIXTURE, DEFAULT_OPTIONS);
    expect(output).toContain('window.__JLCFConv.settings.logo');
    expect(output).not.toContain('editor.example');
    expect(output).not.toContain('返回编辑器');
    expect(output).not.toContain('matchingTools-header_changed');
    expect(output).toContain('smt-preview-header-nav-bar_changed');
    expect(output).toContain('window.__JLCFConv.sidebar');
    expect(output).toContain('window.files||{}');
    expect(output).toContain(COMPANY);
    expect(output).not.toContain('立创商城元件名');
  });
  test('删除专用选择器时保留共享样式声明', async () => {
    const output = await transformUi(
      FIXTURE +
        ';window.css=".matchingTools-header_changed .nav-bar-item_changed,.nav-bar-header_kept{display:flex}.nav-bar-item_other{padding:8px}";',
      DEFAULT_OPTIONS,
    );
    expect(output).toContain('.nav-bar-header_kept{display:flex}');
    expect(output).not.toContain('.nav-bar-item_changed');
    expect(output).toContain('.nav-bar-item_other{padding:8px}');
  });
  test.each([
    [false, false],
    [true, false],
    [false, true],
  ])('独立开关 网页 %s 交互 %s', async (optimizePage, optimizeInteraction) => {
    const output = await transformUi(FIXTURE, {
      ...DEFAULT_OPTIONS,
      optimizePage,
      optimizeInteraction,
    });
    expect(output.includes('matchingTools-header_changed')).toBe(!optimizePage);
    expect(output.includes('window.__JLCFConv.sidebar')).toBe(optimizeInteraction);
    expect(output).toContain('window.__JLCFConv.settings.logo');
  });
  test('分段 SVG 文案统一替换', async () => {
    const svg =
      '<svg><text><tspan>3D</tspan><tspan>图仅供参考，具体以实物为准</tspan></text></svg>';
    const source =
      FIXTURE +
      `window.background="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}";`;
    const output = await transformUi(source, DEFAULT_OPTIONS);
    const encoded = output.match(/data:image\/svg\+xml;base64,([\w+/=]+)/)![1];
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe(
      `<svg><text>${COMPANY}</text></svg>`,
    );
  });
  test('必要结构不匹配时明确失败', async () => {
    await expect(transformUi('window.x=1', DEFAULT_OPTIONS)).rejects.toThrow('未匹配完整转换规则');
  });
});

describe('表格列的共享规则', () => {
  test('剩余宽度平均分配且窄容器不会压缩基础列宽', () => {
    expect(distributeWidths([100, 150, 200], 601)).toEqual([150, 200, 250]);
    expect(distributeWidths([100, 150, 200], 320)).toEqual([100, 150, 200]);
    expect(distributeWidths([], 900)).toEqual([]);
  });
  const widths = [110, 135, 155, 75, 120, 115, 125, 90];
  test('手机列按字段重排且不会套用被隐藏列的宽度', () => {
    const result = columns(widths, true, true);
    expect(result.map((column) => column.key)).toEqual([
      'checked',
      'dataT',
      'dataB',
      'dataEle',
      'dataId',
      'PCS',
      'package',
    ]);
    expect(result.map((column) => column.width)).toEqual([110, 135, 155, 120, 125, 90, 120]);
    expect(tableWidth(widths, true, true)).toBe(855);
    expect(widths).toEqual([110, 135, 155, 75, 120, 115, 125, 90]);
  });
  test('非聚合列与聚合列使用各自的字段规则', () => {
    expect(columns([], false, false).map((column) => column.key)).toEqual([
      'checked',
      'Designator',
      'layer',
      'value',
      'dataEle',
      'package',
      'componentCode',
    ]);
  });
});
describe('输入与内容保护基础', () => {
  test('非标准 HTML 保留脚本源位置', () => {
    const source =
      '<html><head></head><body><div/><script>window.files = {text:"中文<标记>"};</script></body>';
    const { scripts } = inspectHtml(source);
    expect(source.slice(scripts[0].start, scripts[0].end)).toBe(scripts[0].code);
  });
  test('标题与 LOGO 文本校验和转义', () => {
    expect(
      optionsSchema.safeParse({ ...DEFAULT_OPTIONS, logo: { kind: 'text', text: '' } }).success,
    ).toBe(false);
    expect(escapeHtml('<标题>&"')).toBe('&lt;标题&gt;&amp;&quot;');
  });
});
