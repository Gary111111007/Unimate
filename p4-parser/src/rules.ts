import type { ParseScope } from './types.ts';

export const GRADE_FIELDS = [
  'courseCode', 'courseName', 'credits', 'score', 'point', 'nature', 'category',
  'teacher', 'assessment', 'status', 'remark', 'year', 'term'
] as const;

export const EXAM_FIELDS = [
  'courseCode', 'courseName', 'examType', 'examTime', 'location', 'campus',
  'seat', 'mode', 'remark', 'year', 'term'
] as const;

export type GradeField = typeof GRADE_FIELDS[number];
export type ExamField = typeof EXAM_FIELDS[number];
export type AliasMap<F extends string> = Partial<Record<F, string[]>>;

export interface RuleScope<F extends string> {
  aliases: AliasMap<F>;
}

export interface RulePack {
  schemaVersion: number;
  schoolId: string;
  version: string;
  menuHints: string[];
  payloadArrayPriority: string[];
  scopes: {
    grades?: RuleScope<GradeField>;
    exams?: RuleScope<ExamField>;
  };
}

export type RulePackValidation =
  | { ok: true; pack: RulePack }
  | { ok: false; errors: string[] };

export const DEFAULT_PAYLOAD_ARRAY_PRIORITY = [
  'kblist', 'items', 'rows', 'data', 'result', 'list', 'aadata', 'records',
  'recordlist', 'datalist', 'gradelist', 'courselist', 'sjklist', 'jxhjkclist'
];

export const DEFAULT_MENU_HINTS = ['jwglxt', 'cjcx', 'kbcx', 'kwgl'];

const DEFAULT_GRADE_ALIASES: Record<GradeField, string[]> = {
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
};

const DEFAULT_EXAM_ALIASES: Record<ExamField, string[]> = {
  courseCode: ['kch', 'courseCode', '课程代码', 'kch_id', 'kcdm', '课程号'],
  courseName: ['kcmc', 'courseName', '课程名称', '课程'],
  examType: ['ksmc', 'examType', '考试名称'],
  examTime: ['kssj', 'examTime', '考试时间'],
  location: ['cdmc', 'location', '考试地点'],
  campus: ['xqmc', 'cdxqmc', 'campus', '校区'],
  seat: ['zwh', 'seat', '座号', '座位号'],
  mode: ['ksfs', 'mode', '考试方式'],
  remark: ['ksbz', 'bzxx', 'bz', 'remark', '备注'],
  year: ['xnm', 'xn', 'xnmc', 'year', '学年'],
  term: ['xqm', 'xq', 'xqmmc', 'semester', '学期']
};

export const DEFAULT_RULE_PACK: RulePack = {
  schemaVersion: 1,
  schoolId: 'default',
  version: '1.0.0',
  menuHints: DEFAULT_MENU_HINTS.slice(),
  payloadArrayPriority: DEFAULT_PAYLOAD_ARRAY_PRIORITY.slice(),
  scopes: {
    grades: { aliases: DEFAULT_GRADE_ALIASES },
    exams: { aliases: DEFAULT_EXAM_ALIASES }
  }
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isShortString(value: unknown, max = 64): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
}

function validateStringList(value: unknown, where: string, errors: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(where + ' 必须是非空字符串数组');
    return;
  }
  value.forEach((item, index) => {
    if (!isShortString(item, 32)) errors.push(where + '[' + index + '] 不是合法短字符串');
  });
}

function validateAliasMap(value: unknown, fields: readonly string[], where: string, errors: string[]): void {
  if (!isPlainObject(value)) {
    errors.push(where + ' 必须是对象');
    return;
  }
  for (const field of Object.keys(value)) {
    if (fields.indexOf(field) < 0) {
      errors.push(where + ' 包含未知字段：' + field);
      continue;
    }
    const aliases = value[field];
    if (!Array.isArray(aliases) || aliases.length === 0) {
      errors.push(where + '.' + field + ' 必须是非空字符串数组');
      continue;
    }
    aliases.forEach((alias, index) => {
      if (!isShortString(alias, 64)) errors.push(where + '.' + field + '[' + index + '] 不是合法别名');
    });
  }
}

export function validateRulePack(input: unknown): RulePackValidation {
  const errors: string[] = [];
  if (!isPlainObject(input)) return { ok: false, errors: ['规则包必须是对象'] };

  const allowedRoot = ['schemaVersion', 'schoolId', 'version', 'menuHints', 'payloadArrayPriority', 'scopes'];
  for (const key of Object.keys(input)) {
    if (allowedRoot.indexOf(key) < 0) errors.push('规则包包含未知键：' + key);
  }

  if (input.schemaVersion !== 1) errors.push('schemaVersion 必须是 1');
  if (typeof input.schoolId !== 'string' || !/^[a-z][a-z0-9-]{1,31}$/.test(input.schoolId)) {
    errors.push('schoolId 只允许小写字母、数字和连字符（2~32 位）');
  }
  if (!isShortString(input.version, 32)) errors.push('version 必须是非空短字符串');

  validateStringList(input.menuHints, 'menuHints', errors);
  validateStringList(input.payloadArrayPriority, 'payloadArrayPriority', errors);

  if (!isPlainObject(input.scopes)) {
    errors.push('scopes 必须是对象');
  } else {
    for (const scope of Object.keys(input.scopes)) {
      if (scope !== 'grades' && scope !== 'exams') errors.push('scopes 包含未知范围：' + scope);
    }
    for (const scope of ['grades', 'exams'] as const) {
      const rawScope = input.scopes[scope];
      if (rawScope === undefined) continue;
      if (!isPlainObject(rawScope)) {
        errors.push('scopes.' + scope + ' 必须是对象');
        continue;
      }
      const fields = scope === 'grades' ? GRADE_FIELDS : EXAM_FIELDS;
      validateAliasMap(rawScope.aliases, fields, 'scopes.' + scope + '.aliases', errors);
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, pack: input as unknown as RulePack };
}

function mergeAliases<F extends string>(defaults: Record<F, string[]>, supplied: AliasMap<F> | undefined): Record<F, string[]> {
  const merged = {} as Record<F, string[]>;
  for (const field of Object.keys(defaults) as F[]) {
    merged[field] = (supplied && supplied[field] ? supplied[field] : defaults[field]).slice();
  }
  return merged;
}

export function resolveGradeAliases(pack: RulePack): Record<GradeField, string[]> {
  return mergeAliases(DEFAULT_GRADE_ALIASES, pack.scopes.grades && pack.scopes.grades.aliases);
}

export function resolveExamAliases(pack: RulePack): Record<ExamField, string[]> {
  return mergeAliases(DEFAULT_EXAM_ALIASES, pack.scopes.exams && pack.scopes.exams.aliases);
}

export function resolveAliases(pack: RulePack, scope: ParseScope): Record<string, string[]> {
  return scope === 'grades' ? resolveGradeAliases(pack) : resolveExamAliases(pack);
}

export function cloneRulePack(pack: RulePack): RulePack {
  return JSON.parse(JSON.stringify(pack)) as RulePack;
}
