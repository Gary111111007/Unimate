/**
 * 系统日历兜底（v2.56）的"哪些提醒会被写进日历"这一层。
 *
 * 为什么要单测：写进用户日历是不可逆的观感影响（日历里会多出日程），
 * 所以"写成哪些、写多少、什么时候写"必须是能算清、能验证的，而不是顺手 map 一遍。
 */
import { CALENDAR_HORIZON_DAYS, calendarEventsFor } from '../src/services/notify.ts';

let pass = 0;
const fails: string[] = [];
function ok(name: string, yes: boolean, detail = ''): void {
  if (yes) { pass++; return; }
  fails.push(name + (detail ? ' — ' + detail : ''));
}

const now = new Date('2026-09-23T12:00:00+08:00').getTime();
const H = 3600 * 1000;
const D = 24 * H;
const mk = (id: number, at: number, body = '还有 10 分钟：高等数学') => ({ id, title: '上课提醒', body, at });

{
  const out = calendarEventsFor([mk(1, now + 2 * H)], now);
  ok('未来一条提醒 → 写一条日历日程', out.length === 1 && out[0].id === 1, JSON.stringify(out));
  ok('日程标题用提醒正文（这样日历里能直接看出是哪节课）', out[0].title.includes('高等数学'), out[0].title);
  ok('默认时长 10 分钟', out[0].durationMin === 10, String(out[0].durationMin));
}
{
  const out = calendarEventsFor([mk(1, now - H), mk(2, now + H)], now);
  ok('已经过去的提醒不再写（避免往日历里塞历史）', out.length === 1 && out[0].id === 2, JSON.stringify(out));
}
{
  const out = calendarEventsFor([mk(1, now + (CALENDAR_HORIZON_DAYS + 1) * D), mk(2, now + CALENDAR_HORIZON_DAYS * D - H)], now);
  ok('只写地平线（' + CALENDAR_HORIZON_DAYS + ' 天）以内的', out.length === 1 && out[0].id === 2, JSON.stringify(out));
}
{
  const out = calendarEventsFor([mk(3, now + 3 * D), mk(1, now + D), mk(2, now + 2 * D)], now);
  ok('按时间升序（日历里看起来才自然）', out.map((x) => x.id).join(',') === '1,2,3', out.map((x) => x.id).join(','));
}
{
  ok('空输入不炸', calendarEventsFor([], now).length === 0, '');
  const fallback = calendarEventsFor([{ id: 9, title: '待办提醒', body: '', at: now + H }], now);
  ok('没有正文明细时回退用标题（不会写出空日程）', fallback[0].title === '待办提醒', fallback[0].title);
}

console.log('Calendar Test: ' + pass + ' passed, ' + fails.length + ' failed');
for (const f of fails) console.log('  ✗ ' + f);
if (fails.length) process.exit(1);
