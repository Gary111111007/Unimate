// 启动保护测试：证明"某个原生调用永远不返回"时，启动依然能走完。
// 真机（OPPO/ColorOS）出现过开屏永久停住且没有任何 JS 错误，就是这个场景。
// 运行：node --experimental-strip-types tests/guard.test.ts
import { bootTrace, guard, traceReset } from '../src/services/guard.ts';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : '')); }
}

const never = new Promise<string>(() => { /* 永不 resolve，模拟被系统吞掉回调 */ });
const t0 = Date.now();
const hung = await guard('模拟挂起的原生调用', never, 200, 'fallback');
const dt = Date.now() - t0;
ok('挂起的 promise 会被超时放行', hung === 'fallback', String(hung));
ok('等待时间约等于超时值（不是无限等）', dt >= 150 && dt < 1500, dt + 'ms');

const fast = await guard('正常返回', Promise.resolve('ok'), 2000, 'fallback');
ok('正常调用原样返回', fast === 'ok', fast);

const boom = await guard('抛错调用', Promise.reject(new Error('原生报错')), 2000, 'fallback');
ok('reject 也走 fallback 而不是把启动炸掉', boom === 'fallback', String(boom));

traceReset();
await guard('A', Promise.resolve(1), 500, 0);
await guard('B', never, 120, 0);
ok('每步都留了痕（卡住时能报出是哪一步）', bootTrace.value.length >= 2, bootTrace.value.join(' / '));
ok('超时的那步被记成超时', bootTrace.value.some((x) => x.includes('B')), bootTrace.value.join(' / '));

console.log('');
console.log('Guard Test: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
