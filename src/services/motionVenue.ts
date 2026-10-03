import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { guard } from './guard.ts';
import { htmlText, parseHtmlTables, type CampusResult } from './campusData.ts';

export type VenueCellState = 'available' | 'occupied' | 'closed' | 'expired' | 'unknown';
export interface MotionVenue { id: string; campus: string; activity: string; label: string; detailUrl: string }
export interface VenueCell { court: string; status: string; state: VenueCellState }
export interface VenueSlot { time: string; courts: VenueCell[] }
export interface VenueStatus { venue: MotionVenue; date: string; place: string; slots: VenueSlot[] }

const BASE = 'https://motion.buct.edu.cn/changguanyuyue1/';
const ENTRY = BASE + 'xzxq.php';
const CACHE_KEY = 'unimate:campus:motion-cache-v1';
const allowedPaths = new Set(['/changguanyuyue1/xzxq.php','/changguanyuyue1/jinri_cpxq.php','/changguanyuyue1/jinri_dxq.php','/changguanyuyue1/jinri_cl.php','/changguanyuyue1/detail.php','/changguanyuyue1/detailBB.php','/changguanyuyue1/detail_cl.php']);

function allowedUrl(value: string, detailOnly = false): string | null {
  try {
    const url = new URL(value, BASE);
    if (url.origin !== new URL(BASE).origin || !allowedPaths.has(url.pathname)) return null;
    if (detailOnly && !/\/detail(?:BB|_cl)?\.php$/u.test(url.pathname)) return null;
    for (const [key, item] of url.searchParams) {
      if (!['XQ','xq','xm','d','c'].includes(key) || item.length > 120) return null;
    }
    url.hash = '';
    return url.toString();
  } catch { return null; }
}

async function getHtml(url: string, label: string): Promise<string> {
  if (!allowedUrl(url)) throw new Error('场馆地址不在只读白名单内');
  if (Capacitor.isNativePlatform()) {
    const fallback = { status: 0, data: '' } as any;
    const response = await guard(label, CapacitorHttp.get({ url, connectTimeout: 8000, readTimeout: 12000 }), 15000, fallback);
    if (response.status < 200 || response.status >= 300 || typeof response.data !== 'string') throw new Error('场馆服务暂时不可用（HTTP ' + response.status + '）');
    return response.data;
  }
  const response = await guard(label, fetch(url, { headers: { Accept: 'text/html' } }), 15000, null as Response | null);
  if (!response || !response.ok) throw new Error('场馆服务暂时不可用');
  return guard(label + '正文', response.text(), 8000, '');
}

function links(html: string, base: string): Array<{ url: string; label: string }> {
  const out: Array<{ url: string; label: string }> = [];
  for (const match of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu)) {
    const url = allowedUrl(new URL(match[1], base).toString());
    if (url) out.push({ url, label: htmlText(match[2]) });
  }
  return out;
}

function campusOf(url: string, label = ''): string {
  const value = new URL(url).searchParams.get('XQ') || new URL(url).searchParams.get('xq');
  if (value === '0' || /昌平/u.test(label)) return '昌平校区';
  if (value === '1' || /东校区/u.test(label)) return '东校区';
  return '未标注校区';
}

