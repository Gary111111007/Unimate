// 教务系统「考试信息查询」页面解析器（PRD 5.11，v2.17 新增）。
//
// 页面结构（真实页面取自 jwglxt.buct.edu.cn/jwglxt/kwgl/kscx_cxXsksxxIndex.html?gnmkdm=N358105）：
//   一张 jqGrid 表格，表头用 <th id="tabGrid_<列>"> 声明列，
//   **每个数据单元格都带 aria-describedby="tabGrid_<列>"** —— 这是最稳的定位方式，
//   不依赖列顺序、也不怕以后中间插一列。
//   考试时间格式：2026-07-04(08:00-10:00)
//
// 与课表解析器一样是纯字符串解析，不依赖 DOM —— 浏览器、WebView 注入脚本与 Node 单测共用同一份代码。
import type { ParseDiagnostic } from '../../types.ts';
import { textOf } from './jwglxtBuct.ts';
import { compile, examRules, type ExamRules } from './rules.ts';

export const adapterId = 'jwglxt-exam';

/** 当前生效的考试规则（默认 + 已下载规则包覆盖项） */
export function currentRules(): ExamRules { return examRules(adapterId); }

export interface ExamItem {
  /** 课程名称（kcmc） */
  course: string;
  /** 考试名称：期末考试 / 期中考试（ksmc） */
  name: string;
  /** 学年-学期拼音串（xnmc + xqmmc），如 2025-2026 第 2 学期 */
  semester: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  start: string;
  /** HH:MM */
  end: string;
  /** 场地校区（cdxqmc），如 北区 */
  campus: string;
  /** 场地名称（cdmc），如 二教D-106 */
  room: string;
  /** 座位号（zwh） */
  seat: string;
  /** 考核方式（khfs），如 考试 */
  examType: string;
  /** 考试方式（ksfs），如 笔试 */
  mode: string;
  /** 开课学院（kkxy） */
  college: string;
  /** 教学班名称（jxbmc） */
  className: string;
  /** 考试备注（ksbz） */
  note: string;
}

export interface ExamParseResult { exams: ExamItem[]; diagnostics: ParseDiagnostic[] }

/** 提前量（分钟）：提前一天 + 提前半小时 —— 产品负责人指定的两个提醒 */
export const EXAM_ALARMS = [1440, 30];

function fullToHalf(s: string): string {
  return s
    .replace(/[\uff10-\uff19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\uff08]/g, '(').replace(/[\uff09]/g, ')')
    .replace(/[\uff1a]/g, ':').replace(/[\u301c\uff5e~～]/g, '~');
}

function pad2(n: string | number): string { return String(n).padStart(2, '0'); }

/**
 * 解析一个"考试时间"单元格，可能含多个时段（页面里偶尔用换行/逗号并列）。
 * 支持：2026-07-04(08:00-10:00) / 2026-07-04 08:00-10:00 / 2026年7月4日 08:00~10:00
 */
export function parseExamTime(raw: string, rules: ExamRules = currentRules()): { date: string; start: string; end: string }[] {
  const t = fullToHalf(textOf(raw)).replace(/[，,、;；]/g, ' ').replace(/\s+/g, ' ');
  const out: { date: string; start: string; end: string }[] = [];
  const re = new RegExp(rules.timePattern, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    out.push({
      date: m[1] + '-' + pad2(m[2]) + '-' + pad2(m[3]),
      start: pad2(m[4]) + ':' + m[5],
      end: pad2(m[6]) + ':' + m[7]
    });
  }
  return out;
}

/** 把一行考试单元格解析成 ExamItem（时间可能有多个时段 → 每个时段一条） */
export function parseExamRow(cells: Record<string, string>, rules: ExamRules = currentRules()): ExamItem[] {
  const C = rules.columns;
  const course = (cells[C.course] || '').trim();
  const rawTime = (cells[C.time] || '').trim();
  if (!course || !rawTime) return [];
  const times = parseExamTime(rawTime, rules);
  const semester = [(cells[C.year] || '').trim(), (cells[C.term] || '').trim()].filter(Boolean).join(' 第 ') + ((cells[C.term] || '').trim() ? ' 学期' : '');
  return times.map((t) => ({
    course,
    name: (cells[C.name] || '').trim(),
    semester,
    date: t.date,
    start: t.start,
    end: t.end,
    campus: (cells[C.campus] || cells[C.campusAlt] || '').trim(),
    room: (cells[C.room] || '').trim(),
    seat: (cells[C.seat] || '').trim(),
    examType: (cells[C.examType] || '').trim(),
    mode: (cells[C.mode] || '').trim(),
    college: (cells[C.college] || '').trim(),
    className: (cells[C.className] || '').trim(),
    note: (cells[C.note] || '').trim()
  }));
}

