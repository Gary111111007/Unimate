/**
 * 外校正方 jwglxt 课表导入编排（v2.68）。
 *
 * 【为什么单独一层】`zfClient.ts` 是纯函数（RSA、周次、kbList 解析，可单测），
 * `jwwebview.ts` 是原生桥的类型契约，这条文件把它们**接起来**并把结果归一成
 * Unimate 自己的 `ParseResult` —— 于是导入面板不需要知道"方正还是抓页面"，
 * 两条路（jwglxt-buct 抓 DOM / zfimport 调接口）走同一段"预览 → 覆盖/合并 → 入库"。
 *
 * 【边界】
 *  - 密码只在 `zfClient.encryptPassword()` 里变成 RSA 密文，本层不接触明文网络传输；
 *    但**当前实现不走这一层**：登录由用户在 WebView 里自己完成（App 不接触凭据），
 *    本层只负责"用登录好的会话去拉课表"。RSA 那套留给将来的"App 内直连"路径。
 *  - 不读 Cookie 值、不读表单值、不发任何第三方请求。
 */
import { JwWebView, isNativeWebView } from './jwwebview.ts';
import { parseKbList, xqmOf, describeZfError, ZfError, type ZfErrorKind, type ZfCourse } from './zfClient.ts';
import { courseColorIndex } from '../catalog/periods.ts';
import type { Course, ParseDiagnostic, ParseResult } from '../types.ts';

/** 从 `systems.jwglxtUrl` 或用户所在页面推出登录入口（新正方登录页固定路径）。 */
export function loginUrlOf(baseUrl: string): string {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  // 已经指到具体页面（含 .html）就原样用；只给域名就补登录页
  if (/\.html(\?|$)/i.test(base)) return base;
  return base + '/jwglxt/xtgl/login_slogin.html';
}

export interface ZfImportOptions {
  /** 教务系统入口（档案里的 systems.jwglxtUrl） */
  baseUrl: string;
  /** 学年起始年，如 "2025"；不传则用当前年份 */
  xnm?: string;
  /** 学期序号 1/2/3；不传默认 1 */
  semester?: number;
  /** 功能模块码，默认 N2151 */
  gnmkdm?: string;
}

export interface ZfImportOutcome {
  ok: boolean;
  /** 失败时的分类（前端映射人话），成功时为空 */
  errorKind?: ZfErrorKind | 'WEB_UNSUPPORTED' | 'CANCELLED';
  /** 成功的归一化结果，交给 ImportPanel 走既有预览/入库流程 */
  result?: ParseResult;
  /** 原始 kbList JSON（供"留证/上报"用；可能为空） */
  raw?: string;
}

/**
 * 当前年份的学年起始年。9 月之后算新学年（如 2025-09 → "2025"），
 * 8 月及以前仍属上一学年（如 2026-03 → "2025"）。与国内校历口径一致。
 */
export function currentXnm(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;   // 1-12
  return String(m >= 9 ? y : y - 1);
}

/** kbList 分类 → Unimate 的 ParseDiagnostic（保证导入面板的警告区照常工作） */
function diagnose(rows: ZfCourse[], semesterLabel: string): ParseDiagnostic[] {
  const out: ParseDiagnostic[] = [];
  if (!rows.length) {
    out.push({ kind: 'no-courses', message: '教务系统返回了课表，但没有解析到任何课程。可能是这个学期还没排课，或选错了学期。' });
    return out;
  }
  const noWeeks = rows.filter((c) => !c.weeks.length);
  if (noWeeks.length) {
    out.push({ kind: 'unparsed-weeks', message: noWeeks.length + ' 条安排的周次无法解析，导入后请手动补周次' });
  }
  // 冲突检测（与 jwglxtBuct 的口径一致：同日、节次重叠、周次有交集、不同课名）
  const DAY = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      if (a.day !== b.day || a.endPeriod < b.startPeriod || b.endPeriod < a.startPeriod) continue;
      if (a.name === b.name) continue;
      if (a.weeks.length && b.weeks.length && !a.weeks.some((w) => b.weeks.indexOf(w) >= 0)) continue;
      out.push({ kind: 'conflict', message: DAY[a.day] + ' 第' + a.startPeriod + '-' + a.endPeriod + '节：' + a.name + ' 与 ' + b.name + ' 时间重叠', courseName: a.name });
    }
  }
  void semesterLabel;
  return out;
}

