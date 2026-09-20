// 手势去重（PRD 11.30）。
// 真机反馈：「记事本里用按钮切月正常，用手指滑一下会跳两个月」。
// 根因：日历卡片 .cal 与页面容器 .scroll 各绑了一套 touchend，touch 事件冒泡 →
// 同一次滑动把 shiftMonth() 调了两次。修法是在"切月"这一层去重。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { dedupeGesture } from '../src/services/gesture.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? ' -> ' + extra : ''));
}

console.log('--- 去重本身 ---');
{
  let now = 1000;
  const seen: number[] = [];
  const fn = dedupeGesture((d: number) => seen.push(d), 350, () => now);
  fn(1);                       // 手势的第一个处理器
  now = 1050; fn(1);           // 冒泡上来的第二个处理器（同一次滑动）→ 应被丢弃
  ok('同一次滑动里的第二次调用被丢弃', seen.length === 1, JSON.stringify(seen));
  ok('生效的是第一次传的方向', seen[0] === 1, JSON.stringify(seen));
  now = 1600; fn(-1);          // 用户又滑了一次（间隔足够）
  ok('间隔超过阈值后恢复正常', seen.length === 2 && seen[1] === -1, JSON.stringify(seen));
  now = 1700; fn(5);
  ok('同一窗口内第三次也不放行', seen.length === 2, JSON.stringify(seen));
  now = 10_000; fn(9);
  ok('长时间后仍可用（不会永久失效）', seen.length === 3 && seen[2] === 9, JSON.stringify(seen));
}
{
  let calls = 0;
  const fn = dedupeGesture(() => { calls++; }, 0, () => 0);
  fn(); fn();
  ok('gap=0 时每次都放行（阈值可关）', calls === 2, String(calls));
}
{
  const obj = { hits: 0, run(this: any, a: number, b: string) { this.hits += a + b.length; } };
  const wrapped = dedupeGesture(obj.run, 100, () => 0);
  wrapped.call(obj, 2, 'xx');
  ok('透传 this 与参数', obj.hits === 4, String(obj.hits));
}

console.log('\n--- 记事本必须走这一层（防复发）---');
const notes = readFileSync(join(root, 'src', 'views', 'NotesView.vue'), 'utf8');
ok('切月手势被 dedupeGesture 包住', /dedupeGesture\(\s*\(d: number\)\s*=>\s*shiftMonth\(d\)\s*\)/.test(notes));
ok('两个手势处理器都改用去重后的函数', (notes.match(/shiftMonthByGesture\(/g) || []).length === 2, String((notes.match(/shiftMonthByGesture\(/g) || []).length));
{
  // 两个 touch 处理器内部不许再直接调 shiftMonth —— 否则就是把重复触发的坑装回去
  const handlers = [...notes.matchAll(/function on(?:Cal)?TouchEnd\(e: TouchEvent\): void \{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  ok('抓到两个手势处理器', handlers.length === 2, String(handlers.length));
  ok('手势处理器里没有裸的 shiftMonth 调用', handlers.every((h) => !/(^|[^A-Za-z])shiftMonth\(/.test(h)), handlers.map((h) => h.trim().slice(0, 40)).join(' | '));
}
{
  // 按钮路径必须保持"一次点击走一格"：不能被去重吃掉
  const nav = notes.match(/<button class="mnav"[^>]*>‹<\/button>[\s\S]{0,400}?<button class="mnav"[^>]*>›<\/button>/);
  ok('‹ / › 按钮仍直接调用 shiftMonth（快速连点不会被吞）',
    !!nav && /shiftMonth\(-1\)/.test(nav[0]) && /shiftMonth\(1\)/.test(nav[0]),
    nav ? nav[0].replace(/\s+/g, ' ') : '(没找到月份导航按钮)');
}

console.log('\n结果：' + pass + ' 通过 / ' + fails.length + ' 失败');
for (const f of fails) console.log('  ✗ ' + f);
if (fails.length) process.exit(1);