/** 一行的所有单元格 → { 列名: 文本 }（文本为空时回退到 title 属性） */
function rowCells(rowHtml: string, rules: ExamRules): Record<string, string> {
  const map: Record<string, string> = {};
  const cellRe = new RegExp(rules.cellPattern, 'g');
  const colAttrRe = new RegExp(rules.colAttr + '="([^"]+)"');
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(rowHtml)) !== null) {
    const attrs = m[1];
    // jqGrid 的列标记形如 aria-describedby="tabGrid_kcmc"：取最后一个下划线之后的部分作为列名，
    // 这样即使以后表格 id 变了（不是 tabGrid）也还能对上。
    const described = (attrs.match(colAttrRe) || [, ''])[1];
    const col = described ? described.split(rules.colNameSeparator).pop() || '' : '';
    if (!col) continue;
    const text = textOf(m[2]);
    const title = (attrs.match(/title="([^"]*)"/) || [, ''])[1];
    map[col] = text || textOf(title);
  }
  return map;
}

export function parseJwglxtExams(html: string, adapter: string = adapterId): ExamParseResult {
  const rules = examRules(adapter);
  const C = rules.columns;
  const diagnostics: ParseDiagnostic[] = [];
  const exams: ExamItem[] = [];

  const rowRe = new RegExp(rules.rowPattern, 'g');
  let m: RegExpExecArray | null;
  let dataRows = 0;
  let timeUnparsed = 0;
  while ((m = rowRe.exec(html)) !== null) {
    const cells = rowCells(m[1], rules);
    if (!cells[C.course] && !cells[C.time]) continue;      // jqGrid 的空骨架行 / 表头行
    dataRows++;
    if (!cells[C.course] || !cells[C.time]) continue;
    const items = parseExamRow(cells, rules);
    if (!items.length) {
      timeUnparsed++;
      diagnostics.push({ kind: 'missing-fields', message: '考试时间无法识别：' + cells[C.time] + '（' + cells[C.course] + '）', courseName: cells[C.course] });
      continue;
    }
    for (const it of items) exams.push(it);
  }

  if (!dataRows) {
    diagnostics.unshift({ kind: 'no-table', message: '页面里没有找到考试表格。请先在教务系统里进入「考试信息查询」，选好学期并点「查询」，出现考试列表后再点「识别考试」。' });
  } else if (!exams.length) {
    diagnostics.unshift({ kind: 'no-courses', message: '考试表格是空的（或全部时间无法识别）。如果确实还没出考试安排，换一个学期再查一次。' });
  }

  exams.sort((a, b) => (a.date + a.start < b.date + b.start ? -1 : 1));
  return { exams, diagnostics };
}

export interface ExamNoteDraft { title: string; content: string; remindAt: string; alarms: number[]; past: boolean }

/** 一条考试 → 一条记事草稿（标题 / 内容 / 提醒时刻 / 提前量） */
export function examNoteDraft(ex: ExamItem, now: Date = new Date()): ExamNoteDraft {
  const title = '考试：' + ex.course + (ex.name && ex.name !== '期末考试' ? '（' + ex.name + '）' : ex.name ? '（期末考试）' : '');
  const bits = [
    ex.date + ' ' + ex.start + '-' + ex.end,
    [ex.room, ex.campus ? '（' + ex.campus + '）' : ''].join(''),
    ex.seat ? '座位 ' + ex.seat : '',
    [ex.name, ex.mode].filter(Boolean).join('/'),
    ex.className ? '教学班 ' + ex.className : '',
    ex.note
  ].filter(Boolean);
  const remindAt = ex.date + ' ' + ex.start + ':00';
  const at = new Date(remindAt.replace(/-/g, '/'));
  return { title, content: bits.join(' · '), remindAt, alarms: EXAM_ALARMS.slice(), past: at.getTime() < now.getTime() };
}

export function matches(url: string, html: string): boolean {
  const rules = currentRules();
  const urlRe = compile(rules.matchUrl, 'i');
  if (urlRe && urlRe.test(url)) return true;
  return html.indexOf(rules.htmlMarker) >= 0;
}
