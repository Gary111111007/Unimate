/**
 * schedule.at 的"过桥形态"单独成模块：notify.ts 顶部 import 了 Capacitor 插件，
 * 纯 Node 环境加载不了；把可验证的契约抽出来，单测才能真的守住它。
 */

/** 原生 LocalNotificationSchedule.JS_DATE_FORMAT（逐字抄自插件 6.1.3 源码） */
export const NATIVE_PATTERN = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'";

/** 原生 buildAtElement() 里这一步是决定性的：setTimeZone(TimeZone.getTimeZone("UTC")) */
export const NATIVE_PARSE_TZ = 'UTC';

/** 过桥后 JS 侧一定能得到这个形状，否则原生 SimpleDateFormat 直接 ParseException */
export const WIRE_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * 复现 Capacitor 过桥：native-bridge.js 用 JSON.stringify 把 options 发给原生，
 * Date 因此走 toJSON() -> toISOString()。
 */
export function wireAt(d: Date): string {
  return (JSON.parse(JSON.stringify({ at: d })) as { at: string }).at;
}

/**
 * 反面教材：v2.7 用"本地字段拼串 + 假 Z"当时刻。原生按 UTC 解它，
 * 于是东八区机器上整体晚 8 小时。保留此函数专供单测证明它是错的。
 */
export function fakeLocalAt(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.000Z';
}
