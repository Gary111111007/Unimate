// 教务系统「考试信息查询」解析器 Golden Test（v2.17 新增的考试查询功能）。
// 样本 fixtures/jwglxt-exam.sample.html 由 scripts/make-exam-fixture.mjs 从真实页面抽取并脱敏
// （真实页面含学号，按项目规则不入库）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseJwglxtExams, parseExamTime, parseExamRow, examNoteDraft, EXAM_ALARMS } from '../src/services/parser/jwglxtExam.ts';
import { buildExamSampleHtml } from '../src/services/examDemo.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'fixtures', 'jwglxt-exam.sample.html'), 'utf8');

let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? ' -> ' + extra : ''));
}

console.log('--- 样本脱敏检查 ---');
ok('样本里没有真实学号 2025040140', !html.includes('2025040140'));
ok('样本里是脱敏学号 2025040999', html.includes('2025040999'));

console.log('\n--- 整表解析（脱敏样本 9 条考试）---');
const r = parseJwglxtExams(html);
ok('解析出 9 条考试', r.exams.length === 9, String(r.exams.length));
ok('没有 no-table 诊断', !r.diagnostics.some((d) => d.kind === 'no-table'));
ok('没有 missing-fields（时间都能识别）', !r.diagnostics.some((d) => d.kind === 'missing-fields'), JSON.stringify(r.diagnostics.slice(0, 2)));

const first = r.exams[0];
ok('第一条按时间升序是 2026-05-08 的高数期中', first.date === '2026-05-08' && first.start === '18:00', JSON.stringify(first));
const phys = r.exams.filter((e) => e.course.includes('普通物理'));
ok('普通物理有两场（期中 + 期末）', phys.length === 2, JSON.stringify(phys.map((e) => e.date + '/' + e.name)));
{
  const fin = phys.find((e) => e.date === '2026-07-04')!;
  ok('期末场：课程名', fin.course === '普通物理(Ⅰ)', fin.course);
  ok('期末场：时间 08:00-10:00', fin.start === '08:00' && fin.end === '10:00', fin.start + '-' + fin.end);
  ok('期末场：场地与校区', fin.room === '二教D-106' && fin.campus === '北区', fin.room + '/' + fin.campus);
  ok('期末场：座位号', fin.seat === '52', fin.seat);
  ok('期末场：考试名称与方式', fin.name === '期末考试' && fin.mode === '笔试', fin.name + '/' + fin.mode);
  ok('期末场：学年学期', fin.semester.includes('2025-2026'), fin.semester);
  ok('期末场：开课学院', fin.college === '数理学院', fin.college);
}
ok('结果按时间升序排列', r.exams.every((e, i) => i === 0 || (r.exams[i - 1].date + r.exams[i - 1].start) <= (e.date + e.start)));
ok('解析结果里没有任何学号字段（不采集个人信息）',
  !JSON.stringify(r.exams).includes('2025040'), JSON.stringify(r.exams[0]).slice(0, 80));

console.log('\n--- 时间格式变体 ---');
const variants: [string, string, string, string][] = [
  ['2026-07-04(08:00-10:00)', '2026-07-04', '08:00', '10:00'],
  ['2026-07-04 08:00-10:00', '2026-07-04', '08:00', '10:00'],
  ['2026-07-04（8:00-10:00）', '2026-07-04', '08:00', '10:00'],
  ['2026年7月4日 08:00~10:00', '2026-07-04', '08:00', '10:00'],
  ['2026/7/4 8:00—10:00', '2026-07-04', '08:00', '10:00'],
  ['2026-07-04(14:30-16:30)', '2026-07-04', '14:30', '16:30']
];
for (const [input, d, s, e] of variants) {
  const got = parseExamTime(input);
  ok('时间变体：' + input, got.length === 1 && got[0].date === d && got[0].start === s && got[0].end === e, JSON.stringify(got));
}
ok('一个单元格两个时段 → 两条', parseExamTime('2026-07-04(08:00-10:00) 2026-07-05(08:00-10:00)').length === 2);
ok('没有时间的单元格 → 0 条', parseExamTime('待定').length === 0);

