// 启动保护：任何原生调用都**不许**无限期挂住启动。
// 真机实测（OPPO/ColorOS）出现过"开屏永远停住、且没有任何 JS 错误"的情况 ——
// 那就是某个 Capacitor 插件的 Promise 再也没 resolve。没有超时的话，用户只能卸载重装。
import { ref } from 'vue';

/** 启动/关键路径的逐步留痕，卡住时直接显示给用户看（比"猜"快得多） */
export const bootTrace = ref<string[]>([]);

export function traceReset(): void { bootTrace.value = []; }

/** 一行耗时记录 */
export function trace(label: string, ms: number): void {
  if (bootTrace.value.length > 40) bootTrace.value.shift();
  bootTrace.value.push(label + ' ' + Math.round(ms) + 'ms');
}

/**
 * 给 promise 加时限：超时就用 fallback 继续往下走，并把"超时"这件事记进 trace。
 * 注意：被放弃的 promise 之后真 resolve 也不影响结果，只是不再等它。
 */
export async function guard<T>(label: string, p: Promise<T>, ms: number, fallback: T): Promise<T> {
  const t0 = performance.now();
  let timer = 0;
  try {
    return await Promise.race([
      p.then((v) => v),
      new Promise<T>((res) => { timer = setTimeout(() => res(fallback), ms) as unknown as number; })
    ]);
  } catch (e: any) {
    trace(label + ' 出错:' + String((e && e.message) || e).slice(0, 40), performance.now() - t0);
    return fallback;
  } finally {
    clearTimeout(timer as any);
    trace(label, performance.now() - t0);
  }
}

export function traceText(): string {
  return bootTrace.value.join('  ·  ');
}
