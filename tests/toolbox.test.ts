// 课表工具箱位置几何（v2.15）。
// 背景：这颗按钮"拖到右下角 → 改大字号 → 找不到"已经出过两次事故：
//   ① v2.13 按像素存坐标，底栏长高后就压在按钮上面；
//   ② v2.15 第一版忘了把 CSS zoom 换算掉，算出来的坐标被再放大一次，按钮直接出屏幕。
// 这条测试把边界逐条钉死，防止第三次。
import { toolBox, clampToBox, anchorFromPos, posFromAnchor, anchorFromLegacy } from '../src/services/toolbox.ts';

let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? ' -> ' + extra : ''));
}

const SIZE = 52;
const PAD = 8;

/** 展开成"按钮在视觉像素里的四边"，方便直接和屏幕/底栏比较 */
function visualRect(pos: { x: number; y: number }, zoom: number) {
  return { l: pos.x * zoom, t: pos.y * zoom, r: (pos.x + SIZE) * zoom, b: (pos.y + SIZE) * zoom };
}

console.log('--- 基本边界（无缩放，底栏 56px，屏幕 360×800）---');
const b1 = toolBox({ viewW: 360, viewH: 800, zoom: 1, barH: 56, size: SIZE, pad: PAD });
ok('左边界 = 8', b1.minX === 8, String(b1.minX));
ok('上边界 = 8', b1.minY === 8, String(b1.minY));
ok('右边界 = 屏宽 - 按钮 - 8', b1.maxX === 300, String(b1.maxX));
ok('下边界 = 屏高 - 底栏 - 8 - 按钮', b1.maxY === 684, String(b1.maxY));
{
  const r = visualRect({ x: b1.maxX, y: b1.maxY }, 1);
  ok('右下角时按钮完全在屏幕内', r.r <= 360 && r.b <= 800, JSON.stringify(r));
  ok('右下角时按钮**完全在底栏上方**（旧版只留 8px，会被底栏盖住）', r.b <= 800 - 56, 'bottom=' + r.b + ' 底栏上沿=744');
}

console.log('\n--- 忘掉 zoom 会怎样（v2.15 第一版事故复现）---');
{
  // 桌面/降级路径：整页 zoom 1.32。视觉视口仍是 800 高，但布局高度只有 800/1.32
  const zoom = 1.32;
  const b = toolBox({ viewW: 360, viewH: 800, zoom, barH: 74, size: SIZE, pad: PAD });
  const good = visualRect({ x: b.maxX, y: b.maxY }, zoom);
  ok('换算 zoom 后，大字号下按钮仍在屏幕内', good.r <= 360 + 0.01 && good.b <= 800 + 0.01, JSON.stringify(good));
  ok('换算 zoom 后，大字号下按钮仍在底栏上方（底栏视觉上沿 726）', good.b <= 726 + 0.01, 'bottom=' + good.b.toFixed(1));
  // 反证：直接拿 innerHeight 当布局高度（旧写法），按钮会跑到哪去
  const naive = visualRect({ x: 360 - SIZE - PAD, y: 800 - 74 - PAD - SIZE }, zoom);
  ok('反证：不换算 zoom 的旧写法确实会把按钮推到屏幕外', naive.r > 360 || naive.b > 800, 'right=' + naive.r.toFixed(0) + ' bottom=' + naive.b.toFixed(0));
}

console.log('\n--- 拖动夹取：拖多远都出不去 ---');
{
  const b = toolBox({ viewW: 360, viewH: 800, zoom: 1, barH: 56, size: SIZE, pad: PAD });
  for (const [x, y, label] of [
    [9999, 9999, '右下无限远'], [-9999, -9999, '左上无限远'], [9999, -9999, '右上无限远'], [-9999, 9999, '左下无限远']
  ] as [number, number, string][]) {
    const c = clampToBox(x, y, b);
    ok('夹取后落在允许区域内：' + label,
      c.x >= b.minX && c.x <= b.maxX && c.y >= b.minY && c.y <= b.maxY,
      JSON.stringify(c));
  }
  const mid = clampToBox(100, 200, b);
  ok('范围内的坐标原样保留', mid.x === 100 && mid.y === 200, JSON.stringify(mid));
}

console.log('\n--- 锚点往返：换尺寸后位置按比例保持，绝不越界 ---');
{
  const before = toolBox({ viewW: 360, viewH: 800, zoom: 1, barH: 56, size: SIZE, pad: PAD });
  const a = anchorFromPos({ x: before.maxX, y: before.maxY }, before);
  ok('右下角 → 锚点 (1, 1)', a.fx === 1 && a.fy === 1, JSON.stringify(a));

  // 换成"小屏 + 大字号"：布局区缩小、底栏变高
  const after = toolBox({ viewW: 360, viewH: 600, zoom: 1.32, barH: 74, size: SIZE, pad: PAD });
  const moved = posFromAnchor(a, after);
  const r = visualRect(moved, 1.32);
  ok('换尺寸后仍在屏幕内', r.l >= 0 && r.t >= 0 && r.r <= 360 + 0.01 && r.b <= 600 + 0.01, JSON.stringify(r));
  ok('换尺寸后仍在底栏上方', r.b <= 600 - 74 + 0.01, 'bottom=' + r.b.toFixed(1) + ' 底栏上沿=' + (600 - 74));
  ok('锚点往返稳定（同一个框里 pos→anchor→pos 不变）', (() => {
    const p = { x: 120, y: 300 };
    const back = posFromAnchor(anchorFromPos(p, before), before);
    return Math.abs(back.x - p.x) < 1e-6 && Math.abs(back.y - p.y) < 1e-6;
  })());
}

console.log('\n--- 老数据（像素坐标）迁移 ---');
{
  const b = toolBox({ viewW: 360, viewH: 800, zoom: 1, barH: 56, size: SIZE, pad: PAD });
  // v2.13 存下来的右下角：(800-52-8)=740 —— 正好落在底栏底下
  const legacy = anchorFromLegacy(300, 740, b);
  const back = posFromAnchor(legacy, b);
  const r = visualRect(back, 1);
  ok('老像素坐标会被夹回允许区域', back.x <= b.maxX && back.y <= b.maxY, JSON.stringify(back));
  ok('迁移后按钮不再压在底栏上', r.b <= 800 - 56, 'bottom=' + r.b);
  const wild = anchorFromLegacy(99999, 99999, b);
  ok('越界老数据也不会产生非法锚点', wild.fx === 1 && wild.fy === 1, JSON.stringify(wild));
}

console.log('\n--- 退化输入（防止 NaN/0 把按钮算没）---');
{
  const b = toolBox({ viewW: 0, viewH: 0, zoom: 0, barH: 0, size: SIZE, pad: PAD });
  ok('视口为 0 时仍给出闭合区域（min 不大于 max）', b.minX <= b.maxX && b.minY <= b.maxY, JSON.stringify(b));
  const p = posFromAnchor({ fx: 0.5, fy: 0.5 }, b);
  ok('退化输入下位置仍是有限数', Number.isFinite(p.x) && Number.isFinite(p.y), JSON.stringify(p));
  const a2 = anchorFromPos({ x: 10, y: 10 }, { minX: 5, maxX: 5, minY: 5, maxY: 5 });
  ok('零宽区域时不产生 NaN 锚点', Number.isFinite(a2.fx) && Number.isFinite(a2.fy), JSON.stringify(a2));
}

console.log('\n结果：' + pass + ' 通过 / ' + fails.length + ' 失败');
for (const f of fails) console.log('  ✗ ' + f);
if (fails.length) process.exit(1);
