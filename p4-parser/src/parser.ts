import type { AcademicRecord, ExamRecord, GradeRecord, ParseChannel, ParseDiagnostic, ParseResult, ParseScope } from './types.ts';
import { DEFAULT_MENU_HINTS, DEFAULT_RULE_PACK, EXAM_FIELDS, GRADE_FIELDS, resolveExamAliases, resolveGradeAliases, validateRulePack, type ExamField, type GradeField, type RulePack } from './rules.ts';
import { canonicalKey, chooseCourseCode, htmlToText, normalizeTerm, parseExamTime, parseNumberLoose, readField, readFieldValues, toText } from './normalize.ts';
import { parseHtmlTable } from './htmlTable.ts';

export interface PayloadArrayHit { array: unknown[]; key: string; path: string }
export type MenuKind = 'grades' | 'exams' | 'timetable' | 'unknown';
export interface MenuEntry { label: string; url: string; kind: MenuKind }
interface MappedRows<T extends AcademicRecord> { records: T[]; diagnostics: ParseDiagnostic[]; fieldPresence: Record<string, number>; rawRowCount: number }
interface JsonDecodeResult { value: unknown; depth: number }

function fieldCount<T extends AcademicRecord>(records: T[], fields: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const field of fields) counts[field] = 0;
  for (const record of records) {
    const row = record as unknown as Record<string, unknown>;
    for (const field of fields) {
      const value = row[field];
      if (value !== null && value !== undefined && String(value).length > 0) counts[field]++;
    }
  }
  return counts;
}

function recognizedFields(presence: Record<string, number>, fields: readonly string[]): string[] {
  return fields.filter((field) => presence[field] > 0);
}

function makeResult<T extends AcademicRecord>(scope: ParseScope, channel: ParseChannel | null, records: T[], diagnostics: ParseDiagnostic[], presence: Record<string, number>, input: string, decodedDepth: number, payloadKey: string, rawRowCount: number, startedAt: number): ParseResult<T> {
  const fields = scope === 'grades' ? GRADE_FIELDS : EXAM_FIELDS;
  return {
    scope, channel, records, diagnostics,
    stats: {
      inputBytes: new TextEncoder().encode(input).length,
      decodedDepth, payloadKey, rawRowCount, recordCount: records.length,
      recognizedFields: recognizedFields(presence, fields), fieldPresence: presence,
      durationMs: Math.max(0, Date.now() - startedAt)
    }
  };
}

export function decodeJsonPayload(raw: string): JsonDecodeResult | null {
  try {
    let value: unknown = JSON.parse(String(raw || '').trim());
    let depth = 0;
    while (typeof value === 'string' && depth < 5) { value = JSON.parse(value); depth++; }
    return { value, depth };
  } catch { return null; }
}

function looksJson(raw: string): boolean {
  const text = raw.trim();
  return text[0] === '{' || text[0] === '[' || text[0] === '"';
}

export function findPayloadArray(root: unknown, priority: string[]): PayloadArrayHit | null {
  if (Array.isArray(root) && root.length > 0) return { array: root, key: '$array', path: '$' };
  const queue: Array<{ value: unknown; depth: number; path: string }> = [{ value: root, depth: 0, path: '$' }];
  const seen = new Set<unknown>();
  while (queue.length) {
    const item = queue.shift() as { value: unknown; depth: number; path: string };
    if (!item.value || typeof item.value !== 'object' || item.depth > 6) continue;
    if (seen.has(item.value)) continue;
    seen.add(item.value);
    if (!Array.isArray(item.value)) {
      const object = item.value as Record<string, unknown>;
      const normalized = new Map<string, string>();
      for (const key of Object.keys(object)) normalized.set(canonicalKey(key), key);
      for (const key of priority) {
        const actualKey = Object.prototype.hasOwnProperty.call(object, key) ? key : normalized.get(canonicalKey(key));
        const value = actualKey ? object[actualKey] : undefined;
        if (Array.isArray(value) && value.length > 0) return { array: value, key: actualKey || key, path: item.path + '.' + (actualKey || key) };
      }
    }
    if (Array.isArray(item.value)) item.value.forEach((child, index) => queue.push({ value: child, depth: item.depth + 1, path: item.path + '[' + index + ']' }));
    else for (const [key, child] of Object.entries(item.value as Record<string, unknown>)) if (child && typeof child === 'object') queue.push({ value: child, depth: item.depth + 1, path: item.path + '.' + key });
  }
  return null;
}

