// 教务系统"个人课表查询"页面解析器（适配器 id: jwglxt-buct）
// 规范来源：PRD 5.4。纯字符串解析，不依赖 DOM —— 因此同一份代码可在浏览器、
// WebView 注入脚本与 Node 单元测试（Golden Test / AC-06）中运行。
//
// v2.29（Net.md P2.5）：选择器、正则、字段下标、周次语法、课型符号全部改从
// `parser/rules.ts` 读取 —— 教务改版时**下发一份声明式规则包**即可，不用发新版 APK。
// 默认值就是本文件原来硬编码的那些值，所以 Golden Test（57 条）原样通过 = 没改坏行为。
import type { Course, LessonType, ParseDiagnostic, ParseResult } from '../../types.ts';
import { compile, timetableRules, type TimetableRules } from './rules.ts';

const DAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export const adapterId = 'jwglxt-buct';

/** 当前生效的课表规则（默认适配器 + 已下载的规则包覆盖项） */
export function currentRules(): TimetableRules { return timetableRules(adapterId); }

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

/**
 * 课程标题 → 课程名 + 课型。图例符号来自规则（★-讲课 ◇-上机 ●-实践 ○-实验）。
 * 不传 rules 时用当前生效规则。
 */
export function splitTitle(raw: string, rules: TimetableRules = currentRules()): { name: string; lessonType: LessonType } {
  const SYMBOLS: Record<string, string> = rules.lessonSymbols || {};
  let lessonType: LessonType = 'other';
  for (const ch of raw) {
    if (SYMBOLS[ch]) { lessonType = SYMBOLS[ch] as LessonType; break; }
  }
  // 去掉标题里出现的**所有**图例符号（原实现是硬编码四个符号，这里改成按规则表逐个去）
  let name = raw;
  for (const sym of Object.keys(SYMBOLS)) name = name.split(sym).join('');
  name = name.replace(/\s+$/g, '').trim();
  return { name, lessonType };
}

