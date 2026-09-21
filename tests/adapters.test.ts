// 解析适配器热更新（Net.md P2.5 / PRD 5.15）测试：**完全不联网**。
//
// 这一套要证明的核心就一件事（也是 Net.md 给的验收）：
//   **人为把教务页面改一版（模拟改版）→ 内置解析器解析不出来 → 下发一份声明式规则包 → 不用发版就能解析成功。**
// 外加两条安全边界：规则包只有白名单键 + 正则必须能编译 + 绝不允许夹带可执行代码。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseJwglxtTimetable, matches as ttMatches } from '../src/services/parser/jwglxtBuct.ts';
import { parseJwglxtExams, matches as examMatches } from '../src/services/parser/jwglxtExam.ts';
import {
  BUILTIN_ADAPTER_VERSIONS, TIMETABLE_DEFAULTS, EXAM_DEFAULTS, validateRulePack,
  setActiveRulePacks, timetableRules, examRules, activeRulePacks, compile, type RulePack
} from '../src/services/parser/rules.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? ' -> ' + extra : ''));
}

const ttHtml = read('fixtures/jwglxt-buct.sample.html');
const examHtml = read('fixtures/jwglxt-exam.sample.html');

// ---------------- A. 规则包校验：白名单 + 正则可编译 + 不许夹带代码 ----------------
console.log('--- 规则包校验（只允许声明式规则） ---');
{
  const good = { schemaVersion: 1, adapterId: 'jwglxt-buct', kind: 'timetable', version: 2, note: 'x', rules: { tableMarkers: ['id="kbgrid_table_0"'] } };
  ok('正常规则包通过', validateRulePack(good).ok === true, JSON.stringify(validateRulePack(good)));
  ok('不认识的键 → 拒收', validateRulePack({ ...good, rules: { ...good.rules, runJs: 'alert(1)' } }).ok === false);
  ok('正则编译不过 → 拒收', validateRulePack({ ...good, rules: { cellPattern: '([unclosed' } }).ok === false);
  ok('kind 不合法 → 拒收', validateRulePack({ ...good, kind: 'magic' }).ok === false);
  ok('adapterId 不合法 → 拒收', validateRulePack({ ...good, adapterId: 'A B' }).ok === false);
  ok('schemaVersion 比 App 新 → 拒收（提示升级）', validateRulePack({ ...good, schemaVersion: 2 }).ok === false);
  ok('version 缺失/0 → 拒收', validateRulePack({ ...good, version: 0 }).ok === false);
  ok('groupSize 越界 → 拒收', validateRulePack({ ...good, rules: { groupSize: 999 } }).ok === false);
  ok('fieldMap 里不认识的键 → 拒收', validateRulePack({ ...good, rules: { fieldMap: { nickname: 3 } } }).ok === false);
  ok('fieldMap 取值越界 → 拒收', validateRulePack({ ...good, rules: { fieldMap: { teacher: 99 } } }).ok === false);
  ok('课型符号值不合法 → 拒收', validateRulePack({ ...good, rules: { lessonSymbols: { '★': 'magic' } } }).ok === false);
  ok('tableMarkers 传字符串（不是数组）→ 拒收', validateRulePack({ ...good, rules: { tableMarkers: 'x' } }).ok === false);
  ok('pendingPatterns 里混进编译不了的正则 → 拒收', validateRulePack({ ...good, rules: { pendingPatterns: ['['] } }).ok === false);
  ok('考试包走同一套校验（columns 白名单）', validateRulePack({ schemaVersion: 1, adapterId: 'jwglxt-exam', kind: 'exam', version: 2, rules: { columns: { course: 'kcmc', unknown: 'x' } } }).ok === false);
  ok('超长字符串 → 拒收（防呆）', validateRulePack({ ...good, rules: { tableEndTag: 'x'.repeat(500) } }).ok === false);
}

