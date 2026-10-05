/**
 * P4 通用学术记录解析（Net.md P4 / 任务书 T1~T7）。
 * 只在用户已打开并回传的 HTML/JSON 上工作；不联网、不读 Cookie、不代填表单。
 */
import { textOf } from './jwglxtBuct.ts';
import { academicRules, type AcademicRules } from './rules.ts';

export type AcademicScope = 'grades' | 'exams';
export type AcademicChannel = 'json' | 'html';
export interface AcademicDiagnostic { code: 'empty-input' | 'json-parse-failed' | 'no-payload-array' | 'no-table' | 'no-records' | 'row-dropped' | 'missing-fields' | 'internal-course-id-filtered'; channel: 'input' | AcademicChannel; message: string; row?: number; fields?: string[] }
export interface GradeDraft { courseCode: string; courseName: string; credits: number | null; score: string; point: number | null; nature: string; category: string; teacher: string; assessment: string; status: string; remark: string; termId: string }
export interface ExamDraft { courseCode: string; courseName: string; examType: string; examTime: string; date: string; start: string; end: string; startAt: number | null; location: string; campus: string; seat: string; mode: string; remark: string; termId: string }
export interface AcademicParseResult<T> { scope: AcademicScope; channel: AcademicChannel | null; records: T[]; diagnostics: AcademicDiagnostic[]; stats: { inputBytes: number; decodedDepth: number; payloadKey: string; rawRowCount: number; recordCount: number; recognizedFields: string[]; fieldPresence: Record<string, number> } }

const GRADE_FIELDS = ['courseCode','courseName','credits','score','point','nature','category','teacher','assessment','status','remark','year','term'];
const EXAM_FIELDS = ['courseCode','courseName','examType','examTime','location','campus','seat','mode','remark','year','term'];

function canonicalKey(value: string): string { return String(value || '').normalize('NFKC').replace(/[\s_\-:：·—–/\()[\]{}【】《》<>]+/g, '').toLowerCase(); }
function toText(value: unknown): string { if (value === null || value === undefined) return ''; if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim(); if (typeof value === 'number' || typeof value === 'boolean') return String(value); if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(' '); return ''; }

