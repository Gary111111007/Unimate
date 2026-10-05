// P4 主工程整合：academic 规则校验、双通道解析、本机存储与云同步隔离。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAcademicExams, parseAcademicGrades } from '../src/services/parser/academic.ts';
import { parseJwglxtExams } from '../src/services/parser/jwglxtExam.ts';
import { academicRules, setActiveRulePacks, validateRulePack, type RulePack } from '../src/services/parser/rules.ts';
import { textFilesFor } from '../src/services/backup.ts';
import { parseAdapterEntry } from '../src/services/schoolCatalog.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const gradesJson = read('fixtures/academic-grades.sample.json');
const gradesHtml = read('fixtures/academic-grades.sample.html');
const examsJson = read('fixtures/academic-exams.sample.json');
const examsHtml = read('fixtures/academic-exams.sample.html');
const legacyExamHtml = read('fixtures/jwglxt-exam.sample.html');
const jqgridExamHtml = read('fixtures/academic-exams-jqgrid.sample.html');

let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? ' -> ' + extra : ''));
}

console.log('--- academic 规则包 ---');
{
  const pack: RulePack = {
    schemaVersion: 1, adapterId: 'academic-buct', kind: 'academic', version: 2,
    note: '测试', rules: {
      schoolId: 'buct', menuHints: ['jwglxt'], payloadArrayPriority: ['records'],
      scopes: { grades: { aliases: { courseName: ['课程名称', 'kcmc'] } }, exams: { aliases: { examTime: ['考试时间'] } } }
    }
  };
  ok('academic 规则包通过白名单校验', validateRulePack(pack).ok === true);
  ok('签名清单接受 academic kind', parseAdapterEntry({ id: 'academic-buct', kind: 'academic', version: 2, file: 'academic-buct.json', sha256: 'a'.repeat(64), size: 1 }) !== null);
  ok('未知成绩字段被拒收', validateRulePack({ ...pack, rules: { ...pack.rules, scopes: { grades: { aliases: { evil: ['x'] } } } } }).ok === false);
  ok('未知 scope 被拒收', validateRulePack({ ...pack, rules: { ...pack.rules, scopes: { homework: { aliases: {} } } } }).ok === false);
  setActiveRulePacks({ 'academic-buct': pack });
  ok('下发 academic 包能覆盖别名', academicRules('academic-buct').scopes.grades!.aliases.courseName[0] === '课程名称');
  setActiveRulePacks({});
}

