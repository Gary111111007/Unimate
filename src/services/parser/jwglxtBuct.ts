// 教务系统"个人课表查询"页面解析器（适配器 id: jwglxt-buct）
// 规范来源：PRD 5.4。纯字符串解析，不依赖 DOM —— 因此同一份代码可在浏览器、
// WebView 注入脚本与 Node 单元测试（Golden Test / AC-06）中运行。
import type { Course, LessonType, ParseDiagnostic, ParseResult } from '../../types.ts';

const DAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[\u00a0\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 图例：★-讲课 ◇-上机 ●-实践 ○-实验
const SYMBOLS: Record<string, LessonType> = { '\u2605': 'lecture', '\u25c7': 'machine', '\u25cf': 'practice', '\u25cb': 'lab' };

export function splitTitle(raw: string): { name: string; lessonType: LessonType } {
  let lessonType: LessonType = 'other';
  for (const ch of raw) {
    if (SYMBOLS[ch]) { lessonType = SYMBOLS[ch]; break; }
  }
  const name = raw.replace(/[\u2605\u25c7\u25cf\u25cb]/g, '').replace(/\s+$/g, '').trim();
  return { name, lessonType };
}

// PRD 5.4.5 周次表达式
export function parseWeeks(expr: string): { weeks: number[]; ok: boolean } {
  const weeks = new Set<number>();
  let ok = false;
  const tokens = expr.replace(/\s+/g, '').split(/[,，、]/).filter(Boolean);
  for (const token of tokens) {
    if (/^全周$/.test(token)) { continue; }
    const m = token.match(/^(\d+)(?:[-~到](\d+))?(?:\((单|双)\))?周$/);
    if (!m) continue;
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    const parity = m[3];
    if (!isFinite(a) || !isFinite(b) || b < a) continue;
    for (let w = a; w <= b; w++) {
      if (parity === '单' && w % 2 === 0) continue;
      if (parity === '双' && w % 2 === 1) continue;
      weeks.add(w);
    }
    ok = true;
  }
  return { weeks: [...weeks].sort((x, y) => x - y), ok };
}

function toNumber(s: string | undefined): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/[^\d.\-]/g, ''));
  return isFinite(n) ? n : null;
}

function splitLocation(raw: string): { campus: string; room: string } {
  const t = raw.trim();
  const i = t.indexOf(' ');
  if (i <= 0) return { campus: '', room: t };
  return { campus: t.slice(0, i).trim(), room: t.slice(i + 1).trim() };
}

function findTable(html: string): { start: number; end: number } | null {
  let start = html.indexOf('id="kbgrid_table_0"');
  if (start < 0) start = html.indexOf('timetable1');
  if (start < 0) return null;
  const end = html.indexOf('</table>', start);
  return { start, end: end < 0 ? html.length : end };
}

function parseHeader(table: string): { semesterLabel: string; studentName: string; studentId: string } {
  const out = { semesterLabel: '', studentName: '', studentId: '' };
  const titleM = table.match(/<div[^>]*class="timetable_title"[\s\S]*?<\/div>/);
  const scope = titleM ? titleM[0] : table.slice(0, 4000);
  for (const m of scope.matchAll(/<h6([^>]*)>([\s\S]*?)<\/h6>/g)) {
    const text = textOf(m[2]);
    if (/pull-left/.test(m[1])) out.semesterLabel = text;
    else if (/pull-right/.test(m[1])) out.studentId = text.replace(/^[　\s]*学号[:：]\s*/, '').trim();
  }
  // 学生姓名是 .timetable_title 里两个 h6 之间的裸文本："XXX的课表"
  const bare = textOf(scope.replace(/<h6[\s\S]*?<\/h6>/g, ' ').replace(/<[^>]*>/g, ' '));
  const nm = bare.match(/(.{1,20}?)的课表/);
  if (nm) out.studentName = nm[1].trim();
  return out;
}

