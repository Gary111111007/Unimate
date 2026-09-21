import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type {
  Account, Course, CourseMaterial, HourEntry, HourKind, InterestEntry, NoteItem, SchoolProfile, SecondClassRecord,
  Settings, Timetable, WeatherLocation
} from '../types.ts';
import { BUILTIN_PROFILE_VERSIONS, findSchool, profileFor, SCHOOLS } from '../catalog/universities.ts';
import { SCHOOL_CATALOG_PUBKEY } from '../catalog/schoolKey.ts';
import { DEFAULT_PERIOD_TIMES, courseColorIndex } from '../catalog/periods.ts';
import { uuid, nowStamp, dateStamp } from '../services/id.ts';
import { readJson, writeJson, readText, writeText, remove, probeStorage } from '../services/io.ts';
import { randomSalt, sha256Text } from '../services/crypto.ts';
import { buildDemoBisuCourses, buildDemoNotes, buildDemoRecords, buildDemoTimetable } from '../services/demo.ts';
import { rescheduleAll, scheduleDemoPing, cleanupStaleOnBoot } from '../services/notify.ts';
import { guard, traceReset } from '../services/guard.ts';
import { applyTextZoom } from '../services/display.ts';
import { fetchWeather, firstFulfilled, geocode, shouldRequestWeather } from '../services/weather.ts';
import { Geolocation } from '@capacitor/geolocation';
import {
  catalogCheckAllowed, downloadSchoolProfile, fetchCatalog, mergeSchoolRows,
  type CatalogIndex, type SchoolRow
} from '../services/schoolCatalog.ts';

export const SCHEMA_VERSION = 1;
export const APP_VERSION = '1.0.0';

function defaultSettings(p: SchoolProfile): Settings {
  return {
    notifyEnabled: true, classReminderEnabled: true, classReminderMinutes: 10,
    noteDefaultAlarms: [0, 15],
    watermarkEnabledDefault: true,
    watermarkLines: { time: true, coordinate: true, custom: true, address: true, badge: true },
    watermarkCustomText: '', watermarkOpacity: 0.45,
    periodTimes: p.academic.periodTimes.map((x) => ({ ...x })),
    semesterStartMonday: p.academic.semesterStartMonday,
    totalWeeks: p.academic.totalWeeks,
    showWeekend: true, theme: 'system', webviewKeepSession: true, autoBackup: true,
    fontSize: 100,
    lastActiveTimetableId: null,
    appEdits: {},
    appOrder: [],
    hiddenApps: [],
    // 用户自行添加的校园入口（本校档案没收录的服务）
    customApps: [],
    toolFab: null,
    // 启动时只弹一次电池优化申请
    powerPrompted: false,
    // 天气（Net.md P0）：默认关闭 —— 关着的时候一次请求都不发
    weatherEnabled: false, weatherCity: '', weatherLoc: null, weatherNow: null, weatherTriedAt: 0
  };
}

export interface ConfirmRequest {
  title: string; body: string; detail?: string;
  confirmText: string; cancelText: string; danger: boolean;
}

