// 高校档案测试（v2.21 新增北二外，第二所落地高校）。
// 重点守三件事：
//  1) 落地状态与名单顺序（谁"已可使用"、谁还是"开发中"）；
//  2) 北二外的两种特殊性：**没有第二课堂**、**节次时间与北化不同**（都来自产品负责人给的截图）；
//  3) 没核实过的网址一律不收录（宁可少一个入口，也不能把学生引到错误站点）。
import { SCHOOLS, findSchool, profileFor, BISU_PROFILE } from '../src/catalog/universities.ts';
import { buildDemoBisuCourses } from '../src/services/demo.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');

let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? ' -> ' + extra : ''));
}

console.log('--- 名单与落地状态 ---');
ok('名单总数为 53 所（新增北二外）', SCHOOLS.length === 53, String(SCHOOLS.length));
const live = SCHOOLS.filter((s) => s.status === 'live');
ok('落地高校正好两所', live.length === 2, live.map((s) => s.name).join('/'));
ok('北化仍是首个落地（order=0）', findSchool('buct')?.order === 0);
ok('北二外在名单里且已可使用', findSchool('bisu')?.status === 'live');
ok('北二外按拼音排在"北京大学"之后、"北京工业大学"之前', (() => {
  const pku = SCHOOLS.findIndex((s) => s.schoolId === 'pku');
  const bisu = SCHOOLS.findIndex((s) => s.schoolId === 'bisu');
  const bjut = SCHOOLS.findIndex((s) => s.schoolId === 'bjut');
  return pku < bisu && bisu < bjut;
})(), SCHOOLS.slice(1, 5).map((s) => s.shortName).join(','));
ok('除了这两所，其余仍是"开发中"', SCHOOLS.filter((s) => s.status !== 'live').length === 51, '');
ok('名次无重复', new Set(SCHOOLS.map((s) => s.order)).size === SCHOOLS.length, '');
ok('开发中的学校拿不到档案（进不去）', profileFor('pku') === null && profileFor('thu') === null);

console.log('\n--- 北二外档案：没有第二课堂 ---');
const p = profileFor('bisu')!;
ok('档案能取到', !!p && p.name === '北京第二外国语学院', p && p.name);
ok('简称是"北二外"', p.shortName === '北二外', p.shortName);
ok('第三栏叫"校园服务"', p.tabs.online === '校园服务', p.tabs.online);
ok('secondClass.enabled = false', p.secondClass.enabled === false, String(p.secondClass.enabled));
ok('第二栏标签改成"活动材料"', p.secondClass.label === '活动材料', p.secondClass.label);
ok('说明里讲清"不套用北化的分值表"', /不会套用北京化工大学的第二课堂分值表/.test(p.secondClass.notice || ''), p.secondClass.notice || '');
ok('说明里讲清"仍可记录本地材料"', /志愿时长/.test(p.secondClass.notice || '') && /劳育时长/.test(p.secondClass.notice || ''), '');
ok('不挂任何手册规则包', p.secondClass.rulePack === '' && p.secondClass.blocks.length === 0, '');
ok('北化仍是 enabled=true（回归）', profileFor('buct')!.secondClass.enabled === true);
ok('北化第二栏标签没被改坏', profileFor('buct')!.secondClass.label === '第二课堂');

console.log('\n--- 北二外档案：节次时间（逐条对照课表截图）---');
const want = [
  ['08:00', '08:45'], ['08:50', '09:35'], ['09:50', '10:35'], ['10:40', '11:25'], ['11:30', '12:15'],
  ['13:20', '14:05'], ['14:10', '14:55'], ['15:10', '15:55'], ['16:00', '16:45'], ['16:50', '17:35'],
  ['18:30', '19:15'], ['19:20', '20:05']
];
ok('正好 12 节', p.academic.periodTimes.length === 12, String(p.academic.periodTimes.length));
ok('12 节时间与截图逐条一致', want.every(([s, e], i) => p.academic.periodTimes[i].period === i + 1 && p.academic.periodTimes[i].start === s && p.academic.periodTimes[i].end === e),
  JSON.stringify(p.academic.periodTimes));
ok('与北化的节次表确实不同（不是复制粘贴）', (() => {
  const b = profileFor('buct')!.academic.periodTimes;
  return b.some((x, i) => x.start !== p.academic.periodTimes[i].start || x.end !== p.academic.periodTimes[i].end);
})(), '');
ok('学期第一周周一 = 2026-09-07', p.academic.semesterStartMonday === '2026-09-07', p.academic.semesterStartMonday);
ok('按这个首周算，2026-09-14 正好是第 2 周（与截图的"第2周"一致）', (() => {
  const monday = new Date(p.academic.semesterStartMonday.replace(/-/g, '/') + ' 00:00:00');
  const d = new Date('2026/09/14 00:00:00');
  return Math.floor((d.getTime() - monday.getTime()) / 86400000 / 7) + 1 === 2;
})(), '');

