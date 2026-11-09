/**
 * 工具页面与下载页面共用的悬浮滚动条管理器。
 * 视口直接使用现有元素，内容节点及其 React 所有权保持不变。
 */
import { OverlayScrollbars, type OverlayScrollbars as ScrollbarInstance } from 'overlayscrollbars';

const SCROLLABLE = /(auto|scroll)/;
const EXCLUDED = 'table,thead,tbody,tr,td,th,canvas,svg,input,textarea';
const THEME = 'jlcf-scrollbar';

/** 仅接管实际允许滚动的容器，实例随对应元素的生命周期释放。 */
export function manageScrollbars(root: HTMLElement = document.body) {
  const instances = new Map<HTMLElement, ScrollbarInstance>();
  let frame = 0;
  const pending = new Set<HTMLElement>([root]);
  const attach = (element: HTMLElement) => {
    if (instances.has(element) || element.matches(EXCLUDED) || element.closest('.os-scrollbar'))
      return;
    const style = getComputedStyle(element);
    if (element !== document.body && !SCROLLABLE.test(style.overflowX + style.overflowY)) return;
    // 视口与目标相同，库不移动或包装业务子节点。
    const instance = OverlayScrollbars(
      { target: element, elements: { viewport: element } },
      {
        overflow: { x: 'scroll', y: 'scroll' },
        scrollbars: {
          theme: THEME,
          autoHide: 'never',
          visibility: 'auto',
          dragScroll: true,
          clickScroll: false,
        },
      },
    );
    instances.set(element, instance);
  };
  const flush = () => {
    frame = 0;
    for (const [element, instance] of instances) {
      if (!element.isConnected) {
        instance.destroy();
        instances.delete(element);
      }
    }
    for (const element of pending) {
      if (!element.isConnected || element.closest('.os-scrollbar')) continue;
      attach(element);
      element.querySelectorAll<HTMLElement>('div,section,main,aside,ul').forEach(attach);
    }
    pending.clear();
  };
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes)
        if (node instanceof HTMLElement && !node.matches('.os-scrollbar,.os-scrollbar *'))
          pending.add(node);
    }
    if (!frame && (pending.size || mutations.some((mutation) => mutation.removedNodes.length)))
      frame = requestAnimationFrame(flush);
  });
  flush();
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    instances.forEach((instance) => instance.destroy());
    instances.clear();
    pending.clear();
  };
}
