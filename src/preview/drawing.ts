import type { MessageBus } from './selection';
type DrawingRequest = [boolean, boolean, number, number, number];
/** 引擎服务注册完成前只保存最后的坐标轴状态，避免向不存在的服务发送 RPC。 */
export function createDrawing(reportError: (error: unknown) => void) {
  let ready = false;
  let disposed = false;
  let bus: MessageBus | undefined;
  let pending: DrawingRequest | undefined;
  let running = false;
  async function flush() {
    if (!ready || disposed || running || !pending || !bus) return;
    running = true;
    try {
      while (pending && !disposed) {
        const [visible, top = true, x = 0, y = 0, length = 20000] = pending;
        pending = undefined;
        await bus.rpcCall('/engine/draw/clear', top);
        if (visible) {
          await bus.rpcCall('/engine/draw/polyline', [[x, -length, 'L', x, length], 2, top]);
          await bus.rpcCall('/engine/draw/polyline', [[-length, y, 'L', length, y], 2, top]);
        }
      }
    } catch (error) {
      reportError(error);
    } finally {
      running = false;
    }
  }
  return {
    request(connection: MessageBus, request: DrawingRequest) {
      bus = connection;
      pending = request;
      void flush();
    },
    async initialize<T>(initialize: () => Promise<T>) {
      ready = false;
      const result = await initialize();
      ready = true;
      await flush();
      return result;
    },
    dispose() {
      disposed = true;
      pending = undefined;
      bus = undefined;
    },
  };
}
