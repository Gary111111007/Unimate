/**
 * 解析器规则层（Net.md P2.5 / PRD 5.15）：把"教务一改版就得发新包"的痛点变成**下发规则包**。
 *
 * 设计红线（Net.md 2.4 原文：*下发并执行 JS 等于把 App 交给远端控制*）：
 *  - 规则包**只能**覆盖白名单里的"字符串/数字/字符表"——选择器片段、正则、字段下标、周次分隔符……
 *    **没有任何可执行代码**，最坏情况也只是"读得更多/更少"；
 *  - 所有正则都由本文件统一编译，编译失败的键**回落到内置默认值**（不会把解析器整体搞崩）；
 *  - 版本口径与学校档案一致：只有 `version > 内置版本` 的下发包才会被激活。
 *
 * 默认值 = 现有两个解析器的硬编码值（Golden Test 57 + 45 条就是"默认值没被改坏"的回归网）。
 */

import { ref } from 'vue';

export type RuleKind = 'timetable' | 'exam' | 'academic';

/** P4 通用学术记录规则：成绩/考试共用别名表 + JSON 载荷优先级 */
export interface AcademicRules {
  schoolId: string;
  menuHints: string[];
  payloadArrayPriority: string[];
  scopes: {
    grades?: { aliases: Record<string, string[]> };
    exams?: { aliases: Record<string, string[]> };
  };
}

export const ACADEMIC_GRADE_FIELDS = [
  'courseCode', 'courseName', 'credits', 'score', 'point', 'nature', 'category',
  'teacher', 'assessment', 'status', 'remark', 'year', 'term'
];

export const ACADEMIC_EXAM_FIELDS = [
  'courseCode', 'courseName', 'examType', 'examTime', 'location', 'campus',
  'seat', 'mode', 'remark', 'year', 'term'
];

/** 课表解析规则（键名即白名单；未知键一律拒收） */
export interface TimetableRules {
  /** 页面 URL 命中正则（决定"这个适配器管不管这一页"） */
  matchUrl: string;
  /** 表格定位标记（按顺序找第一个命中的） */
  tableMarkers: string[];
  tableEndTag: string;
  headerClass: string;
  headerLeftClass: string;
  headerRightClass: string;
  /** 学号前缀正则（去前缀用） */
  studentIdPrefix: string;
  studentNameSuffix: string;
  /** 单元格正则：必须 3 组 = 星期 / 节次 / 单元格内容 */
  cellPattern: string;
  /** 课程块分隔标记（split 用） */
  blockSplitMarker: string;
  /** 课程名正则：1 组 = 标题片段 */
  titlePattern: string;
  /** "待筛选"标记正则（多个，命中任一个即视为待筛选） */
  pendingPatterns: string[];
  /** 字段行正则：1 组 = 整行文本 */
  paraPattern: string;
  /** 节次行正则：3 组 = 起始节 / 结束节 / 周次原文 */
  sectionPattern: string;
  /** 一个节次组的字段个数 */
  groupSize: number;
  /** 字段下标映射（对应页面 <p> 的顺序） */
  fieldMap: {
    location: number; teacher: number; courseCode: number; classNames: number;
    examMode: number; hoursDetail: number; weeklyHours: number; totalHours: number; credit: number;
  };
  /** 周次语法 */
  weekSeparators: string;
  weekRange: string;
  weekParity: string;
  weekSuffix: string;
  weekAllWord: string;
  /** 课型符号表（符号 → 课型） */
  lessonSymbols: Record<string, string>;
}

/** 考试解析规则 */
export interface ExamRules {
  matchUrl: string;
  /** 页面里的表格标记（判断"这一页是不是考试表"的第二依据） */
  htmlMarker: string;
  rowPattern: string;
  cellPattern: string;
  /** 列标记属性名（当前是 aria-describedby="tabGrid_<列>"） */
  colAttr: string;
  /** 从列标记里取列名的分隔符（取最后一段） */
  colNameSeparator: string;
  timePattern: string;
  columns: {
    course: string; time: string; name: string; year: string; term: string;
    campus: string; campusAlt: string; room: string; seat: string;
    examType: string; mode: string; college: string; className: string; note: string;
  };
}

