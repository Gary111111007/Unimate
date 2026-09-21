// 本地通知（PRD 5.10）。所有调用都包 try/catch：桌面预览与未授权时静默降级，
// 但会把结果返回给界面显示，避免"提醒没响也不知道为什么"。
import { LocalNotifications } from '@capacitor/local-notifications';
import { ref } from 'vue';
import { guard } from './guard.ts';
import { WIRE_DATE_RE, wireAt } from './notifyWire.ts';
import { readJson, writeJson } from './io.ts';
import { JwWebView, isNativeWebView, type PowerStatus } from './jwwebview.ts';
import type { Course, NoteItem, Settings, Timetable } from '../types.ts';

const CLASS_ID_BASE = 100000;
const NOTE_ID_BASE = 200000;
const TEST_ID = 900;
const DEMO_ID = 999;
/*
 * 排期地平线。
 * 原来是 14 天：App 每次打开都会重建，14 天只是让系统里堆着几十条排期；
 * 一旦手机被 ROM 冻结/进 Doze，这些"过期未投递"的排期会在下次开机/解锁时被插件的恢复广播
 * 改写成"15 秒后"一起补发（真机反馈的"一打开全涌出来"）。
 * 改成 7 天：一周内必然会打开一次 App（课表天天看），同时把系统侧堆积减半。
 */
const HORIZON_DAYS = 7;
/**
 * 清理时的宽限窗口：计划时刻过去还不到 90 秒的排期**不动**。
 * 因为用户很可能正好在提醒时刻前后打开 App（"到点了到底有没有课"），
 * 旧实现的全清+重建会把这一条静默吞掉 —— 这正是"到点不提示"的一种成因。
 */
const GRACE_MS = 90 * 1000;
/*
 * 【v2.14 修正，真机反馈"提醒还是不响"的根因之二】
 * 这个常量同时是渠道 id 的后缀。升到 v3 是因为：
 *   1) v2 渠道创建时把声音写成了 audioAttributes（插件根本不读这个字段），
 *      导致渠道建出来是"无声"的；
 *   2) Android 8+ 的渠道一旦创建，importance / 声音 / 振动就**改不动**，
 *      用同一个 id 重建无效，只能换 id 才能让新设置真正落到已安装的手机上。
 */
const CHANNEL_TAG = 'v3';
/** 渠道提示音：必须是 android/app/src/main/res/raw 下的资源名（插件只支持 raw 资源） */
const CHANNEL_SOUND = 'unimate_notify';

/**
 * 【时区：已按源码逐跳核实，勿再改回"本地拼串"】
 * 链路：JS 的 Date 过桥 -> native-bridge.js:843 JSON.stringify(data)
 *       -> Date.prototype.toJSON() = toISOString() = 带 Z 的 **UTC** 串；
 *   原生侧 LocalNotificationSchedule.buildAtElement()（插件 6.1.3）用
 *       SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'") 且 **setTimeZone(UTC)** 解析，
 *   两端口径一致，所以直接传 Date 就是正确的绝对时刻。
 *   历史教训：v2.7 曾以为原生把 'Z' 当字面量按本地时区解，改成"本地字段拼串 + 假 Z"，
 *   结果每条提醒被整体推到 **+8 小时** 才触发 —— 表现就是"到点了不弹，隔很久一起弹"。
 *   真正会造成错时/补弹的是"开机恢复广播"（见文件末尾 cleanupStaleOnBoot 与排期账本）。
 */
function atTime(d: Date): Date { return d; }

/**
 * 启动自检：确认 Date 过桥后仍是原生能按 UTC 解的形状。
 * Capacitor 大版本升级最容易悄悄改掉这一步，届时提醒会整体偏移而不是报错，
 * 所以把结论显示到设置界面上，出问题一眼能看到。
 */
export function wireSelfCheck(): { ok: boolean; sample: string; hint: string } {
  const d = new Date(Date.now() + 60000);
  let s = '';
  try { s = wireAt(d); } catch { return { ok: false, sample: '', hint: '过桥序列化失败' }; }
  const ok = WIRE_DATE_RE.test(s) && Math.abs(new Date(s).getTime() - d.getTime()) < 1000;
  return { ok, sample: s, hint: ok ? '' : '时刻桥格式已变，提醒可能整体偏移，请检查 Capacitor 版本' };
}

