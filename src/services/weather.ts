/**
 * 天气（PRD 5.13 / Net.md P0）。
 *
 * 这是 App 的**第一个真联网功能**，所以三条口径必须守住：
 *  1) **免 Key**：用 Open-Meteo（`api.open-meteo.com`），不注册、不带任何密钥 —— 也就不存在"Key 泄露"问题；
 *  2) **只发坐标**：请求里只有经纬度（或城市名转坐标），不带设备号/账号/课表；
 *  3) **默认关闭**：开关在"我的 → 天气"，关着的时候**一次请求都不发**（调用方负责判断）。
 *
 * 这里只做纯函数（拼 URL / 解析 / 文案映射），网络请求单独一个函数 —— 单测可以完全不联网。
 */
import { guard } from './guard.ts';

export interface WeatherNow {
  /** 当前温度 */
  temp: number;
  /** 今日最高 / 最低 */
  tmax: number;
  tmin: number;
  /** WMO 天气码与中文短文案 */
  code: number;
  label: string;
  /** 拉取时间（毫秒），界面用来显示"x 分钟前更新" */
  fetchedAt: number;
}

/** WMO Weather interpretation code → 中文短文案（Open-Meteo 官方文档里的码表，取常用几档） */
const WMO: Record<number, string> = {
  0: '晴', 1: '晴间多云', 2: '多云', 3: '阴',
  45: '雾', 48: '冻雾',
  51: '毛毛雨', 53: '小雨', 55: '中雨',
  56: '冻雨', 57: '冻雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  66: '冻雨', 67: '冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '阵雨', 81: '阵雨', 82: '强阵雨',
  85: '阵雪', 86: '强阵雪',
  95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '雷阵雨伴冰雹'
};

export function weatherLabel(code: number): string {
  return WMO[code] || '未知';
}

export function isBadWeather(code: number): boolean {
  return code >= 51;   // 下雨/下雪/雷暴：提醒带伞用得上
}

/** 恶劣天气提示；其余返回空串（界面上不要多一行废话） */
export function weatherTip(code: number): string {
  return isBadWeather(code) ? '记得带伞' : '';
}

/** 请求地址：只要坐标与"当前 + 今日"两个字段，带 timezone=auto 让服务端按当地时区算 */
export function weatherUrl(lat: number, lon: number): string {
  const la = Number(lat).toFixed(4);
  const lo = Number(lon).toFixed(4);
  return 'https://api.open-meteo.com/v1/forecast?latitude=' + la + '&longitude=' + lo
    + '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1';
}

/** 城市名 → 坐标（用户不肯给定位时手填城市；同样是 Open-Meteo 的免 Key 接口） */
export function geocodeUrl(city: string): string {
  return 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(city) + '&count=1&language=zh&format=json';
}

export function parseGeocode(json: any): { name: string; lat: number; lon: number } | null {
  const r = json && json.results && json.results[0];
  if (!r || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') return null;
  return { name: String(r.name || ''), lat: r.latitude, lon: r.longitude };
}

/** 解析 Open-Meteo 响应；形状不对返回 null（调用方降级到缓存/不显示，绝不抛到界面） */
export function parseWeather(json: any, now = Date.now()): WeatherNow | null {
  try {
    const c = json && json.current;
    const d = json && json.daily;
    const temp = c && Number(c.temperature_2m);
    const code = c && Number(c.weather_code);
    if (!Number.isFinite(temp) || !Number.isFinite(code)) return null;
    const tmax = d && Array.isArray(d.temperature_2m_max) ? Number(d.temperature_2m_max[0]) : NaN;
    const tmin = d && Array.isArray(d.temperature_2m_min) ? Number(d.temperature_2m_min[0]) : NaN;
    return { temp, code, label: weatherLabel(code), tmax: Number.isFinite(tmax) ? tmax : temp, tmin: Number.isFinite(tmin) ? tmin : temp, fetchedAt: now };
  } catch { return null; }
}

/** 一条展示文案：`12° 多云 · 8°/21°` */
export function weatherText(w: WeatherNow): string {
  return Math.round(w.temp) + '° ' + w.label + ' · ' + Math.round(w.tmin) + '°/' + Math.round(w.tmax) + '°';
}

/** 缓存与请求节流共用一个窗口：30 分钟内最多发一次请求（成功、失败都算） */
export const WEATHER_TTL_MS = 30 * 60 * 1000;
export function isStale(w: WeatherNow | null, now = Date.now()): boolean {
  return !w || now - w.fetchedAt > WEATHER_TTL_MS;
}

/**
 * **唯一**的"该不该发这次请求"判据（store 与界面都走它，不再各写一份）。
 * 关着的时候 force 也不行：手动点「立即更新」也只在开关打开后生效 ——
 * 产品负责人原话是"关着的时候一次请求都不发"，那就连手动也不许绕过去。
 */
export function shouldRequestWeather(opts: { enabled: boolean; lastTryAt: number; force?: boolean; now?: number }): boolean {
  if (!opts.enabled) return false;
  if (opts.force) return true;
  const now = opts.now === undefined ? Date.now() : opts.now;
  const last = Number(opts.lastTryAt) || 0;
  return now - last >= WEATHER_TTL_MS;
}

/** 相对时间：刚刚 / 12 分钟前 / 3 小时前 / 2 天前（界面上再拼"更新"两个字） */
export function agoText(ts: number, now = Date.now()): string {
  const d = Math.max(0, now - (Number(ts) || 0));
  const min = Math.floor(d / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const h = Math.floor(min / 60);
  if (h < 24) return h + ' 小时前';
  return Math.floor(h / 24) + ' 天前';
}

/**
 * 先成功者胜（全失败 → null）。
 * 定位是"网络定位与卫星定位两路并发、谁先回来用谁"，但不能用 Promise.race ——
 * 第一路失败就会把整个 race 判死（SecondClassView 早期就踩过这个）。
 */
export function firstFulfilled<T>(ps: Promise<T>[]): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let left = ps.length;
    let done = false;
    if (!left) { resolve(null); return; }
    for (const p of ps) {
      p.then(
        (v) => { if (!done) { done = true; resolve(v); } },
        () => { left--; if (!left && !done) resolve(null); }
      );
    }
  });
}

/**
 * 真正发请求（只在开关打开时由界面调用）。
 * 包 guard 超时：原生/网络卡住时不阻塞界面 —— 宁可不显示天气，也不许卡住启动或页面。
 */
export async function fetchWeather(lat: number, lon: number): Promise<WeatherNow | null> {
  try {
    const res = await guard('拉取天气', fetch(weatherUrl(lat, lon)).then((r) => r.json()), 6000, null as any);
    return parseWeather(res);
  } catch { return null; }
}

export async function geocode(city: string): Promise<{ name: string; lat: number; lon: number } | null> {
  try {
    const res = await guard('城市转坐标', fetch(geocodeUrl(city)).then((r) => r.json()), 6000, null as any);
    return parseGeocode(res);
  } catch { return null; }
}