function mapGradeRow(row: unknown, aliases: Record<GradeField, string[]>, rowNo: number, channel: ParseChannel): { record: GradeRecord | null; diagnostics: ParseDiagnostic[] } {
  const diagnostics: ParseDiagnostic[] = [];
  const courseName = readField(row, aliases.courseName);
  const score = readField(row, aliases.score);
  if (!courseName && !score) {
    diagnostics.push({ code: 'row-dropped', channel, message: '第 ' + rowNo + ' 行没有课程名和成绩，已丢弃', row: rowNo, fields: ['courseName', 'score'] });
    return { record: null, diagnostics };
  }
  const codeInfo = chooseCourseCode(readFieldValues(row, aliases.courseCode));
  if (!codeInfo.code && codeInfo.filteredInternal) diagnostics.push({ code: 'internal-course-id-filtered', channel, message: '第 ' + rowNo + ' 行的课程代码看起来是系统内部 ID，已置空', row: rowNo, fields: ['courseCode'] });
  const record: GradeRecord = {
    courseCode: codeInfo.code, courseName: courseName || '未命名课程',
    credits: parseNumberLoose(readField(row, aliases.credits)), score,
    point: parseNumberLoose(readField(row, aliases.point)),
    nature: readField(row, aliases.nature), category: readField(row, aliases.category),
    teacher: readField(row, aliases.teacher), assessment: readField(row, aliases.assessment),
    status: readField(row, aliases.status), remark: readField(row, aliases.remark),
    termId: normalizeTerm(readField(row, aliases.year), readField(row, aliases.term))
  };
  return { record, diagnostics };
}

function mapExamRow(row: unknown, aliases: Record<ExamField, string[]>, rowNo: number, channel: ParseChannel): { record: ExamRecord | null; diagnostics: ParseDiagnostic[] } {
  const diagnostics: ParseDiagnostic[] = [];
  const courseName = readField(row, aliases.courseName);
  const examTime = readField(row, aliases.examTime);
  if (!courseName && !examTime) {
    diagnostics.push({ code: 'row-dropped', channel, message: '第 ' + rowNo + ' 行没有课程名和考试时间，已丢弃', row: rowNo, fields: ['courseName', 'examTime'] });
    return { record: null, diagnostics };
  }
  const codeInfo = chooseCourseCode(readFieldValues(row, aliases.courseCode));
  if (!codeInfo.code && codeInfo.filteredInternal) diagnostics.push({ code: 'internal-course-id-filtered', channel, message: '第 ' + rowNo + ' 行的课程代码看起来是系统内部 ID，已置空', row: rowNo, fields: ['courseCode'] });
  const time = parseExamTime(examTime);
  if (examTime && !time.ok) diagnostics.push({ code: 'missing-fields', channel, message: '第 ' + rowNo + ' 行的考试时间认不出来，已保留原文但不生成提醒时间', row: rowNo, fields: ['examTime'] });
  const record: ExamRecord = {
    courseCode: codeInfo.code, courseName: courseName || '未命名考试',
    examType: readField(row, aliases.examType), examTime, startAt: time.startAt,
    location: readField(row, aliases.location), campus: readField(row, aliases.campus),
    seat: readField(row, aliases.seat), mode: readField(row, aliases.mode),
    remark: readField(row, aliases.remark),
    termId: normalizeTerm(readField(row, aliases.year), readField(row, aliases.term))
  };
  return { record, diagnostics };
}

