// 本地通知（PRD 5.10）。所有调用都包 try/catch：桌面预览与未授权时静默降级，
// 但会把结果返回给界面显示，避免"提醒没响也不知道为什么"。
import { LocalNotifications } from '@capacitor/local-notifications';
import type { Course, NoteItem, Settings, Timetable } from '../types.ts';

const CLASS_ID_BASE = 100000;
const NOTE_ID_BASE = 200000;
const TEST_ID = 900;
const DEMO_ID = 999;
const HORIZON_DAYS = 14;
const CHANNEL_TAG = 'v2';

export interface RescheduleResult { scheduled: number; permission: string; error: string }

function toId(key: string, base: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return base + (h % 90000);
}
function toDate(s: string): Date { return new Date(s.replace(/-/g, '/')); }

export async function ensurePermission(): Promise<boolean> {
  try {
    const cur = await LocalNotifications.checkPermissions();
    if (cur.display === 'granted') return true;
    const req = await LocalNotifications.requestPermissions();
    return req.display === 'granted';
  } catch { return false; }
}

export async function permissionState(): Promise<string> {
  try { return (await LocalNotifications.checkPermissions()).display; } catch { return 'unsupported'; }
}

async function ensureChannels(): Promise<void> {
  const anyLocal = LocalNotifications as any;
  if (typeof anyLocal.createChannel !== 'function') return;
  // Android 8+ 的通知渠道一旦创建，importance 与声音就改不动了，用同 id 重建无效。
  // 因此渠道 id 带版本号：需要调整横幅等级时递增 CHANNEL_TAG，新设置才会真正落到手机上。
  for (const ch of [
    { id: 'class-' + CHANNEL_TAG, name: '上课提醒', description: '课前提醒，横幅弹出并响铃', importance: 5, vibration: true, lightColor: '#2E5AAC', lockScreenVisibility: 1, audioAttributes: { contentType: 4, flags: 1, source: 2, usage: 5 } },
    { id: 'todo-' + CHANNEL_TAG, name: '待办提醒', description: '记事本到期提醒，横幅弹出并响铃', importance: 5, vibration: true, lightColor: '#2E5AAC', lockScreenVisibility: 1, audioAttributes: { contentType: 4, flags: 1, source: 2, usage: 5 } }
  ]) { try { await anyLocal.createChannel(ch); } catch { /* 已存在或不支持 */ } }
}

async function safeScheduled(): Promise<number[]> {
  try {
    const all = await LocalNotifications.scheduled();
    return all.map((n) => n.id);
  } catch { return []; }
}

async function cancelIds(ids: number[]): Promise<void> {
  if (!ids.length) return;
  try { await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) }); } catch { /* noop */ }
}

export interface ScheduleStats { total: number; classReminders: number; todoReminders: number; testReminders: number; nextFireAt: string }

// 口径修正：TEST_ID/DEMO_ID 的 id 小于 CLASS_ID_BASE，旧代码用 id>=CLASS_ID_BASE 过滤，
// 把测试提醒整个滤掉了，导致闹钟明明排进去了却永远显示"0 条"。这里改为全量分类统计。
export async function scheduleStats(): Promise<ScheduleStats> {
  const s: ScheduleStats = { total: 0, classReminders: 0, todoReminders: 0, testReminders: 0, nextFireAt: '' };
  try {
    const all = await LocalNotifications.scheduled();
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
    await cancelIds((await safeScheduled()).filter((id) => id !== TEST_ID && id !== DEMO_ID));
    const tt = timetables.find((t) => t.id === settings.lastActiveTimetableId) || timetables[0];
    if (!tt) { result.error = '还没有课表'; return result; }

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
            startTime: new Date(fire), notificationChannelId: 'class-' + CHANNEL_TAG, forceAlert: true,
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
            startTime: new Date(fire), notificationChannelId: 'todo-' + CHANNEL_TAG, forceAlert: true,
            smallIcon: 'ic_stat_icon', autoCancel: true
          });
        }
      }
    }

    if (!list.length) return result;
    if (result.permission !== 'granted' && result.permission !== 'unsupported') {
      result.error = '系统通知权限未开启（当前：' + result.permission + '）';
      return result;
    }
    // 单次排期上限，避免 Android 一次性注册过多闹钟
    await LocalNotifications.schedule({ notifications: list.slice(0, 64) });
    result.scheduled = Math.min(list.length, 64);
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
    await LocalNotifications.schedule({
      notifications: [{
        id: TEST_ID, title: 'Unimate 测试提醒',
        body: '这条是 ' + minutes + ' 分钟前设置的，收到就说明提醒链路正常',
        startTime: when, notificationChannelId: 'todo-' + CHANNEL_TAG, forceAlert: true, smallIcon: 'ic_stat_icon', autoCancel: true
      }]
    });
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
    await LocalNotifications.schedule({
      notifications: [{
        id: DEMO_ID, title: 'Uni 提醒', body: '演示通知：Uni 已经准备好提醒你啦',
        startTime: new Date(fire), notificationChannelId: 'todo-' + CHANNEL_TAG, forceAlert: true, smallIcon: 'ic_stat_icon', autoCancel: true
      }]
    });
    return true;
  } catch { return false; }
}