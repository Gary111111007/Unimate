// 课表配色一致性测试（真机反馈："相同的课程没有统一颜色"）。
// 旧实现按导入行号取模 i % 12，同一门课出现在第 3 行和第 40 行就成了两种颜色。
// 运行：node --experimental-strip-types tests/color.test.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseJwglxtTimetable } from '../src/services/parser/jwglxtBuct.ts';
import { COURSE_COLORS, assignCourseColors, courseColorIndex } from '../src/catalog/periods.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, '..', 'fixtures', 'jwglxt-buct.sample.html'), 'utf8');
const parsed = parseJwglxtTimetable(fixture);

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : '')); }
}

ok('样本确实解析出课程', parsed.courses.length > 0, parsed.courses.length + ' 条');

// 1) 同名课程 -> 同一个色号（用户诉求本身）
const byName = new Map<string, number[]>();
for (const c of parsed.courses) {
  const arr = byName.get(c.name) || [];
  arr.push(courseColorIndex(c.name));
  byName.set(c.name, arr);
}
let sameDetail = '';
for (const [n, idxs] of byName) {
  if (new Set(idxs).size !== 1) { sameDetail = n + ' -> ' + idxs.join(','); break; }
}
ok('同名课程色号唯一', sameDetail === '', sameDetail);

// 2) 反证：旧写法在真实数据上确实会分裂（证明 bug 是真的，不是想象出来的）
const rows = parsed.courses.map((c, i) => ({ name: c.name, legacy: i % 12 }));
let legacySplit = 0;
for (const n of byName.keys()) {
  const set = new Set(rows.filter((r) => r.name === n).map((r) => r.legacy));
  if (set.size > 1) legacySplit++;
}
ok('旧写法确实会分裂（>=1 门课）', legacySplit >= 1, legacySplit + ' 门课');
console.log('  参考：旧写法下 ' + legacySplit + ' 门课会在同一张课表里出现多种颜色');

// 3) 稳定性：不看顺序、忽略空白
const n0 = parsed.courses[0].name;
ok('重复调用结果一致', courseColorIndex(n0) === courseColorIndex(n0));
ok('忽略空格差异', courseColorIndex('  高等数学 A ') === courseColorIndex('高等数学A'));
ok('空名也有确定色号', courseColorIndex('') >= 0 && courseColorIndex('') < COURSE_COLORS.length);

// 4) 不会退化：真实课表至少用到 4 种颜色，否则等于全表一个色
const used = new Set(parsed.courses.map((c) => courseColorIndex(c.name)));
ok('颜色分布 >= 4 种', used.size >= 4, '实际 ' + used.size + ' 种');

// 5) 色号永远落在调色板内（防越界变成无色块）
let inRange = true;
for (const n of byName.keys()) {
  const i = courseColorIndex(n);
  if (i < 0 || i >= COURSE_COLORS.length) { inRange = false; break; }
}
ok('色号均在调色板内', inRange);


// 6) 一张课表里：不同课程名必须尽量不同色（真机反馈"默认会变成一个颜色"）
const names = parsed.courses.map((c) => c.name);
const map = assignCourseColors(names);
const uniqNames = Object.keys(map);
const idxList = uniqNames.map((n) => map[n]);
const distinctIdx = new Set(idxList).size;
ok('课程名数量合理', uniqNames.length >= 4, uniqNames.length + ' 门课');
if (uniqNames.length <= COURSE_COLORS.length) {
  ok('同表内不同课互不同色', distinctIdx === uniqNames.length,
    uniqNames.length + ' 门课只用了 ' + distinctIdx + ' 种颜色');
} else {
  ok('超过调色板容量时仍尽量分散', distinctIdx === COURSE_COLORS.length,
    uniqNames.length + ' 门课用了 ' + distinctIdx + ' 种颜色');
}

// 7) 分配与顺序无关（打乱输入必须得到同一张表）
const shuffled = names.slice().reverse();
const map2 = assignCourseColors(shuffled);
let stable = true;
for (const n of uniqNames) { if (map[n] !== map2[n]) { stable = false; break; } }
ok('打乱导入顺序后颜色不变', stable);

// 8) 反证：纯哈希（无冲突处理）在同一张表里会撞色
let collide = 0;
const seen = new Set<string>();
for (const n of uniqNames) {
  const k = String(courseColorIndex(n));
  if (seen.has(k)) collide++; else seen.add(k);
}
ok('纯哈希确实会撞色（所以才需要分配表）', collide >= 1, collide + ' 门课与前面的课撞色');
console.log('  参考：不做冲突处理时，' + collide + ' 门课会和别的课共用一个颜色');

// 9) 手动色优先：同一张表里手动改色不应被自动分配覆盖（由视图层实现，这里锁住函数行为）
ok('自动分配返回的色号都在调色板内', idxList.every((i) => i >= 0 && i < COURSE_COLORS.length));

// 10) 真实容量：这份 16 门课的样本在 18 色下应当**完全互不相同**
ok('调色板 >= 18 色', COURSE_COLORS.length >= 18, '当前 ' + COURSE_COLORS.length + ' 色');
ok('样本 16 门课全部互不同色', uniqNames.length <= 18 ? distinctIdx === uniqNames.length : true,
  uniqNames.length + ' 门课 / ' + distinctIdx + ' 种颜色');

console.log('');
console.log('Color Test: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
