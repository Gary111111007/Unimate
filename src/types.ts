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
  /** 坐标来源：gps=卫星定位 network=WiFi/基站 manual=人工填写。可信度材料必须能区分。 */
  coordSource?: 'gps' | 'network' | 'manual';
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
  /** 志愿/活动时长（小时）。0 表示未填。 */
  hours: number;
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

/** 校园服务入口（"北化通"这类一站式聚合页的一项）。 */
export interface CampusApp { key: string; name: string; url: string; icon: string; desc: string; builtin?: boolean;
  /** 用户上传的自定义图标（data URL）。为空时用 icon 里的 emoji。 */
  iconData?: string; }

export interface SchoolProfile {
  schoolId: string;
  name: string;
  shortName: string;
  status: SchoolStatus;
  order: number;
  province: string;
  brand: { primaryColor: string; accentColor: string; iconLetter: string };
  tabs: { online: string };
  /** 一站式校园服务入口。除北化外的高校接入后各自填写。 */
  campusApps: CampusApp[];
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
  /** 长按北化通条目后可改的名称/网址/说明/图标，按 key 覆盖内置档案 */
  appEdits: Record<string, Partial<CampusApp>>;
  /** 北化通条目显示顺序（key 列表）。未列出的按档案默认顺序排在后面 */
  appOrder: string[];
  /** 被用户删除（隐藏）的入口 key，可在设置里一键恢复全部 */
  hiddenApps: string[];
  /** 用户自己添加的校园入口（本校未收录的服务由用户自行补全） */
  customApps: CampusApp[];
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