export interface RescheduleResult { scheduled: number; permission: string; error: string }

function toId(key: string, base: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return base + (h % 90000);
}
function toDate(s: string): Date { return new Date(s.replace(/-/g, '/')); }

export async function ensurePermission(): Promise<boolean> {
  try {
    const cur = await guard('查通知权限', LocalNotifications.checkPermissions(), 2500, { display: 'unknown' } as any);
    if (cur.display === 'granted') return true;
    // 系统权限框在部分国产 ROM 上会把回调吞掉，必须限时，否则启动永远等在这里
    const req = await guard('申请通知权限', LocalNotifications.requestPermissions(), 12000, { display: 'unknown' } as any);
    return req.display === 'granted';
  } catch { return false; }
}

export async function permissionState(): Promise<string> {
  try { return (await guard('查通知权限', LocalNotifications.checkPermissions(), 2500, { display: 'unsupported' } as any)).display; } catch { return 'unsupported'; }
}

async function ensureChannels(): Promise<void> {
  const anyLocal = LocalNotifications as any;
  if (typeof anyLocal.createChannel !== 'function') return;
  // Android 8+ 的通知渠道一旦创建，importance 与声音就改不动了，用同 id 重建无效。
  // 因此渠道 id 带版本号：需要调整横幅等级时递增 CHANNEL_TAG，新设置才会真正落到手机上。
  //
  // 字段名必须用插件真正读的那几个（详见 NotificationChannelManager.java）：
  //   id / name / description / importance / visibility / sound / vibration / lights / lightColor
  // 旧写法传的 lockScreenVisibility 与 audioAttributes 会被**静默忽略**：
  // 前者让锁屏可见性没生效，后者让渠道没有声音（sound 才是声音字段）。
  for (const ch of [
    { id: 'class-' + CHANNEL_TAG, name: '上课提醒', description: '课前提醒，横幅弹出并响铃', importance: 5, sound: CHANNEL_SOUND, vibration: true, lights: true, lightColor: '#2E5AAC', visibility: 1 },
    { id: 'todo-' + CHANNEL_TAG, name: '待办提醒', description: '记事本到期提醒，横幅弹出并响铃', importance: 5, sound: CHANNEL_SOUND, vibration: true, lights: true, lightColor: '#2E5AAC', visibility: 1 }
  ]) { try { await guard('建通知渠道', anyLocal.createChannel(ch), 2500, undefined); } catch { /* 已存在或不支持 */ } }

  // 渠道换 id 的副作用：系统设置里会同时列出新旧两套同名渠道，用户会以为"有两个上课提醒"。
  // 建完新渠道后把旧的删掉。deleteChannel 对不存在的 id 是空操作，API < 26 会被插件 reject，两种情况都吞掉。
  if (typeof anyLocal.deleteChannel === 'function') {
    for (const id of ['class-v2', 'todo-v2']) {
      try { await guard('清理旧通知渠道', anyLocal.deleteChannel({ id, name: id }), 2000, undefined); } catch { /* 不存在或不支持 */ }
    }
  }
}

async function safeScheduled(): Promise<number[]> {
  try {
    const all = await guard('读排期', LocalNotifications.scheduled(), 2500, [] as any);
    return all.map((n) => n.id);
  } catch { return []; }
}

async function cancelIds(ids: number[]): Promise<void> {
  if (!ids.length) return;
  try { await guard('取消排期', LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) }), 3000, undefined); } catch { /* noop */ }
}

// ---------------- 排期账本：区分"本来就该响"与"系统改写的补发" ----------------

/**
 * 我们自己的排期账本（`notify/plan.json`）：记下"排了哪些 id、计划什么时候响"。
 *
 * 为什么要自己记账：插件的开机恢复广播会把**已过期**的排期改写成"now + 15 秒"，
 * 改写之后光看插件里的 `at` 已经分不出"这条本来就是未来的"还是"这条早该响、被补发的"。
 * 有账本才能只清该清的，而不是"全清再重建"（那会吞掉用户正在等的那一条）。
 */
