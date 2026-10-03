import { readJson, writeJson } from './io.ts';

export type CampusFeature = 'map' | 'venues' | 'fitness' | 'freeClassrooms' | 'courseCatalog' | 'courseSelectionPost';
export type CampusQuality = 'live' | 'cached' | 'imported' | 'demo' | 'unsupported';

export interface CampusCapabilities {
  map: boolean;
  venues: boolean;
  fitness: boolean;
  freeClassrooms: boolean;
  courseCatalog: boolean;
  courseSelectionPost: boolean;
}

export interface CampusResult<T> {
  data: T;
  quality: CampusQuality;
  source: string;
  capturedAt: string;
  complete: boolean;
  message?: string;
}

export interface FreeClassroom {
  id: string;
  room: string;
  campus: string;
  building: string;
  type: string;
  capacity: string;
}

export interface CourseCatalogItem {
  id: string;
  title: string;
  courseCode: string;
  className: string;
  teacher: string;
  credits: string;
  time: string;
  room: string;
  status: string;
}

export interface CourseSelectionTarget extends CourseCatalogItem {
  savedAt: string;
}

export const BUCT_FREE_CLASSROOM_URL = 'https://jwglxt.buct.edu.cn/jwglxt/cdjy/cdjy_cxKxcdlb.html?gnmkdm=N2155&layout=default';
export const BUCT_SCHOOL_SCHEDULE_URL = 'https://jwglxt.buct.edu.cn/jwglxt/design/viewFunc_cxDesignFuncPageIndex.html?gnmkdm=N219933&layout=default';
export const BUCT_COURSE_SELECTION_URL = 'https://jwglxt.buct.edu.cn/jwglxt/xsxk/zzxkyzb_cxZzxkYzbIndex.html?gnmkdm=N253512&layout=default';

export function campusCapabilities(schoolId: string | undefined): CampusCapabilities {
  const buct = schoolId === 'buct';
  return {
    map: buct,
    venues: buct,
    fitness: buct,
    freeClassrooms: buct,
    courseCatalog: buct,
    // 学校规则与自动化提交授权尚未明确，真实 POST 永久由此开关阻断。
    courseSelectionPost: false
  };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/giu, ' ')
    .replace(/&amp;/giu, '&').replace(/&lt;/giu, '<').replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"').replace(/&#39;|&apos;/giu, "'")
    .replace(/&#(\d+);/gu, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/giu, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

export function htmlText(value: string): string {
  return decodeEntities(String(value || '').replace(/<script\b[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/giu, ' ').replace(/<[^>]+>/gu, ' '))
    .replace(/\s+/gu, ' ').trim().slice(0, 300);
}

export function parseHtmlTables(html: string): string[][][] {
  return [...String(html || '').matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/giu)].map((table) =>
    [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)].map((row) =>
      [...row[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/giu)].map((cell) => htmlText(cell[1]))
    ).filter((row) => row.some(Boolean))
  ).filter((table) => table.length > 1);
}

function headerIndex(headers: string[], patterns: RegExp[], fallback = -1): number {
  const found = headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
  return found < 0 ? fallback : found;
}
function valueAt(row: string[], index: number): string { return index >= 0 ? String(row[index] || '').trim() : ''; }
function dataTable(html: string): { headers: string[]; rows: string[][] } | null {
  const tables = parseHtmlTables(html).sort((a, b) => b.length - a.length);
  for (const table of tables) {
    const first = table[0];
    if (first.length < 2) continue;
    return { headers: first.map((x) => x.replace(/\s+/gu, '')), rows: table.slice(1).filter((row) => row.some(Boolean)) };
  }
  return null;
}

export function parseFreeClassrooms(html: string): FreeClassroom[] {
  const table = dataTable(html);
  if (!table) return [];
  const h = table.headers;
  const room = headerIndex(h, [/教室/u, /场地名称/u, /场地/u, /cdmc/iu], 0);
  const campus = headerIndex(h, [/校区/u, /xqmc/iu]);
  const building = headerIndex(h, [/教学楼/u, /楼宇/u, /楼号/u, /jxl/iu]);
  const type = headerIndex(h, [/类别/u, /类型/u, /cdlb/iu]);
  const capacity = headerIndex(h, [/座位/u, /容量/u, /人数/u, /zws/iu]);
  return table.rows.map((row, index) => ({
    id: 'room-' + index + '-' + valueAt(row, room),
    room: valueAt(row, room), campus: valueAt(row, campus), building: valueAt(row, building),
    type: valueAt(row, type), capacity: valueAt(row, capacity)
  })).filter((item) => item.room && !/合计|查询条件|没有数据/u.test(item.room)).slice(0, 500);
}

export function parseCourseCatalog(html: string): CourseCatalogItem[] {
  const table = dataTable(html);
  if (!table) return [];
  const h = table.headers;
  const title = headerIndex(h, [/课程名称/u, /^课程$/u, /kcmc/iu], 0);
  const code = headerIndex(h, [/课程号/u, /课程代码/u, /kch/iu]);
  const className = headerIndex(h, [/教学班/u, /班级/u, /jxb/iu]);
  const teacher = headerIndex(h, [/教师/u, /授课/u, /jsxm/iu]);
  const credits = headerIndex(h, [/学分/u, /xf/iu]);
  const time = headerIndex(h, [/时间/u, /上课/u, /sksj/iu]);
  const room = headerIndex(h, [/教室/u, /地点/u, /场地/u, /jxdd/iu]);
  const status = headerIndex(h, [/状态/u, /余量/u, /人数/u, /zt/iu]);
  return table.rows.map((row, index) => ({
    id: 'course-' + index + '-' + valueAt(row, code) + '-' + valueAt(row, className),
    title: valueAt(row, title), courseCode: valueAt(row, code), className: valueAt(row, className),
    teacher: valueAt(row, teacher), credits: valueAt(row, credits), time: valueAt(row, time),
    room: valueAt(row, room), status: valueAt(row, status)
  })).filter((item) => item.title && !/合计|查询条件|没有数据/u.test(item.title)).slice(0, 1000);
}

export function campusUserBase(schoolId: string, accountId: string): string {
  return 'schools/' + schoolId + '/users/' + accountId + '/campus';
}

export async function loadSelectionTargets(userBase: string): Promise<CourseSelectionTarget[]> {
  return readJson<CourseSelectionTarget[]>(userBase + '/selection-targets.json', []);
}

export async function saveSelectionTargets(userBase: string, targets: CourseSelectionTarget[]): Promise<void> {
  // 独立文件不在云备份清单中：选课目标默认不进入云端、模型或 n8n。
  await writeJson(userBase + '/selection-targets.json', targets.slice(0, 30));
}