export const TIMETABLE_DEFAULTS: TimetableRules = {
  matchUrl: 'xskbcx_cxXskbcxIndex|gnmkdm=N2151',
  tableMarkers: ['id="kbgrid_table_0"', 'timetable1'],
  tableEndTag: '</table>',
  headerClass: 'timetable_title',
  headerLeftClass: 'pull-left',
  headerRightClass: 'pull-right',
  studentIdPrefix: '^[　\\s]*学号[:：]\\s*',
  studentNameSuffix: '的课表',
  cellPattern: '<td[^>]*\\bid="(\\d+)-(\\d+)"[^>]*>([\\s\\S]*?)</td>',
  blockSplitMarker: 'class="timetable_con',
  titlePattern: 'class="title"[^>]*>([\\s\\S]*?)</span>',
  pendingPatterns: ['color=["\']?red', '<i[\\s>]'],
  paraPattern: '<p[^>]*>([\\s\\S]*?)</p>',
  // 页面上的节次行形如 "(1-2节) 1-9周"：节**在**右括号之前
  sectionPattern: '^\\((\\d+)-(\\d+)节\\)(.*)$',
  groupSize: 11,
  fieldMap: {
    location: 1, teacher: 2, courseCode: 3, classNames: 4,
    examMode: 5, hoursDetail: 7, weeklyHours: 8, totalHours: 9, credit: 10
  },
  weekSeparators: '[,，、]',
  weekRange: '[-~到]',
  weekParity: '(单|双)',
  weekSuffix: '周',
  weekAllWord: '全周',
  lessonSymbols: { '★': 'lecture', '◇': 'machine', '●': 'practice', '○': 'lab' }
};

export const EXAM_DEFAULTS: ExamRules = {
  matchUrl: 'kscx_cxXsksxxIndex|gnmkdm=N358105',
  htmlMarker: 'tabGrid_kssj',
  rowPattern: '<tr[^>]*>([\\s\\S]*?)</tr>',
  cellPattern: '<td([^>]*)>([\\s\\S]*?)</td>',
  colAttr: 'aria-describedby',
  colNameSeparator: '_',
  timePattern: '(\\d{4})[-/.年](\\d{1,2})[-/.月](\\d{1,2})日?[^0-9]{0,3}(\\d{1,2}):(\\d{2})[^0-9]{0,3}(\\d{1,2}):(\\d{2})',
  columns: {
    course: 'kcmc', time: 'kssj', name: 'ksmc', year: 'xnmc', term: 'xqmmc',
    campus: 'cdxqmc', campusAlt: 'xqmc', room: 'cdmc', seat: 'zwh',
    examType: 'khfs', mode: 'ksfs', college: 'kkxy', className: 'jxbmc', note: 'ksbz'
  }
};

export const ACADEMIC_DEFAULTS: AcademicRules = {
  schoolId: 'buct',
  menuHints: ['jwglxt', 'cjcx', 'kbcx', 'kwgl'],
  payloadArrayPriority: [
    'kblist', 'items', 'rows', 'data', 'result', 'list', 'aadata', 'records',
    'recordlist', 'datalist', 'gradelist', 'courselist', 'sjklist', 'jxhjkclist'
  ],
  scopes: {
    grades: {
      aliases: {
        courseCode: ['kch', 'courseCode', '课程代码', 'kch_id', 'kcdm', '课程号'],
        courseName: ['kcmc', 'courseName', '课程名称', '课程'],
        credits: ['xf', 'credits', '学分'],
        score: ['cj', 'score', '成绩'],
        point: ['jd', 'point', '绩点'],
        nature: ['kcxz', 'nature', '课程性质'],
        category: ['kclb', 'category', '课程类别'],
        teacher: ['jsxm', 'teacher', '教师'],
        assessment: ['ksxz', 'assessment', '考核方式'],
        status: ['cjbs', 'status', '成绩状态'],
        remark: ['bzxx', 'cjbz', 'bz', 'ksbz', 'remark', '备注'],
        year: ['xnm', 'xn', 'xnmc', 'year', '学年'],
        term: ['xqm', 'xq', 'xqmmc', 'semester', '学期']
      }
    },
    exams: {
      aliases: {
        courseCode: ['kch', 'courseCode', '课程代码', 'kch_id', 'kcdm', '课程号'],
        courseName: ['kcmc', 'courseName', '课程名称', '课程'],
        examType: ['ksmc', 'examType', '考试名称'],
        examTime: ['kssj', 'examTime', '考试时间'],
        location: ['cdmc', 'location', '考试地点'],
        campus: ['xqmc', 'cdxqmc', 'campus', '校区', '考试校区'],
        seat: ['zwh', 'seat', '座号', '座位号', '考试座号'],
        mode: ['ksfs', 'mode', '考试方式'],
        remark: ['ksbz', 'bzxx', 'bz', 'remark', '备注'],
        year: ['xnm', 'xn', 'xnmc', 'year', '学年'],
        term: ['xqm', 'xq', 'xqmmc', 'semester', '学期']
      }
    }
  }
};