console.log('\n--- 北二外档案：校园服务入口 ---');
ok('入口都写了 desc', p.campusApps.every((a) => !!a.desc), '');
ok('入口 key 不重复', new Set(p.campusApps.map((a) => a.key)).size === p.campusApps.length, '');
ok('入口地址都是 https', p.campusApps.every((a) => a.url.startsWith('https://')), JSON.stringify(p.campusApps.map((a) => a.url)));
ok('带一个"考试查询"（识别考试 → 记事本提醒）', p.campusApps.some((a) => a.action === 'exam'), '');
ok('考试查询指向正方同模块路径', p.campusApps.some((a) => a.action === 'exam' && /kscx_cxXsksxxIndex/.test(a.url)), '');
ok('只收录已核实的 3 个地址，未核实的"移动校园/智慧教学"没有硬编进去',
  p.campusApps.length === 3 && !p.campusApps.some((a) => /移动校园|智慧教学/.test(a.name)),
  p.campusApps.map((a) => a.name).join('/'));
ok('教务系统用同一套正方解析器（导师类同族）', p.systems.timetableAdapter === 'jwglxt-buct', p.systems.timetableAdapter);
ok('水印角标是本校校名', p.watermark.schoolBadgeText === '北京第二外国语学院', p.watermark.schoolBadgeText);
ok('数据目录按学校隔离', p.dataDir === 'schools/bisu', p.dataDir);
ok('导出的常量与 profileFor 内容一致', BISU_PROFILE.schoolId === 'bisu' && BISU_PROFILE.secondClass.enabled === false);

console.log('\n--- 北二外演示课表 ---');
const demo = buildDemoBisuCourses();
ok('演示课表 12 条（截图里能看到的课都在）', demo.length === 12, String(demo.length));
ok('星期都在 1~7、节次都在 1~12、起止不倒挂',
  demo.every((c) => (c.day || 0) >= 1 && (c.day || 0) <= 7 && (c.startPeriod || 0) >= 1 && (c.endPeriod || 0) <= 12 && (c.startPeriod || 0) <= (c.endPeriod || 0)),
  JSON.stringify(demo[0]));
ok('每条都有周次与教室', demo.every((c) => (c.weeks || []).length > 0 && !!c.room), '');
ok('抽查三门课与截图一致', (() => {
  const by = (n: string) => demo.find((c) => c.name === n);
  return by('综合英语(Ⅰ)')?.day === 3 && by('综合英语(Ⅰ)')?.startPeriod === 1 && by('综合英语(Ⅰ)')?.room === '求知楼410'
    && by('旅游大数据')?.day === 4 && by('旅游大数据')?.startPeriod === 8 && by('旅游大数据')?.room === '求是楼808'
    && by('概率论与数理统计')?.day === 1 && by('概率论与数理统计')?.endPeriod === 12;
})(), JSON.stringify(demo.map((c) => c.name)));
ok('教师列留空（截图没有教师信息，不编造）', demo.every((c) => (c.teacher || '') === ''), '');

console.log('\n--- 界面是否真的按档案走（结构断言，防止只改了数据没改界面）---');
{
  const main = read('src/screens/Main.vue');
  ok('第 2 栏标签取自档案 secondClass.label', /label:\s*db\.profile\?\.secondClass\.label/.test(main), '');
  ok('第 2 栏图标按有没有二课区分', /secondClass\.label \|\| '第二课堂', icon: db\.profile\?\.secondClass\.enabled \? '🏅' : '📌'/.test(main), '');
  ok('页面标题栏也跟着改（不再写死"第二课堂"）', /if \(db\.activeTab === 1\) return db\.profile\?\.secondClass\.label/.test(main), '');
}
{
  const sc = read('src/views/SecondClassView.vue');
  ok('二课 sheet 被 hasErke 拦住', /v-if="sheet === 'erke' && hasErke"/.test(sc), '');
  ok('没有二课时不显示"二课填报"入口', /v-if="hasErke"[^>]*>🏅 二课填报/.test(sc), '');
  ok('没有二课时不显示"填报活动"悬浮按钮', /v-if="sheet === 'erke' && hasErke" class="fab"/.test(sc), '');
  ok('显示"本校专属活动规则尚未核实"的说明卡', sc.includes('本校专属活动规则尚未核实') && /secondClass\.notice/.test(sc), '');
  ok('切换学校后不会停在空的二课页', /watch\(hasErke/.test(sc), '');
}
{
  const me = read('src/views/MeView.vue');
  ok('"我的"页按有无二课切换卡片', /db\.profile\?\.secondClass\.enabled/.test(me), '');
  ok('没有二课时显示两本时长台账', /活动材料累计/.test(me) && /hourTotal\('volunteer'\)/.test(me), '');
}
{
  const picker = read('src/screens/SchoolPicker.vue');
  ok('只有 order=0 才写"首个落地高校"', /s\.order === 0 \? '首个落地高校 · 已可使用' : '已可使用'/.test(picker), '');
  ok('列表副标题按学校区分二课/活动材料', /活动材料（无二课）/.test(picker), '');
}
{
  const db = read('src/stores/db.ts');
  ok('演示数据按学校分支（北二外走内置课表）', /p\.schoolId === 'bisu'/.test(db) && /buildDemoBisuCourses/.test(db), '');
  ok('没有二课的学校不生成二课演示记录', /if \(p\.secondClass\.enabled\) \{[\s\S]{0,200}buildDemoRecords/.test(db), '');
  ok('演示课表标题跟着学校走', /buildDemoTimetable\(p\.name/.test(db), '');
}

console.log('\n结果：' + pass + ' 通过 / ' + fails.length + ' 失败');
for (const f of fails) console.log('  ✗ ' + f);
if (fails.length) process.exit(1);
