/** 元器件的物理身份来自 BOM 的 UniqueID，位号仅承担文字展示职责。 */
export interface ComponentData {
  UniqueID: string;
  Designator: string;
  Layer?: string;
  [key: string]: unknown;
}
export interface SelectionContext {
  ids: Record<string, boolean>;
  uniqueIdIndex: Record<string, ComponentData>;
  engineLeftClickId: string;
  netlistSelectedId: string;
  selectionRevision?: number;
  multiSelect?: boolean;
  lastFocusArr?: string[];
  edaWeldingToolsDataArr?: AggregateRow[];
  render(): void;
}
interface AggregateRow {
  topUniqueIDs: string[];
  bottomUniqueIDs: string[];
  value: unknown;
  dataEle: string[];
  package: string[];
  dataId: string[];
  checked: boolean;
  dataT?: [string[], ...unknown[]];
  dataB?: [string[], ...unknown[]];
}
interface TableController {
  mode: 'aggregate' | 'individual';
  search(): string;
  clearSearch(): void;
}
export interface MessageBus {
  rpcCall(topic: string, args: unknown): Promise<{ message: unknown }>;
}
interface CameraContext {
  currentCamera: string | number;
  cameras: Record<string | number, { isFront: boolean }> | { isFront: boolean }[];
}
interface SelectionGeometry {
  select(ids: string[], camera?: string | number): void;
}
interface TableActions {
  flip(side: string): void;
}
const EMPTY_ID = '-1';
const REVEAL_MARGIN = 8;
const ROW_SELECTOR = 'tr[data-jlcf-ids]';
const VIEWPORT_SELECTOR = '[class*="bom-table-MatchingTools_"],[class*="coordinate-container_"]';