export function parseJwglxtTimetable(html: string): ParseResult {
  const diagnostics: ParseDiagnostic[] = [];
  const courses: Course[] = [];
  const table = findTable(html);
  if (!table) {
    diagnostics.push({ kind: 'no-table', message: '页面中找不到课表表格 #kbgrid_table_0，请确认已进入"个人课表查询"并点击查询' });
    return { semesterLabel: '', studentName: '', studentId: '', courses, blockCount: 0, distinctCourseNames: 0, diagnostics };
  }
  const region = html.slice(table.start, table.end);
  const header = parseHeader(region);

  const cellRe = /<td[^>]*\bid="(\d+)-(\d+)"[^>]*>([\s\S]*?)<\/td>/g;
  let cm: RegExpExecArray | null;
  let seq = 0;
  while ((cm = cellRe.exec(region)) !== null) {
    const day = parseInt(cm[1], 10);
    const cellId = cm[1] + '-' + cm[2];
    const body = cm[3];
    const blocks = body.split(/class="timetable_con/).slice(1);
    for (const block of blocks) {
      seq++;
      const rawTitle = textOf((block.match(/class="title"[^>]*>([\s\S]*?)<\/span>/) || [, ''])[1]);
      const { name, lessonType } = splitTitle(rawTitle);
      const pendingFilter = /color=["']?red/i.test(block) || /<i[\s>]/i.test(block);
      const ps = [...block.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((p) => textOf(p[1]));
      if (!name) {
        diagnostics.push({ kind: 'missing-fields', message: '课程块缺少课程名，已跳过', cellId });
        continue;
      }
      // 按 (a-b节) 切分字段组：每组固定 11 项（PRD 5.4.3）
      const starts: number[] = [];
      ps.forEach((p, i) => { if (/^\((\d+)-(\d+)节\)/.test(p)) starts.push(i); });
      if (!starts.length) {
        diagnostics.push({ kind: 'missing-fields', message: `未能识别节次与周次：${name}`, cellId, courseName: name });
        continue;
      }
      for (let si = 0; si < starts.length; si++) {
        const g = ps.slice(starts[si], starts[si] + 11);
        const sec = g[0] || '';
        const sm = sec.match(/^\((\d+)-(\d+)节\)(.*)$/);
        const startPeriod = sm ? parseInt(sm[1], 10) : 0;
        const endPeriod = sm ? parseInt(sm[2], 10) : 0;
        const weeksRaw = (sm ? sm[3] : '').trim();
        const wk = parseWeeks(weeksRaw);
        if (!wk.ok) {
          diagnostics.push({ kind: 'unparsed-weeks', message: `周次无法解析（${weeksRaw || '空'}）：${name}，请手动选择周次`, cellId, courseName: name });
        }
        const loc = splitLocation(g[1] || '');
        courses.push({
          id: 'p' + seq + '-' + si,
          timetableId: '',
          name,
          lessonType,
          teacher: (g[2] || '').trim(),
          campus: loc.campus,
          room: loc.room,
          day,
          startPeriod,
          endPeriod,
          weeksRaw,
          weeks: wk.weeks,
          credit: toNumber(g[10]),
          weeklyHours: toNumber(g[8]),
          totalHours: toNumber(g[9]),
          examMode: (g[5] || '').trim(),
          courseCode: (g[3] || '').trim(),
          classNames: (g[4] || '').trim(),
          hoursDetail: (g[7] || '').trim(),
          colorIndex: 0,
          source: 'jwglxt',
          pendingFilter,
          editedFields: [],
          remark: ''
        });
      }
    }
  }

  if (!courses.length) diagnostics.push({ kind: 'no-courses', message: '课表表格存在但没有解析到任何课程' });

  // 时间冲突检测（同一天、节次重叠、周次有交集）
  for (let i = 0; i < courses.length; i++) {
    for (let j = i + 1; j < courses.length; j++) {
      const a = courses[i], b = courses[j];
      if (a.day !== b.day || a.endPeriod < b.startPeriod || b.endPeriod < a.startPeriod) continue;
      if (a.name === b.name) continue; // 同名课程同一时段 = 多教学班/可选机房，不算冲突
      if (a.weeks.length && b.weeks.length && !a.weeks.some((w) => b.weeks.indexOf(w) >= 0)) continue;
      diagnostics.push({
        kind: 'conflict',
        message: `${DAY_NAMES[a.day] || '周?'} 第${a.startPeriod}-${a.endPeriod}节：${a.name} 与 ${b.name} 时间重叠`,
        courseName: a.name
      });
    }
  }

  return {
    semesterLabel: header.semesterLabel,
    studentName: header.studentName,
    studentId: header.studentId,
    courses,
    blockCount: seq,
    distinctCourseNames: new Set(courses.map((c) => c.name)).size,
    diagnostics
  };
}

export const adapterId = 'jwglxt-buct';
export function matches(url: string, html: string): boolean {
  return /xskbcx_cxXskbcxIndex|gnmkdm=N2151/i.test(url) || html.indexOf('id="kbgrid_table_0"') >= 0;
}