interface PlanEntry { id: number; at: number; kind: 'c' | 'n' }
const PLAN_PATH = 'notify/plan.json';

async function savePlan(entries: PlanEntry[]): Promise<void> {
  try { await writeJson(PLAN_PATH, { savedAt: Date.now(), entries }); } catch { /* 写不了不影响排期本身 */ }
}

export async function loadPlan(): Promise<PlanEntry[]> {
  try {
    const j: any = await readJson(PLAN_PATH, null);
    return j && Array.isArray(j.entries)
      ? j.entries.filter((e: any) => e && typeof e.id === 'number' && typeof e.at === 'number')
      : [];
  } catch { return []; }
}

/**
 * 该清掉哪些排期（纯函数，单测直接覆盖）：
 *  - 计划时刻已经过去超过 grace 的（含被恢复广播改写成"15 秒后"的那些）；
 *  - 账本里根本没有的（老版本残留 / 别的来源），一律不可信 → 清掉；
 *  - 测试/演示提醒（id 900/999）不归这里管。
 */
export function staleIds(plan: Array<{ id: number; at: number }>, scheduledIds: number[], now: number, graceMs: number = GRACE_MS): number[] {
  const planned = new Map(plan.map((e) => [e.id, e.at]));
  const out: number[] = [];
  for (const id of scheduledIds) {
    if (id === TEST_ID || id === DEMO_ID) continue;
    const at = planned.get(id);
    if (at === undefined) { out.push(id); continue; }
    if (at < now - graceMs) out.push(id);
  }
  return out;
}

/**
 * 冷启动清理（取代原来的"全清"）：**只清过期与来路不明的**，未来的排期原样留着。
 * 清出来的那份账本也一起收敛，免得越积越多。
 */
export async function cleanupStaleOnBoot(): Promise<number> {
  const [plan, ids] = await Promise.all([loadPlan(), safeScheduled()]);
  const stale = staleIds(plan, ids, Date.now());
  await cancelIds(stale);
  const kept = ids.filter((id) => stale.indexOf(id) < 0);
  await savePlan(plan.filter((e) => kept.indexOf(e.id) >= 0));
  return stale.length;
}

export interface ScheduleStats { total: number; classReminders: number; todoReminders: number; testReminders: number; nextFireAt: string }

// 口径修正：TEST_ID/DEMO_ID 的 id 小于 CLASS_ID_BASE，旧代码用 id>=CLASS_ID_BASE 过滤，
// 把测试提醒整个滤掉了，导致闹钟明明排进去了却永远显示"0 条"。这里改为全量分类统计。
export async function scheduleStats(): Promise<ScheduleStats> {
  const s: ScheduleStats = { total: 0, classReminders: 0, todoReminders: 0, testReminders: 0, nextFireAt: '' };
  try {
    const all = await guard('排期统计', LocalNotifications.scheduled(), 2500, [] as any);
    s.total = all.length;
    const times: number[] = [];
    for (const n of all) {
      if (n.id === TEST_ID || n.id === DEMO_ID) s.testReminders++;
      else if (n.id >= NOTE_ID_BASE) s.todoReminders++;
      else if (n.id >= CLASS_ID_BASE) s.classReminders++;
      const at = (n as any).at || ((n as any).schedule && (n as any).schedule.at);
      if (at) { const t = new Date(at).getTime(); if (t > 0) times.push(t); }
    }
    times.sort((a, b) => a - b);
    if (times.length) s.nextFireAt = new Date(times[0]).toTimeString().slice(0, 5);
  } catch { /* noop */ }
  return s;
}

export async function scheduledCount(): Promise<number> { return (await scheduleStats()).total; }

export async function cancelAll(): Promise<void> {
  await cancelIds(await safeScheduled());
}

