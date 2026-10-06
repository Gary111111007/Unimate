import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  discoverMenuEntries,
  extractGpa,
  findPayloadArray,
  fromMainAcademicRulePack,
  keepLastSuccessful,
  parseExamTime,
  parseExams,
  parseGrades,
  parseHtmlTable,
  parseNumberLoose,
  toMainAcademicRulePack,
  validateRulePack,
  type RulePack
} from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (relative: string): string => readFileSync(join(root, relative), 'utf8');
const readJson = (relative: string): unknown => JSON.parse(read(relative));

const rawPack = readJson('rules/buct.json');
const checkedPack = validateRulePack(rawPack);
if (!checkedPack.ok) throw new Error('内置规则包不合法：' + checkedPack.errors.join('；'));
const pack = checkedPack.pack as RulePack;

const gradesHtml = read('fixtures/grades.sample.html');
const examsHtml = read('fixtures/exams.sample.html');
const gradesJson = read('fixtures/grades.sample.json');
const examsJson = read('fixtures/exams.sample.json');

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log('  PASS  ' + name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(name + ': ' + message);
    console.log('  FAIL  ' + name + '\n        ' + message);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function tableHtml(headers: string[], rows: string[][]): string {
  const head = headers.map((header) => '<th>' + escapeHtml(header) + '</th>').join('');
  const body = rows.map((row) => '<tr>' + row.map((cell) => '<td>' + escapeHtml(cell) + '</td>').join('') + '</tr>').join('');
  return '<table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
}

console.log('--- 规则包 ---');
test('规则包通过白名单校验', () => {
  assert.equal(checkedPack.ok, true);
  assert.equal(pack.schoolId, 'buct');
});
test('未知字段会被整份拒绝', () => {
  const raw = JSON.parse(JSON.stringify(rawPack)) as any;
  raw.scopes.grades.aliases.injected = ['evil'];
  const result = validateRulePack(raw);
  assert.equal(result.ok, false);
  const parsed = parseGrades(gradesHtml, raw);
  assert.equal(parsed.records.length, 0);
  assert.equal(parsed.diagnostics[0].code, 'invalid-rule-pack');
});

test('主工程 academic 包装示例可以映射回独立规则包', () => {
  const wrapper = readJson('integration/rule-pack-main.example.json') as any;
  assert.equal(wrapper.adapterId, 'academic-buct');
  assert.equal(wrapper.kind, 'academic');
  const mapped = {
    schemaVersion: wrapper.schemaVersion,
    schoolId: 'buct',
    version: String(wrapper.version),
    menuHints: wrapper.rules.menuHints,
    payloadArrayPriority: wrapper.rules.payloadArrayPriority,
    scopes: wrapper.rules.scopes
  };
  assert.equal(validateRulePack(mapped).ok, true);
});
test('主工程 academic 包装可以往返转换', () => {
  const wrapper = readJson('integration/rule-pack-main.example.json') as any;
  const back = fromMainAcademicRulePack(wrapper);
  assert.ok(back);
  assert.equal(back.schoolId, 'buct');
  const again = toMainAcademicRulePack(back, 2);
  assert.equal(again.kind, 'academic');
  const roundTrip = fromMainAcademicRulePack(again);
  assert.ok(roundTrip);
  assert.equal(roundTrip.schoolId, 'buct');
});
console.log('\n--- JSON 通道 ---');
test('成绩 JSON：列名别名和嵌套数组都能识别', () => {
  const result = parseGrades(gradesJson, pack);
  assert.equal(result.channel, 'json');
  assert.equal(result.records.length, 3);
  assert.equal(result.stats.payloadKey, 'records');
  const math = result.records.find((record) => record.courseName === '高等数学');
  assert.ok(math);
  assert.equal(math.courseCode, 'MATH1001A');
  assert.equal(math.credits, 5);
  assert.equal(math.point, 3.92);
  assert.equal(math.termId, '2025-2026-1');
});
test('考试 JSON：考试时间转成 startAt 且保留原文', () => {
  const result = parseExams(examsJson, pack);
  assert.equal(result.channel, 'json');
  assert.equal(result.records.length, 3);
  assert.equal(result.records[0].examTime, '2026-07-04(08:00-10:00)');
  assert.equal(result.records[0].startAt, Date.UTC(2026, 6, 4, 8, 0));
});
test('响应体多编码一层 JSON 仍可识别', () => {
  const result = parseGrades(JSON.stringify(gradesJson), pack);
  assert.equal(result.records.length, 3);
  assert.equal(result.stats.decodedDepth, 1);
});
test('循环对象不会让数组查找死循环', () => {
  const cyclic: any = {};
  cyclic.self = cyclic;
  cyclic.records = [{ kcmc: '艺术导论', cj: '优秀' }];
  const hit = findPayloadArray(cyclic, pack.payloadArrayPriority);
  assert.ok(hit);
  assert.equal(hit.key, 'records');
  assert.equal(hit.array.length, 1);
});

console.log('\n--- HTML 通道 ---');
test('成绩 HTML：按表头映射，内部 ID 被置空并给出诊断', () => {
  const result = parseGrades(gradesHtml, pack);
  assert.equal(result.channel, 'html');
  assert.equal(result.records.length, 4);
  assert.equal(result.records[0].courseName, '艺术导论');
  assert.equal(result.records[0].credits, 3.5);
  assert.equal(result.records[3].courseCode, '');
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'internal-course-id-filtered'));
});
test('考试 HTML：中文日期和斜杠日期都能生成提醒时间', () => {
  const result = parseExams(examsHtml, pack);
  assert.equal(result.channel, 'html');
  assert.equal(result.records.length, 3);
  assert.equal(result.records[1].startAt, Date.UTC(2026, 3, 18, 14, 0));
  assert.equal(result.records[2].startAt, Date.UTC(2026, 5, 20, 10, 20));
});

