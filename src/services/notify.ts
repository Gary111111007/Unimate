// 本地通知（PRD 5.10）。所有调用都包 try/catch：桌面预览与未授权时静默降级，
// 但会把结果返回给界面显示，避免"提醒没响也不知道为什么"。
import { LocalNotifications } from '@capacitor/local-notifications';
import type { Course, NoteItem, Settings, Timetable } from '../types.ts';

const CLASS_ID_BASE = 100000;
const NOTE_ID_BASE = 200000;
const TEST_ID = 900;
const DEMO_ID = 999;
const HORIZON_DAYS = 14;

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
  for (const ch of [
    { id: 'class', name: '上课提醒', description: '课前提醒', importance: 5, sound: null },
    { id: 'todo', name: '待办提醒', description: '记事本到期提醒', importance: 5, sound: null }
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

export async function scheduledCount(): Promise<number> {
  const ids = await safeScheduled();
  return ids.filter((id) => id >= CLASS_ID_BASE).length;
}

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
            startTime: new Date(fire), notificationChannelId: 'class',
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
            startTime: new Date(fire), notificationChannelId: 'todo',
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
        startTime: when, notificationChannelId: 'todo', smallIcon: 'ic_stat_icon', autoCancel: true
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
        startTime: new Date(fire), notificationChannelId: 'todo', smallIcon: 'ic_stat_icon', autoCancel: true
      }]
    });
    return true;
  } catch { return false; }
}