/** 内置规则版本：下发的规则包只有 `version > 这里` 才会被激活（口径同学校档案） */
export const BUILTIN_ADAPTER_VERSIONS: Record<string, number> = {
  'jwglxt-buct': 1,
  'jwglxt-exam': 1,
  'academic-buct': 1
};

export function builtinAdapterVersion(adapterId: string): number {
  return BUILTIN_ADAPTER_VERSIONS[adapterId] || 1;
}

export interface RulePack {
  schemaVersion: number;
  adapterId: string;
  kind: RuleKind;
  version: number;
  note?: string;
  rules: Record<string, any>;
}

const MAX_STR = 200;
const MAX_LIST = 12;

function badString(v: unknown): boolean {
  return typeof v !== 'string' || v.length === 0 || v.length > MAX_STR;
}

/** 编译正则；失败返回 null（调用方回落到默认值） */
export function compile(pattern: string, flags = ''): RegExp | null {
  try { return new RegExp(pattern, flags); } catch { return null; }
}

function validateAcademicPack(json: any): { ok: true; pack: RulePack } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  const adapterId = String(json.adapterId || '');
  if (!/^[a-z][a-z0-9-]{2,31}$/.test(adapterId)) return fail('adapterId 不合法');
  if (!(Number(json.version) >= 1)) return fail('version 必须是 >=1 的整数');
  if (!(Number(json.schemaVersion) >= 1)) return fail('schemaVersion 必须是 >=1 的整数');
  if (Number(json.schemaVersion) > 1) return fail('规则包格式比这份 App 新，已跳过（请更新 App）');
  const rules = json.rules;
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return fail('rules 必须是对象');
  const allowed = ['schoolId', 'menuHints', 'payloadArrayPriority', 'scopes'];
  for (const k of Object.keys(rules)) if (allowed.indexOf(k) < 0) return fail('不认识的规则键：' + k);
  if (!/^[a-z][a-z0-9-]{1,15}$/.test(String(rules.schoolId || ''))) return fail('rules.schoolId 不合法');
  const listOk = (value: unknown, max: number): boolean => Array.isArray(value) && value.length > 0 && value.length <= max && value.every((x) => !badString(x));
  if (!listOk(rules.menuHints, MAX_LIST)) return fail('menuHints 必须是非空短字符串数组');
  if (!listOk(rules.payloadArrayPriority, 32)) return fail('payloadArrayPriority 必须是非空短字符串数组');
  const scopes = rules.scopes;
  if (!scopes || typeof scopes !== 'object' || Array.isArray(scopes)) return fail('scopes 必须是对象');
  for (const scope of Object.keys(scopes)) if (scope !== 'grades' && scope !== 'exams') return fail('scopes 包含未知范围：' + scope);
  for (const scope of ['grades', 'exams'] as const) {
    const raw = scopes[scope];
    if (raw === undefined) continue;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !raw.aliases || typeof raw.aliases !== 'object' || Array.isArray(raw.aliases)) {
      return fail('scopes.' + scope + '.aliases 必须是对象');
    }
    const fields = scope === 'grades' ? ACADEMIC_GRADE_FIELDS : ACADEMIC_EXAM_FIELDS;
    for (const field of Object.keys(raw.aliases)) {
      if (fields.indexOf(field) < 0) return fail('scopes.' + scope + '.aliases 包含未知字段：' + field);
      if (!listOk(raw.aliases[field], 16)) return fail('scopes.' + scope + '.aliases.' + field + ' 必须是非空短字符串数组');
    }
  }
  return { ok: true, pack: { schemaVersion: Number(json.schemaVersion), adapterId, kind: 'academic', version: Number(json.version), note: String(json.note || ''), rules } };
}