export async function rescheduleAll(courses: Course[], timetables: Timetable[], notes: NoteItem[], settings: Settings): Promise<RescheduleResult> {
  const result: RescheduleResult = { scheduled: 0, permission: 'unknown', error: '' };
  try {
    result.permission = await permissionState();
    await ensureChannels();
    /*
     * 清理旧排期时**放过"计划时刻刚过去还没响"的那些**（见 GRACE_MS）：
     * 用户常常正好在提醒时刻打开 App，旧写法"全清再重建"会把这一条静默吞掉。
     */
    const planBefore = await loadPlan();
    const plannedAt = new Map(planBefore.map((e) => [e.id, e.at]));
    const existing = await safeScheduled();
    const tt = timetables.find((t) => t.id === settings.lastActiveTimetableId) || timetables[0];
    if (!tt) {
      // 没有课表：把不再需要的排期（除测试/演示）清掉即可
      await cancelIds(existing.filter((id) => id !== TEST_ID && id !== DEMO_ID));
      await savePlan([]);
      result.error = '还没有课表';
      return result;
    }

    const times = new Map(settings.periodTimes.map((p) => [p.period, p]));
    const now = Date.now();
    const horizon = now + HORIZON_DAYS * 86400 * 1000;
    const list: any[] = [];

    if (settings.notifyEnabled && settings.classReminderEnabled) {
      const seen = new Set<string>();
      for (const c of courses) {
        if (c.timetableId !== tt.id) continue;
        for (const w of c.weeks) {
          const monday = toDate(tt.semesterStartMonday + ' 00:00:00');
          const dayDate = new Date(monday.getTime() + ((w - 1) * 7 + (c.day - 1)) * 86400 * 1000);
          const pt = times.get(c.startPeriod);
          if (!pt) continue;
          const start = new Date(dayDate);
          const [sh, sm] = pt.start.split(':').map(Number);
          start.setHours(sh, sm, 0, 0);
          const fire = start.getTime() - settings.classReminderMinutes * 60 * 1000;
          if (fire < now || fire > horizon) continue;
          const id = toId('c' + c.id + w + c.startPeriod, CLASS_ID_BASE);
          if (seen.has(String(id))) continue;
          seen.add(String(id));
          list.push({
            id, title: '上课提醒',
            body: '还有 ' + settings.classReminderMinutes + ' 分钟：' + c.name + (c.room ? ' · ' + c.room : ''),
            schedule: { at: atTime(new Date(fire)), allowWhileIdle: true }, channelId: 'class-' + CHANNEL_TAG,
            extra: { k: 'c', id: c.id, w },
            smallIcon: 'ic_stat_icon', autoCancel: true
          });
        }
      }
    }

    if (settings.notifyEnabled) {
      const seen = new Set<string>();
      for (const n of notes) {
        if (n.done || n.deletedAt || !n.remindAt) continue;
        const base = toDate(n.remindAt).getTime();
        for (const off of (n.alarms && n.alarms.length ? n.alarms : [0])) {
          const fire = base - off * 60 * 1000;
          if (fire < now || fire > horizon) continue;
          const id = toId('n' + n.id + off, NOTE_ID_BASE);
          if (seen.has(String(id))) continue;
          seen.add(String(id));
          list.push({
            id, title: '待办提醒', body: n.title + '（' + n.remindAt.slice(5, 16) + '）',
            schedule: { at: atTime(new Date(fire)), allowWhileIdle: true }, channelId: 'todo-' + CHANNEL_TAG,
            extra: { k: 'n', id: n.id },
            smallIcon: 'ic_stat_icon', autoCancel: true
          });
        }
      }
    }

    // 即将重建的 id 集合：这些不动（下面 schedule 同 id 会覆盖）
    const keepIds = new Set(list.map((x) => x.id));
    const now2 = Date.now();
    await cancelIds(existing.filter((id) => {
      if (id === TEST_ID || id === DEMO_ID) return false;
      if (keepIds.has(id)) return false;
      const at = plannedAt.get(id);
      if (at !== undefined && at >= now2 - GRACE_MS) return false;   // 刚过点、可能正在响 → 留着
      return true;
    }));

    if (!list.length) { await savePlan([]); return result; }
    if (result.permission !== 'granted' && result.permission !== 'unsupported') {
      result.error = '系统通知权限未开启（当前：' + result.permission + '）';
      return result;
    }
    // 单次排期上限，避免 Android 一次性注册过多闹钟
    await guard('批量排期', LocalNotifications.schedule({ notifications: list.slice(0, 64) }), 8000, undefined);
    result.scheduled = Math.min(list.length, 64);
    // 记账：只记真正排进去的那些（多的那部分下次打开时会因为"账本里没有"被清掉）
    await savePlan(list.slice(0, 64).map((x) => ({ id: x.id, at: (x.schedule.at as Date).getTime(), kind: x.extra.k })));
    return result;
  } catch (e: any) {
    result.error = (e && (e.message || String(e))) || '未知错误';
    return result;
  }
}