console.log('\n--- 双通道解析 ---');
{
  const gj = parseAcademicGrades(gradesJson);
  const gh = parseAcademicGrades(gradesHtml);
  const ej = parseAcademicExams(examsJson);
  const eh = parseAcademicExams(examsHtml);
  const legacy = parseAcademicExams(legacyExamHtml);
  ok('成绩 JSON 解析 3 条', gj.records.length === 3, JSON.stringify(gj.diagnostics));
  ok('成绩 HTML 解析 4 条', gh.records.length === 4, JSON.stringify(gh.diagnostics));
  ok('考试 JSON 解析 3 条', ej.records.length === 3, JSON.stringify(ej.diagnostics));
  ok('考试 HTML 解析 3 条', eh.records.length === 3, JSON.stringify(eh.diagnostics));
  ok('主工程脱敏 jqGrid 考试样本解析 9 条', legacy.records.length === 9, String(legacy.records.length));
  ok('标准课号优先于内部 ID', gj.records.some((g) => g.courseCode === 'MATH1001A'));
  ok('考试时间生成 startAt', eh.records.every((e) => e.startAt !== null));
  ok('通用考试样本旧解析器确实无结果', parseJwglxtExams(examsHtml).exams.length === 0);
  ok('通用解析器能兜底这个样本（3 条）', parseAcademicExams(examsHtml).records.length === 3);
  const jqgridNoAria = jqgridExamHtml.replace(/\saria-describedby=\"[^\"]*\"/gi, '');
  const jqgridFallback = parseAcademicExams(jqgridNoAria);
  ok('缺少旧列标记时 jqGrid 能走通用兜底', parseJwglxtExams(jqgridNoAria).exams.length === 0 && jqgridFallback.records.length === 1, String(jqgridFallback.records.length));
  ok('jqGrid 分页栏不会被当成假考试', jqgridFallback.records.every((e) => !!e.examTime && !!e.date), JSON.stringify(jqgridFallback.records));
  ok('考试记录保留日期和起止时间', eh.records.every((e) => e.date.length > 0 && e.start.length > 0 && e.end.length > 0));
}

console.log('\n--- 本机持久化 / 不上云边界 ---');
{
  const dbSource = read('src/stores/db.ts');
  const backupSource = read('src/services/backup.ts');
  ok('store 有独立 grades 状态', /const grades = ref<GradeItem\[\]>\(\[\]\)/.test(dbSource));
  ok('loadUserData 读取 grades/grades.json', /grades\/grades\.json/.test(dbSource));
  ok('saveGrades 存在且不触发自动同步', (() => {
    const m = dbSource.match(/async function saveGrades[\s\S]*?\n  \}/);
    return !!m && !/notifyDataChanged/.test(m[0]);
  })());
  ok('cloud study 备份不包含成绩', !textFilesFor('study').some((f) => f.includes('grades')));
  ok('full 本机备份也暂不包含成绩', !textFilesFor('full').some((f) => f.includes('grades')));
  ok('backup.ts 没把 grades 加进打包清单', !/grades\/grades\.json/.test(backupSource));
  const gradePanel = read('src/views/GradePanel.vue');
  const onlineView = read('src/views/OnlineView.vue');
  const jwService = read('src/services/jwwebview.ts');
  const nativeActivity = read('android/app/src/main/java/com/unimate/app/JwWebViewActivity.java');
  const buctCatalog = read('src/catalog/universities.ts');
  ok('成绩面板接 parseAcademicGrades 和 saveGrades', /parseAcademicGrades/.test(gradePanel) && /db\.saveGrades\(\)/.test(gradePanel));
  ok('OnlineView 路由 grade action', /GradePanel/.test(onlineView) && /action === 'grade'/.test(onlineView));
  ok('WebView TS 接口支持 grade mode', /mode\?: 'timetable' \| 'exam' \| 'grade'/.test(jwService));
  ok('原生 WebView 支持识别成绩模式', /isGradeMode/.test(nativeActivity) && /识别成绩/.test(nativeActivity));
  ok('北化内置档案有成绩查询入口', /action: 'grade'/.test(buctCatalog));
  const examPanel = read('src/views/ExamPanel.vue');
  ok('考试面板接入通用 fallback', /parseAcademicExams/.test(examPanel) && /fromAcademicExam/.test(examPanel));
  ok('原生成绩模式支持自动分页', /scrapeGradePages/.test(nativeActivity) && /nextButtonJs/.test(nativeActivity) && /gradePageCount >= 20/.test(nativeActivity));
  ok('成绩解析器保留考试日期起止时间', /date: t.date, start: t.start, end: t.end/.test(read('src/services/parser/academic.ts')));
}

console.log('\n--- 离线边界 ---');
{
  const originalFetch = (globalThis as any).fetch;
  let calls = 0;
  (globalThis as any).fetch = () => { calls++; throw new Error('network disabled'); };
  try { parseAcademicGrades(gradesHtml); parseAcademicExams(examsHtml); } finally { (globalThis as any).fetch = originalFetch; }
  ok('解析过程不发网络请求', calls === 0, String(calls));
}

console.log('\n--- 本机 grades.json 实际读写 ---');
{
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear()
  };
  (globalThis as any).window = globalThis;
  const { createPinia, setActivePinia } = await import('pinia');
  const { useDb } = await import('../src/stores/db.ts');
  setActivePinia(createPinia());
  const db = useDb();
  db.session = { accountId: 'acc-grade-test', username: 'grade-test', displayName: '智小汇', isDemo: true };
  db.profile = { schoolId: 'buct' } as any;
  db.replaceGrades([{ courseCode: 'ART14000G', courseName: '艺术导论', credits: 3.5, score: '优秀', point: 3.8 }]);
  await db.saveGrades();
  const raw = mem.get('unimate:schools/buct/users/acc-grade-test/grades/grades.json');
  ok('saveGrades 真正写入本机 grades.json', !!raw && JSON.parse(raw).length === 1);
  ok('saveGrades 没有把成绩写进 STUDY_TEXT_FILES', !textFilesFor('study').some((f) => f.includes('grades')));
}
console.log('\n结果：' + pass + ' 通过 / ' + fails.length + ' 失败');
for (const f of fails) console.log('  ✗ ' + f);
if (fails.length) process.exit(1);