/**
 * 校验一份规则包（**结构 + 键白名单 + 正则可编译 + 取值范围**）。
 * 不做"猜你想干什么"的宽容：多一个键就整份拒收 —— 规则包是安全边界上的东西。
 */
export function validateRulePack(json: any): { ok: true; pack: RulePack } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!json || typeof json !== 'object') return fail('规则包不是对象');
  if (json.kind === 'academic') return validateAcademicPack(json);
  const kind = json.kind;
  if (kind !== 'timetable' && kind !== 'exam') return fail('kind 必须是 timetable、exam 或 academic');
  const adapterId = String(json.adapterId || '');
  if (!/^[a-z][a-z0-9-]{2,31}$/.test(adapterId)) return fail('adapterId 不合法');
  if (!(Number(json.version) >= 1)) return fail('version 必须是 >=1 的整数');
  if (!(Number(json.schemaVersion) >= 1)) return fail('schemaVersion 必须是 >=1 的整数');
  if (Number(json.schemaVersion) > 1) return fail('规则包格式比这份 App 新，已跳过（请更新 App）');
  const rules = json.rules;
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return fail('rules 必须是对象');

  const allowed: string[] = kind === 'timetable'
    ? ['matchUrl', 'tableMarkers', 'tableEndTag', 'headerClass', 'headerLeftClass', 'headerRightClass', 'studentIdPrefix', 'studentNameSuffix',
       'cellPattern', 'blockSplitMarker', 'titlePattern', 'pendingPatterns', 'paraPattern', 'sectionPattern', 'groupSize',
       'fieldMap', 'weekSeparators', 'weekRange', 'weekParity', 'weekSuffix', 'weekAllWord', 'lessonSymbols']
    : ['matchUrl', 'htmlMarker', 'rowPattern', 'cellPattern', 'colAttr', 'colNameSeparator', 'timePattern', 'columns'];
  for (const k of Object.keys(rules)) {
    if (allowed.indexOf(k) < 0) return fail('不认识的规则键：' + k);
  }

  // 正则类字段必须能编译
  const regexKeys = kind === 'timetable'
    ? ['matchUrl', 'studentIdPrefix', 'cellPattern', 'titlePattern', 'paraPattern', 'sectionPattern', 'weekSeparators', 'weekRange', 'weekParity']
    : ['matchUrl', 'rowPattern', 'cellPattern', 'timePattern'];
  for (const k of regexKeys) {
    const v = rules[k];
    if (v === undefined) continue;
    if (badString(v) || !compile(v)) return fail(k + ' 不是能编译的正则');
  }
  for (const k of (kind === 'timetable' ? ['tableEndTag', 'headerClass', 'headerLeftClass', 'headerRightClass', 'studentNameSuffix', 'blockSplitMarker', 'weekSuffix', 'weekAllWord'] : ['htmlMarker', 'colAttr', 'colNameSeparator'])) {
    const v = rules[k];
    if (v === undefined) continue;
    if (badString(v)) return fail(k + ' 必须是非空短字符串');
  }
  if (rules.tableMarkers !== undefined) {
    if (!Array.isArray(rules.tableMarkers) || !rules.tableMarkers.length || rules.tableMarkers.length > MAX_LIST
      || rules.tableMarkers.some((x: unknown) => badString(x))) return fail('tableMarkers 必须是非空短字符串数组');
  }
  if (rules.pendingPatterns !== undefined) {
    if (!Array.isArray(rules.pendingPatterns) || rules.pendingPatterns.length > MAX_LIST
      || rules.pendingPatterns.some((x: unknown) => badString(x) || !compile(x))) return fail('pendingPatterns 必须是可编译的正则数组');
  }
  if (rules.groupSize !== undefined && !(Number.isInteger(rules.groupSize) && rules.groupSize >= 1 && rules.groupSize <= 64)) {
    return fail('groupSize 必须是 1..64 的整数');
  }
  if (rules.lessonSymbols !== undefined) {
    const ls = rules.lessonSymbols;
    if (!ls || typeof ls !== 'object' || Array.isArray(ls)) return fail('lessonSymbols 必须是对象');
    for (const [sym, t] of Object.entries(ls)) {
      if (sym.length === 0 || sym.length > 2) return fail('课型符号长度不合法：' + sym);
      if (['lecture', 'machine', 'practice', 'lab', 'other'].indexOf(String(t)) < 0) return fail('课型值不合法：' + String(t));
    }
  }
  if (rules.fieldMap !== undefined) {
    const fm = rules.fieldMap;
    if (!fm || typeof fm !== 'object' || Array.isArray(fm)) return fail('fieldMap 必须是对象');
    const keys = Object.keys(TIMETABLE_DEFAULTS.fieldMap);
    for (const k of Object.keys(fm)) {
      if (keys.indexOf(k) < 0) return fail('fieldMap 里不认识的键：' + k);
      const n = fm[k];
      if (!(Number.isInteger(n) && n >= 0 && n <= 63)) return fail('fieldMap.' + k + ' 必须是 0..63 的整数');
    }
  }
  if (rules.columns !== undefined) {
    const cols = rules.columns;
    if (!cols || typeof cols !== 'object' || Array.isArray(cols)) return fail('columns 必须是对象');
    const keys = Object.keys(EXAM_DEFAULTS.columns);
    for (const k of Object.keys(cols)) {
      if (keys.indexOf(k) < 0) return fail('columns 里不认识的键：' + k);
      if (badString(cols[k])) return fail('columns.' + k + ' 必须是非空短字符串');
    }
  }
  return { ok: true, pack: { schemaVersion: Number(json.schemaVersion), adapterId, kind, version: Number(json.version), note: String(json.note || ''), rules } };
}