/** 现场测试：N 分钟后弹一条，用于证明提醒链路是通的 */
export async function scheduleTest(minutes: number): Promise<{ ok: boolean; at: string; error: string }> {
  const when = new Date(Date.now() + minutes * 60 * 1000);
  try {
    await ensureChannels();
    const perm = await permissionState();
    if (perm !== 'granted') {
      const got = await ensurePermission();
      if (!got) return { ok: false, at: '', error: '通知权限未授予（当前：' + perm + '）' };
    }
    await cancelIds([TEST_ID]);
    await guard('单条排期', LocalNotifications.schedule({
      notifications: [{
        id: TEST_ID, title: 'Unimate 测试提醒',
        body: '这条是 ' + minutes + ' 分钟前设置的，收到就说明提醒链路正常',
        schedule: { at: atTime(when), allowWhileIdle: true }, channelId: 'todo-' + CHANNEL_TAG, smallIcon: 'ic_stat_icon', autoCancel: true
      }]
    }), 8000, undefined);
    return { ok: true, at: when.toTimeString().slice(0, 8), error: '' };
  } catch (e: any) {
    return { ok: false, at: '', error: (e && (e.message || String(e))) || '未知错误' };
  }
}

export async function scheduleDemoPing(): Promise<boolean> {
  const fire = Date.now() + 2 * 60 * 1000;
  try {
    await ensureChannels();
    await cancelIds([DEMO_ID]);
    await guard('单条排期', LocalNotifications.schedule({
      notifications: [{
        id: DEMO_ID, title: 'Uni 提醒', body: '演示通知：Uni 已经准备好提醒你啦',
        schedule: { at: atTime(new Date(fire)), allowWhileIdle: true }, channelId: 'todo-' + CHANNEL_TAG, smallIcon: 'ic_stat_icon', autoCancel: true
      }]
    }), 8000, undefined);
    return true;
  } catch { return false; }
}

/** Android 12+ 精确闹钟授权状态。未授权时提醒会被系统延后（只有原生环境才有意义）。 */
export async function exactAlarmState(): Promise<string> {
  const anyLocal = LocalNotifications as any;
  if (typeof anyLocal.checkExactNotificationSetting !== 'function') return 'unsupported';
  try { return (await anyLocal.checkExactNotificationSetting()).exact_alarm; } catch { return 'unsupported'; }
}

/** 跳到系统的"闹钟和提醒"设置页让用户授权（Android 12 以下直接返回 granted）。 */
export async function requestExactAlarmSetting(): Promise<string> {
  const anyLocal = LocalNotifications as any;
  if (typeof anyLocal.changeExactNotificationSetting !== 'function') return 'unsupported';
  try { return (await anyLocal.changeExactNotificationSetting()).exact_alarm; } catch { return 'unknown'; }
}

// ---------------- 提醒可用性自检（真机复现"到点不响"的根因就在这两项上） ----------------

/**
 * 提醒在后台能不能准时响，取决于两件系统开关（AGENTS.md 里的"三件套"前两项；
 * 第三项厂商自启动只能靠用户手动，原生侧给出按厂商的路径文案）：
 *   1) **精确闹钟**（Android 12+ 默认不给）：不给 → 插件退化成"不精确闹钟" →
 *      到点不响、等手机/应用活跃时一起补发（真机反馈的"一打开全涌出来"）；
 *   2) **电池优化豁免**：不豁免 → 国产 ROM 冻结后台，排期根本投递不到。
 * 这一层只做"查状态"，不主动跳系统设置（产品负责人明确要求过不要自动跳）。
 */
