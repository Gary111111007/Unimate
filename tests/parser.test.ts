// Golden Test（PRD AC-06）：用脱敏样本断言解析器的结构与数值输出。
// 运行：node --experimental-strip-types tests/parser.test.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseJwglxtTimetable, parseWeeks, splitTitle } from '../src/services/parser/jwglxtBuct.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, '..', 'fixtures', 'jwglxt-buct.sample.html'), 'utf8');

let passed = 0;
let failed = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + '\n        expected ' + e + '\n        actual   ' + a); }
}
function ok(label: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : '')); }
}

console.log('--- 周次表达式（PRD 5.4.5） ---');
check('1-9周 -> 1..9', parseWeeks('1-9周').weeks.length, 9);
check('1-9周,11-15周', parseWeeks('1-9周,11-15周').weeks.join(','), '1,2,3,4,5,6,7,8,9,11,12,13,14,15');
check('1周,4周,7周,13周', parseWeeks('1周,4周,7周,13周').weeks.join(','), '1,4,7,13');
check('2-3周,5-6周,8-9周,11-12周,14-17周', parseWeeks('2-3周,5-6周,8-9周,11-12周,14-17周').weeks.join(','), '2,3,5,6,8,9,11,12,14,15,16,17');
check('11-14周', parseWeeks('11-14周').weeks.join(','), '11,12,13,14');
check('单周 1-7(单)周', parseWeeks('1-7(单)周').weeks.join(','), '1,3,5,7');
check('无法解析时 ok=false', parseWeeks('abc').ok, false);

console.log('--- 课型符号（PRD 5.4.4） ---');
check('★ 讲课', splitTitle('电路原理\u2605').lessonType, 'lecture');
check('◇ 上机', splitTitle('程序设计实训\u25c7').lessonType, 'machine');
check('● 实践', splitTitle('工程训练\u25cf').lessonType, 'practice');
check('○ 实验', splitTitle('电路原理实验\u25cb').lessonType, 'lab');
check('名称剥离符号', splitTitle('电路原理\u2605').name, '电路原理');
check('尾部空格+符号', splitTitle('化工过程安全与具身智能前沿研讨  \u2605').name, '化工过程安全与具身智能前沿研讨');

console.log('--- 整页解析（脱敏样本） ---');
const r = parseJwglxtTimetable(fixture);
check('学期标题', r.semesterLabel, '2026-2027学年第1学期');
check('学生姓名（脱敏）', r.studentName, '智小汇');
check('学号（虚构）', r.studentId, '2025040999');
check('课程条目数 = 25', r.courses.length, 25);
check('不同课程名 = 16（MATLAB 有讲课+上机两个标题）', r.distinctCourseNames, 16);
check('未识别周次 = 0', r.diagnostics.filter((d) => d.kind === 'unparsed-weeks').length, 0);
check('缺字段 = 0', r.diagnostics.filter((d) => d.kind === 'missing-fields').length, 0);
check('时间冲突 = 0', r.diagnostics.filter((d) => d.kind === 'conflict').length, 0);
ok('无 no-table / no-courses', r.diagnostics.filter((d) => d.kind === 'no-table' || d.kind === 'no-courses').length === 0);
check('最大节次 = 12', Math.max(...r.courses.map((c) => c.endPeriod)), 12);
check('最大周次 = 18', Math.max(...r.courses.map((c) => c.weeks[c.weeks.length - 1])), 18);
check('星期取值都在 1..7', r.courses.every((c) => c.day >= 1 && c.day <= 7), true);
check('地点全部解析出校区', r.courses.every((c) => c.campus.length > 0), true);
check('教师全部非空', r.courses.every((c) => c.teacher.length > 0), true);
check('学分全部解析成功', r.courses.every((c) => c.credit !== null), true);
check('考核方式全部非空', r.courses.every((c) => c.examMode.length > 0), true);

function find(name: string, day: number, sp: number) {
  return r.courses.filter((c) => c.name === name && c.day === day && c.startPeriod === sp);
}
console.log('--- 抽样核对（与教务页面逐字对照） ---');
const fb = find('复变函数与积分变换（A）', 1, 1)[0];
ok('周一1-2 复变函数存在', !!fb);
check('  地点-校区', fb && fb.campus, '北区');
check('  地点-教室', fb && fb.room, '二教C阶-101');
check('  教师', fb && fb.teacher, '教师A');
check('  节次', fb && [fb.startPeriod, fb.endPeriod].join('-'), '1-2');
check('  周次', fb && fb.weeks.join(','), '1,2,3,4,5,6,7,8,9,11,12,13,14,15');
check('  学分', fb && fb.credit, 3.5);
check('  课型', fb && fb.lessonType, 'lecture');
check('  考核', fb && fb.examMode, '考试');
check('  课序号', fb && fb.courseCode, '复变函数与积分变换（A）-0001');
check('  总学时', fb && fb.totalHours, 56);

const sj = find('程序设计实训', 3, 1)[0];
check('周三1-4 程序设计实训 课型=上机', sj && sj.lessonType, 'machine');
check('  地点', sj && sj.room, '第十微机室-实验楼A306');
const gt = find('工程训练', 6, 1)[0];
check('周六1-4 工程训练 课型=实践', gt && gt.lessonType, 'practice');
check('  多教师保留原文', gt && gt.teacher, '教师M,教师N');
const xcd = find('电路原理实验', 2, 1)[0];
check('周二1-4 电路原理实验 课型=实验', xcd && xcd.lessonType, 'lab');
check('  周次 11-14', xcd && xcd.weeks.join(','), '11,12,13,14');
const dz = find('电子技术实验（Ⅰ)', 3, 8)[0];
check('周三8-11 电子技术实验 跨4节', dz && [dz.startPeriod, dz.endPeriod].join('-'), '8-11');
const English = r.courses.filter((c) => c.name === '大学英语4');
check('大学英语4 两个教学班', English.length, 2);
check('  两班周次 4 + 12 节不重叠', English.map((c) => c.weeks.length).sort((a, b) => a - b).join(','), '4,12');
check('  两班周次无交集', English[0].weeks.filter((w) => English[1].weeks.indexOf(w) >= 0).length, 0);
const matlab = r.courses.filter((c) => c.name === 'MATLAB基础与应用' && c.startPeriod === 10);
check('MATLAB 10-11节 两个机房', matlab.length, 2);
const chem = r.courses.filter((c) => c.name === '化工过程安全与具身智能前沿研讨');
check('化工研讨 5 个专题周', chem.length, 5);
check('  教师各不相同', new Set(chem.map((c) => c.teacher)).size, 5);
check('  周次合并覆盖 6-11', [...new Set(chem.flatMap((c) => c.weeks))].sort((a, b) => a - b).join(','), '6,7,8,9,10,11');
const xs = find('形势与政策（II）', 5, 6)[0];
check('周五6-9 形势与政策 16-17周', xs && xs.weeks.join(','), '16,17');

console.log('--- 降级路径 ---');
const empty = parseJwglxtTimetable('<html><body>请登录</body></html>');
check('无表格 -> no-table', empty.diagnostics[0].kind, 'no-table');
check('无表格 -> 0 条课程', empty.courses.length, 0);

console.log('');
console.log(`Golden Test: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
