import { validateRulePack, type RulePack } from './rules.ts';

export interface MainAcademicRules {
  schoolId: string;
  menuHints: string[];
  payloadArrayPriority: string[];
  scopes: RulePack['scopes'];
}

export interface MainAcademicRulePack {
  schemaVersion: number;
  adapterId: string;
  kind: 'academic';
  version: number;
  note: string;
  rules: MainAcademicRules;
}

export function toMainAcademicRulePack(pack: RulePack, version = 2): MainAcademicRulePack {
  return {
    schemaVersion: 1,
    adapterId: 'academic-' + pack.schoolId,
    kind: 'academic',
    version,
    note: 'P4 成绩/考试通用识别：别名表 + JSON/HTML 双通道',
    rules: {
      schoolId: pack.schoolId,
      menuHints: pack.menuHints.slice(),
      payloadArrayPriority: pack.payloadArrayPriority.slice(),
      scopes: JSON.parse(JSON.stringify(pack.scopes))
    }
  };
}

export function fromMainAcademicRulePack(input: unknown): RulePack | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const pack = input as Record<string, any>;
  if (pack.kind !== 'academic') return null;
  const rules = pack.rules;
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return null;
  const candidate = {
    schemaVersion: Number(pack.schemaVersion),
    schoolId: String(rules.schoolId || ''),
    version: String(pack.version || ''),
    menuHints: rules.menuHints,
    payloadArrayPriority: rules.payloadArrayPriority,
    scopes: rules.scopes
  };
  const checked = validateRulePack(candidate);
  return checked.ok ? checked.pack : null;
}