function mapRows<T extends AcademicRecord>(scope: ParseScope, rows: unknown[], pack: RulePack, channel: ParseChannel): MappedRows<T> {
  const records: T[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  if (scope === 'grades') {
    const aliases = resolveGradeAliases(pack);
    rows.forEach((row, index) => {
      const mapped = mapGradeRow(row, aliases, index + 1, channel);
      diagnostics.push(...mapped.diagnostics);
      if (mapped.record) records.push(mapped.record as unknown as T);
    });
  } else {
    const aliases = resolveExamAliases(pack);
    rows.forEach((row, index) => {
      const mapped = mapExamRow(row, aliases, index + 1, channel);
      diagnostics.push(...mapped.diagnostics);
      if (mapped.record) records.push(mapped.record as unknown as T);
    });
  }
  const fields = scope === 'grades' ? GRADE_FIELDS : EXAM_FIELDS;
  const presence = fieldCount(records, fields);
  const required = scope === 'grades' ? ['courseName'] : ['courseName', 'examTime'];
  const missing = required.filter((field) => presence[field] === 0);
  if (records.length && missing.length) diagnostics.push({ code: 'missing-fields', channel, message: '部分必需字段没有识别到：' + missing.join(', '), fields: missing });
  if (rows.length && records.length === 0) diagnostics.push({ code: 'no-records', channel, message: '找到了数据行，但没有任何一行符合成绩/考试记录要求' });
  return { records, diagnostics, fieldPresence: presence, rawRowCount: rows.length };
}

function invalidPackResult<T extends AcademicRecord>(scope: ParseScope, input: string, startedAt: number, errors: string[]): ParseResult<T> {
  const fields = scope === 'grades' ? GRADE_FIELDS : EXAM_FIELDS;
  return makeResult(scope, null, [], [{ code: 'invalid-rule-pack', channel: 'rules', message: '规则包不合格：' + errors.join('；') }], fieldCount([], fields), input, 0, '', 0, startedAt);
}

function emptyResult<T extends AcademicRecord>(scope: ParseScope, input: string, startedAt: number, diagnostics: ParseDiagnostic[]): ParseResult<T> {
  const fields = scope === 'grades' ? GRADE_FIELDS : EXAM_FIELDS;
  return makeResult(scope, null, [], diagnostics, fieldCount([], fields), input, 0, '', 0, startedAt);
}

export function parseAcademicPayload<T extends AcademicRecord>(input: string, scope: ParseScope, rulePack: RulePack = DEFAULT_RULE_PACK): ParseResult<T> {
  const startedAt = Date.now();
  const raw = String(input || '');
  if (!raw.trim()) return emptyResult<T>(scope, raw, startedAt, [{ code: 'empty-input', channel: 'input', message: '输入为空' }]);
  const validation = validateRulePack(rulePack);
  if (!validation.ok) return invalidPackResult<T>(scope, raw, startedAt, validation.errors);
  const pack = validation.pack;
  const diagnostics: ParseDiagnostic[] = [];
  let decodedDepth = 0;

  if (looksJson(raw)) {
    const decoded = decodeJsonPayload(raw);
    if (!decoded) diagnostics.push({ code: 'json-parse-failed', channel: 'json', message: '看起来像 JSON，但解析失败，已尝试回退到 HTML 表格' });
    else {
      decodedDepth = decoded.depth;
      const hit = findPayloadArray(decoded.value, pack.payloadArrayPriority);
      if (!hit) diagnostics.push({ code: 'no-payload-array', channel: 'json', message: 'JSON 里没有找到可用的记录数组' });
      else {
        const mapped = mapRows<T>(scope, hit.array, pack, 'json');
        const fields = scope === 'grades' ? GRADE_FIELDS : EXAM_FIELDS;
        if (mapped.records.length) return makeResult<T>(scope, 'json', mapped.records, mapped.diagnostics, mapped.fieldPresence, raw, decodedDepth, hit.key, mapped.rawRowCount, startedAt);
        diagnostics.push(...mapped.diagnostics);
        return makeResult<T>(scope, 'json', [], diagnostics, fieldCount([], fields), raw, decodedDepth, hit.key, mapped.rawRowCount, startedAt);
      }
    }
  }

  const table = parseHtmlTable(raw);
  if (table.tableCount > 0) {
    if (!table.headers.length) diagnostics.push({ code: 'no-header', channel: 'html', message: '找到表格，但没有找到可用表头' });
    if (!table.rows.length) diagnostics.push({ code: 'no-records', channel: 'html', message: '表格没有可解析的数据行' });
    if (table.rows.length) {
      const mapped = mapRows<T>(scope, table.rows, pack, 'html');
      if (mapped.records.length) return makeResult<T>(scope, 'html', mapped.records, diagnostics.concat(mapped.diagnostics), mapped.fieldPresence, raw, decodedDepth, 'table', mapped.rawRowCount, startedAt);
      diagnostics.push(...mapped.diagnostics);
    }
  } else diagnostics.push({ code: 'no-table', channel: 'html', message: '页面里没有找到 HTML 表格' });

  return emptyResult<T>(scope, raw, startedAt, diagnostics);
}

export function parseGrades(input: string, rulePack: RulePack = DEFAULT_RULE_PACK): ParseResult<GradeRecord> {
  return parseAcademicPayload<GradeRecord>(input, 'grades', rulePack);
}

export function parseExams(input: string, rulePack: RulePack = DEFAULT_RULE_PACK): ParseResult<ExamRecord> {
  return parseAcademicPayload<ExamRecord>(input, 'exams', rulePack);
}

export function keepLastSuccessful<T extends AcademicRecord>(previous: ParseResult<T> | null, next: ParseResult<T>): { result: ParseResult<T>; kept: boolean } {
  if (next.records.length > 0 || !previous || previous.records.length === 0) return { result: next, kept: false };
  const diagnostics = next.diagnostics.concat([{ code: 'last-success-kept', channel: 'input', message: '这次没有解析出数据，继续保留上一次成功结果' }]);
  return { kept: true, result: { ...next, records: previous.records, diagnostics, stats: { ...next.stats, recordCount: previous.records.length } } };
}

export function classifyMenuUrl(value: string): MenuKind {
  const text = toText(value).toLowerCase();
  if (/cjcx|成绩/.test(text)) return 'grades';
  if (/kwgl|kscx|考试|考务/.test(text)) return 'exams';
  if (/kbcx|课表/.test(text)) return 'timetable';
  return 'unknown';
}

export function discoverMenuEntries(html: string, hints: string[] = DEFAULT_MENU_HINTS): MenuEntry[] {
  const out: MenuEntry[] = [];
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(String(html || ''))) !== null) {
    const attrs = m[1] || '';
    const body = htmlToText(m[2] || '');
    const href = (attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    const quoted = Array.from(attrs.matchAll(/["']([^"']+)["']/g)).map((row) => row[1]).filter((value) => hints.some((hint) => value.toLowerCase().includes(hint.toLowerCase())));
    const url = href && hints.some((hint) => href.toLowerCase().includes(hint.toLowerCase())) ? href : (quoted[0] || '');
    if (!url) continue;
    if (out.some((entry) => entry.url === url)) continue;
    out.push({ label: body, url, kind: classifyMenuUrl(url + ' ' + body) });
  }
  return out;
}