// ---------------- B. 生效口径：只激活"版本高于内置"的包 ----------------
console.log('\n--- 生效口径 ---');
{
  const pack = (version: number): RulePack => ({ schemaVersion: 1, adapterId: 'jwglxt-buct', kind: 'timetable', version, note: '', rules: { tableMarkers: ['MARK'] } });
  setActiveRulePacks({});
  ok('默认用内置规则', timetableRules().tableMarkers[0] === TIMETABLE_DEFAULTS.tableMarkers[0], JSON.stringify(timetableRules().tableMarkers));
  setActiveRulePacks({ 'jwglxt-buct': pack(1) });      // 与内置同版本
  ok('版本不高于内置 → 不激活（仍用内置）', timetableRules().tableMarkers[0] === TIMETABLE_DEFAULTS.tableMarkers[0]);
  ok('未激活的包不出现在生效列表里', Object.keys(activeRulePacks()).length === 0);
  setActiveRulePacks({ 'jwglxt-buct': pack(2) });      // 高于内置
  ok('版本高于内置 → 激活', timetableRules().tableMarkers[0] === 'MARK', JSON.stringify(timetableRules().tableMarkers));
  ok('只覆盖声明过的键，其余沿用内置',
    timetableRules().tableEndTag === TIMETABLE_DEFAULTS.tableEndTag
    && timetableRules().fieldMap.teacher === TIMETABLE_DEFAULTS.fieldMap.teacher
    && timetableRules().lessonSymbols['★'] === 'lecture');
  ok('考试规则不受课表包影响', examRules().rowPattern === EXAM_DEFAULTS.rowPattern);
  ok('kind 与包不匹配时不用它', timetableRules() && (setActiveRulePacks({ 'jwglxt-exam': { ...pack(9), adapterId: 'jwglxt-exam', kind: 'exam', rules: { rowPattern: 'ROW' } } }), examRules().rowPattern === 'ROW'));
  setActiveRulePacks({});
  ok('清空后回到内置', timetableRules().tableMarkers[0] === TIMETABLE_DEFAULTS.tableMarkers[0]);
  ok('内置版本表有这两个适配器', BUILTIN_ADAPTER_VERSIONS['jwglxt-buct'] >= 1 && BUILTIN_ADAPTER_VERSIONS['jwglxt-exam'] >= 1, JSON.stringify(BUILTIN_ADAPTER_VERSIONS));
  ok('compile() 对坏正则返回 null（调用方回落到默认值）', compile('([a-') === null && compile('a') !== null);
}

// ---------------- C. 课表：模拟教务改版 → 内置解析不出来 → 下发规则包后解析成功 ----------------
console.log('\n--- 课表改版演练（Net.md 2.4 的验收场景） ---');
{
  // 三处真实改版形态：① 表格 id 换了 ② 课程块 class 换了 ③ 节次行格式从 (1-2节) 变成 [1-2节]
  const broken = ttHtml
    .split('id="kbgrid_table_0"').join('id="kbgrid_table_v2027"')
    .split('class="timetable_con').join('class="timetable_block')
    .replace(/\((\d+)-(\d+)节\)/g, '[$1-$2节]');
  const before = parseJwglxtTimetable(broken);
  ok('改版后内置解析器确实解析不出来（先证明这个场景是真坏的）',
    before.courses.length === 0 && before.diagnostics.some((d) => d.kind === 'no-table' || d.kind === 'no-courses'),
    JSON.stringify(before.diagnostics.slice(0, 2)));

  const pack: RulePack = {
    schemaVersion: 1, adapterId: 'jwglxt-buct', kind: 'timetable', version: 2,
    note: '2027 春季改版：表格 id / 课程块 class / 节次行格式都变了',
    rules: {
      tableMarkers: ['id="kbgrid_table_v2027"'],
      blockSplitMarker: 'class="timetable_block',
      sectionPattern: '^\\[(\\d+)-(\\d+)节\\](.*)$'
    }
  };
  setActiveRulePacks({ 'jwglxt-buct': pack });
  const after = parseJwglxtTimetable(broken);
  ok('下发规则包后：解析出 25 条上课安排', after.courses.length === 25, String(after.courses.length));
  ok('下发后课程名/节次/周次都对得上（不是"能跑但解析错"）', (() => {
    const c = after.courses.find((x) => x.name === '复变函数与积分变换（A）');
    return !!c && c.day === 1 && c.startPeriod === 1 && c.endPeriod === 2 && c.weeks.length === 14;
  })(), JSON.stringify(after.courses[0] || {}));
  ok('下发后表头（学期/姓名/学号）也能解析', /2026-2027/.test(after.semesterLabel) && after.studentName.length > 0, after.semesterLabel + '/' + after.studentName);
  ok('规则包能改"这一页归不归我管"的判断', ttMatches('https://jwglxt.buct.edu.cn/随便什么', broken) === true);
  setActiveRulePacks({});
  ok('回到内置后，改版页面又解析不出来了（说明刚才确实是规则的功劳）', parseJwglxtTimetable(broken).courses.length === 0);
  ok('内置样本仍然正常（规则层默认值没被改坏）', parseJwglxtTimetable(ttHtml).courses.length === 25);
}

