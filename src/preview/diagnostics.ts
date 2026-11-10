/** 成功运算记录保留在有界队列中，真实异常同时进入浏览器错误日志。 */
const RECORD_LIMIT = 256;
const MESSAGE_KEY = '__jlcfDiagnostics';
interface DiagnosticRecord {
  sequence: number;
  name: string;
  timestamp: string;
  elapsedMs: number;
  durationMs?: number;
  source: string;
  arguments: unknown[];
}
/** 摘要避免持有模型数组和线程传输对象。 */
function summarize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return { type: 'Array', length: value.length };
  if (ArrayBuffer.isView(value))
    return { type: value.constructor.name, byteLength: value.byteLength };
  return {
    type: value.constructor?.name ?? 'Object',
    ...Object.fromEntries(
      Object.entries(value)
        .slice(0, 12)
        .map(([key, item]) => [
          key,
          item === null || ['string', 'number', 'boolean'].includes(typeof item)
            ? typeof item === 'string'
              ? item.slice(0, 240)
              : item
            : Array.isArray(item)
              ? { type: 'Array', length: item.length }
              : { type: typeof item },
        ]),
    ),
  };
}
export function createDiagnostics() {
  const records: DiagnosticRecord[] = [];
  const workers = new Set<Worker>();
  const starts = new Map<string, number>();
  const origin = performance.now();
  let sequence = 0;
  let workerSequence = 0;
  function append(source: string, name: string, args: unknown[], time = performance.now()) {
    const workerStep = name === '/worker/runBoolean start' || name === 'bool encode';
    const key = `${source}/${workerStep ? 'boolean-worker' : 'boolean-caller'}`;
    if (name === '/worker/runBoolean start' || (name === '/worker/runBoolean' && !starts.has(key)))
      starts.set(key, time);
    const finished = name === 'bool encode' || name === '/worker/runBoolean decode';
    const start = finished ? starts.get(key) : undefined;
    if (finished) starts.delete(key);
    records.push({
      sequence: ++sequence,
      name,
      timestamp: new Date().toISOString(),
      elapsedMs: Math.round((performance.now() - origin) * 100) / 100,
      ...(start === undefined ? {} : { durationMs: Math.round((time - start) * 100) / 100 }),
      source,
      arguments: args.map(summarize),
    });
    if (records.length > RECORD_LIMIT) records.shift();
  }
  const record = (name: string, ...args: unknown[]) => append('页面', name, args);
  return {
    record,
    reportError(error: unknown) {
      record('运行异常', error instanceof Error ? error.message : error);
      console.error(error);
    },
    records: () => ({ total: sequence, records: [...records] }),
    createWorker(url: string | URL, options?: WorkerOptions) {
      const worker = new Worker(url, options);
      workers.add(worker);
      const source = `工作线程 ${++workerSequence}`;
      const terminate = worker.terminate.bind(worker);
      worker.terminate = () => {
        workers.delete(worker);
        terminate();
      };
      worker.addEventListener(
        'message',
        (event) => {
          const value = event.data?.[MESSAGE_KEY];
          if (value) {
            event.stopImmediatePropagation();
            append(source, value.name, value.args, value.time);
          }
        },
        true,
      );
      return worker;
    },
    dispose() {
      for (const worker of workers) worker.terminate();
      starts.clear();
    },
  };
}
