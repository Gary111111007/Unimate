/**
 * 头像裁剪的数学部分（v2.54）。
 *
 * 为什么单独测这个：裁剪是"看不见的坐标换算"，错了不会报错 —— 只会裁出一块偏掉的图。
 * `cropRectFor()` 是纯函数，正好可以把"拖动/缩放后到底裁哪一块"钉死。
 */
import { cropRectFor, squareCropRect } from '../src/services/avatar.ts';

let pass = 0;
const fails: string[] = [];
function ok(name: string, yes: boolean, detail = ''): void {
  if (yes) { pass++; return; }
  fails.push(name + (detail ? ' — ' + detail : ''));
}

const VIEW = 260;

// 1) 不拖不缩：等于居中裁一块正方形，边长按 cover 算
{
  const r = cropRectFor({ view: VIEW, nw: 1000, nh: 500, zoom: 1, dx: 0, dy: 0 });
  // 基准缩放 = max(260/1000, 260/500) = 0.52 → 取景框在原图里是 260/0.52 = 500 像素
  ok('横图不拖不缩：裁原图中间 500×500', Math.round(r.size) === 500 && Math.round(r.sx) === 250 && Math.round(r.sy) === 0,
    JSON.stringify(r));
}
{
  const r = cropRectFor({ view: VIEW, nw: 500, nh: 1000, zoom: 1, dx: 0, dy: 0 });
  ok('竖图不拖不缩：裁原图中间 500×500', Math.round(r.size) === 500 && Math.round(r.sx) === 0 && Math.round(r.sy) === 250,
    JSON.stringify(r));
}

// 2) 放大后取景框变小
{
  const r = cropRectFor({ view: VIEW, nw: 1000, nh: 500, zoom: 2, dx: 0, dy: 0 });
  ok('放大 2 倍：取景框在原图里缩小到 250×250', Math.round(r.size) === 250, JSON.stringify(r));
}

// 3) 向右拖动 → 看到的是原图更靠左的部分（sx 变小）
{
  const base = cropRectFor({ view: VIEW, nw: 1000, nh: 500, zoom: 2, dx: 0, dy: 0 });
  const right = cropRectFor({ view: VIEW, nw: 1000, nh: 500, zoom: 2, dx: 60, dy: 0 });
  ok('向右拖 60px：裁的位置跟着往左移', right.sx < base.sx, base.sx + ' → ' + right.sx);
  const left = cropRectFor({ view: VIEW, nw: 1000, nh: 500, zoom: 2, dx: -60, dy: 0 });
  ok('向左拖 60px：裁的位置跟着往右移', left.sx > base.sx, base.sx + ' → ' + left.sx);
}

// 4) 夹取：拖过头不能露出黑边（裁剪框必须完全落在原图里）
{
  const far = cropRectFor({ view: VIEW, nw: 1000, nh: 500, zoom: 1, dx: 99999, dy: 99999 });
  ok('向右下拖过头也不越界', far.sx >= 0 && far.sy >= 0 && far.sx + far.size <= 1000.001 && far.sy + far.size <= 500.001,
    JSON.stringify(far));
  const far2 = cropRectFor({ view: VIEW, nw: 1000, nh: 500, zoom: 3, dx: -99999, dy: -99999 });
  ok('向左上拖过头也不越界', far2.sx >= 0 && far2.sy >= 0 && far2.sx + far2.size <= 1000.001 && far2.sy + far2.size <= 500.001,
    JSON.stringify(far2));
}

// 5) 缩放范围夹在 1~4（UI 上是滑杆，但不信 UI 的值）
{
  const tooSmall = cropRectFor({ view: VIEW, nw: 800, nh: 800, zoom: 0.2, dx: 0, dy: 0 });
  const one = cropRectFor({ view: VIEW, nw: 800, nh: 800, zoom: 1, dx: 0, dy: 0 });
  ok('缩放小于 1 按 1 处理（不会裁出比取景框更大的范围）', Math.abs(tooSmall.size - one.size) < 0.001, tooSmall.size + ' vs ' + one.size);
  const tooBig = cropRectFor({ view: VIEW, nw: 4000, nh: 4000, zoom: 99, dx: 0, dy: 0 });
  const four = cropRectFor({ view: VIEW, nw: 4000, nh: 4000, zoom: 4, dx: 0, dy: 0 });
  ok('缩放大于 4 按 4 处理', Math.abs(tooBig.size - four.size) < 0.001, tooBig.size + ' vs ' + four.size);
}

// 6) 退化输入不能算出 NaN（会让 canvas 静默画空白）
{
  for (const bad of [
    cropRectFor({ view: 0, nw: 0, nh: 0, zoom: 0, dx: NaN, dy: NaN }),
    cropRectFor({ view: -10, nw: -5, nh: -5, zoom: -1, dx: 0, dy: 0 })
  ]) {
    ok('异常参数不产生 NaN/负数', [bad.sx, bad.sy, bad.size].every((n) => Number.isFinite(n) && n >= 0), JSON.stringify(bad));
  }
}

ok('自动裁剪兜底函数仍是居中正方形',
  JSON.stringify(squareCropRect(1000, 500)) === JSON.stringify({ sx: 250, sy: 0, size: 500 }), '');

console.log('Avatar Test: ' + pass + ' passed, ' + fails.length + ' failed');
for (const f of fails) console.log('  ✗ ' + f);
if (fails.length) process.exit(1);