export async function discoverMotionVenues(): Promise<CampusResult<MotionVenue[]>> {
  try {
    const entry = await getHtml(ENTRY, '读取场馆入口');
    if (/统一认证|用户名|密码|验证码/u.test(htmlText(entry).slice(0, 1500))) throw new Error('公共场馆页跳到了登录页');
    const listing = links(entry, ENTRY).filter((item) => /jinri_(?:cpxq|dxq|cl)\.php/u.test(item.url)).slice(0, 8);
    const pages = listing.length ? listing : [{ url: BASE + 'jinri_cpxq.php?XQ=0', label: '昌平校区' }, { url: BASE + 'jinri_dxq.php?XQ=1', label: '东校区' }];
    const venueGroups = await Promise.all(pages.map(async (page) => {
      try {
        const body = await getHtml(page.url, '读取' + (page.label || '场馆目录'));
        return links(body, page.url).filter((item) => !!allowedUrl(item.url, true)).map((item) => {
          const parsed = new URL(item.url);
          const activity = parsed.searchParams.get('xm') || item.label || '运动项目';
          return { id: 'motion-' + encodeURIComponent(item.url).slice(-48), campus: campusOf(item.url, page.label), activity, label: item.label || activity, detailUrl: item.url };
        });
      } catch { return [] as MotionVenue[]; }
    }));
    const venues = [...new Map(venueGroups.flat().map((item) => [item.detailUrl, item])).values()];
    if (!venues.length) throw new Error('公共页面没有返回场馆目录');
    const result: CampusResult<MotionVenue[]> = { data: venues, quality: 'live', source: 'MOTION 公开页面', capturedAt: new Date().toISOString(), complete: true };
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(result)); } catch { /* cache optional */ }
    return result;
  } catch (error: any) {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') as CampusResult<MotionVenue[]> | null;
      if (cached?.data?.length) return { ...cached, quality: 'cached', complete: false, message: '实时更新失败，正在显示上次成功结果：' + String(error?.message || error) };
    } catch { /* no cache */ }
    throw error;
  }
}

function selectValues(html: string, name: string): Array<{ value: string; label: string; selected: boolean }> {
  const block = String(html).match(new RegExp("<select\\b[^>]*name\\s*=\\s*[\"']" + name + "[\"'][^>]*>([\\s\\S]*?)<\\/select>", 'iu'))?.[1] || '';
  return [...block.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/giu)].map((match) => ({
    value: match[1].match(/value\s*=\s*["']([^"']*)["']/iu)?.[1] || htmlText(match[2]),
    label: htmlText(match[2]), selected: /\bselected\b/iu.test(match[1])
  })).filter((item) => item.value);
}

function cellState(status: string): VenueCellState {
  if (/可预约|可用|空闲/u.test(status)) return 'available';
  if (/已预约|占用|上课|已满/u.test(status)) return 'occupied';
  if (/闭馆|停用|不可用/u.test(status)) return 'closed';
  if (/过期/u.test(status)) return 'expired';
  return 'unknown';
}

export async function queryMotionVenue(venue: MotionVenue, date: string): Promise<CampusResult<VenueStatus>> {
  const source = allowedUrl(venue.detailUrl, true);
  if (!source) throw new Error('场馆详情地址无效');
  const initial = await getHtml(source, '读取场馆状态');
  const dates = selectValues(initial, 'd');
  const places = selectValues(initial, 'c');
  const pickedDate = dates.some((item) => item.value === date) ? date : dates.find((item) => item.selected)?.value || dates[0]?.value || date;
  const pickedPlace = places.find((item) => item.selected)?.value || places[0]?.value || '';
  const target = new URL(source);
  if (pickedDate) target.searchParams.set('d', pickedDate);
  if (pickedPlace) target.searchParams.set('c', pickedPlace);
  const body = target.toString() === source ? initial : await getHtml(target.toString(), '刷新场馆状态');
  const tables = parseHtmlTables(body);
  const slots: VenueSlot[] = [];
  for (const table of tables) {
    if (table.length < 2) continue;
    const headers = table[0];
    for (const row of table.slice(1)) {
      const time = row[0] || '';
      if (!/^\d{1,2}:\d{2}\s*[-~至]\s*\d{1,2}:\d{2}$/u.test(time)) continue;
      const courts = row.slice(1).map((status, index) => ({ court: headers[index + 1] || '场地 ' + (index + 1), status, state: cellState(status) })).filter((item) => item.status);
      if (courts.length) slots.push({ time, courts });
    }
  }
  return { data: { venue, date: pickedDate, place: places.find((item) => item.value === pickedPlace)?.label || pickedPlace, slots }, quality: 'live', source: 'MOTION 公开页面', capturedAt: new Date().toISOString(), complete: slots.length > 0, message: slots.length ? undefined : '页面已读取，但没有识别到状态表；请以场馆原页面为准。' };
}
