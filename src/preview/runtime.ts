/**
 * 输出 HTML 内部的静态展示和侧栏能力。
 * 所有资源随文件保存，此模块不调用转换服务器或第三方接口。
 */
export function installRuntime(settings: {
  logo: { kind: string; text?: string; data?: string };
  title: string;
  optimizePage: boolean;
  optimizeInteraction: boolean;
  worker: string;
}) {
  const runtimeWindow = window as typeof window & { __JLCFConv?: unknown };
  const objectUrls: string[] = [];
  const workerUrl = () => {
    const url = URL.createObjectURL(new Blob([settings.worker], { type: 'text/javascript' }));
    objectUrls.push(url);
    return url;
  };
  window.addEventListener(
    'pagehide',
    () => objectUrls.splice(0).forEach((url) => URL.revokeObjectURL(url)),
    { once: true },
  );
  type ReactApi = typeof import('react');
  interface PaneProps {
    type: string;
    title: string;
    className?: string;
    initialVisible?: boolean;
    initialWidthRatio?: number;
    initialHeight?: number;
    style?: Record<string, unknown>;
    children?: import('react').ReactNode;
    handleToggle?: (ratio: number) => void;
    onToggle?: (open: boolean) => void;
    previewWidthRatio?: number;
  }
  /** 使用 React 状态维护尺寸和可见性，拖动仅由 Pointer Events 驱动。 */
  function sidebar(React: ReactApi, props: PaneProps, forwardedRef: import('react').Ref<unknown>) {
    const narrow = () => window.innerWidth < 680;
    const [opened, setOpened] = React.useState(props.initialVisible ?? false);
    const [size, setSize] = React.useState(
      props.type === 'bottom'
        ? (props.initialHeight ?? 286)
        : (props.initialWidthRatio ?? 0.3) * window.innerWidth,
    );
    const [compact, setCompact] = React.useState(narrow);
    const box = React.useRef<HTMLDivElement>(null);
    const drag = React.useRef<{ id: number; x: number; y: number; size: number } | null>(null);
    const buttonPointer = React.useRef('mouse');
    const bottom = props.type === 'bottom' || props.type === 'top';
    const clamp = (value: number) => {
      const container = box.current?.parentElement?.parentElement;
      const headerHeight = bottom
        ? Array.from(container?.children ?? [])
            .filter(
              (element) =>
                element !== box.current?.parentElement && !element.querySelector('canvas'),
            )
            .reduce((sum, element) => sum + element.getBoundingClientRect().height, 0)
        : 0;
      const available = bottom
        ? (container?.clientHeight ?? innerHeight) - headerHeight
        : (box.current?.parentElement?.clientWidth ?? innerWidth);
      const occupied =
        !bottom && !compact
          ? Array.from(box.current?.parentElement?.children ?? [])
              .filter(
                (element) => element !== box.current && element.hasAttribute('data-jlcf-pane'),
              )
              .reduce((sum, element) => sum + element.getBoundingClientRect().width, 0)
          : 0;
      const maximum = Math.max(0, available - occupied - (compact ? 48 : 180));
      return Math.max(
        Math.min(bottom ? 120 : 180, available * 0.45, maximum),
        Math.min(value, maximum),
      );
    };
    const notify = (visible: boolean, value: number) => {
      if (!bottom && !compact && props.handleToggle) {
        const parentWidth = box.current?.parentElement?.clientWidth ?? innerWidth;
        const siblingWidth = Array.from(box.current?.parentElement?.children ?? [])
          .filter((e) => e !== box.current && e.hasAttribute('data-jlcf-pane'))
          .reduce((sum, e) => sum + e.getBoundingClientRect().width, 0);
        props.handleToggle(
          Math.max(0.08, (parentWidth - siblingWidth - (visible ? value : 0)) / innerWidth),
        );
      }
    };
    const toggle = () => {
      const next = !opened;
      setOpened(next);
      notify(next, size);
      props.onToggle?.(next);
    };
    React.useImperativeHandle(forwardedRef, () => ({ emitToggle: toggle }));
    React.useEffect(() => {
      const resize = () => {
        setCompact(narrow());
        setSize((value) => clamp(value));
      };
      window.addEventListener('resize', resize);
      return () => window.removeEventListener('resize', resize);
    }, [compact]);
    React.useEffect(() => {
      notify(opened, size);
    }, [opened, size, compact]);
    const move = (event: import('react').PointerEvent<HTMLDivElement>) => {
      const active = drag.current;
      if (!active || event.pointerId !== active.id) return;
      const delta = bottom
        ? active.y - event.clientY
        : props.type === 'right'
          ? active.x - event.clientX
          : event.clientX - active.x;
      setSize(clamp(active.size + delta));
    };
    const finish = (event: import('react').PointerEvent<HTMLDivElement>) => {
      if (drag.current?.id !== event.pointerId) return;
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    };
    const dimension = opened ? clamp(size) : 0;
    const side = props.type;
    return React.createElement(
      'div',
      {
        ref: box,
        className: `${props.className ?? ''} jlcf-pane`,
        'data-jlcf-pane': side,
        'data-open': String(opened),
        'data-compact': String(compact),
        style: {
          ...props.style,
          flex: '0 0 auto',
          [bottom ? 'height' : 'width']: dimension,
          minWidth: 0,
        },
      },
      React.createElement(
        'div',
        { className: 'jlcf-pane-content', style: { display: opened ? 'block' : 'none' } },
        props.children,
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'jlcf-pane-toggle',
          title: `${opened ? '收起' : '展开'}${props.title}`,
          'aria-label': `${opened ? '收起' : '展开'}${props.title}`,
          'aria-expanded': opened,
          onPointerDown: (event: import('react').PointerEvent<HTMLButtonElement>) => {
            buttonPointer.current = event.pointerType;
            if (event.pointerType !== 'mouse') {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
            }
          },
          onPointerUp: (event: import('react').PointerEvent<HTMLButtonElement>) => {
            if (event.pointerType !== 'mouse') {
              event.preventDefault();
              toggle();
            }
          },
          onClick: (event: import('react').MouseEvent<HTMLButtonElement>) => {
            if (event.detail === 0 || buttonPointer.current === 'mouse') toggle();
          },
        },
        side === 'left' ? (opened ? '‹' : '›') : bottom ? (opened ? '⌄' : '⌃') : opened ? '›' : '‹',
      ),
      opened &&
        React.createElement('div', {
          role: 'separator',
          'aria-label': `调整${props.title}尺寸`,
          'aria-orientation': bottom ? 'horizontal' : 'vertical',
          className: 'jlcf-pane-resize',
          onPointerDown: (event: import('react').PointerEvent<HTMLDivElement>) => {
            if (!event.isPrimary || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            drag.current = {
              id: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              size: dimension,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          },
          onPointerMove: move,
          onPointerUp: finish,
          onPointerCancel: finish,
          onLostPointerCapture: () => {
            drag.current = null;
          },
        }),
    );
  }
  runtimeWindow.__JLCFConv = { sidebar, workerUrl, settings };
  document.title = settings.title;
}

/** 静态 LOGO 的尺寸规则同时覆盖桌面和手机头部。 */
export const logoStyles = ` 
.jlcf-logo{display:flex;align-items:center;font:600 15px/1.45 system-ui,"Microsoft YaHei",sans-serif;color:#183d64;padding:8px 10px;min-width:0;overflow-wrap:anywhere;cursor:default;flex-shrink:1}.jlcf-logo img{max-width:min(320px,80vw);max-height:52px;object-fit:contain;display:block}
[class*="weld_phone_header_"]{height:auto!important;min-height:44px;gap:4px;flex-wrap:wrap}.jlcf-logo-mobile{flex:1 1 210px;padding:6px 8px}[class*="weld_phone_name_panel_"]{flex:0 1 65px!important;width:auto!important;padding-left:0!important;min-width:0}[class*="weld_phone_hamburger_"]{flex:none;width:44px!important;height:44px!important}[class*="weld_phone_name_"]{font-size:12px!important;max-width:65px}[class*="weld_phone_hamburger_"] [id=showDialog]{min-width:44px;min-height:44px;display:flex;align-items:center;justify-content:center}
`;
/** 仅作用于转换目标页，稳定语义前缀不依赖 CSS 模块的散列后缀。 */
export const pageStyles = `
html,body{margin:0!important;width:100%;height:100%;overflow:hidden}body>table{position:fixed!important;inset:0;display:block!important;width:100%;height:100%;border-spacing:0}body>table>tbody,body>table>tbody>tr,body>table>tbody>tr>td{display:block;width:100%;height:100%;padding:0}#smt-ui-container{width:100%;height:100%}
[class*="smt-preview-header-wrap_"]{height:auto!important;flex:none!important;min-width:0}
[class*="smt-preview-header_"]{height:auto!important;min-height:52px;display:flex!important;flex-wrap:wrap;align-items:center;gap:8px;padding:5px 10px;box-sizing:border-box;min-width:0;width:100%}
[class*="smt-preview-header-left_"]{display:flex!important;flex:1 1 400px;flex-wrap:wrap;min-width:0;margin:0!important;gap:8px}
[class*="smt-viewModel_"]{position:static!important;width:auto!important;min-width:0!important;margin:0!important;flex:1 1 340px}
[class*="smt-viewModel_"],[class*="radioArea_"]{justify-content:flex-start!important}[class*="radioArea_"]{display:flex;align-items:center;flex:0 1 auto!important;flex-wrap:wrap;gap:8px;height:auto!important;white-space:normal!important}
[class*="smt-preview-header-right_"]{display:flex!important;flex:0 1 auto;flex-wrap:wrap;gap:8px;margin:0!important;min-width:0}
[class*="smt-preview-header-right_"]>[class*="nav-bar_"]{margin:0!important;flex-shrink:0}
[class*="order-title-wrap_"]{position:static!important;max-width:100%;width:auto!important;height:auto!important;overflow-wrap:anywhere}
[class*="smt-layout_"]{min-height:0;min-width:0}[class*="smt-preview_"]{min-width:0}
@media(max-width:679px){[class*="smt-preview-header-left_"]{flex-basis:100%}[class*="smt-preview-header-right_"]{width:100%;justify-content:space-between}[class*="smt-preview-header_"]{gap:4px;padding:4px 8px}.jlcf-logo{font-size:14px;padding:4px}[class*="radioArea_"]{font-size:12px}[class*="layer-switch_"]{margin:0!important}}
`;
export const interactionStyles = `
[class*="content_"]:has(>.jlcf-pane){position:relative}.jlcf-pane{position:relative!important;box-sizing:border-box;z-index:5;overflow:visible!important;transition:none!important;min-height:0}.jlcf-pane-content{height:100%;width:100%;overflow:auto;background:white}.jlcf-pane-toggle{position:absolute;z-index:30;width:44px;height:44px;border:1px solid #c8d8ea;border-radius:8px;background:#f7fbff;color:#1d5b98;font:26px system-ui;touch-action:manipulation;box-shadow:0 2px 8px #1233;cursor:pointer}.jlcf-pane-toggle:focus-visible{outline:3px solid #2563eb}.jlcf-pane-resize{position:absolute;z-index:20;background:transparent;touch-action:none;user-select:none}.jlcf-pane-resize:after{content:"";position:absolute;background:#9eb5cb;border-radius:4px}
[data-jlcf-pane=left]>.jlcf-pane-toggle{right:-44px;top:10px}[data-jlcf-pane=right]>.jlcf-pane-toggle{left:-44px;top:62px}[data-jlcf-pane=left]>.jlcf-pane-resize{right:-12px;top:110px;bottom:0;width:24px;cursor:ew-resize}[data-jlcf-pane=right]>.jlcf-pane-resize{left:-12px;top:162px;bottom:0;width:24px;cursor:ew-resize}.jlcf-pane-resize:after{top:35%;left:10px;width:4px;height:72px}
[data-jlcf-pane=bottom]>.jlcf-pane-toggle{right:12px;top:-44px}[data-jlcf-pane=bottom]>.jlcf-pane-resize{height:24px;top:-12px;left:12px;right:70px;cursor:ns-resize}[data-jlcf-pane=bottom]>.jlcf-pane-resize:after{width:72px;height:4px;left:45%;top:10px}
@media(max-width:679px){.jlcf-pane[data-compact=true][data-jlcf-pane=left],.jlcf-pane[data-compact=true][data-jlcf-pane=right]{position:absolute!important;top:0;bottom:0;box-shadow:0 6px 20px #172c4b33}.jlcf-pane[data-jlcf-pane=left]{left:0}.jlcf-pane[data-jlcf-pane=right]{right:0}[class*="smt-layout-content_"]{position:relative!important}[class*="canvas-container_"]{min-width:0!important;width:100%!important}[data-jlcf-pane=left]>.jlcf-pane-toggle{top:8px}[data-jlcf-pane=right]>.jlcf-pane-toggle{top:60px}}
`;