console.log('\n--- 行解析与降级 ---');
ok('缺课程名的行被跳过', parseExamRow({ kssj: '2026-07-04(08:00-10:00)' } as any).length === 0);
ok('缺时间的行被跳过', parseExamRow({ kcmc: '高等数学' } as any).length === 0);
{
  const empty = parseJwglxtExams('<table><tbody><tr><td role="gridcell" aria-describedby="tabGrid_kcmc"></td></tr></tbody></table>');
  ok('空骨架行 → 0 条 + no-table 诊断', empty.exams.length === 0 && empty.diagnostics.some((d) => d.kind === 'no-table'), JSON.stringify(empty.diagnostics));
}
{
  const q = parseJwglxtExams('<tr><td aria-describedby="tabGrid_kcmc">高等数学</td><td aria-describedby="tabGrid_kssj">时间待定</td></tr>');
  ok('有行但时间识别不了 → 报 missing-fields', q.diagnostics.some((d) => d.kind === 'missing-fields'), JSON.stringify(q.diagnostics));
}

console.log('\n--- 写入记事本的草稿（提前一天 + 提前半小时）---');
ok('提前量就是 [1440, 30]', EXAM_ALARMS.join(',') === '1440,30', EXAM_ALARMS.join(','));
{
  const ex = r.exams.find((e) => e.date === '2026-07-04')!;
  const draft = examNoteDraft(ex, new Date('2026-01-01T00:00:00'));
  ok('标题含课程名与考试名称', draft.title.includes('普通物理') && draft.title.includes('期末'), draft.title);
  ok('提醒时刻 = 考试开始时刻', draft.remindAt === '2026-07-04 08:00:00', draft.remindAt);
  ok('提前量 = 一天 + 半小时', draft.alarms.join(',') === '1440,30', draft.alarms.join(','));
  ok('内容含时间/地点/座位', draft.content.includes('08:00-10:00') && draft.content.includes('二教D-106') && draft.content.includes('座位 52'), draft.content);
  ok('未来的考试 past=false', draft.past === false, String(draft.past));
  const pastDraft = examNoteDraft(ex, new Date('2027-01-01T00:00:00'));
  ok('已过的考试 past=true（提醒排不进去要能说清）', pastDraft.past === true, String(pastDraft.past));
}
{
  const mid = r.exams.find((e) => e.name === '期中考试')!;
  const draft = examNoteDraft(mid, new Date('2026-01-01T00:00:00'));
  ok('期中考试的标题带"期中"', draft.title.includes('期中'), draft.title);
}

console.log('\n--- 演示样本（走同一条解析链路，日期必须落在未来）---');
{
  const now = new Date('2026-09-20T10:00:00');
  const demo = buildExamSampleHtml(now);
  const d = parseJwglxtExams(demo);
  ok('演示样本能被同一个解析器读出来', d.exams.length === 4, String(d.exams.length));
  ok('演示样本没有 no-table 诊断', !d.diagnostics.some((x) => x.kind === 'no-table'));
  ok('演示样本用的是脱敏学号', demo.includes('2025040999') && !demo.includes('2025040140'));
  ok('演示样本日期 = 今天 +2 / +9 / +16 / +23 天',
    JSON.stringify(d.exams.map((e) => e.date)) === JSON.stringify(['2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13']),
    JSON.stringify(d.exams.map((e) => e.date)));
  ok('所有演示考试都在未来（否则提醒排不进去）', d.exams.every((e) => new Date(e.date + ' ' + e.start + ':00').getTime() > now.getTime()));
  ok('最近一场在 2 天后（"提前 1 天"的提醒明天就会响，便于演示）',
    d.exams[0].date === '2026-09-22' && d.exams[0].start === '09:00', JSON.stringify(d.exams[0]));
  ok('含期中与期末两种考试名称',
    d.exams.some((e) => e.name === '期中考试') && d.exams.some((e) => e.name === '期末考试'),
    d.exams.map((e) => e.name).join('/'));
  ok('演示样本写入草稿时 past 全为 false（会真的排提醒）',
    d.exams.every((e) => examNoteDraft(e, now).past === false));
  ok('演示样本带场地/校区/座位，记事内容可核对',
    d.exams.every((e) => e.room && e.campus && e.seat), JSON.stringify(d.exams[0]));
}

console.log('\n结果：' + pass + ' 通过 / ' + fails.length + ' 失败');
for (const f of fails) console.log('  ✗ ' + f);
if (fails.length) process.exit(1);
