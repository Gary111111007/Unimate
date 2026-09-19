// 课表配色一致性测试（真机反馈："相同的课程没有统一颜色"）。
// 旧实现按导入行号取模 i % 12，同一门课出现在第 3 行和第 40 行就成了两种颜色。
// 运行：node --experimental-strip-types tests/color.test.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseJwglxtTimetable } from '../src/services/parser/jwglxtBuct.ts';
import { COURSE_COLORS, courseColorIndex } from '../src/catalog/periods.ts';

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

console.log('');
console.log('Color Test: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