export const useDb = defineStore('db', () => {
  const booted = ref(false);
  // 启动默认落在**登录页**：产品口径是「先登录账号，再选学校」。
// 早期这里初始化为 'school'，且 boot() 在没有历史账号时不改写 screen，
// 导致全新安装 / 未记住登录态时仍然先看到选校页。
const screen = ref<'school' | 'login' | 'app'>('login');
  const profile = ref<SchoolProfile | null>(null);
  const accounts = ref<Account[]>([]);
  const session = ref<{ accountId: string; username: string; displayName: string; isDemo: boolean } | null>(null);
  const interests = ref<InterestEntry[]>([]);

  const timetables = ref<Timetable[]>([]);
  const courses = ref<Course[]>([]);
  const notes = ref<NoteItem[]>([]);
  const records = ref<SecondClassRecord[]>([]);
  const hours = ref<HourEntry[]>([]);
  const materials = ref<CourseMaterial[]>([]);
  const settings = ref<Settings>(defaultSettings(profileFor('buct')!));

  const activeTab = ref(0);
  const activeSheet = ref<'sheet1' | 'sheet2'>('sheet1');
  const toast = ref('');
  const busy = ref('');
  const toastSeq = ref(0);
  const lastError = ref('');
  /**
   * 从系统通知点进来的"定位目标"。写进通知的 extra，点击后由 plugins.ts 填这里，
   * 对应页面消费一次就清空（避免切页反复弹层）。桌面预览环境下永远为 null。
   */
  const focus = ref<{ kind: 'course' | 'note'; id: string; week?: number } | null>(null);
  const storage = ref<{ ok: boolean; detail: string }>({ ok: true, detail: '未检测' });

  // ---------------- 学校档案热更新（Net.md P2 / PRD 5.14） ----------------
  /**
   * 已下载的高校档案（全局，不属于某个账号 —— 换账号也不用重下）。
   * 只有**验签通过 + sha256 一致 + 域名白名单通过**的档案才会进这里。
   */
  const downloadedSchools = ref<Record<string, { profile: SchoolProfile; version: number; sha256: string; downloadedAt: string }>>({});
  /** 远端清单（含缓存）与限频状态；lastOkAt/lastTryAt 落盘，重启后不会反复请求 */
  const catalog = ref<{ index: CatalogIndex | null; lastOkAt: number; lastTryAt: number; msg: string; busy: boolean }>(
    { index: null, lastOkAt: 0, lastTryAt: 0, msg: '', busy: false });

  const activeTimetable = computed(() =>
    timetables.value.find((t) => t.id === settings.value.lastActiveTimetableId) || timetables.value[0] || null);

  // 学期字段以"当前使用中的课表"为唯一真相：settings 里的值只是设置面板的编辑缓冲。
  // 不做这层同步的话，切换课表后设置面板仍显示上一张的起始周，一保存就把新课表的
  // 学期起始日与总周数静默覆盖掉（多课表场景下的真实缺陷）。
  watch(activeTimetable, (tt) => {
    if (!tt) return;
    settings.value.semesterStartMonday = tt.semesterStartMonday;
    settings.value.totalWeeks = tt.totalWeeks;
  }, { immediate: true });
  const currentWeek = computed(() => {
    const t = activeTimetable.value;
    if (!t) return 1;
    const monday = new Date(t.semesterStartMonday.replace(/-/g, '/') + ' 00:00:00');
    const now = new Date();
    const diff = Math.floor((now.getTime() - monday.getTime()) / 86400000);
    return Math.min(Math.max(Math.floor(diff / 7) + 1, 1), t.totalWeeks);
  });

  function base(): string {
    return 'schools/' + profile.value!.schoolId + '/users/' + session.value!.accountId;
  }

  function notify(msg: string): void {
    toast.value = msg;
    toastSeq.value++;
    try { setTimeout(() => { if (toast.value === msg) toast.value = ''; }, 2600); } catch { /* 提示失败不影响主流程 */ }
  }

  /** 任何异常都必须被看见：写进 lastError（界面可见）+ toast + console */
  function fail(where: string, e: unknown): void {
    const detail = e instanceof Error ? (e.stack || e.message) : String(e);
    lastError.value = where + '：' + detail;
    console.error('[Unimate] ' + lastError.value);
    notify(where + '失败：' + (e instanceof Error ? e.message : String(e)));
  }

  // ---------------- boot ----------------
  async function boot(): Promise<void> {
    // 每一步都限时：真机（OPPO/ColorOS）出现过"开屏永远停住、没有任何 JS 错误"，
    // 那就是某个插件的 Promise 再也不 resolve。宁可降级到登录页，也不能让用户进不去。
    traceReset();
    try {
      storage.value = await guard('存储自检', probeStorage(), 4000, { ok: true, detail: '自检超时，按可用处理' });
      if (!storage.value.ok) fail('本机存储不可用', storage.value.detail);
    } catch { /* 自检本身失败不阻塞启动 */ }
    try {
      const manifest = await guard('读高校清单', readJson<any>('manifest.json', { schemaVersion: SCHEMA_VERSION, schools: {}, accounts: [] }), 4000,
        { schemaVersion: SCHEMA_VERSION, schools: {}, accounts: [] } as any);
      interests.value = await guard('读意向清单', readJson<InterestEntry[]>('catalog/interests.json', []), 3000, []);
      accounts.value = await guard('读账号表', readJson<Account[]>('accounts.json', []), 3000, []);
      // 学校档案热更新（P2）：已下载的档案与远端清单缓存。读不到就退回内置 53 所，用户无感。
      // 这两份都是"全局数据"，不属于某个账号 —— 换账号不用重下，也不会因为没登录就读不到。
      try {
        const dl = await guard('读已下载档案', readJson<any>('catalog/downloaded-schools.json', { items: {} }), 3000, { items: {} } as any);
        downloadedSchools.value = (dl && dl.items && typeof dl.items === 'object') ? dl.items : {};
      } catch { downloadedSchools.value = {}; }
      try {
        const cc: any = await guard('读学校清单缓存', readJson<any>('catalog/catalog-cache.json', null), 3000, null);
        /*
         * 注意：即使上次检查**失败**（没有 index），也要把 lastTryAt 读回来 ——
         * 否则"失败退避 5 分钟"会随每次重启清零，变成每次开机都去请求一遍。
         */
        if (cc) {
          catalog.value = {
            index: cc.index || null, lastOkAt: Number(cc.lastOkAt) || 0, lastTryAt: Number(cc.lastTryAt) || 0,
            msg: typeof cc.msg === 'string' ? cc.msg : '', busy: false
          };
        }
      } catch { /* 缓存读不到：就当今天还没检查过，到时重新拉 */ }
      /*
       * 【v2.14 / v2.28 两次修正，真机反馈"提醒还是不响"的根因】
       * Android 开机恢复广播（BOOT_COMPLETED / QUICKBOOT_POWERON）会把所有**已过期**的排期
       * 改写成"15 秒后立即发送"（插件 LocalNotificationRestoreReceiver 的行为），
       * 所以冷启动要先清理这些过期排期，再由下面的 finishLogin → loadUserData → rescheduleAll 重建。
       *  - v2.14 的教训：这一步写在 finishLogin **之后**，等于把刚排好的提醒全删了；
       *  - v2.28 的教训：原来的"全清"太狠 —— 用户正好在提醒时刻前后打开 App 时，
       *    那一条（还差几秒/刚过几秒）会被静默吞掉。现在只清"过期超过 90 秒"的
       *    与"账本里没有的"，未来的排期原样保留（见 services/notify.ts 的 staleIds）。
       */
      try { await guard('清理过期排期', cleanupStaleOnBoot(), 4000, undefined); } catch { /* 预览环境忽略 */ }
      const lastAccount = manifest.lastAccountId;
      const acc = lastAccount ? accounts.value.find((a) => a.id === lastAccount) : null;
      if (acc) {
        session.value = { accountId: acc.id, username: acc.username, displayName: acc.displayName, isDemo: acc.isDemo };
        // 已绑定高校则直接进主界面，否则进学校选择页；超时则退回登录页
        const done = await guard('载入账号数据', finishLogin().then(() => true).catch(() => false), 9000, false);
        if (!done) {
          session.value = null;
          screen.value = 'login';
          fail('启动', '读取账号数据超时，已退回登录页（数据仍在手机里，重新登录即可）');
        }
      } else {
        screen.value = 'login';       // 无历史登录态：先登录，不展示选校页
      }
    } catch (e) { fail('启动', e); }
    booted.value = true;
  }

  async function persistManifest(): Promise<void> {
    const m = await readJson<any>('manifest.json', { schemaVersion: SCHEMA_VERSION, schools: {} });
    m.schemaVersion = SCHEMA_VERSION;
    m.schools = m.schools || {};
    m.appVersion = APP_VERSION;
    m.updatedAt = nowStamp();
    m.lastAccountId = session.value ? session.value.accountId : null;
    m.lastSchoolId = profile.value ? profile.value.schoolId : null;
    await writeJson('manifest.json', m);
  }

  // ---------------- school ----------------
  async function applyProfile(schoolId: string): Promise<boolean> {
    const p = profileOf(schoolId);
    if (!p) return false;
    profile.value = p;
    settings.value = defaultSettings(p);
    return true;
  }

  async function selectSchool(schoolId: string, silent = false): Promise<boolean> {
    // 能不能选，只取决于"本机有没有这所学校的档案"：内置的、或热更新下载来的都算（PRD 5.14）
    if (!profileOf(schoolId)) {
      if (!silent) notify('当前高校尚未加入 Unimate 落地计划');
      return false;
    }
    await applyProfile(schoolId);
    if (session.value) {
      await bindSchoolToAccount(schoolId);
      try { await loadUserData(); } catch (e) { fail('读取本机数据', e); }
      if (session.value.isDemo && !timetables.value.length) {
        try { await seedDemo(); } catch (e) { fail('填充演示数据', e); }
      }
      screen.value = 'app';
    }
    try { await persistManifest(); } catch (e) { fail('保存学校选择', e); }
    return true;
  }

  async function addInterest(schoolId: string, contact: string): Promise<void> {
    const s = findSchool(schoolId);
    if (!s) return;
    interests.value.unshift({ schoolId, schoolName: s.name, contact, createdAt: nowStamp() });
    await writeJson('catalog/interests.json', interests.value);
    notify('意向已记录在本机，可在"我的 → 关于 → 意向清单"查看');
  }

// ---------------- 全局二次确认（产品硬性要求：App 内所有删除必须二次确认） ----------------
const confirmReq = ref<(ConfirmRequest & { resolve: (ok: boolean) => void }) | null>(null);

/** 弹出统一的确认框，返回用户是否确认。所有删除路径都必须走这里。 */
function confirm(opts: Partial<ConfirmRequest> & { title: string; body: string }): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // 前一个没回就当作取消，避免调用方永远挂起
    const prev = confirmReq.value;
    if (prev) { prev.resolve(false); }
    confirmReq.value = {
      title: opts.title, body: opts.body, detail: opts.detail || '',
      confirmText: opts.confirmText || '确定删除', cancelText: opts.cancelText || '取消，留着',
      danger: opts.danger !== false, resolve
    };
  });
}
function answerConfirm(ok: boolean): void {
  const r = confirmReq.value;
  if (!r) return;
  confirmReq.value = null;
  r.resolve(ok);
}
  // ---------------- accounts ----------------
  /** 账号是全局的（先登录、后选学校），不再按学校分区 */
  async function accountsPath(): Promise<string> {
    return 'accounts.json';
  }

  async function bindSchoolToAccount(schoolId: string): Promise<void> {
    if (!session.value) return;
    const acc = accounts.value.find((a) => a.id === session.value!.accountId);
    if (!acc || acc.schoolId === schoolId) return;
    acc.schoolId = schoolId;
    try { await writeJson(await accountsPath(), accounts.value); } catch (e) { fail('绑定高校', e); }
  }

  async function finishLogin(): Promise<void> {
    const acc = accounts.value.find((a) => a.id === session.value?.accountId);
    const sid = acc?.schoolId;
    // 已下载档案的学校也要能被认出来（否则重启后会被丢回选校页）
    if (sid && profileOf(sid)) {
      await applyProfile(sid);
      try { await loadUserData(); } catch (e) { fail('读取本机数据', e); }
      if (acc?.isDemo && !timetables.value.length) { try { await seedDemo(); } catch (e) { fail('填充演示数据', e); } }
      screen.value = 'app';
    } else {
      screen.value = 'school';   // 先登录，再选学校
    }
    try { await persistManifest(); } catch (e) { fail('保存登录状态', e); }
  }

  async function loadAccounts(): Promise<Account[]> {
    accounts.value = await readJson<Account[]>(await accountsPath(), []);
    return accounts.value;
  }

  async function ensureDemoAccount(): Promise<Account | null> {
    try {
      await loadAccounts();
      let demo = accounts.value.find((a) => a.isDemo);
      if (!demo) {
        const salt = randomSalt();
        demo = {
          id: uuid(), username: 'admin', displayName: '智小汇', isDemo: true,
          passwordHash: await sha256Text(salt + 'buct'), salt,
          createdAt: nowStamp(), lastLoginAt: ''
        };
        accounts.value.push(demo);
        await writeJson(await accountsPath(), accounts.value);
      }
      return demo;
    } catch (e) { fail('准备演示账号', e); return null; }
  }

  async function register(username: string, password: string, displayName: string): Promise<boolean> {
    if (username.length < 2 || username.length > 20) { notify('用户名需 2~20 个字符'); return false; }
    if (password.length < 6) { notify('密码至少 6 位'); return false; }
    try {
      await loadAccounts();
      if (accounts.value.some((a) => a.username === username)) { notify('该用户名已存在'); return false; }
      const salt = randomSalt();
      const acc: Account = {
        id: uuid(), username, displayName: displayName || username, isDemo: false,
        passwordHash: await sha256Text(salt + password), salt, createdAt: nowStamp(), lastLoginAt: ''
      };
      accounts.value.push(acc);
      await writeJson(await accountsPath(), accounts.value);
      notify('账号已创建（仅存本机）');
      return true;
    } catch (e) { fail('创建账号', e); return false; }
  }

  async function login(username: string, password: string): Promise<boolean> {
    try {
      await loadAccounts();
      const acc = accounts.value.find((a) => a.username === username);
      const hash = acc ? await sha256Text(acc.salt + password) : '';
      if (!acc || acc.passwordHash !== hash) {
        notify('用户名或密码错误' + (acc ? '' : '（该用户名在本机不存在）'));
        return false;
      }
      acc.lastLoginAt = nowStamp();
      try { await writeJson(await accountsPath(), accounts.value); } catch (e) { fail('记录登录时间', e); }
      session.value = { accountId: acc.id, username: acc.username, displayName: acc.displayName, isDemo: acc.isDemo };
      await finishLogin();
      return true;
    } catch (e) { fail('登录', e); return false; }
  }

  function logout(): void {
    session.value = null;
    profile.value = null;
    timetables.value = []; courses.value = []; notes.value = []; records.value = []; hours.value = [];
    screen.value = 'login';
    activeTab.value = 0;
    // 回登录页时把字号复位：不把上一个账号的大字号带到下一个人的登录界面
    void applyTextZoom(100);
    void persistManifest();
  }

  /** 切换学校：保留登录状态，回到学校选择页 */
  async function changeSchool(): Promise<void> {
    profile.value = null;
    timetables.value = []; courses.value = []; notes.value = []; records.value = []; hours.value = [];
    screen.value = 'school';
    activeTab.value = 0;
    try { await persistManifest(); } catch (e) { fail('切换学校', e); }
  }

  async function switchSchool(): Promise<void> {
    await logout();
    screen.value = 'login';
    try { await persistManifest(); } catch (e) { fail('退出登录', e); }
  }

  // ---------------- data ----------------
  async function loadUserData(): Promise<void> {
    if (!session.value) return;
    const b = base();
    settings.value = { ...defaultSettings(profile.value!), ...(await readJson<Partial<Settings>>(b + '/settings.json', {})) as Settings };
    timetables.value = await readJson<Timetable[]>(b + '/timetable/timetables.json', []);
    courses.value = await readJson<Course[]>(b + '/timetable/courses.json', []);
    notes.value = await readJson<NoteItem[]>(b + '/notes/notes.json', []);
    records.value = await readJson<SecondClassRecord[]>(b + '/secondclass/records.json', []);
    hours.value = await readJson<HourEntry[]>(b + '/hours/entries.json', []);
    materials.value = await readJson<CourseMaterial[]>(b + '/materials/index.json', []);
    if (!settings.value.lastActiveTimetableId && timetables.value.length) {
      settings.value.lastActiveTimetableId = timetables.value[0].id;
    }
    /*
     * 字号是"本账号的设置"，必须在载入数据后重新套用一次。
     * 旧写法只在 App 启动时套一次，切账号 / 切学校时上一个账号的字号会留在页面上 ——
     * 真机表现就是"演示账号的面板里写着『标准』，界面却还是上一个账号的『特大』"（v2.15 实测复现）。
     */
    void applyTextZoom(settings.value.fontSize || 100);
    try { await rescheduleAll(courses.value, timetables.value, notes.value, settings.value); } catch (e) { fail('重建提醒', e); }
  }

  async function saveData(): Promise<void> {
    if (!session.value) return;
    const b = base();
    await writeJson(b + '/timetable/timetables.json', timetables.value);
    await writeJson(b + '/timetable/courses.json', courses.value);
    await writeJson(b + '/notes/notes.json', notes.value);
    await writeJson(b + '/secondclass/records.json', records.value);
    await writeJson(b + '/hours/entries.json', hours.value);
    await writeJson(b + '/materials/index.json', materials.value);
    await writeJson(b + '/settings.json', settings.value);
    try { await rescheduleAll(courses.value, timetables.value, notes.value, settings.value); } catch (e) { fail('重建提醒', e); }
  }

  async function seedDemo(): Promise<void> {
    const p = profile.value!;
    const tt = buildDemoTimetable(p.name, p.academic.semesterLabel, p.academic.semesterStartMonday, p.academic.totalWeeks);
    timetables.value = [tt];
    settings.value.lastActiveTimetableId = tt.id;
    try {
      if (p.schoolId === 'bisu') {
        // 北二外没有打包的脱敏教务页面样本，演示课表用内置的一份（课程/教室取自产品负责人给的截图）
        courses.value = buildDemoBisuCourses().map((c) => ({
          ...c, id: uuid(), timetableId: tt.id, colorIndex: courseColorIndex(String(c.name || ''))
        })) as Course[];
      } else {
        const html = await fetch('sample-timetable.html').then((r) => r.text());
        const mod = await import('../services/parser/jwglxtBuct.ts');
        const parsed = mod.parseJwglxtTimetable(html);
        courses.value = parsed.courses.map((c) => ({ ...c, id: uuid(), timetableId: tt.id, colorIndex: courseColorIndex(c.name) }));
      }
    } catch { courses.value = []; }
    notes.value = buildDemoNotes(p.secondClass.enabled);
    // 没有第二课堂的学校不生成二课记录（否则会凭空出现一堆"板块分数"）
    if (p.secondClass.enabled) {
      try { records.value = await buildDemoRecords(base()); } catch (e) { fail('生成示例照片', e); records.value = []; }
    } else {
      records.value = [];
    }
    try { await saveData(); } catch (e) { fail('保存演示数据', e); }
    try { await scheduleDemoPing(); } catch { /* 通知不可用时忽略 */ }
    notify('演示数据已就绪：' + courses.value.length + ' 条上课安排、' + notes.value.length + ' 条记事、' + records.value.length + ' 条二课记录');
  }

  async function resetDemo(): Promise<void> {
    timetables.value = []; courses.value = []; notes.value = []; records.value = []; hours.value = [];
    await seedDemo();
  }

  // ---------------- CRUD helpers ----------------
  function newTimetable(name: string): Timetable {
    const p = profile.value!;
    const t: Timetable = {
      id: uuid(), name, semesterLabel: p.academic.semesterLabel,
      semesterStartMonday: settings.value.semesterStartMonday, totalWeeks: settings.value.totalWeeks,
      periodCount: 12, isActive: true, source: 'manual', createdAt: nowStamp(), updatedAt: nowStamp()
    };
    timetables.value.push(t);
    settings.value.lastActiveTimetableId = t.id;
    return t;
  }

  function addCourse(part: Partial<Course>): Course {
    const t = activeTimetable.value || newTimetable('未命名课表');
    const c: Course = {
      id: uuid(), timetableId: t.id, name: '', lessonType: 'lecture', teacher: '', campus: '', room: '',
      day: 1, startPeriod: 1, endPeriod: 2, weeksRaw: '', weeks: [], credit: null, weeklyHours: null,
      totalHours: null, examMode: '', courseCode: '', classNames: '', hoursDetail: '',
      colorIndex: courseColorIndex((part && (part as Course).name) || ''), source: 'manual', pendingFilter: false, editedFields: [], remark: '',
      ...part
    } as Course;
    courses.value.push(c);
    return c;
  }

  function removeCourse(id: string): void {
    courses.value = courses.value.filter((c) => c.id !== id);
    notes.value.forEach((n) => { if (n.linkedCourseId === id) n.linkedCourseId = null; });
  }

  function addNote(part: Partial<NoteItem>): NoteItem {
    const n: NoteItem = {
      id: uuid(), sheet: 'sheet2', title: '', content: '', remindAt: '', alarms: settings.value.noteDefaultAlarms.slice(),
      repeat: 'none', done: false, doneAt: null, colorIndex: 2, linkedCourseId: null,
      createdAt: nowStamp(), updatedAt: nowStamp(), deletedAt: null, ...part
    } as NoteItem;
    notes.value.unshift(n);
    return n;
  }

  /** 志愿 / 劳育时长台账条目 */
  function addHour(part: Partial<HourEntry>): HourEntry {
    const e: HourEntry = {
      id: uuid(), kind: 'volunteer', semester: '大一上', title: '', hours: 0, date: dateStamp(),
      note: '', photos: [], createdAt: nowStamp(), updatedAt: nowStamp(), deletedAt: null, ...part
    } as HourEntry;
    hours.value.unshift(e);
    return e;
  }
  function removeHour(id: string): void {
    const i = hours.value.findIndex((x) => x.id === id);
    if (i >= 0) hours.value.splice(i, 1);
  }