/** ZfCourse → Unimate Course（先不落库，id/timetableId 由调用方补） */
export function toCourses(rows: ZfCourse[]): Course[] {
  return rows.map((r, i) => {
    const [campus, ...rest] = r.rooms.trim().split(/\s+/);
    return {
      id: 'zf' + i,
      timetableId: '',
      name: r.name,
      lessonType: 'lecture' as const,
      teacher: r.teacher,
      campus: rest.length ? campus : '',
      room: rest.length ? rest.join(' ') : campus,
      day: r.day,
      startPeriod: r.startPeriod,
      endPeriod: r.endPeriod,
      weeksRaw: r.weeksText,
      weeks: r.weeks,
      credit: null,
      weeklyHours: null,
      totalHours: null,
      examMode: '',
      courseCode: '',
      classNames: '',
      hoursDetail: '',
      colorIndex: courseColorIndex(r.name),
      source: 'jwglxt' as const,
      pendingFilter: false,
      editedFields: [],
      remark: ''
    };
  });
}

/** kbList JSON 文本 → ParseResult（纯函数，好单测） */
export function zfResultFromJson(body: string, semesterLabel: string): ParseResult {
  const rows = parseKbList(body);
  const courses = toCourses(rows);
  return {
    semesterLabel,
    studentName: '',
    studentId: '',
    courses,
    blockCount: rows.length,
    distinctCourseNames: new Set(courses.map((c) => c.name)).size,
    diagnostics: diagnose(rows, semesterLabel)
  };
}

/**
 * 走原生桥拉课表。**只在原生环境可用**（桌面预览返回 WEB_UNSUPPORTED）。
 *
 * 流程：登录页（用户自己输凭据） → 用户点右下角「导入课表」→ 原生用当前会话
 * 调 `/kbcx/xskbcx_cxXsKb.html` 拿 JSON → 这里解析成 ParseResult。
 */
export async function importFromZf(opts: ZfImportOptions): Promise<ZfImportOutcome> {
  if (!isNativeWebView()) return { ok: false, errorKind: 'WEB_UNSUPPORTED' };
  const login = loginUrlOf(opts.baseUrl);
  if (!login) return { ok: false, errorKind: 'PAGE_CHANGED' };

  const semester = opts.semester ?? 1;
  const xnm = opts.xnm || currentXnm();
  let xqm: string;
  try { xqm = xqmOf(semester); }
  catch { return { ok: false, errorKind: 'VALIDATION_FAILED' }; }

  const r = await JwWebView.open({
    url: login,
    startUrl: login,
    title: '正方教务 · 导入课表',
    mode: 'zfimport',
    zfXnm: xnm,
    zfXqm: xqm,
    zfGnmkdm: opts.gnmkdm || 'N2151'
  });

  if (!r.ok) {
    const reason = String(r.reason || 'cancelled');
    if (reason === 'cancelled' || reason === 'web-unsupported') {
      return { ok: false, errorKind: reason === 'web-unsupported' ? 'WEB_UNSUPPORTED' : 'CANCELLED' };
    }
    // 原生只回错误码，翻译成人话的单一来源是 zfClient（AGENTS.md 硬规则 6）
    const kind = (reason.split(':')[0] || 'NETWORK_RETRYABLE') as ZfErrorKind;
    return { ok: false, errorKind: kind };
  }

  const raw = r.html || '';
  try {
    const semesterLabel = xnm + ' 学年 · 第' + semester + '学期';
    return { ok: true, result: zfResultFromJson(raw, semesterLabel), raw };
  } catch (e) {
    return { ok: false, errorKind: e instanceof ZfError ? e.kind : 'PAGE_CHANGED', raw };
  }
}

/** 错误码 → 用户可读文案（统一入口，UI 不许自己编理由） */
export function describeOutcome(o: ZfImportOutcome): string {
  if (o.ok) return '';
  switch (o.errorKind) {
    case 'WEB_UNSUPPORTED': return '当前是桌面预览环境，无法内嵌教务系统。请在手机上安装 APK 后使用。';
    case 'CANCELLED': return '你在教务页面点了返回，这次导入没有进行。';
    case 'PAGE_CHANGED': return '教务系统的页面结构好像变了，暂时无法识别。我们会尽快适配。';
    case 'VALIDATION_FAILED': return '导入参数不完整（学期或学年不对），请重试。';
    default: return describeZfError(o.errorKind as ZfErrorKind);
  }
}