// ---------------- 生效中的规则（由 store 在启动/下载后注入） ----------------

/*
 * 必须是 **ref**，不能是普通对象：界面上的"解析规则：内置 v1 / 规则包 v2"是 computed，
 * 普通对象改了它不会重算 —— 真机演示时就是"下载成功但文字不变"（第一版就踩了）。
 */
const activeRef = ref<Record<string, RulePack>>({});

/** 注入已下载且通过校验的规则包（只激活"版本比内置新"的那些） */
export function setActiveRulePacks(packs: Record<string, RulePack>): void {
  const next: Record<string, RulePack> = {};
  for (const id of Object.keys(packs || {})) {
    const p = packs[id];
    if (!p || p.adapterId !== id) continue;
    if (Number(p.version) > builtinAdapterVersion(id)) next[id] = p;
  }
  activeRef.value = next;
}

export function activeRulePacks(): Record<string, RulePack> { return activeRef.value; }

function cloneAliases(source: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const key of Object.keys(source)) out[key] = source[key].slice();
  return out;
}

function academicDefaults(): AcademicRules {
  return {
    schoolId: ACADEMIC_DEFAULTS.schoolId,
    menuHints: ACADEMIC_DEFAULTS.menuHints.slice(),
    payloadArrayPriority: ACADEMIC_DEFAULTS.payloadArrayPriority.slice(),
    scopes: {
      grades: { aliases: cloneAliases(ACADEMIC_DEFAULTS.scopes.grades!.aliases) },
      exams: { aliases: cloneAliases(ACADEMIC_DEFAULTS.scopes.exams!.aliases) }
    }
  };
}

