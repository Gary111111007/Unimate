import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type {
  Account, Course, InterestEntry, NoteItem, SchoolProfile, SecondClassRecord,
  Settings, Timetable
} from '../types.ts';
import { findSchool, profileFor, SCHOOLS } from '../catalog/universities.ts';
import { DEFAULT_PERIOD_TIMES } from '../catalog/periods.ts';
import { uuid, nowStamp, dateStamp } from '../services/id.ts';
import { readJson, writeJson, readText, writeText, remove, probeStorage } from '../services/io.ts';
import { randomSalt, sha256Text } from '../services/crypto.ts';
import { buildDemoNotes, buildDemoRecords, buildDemoTimetable } from '../services/demo.ts';
import { rescheduleAll, scheduleDemoPing, cancelAllScheduledOnBoot } from '../services/notify.ts';

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
    showWeekend: true, theme: 'light', webviewKeepSession: true, autoBackup: true,
    lastActiveTimetableId: null,
    appEdits: {},
    appOrder: [],
    hiddenApps: [],
    // 用户自行添加的校园入口（本校档案没收录的服务）
    customApps: []
  };
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
  const settings = ref<Settings>(defaultSettings(profileFor('buct')!));

  const activeTab = ref(0);
  const activeSheet = ref<'sheet1' | 'sheet2'>('sheet1');
  const toast = ref('');
  const busy = ref('');
  const toastSeq = ref(0);
  const lastError = ref('');
  const storage = ref<{ ok: boolean; detail: string }>({ ok: true, detail: '未检测' });

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
    try {
      storage.value = await probeStorage();
      if (!storage.value.ok) fail('本机存储不可用', storage.value.detail);
    } catch { /* 自检本身失败不阻塞启动 */ }
    try {
    const manifest = await readJson<any>('manifest.json', { schemaVersion: SCHEMA_VERSION, schools: {}, accounts: [] });
    interests.value = await readJson<InterestEntry[]>('catalog/interests.json', []);
      accounts.value = await readJson<Account[]>('accounts.json', []);
      const lastAccount = manifest.lastAccountId;
      const acc = lastAccount ? accounts.value.find((a) => a.id === lastAccount) : null;
      if (acc) {
        session.value = { accountId: acc.id, username: acc.username, displayName: acc.displayName, isDemo: acc.isDemo };
        await finishLogin();          // 已绑定高校则直接进主界面，否则进学校选择页
      } else {
        screen.value = 'login';       // 无历史登录态：先登录，不展示选校页
      }
      // 冷启动先清空系统里遗留的排期，再按当前课表重建。
      // Capacitor 启动时会恢复上次注册的本地通知，其中已过期的会被立即补发，
      // 这正是「App 没开时不提醒、一打开所有提醒一起涌出」的成因。
      try { await cancelAllScheduledOnBoot(); } catch { /* 预览环境忽略 */ }
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
    const p = profileFor(schoolId);
    if (!p) return false;
    profile.value = p;
    settings.value = defaultSettings(p);
    return true;
  }

  async function selectSchool(schoolId: string, silent = false): Promise<boolean> {
    const entry = findSchool(schoolId);
    const p = profileFor(schoolId);
    if (!entry || !p) {
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
    if (sid && profileFor(sid)) {
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
    timetables.value = []; courses.value = []; notes.value = []; records.value = [];
    screen.value = 'login';
    activeTab.value = 0;
    void persistManifest();
  }

  /** 切换学校：保留登录状态，回到学校选择页 */
  async function changeSchool(): Promise<void> {
    profile.value = null;
    timetables.value = []; courses.value = []; notes.value = []; records.value = [];
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
    if (!settings.value.lastActiveTimetableId && timetables.value.length) {
      settings.value.lastActiveTimetableId = timetables.value[0].id;
    }
    try { await rescheduleAll(courses.value, timetables.value, notes.value, settings.value); } catch (e) { fail('重建提醒', e); }
  }

  async function saveData(): Promise<void> {
    if (!session.value) return;
    const b = base();
    await writeJson(b + '/timetable/timetables.json', timetables.value);
    await writeJson(b + '/timetable/courses.json', courses.value);
    await writeJson(b + '/notes/notes.json', notes.value);
    await writeJson(b + '/secondclass/records.json', records.value);
    await writeJson(b + '/settings.json', settings.value);
    try { await rescheduleAll(courses.value, timetables.value, notes.value, settings.value); } catch (e) { fail('重建提醒', e); }
  }

  async function seedDemo(): Promise<void> {
    const p = profile.value!;
    const tt = buildDemoTimetable(p.academic.semesterLabel, p.academic.semesterStartMonday, p.academic.totalWeeks);
    timetables.value = [tt];
    settings.value.lastActiveTimetableId = tt.id;
    try {
      const html = await fetch('sample-timetable.html').then((r) => r.text());
      const mod = await import('../services/parser/jwglxtBuct.ts');
      const parsed = mod.parseJwglxtTimetable(html);
      courses.value = parsed.courses.map((c, i) => ({ ...c, id: uuid(), timetableId: tt.id, colorIndex: i % 12 }));
    } catch { courses.value = []; }
    notes.value = buildDemoNotes();
    try { records.value = await buildDemoRecords(base()); } catch (e) { fail('生成示例照片', e); records.value = []; }
    try { await saveData(); } catch (e) { fail('保存演示数据', e); }
    try { await scheduleDemoPing(); } catch { /* 通知不可用时忽略 */ }
    notify('演示数据已就绪：' + courses.value.length + ' 条上课安排、' + notes.value.length + ' 条记事、' + records.value.length + ' 条二课记录');
  }

  async function resetDemo(): Promise<void> {
    timetables.value = []; courses.value = []; notes.value = []; records.value = [];
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
      colorIndex: courses.value.length % 12, source: 'manual', pendingFilter: false, editedFields: [], remark: '',
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

  function addRecord(part: Partial<SecondClassRecord>): SecondClassRecord {
    const r: SecondClassRecord = {
      id: uuid(), block: 'de', stage: 'basic', activityName: '', description: '', activityDate: dateStamp(),
      photos: [], score: 10, scorePreset: '', createdAt: nowStamp(), updatedAt: nowStamp(), deletedAt: null, ...part
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

  return {
    booted, screen, profile, accounts, session, interests, timetables, courses, notes, records, settings,
    activeTab, activeSheet, toast, toastSeq, busy, lastError, storage, activeTimetable, currentWeek,
    boot, selectSchool, applyProfile, changeSchool, addInterest, ensureDemoAccount, register, login, logout, switchSchool,
    loadUserData, saveData, seedDemo, resetDemo, notify,
    newTimetable, addCourse, removeCourse, addNote, addRecord, blockScore, totalScore, coursesOn, persistManifest
  };
});