function flatten(value: unknown, depth: number, out: { key: string; value: unknown }[], seen: Set<unknown>): void {
  if (!value || typeof value !== 'object' || depth > 3 || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) { value.forEach((x) => flatten(x, depth + 1, out, seen)); return; }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out.push({ key: canonicalKey(key), value: child });
    if (child && typeof child === 'object') flatten(child, depth + 1, out, seen);
  }
}
function fieldValues(record: unknown, aliases: string[]): unknown[] {
  const entries: { key: string; value: unknown }[] = [];
  flatten(record, 0, entries, new Set<unknown>());
  const out: unknown[] = [];
  for (const alias of aliases) {
    const hit = entries.find((x) => x.key === canonicalKey(alias));
    if (hit) out.push(hit.value);
  }
  return out;
}
function readField(record: unknown, aliases: string[]): string { for (const x of fieldValues(record, aliases)) { const t = toText(x); if (t) return t; } return ''; }
function parseNumber(value: unknown): number | null { if (typeof value === 'number') return Number.isFinite(value) ? value : null; const m = toText(value).normalize('NFKC').match(/-?\d+(?:\.\d+)?/); const n = m ? Number(m[0]) : NaN; return Number.isFinite(n) ? n : null; }
function isInternalId(value: string): boolean { return /^[0-9A-F]{16,}$/i.test(toText(value)); }
function isStandardCode(value: string): boolean { return /^[A-Z]{2,6}[A-Z0-9]*\d[A-Z0-9]*[A-Z]$/.test(toText(value).toUpperCase()); }
function chooseCode(values: unknown[]): { code: string; internalFiltered: boolean } {
  const tokens: string[] = [];
  for (const value of values) for (const m of toText(value).normalize('NFKC').toUpperCase().matchAll(/[A-Z]{2,6}[A-Z0-9]*\d[A-Z0-9]*[A-Z]|[0-9A-F]{16,}|[A-Z0-9][A-Z0-9._-]{2,}/g)) if (!tokens.includes(m[0])) tokens.push(m[0]);
  return { code: tokens.find(isStandardCode) || tokens.find((x) => !isInternalId(x)) || '', internalFiltered: tokens.some(isInternalId) };
}
function normalizeTerm(year: string, term: string): string {
  const y = toText(year).replace(/\s+/g, ''); let t = toText(term).normalize('NFKC').replace(/\s+/g, '');
  if (/^1$|第一学期|秋季/.test(t)) t = '1'; else if (/^2$|第二学期|春季/.test(t)) t = '2'; else if (/^3$|第三学期|夏季/.test(t)) t = '3';
  return y ? y + '-' + t : t;
}
function parseExamTime(value: string): { date: string; start: string; end: string; startAt: number | null; ok: boolean } {
  const text = toText(value).normalize('NFKC').replace(/[（）()]/g, ' ');
  const m = text.match(/(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})\D*?(\d{1,2})[:：](\d{2})\s*[-~—–至]\s*(\d{1,2})[:：](\d{2})/);
  if (!m) return { date: '', start: '', end: '', startAt: null, ok: false };
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4]), mi = Number(m[5]), eh = Number(m[6]), emi = Number(m[7]);
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h <= 23 && mi <= 59 && eh <= 23 && emi <= 59)) return { date: '', start: '', end: '', startAt: null, ok: false };
  return { date: String(y).padStart(4, '0') + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0'), start: String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0'), end: String(eh).padStart(2, '0') + ':' + String(emi).padStart(2, '0'), startAt: Date.UTC(y, mo - 1, d, h, mi), ok: true };
}
function parseCells(row: string): string[] {
  const out: string[] = []; const re = /<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi; let m: RegExpExecArray | null;
  while ((m = re.exec(row))) { const span = Math.max(1, Math.min(8, Number((m[1].match(/\bcolspan\s*=\s*["']?(\d+)/i) || [])[1] || 1))); for (let i = 0; i < span; i++) out.push(i ? '' : textOf(m[2] || '')); }
  return out;
}
function parseHtmlTable(html: string): { headers: string[]; rows: Record<string, string>[]; count: number } {
  const tables = [...html.matchAll(/<table\b[\s\S]*?<\/table>/gi)];
  const rows: { html: string; cells: string[] }[] = [];
  for (const t of tables) for (const r of t[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) { const cells = parseCells(r[1] || ''); if (cells.some(Boolean)) rows.push({ html: r[1] || '', cells }); }
  const hi = rows.findIndex((r) => /<th\b/i.test(r.html)); if (hi < 0) return { headers: [], rows: [], count: tables.length };
  const headers = rows[hi].cells.map((h, i) => h || '列' + String(i + 1)); const data: Record<string, string>[] = [];
  for (const row of rows.slice(hi + 1)) { if (/<th\b/i.test(row.html)) continue; const out: Record<string, string> = {}; row.cells.forEach((v, i) => { if (v && headers[i]) out[headers[i]] = v; }); if (Object.keys(out).length) data.push(out); }
  return { headers, rows: data, count: tables.length };
}
function decodeJson(raw: string): { value: unknown; depth: number } | null { try { let value: unknown = JSON.parse(raw.trim()); let depth = 0; while (typeof value === 'string' && depth < 5) { value = JSON.parse(value); depth++; } return { value, depth }; } catch { return null; } }
function findArray(root: unknown, priority: string[]): { array: unknown[]; key: string } | null {
  if (Array.isArray(root) && root.length) return { array: root, key: '' }; const q: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }]; const seen = new Set<unknown>();
  while (q.length) { const item = q.shift()!; if (!item.value || typeof item.value !== 'object' || item.depth > 6 || seen.has(item.value)) continue; seen.add(item.value);
    if (!Array.isArray(item.value)) { const obj = item.value as Record<string, unknown>; const keys = new Map(Object.keys(obj).map((k) => [canonicalKey(k), k])); for (const wanted of priority) { const actual = Object.prototype.hasOwnProperty.call(obj, wanted) ? wanted : keys.get(canonicalKey(wanted)); const value = actual ? obj[actual] : undefined; if (Array.isArray(value) && value.length) return { array: value, key: actual || wanted }; } }
    if (Array.isArray(item.value)) item.value.forEach((x) => q.push({ value: x, depth: item.depth + 1 })); else for (const x of Object.values(item.value as Record<string, unknown>)) if (x && typeof x === 'object') q.push({ value: x, depth: item.depth + 1 }); }
  return null;
}
function mapRows<T>(scope: AcademicScope, rows: unknown[], rules: AcademicRules, channel: AcademicChannel): { records: T[]; diagnostics: AcademicDiagnostic[]; rawRowCount: number } {
  const records: T[] = []; const diagnostics: AcademicDiagnostic[] = [];
  rows.forEach((row, i) => {
    const aliases = (scope === 'grades' ? rules.scopes.grades?.aliases : rules.scopes.exams?.aliases) || {};
    const name = readField(row, aliases.courseName || []); const timeOrScore = readField(row, scope === 'grades' ? (aliases.score || []) : (aliases.examTime || []));
    if (!name && !timeOrScore) { diagnostics.push({ code: 'row-dropped', channel, message: '第 ' + (i + 1) + ' 行缺少课程名和关键字段，已丢弃', row: i + 1 }); return; }
    const code = chooseCode(fieldValues(row, aliases.courseCode || [])); if (!code.code && code.internalFiltered) diagnostics.push({ code: 'internal-course-id-filtered', channel, message: '第 ' + (i + 1) + ' 行课程代码是内部 ID，已置空', row: i + 1, fields: ['courseCode'] });
    const t = parseExamTime(readField(row, aliases.examTime || []));
    const base = { courseCode: code.code, courseName: name || (scope === 'grades' ? '未命名课程' : '未命名考试'), remark: readField(row, aliases.remark || []), termId: normalizeTerm(readField(row, aliases.year || []), readField(row, aliases.term || [])) };
    records.push((scope === 'grades' ? { ...base, credits: parseNumber(readField(row, aliases.credits || [])), score: readField(row, aliases.score || []), point: parseNumber(readField(row, aliases.point || [])), nature: readField(row, aliases.nature || []), category: readField(row, aliases.category || []), teacher: readField(row, aliases.teacher || []), assessment: readField(row, aliases.assessment || []), status: readField(row, aliases.status || []) } : { ...base, examType: readField(row, aliases.examType || []), examTime: readField(row, aliases.examTime || []), date: t.date, start: t.start, end: t.end, startAt: t.startAt, location: readField(row, aliases.location || []), campus: readField(row, aliases.campus || []), seat: readField(row, aliases.seat || []), mode: readField(row, aliases.mode || []) }) as unknown as T);
  });
  if (rows.length && !records.length) diagnostics.push({ code: 'no-records', channel, message: '找到了数据行，但没有有效记录' });
  return { records, diagnostics, rawRowCount: rows.length };
}
function makeResult<T>(scope: AcademicScope, channel: AcademicChannel | null, records: T[], diagnostics: AcademicDiagnostic[], input: string, depth: number, key: string, rawRows: number, fields: string[]): AcademicParseResult<T> {
  const presence: Record<string, number> = {}; fields.forEach((f) => presence[f] = 0); records.forEach((r) => fields.forEach((f) => { if (String((r as any)[f] ?? '').length) presence[f]++; }));
  return { scope, channel, records, diagnostics, stats: { inputBytes: new TextEncoder().encode(input).length, decodedDepth: depth, payloadKey: key, rawRowCount: rawRows, recordCount: records.length, recognizedFields: fields.filter((f) => presence[f] > 0), fieldPresence: presence } };
}
function parse<T>(input: string, scope: AcademicScope, adapterId: string): AcademicParseResult<T> {
  const raw = String(input || ''); const fields = scope === 'grades' ? GRADE_FIELDS : EXAM_FIELDS; const rules = academicRules(adapterId); const diagnostics: AcademicDiagnostic[] = [];
  if (!raw.trim()) return makeResult(scope, null, [], [{ code: 'empty-input', channel: 'input', message: '输入为空' }], raw, 0, '', 0, fields);
  if (/^[\[{"]/.test(raw.trim())) { const decoded = decodeJson(raw); if (!decoded) diagnostics.push({ code: 'json-parse-failed', channel: 'json', message: 'JSON 解析失败，已尝试 HTML 兜底' }); else { const hit = findArray(decoded.value, rules.payloadArrayPriority); if (!hit) diagnostics.push({ code: 'no-payload-array', channel: 'json', message: 'JSON 里没有找到记录数组' }); else { const mapped = mapRows<T>(scope, hit.array, rules, 'json'); if (mapped.records.length) return makeResult(scope, 'json', mapped.records, mapped.diagnostics, raw, decoded.depth, hit.key, mapped.rawRowCount, fields); diagnostics.push(...mapped.diagnostics); return makeResult(scope, 'json', [], diagnostics, raw, decoded.depth, hit.key, mapped.rawRowCount, fields); } } }
  const table = parseHtmlTable(raw); if (table.rows.length) { const mapped = mapRows<T>(scope, table.rows, rules, 'html'); if (mapped.records.length) return makeResult(scope, 'html', mapped.records, diagnostics.concat(mapped.diagnostics), raw, 0, 'table', mapped.rawRowCount, fields); diagnostics.push(...mapped.diagnostics); } else diagnostics.push({ code: 'no-table', channel: 'html', message: '页面里没有找到可解析的 HTML 表格' });
  return makeResult(scope, null, [], diagnostics, raw, 0, '', 0, fields);
}
export function parseAcademicGrades(input: string, adapterId = 'academic-buct'): AcademicParseResult<GradeDraft> { return parse<GradeDraft>(input, 'grades', adapterId); }
export function parseAcademicExams(input: string, adapterId = 'academic-buct'): AcademicParseResult<ExamDraft> { return parse<ExamDraft>(input, 'exams', adapterId); }
