/** 几何桥接只读取引擎矩阵与原始封装位置，不创建虚构模型。 */
interface Point {
  x: number;
  y: number;
  z: number;
}
interface Matrix {
  data: ArrayLike<number>;
}
interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}
interface Group {
  getMatrix(): Matrix;
  getBBox(): Bounds | undefined;
  getContents(): Set<Group>;
}
interface Camera {
  getAdaptRenderMatrix(): Matrix;
  getWidth(): number;
  getHeight(): number;
  getPxLength(): number;
  getScale(): number;
  setScale(scale: number): void;
  addOffset(offset: Point): void;
}
interface ModelManager {
  modelIndex: Record<string, { group: Group }>;
  topModelGroup: Group;
  botModelGroup: Group;
  m_dictHighLightModel: Record<string, unknown>;
  engine: {
    scene: { group: { getAddiMatrix(): Matrix } };
    cameraManager: {
      focus(bounds: Bounds, camera: string | number): void;
      getCamere(camera: string | number): Camera;
    };
  };
}
interface GeometryEntry {
  top: boolean;
  group: Group;
  attributes: Record<string, number>;
}
interface GeometryResult {
  id: string;
  top: boolean;
  kind: 'model' | 'footprint' | 'point';
  points: Point[];
}
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const FOCUS_MARGIN = 36;
const CENTER_TOLERANCE = 0.25;
const MAX_FOCUS_STEPS = 8;
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
function transform(point: Point, matrix?: Matrix): Point {
  if (!matrix) return point;
  const m = matrix.data,
    { x, y, z } = point;
  const divisor = x * m[3] + y * m[7] + z * m[11] + m[15] || 1;
  return {
    x: (x * m[0] + y * m[4] + z * m[8] + m[12]) / divisor,
    y: (x * m[1] + y * m[5] + z * m[9] + m[13]) / divisor,
    z: (x * m[2] + y * m[6] + z * m[10] + m[14]) / divisor,
  };
}
function bounds(points: Point[]): Bounds {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
    minZ: Math.min(...points.map((p) => p.z)),
    maxZ: Math.max(...points.map((p) => p.z)),
  };
}
function corners(box: Bounds) {
  return [box.minX, box.maxX].flatMap((x) =>
    [box.minY, box.maxY].flatMap((y) => [box.minZ, box.maxZ].map((z) => ({ x, y, z }))),
  );
}
export function createGeometry(reportError: (error: unknown) => void) {
  const entries = new Map<string, GeometryEntry>();
  let manager: ModelManager | undefined;
  let selected: string[] = [];
  let cameraId: string | number = 'default';
  let frame = 0;
  let overlay: SVGSVGElement | undefined;
  let signature = '';
  let pending: { ids: string[]; camera: string | number; revision: number } | undefined;
  let revision = 0;
  let ready = false;
  let followSize = false;
  let lastSize = '';
  const canvas = () => document.querySelector<HTMLCanvasElement>('#smt-engine-canvas');

  /** 模型包围盒和真实封装尺寸均转换到同一世界坐标。 */
  function inspectWorld(ids: string[]): GeometryResult[] {
    if (!manager) return [];
    const owner = manager;
    const addition = owner.engine.scene.group.getAddiMatrix();
    return ids.flatMap((id) => {
      const entry = entries.get(id),
        model = owner.modelIndex[id];
      if (!entry && !model) return [];
      const top = entry?.top ?? !owner.botModelGroup.getContents().has(model.group);
      const parent = top ? owner.topModelGroup : owner.botModelGroup;
      const modelBounds = model?.group.getBBox();
      let points: Point[], kind: GeometryResult['kind'];
      if (modelBounds) {
        points = corners(modelBounds);
        kind = 'model';
      } else if (entry) {
        const attrs = entry.attributes;
        const value = (key: string) => (finite(attrs[key]) ? attrs[key] : 0);
        const width = Math.abs(value('dx')),
          height = Math.abs(value('dy'));
        const rx = (value('rx') * Math.PI) / 180,
          ry = (value('ry') * Math.PI) / 180,
          rz = (value('rz') * Math.PI) / 180;
        points = (
          width && height
            ? [
                [-1, -1],
                [1, -1],
                [1, 1],
                [-1, 1],
              ]
            : [[0, 0]]
        ).map(([a, b]) => {
          let x = (a * width) / 2,
            y = (b * height) / 2,
            z = 0;
          [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
          [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
          [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
          return transform(
            { x: x + value('x'), y: y + value('y'), z: z + value('z') },
            entry.group.getMatrix(),
          );
        });
        kind = width && height ? 'footprint' : 'point';
      } else return [];
      points = points.map((point) => transform(transform(point, parent.getMatrix()), addition));
      return points.every((point) => finite(point.x) && finite(point.y) && finite(point.z))
        ? [{ id, top, kind, points }]
        : [];
    });
  }
  function project(points: Point[], camera: Camera, width: number, height: number) {
    const matrix = camera.getAdaptRenderMatrix();
    return points.map((point) => {
      const p = transform(point, matrix);
      return { x: ((p.x + 1) * width) / 2, y: ((1 - p.y) * height) / 2, z: p.z };
    });
  }
  function schedule() {
    if (!frame && selected.length) frame = requestAnimationFrame(draw);
  }
  /** 定位在引擎就绪后执行，并以实际投影范围检查中心和可见边距。 */
  function focusPending() {
    frame = 0;
    if (!pending || !ready || !manager) return;
    const request = pending,
      rect = canvas()?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    pending = undefined;
    const geometry = inspectWorld(request.ids);
    if (geometry.length !== request.ids.length) {
      reportError(new Error('所选元器件缺少真实位置数据，无法完成整组定位。'));
      return;
    }
    const points = geometry.flatMap((item) => item.points);
    if (!points.length || request.revision !== revision) return;
    const cameras = manager.engine.cameraManager;
    cameras.focus(bounds(points), request.camera);
    const camera = cameras.getCamere(request.camera);
    for (let step = 0; step < MAX_FOCUS_STEPS; step++) {
      const box = bounds(project(points, camera, rect.width, rect.height));
      const dx = (box.minX + box.maxX - rect.width) / 2,
        dy = (box.minY + box.maxY - rect.height) / 2;
      if (Math.abs(dx) > CENTER_TOLERANCE || Math.abs(dy) > CENTER_TOLERANCE)
        camera.addOffset({
          x: ((dx * camera.getWidth()) / rect.width) * camera.getPxLength(),
          y: ((-dy * camera.getHeight()) / rect.height) * camera.getPxLength(),
          z: 0,
        });
      const measured = bounds(project(points, camera, rect.width, rect.height));
      const scale = Math.min(
        1,
        (rect.width - FOCUS_MARGIN) / (measured.maxX - measured.minX || 1),
        (rect.height - FOCUS_MARGIN) / (measured.maxY - measured.minY || 1),
      );
      if (scale < 1) camera.setScale(camera.getScale() * scale);
      if (Math.abs(dx) <= CENTER_TOLERANCE && Math.abs(dy) <= CENTER_TOLERANCE && scale === 1)
        break;
    }
    signature = '';
    schedule();
  }
  /** 无三维模型的已选元件使用真实封装轮廓，覆盖层不接收点击。 */
  function draw() {
    frame = 0;
    if (!selected.length || !manager) {
      overlay?.remove();
      overlay = undefined;
      return;
    }
    if (pending && ready) {
      focusPending();
      return;
    }
    const rect = canvas()?.getBoundingClientRect();
    if (rect?.width && rect.height) {
      const size = `${rect.width}:${rect.height}`;
      if (followSize && lastSize && lastSize !== size) {
        lastSize = size;
        pending = { ids: [...selected], camera: cameraId, revision: ++revision };
        focusPending();
        return;
      }
      lastSize = size;
      const camera = manager.engine.cameraManager.getCamere(cameraId);
      const shapes = inspectWorld(selected)
        .filter((item) => item.kind !== 'model')
        .map((item) => ({
          ...item,
          projected: project(item.points, camera, rect.width, rect.height),
        }));
      const next = JSON.stringify([rect.x, rect.y, rect.width, rect.height, shapes]);
      if (next !== signature) {
        signature = next;
        if (!overlay) {
          overlay = document.createElementNS(SVG_NAMESPACE, 'svg');
          overlay.classList.add('jlcf-selection-outline');
          overlay.setAttribute('aria-hidden', 'true');
          overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:3;overflow:hidden';
          document.body.append(overlay);
        }
        Object.assign(overlay.style, {
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
        overlay.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
        overlay.replaceChildren(
          ...shapes.map((shape) => {
            const element = document.createElementNS(
              SVG_NAMESPACE,
              shape.kind === 'point' ? 'path' : 'polygon',
            );
            element.dataset.jlcfId = shape.id;
            if (shape.kind === 'point') {
              const p = shape.projected[0];
              element.setAttribute('d', `M${p.x - 4},${p.y}h8M${p.x},${p.y - 4}v8`);
            } else
              element.setAttribute('points', shape.projected.map((p) => `${p.x},${p.y}`).join(' '));
            element.setAttribute('fill', '#38a5ff22');
            element.setAttribute('stroke', '#147bdb');
            element.setAttribute('stroke-width', '2');
            element.setAttribute('vector-effect', 'non-scaling-stroke');
            if (!shape.top) element.setAttribute('stroke-dasharray', '5 3');
            return element;
          }),
        );
      }
    }
    schedule();
  }
  function clear() {
    entries.clear();
    selected = [];
    pending = undefined;
    ready = false;
    revision++;
    cancelAnimationFrame(frame);
    frame = 0;
    overlay?.remove();
    overlay = undefined;
  }
  return {
    connect(owner: ModelManager) {
      manager = owner;
    },
    register(id: string, top: boolean, group: Group, attributes: Record<string, number>) {
      entries.set(id, { top, group, attributes });
    },
    initialize() {
      ready = true;
      if (pending) schedule();
    },
    select(ids: string[], camera: string | number = cameraId) {
      selected = [...ids];
      followSize = false;
      cameraId = camera;
      revision++;
      pending = undefined;
      signature = '';
      if (ids.length) schedule();
      else {
        cancelAnimationFrame(frame);
        frame = 0;
        overlay?.remove();
        overlay = undefined;
      }
    },
    focus(ids: string[], camera: string | number) {
      if (ids.length) {
        cameraId = camera;
        selected = [...ids];
        followSize = true;
        pending = { ids: [...ids], camera, revision: ++revision };
        schedule();
      }
    },
    inspect(ids = selected) {
      const rect = canvas()?.getBoundingClientRect();
      return inspectWorld(ids).map((item) => ({
        ...item,
        highlighted: !!manager?.m_dictHighLightModel[item.id],
        projected:
          rect && manager
            ? project(
                item.points,
                manager.engine.cameraManager.getCamere(cameraId),
                rect.width,
                rect.height,
              )
            : [],
      }));
    },
    clear,
    dispose() {
      clear();
      manager = undefined;
    },
  };
}
