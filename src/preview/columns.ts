/** BOM 列的逻辑身份、顺序和尺寸由此处统一维护。 */
const AGGREGATE = [
  ['checked', 110],
  ['dataT', 120],
  ['dataB', 100],
  ['value', 105],
  ['dataEle', 95],
  ['package', 120],
  ['dataId', 80],
  ['PCS', 50],
] as const;
const INDIVIDUAL = [
  ['checked', 110],
  ['Designator', 100],
  ['layer', 75],
  ['value', 100],
  ['dataEle', 180],
  ['package', 180],
  ['componentCode', 145],
] as const;
const PHONE_ORDER = [0, 1, 2, 4, 6, 7, 5];

/** 表头和数据表按同一逻辑列计算宽度，手机隐藏与重排不改变字段身份。 */
export function columns(widths: number[], phone: boolean, aggregate: boolean) {
  const definition = aggregate ? AGGREGATE : INDIVIDUAL;
  const order = aggregate && phone ? PHONE_ORDER : definition.map((_, index) => index);
  return order.map((index) => ({
    key: definition[index][0],
    width: Math.max(definition[index][1], Number.isFinite(widths[index]) ? widths[index] : 0),
  }));
}

/** 两张表使用确定的同一总宽度，阻止内容驱动的独立列宽分配。 */
export function tableWidth(widths: number[], phone: boolean, aggregate: boolean) {
  return columns(widths, phone, aggregate).reduce((sum, column) => sum + column.width, 0);
}