// ---------------- D. 考试：模拟列名改版 → 规则包改列映射 ----------------
console.log('\n--- 考试列名改版演练 ---');
{
  // 教务把考试时间列的后缀从 kssj 改成 kssj_new（列还在，但列名变了）
  const broken = examHtml.split('tabGrid_kssj').join('tabGrid_kssj_new');
  const before = parseJwglxtExams(broken);
  ok('改版后内置解析器解析不出考试（先证明场景是真坏的）', before.exams.length === 0, String(before.exams.length));
  const pack: RulePack = {
    schemaVersion: 1, adapterId: 'jwglxt-exam', kind: 'exam', version: 2,
    note: '2027 改版：考试时间列名 kssj → kssj_new',
    // 列名怎么从 aria-describedby 里切出来也变了，所以连 colNameSeparator 一起改
    rules: { colNameSeparator: 'tabGrid_', columns: { time: 'kssj_new' } }
  };
  setActiveRulePacks({ 'jwglxt-exam': pack });
  const after = parseJwglxtExams(broken);
  ok('下发规则包后：考试条数 >= 9', after.exams.length >= 9, String(after.exams.length));
  ok('下发后时间/课程都对', (() => {
    const e = after.exams[0];
    return !!e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && /^\d{2}:\d{2}$/.test(e.start) && e.course.length > 0;
  })(), JSON.stringify(after.exams[0] || {}));
  ok('考试包的 matchUrl/htmlMarker 生效', examMatches('https://jwglxt.buct.edu.cn/x', broken) === true);
  setActiveRulePacks({});
  ok('回到内置后改版页面又解析不出来', parseJwglxtExams(broken).exams.length === 0);
  ok('内置样本仍然正常', parseJwglxtExams(examHtml).exams.length >= 9);
}

// ---------------- E. 结构：规则层是唯一真相，界面接线齐全 ----------------
console.log('\n--- 结构断言 ---');
{
  const tt = read('src/services/parser/jwglxtBuct.ts');
  const ex = read('src/services/parser/jwglxtExam.ts');
  const rules = read('src/services/parser/rules.ts');
  /** 只看代码、不看注释：注释里会解释"原来是 tabGrid_xxx"，不算硬编码 */
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  ok('课表解析器里不再硬编码表格 id / 课程块 class', !/kbgrid_table_0/.test(tt) && !/class="timetable_con/.test(tt), '');
  ok('考试解析器里不再硬编码列名 tabGrid', !/tabGrid_|aria-describedby/.test(stripComments(ex)), '');
  ok('两个解析器都从规则层取规则', /timetableRules\(/.test(tt) && /examRules\(/.test(ex), '');
  ok('规则层没有任何 eval/Function/动态 import（不执行远端代码）',
    !/\beval\(|new Function|import\(/.test(rules), '');
  ok('键白名单是显式列表（不是"随便传"）', /allowed: string\[\]/.test(rules) && /不认识的规则键/.test(rules), '');
  const bar = read('src/components/ParserRulesBar.vue');
  ok('导入面板与考试面板都显示"当前用的是内置还是规则包"',
    read('src/views/ImportPanel.vue').includes('ParserRulesBar') && read('src/views/ExamPanel.vue').includes('ParserRulesBar'), '');
  ok('"回到内置"走二次确认', /async function backToBuiltin[\s\S]{0,400}db\.confirm\(/.test(bar), '');
  const svc = read('src/services/schoolCatalog.ts');
  ok('规则包与学校档案共用同一份签名清单（adapters 字段）', /adapters: AdapterEntry\[\]/.test(svc) && /downloadAdapterPack/.test(svc), '');
  ok('规则包下载也要过 sha256 + 结构校验', /sha256Hex\(norm\)/.test(svc) && /validateRulePack\(json\)/.test(svc), '');
  const db = read('src/stores/db.ts');
  ok('启动时在任何解析之前激活规则包', /setActiveRulePacks\(packs\)/.test(db), '');
  ok('规则包落盘（重启仍生效）', /adapters\/downloaded\.json/.test(db), '');
  const pack = read('scripts/make-school-pack.mjs');
  ok('下发工具会把规则包一起签名（同一份 index）', /adapters: adapters\.map/.test(pack), '');
  ok('下发工具挡掉夹带可执行代码的规则', /只允许声明式规则/.test(pack), '');
}

console.log('\n结果：' + pass + ' 通过 / ' + fails.length + ' 失败');
for (const f of fails) console.log('  ✗ ' + f);
if (fails.length) process.exit(1);
