// Unimate 数据模型（PRD 5.2 / 5.9.1）

export type LessonType = 'lecture' | 'machine' | 'practice' | 'lab' | 'other';
export type CourseSource = 'jwglxt' | 'manual';
export type BlockKey = 'de' | 'zhi' | 'ti' | 'mei' | 'lao';
export type SchoolStatus = 'live' | 'developing' | 'planned';

export interface Timetable {
  id: string;
  name: string;
  semesterLabel: string;
  semesterStartMonday: string;
  totalWeeks: number;
  periodCount: number;
  isActive: boolean;
  source: CourseSource;
  createdAt: string;
  updatedAt: string;
}

export interface Course {
  id: string;
  timetableId: string;
  name: string;
  lessonType: LessonType;
  teacher: string;
  campus: string;
  room: string;
  day: number;
  startPeriod: number;
  endPeriod: number;
  weeksRaw: string;
  weeks: number[];
  credit: number | null;
  weeklyHours: number | null;
  totalHours: number | null;
  examMode: string;
  courseCode: string;
  classNames: string;
  hoursDetail: string;
  colorIndex: number;
  source: CourseSource;
  pendingFilter: boolean;
  editedFields: string[];
  remark: string;
}

export interface NoteItem {
  id: string;
  sheet: string;
  title: string;
  content: string;
  remindAt: string;
  alarms: number[];
  repeat: 'none' | 'daily' | 'weekly' | 'monthly';
  done: boolean;
  doneAt: string | null;
  colorIndex: number;
  linkedCourseId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface PhotoEvidence {
  id: string;
  originalPath: string;
  watermarkPath: string;
  capturedAt: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  address: string;
  addressSource: 'manual' | 'coordinate-only' | 'none';
  source: 'camera' | 'gallery';
  watermarked: boolean;
  originalSha256: string;
  watermarkSha256: string;
  deviceLabel: string;
  appVersion: string;
}

export interface SecondClassRecord {
  id: string;
  block: BlockKey;
  stage: 'basic' | 'extended';
  activityName: string;
  description: string;
  activityDate: string;
  photos: PhotoEvidence[];
  score: number;
  scorePreset: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Account {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  salt: string;
  isDemo: boolean;
  schoolId?: string;          // 登录后绑定的高校；未绑定则进入学校选择页
  createdAt: string;
  lastLoginAt: string;
}

export interface PeriodTime { period: number; start: string; end: string }

export interface SecondClassBlockDef { key: BlockKey; name: string; fullName: string; fullScore: number; basicCap: number; extendedCap: number }

export interface SchoolProfile {
  schoolId: string;
  name: string;
  shortName: string;
  status: SchoolStatus;
  order: number;
  province: string;
  brand: { primaryColor: string; accentColor: string; iconLetter: string };
  tabs: { online: string };
  academic: {
    semesterLabel: string;
    semesterStartMonday: string;
    totalWeeks: number;
    periodCount: number;
    periodTimes: PeriodTime[];
  };
  systems: {
    jwglxtUrl: string;
    timetableUrl: string;
    onlinePlatformUrl: string;
    timetableAdapter: string;
  };
  campuses: string[];
  secondClass: { enabled: boolean; label: string; blocks: SecondClassBlockDef[]; rulePack: string };
  watermark: { schoolBadgeText: string };
  dataDir: string;
}

export interface Settings {
  notifyEnabled: boolean;
  classReminderEnabled: boolean;
  classReminderMinutes: number;
  noteDefaultAlarms: number[];
  watermarkEnabledDefault: boolean;
  watermarkLines: { time: boolean; coordinate: boolean; custom: boolean; address: boolean; badge: boolean };
  watermarkCustomText: string;
  watermarkOpacity: number;
  periodTimes: PeriodTime[];
  semesterStartMonday: string;
  totalWeeks: number;
  showWeekend: boolean;
  theme: 'light' | 'dark' | 'system';
  webviewKeepSession: boolean;
  autoBackup: boolean;
  lastActiveTimetableId: string | null;
}

export interface InterestEntry { schoolId: string; schoolName: string; contact: string; createdAt: string }

export interface ParseDiagnostic {
  kind: 'ok' | 'unparsed-weeks' | 'missing-fields' | 'no-table' | 'no-courses' | 'conflict';
  message: string;
  cellId?: string;
  courseName?: string;
}

export interface ParseResult {
  semesterLabel: string;
  studentName: string;
  studentId: string;
  courses: Course[];
  blockCount: number;
  distinctCourseNames: number;
  diagnostics: ParseDiagnostic[];
}