/** 某类别的累计小时（软删除不计）。 */
function hourTotal(kind: HourKind): number {
  return Math.round(hours.value.filter((x) => x.kind === kind && !x.deletedAt).reduce((a, x) => a + (x.hours || 0), 0) * 10) / 10;
}
  function addMaterial(part: Partial<CourseMaterial>): CourseMaterial {
    const m: CourseMaterial = {
      id: uuid(), courseId: '', name: '未命名', path: '', mime: '', size: 0, addedAt: nowStamp(), ...part
    } as CourseMaterial;
    materials.value.unshift(m);
    return m;
  }
  function removeMaterial(id: string): void {
    const i = materials.value.findIndex((x) => x.id === id);
    if (i >= 0) materials.value.splice(i, 1);
  }
  function materialsOf(courseId: string): CourseMaterial[] {
    return materials.value.filter((m) => m.courseId === courseId);
  }

  function addRecord(part: Partial<SecondClassRecord>): SecondClassRecord {
    const r: SecondClassRecord = {
      id: uuid(), block: 'de', stage: 'basic', activityName: '', description: '', activityDate: dateStamp(),
      photos: [], score: 10, scorePreset: '', hours: 0, createdAt: nowStamp(), updatedAt: nowStamp(), deletedAt: null, ...part
    } as SecondClassRecord;
    records.value.unshift(r);
    return r;
  }

  function blockScore(key: string): number {
    return records.value.filter((r) => r.block === key && !r.deletedAt).reduce((a, r) => a + r.score, 0);
  }

  function totalScore(): number {
    return records.value.filter((r) => !r.deletedAt).reduce((a, r) => a + r.score, 0);
  }

  function coursesOn(day: number, week: number): Course[] {
    return courses.value.filter((c) => c.timetableId === (activeTimetable.value && activeTimetable.value.id) && c.day === day && c.weeks.indexOf(week) >= 0);
  }

  // ---------------- 学校档案热更新（Net.md P2 / PRD 5.14） ----------------
  /**
   * 取某校的档案：**已下载的优先**，没有则用 APK 内置的。
   * 全工程取档案都必须走这里（`profileFor` 只认识内置的两所），否则热更新下载完也用不上。
   */
  function profileOf(schoolId: string): SchoolProfile | null {
    const d = downloadedSchools.value[schoolId];
    if (d && d.profile) return JSON.parse(JSON.stringify(d.profile));
    return profileFor(schoolId);
  }

  /** 选校页要显示的行 = 内置 53 所 + 远端清单 + 已下载合并（纯函数在 services/schoolCatalog.ts 里，有单测） */
  const schoolRows = computed<SchoolRow[]>(() => {
    // 已下载的学校连名字/名次一起带上：远端清单拉不到时，这些学校也要照常显示（只是没有"可更新"）
    const metas: Record<string, { version: number; name: string; shortName: string; province: string; order: number; letter: string }> = {};
    for (const id of Object.keys(downloadedSchools.value)) {
      const p = downloadedSchools.value[id].profile;
      metas[id] = {
        version: downloadedSchools.value[id].version,
        name: p.name, shortName: p.shortName, province: p.province,
        order: typeof p.order === 'number' ? p.order : 899, letter: p.letter || '#'
      };
    }
    return mergeSchoolRows(SCHOOLS, BUILTIN_PROFILE_VERSIONS, catalog.value.index, metas);
  });

  /** 本机已下载的档案（选校页底部管理用） */
  const downloadedList = computed(() => Object.keys(downloadedSchools.value).map((id) => ({
    schoolId: id, name: downloadedSchools.value[id].profile.name, shortName: downloadedSchools.value[id].profile.shortName,
    version: downloadedSchools.value[id].version, downloadedAt: downloadedSchools.value[id].downloadedAt,
    /** 内置也有这所学校 → 删掉只是"回到内置"，不会失去它 */
    builtin: !!profileFor(id)
  })));

  function saveDownloaded(): Promise<void> {
    return writeJson('catalog/downloaded-schools.json', { schemaVersion: 1, items: downloadedSchools.value });
  }
  function saveCatalogCache(): Promise<void> {
    return writeJson('catalog/catalog-cache.json', {
      lastOkAt: catalog.value.lastOkAt, lastTryAt: catalog.value.lastTryAt, index: catalog.value.index,
      // 文案也存下来：重启后不该把"上次为什么没检查成"这件事丢掉（不静默失败的延伸）
      msg: catalog.value.msg
    });
  }

  /**
   * 检查远端清单。**每天最多成功一次**（失败 5 分钟退避），用户点「检查更新」可以强制。
   * 失败不动旧缓存：验签不过 / 断网时，之前那份清单照常显示徽标（降级口径）。
   */
  async function checkCatalog(force = false): Promise<void> {
    const c = catalog.value;
    if (c.busy) return;
    if (!catalogCheckAllowed({ lastOkAt: c.lastOkAt, lastTryAt: c.lastTryAt, force })) return;
    c.busy = true;
    c.lastTryAt = Date.now();
    try {
      const r = await fetchCatalog(SCHOOL_CATALOG_PUBKEY);
      if (!r.ok) { c.msg = r.reason; return; }
      c.index = r.index;
      c.lastOkAt = Date.now();
      c.msg = r.index.schools.length
        ? '远端有 ' + r.index.schools.length + ' 份可下发档案'
        : '远端还没有可下发的高校档案';
    } catch (e) {
      c.msg = '检查更新失败：' + (e instanceof Error ? e.message : String(e));
    } finally {
      c.busy = false;
      try { await saveCatalogCache(); } catch { /* 缓存写不动不影响本次结果 */ }
    }
  }

  /** 下载一份档案：sha256 校验 + 结构与域名检查都在服务层做，这里只负责落盘与文案 */
  async function downloadSchool(schoolId: string): Promise<boolean> {
    const c = catalog.value;
    const entry = c.index ? c.index.schools.find((e) => e.id === schoolId) : null;
    if (!entry) { notify('远端还没有这所高校的可下发档案'); return false; }
    if (c.busy) return false;
    c.busy = true;
    try {
      const r = await downloadSchoolProfile(entry);
      if (!r.ok) { c.msg = r.reason; notify('下载失败：' + r.reason); return false; }
      downloadedSchools.value[schoolId] = {
        profile: r.profile, version: r.version, sha256: entry.sha256, downloadedAt: nowStamp()
      };
      await saveDownloaded();
      c.msg = '已下载 ' + r.profile.name + '（v' + r.version + '）';
      notify('已下载 ' + (r.profile.shortName || r.profile.name) + ' 档案，点一下就能用');
      return true;
    } finally {
      c.busy = false;
    }
  }

  /**
   * 删除已下载的档案，回到 APK 内置版本（Net.md P2 的"坏档案可一键回到内置"）。
   * 内置也有这所学校 → 删除是安全的；只在远端存在（新高校）且**正在使用**时不删 ——
   * 那等于把账号脚下的档案抽走，必须先切到别的高校。
   */
  async function removeDownloaded(schoolId: string): Promise<boolean> {
    const item = downloadedSchools.value[schoolId];
    if (!item) return false;
    const label = item.profile.shortName || item.profile.name || schoolId;
    if (profile.value && profile.value.schoolId === schoolId && !profileFor(schoolId)) {
      notify('正用着这所高校：先切换到别的高校，再删除它的下载档案');
      return false;
    }
    delete downloadedSchools.value[schoolId];
    await saveDownloaded();
    if (profile.value && profile.value.schoolId === schoolId) await applyProfile(schoolId);   // 回到内置档案
    notify('已删除 ' + label + ' 的下载档案' + (profileFor(schoolId) ? '，已回到内置档案' : ''));
    return true;
  }

  // ---------------- 天气（Net.md P0 / PRD 5.13，v2.24） ----------------
  /*
   * 这是 App 的**第一个真联网功能**，三条口径都在这里守（界面只负责调 ensureWeather）：
   *  1) 关着就一次都不发：开关为 false 时直接返回，连定位权限都不查；
   *  2) 30 分钟最多一次：**成功、失败都记 weatherTriedAt**，断网时不会退化成"每进一次课表发一次请求"；
   *  3) 不阻塞、不抛错：定位与网络全部包 guard() 超时，失败只留一句文案，界面照常能用。
   * 上次结果与上次坐标都存在本机设置里：断网时显示上次数据 + "x 分钟前更新"。
   */
  const weatherBusy = ref(false);
  /** 上次请求的结果文案（已更新 / 没网 / 权限没给…）：面板里直接显示，不静默失败 */
  const weatherMsg = ref('');
  /** 系统定位坐标的复用窗口：24 小时内不重复调定位（省电，也不反复弹权限） */
  const LOC_REUSE_MS = 24 * 60 * 60 * 1000;

  /** 只写设置文件：天气这种小改动不必把课表/记事/照片索引全部重写一遍 */
  async function saveSettingsFile(): Promise<void> {
    if (!session.value || !profile.value) return;
    await writeJson(base() + '/settings.json', settings.value);
  }

  /**
   * 系统定位（网络定位与卫星定位同时发起、谁先回来用谁）。
   * 权限查询/申请/取坐标都是原生调用，一律包 guard()：宁可拿不到位置，也不许把界面挂住。
   */
  async function locateForWeather(): Promise<WeatherLocation | null> {
    try {
      let allowed: boolean | null = null;
      try {
        const cur: any = await guard('查定位权限', Geolocation.checkPermissions(), 3000, null as any);
        if (cur) allowed = cur.location === 'granted' || cur.coarseLocation === 'granted';
      } catch { allowed = null; }
      if (allowed === false) {
        const req: any = await guard('申请定位权限', Geolocation.requestPermissions(), 8000, null as any);
        if (req) allowed = req.location === 'granted' || req.coarseLocation === 'granted';
      }
      if (allowed === false) {
        weatherMsg.value = '定位权限没给：可在本页手填城市，一样能查天气';
        return null;
      }
      const got: any = await guard('获取定位', firstFulfilled([
        Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 }).then((p) => ({ p, from: 'network' as const })),
        Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }).then((p) => ({ p, from: 'gps' as const }))
      ]), 6500, null);
      const c = got && got.p && got.p.coords;
      if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) {
        weatherMsg.value = '没取到位置：可在本页手填城市再试';
        return null;
      }
      return {
        lat: c.latitude, lon: c.longitude, from: got.from,
        name: got.from === 'gps' ? '卫星定位' : 'WiFi/基站定位', at: Date.now()
      };
    } catch {
      weatherMsg.value = '当前环境用不了系统定位：可在本页手填城市';
      return null;
    }
  }

  /** 决定用哪个坐标：手填城市优先（geocode 换坐标），否则系统定位（24 小时内的坐标直接复用） */
  async function weatherLocation(force: boolean): Promise<WeatherLocation | null> {
    const s = settings.value;
    const city = (s.weatherCity || '').trim();
    const cached = s.weatherLoc;
    if (city) {
      if (!force && cached && cached.from === 'manual' && cached.name === city) return cached;
      const g = await geocode(city);
      if (g) return { lat: g.lat, lon: g.lon, from: 'manual', name: g.name || city, at: Date.now() };
      if (cached && cached.from === 'manual') return cached;   // 城市没查出来时，继续用上次那个，不把已有数据弄丢
      weatherMsg.value = '没查到城市「' + city + '」：换个写法（如"北京""上海"）再试';
      return null;
    }
    if (!force && cached && cached.from !== 'manual' && Date.now() - cached.at < LOC_REUSE_MS) return cached;
    const p = await locateForWeather();
    return p || cached || null;   // 这次定位失败、上次有坐标：用旧的比没有强（文案里已经说明了原因）
  }

  /**
   * 天气的唯一入口。界面（课表页那张卡、「我的 → 天气」面板）只调它。
   * force=true 只在用户点「立即更新」时用；点「保存设置」走的是节流版，
   * 免得"反复保存设置"变成"反复发请求"。
   */
  async function ensureWeather(force = false): Promise<void> {
    const s = settings.value;
    if (!shouldRequestWeather({ enabled: !!s.weatherEnabled, lastTryAt: s.weatherTriedAt || 0, force })) return;
    if (weatherBusy.value) return;
    weatherBusy.value = true;
    s.weatherTriedAt = Date.now();      // 先记"已经试过"：请求挂起时也不会被重复触发
    try {
      const loc = await weatherLocation(force);
      if (loc) {
        s.weatherLoc = loc;
        const w = await fetchWeather(loc.lat, loc.lon);
        if (w) { s.weatherNow = w; weatherMsg.value = '已更新 · ' + loc.name; }
        else weatherMsg.value = '这次没拉到天气（多半是没网）：先显示上次结果，30 分钟后自动再试';
      }
    } catch (e) {
      weatherMsg.value = '天气更新失败：' + (e instanceof Error ? e.message : String(e));
    } finally {
      weatherBusy.value = false;
      try { await saveSettingsFile(); } catch { /* 天气写盘失败不影响主流程，内存里这份照常显示 */ }
    }
  }

  return {
    booted, screen, profile, accounts, session, interests, timetables, courses, notes, records, hours, materials, settings, focus,
    activeTab, activeSheet, toast, toastSeq, busy, lastError, storage, activeTimetable, currentWeek, confirmReq, confirm, answerConfirm,
    boot, selectSchool, applyProfile, changeSchool, addInterest, ensureDemoAccount, register, login, logout, switchSchool,
    loadUserData, saveData, seedDemo, resetDemo, notify,
    newTimetable, addCourse, removeCourse, addNote, addRecord, addHour, removeHour, addMaterial, removeMaterial, materialsOf, hourTotal, blockScore, totalScore, coursesOn, persistManifest,
    weatherBusy, weatherMsg, ensureWeather,
    downloadedSchools, downloadedList, schoolRows, catalog, profileOf, checkCatalog, downloadSchool, removeDownloaded,
    /** 把已下载档案落盘：正常流程由 downloadSchool/removeDownloaded 调用（测试里模拟"下载成功"时会直接用） */
    saveDownloaded
  };
})
;
