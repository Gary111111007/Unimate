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
