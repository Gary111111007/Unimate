export interface ExamTimeParts {
  date: string;
  start: string;
  end: string;
  startAt: number | null;
  ok: boolean;
}

const ENTITY_MAP: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_all, entity: string) => {
    const key = entity.toLowerCase();
    if (key[0] === '#') {
      const hex = key[1] === 'x';
      const n = parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _all;
    }
    return ENTITY_MAP[key] !== undefined ? ENTITY_MAP[key] : _all;
  });
}

export function htmlToText(value: string): string {
  return decodeHtmlEntities(String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' '))
    .replace(/[\u00a0\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function canonicalKey(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\s_\-:：·—–/\\()[\]{}【】《》<>]+/g, '')
    .toLowerCase();
}

export function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(' ');
  return '';
}

interface FlatEntry { key: string; value: unknown }

function collectEntries(value: unknown, depth: number, maxDepth: number, out: FlatEntry[], seen: Set<unknown>): void {
  if (!value || typeof value !== 'object' || depth > maxDepth) return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectEntries(item, depth + 1, maxDepth, out, seen);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out.push({ key: canonicalKey(key), value: child });
    if (child && typeof child === 'object') collectEntries(child, depth + 1, maxDepth, out, seen);
  }
}

export function readFieldValues(record: unknown, aliases: string[]): unknown[] {
  const entries: FlatEntry[] = [];
  collectEntries(record, 0, 3, entries, new Set<unknown>());
  const wanted = aliases.map(canonicalKey).filter(Boolean);
  const values: unknown[] = [];
  for (const alias of wanted) {
    const hit = entries.find((entry) => entry.key === alias);
    if (hit) values.push(hit.value);
  }
  return values;
}

export function readField(record: unknown, aliases: string[]): string {
  const values = readFieldValues(record, aliases);
  for (const value of values) {
    const text = toText(value);
    if (text) return text;
  }
  return '';
}

export function parseNumberLoose(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = toText(value).normalize('NFKC');
  if (!text) return null;
  const m = text.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

export function extractGpa(value: unknown): number | null {
  const text = toText(value).normalize('NFKC');
  if (!text) return null;
  const labelled = text.match(/(?:GPA|平均学分绩点|平均绩点|总平均绩点|学分绩点)\s*[:：]?\s*([0-4](?:\.\d{1,3})?)/i);
  if (labelled) return Number(labelled[1]);
  const generic = text.match(/(?:^|[^0-9])([0-4](?:\.\d{1,3})?)(?:$|[^0-9])/);
  return generic ? Number(generic[1]) : null;
}

export function isInternalCourseId(value: string): boolean {
  return /^[0-9A-F]{16,}$/i.test(toText(value));
}

export function isStandardCourseCode(value: string): boolean {
  return /^[A-Z]{2,6}[A-Z0-9]*\d[A-Z0-9]*[A-Z]$/.test(toText(value).toUpperCase());
}

function extractCodeTokens(values: unknown[]): string[] {
  const tokens: string[] = [];
  for (const value of values) {
    const text = toText(value).normalize('NFKC').toUpperCase();
    for (const m of text.matchAll(/[A-Z]{2,6}[A-Z0-9]*\d[A-Z0-9]*[A-Z]|[0-9A-F]{16,}|[A-Z0-9][A-Z0-9._-]{2,}/g)) {
      const token = m[0];
      if (tokens.indexOf(token) < 0) tokens.push(token);
    }
  }
  return tokens;
}

export function chooseCourseCode(values: unknown[]): { code: string; filteredInternal: boolean } {
  const tokens = extractCodeTokens(values);
  const standard = tokens.find(isStandardCourseCode);
  if (standard) return { code: standard, filteredInternal: tokens.some(isInternalCourseId) };
  const normal = tokens.find((token) => !isInternalCourseId(token));
  return { code: normal || '', filteredInternal: tokens.some(isInternalCourseId) };
}

export function normalizeTerm(year: string, term: string): string {
  const y = toText(year).replace(/\s+/g, '');
  let t = toText(term).normalize('NFKC').replace(/\s+/g, '');
  if (!t) return y;
  if (/^1$|第一学期|秋季/.test(t)) t = '1';
  else if (/^2$|第二学期|春季/.test(t)) t = '2';
  else if (/^3$|第三学期|夏季/.test(t)) t = '3';
  return y ? y + '-' + t : t;
}

function pad2(value: string): string {
  return String(Number(value)).padStart(2, '0');
}

export function parseExamTime(value: unknown): ExamTimeParts {
  const text = toText(value).normalize('NFKC').replace(/[（）()]/g, ' ');
  const m = text.match(/(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})\D*?(\d{1,2})[:：](\d{2})\s*[-~—–至]\s*(\d{1,2})[:：](\d{2})/);
  if (!m) return { date: '', start: '', end: '', startAt: null, ok: false };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const startHour = Number(m[4]);
  const startMinute = Number(m[5]);
  const endHour = Number(m[6]);
  const endMinute = Number(m[7]);
  const valid = month >= 1 && month <= 12 && day >= 1 && day <= 31 && startHour <= 23 && startMinute <= 59 && endHour <= 23 && endMinute <= 59;
  if (!valid) return { date: '', start: '', end: '', startAt: null, ok: false };
  const date = String(year).padStart(4, '0') + '-' + pad2(m[2]) + '-' + pad2(m[3]);
  const start = pad2(m[4]) + ':' + pad2(m[5]);
  const end = pad2(m[6]) + ':' + pad2(m[7]);
  const startAt = Date.UTC(year, month - 1, day, startHour, startMinute, 0, 0);
  return { date, start, end, startAt, ok: Number.isFinite(startAt) };
}