/** 选择序号隔离异步高亮结果，原上下文 ids 是唯一选中集合。 */
export function createSelection(
  reportError: (error: unknown) => void,
  geometry?: SelectionGeometry,
) {
  let active: SelectionContext | undefined;
  let bus: MessageBus | undefined;
  let camera: CameraContext | undefined;
  let frame = 0;
  let pendingReveal = false;
  // 只有选择提交拥有清除搜索的权限，布局变化与用户筛选不产生该权限。
  let pendingSelectionReveal = false;
  let observer: MutationObserver | undefined;
  let sizeObserver: ResizeObserver | undefined;
  let observedViewport: HTMLElement | undefined;
  let status: HTMLElement | undefined;
  const highlightVersions = new Map<string, number>();
  const hoverIds = new Set<string>();
  const tables = new WeakMap<SelectionContext, TableController>();
  const pendingClicks = new Map<SelectionContext, ReturnType<typeof setTimeout>>();
  const groupIndices = new WeakMap<
    SelectionContext,
    { source: AggregateRow[]; index: Map<string, string[]> }
  >();
  /** 按键释放在文档级接收，焦点从画布移到表格后不会残留多选状态。 */
  const syncModifier = (event: KeyboardEvent | MouseEvent | TouchEvent) => {
    if (active) active.multiSelect = Boolean(event.ctrlKey || event.metaKey);
  };
  const resetModifier = () => {
    if (active) active.multiSelect = false;
  };
  const visibilityChanged = () => {
    if (document.hidden) resetModifier();
  };
  function removeInputListeners() {
    document.removeEventListener('keydown', syncModifier, true);
    document.removeEventListener('keyup', syncModifier, true);
    document.removeEventListener('pointerdown', syncModifier, true);
    document.removeEventListener('touchstart', syncModifier, true);
    document.removeEventListener('visibilitychange', visibilityChanged);
    window.removeEventListener('blur', resetModifier);
    resetModifier();
  }

  const members = (row: AggregateRow) =>
    [...row.topUniqueIDs, ...row.bottomUniqueIDs].filter(Boolean);
  const valid = (context: SelectionContext, id: string) =>
    typeof id === 'string' && Object.prototype.hasOwnProperty.call(context.uniqueIdIndex, id);

  /** 完整 BOM 是分组身份的来源，显示筛选和重复位号不参与组定义。 */
  function expand(context: SelectionContext, input: string[]) {
    if (tables.get(context)?.mode === 'individual') return [...new Set(input)];
    const source = context.edaWeldingToolsDataArr;
    if (!source) return [...new Set(input)];
    let cached = groupIndices.get(context);
    if (cached?.source !== source) {
      const index = new Map<string, string[]>();
      for (const row of source) {
        const ids = [...new Set(members(row))];
        for (const id of ids) index.set(id, ids);
      }
      cached = { source, index };
      groupIndices.set(context, cached);
    }
    return [...new Set(input.flatMap((id) => cached.index.get(id) ?? [id]))];
  }

  /** 位号和物理 ID 组成完整记录参与排序，重复位号仍保留独立的物理身份。 */
  function sortMembers(
    context: SelectionContext,
    row: AggregateRow,
    field: 'dataT' | 'dataB',
    compare: (left: string, right: string) => number,
  ) {
    const key = field === 'dataT' ? 'topUniqueIDs' : 'bottomUniqueIDs';
    const records = row[key].filter(Boolean).map((id) => {
      if (!valid(context, id)) throw new Error('位号排序包含不存在的元器件标识。');
      return { id, label: context.uniqueIdIndex[id].Designator };
    });
    records.sort((left, right) => compare(left.label, right.label));
    const labels = records.map((record) => record.label);
    row[key] = records.map((record) => record.id);
    if (row[field]) row[field]![0] = labels;
    return labels;
  }

  /** 每个模型的最新请求拥有独立版本，悬停离开和选择切换不会互相覆盖。 */
  function highlight(id: string, checked: boolean) {
    if (!bus || !active || !valid(active, id)) return;
    const connection = bus;
    const version = (highlightVersions.get(id) ?? 0) + 1;
    highlightVersions.set(id, version);
    void connection
      .rpcCall('/engine/model/canHighlight', [id])
      .then((result) => {
        if (highlightVersions.get(id) !== version || connection !== bus) return;
        if (result.message === true)
          return connection.rpcCall('/engine/model/setModelChecked', [id, checked]);
      })
      .catch(reportError);
  }

  function rowIds(element: Element | null): string[] {
    const row = element?.closest<HTMLElement>(ROW_SELECTOR);
    return row ? (JSON.parse(row.dataset.jlcfIds ?? '[]') as string[]) : [];
  }
  const independentControl = (element: Element | null) =>
    Boolean(element?.closest('input,button,a,select,textarea,[role="button"]'));
  function cancelClick(context: SelectionContext) {
    const timer = pendingClicks.get(context);
    if (timer !== undefined) clearTimeout(timer);
    pendingClicks.delete(context);
  }

  /** 单击等待保留原双击行为，后续选择和视图切换使旧单击失效。 */
  function deferTable(
    context: SelectionContext,
    callback: () => void,
    delay: number,
    event: { target: Element },
  ) {
    cancelClick(context);
    if (independentControl(event.target)) return;
    const revision = context.selectionRevision;
    const mode = tables.get(context)?.mode;
    const ids = rowIds(event.target).join('\0');
    const timer = setTimeout(() => {
      pendingClicks.delete(context);
      if (
        context.selectionRevision === revision &&
        tables.get(context)?.mode === mode &&
        event.target.isConnected &&
        rowIds(event.target).join('\0') === ids
      )
        callback();
    }, delay);
    pendingClicks.set(context, timer);
    return timer;
  }

  /** 仅在目标越出滚动视口时移动，固定表头和水平滚动位置分别计算。 */
  function revealRow(row: HTMLElement, target?: HTMLElement) {
    const viewport = row.closest<HTMLElement>(VIEWPORT_SELECTOR);
    if (!viewport || !row.getClientRects().length || !viewport.clientHeight) return false;
    const bounds = viewport.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    const header = viewport.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    const margin = Math.min(REVEAL_MARGIN, viewport.clientHeight / 4);
    const start = bounds.top + header + margin;
    const end = bounds.bottom - margin;
    if (rect.top < start) viewport.scrollTop += rect.top - start;
    else if (rect.bottom > end) viewport.scrollTop += Math.min(rect.top - start, rect.bottom - end);
    const cell = target?.getBoundingClientRect();
    if (cell) {
      if (cell.left < bounds.left) viewport.scrollLeft += cell.left - bounds.left;
      else if (cell.right > bounds.right && cell.width <= bounds.width)
        viewport.scrollLeft += cell.right - bounds.right;
    }
    return true;
  }

  /** DOM 标记反映当前选择，查找真实行 ID 不依赖列顺序或位号是否重复。 */
  function refresh() {
    frame = 0;
    const context = active;
    if (!context) return;
    const id = context.engineLeftClickId;
    const selected = new Set(Object.keys(context.ids).filter((key) => context.ids[key]));
    let target: HTMLElement | undefined;
    for (const row of document.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
      const ids = JSON.parse(row.dataset.jlcfIds ?? '[]') as string[];
      const checked = ids.some((key) => selected.has(key));
      row.dataset.jlcfSelected = String(checked);
      row.setAttribute('aria-selected', String(checked));
      if (ids.includes(id) && row.getClientRects().length) target = row;
    }
    let component: HTMLElement | undefined;
    for (const element of document.querySelectorAll<HTMLElement>('[data-jlcf-component]')) {
      const checked = selected.has(element.dataset.jlcfComponent!);
      element.dataset.jlcfSelected = String(checked);
      if (element.dataset.jlcfComponent === id && element.getClientRects().length)
        component = element;
    }
    if (id === EMPTY_ID) {
      pendingReveal = false;
      pendingSelectionReveal = false;
      status?.remove();
      status = undefined;
      return;
    }
    const viewport = document.querySelector<HTMLElement>(VIEWPORT_SELECTOR);
    if (viewport && viewport !== observedViewport) {
      sizeObserver?.disconnect();
      observedViewport = viewport;
      sizeObserver?.observe(viewport);
    }
    const panelHidden = !viewport?.getClientRects().length || !viewport.clientHeight;
    const hiddenByFilter = !target && !panelHidden;
    const controller = tables.get(context);
    if (pendingSelectionReveal && hiddenByFilter && controller?.search()) {
      // 原组件的清除入口同步输入文字、筛选状态和数据，React 提交后继续定位。
      controller.clearSearch();
      schedule();
      return;
    }
    if (hiddenByFilter && pendingSelectionReveal) {
      if (!status?.isConnected) {
        status = document.createElement('div');
        status.className = 'jlcf-selection-status';
        status.setAttribute('role', 'status');
        viewport?.before(status);
      }
      const name = context.uniqueIdIndex[id]?.Designator ?? id;
      const text = `已选中 ${name}，共 ${selected.size} 个元件，正在等待对应行显示`;
      if (status.textContent !== text) status.textContent = text;
    } else {
      status?.remove();
      status = undefined;
    }
    if (pendingReveal && target && revealRow(target, component)) {
      pendingReveal = false;
      pendingSelectionReveal = false;
    }
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(refresh);
  };

  /** 一次提交同步集合、活动标识及序号，再通知 React 和可见行定位。 */
  function commit(context: SelectionContext, input: string[], toggle = false) {
    cancelClick(context);
    if (input.some((id) => !valid(context, id))) {
      reportError(new Error('选择请求包含不存在的元器件标识。'));
      return false;
    }
    const ids = expand(context, input).filter((id) => valid(context, id));
    const before = new Set(Object.keys(context.ids).filter((id) => context.ids[id]));
    const after = toggle ? new Set(before) : new Set<string>();
    const remove = toggle && ids.every((id) => before.has(id));
    for (const id of ids) {
      if (remove) after.delete(id);
      else after.add(id);
    }
    for (const id of Object.keys(context.ids)) delete context.ids[id];
    for (const id of after) context.ids[id] = true;
    const current = input.find((id) => after.has(id)) ?? [...after].at(-1) ?? EMPTY_ID;
    context.engineLeftClickId = current;
    context.netlistSelectedId = current;
    context.selectionRevision = (context.selectionRevision ?? 0) + 1;
    for (const id of new Set([...before, ...hoverIds, ...(context.lastFocusArr ?? [])]))
      if (!after.has(id)) highlight(id, false);
    for (const id of after) if (!before.has(id)) highlight(id, true);
    hoverIds.clear();
    context.lastFocusArr = [];
    geometry?.select([...after], camera?.currentCamera);
    pendingReveal = current !== EMPTY_ID;
    pendingSelectionReveal = pendingReveal;
    context.render();
    // 同一 ID 的重复点击也独立提交定位，DOM 完成当前帧布局后读取行边界。
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(refresh);
    });
    return true;
  }

  function hover(ids: string[], entered: boolean) {
    for (const id of ids) {
      if (!active || active.ids[id] || !valid(active, id)) continue;
      if (entered) hoverIds.add(id);
      else hoverIds.delete(id);
      highlight(id, entered);
    }
  }
  function table(
    context: SelectionContext,
    ids: string[],
    event?: { ctrlKey?: boolean; metaKey?: boolean },
  ) {
    if (commit(context, ids, Boolean(event?.ctrlKey || event?.metaKey))) focusSelected(context);
  }

  /** 定位服务接收完整成员集合，有模型及真实封装位置共同参与联合范围。 */
  function focusSelected(context: SelectionContext) {
    const connection = bus;
    const view = camera;
    if (!connection || !view || active !== context) return;
    const revision = context.selectionRevision;
    const ids = Object.keys(context.ids).filter((id) => context.ids[id]);
    if (!ids.length) return;
    void Promise.resolve()
      .then(() => {
        if (connection !== bus || active !== context || context.selectionRevision !== revision)
          return;
        return connection.rpcCall('/engine/model/focus', [ids, view.currentCamera]);
      })
      .catch(reportError);
  }

  /** 聚合与非聚合表的事件接口保留原组件方法名，选择能力由同一入口提供。 */
  function aggregate(view: CameraContext, context: SelectionContext, actions: TableActions) {
    const idsFromEvent = (event: { target: Element }) => rowIds(event.target);
    const flip = (ids: string[]) => {
      const layers = new Set(ids.map((id) => context.uniqueIdIndex[id]?.Layer));
      if (layers.size === 1) actions.flip(layers.has('B') ? 'bottom' : 'top');
    };
    return {
      hoverCurrentTr: (
        event: { target: Element },
        _top: unknown,
        _bottom: unknown,
        enter: boolean,
      ) => hover(idsFromEvent(event), enter),
      clickCurrentTr: (event: { target: Element; ctrlKey?: boolean }) => {
        if (independentControl(event.target)) return;
        const ids = idsFromEvent(event);
        table(context, ids, event);
        flip(ids);
      },
      doubleClickCurrentTr: (event: { target: Element; ctrlKey?: boolean }) => {
        if (independentControl(event.target)) return;
        const ids = idsFromEvent(event);
        table(context, ids, event);
        flip(ids);
      },
      doubleClickXComponents: (ids: string[], side: string) => {
        table(context, ids.filter(Boolean));
        actions.flip(side);
      },
      changeTrBackgroundColor: (row: AggregateRow) =>
        members(row).some((id) => context.ids[id]) ? '#e6f7ff' : '',
      hover: (event: { target: Element }, _name: unknown, enter: boolean) =>
        hover(idsFromEvent(event), enter),
      clickDesignator: (event: { target: Element; ctrlKey?: boolean }) =>
        !independentControl(event.target) && table(context, idsFromEvent(event), event),
      doubleClickCurrentIndividualTr: (event: { target: Element; ctrlKey?: boolean }) => {
        if (independentControl(event.target)) return;
        table(context, idsFromEvent(event), event);
      },
      flipPcbBoard: (layer: string) => actions.flip(layer === 'B' ? 'bottom' : 'top'),
      judgeComponentIsClick: (id: string) => Boolean(context.ids[id]),
      camera: view.currentCamera,
    };
  }

  function componentProps(context: SelectionContext, id: string) {
    return {
      'data-jlcf-component': id,
      'data-jlcf-selected': String(Boolean(context.ids[id])),
      onClick: (event: { stopPropagation(): void; ctrlKey?: boolean }) => {
        event.stopPropagation();
        table(context, [id], event);
      },
      onDoubleClick: (event: { stopPropagation(): void }) => {
        event.stopPropagation();
        table(context, [id]);
      },
      onMouseOver: () => hover([id], true),
      onMouseLeave: () => hover([id], false),
    };
  }

  /** 非聚合数据保留原字段，物理 ID 从聚合成员列表逐项带入。 */
  function individualRows(context: SelectionContext) {
    return (context.edaWeldingToolsDataArr ?? []).flatMap((group) =>
      [...group.bottomUniqueIDs, ...group.topUniqueIDs].filter(Boolean).map((id) => ({
        UniqueID: id,
        Designator: context.uniqueIdIndex[id].Designator,
        Layer: context.uniqueIdIndex[id].Layer,
        Value: group.value,
        Customer_Component_Name: group.dataEle[1],
        Customer_Package: group.package[1],
        Customer_Component_Code: group.dataId[1],
        checked: group.checked,
      })),
    );
  }

  return {
    commit,
    table,
    aggregate,
    componentProps,
    individualRows,
    deferTable,
    sortMembers,
    members,
    expand,
    focusSelected,
    highlight,
    revealRow,
    /** 控制组件每次提交提供当前接口，卸载仅释放属于自身的注册。 */
    registerTable(context: SelectionContext, controller: TableController) {
      tables.set(context, controller);
      if (context.engineLeftClickId !== EMPTY_ID) pendingReveal = true;
      schedule();
      return () => {
        if (tables.get(context) === controller) tables.delete(context);
      };
    },
    fromModel(context: SelectionContext, id: string) {
      if (id === EMPTY_ID) commit(context, []);
      else commit(context, [id], Boolean(context.multiSelect));
    },
    attach(context: SelectionContext, connection: MessageBus, view: CameraContext) {
      removeInputListeners();
      active = context;
      bus = connection;
      camera = view;
      document.addEventListener('keydown', syncModifier, true);
      document.addEventListener('keyup', syncModifier, true);
      document.addEventListener('pointerdown', syncModifier, true);
      document.addEventListener('touchstart', syncModifier, true);
      document.addEventListener('visibilitychange', visibilityChanged);
      window.addEventListener('blur', resetModifier);
      observer?.disconnect();
      sizeObserver?.disconnect();
      observedViewport = undefined;
      sizeObserver = new ResizeObserver(() => {
        pendingReveal = context.engineLeftClickId !== EMPTY_ID;
        schedule();
      });
      observer = new MutationObserver((changes) => {
        // 搜索、排序和聚合切换会重建行，当前选择随实际行恢复可见性。
        if (
          changes.some((change) =>
            [...change.addedNodes, ...change.removedNodes].some(
              (node) =>
                node instanceof Element &&
                (node.matches(ROW_SELECTOR) || node.querySelector(ROW_SELECTOR)),
            ),
          )
        )
          pendingReveal = context.engineLeftClickId !== EMPTY_ID;
        schedule();
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-open', 'data-jlcf-ids'],
      });
      schedule();
    },
    reveal(context: SelectionContext) {
      if (context === active) {
        pendingReveal = true;
        schedule();
      }
    },
    detach(context: SelectionContext) {
      cancelClick(context);
      if (active !== context) return;
      removeInputListeners();
      observer?.disconnect();
      sizeObserver?.disconnect();
      observedViewport = undefined;
      cancelAnimationFrame(frame);
      frame = 0;
      active = undefined;
      bus = undefined;
      camera = undefined;
      pendingReveal = false;
      pendingSelectionReveal = false;
      highlightVersions.clear();
      hoverIds.clear();
      status?.remove();
    },
    dispose() {
      removeInputListeners();
      for (const context of pendingClicks.keys()) cancelClick(context);
      observer?.disconnect();
      sizeObserver?.disconnect();
      observedViewport = undefined;
      cancelAnimationFrame(frame);
      active = undefined;
      bus = undefined;
      camera = undefined;
      pendingReveal = false;
      pendingSelectionReveal = false;
      highlightVersions.clear();
      hoverIds.clear();
      status?.remove();
    },
  };
}

/** 选中标记与悬停独立，具体位号在聚合行内保持可辨认。 */
export const selectionStyles = `
tr[data-jlcf-selected="true"]{background-color:#e6f7ff!important}
[data-jlcf-component]{cursor:pointer;border-radius:3px}
[data-jlcf-component][data-jlcf-selected="true"]{background:#c5e8ff!important;color:#064e84!important;box-shadow:0 0 0 2px #c5e8ff}
.jlcf-selection-status{flex:none;padding:7px 10px;font:12px/1.5 system-ui,"Microsoft YaHei",sans-serif;color:#315675;background:#edf5fd;border-bottom:1px solid #dce8f4}
`;