test('主工程现有脱敏考试样本也能识别', () => {
  const legacy = read('../fixtures/jwglxt-exam.sample.html');
  const result = parseExams(legacy, pack);
  assert.equal(result.records.length, 9);
  assert.equal(result.records[0].courseName.length > 0, true);
  assert.equal(result.records[0].startAt !== null, true);
});

console.log('\n--- 改版演练 ---');
test('列顺序颠倒后仍能靠别名表识别', () => {
  const table = parseHtmlTable(gradesHtml);
  const order = table.headers.slice();
  const nameIndex = order.indexOf('课程名称');
  const creditIndex = order.indexOf('学分');
  [order[nameIndex], order[creditIndex]] = [order[creditIndex], order[nameIndex]];
  const rows = table.rows.map((row) => order.map((header) => row[header] || ''));
  const result = parseGrades(tableHtml(order, rows), pack);
  assert.equal(result.records.length, 4);
  assert.equal(result.records[0].courseName, '艺术导论');
  assert.equal(result.records[0].credits, 3.5);
});
test('表头改名后仍能识别', () => {
  const changed = gradesHtml.replace('<th>课程名称</th>', '<th>课程</th>');
  const result = parseGrades(changed, pack);
  assert.equal(result.records.length, 4);
  assert.equal(result.records[0].courseName, '艺术导论');
});
test('删掉可选的绩点列只降级，不影响其他字段', () => {
  const table = parseHtmlTable(gradesHtml);
  const headers = table.headers.filter((header) => header !== '绩点');
  const rows = table.rows.map((row) => headers.map((header) => row[header] || ''));
  const result = parseGrades(tableHtml(headers, rows), pack);
  assert.equal(result.records.length, 4);
  assert.ok(result.records.every((record) => record.point === null));
  assert.equal(result.records[0].courseName, '艺术导论');
});

console.log('\n--- 边界与隐私 ---');
test('解析路径不发起网络请求', () => {
  const originalFetch = (globalThis as any).fetch;
  let calls = 0;
  (globalThis as any).fetch = () => {
    calls++;
    throw new Error('网络被测试禁用');
  };
  try {
    parseGrades(gradesHtml, pack);
    parseExams(examsJson, pack);
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
  assert.equal(calls, 0);
});
test('诊断与统计不含课程名、教师名或学号', () => {
  const result = parseGrades(gradesHtml, pack);
  const text = JSON.stringify(result.diagnostics) + JSON.stringify(result.stats);
  for (const secret of ['艺术导论', '教师A', '2025040999']) assert.equal(text.includes(secret), false);
});
test('解析失败时保留上一次成功数据', () => {
  const previous = parseGrades(gradesHtml, pack);
  const next = parseGrades('<html><body>没有表格</body></html>', pack);
  const kept = keepLastSuccessful(previous, next);
  assert.equal(kept.kept, true);
  assert.equal(kept.result.records.length, previous.records.length);
  assert.ok(kept.result.diagnostics.some((diagnostic) => diagnostic.code === 'last-success-kept'));
});
test('空表格不伪造成绩或 GPA', () => {
  const result = parseGrades('<table><tr><th>课程名称</th><th>成绩</th></tr></table>', pack);
  assert.equal(result.records.length, 0);
  assert.equal(JSON.stringify(result).includes('gpa'), false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'no-records'));
});
test('菜单链接发现不靠硬编码学校 URL', () => {
  const entries = discoverMenuEntries(gradesHtml);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].kind, 'grades');
  assert.equal(entries[1].kind, 'exams');
  assert.equal(entries[2].kind, 'timetable');
});
test('宽松数字、GPA 与考试时间函数', () => {
  assert.equal(parseNumberLoose('3.5 学分'), 3.5);
  assert.equal(extractGpa('平均学分绩点：3.62 / 4.0'), 3.62);
  const time = parseExamTime('2026-07-04 08:00-10:00');
  assert.equal(time.date, '2026-07-04');
  assert.equal(time.start, '08:00');
  assert.equal(time.end, '10:00');
  assert.equal(time.ok, true);
});

console.log('\n结果：' + passed + ' 通过 / ' + failures.length + ' 失败');
if (failures.length) {
  console.log(failures.map((failure) => '  ✗ ' + failure).join('\n'));
  process.exit(1);
}