/** P4 通用学术规则：内置默认值 + 已下载 academic 规则包覆盖项（逐字段别名合并） */
export function academicRules(adapterId = 'academic-buct'): AcademicRules {
  const base = academicDefaults();
  const pack = activeRef.value[adapterId];
  if (!pack || pack.kind !== 'academic') return base;
  const rules = pack.rules as AcademicRules;
  const mergeScope = (scope: 'grades' | 'exams'): { aliases: Record<string, string[]> } => {
    const defaults = base.scopes[scope]!.aliases;
    const supplied = rules.scopes && rules.scopes[scope] && rules.scopes[scope]!.aliases ? rules.scopes[scope]!.aliases : {};
    const aliases = cloneAliases(defaults);
    for (const key of Object.keys(supplied)) aliases[key] = supplied[key].slice();
    return { aliases };
  };
  return {
    schoolId: String(rules.schoolId || base.schoolId),
    menuHints: Array.isArray(rules.menuHints) && rules.menuHints.length ? rules.menuHints.slice() : base.menuHints,
    payloadArrayPriority: Array.isArray(rules.payloadArrayPriority) && rules.payloadArrayPriority.length ? rules.payloadArrayPriority.slice() : base.payloadArrayPriority,
    scopes: { grades: mergeScope('grades'), exams: mergeScope('exams') }
  };
}
/** 当前该用哪套规则：内置默认值 + 生效规则包里的覆盖项（逐键合并，正则已在校验期编译过） */
export function timetableRules(adapterId = 'jwglxt-buct'): TimetableRules {
  const pack = activeRef.value[adapterId];
  const r = TIMETABLE_DEFAULTS;
  if (!pack || pack.kind !== 'timetable') return { ...r, fieldMap: { ...r.fieldMap }, lessonSymbols: { ...r.lessonSymbols }, tableMarkers: r.tableMarkers.slice(), pendingPatterns: r.pendingPatterns.slice() };
  const o = pack.rules;
  return {
    matchUrl: o.matchUrl || r.matchUrl,
    tableMarkers: o.tableMarkers || r.tableMarkers.slice(),
    tableEndTag: o.tableEndTag || r.tableEndTag,
    headerClass: o.headerClass || r.headerClass,
    headerLeftClass: o.headerLeftClass || r.headerLeftClass,
    headerRightClass: o.headerRightClass || r.headerRightClass,
    studentIdPrefix: o.studentIdPrefix || r.studentIdPrefix,
    studentNameSuffix: o.studentNameSuffix || r.studentNameSuffix,
    cellPattern: o.cellPattern || r.cellPattern,
    blockSplitMarker: o.blockSplitMarker || r.blockSplitMarker,
    titlePattern: o.titlePattern || r.titlePattern,
    pendingPatterns: o.pendingPatterns || r.pendingPatterns.slice(),
    paraPattern: o.paraPattern || r.paraPattern,
    sectionPattern: o.sectionPattern || r.sectionPattern,
    groupSize: o.groupSize || r.groupSize,
    fieldMap: { ...r.fieldMap, ...(o.fieldMap || {}) },
    weekSeparators: o.weekSeparators || r.weekSeparators,
    weekRange: o.weekRange || r.weekRange,
    weekParity: o.weekParity || r.weekParity,
    weekSuffix: o.weekSuffix || r.weekSuffix,
    weekAllWord: o.weekAllWord || r.weekAllWord,
    lessonSymbols: { ...r.lessonSymbols, ...(o.lessonSymbols || {}) }
  };
}

export function examRules(adapterId = 'jwglxt-exam'): ExamRules {
  const pack = activeRef.value[adapterId];
  const r = EXAM_DEFAULTS;
  if (!pack || pack.kind !== 'exam') return { ...r, columns: { ...r.columns } };
  const o = pack.rules;
  return {
    matchUrl: o.matchUrl || r.matchUrl,
    htmlMarker: o.htmlMarker || r.htmlMarker,
    rowPattern: o.rowPattern || r.rowPattern,
    cellPattern: o.cellPattern || r.cellPattern,
    colAttr: o.colAttr || r.colAttr,
    colNameSeparator: o.colNameSeparator || r.colNameSeparator,
    timePattern: o.timePattern || r.timePattern,
    columns: { ...r.columns, ...(o.columns || {}) }
  };
}