export interface ReminderReadiness {
  native: boolean;
  exactAlarm: boolean;
  batteryOk: boolean;
  rom: string;
  hint: string;
  /** 需要修哪一项（'' = 都没问题，不用打扰用户） */
  canFix: '' | 'exact' | 'battery';
}

export async function reminderReadiness(): Promise<ReminderReadiness> {
  if (!isNativeWebView()) {
    return { native: false, exactAlarm: true, batteryOk: true, rom: '', hint: '', canFix: '' };
  }
  let exactAlarm = true;
  let batteryOk = true;
  let rom = '';
  let hint = '';
  try {
    const st = await guard('查精确闹钟', exactAlarmState(), 2500, 'unknown');
    // 'unsupported' = Android 12 以下没有这项限制；'unknown' 才当没就绪
    exactAlarm = st === 'granted' || st === 'unsupported';
  } catch { /* 查不到就不吓唬用户 */ }
  try {
    const ps: PowerStatus = await guard('查电池优化', JwWebView.powerStatus(), 2500, null as any);
    if (ps && ps.ok) {
      batteryOk = !!ps.ignoring;
      rom = ps.rom || '';
      hint = ps.hint || '';
      if (ps.exactAlarm === false) exactAlarm = false;
    }
  } catch { /* 同上 */ }
  return { native: true, exactAlarm, batteryOk, rom, hint, canFix: !exactAlarm ? 'exact' : (!batteryOk ? 'battery' : '') };
}

/** 厂商 / 机型 / 电池优化状态（通知设置面板显示用；桌面预览返回 ok:false） */
export async function powerStatus(): Promise<PowerStatus> {
  try {
    const r: PowerStatus = await guard('查电池优化', JwWebView.powerStatus(), 2500, null as any);
    return r || { ok: false, ignoring: false, exactAlarm: true, rom: '', hint: '', error: '超时' };
  } catch (e: any) {
    return { ok: false, ignoring: false, exactAlarm: true, rom: '', hint: '', error: (e && e.message) || String(e) };
  }
}

/** 最近一次自检结果（课表页那行提示用）：只做展示，不阻塞任何流程 */
export const reminderRisk = ref<ReminderReadiness | null>(null);

export async function refreshReminderRisk(): Promise<ReminderReadiness> {
  const r = await reminderReadiness();
  reminderRisk.value = r;
  return r;
}

/** 申请电池优化豁免（先试系统一键弹窗，退回设置列表页） */
export async function requestIgnoreBattery(): Promise<string> {
  try {
    const r = await guard('申请电池优化豁免', JwWebView.requestIgnoreBattery(), 10000, { ok: false, mode: '', error: '超时' } as any);
    return r && r.ok ? '已打开系统设置，选「允许」后回来即可' : ('打不开系统页：' + ((r && r.error) || '未知原因'));
  } catch (e: any) {
    return '打不开系统页：' + ((e && e.message) || e);
  }
}

/** 打开系统的"闹钟和提醒"授权页 */
export async function openExactAlarmSettings(): Promise<string> {
  try {
    const r: any = await guard('打开精确闹钟设置', JwWebView.openExactAlarmSettings(), 6000, { ok: false, error: '超时' });
    return r && r.ok ? '已打开系统设置，打开「允许设置闹钟和提醒」后回来即可' : ('打不开系统页：' + ((r && r.error) || '未知原因'));
  } catch (e: any) {
    return '打不开系统页：' + ((e && e.message) || e);
  }
}

/** 一键去修"提醒可能不准时"：按当前缺哪一项决定跳哪个系统页（课表页提示条用） */
export async function fixReminderSetting(target?: '' | 'exact' | 'battery'): Promise<string> {
  const t = target || (reminderRisk.value ? reminderRisk.value.canFix : 'exact');
  return t === 'battery' ? requestIgnoreBattery() : openExactAlarmSettings();
}
