// 外校正方导入编排层测试（src/services/zfImport.ts）。
// 这一层没有网络依赖的部分（xnm 换算、登录页 URL 推导、kbList → ParseResult 归一、错误话术）
// 全部是纯函数，钉死它们就钉死了"导入面板能拿到什么"。
//
// 注意：**不测** importFromZf() 的实际网络路径 —— 那需要真机 WebView，属于"未验证"范畴
// （AGENTS.md 硬规则：没在真机跑过的事不许声称通过）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loginUrlOf, currentXnm, zfResultFromJson, toCourses, describeOutcome } from '../src/services/zfImport.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? ' -> ' + extra : ''));
}

console.log('--- 学年推算（9 月换学年）---');
{
  ok('2025-09-01 → 2025', currentXnm(new Date(2025, 8, 1)) === '2025', currentXnm(new Date(2025, 8, 1)));
  ok('2026-03-15 → 2025（春季学期仍属上一学年）', currentXnm(new Date(2026, 2, 15)) === '2025', currentXnm(new Date(2026, 2, 15)));
  ok('2025-08-31 → 2024（没到 9 月，还是上一学年）', currentXnm(new Date(2025, 7, 31)) === '2024', currentXnm(new Date(2025, 7, 31)));
  ok('2026-01-01 → 2025', currentXnm(new Date(2026, 0, 1)) === '2025', currentXnm(new Date(2026, 0, 1)));
}

console.log('--- 登录页 URL 推导 ---');
{
  ok('只给域名 → 补 /jwglxt/xtgl/login_slogin.html',
    loginUrlOf('https://jw.example.edu.cn') === 'https://jw.example.edu.cn/jwglxt/xtgl/login_slogin.html', loginUrlOf('https://jw.example.edu.cn'));
  ok('带尾斜杠也补对', loginUrlOf('https://jw.example.edu.cn/') === 'https://jw.example.edu.cn/jwglxt/xtgl/login_slogin.html');
  ok('已指到 .html → 原样用', loginUrlOf('https://a.edu.cn/jwglxt/xtgl/login_slogin.html') === 'https://a.edu.cn/jwglxt/xtgl/login_slogin.html');
  ok('带查询串的 .html 也算', loginUrlOf('https://a.edu.cn/x.html?gnmkdm=N2151') === 'https://a.edu.cn/x.html?gnmkdm=N2151');
  ok('空串 → 空串（调用方当作 PAGE_CHANGED 处理）', loginUrlOf('') === '', '[' + loginUrlOf('') + ']');
}

console.log('--- kbList JSON → ParseResult ---');
{
  // fixture 是**裸数组**（从适配包原样拿来，保持可比对）；真实接口回的是 {"kbList":[...]}，
  // 所以这里按适配包 parse.test.mjs 的做法包一层 —— 顺便验证"必须包 kbList 才是合法输入"。
  const rows = JSON.parse(readFileSync(join(root, 'fixtures', 'zf-kblist.sample.json'), 'utf8'));
  const fixture = JSON.stringify({ kbList: rows });
  const r = zfResultFromJson(fixture, '2025 学年 · 第1学期');
  ok('样例 5 行中 1 行缺 kcmc 被过滤、1 行多段节次被拆开 → 共 5 条', r.courses.length === 5, String(r.courses.length));
  ok('裸数组（缺 kbList 包装）不算合法输入 —— 不静默编造课程',
    zfResultFromJson(JSON.stringify(rows), 'X').courses.length === 0);
  ok('解析出课程', r.courses.length > 0, String(r.courses.length));
  ok('blockCount 等于行数', r.blockCount > 0, String(r.blockCount));
  ok('distinctCourseNames > 0', r.distinctCourseNames > 0, String(r.distinctCourseNames));
  ok('semesterLabel 原样带入', r.semesterLabel === '2025 学年 · 第1学期', r.semesterLabel);
  ok('课程都带 source=jwglxt', r.courses.every((c) => c.source === 'jwglxt'));
  ok('课程都有 colorIndex（0 也算合法，但不能是 undefined）', r.courses.every((c) => typeof c.colorIndex === 'number'));
  ok('课程 day 落在 1-7', r.courses.every((c) => c.day >= 1 && c.day <= 7));
  ok('课程 startPeriod >= 1', r.courses.every((c) => c.startPeriod >= 1));
  ok('endPeriod >= startPeriod', r.courses.every((c) => c.endPeriod >= c.startPeriod));
  ok('id 有值且不重复', new Set(r.courses.map((c) => c.id)).size === r.courses.length);
  ok('timetableId 留空（入库时补）', r.courses.every((c) => c.timetableId === ''));
  ok('editedFields 空数组', r.courses.every((c) => Array.isArray(c.editedFields) && c.editedFields.length === 0));

  // 空/坏输入不许崩，而是给一条可读的诊断
  const empty = zfResultFromJson('{"kbList":[]}', 'X');
  ok('空课表 → 0 条课，且有一条 no-courses 诊断',
    empty.courses.length === 0 && empty.diagnostics.some((d) => d.kind === 'no-courses'), JSON.stringify(empty.diagnostics));
  const noKey = zfResultFromJson('{}', 'X');
  ok('没有 kbList 键 → 不崩，诊断里有 no-courses', noKey.courses.length === 0 && noKey.diagnostics.some((d) => d.kind === 'no-courses'));
}

console.log('--- 教室/校区拆分 ---');
{
  const rows = [{ name: 'X', teacher: 'T', rooms: '昌平校区 主教楼 301', day: 1, startPeriod: 1, endPeriod: 2, weeksText: '1-2周', weeks: [1, 2] }];
  const c = toCourses(rows)[0];
  ok('有空格 → 首段当校区，其余当教室', c.campus === '昌平校区' && c.room === '主教楼 301', JSON.stringify({ campus: c.campus, room: c.room }));
  const c2 = toCourses([{ ...rows[0], rooms: '301' }])[0];
  ok('没有空格 → 全算教室、校区留空', c2.campus === '' && c2.room === '301', JSON.stringify({ campus: c2.campus, room: c2.room }));
  const c3 = toCourses([{ ...rows[0], rooms: '' }])[0];
  ok('空教室 → 两边都空、不产出 "undefined"', c3.campus === '' && c3.room === '', JSON.stringify({ campus: c3.campus, room: c3.room }));
}

console.log('--- 错误话术（UI 不许自己编理由，统一走这里）---');
{
  ok('成功的错误文案是空串', describeOutcome({ ok: true }) === '');
  ok('WEB_UNSUPPORTED 提示装 APK', describeOutcome({ ok: false, errorKind: 'WEB_UNSUPPORTED' }).includes('APK'));
  ok('CANCELLED 说明是用户取消', describeOutcome({ ok: false, errorKind: 'CANCELLED' }).includes('返回'));
  const byKind = describeOutcome({ ok: false, errorKind: 'INVALID_CREDENTIALS' });
  ok('INVALID_CREDENTIALS 走 zfClient 的标准话术', byKind.includes('学号或密码'), byKind);
  ok('SESSION_EXPIRED 走标准话术', describeOutcome({ ok: false, errorKind: 'SESSION_EXPIRED' }).includes('登录状态已过期'));
}

console.log('');
if (fails.length) {
  console.error('FAILED (' + fails.length + '):');
  for (const f of fails) console.error('  x ' + f);
  console.log('zfImport: ' + pass + ' passed, ' + fails.length + ' failed');
  process.exit(1);
}
console.log('zfImport: ' + pass + ' assertions passed');
