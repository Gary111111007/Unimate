import type { Course as AppCourse, NoteItem, PeriodTime, Timetable } from '../types.ts';
import { uuid } from './id.ts';
import { LocalRulesAdapter } from '../../p5-assistant/n8n/core/local-rules-adapter.ts';
import {
  FixtureScheduleReader,
  type FixtureRow,
  type ScheduleFixture
} from '../../p5-assistant/n8n/core/schedule-reader.ts';
import type {
  ActionCard,
  TodoSummary,
  UniResponse
} from '../../p5-assistant/n8n/core/types.ts';

/** 主工程交给 Uni 的本机只读快照。这里不接 Cookie、密码、照片、成绩或二课明细。 */
export interface UniLocalSnapshot {
  activeTimetable: Timetable | null;
  courses: readonly AppCourse[];
  notes: readonly NoteItem[];
  periodTimes: readonly PeriodTime[];
  /** 学校课表时区。当前已落地高校均使用 Asia/Shanghai。 */
  scheduleTimezone?: string;
}

export interface UniLocalAnswer {
  response: UniResponse;
  timezone: string;
}

function compactWeeks(raw: readonly number[]): string {
  return [...new Set(raw.filter((w) => Number.isInteger(w) && w >= 1 && w <= 30))]
    .sort((a, b) => a - b)
    .join(',');
}

function periodsBetween(start: number, end: number): number[] {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return [];
  const out: number[] = [];
  for (let p = start; p <= end; p++) out.push(p);
  return out;
}

/** 把 App 已落库的课表映射为 P5 的学校形态；不会读取教务页面或认证信息。 */
export function buildUniScheduleFixture(snapshot: UniLocalSnapshot): ScheduleFixture {
  const tt = snapshot.activeTimetable;
  const rows: FixtureRow[] = tt
    ? snapshot.courses
      .filter((c) => c.timetableId === tt.id && !c.pendingFilter)
      .map((c) => ({
        courseName: c.name,
        weekday: c.day,
        periods: periodsBetween(c.startPeriod, c.endPeriod),
        weeks: compactWeeks(c.weeks),
        ...(c.room ? { room: c.room } : {}),
        ...(c.teacher ? { teacherName: c.teacher } : {})
      }))
    : [];
  return {
    termStart: tt?.semesterStartMonday || '1970-01-05',
    periods: snapshot.periodTimes.map((p) => ({ period: p.period, start: p.start, end: p.end })),
    rows
  };
}

export function buildUniTodos(notes: readonly NoteItem[]): TodoSummary[] {
  return notes
    .filter((n) => !n.deletedAt)
    .map((n) => ({
      title: n.title,
      ...(n.remindAt ? { dueAt: n.remindAt } : {}),
      done: n.done
    }));
}

export function deviceTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'; }
  catch { return 'Asia/Shanghai'; }
}

/**
 * APK 当前只接本机确定性链路：无 fetch、无模型、无 n8n 请求。
 * 同一次调用只读取传入快照；P5 原始工位仍是契约与算法真源。
 */
export function askUniLocal(
  snapshot: UniLocalSnapshot,
  text: string,
  now = new Date(),
  timezone = deviceTimezone()
): UniLocalAnswer {
  const reader = new FixtureScheduleReader(buildUniScheduleFixture(snapshot));
  const adapter = new LocalRulesAdapter({
    reader,
    scheduleTimezone: snapshot.scheduleTimezone || 'Asia/Shanghai'
  });
  return {
    response: adapter.ask(
      { text, timezone, todos: buildUniTodos(snapshot.notes) },
      { requestId: uuid(), now }
    ),
    timezone
  };
}

/** 把带时区的 ActionCard 时间转成 App 现有记事格式（本地墙钟时间）。 */
export function actionTimeToNoteStamp(card: ActionCard, timezone: string): string {
  const raw = card.noteDraft?.remindAt;
  if (!raw) return '';
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(d);
    const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value || '';
    const y = value('year'); const m = value('month'); const day = value('day');
    const h = value('hour'); const min = value('minute'); const sec = value('second');
    return y && m && day && h && min && sec ? `${y}-${m}-${day} ${h}:${min}:${sec}` : '';
  } catch { return ''; }
}
