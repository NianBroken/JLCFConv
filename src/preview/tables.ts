/** 表格使用实际容器宽度分配空间，表头与数据通过相同基础列宽得到相同结果。 */
const TABLE_SELECTOR = 'table[data-jlcf-table]';
const TABLE_BORDER = 1;
const SIZE_TOLERANCE = 0.01;

/** 可用宽度不足时保留基础列宽，充足时将剩余宽度等量分配给每个可见列。 */
export function distributeWidths(widths: number[], available: number) {
  const total = widths.reduce((sum, width) => sum + width, 0);
  const extra = widths.length ? Math.max(0, available - TABLE_BORDER - total) / widths.length : 0;
  return widths.map((width) => width + extra);
}

/** 尺寸观察和列属性观察仅处理表格骨架，不逐行遍历 BOM 数据。 */
export function manageTables() {
  const instances = new Map<
    HTMLTableElement,
    { parent: HTMLElement; observer: MutationObserver }
  >();
  let frame = 0;
  const update = () => {
    frame = 0;
    for (const [table, entry] of instances) {
      if (!table.isConnected) {
        entry.observer.disconnect();
        resize.unobserve(entry.parent);
        instances.delete(table);
        continue;
      }
      const cols = [...table.querySelectorAll<HTMLTableColElement>('colgroup col')];
      const bases = cols.map((col) => Number(col.getAttribute('width')) || 0);
      const style = getComputedStyle(entry.parent);
      const available =
        entry.parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (!available || !cols.length) continue;
      const widths = distributeWidths(bases, available);
      const total = widths.reduce((sum, width) => sum + width, 0) + TABLE_BORDER;
      const value = `${total}px`;
      if (
        !table.style.width.endsWith('px') ||
        Math.abs(parseFloat(table.style.width) - total) > SIZE_TOLERANCE
      )
        table.style.width = value;
      cols.forEach((col, index) => {
        const width = `${widths[index]}px`;
        if (
          !col.style.width.endsWith('px') ||
          Math.abs(parseFloat(col.style.width) - widths[index]) > SIZE_TOLERANCE
        )
          col.style.width = width;
      });
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const resize = new ResizeObserver(schedule);
  const attach = (table: HTMLTableElement) => {
    if (instances.has(table) || !table.parentElement) return;
    const observer = new MutationObserver(schedule);
    observer.observe(table, {
      attributes: true,
      attributeFilter: ['width', 'style'],
      subtree: true,
      childList: true,
    });
    instances.set(table, { parent: table.parentElement, observer });
    resize.observe(table.parentElement);
    schedule();
  };
  const discover = (node: HTMLElement) => {
    if (node.matches(TABLE_SELECTOR)) attach(node as HTMLTableElement);
    else if (!node.matches('td,th,tr,tbody,thead,col,colgroup'))
      node.querySelectorAll<HTMLTableElement>(TABLE_SELECTOR).forEach(attach);
  };
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) if (node instanceof HTMLElement) discover(node);
      if (mutation.removedNodes.length) schedule();
    }
  });
  discover(document.body);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    resize.disconnect();
    cancelAnimationFrame(frame);
    instances.forEach((entry) => entry.observer.disconnect());
    instances.clear();
  };
}
