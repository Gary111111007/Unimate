// 默认节次时间表（PRD 附录 C，已确认 2026-09-18）
import type { PeriodTime } from '../types.ts';

export const DEFAULT_PERIOD_TIMES: PeriodTime[] = [
  { period: 1, start: '08:00', end: '08:45' },
  { period: 2, start: '08:50', end: '09:35' },
  { period: 3, start: '09:45', end: '10:30' },
  { period: 4, start: '10:40', end: '11:25' },
  { period: 5, start: '11:30', end: '12:15' },
  { period: 6, start: '13:30', end: '14:15' },
  { period: 7, start: '14:20', end: '15:05' },
  { period: 8, start: '15:15', end: '16:00' },
  { period: 9, start: '16:05', end: '16:50' },
  { period: 10, start: '18:00', end: '18:45' },
  { period: 11, start: '18:50', end: '19:35' },
  { period: 12, start: '19:40', end: '20:25' }
];

export const COURSE_COLORS = [
  '#2E5AAC', '#E8624C', '#3FA97B', '#8E6BC9', '#E8A33D', '#2F9DB5',
  '#C9547E', '#6B8F3F', '#5A6EE8', '#B5762F', '#3F9E8E', '#8A5AA0'
];

/**
 * 同一门课永远同一个颜色。
 * 旧做法是在导入时按行号取模（i % 12），于是"高等数学"出现在第 3 行和第 40 行
 * 就成了两种颜色 —— 真机反馈"相同的课程没有统一颜色"就是这个。
 * 这里改成对课程名做稳定哈希：不依赖顺序，重复导入/换学期都不会变色，
 * 用户手动选过色（colorSet）时由界面层优先用手动色。
 */
export function courseColorIndex(name: string): number {
  const key = (name || '').replace(/\s+/g, '');
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % COURSE_COLORS.length;
}