// PRD 5.4.5 周次表达式（分隔符/区间符/单双周/后缀"周"/"全周" 全部来自规则）
export function parseWeeks(expr: string, rules: TimetableRules = currentRules()): { weeks: number[]; ok: boolean } {
  const weeks = new Set<number>();
  let ok = false;
  const sepRe = compile(rules.weekSeparators) || /[,，、]/;
  const tokenRe = compile(
    '^(\\d+)(?:' + rules.weekRange + '(\\d+))?(?:\\(' + rules.weekParity + '\\))?' + rules.weekSuffix + '$'
  );
  const allWord = rules.weekAllWord || '全周';
  const tokens = expr.replace(/\s+/g, '').split(sepRe).filter(Boolean);
  for (const token of tokens) {
    if (token === allWord) { continue; }
    const m = tokenRe ? token.match(tokenRe) : null;
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

function findTable(html: string, rules: TimetableRules): { start: number; end: number } | null {
  let start = -1;
  for (const marker of rules.tableMarkers) {
    start = html.indexOf(marker);
    if (start >= 0) break;
  }
  if (start < 0) return null;
  const end = html.indexOf(rules.tableEndTag, start);
  return { start, end: end < 0 ? html.length : end };
}

function parseHeader(table: string, rules: TimetableRules): { semesterLabel: string; studentName: string; studentId: string } {
  const out = { semesterLabel: '', studentName: '', studentId: '' };
  const titleRe = compile('<div[^>]*class="' + rules.headerClass + '"[\\s\\S]*?</div>');
  const titleM = titleRe ? table.match(titleRe) : null;
  const scope = titleM ? titleM[0] : table.slice(0, 4000);
  const leftRe = compile(rules.headerLeftClass);
  const rightRe = compile(rules.headerRightClass);
  const idPrefixRe = compile(rules.studentIdPrefix);
  for (const m of scope.matchAll(/<h6([^>]*)>([\s\S]*?)<\/h6>/g)) {
    const text = textOf(m[2]);
    if (leftRe && leftRe.test(m[1])) out.semesterLabel = text;
    else if (rightRe && rightRe.test(m[1])) out.studentId = (idPrefixRe ? text.replace(idPrefixRe, '') : text).trim();
  }
  // 学生姓名是 .timetable_title 里两个 h6 之间的裸文本："XXX的课表"
  const bare = textOf(scope.replace(/<h6[\s\S]*?<\/h6>/g, ' ').replace(/<[^>]*>/g, ' '));
  const nameRe = compile('(.{1,20}?)' + rules.studentNameSuffix);
  const nm = nameRe ? bare.match(nameRe) : null;
  if (nm) out.studentName = nm[1].trim();
  return out;
}

export function parseJwglxtTimetable(html: string, adapter: string = adapterId): ParseResult {
  const rules = timetableRules(adapter);
  const diagnostics: ParseDiagnostic[] = [];
  const courses: Course[] = [];
  const table = findTable(html, rules);
  if (!table) {
    diagnostics.push({ kind: 'no-table', message: '页面中找不到课表表格 ' + rules.tableMarkers[0] + '，请确认已进入"个人课表查询"并点击查询' });
    return { semesterLabel: '', studentName: '', studentId: '', courses, blockCount: 0, distinctCourseNames: 0, diagnostics };
  }
  const region = html.slice(table.start, table.end);
  const header = parseHeader(region, rules);

  const cellRe = new RegExp(rules.cellPattern, 'g');
  const blockSplitRe = new RegExp(rules.blockSplitMarker);
  const titleRe = new RegExp(rules.titlePattern);
  const pendingRes = rules.pendingPatterns.map((p) => new RegExp(p, 'i'));
  const paraRe = new RegExp(rules.paraPattern, 'g');
  const sectionRe = new RegExp(rules.sectionPattern);
  const fm = rules.fieldMap;
  let cm: RegExpExecArray | null;
  let seq = 0;
  while ((cm = cellRe.exec(region)) !== null) {
    const day = parseInt(cm[1], 10);
    const cellId = cm[1] + '-' + cm[2];
    const body = cm[3];
    const blocks = body.split(blockSplitRe).slice(1);
    for (const block of blocks) {
      seq++;
      const rawTitle = textOf((block.match(titleRe) || [, ''])[1]);
      const { name, lessonType } = splitTitle(rawTitle, rules);
      const pendingFilter = pendingRes.some((re) => re.test(block));
      const ps = [...block.matchAll(paraRe)].map((p) => textOf(p[1]));
      if (!name) {
        diagnostics.push({ kind: 'missing-fields', message: '课程块缺少课程名，已跳过', cellId });
        continue;
      }
      // 按 (a-b节) 切分字段组：每组固定 groupSize 项（PRD 5.4.3，规则包可改）
      const starts: number[] = [];
      ps.forEach((p, i) => { if (sectionRe.test(p)) starts.push(i); });
      if (!starts.length) {
        diagnostics.push({ kind: 'missing-fields', message: `未能识别节次与周次：${name}`, cellId, courseName: name });
        continue;
      }
      for (let si = 0; si < starts.length; si++) {
        const g = ps.slice(starts[si], starts[si] + rules.groupSize);
        const sec = g[0] || '';
        const sm = sec.match(sectionRe);
        const startPeriod = sm ? parseInt(sm[1], 10) : 0;
        const endPeriod = sm ? parseInt(sm[2], 10) : 0;
        const weeksRaw = (sm ? sm[3] : '').trim();
        const wk = parseWeeks(weeksRaw, rules);
        if (!wk.ok) {
          diagnostics.push({ kind: 'unparsed-weeks', message: `周次无法解析（${weeksRaw || '空'}）：${name}，请手动选择周次`, cellId, courseName: name });
        }
        const loc = splitLocation(g[fm.location] || '');
        courses.push({
          id: 'p' + seq + '-' + si,
          timetableId: '',
          name,
          lessonType,
          teacher: (g[fm.teacher] || '').trim(),
          campus: loc.campus,
          room: loc.room,
          day,
          startPeriod,
          endPeriod,
          weeksRaw,
          weeks: wk.weeks,
          credit: toNumber(g[fm.credit]),
          weeklyHours: toNumber(g[fm.weeklyHours]),
          totalHours: toNumber(g[fm.totalHours]),
          examMode: (g[fm.examMode] || '').trim(),
          courseCode: (g[fm.courseCode] || '').trim(),
          classNames: (g[fm.classNames] || '').trim(),
          hoursDetail: (g[fm.hoursDetail] || '').trim(),
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

export function matches(url: string, html: string): boolean {
  const rules = currentRules();
  const urlRe = compile(rules.matchUrl, 'i');
  if (urlRe && urlRe.test(url)) return true;
  return rules.tableMarkers.some((m) => html.indexOf(m) >= 0);
}
