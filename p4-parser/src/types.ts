export type ParseScope = 'grades' | 'exams';
export type ParseChannel = 'json' | 'html';
export type DiagnosticChannel = 'input' | 'rules' | ParseChannel;

export type DiagnosticCode =
  | 'invalid-rule-pack'
  | 'empty-input'
  | 'json-parse-failed'
  | 'no-payload-array'
  | 'no-table'
  | 'no-header'
  | 'no-records'
  | 'row-dropped'
  | 'missing-fields'
  | 'internal-course-id-filtered'
  | 'last-success-kept';

export interface ParseDiagnostic {
  code: DiagnosticCode;
  channel: DiagnosticChannel;
  message: string;
  row?: number;
  fields?: string[];
}

export interface GradeRecord {
  courseCode: string;
  courseName: string;
  credits: number | null;
  score: string;
  point: number | null;
  nature: string;
  category: string;
  teacher: string;
  assessment: string;
  status: string;
  remark: string;
  termId: string;
}

export interface ExamRecord {
  courseCode: string;
  courseName: string;
  examType: string;
  examTime: string;
  startAt: number | null;
  location: string;
  campus: string;
  seat: string;
  mode: string;
  remark: string;
  termId: string;
}

export type AcademicRecord = GradeRecord | ExamRecord;

export interface ParseStats {
  inputBytes: number;
  decodedDepth: number;
  payloadKey: string;
  rawRowCount: number;
  recordCount: number;
  recognizedFields: string[];
  fieldPresence: Record<string, number>;
  durationMs: number;
}

export interface ParseResult<T extends AcademicRecord> {
  scope: ParseScope;
  channel: ParseChannel | null;
  records: T[];
  diagnostics: ParseDiagnostic[];
  stats: ParseStats;
}
