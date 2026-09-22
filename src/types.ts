// Unimate 数据模型（PRD 5.2 / 5.9.1）
import type { WeatherNow } from './services/weather.ts';

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
  /** true = 用户在颜色面板里手动选过色；false/未定义 = 按课程名自动取色 */
  colorSet?: boolean;
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
  /** 归属的手册条款 id（如 de-7 = 第七条）。空 = 自由填报，归入"未对应条款"。 */
  clauseId?: string;
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

/** 时长类别：志愿服务 / 劳动教育。与第二课堂的"分"是两套东西，各自独立记录小时。 */
export type HourKind = 'volunteer' | 'labor';

/** 本科四年 8 个学期，作为时长台账的小标题。 */
export const SEMESTERS = ['大一上','大一下','大二上','大二下','大三上','大三下','大四上','大四下'] as const;
export type Semester = typeof SEMESTERS[number];

/** 课程资料：挂在某一节课上，文件副本存本机私有目录。 */
export interface CourseMaterial {
  id: string;
  courseId: string;
  name: string;
  path: string;
  mime: string;
  size: number;
  addedAt: string;
}

export interface HourEntry {
  id: string;
  kind: HourKind;
  semester: Semester;
  title: string;
  hours: number;
  date: string;
  note: string;
  photos: PhotoEvidence[];
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

/**
 * 天气用的位置（Net.md P0）。
 * 来源必须能区分：手填城市不许冒充"定位"，将来做存证/分享也照这个口径。
 */
export interface WeatherLocation {
  lat: number; lon: number;
  /** gps=卫星定位 network=WiFi/基站定位 manual=手填城市转坐标 */
  from: 'gps' | 'network' | 'manual';
  /** 手填城市时是城市名；系统定位时是"卫星定位/WiFi 定位"这类说明（界面直接显示） */
  name: string;
  /** 取到这份坐标的时间（毫秒）：系统定位 24 小时内复用，不必每次开 App 都调一次定位 */
  at: number;
}

export interface SecondClassBlockDef { key: BlockKey; name: string; fullName: string; fullScore: number; basicCap: number; extendedCap: number }

/** 校园服务入口（"北化通"这类一站式聚合页的一项）。 */
export interface CampusApp { key: string; name: string; url: string; icon: string; desc: string; builtin?: boolean;
  /** 用户上传的自定义图标（data URL）。为空时用 icon 里的 emoji。 */
  iconData?: string;
  /**
   * 特殊动作（北化：考试查询）。填写后点这个入口不再只是"打开网页"，
   * 而是走对应的原生 WebView 模式（考试模式会常驻一个「识别考试」按钮）。
   */
  action?: 'exam'; }

export interface SchoolProfile {
  schoolId: string;
  /**
   * 档案版本（Net.md P2 热更新用）。
   * 内置档案的版本号硬编码在 APK 里；远端 index.json 的 `version` 比它大时，
   * 选校页才显示「可更新」。**改档案内容就要 +1**，否则用户看不到更新。
   */
  profileVersion: number;
  name: string;
  shortName: string;
  status: SchoolStatus;
  order: number;
  /**
   * 校名拼音首字母（选校页 A–Z 分组用）。
   * 内置档案由 `catalog/universities.ts` 的名单提供；**热更新下发的新高校必须在档案里写上它**
   * （App 不猜拼音：部分国产 ROM 的 WebView 没有完整 ICU）。
   */
  letter?: string;
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
  /**
   * 第二课堂。enabled=false 的学校（如北京第二外国语学院）不套用北化的手册分值表：
   * 第二栏改名为 label（"活动材料"），只保留"志愿时长 / 劳育时长"两块台账，
   * 并显示 notice 说明为什么不套用。
   */
  secondClass: { enabled: boolean; label: string; blocks: SecondClassBlockDef[]; rulePack: string; notice?: string };
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
  /** 界面字号（WebView textZoom 百分比，100 = 标准） */
  fontSize: number;
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
  /** 课表工具箱悬浮按钮的位置（可拖动，null = 用默认右下角） */
  /**
   * 课表工具箱的位置（右上角那颗 🧰 可拖动，但只能在屏幕内的允许区域里）。
   * v2.15 起存**相对锚点** fx / fy ∈ [0,1]（相对"允许区域"的比例），不再存绝对像素：
   * 字号变化、底栏长高、横竖屏切换后按新尺寸换算，按钮不可能跑到屏幕外。
   * 老备份里可能是 { x, y } 像素值，读取时会先夹进允许区域再换算成锚点。
   */
  toolFab?: { fx?: number; fy?: number; x?: number; y?: number } | null;
  /** 是否已在启动时弹过一次"取消电池优化"系统框，避免反复打扰 */
  powerPrompted: boolean;
  /**
   * 天气（Net.md P0 / PRD 5.13）：**默认关闭**。
   * 关着的时候一次请求都不发 —— 这是产品口径，改动前先看 AGENTS.md 第 4 条。
   */
  weatherEnabled: boolean;
  /** 手填城市（拒绝定位授权时的兜底）。非空 = 用它查，不再申请定位权限 */
  weatherCity: string;
  /** 上次用的坐标（手填城市 / 系统定位） */
  weatherLoc: WeatherLocation | null;
  /** 上次成功拉到的天气：断网/接口失败时显示这一份 + "x 分钟前更新" */
  weatherNow: WeatherNow | null;
  /** 上次**尝试**拉取的时间（成功失败都记）：保证 30 分钟内最多一次请求 */
  weatherTriedAt: number;
  /**
   * 提醒守护前台服务（v2.34）：带一条最低优先级静音通知保活，避免国产 ROM 的"后台冻结"
   * 把闹钟攒到用户打开 App 时才补发。**默认开**，可在「我的 → 通知设置」一键关闭。
   */
  reminderGuard: boolean;
  /** P3 同步只保存随机同步码与“被加密的数据密钥”；同步口令和恢复码绝不落盘。 */
  sync?: {
    syncId: string;
    passwordWrap: { salt: string; iterations: number; nonce: string; ciphertext: string };
    recoveryWrap: { salt: string; iterations: number; nonce: string; ciphertext: string };
    lastUploadedAt?: string;
  } | null;
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
