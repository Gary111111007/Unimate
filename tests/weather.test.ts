// 天气（Net.md P0 / PRD 5.13）单测：**完全不联网** —— 只测拼 URL、解析真实响应形状、文案与缓存判定。
// 三条口径都要在这里钉住：免 Key、请求里只有坐标、**默认关闭时一次请求都不发**。
// 「关着不发请求」既有真·行为断言（用打桩的 fetch 数调用次数），也有结构断言兜底
// （界面里不许有第二个地方绕开 store 直接发请求）。
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  weatherUrl, geocodeUrl, parseWeather, parseGeocode, weatherLabel, isBadWeather, weatherText, isStale,
  weatherTip, shouldRequestWeather, agoText, firstFulfilled, WEATHER_TTL_MS
} from '../src/services/weather.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? ' -> ' + extra : ''));
}

console.log('--- 请求地址：免 Key、只带坐标 ---');
const u = weatherUrl(39.9586, 116.132);
ok('用 Open-Meteo', u.startsWith('https://api.open-meteo.com/v1/forecast?'), u);
ok('只带经纬度与字段，没有 key/token/api_key', !/key=|token|api_key/i.test(u), u);
ok('坐标四舍五入到 4 位（不泄露更精确的位置）', u.includes('latitude=39.9586') && u.includes('longitude=116.1320'), u);
ok('带时区与今日字段', u.includes('timezone=auto') && u.includes('temperature_2m_max'), u);
ok('城市名会被 URL 编码', geocodeUrl('北京 朝阳').includes('%20') && geocodeUrl('北京 朝阳').startsWith('https://geocoding-api.open-meteo.com/'), geocodeUrl('北京 朝阳'));
ok('城市接口同样免 Key', !/key=|token/i.test(geocodeUrl('beijing')), '');

console.log('\n--- 解析 Open-Meteo 的真实响应形状 ---');
const real = {
  latitude: 39.95, longitude: 116.13, timezone: 'Asia/Shanghai',
  current: { time: '2026-09-21T10:00', temperature_2m: 21.4, weather_code: 3 },
  daily: { temperature_2m_max: [26.1], temperature_2m_min: [14.8] }
};
const w = parseWeather(real, 1000)!;
ok('能解出来', !!w);
ok('当前温度', w.temp === 21.4, String(w.temp));
ok('今日最高/最低', w.tmax === 26.1 && w.tmin === 14.8, w.tmax + '/' + w.tmin);
ok('天气码映射成中文', w.code === 3 && w.label === '阴', w.label);
ok('记录拉取时间', w.fetchedAt === 1000, String(w.fetchedAt));
ok('展示文案可读', weatherText(w) === '21° 阴 · 15°/26°', weatherText(w));

console.log('\n--- 异常与降级：不抛异常、返回 null ---');
ok('空对象 → null', parseWeather({}) === null);
ok('缺 current → null', parseWeather({ daily: { temperature_2m_max: [20], temperature_2m_min: [10] } }) === null);
ok('温度不是数字 → null', parseWeather({ current: { temperature_2m: 'x', weather_code: 1 } }) === null);
ok('null/undefined 不炸', parseWeather(null) === null && parseWeather(undefined) === null);
{
  const noDaily = parseWeather({ current: { temperature_2m: 20, weather_code: 0 } }, 0)!;
  ok('没有 daily 时最高/最低退回当前温度', noDaily.tmax === 20 && noDaily.tmin === 20, noDaily.tmax + '/' + noDaily.tmin);
}
ok('未知天气码有兜底文案', weatherLabel(1234) === '未知', weatherLabel(1234));
ok('识别"要带伞"的天气', isBadWeather(61) && isBadWeather(95) && !isBadWeather(1) && !isBadWeather(0));

console.log('\n--- 缓存 30 分钟 ---');
ok('刚拉的不算过期', isStale(w, 1000 + 60_000) === false);
ok('超过 30 分钟算过期', isStale(w, 1000 + 31 * 60_000) === true);
ok('没有数据算过期', isStale(null) === true);
ok('过期窗口与请求节流是同一个常量', WEATHER_TTL_MS === 30 * 60 * 1000, String(WEATHER_TTL_MS));

console.log('\n--- 开关与节流：关着一次都不发 ---');
ok('关着 → 不请求（就算手动 force）', shouldRequestWeather({ enabled: false, lastTryAt: 0, force: true }) === false);
ok('关着 + 很久以前拉过 → 还是不请求', shouldRequestWeather({ enabled: false, lastTryAt: 1000, now: 10_000_000 }) === false);
ok('打开 + 从没拉过 → 请求', shouldRequestWeather({ enabled: true, lastTryAt: 0, now: WEATHER_TTL_MS + 1 }) === true);
ok('打开 + 5 分钟前拉过 → 不请求', shouldRequestWeather({ enabled: true, lastTryAt: 0, now: 5 * 60_000 }) === false);
ok('打开 + 正好 30 分钟 → 请求', shouldRequestWeather({ enabled: true, lastTryAt: 0, now: WEATHER_TTL_MS }) === true);
ok('打开 + 手动点「立即更新」→ 请求（绕过节流）', shouldRequestWeather({ enabled: true, lastTryAt: 1, force: true, now: 2 }) === true);

console.log('\n--- 相对时间与带伞提示 ---');
ok('一分钟内 = 刚刚', agoText(1000, 1000) === '刚刚', agoText(1000, 1000));
ok('12 分钟前', agoText(0, 12 * 60_000) === '12 分钟前', agoText(0, 12 * 60_000));
ok('3 小时前', agoText(0, 3 * 60 * 60_000) === '3 小时前', agoText(0, 3 * 60 * 60_000));
ok('2 天前', agoText(0, 2 * 24 * 60 * 60_000) === '2 天前', agoText(0, 2 * 24 * 60 * 60_000));
ok('钟表回拨（时间在未来）也不会出现负数', agoText(60_000, 0) === '刚刚', agoText(60_000, 0));
ok('下雨/下雪才提示带伞', weatherTip(61) === '记得带伞' && weatherTip(95) === '记得带伞' && weatherTip(0) === '' && weatherTip(3) === '', weatherTip(3));

console.log('\n--- 定位两路并发：先成功者胜（不能用 Promise.race） ---');
{
  const slow = (ms: number, v: string) => new Promise<string>((r) => setTimeout(() => r(v), ms));
  const bad = (ms: number) => new Promise<string>((_, j) => setTimeout(() => j(new Error('no')), ms));
  ok('第一路先成功 → 用第一路', (await firstFulfilled([slow(1, 'net'), slow(5, 'gps')])) === 'net');
  ok('第一路失败、第二路成功 → 用第二路（race 会在这里判死）', (await firstFulfilled([bad(1), slow(5, 'gps')])) === 'gps');
  ok('两路都失败 → null', (await firstFulfilled([bad(1), bad(2)])) === null);
  ok('空数组 → null', (await firstFulfilled([])) === null);
}

console.log('\n--- 城市转坐标 ---');
ok('标准响应能解', JSON.stringify(parseGeocode({ results: [{ name: '北京', latitude: 39.9, longitude: 116.4 }] })) === JSON.stringify({ name: '北京', lat: 39.9, lon: 116.4 }));
ok('没有结果 → null', parseGeocode({ results: [] }) === null && parseGeocode({}) === null);

console.log('\n--- 口径：默认关闭、不经第三方、Key 不进前端 ---');
const src = readFileSync(join(root, 'src', 'services', 'weather.ts'), 'utf8');
ok('只用 Open-Meteo（无其他第三方域名）', (src.match(/https:\/\/[a-z0-9.-]+/g) || []).every((h) => h.includes('open-meteo.com')), (src.match(/https:\/\/[a-z0-9.-]+/g) || []).join(','));
ok('没有硬编码密钥', !/api[_-]?key\s*[:=]\s*['"]/i.test(src), '');
ok('请求都包了 guard 超时（不许卡界面）', (src.match(/guard\(/g) || []).length >= 2, String((src.match(/guard\(/g) || []).length));
ok('服务层自己不发请求（默认关闭由界面判断，服务层只提供函数）', !/^\s*(setInterval|setTimeout)\(/m.test(src), '');

/*
 * 真·行为断言：默认关闭时**一次请求都不发**。
 * 环境桩与 tests/login.test.ts 同一套（store 依赖 localStorage / document / fetch）。
 * 这里用打桩的 fetch 数调用次数 —— 比"看源码里有没有某个字符串"硬得多。
 */
console.log('\n--- 真·行为：关着的时候一次请求都不发（打桩 fetch 数调用次数）---');
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear()
};
const ctxStub: any = { fillRect() {}, beginPath() {}, arc() {}, fill() {}, fillText() {}, drawImage() {}, measureText: () => ({ width: 10 }), save() {}, restore() {}, createLinearGradient: () => ({ addColorStop() {} }) };
(globalThis as any).document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub, toDataURL: () => 'data:image/jpeg;base64,AAAA' }),
  addEventListener() {}, documentElement: { style: {} }
};
(globalThis as any).window = globalThis;
(globalThis as any).location = { href: 'https://localhost/', origin: 'https://localhost' };
const calls: string[] = [];
(globalThis as any).fetch = async (u: any) => {
  const url = String(u);
  calls.push(url);
  if (url.includes('geocoding-api')) return { ok: true, json: async () => ({ results: [{ name: '北京', latitude: 39.9, longitude: 116.4 }] }) };
  return {
    ok: true,
    json: async () => ({ current: { temperature_2m: 21.4, weather_code: 3 }, daily: { temperature_2m_max: [26.1], temperature_2m_min: [14.8] } })
  };
};
const { createPinia, setActivePinia } = await import('pinia');
const dbMod = await import('../src/stores/db.ts');
setActivePinia(createPinia());
const wdb = dbMod.useDb();
ok('新账号的设置里天气默认关闭', wdb.settings.weatherEnabled === false);
ok('默认没有任何天气缓存', wdb.settings.weatherNow === null && wdb.settings.weatherLoc === null && wdb.settings.weatherTriedAt === 0);
// 先把"闸门一旦失效就必然会发请求"的条件铺好（手填城市 + force），再断言一条请求都没有
wdb.settings.weatherCity = '北京';
await wdb.ensureWeather(true);
ok('关着时 ensureWeather(force=true) 也不发任何请求', calls.length === 0, calls.join(' | '));

wdb.settings.weatherEnabled = true;
await wdb.ensureWeather(true);
ok('打开后：先按城市名查坐标，再查天气', calls.some((u) => u.includes('geocoding-api.open-meteo.com')) && calls.some((u) => u.includes('/v1/forecast')), calls.join(' | '));
ok('两类请求都不带 Key/Token', calls.every((u) => !/key=|token/i.test(u)), calls.join(' | '));
ok('结果缓存进本机设置（断网时才有东西可显示）', !!wdb.settings.weatherNow && wdb.settings.weatherNow!.label === '阴' && wdb.settings.weatherLoc!.name === '北京');
ok('记下「已经试过」的时刻', wdb.settings.weatherTriedAt > 0, String(wdb.settings.weatherTriedAt));

const afterFirst = calls.length;
await wdb.ensureWeather();
ok('30 分钟内再进课表页：不再发请求', calls.length === afterFirst, calls.length + ' vs ' + afterFirst);
await wdb.ensureWeather(true);
ok('用户点「立即更新」：可以立刻重拉一次', calls.length > afterFirst, String(calls.length));
const afterForce = calls.length;
wdb.settings.weatherEnabled = false;
await wdb.ensureWeather(true);
ok('重新关掉后，force 也不发请求', calls.length === afterForce, String(calls.length));

// 接口失败时必须能降级：保留上次结果，界面照常有东西显示
console.log('\n--- 真·行为：接口失败只降级、不抛错 ---');
wdb.settings.weatherEnabled = true;
wdb.settings.weatherTriedAt = 0;
const good = wdb.settings.weatherNow;
(globalThis as any).fetch = async () => { throw new Error('offline'); };
await wdb.ensureWeather(true);
ok('拉不到时不抛错，且保留上次结果', wdb.settings.weatherNow === good && !!wdb.settings.weatherNow);
ok('失败也有可见文案（不静默）', wdb.weatherMsg.includes('没拉到天气'), wdb.weatherMsg);

console.log('\n--- 结构：界面不许绕开 store 直接发请求 ---');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const dbSrc = read('src/stores/db.ts');
const ttv = read('src/views/TimetableView.vue');
const mev = read('src/views/MeView.vue');
const styles = read('src/styles.css');
const vueFiles: string[] = [];
for (const dir of ['src/views', 'src/components', 'src/screens']) {
  for (const f of readdirSync(join(root, dir))) if (f.endsWith('.vue')) vueFiles.push(dir + '/' + f);
}
ok('设置默认值里 weatherEnabled = false', /weatherEnabled:\s*false/.test(dbSrc), '');
ok('发请求前必过 shouldRequestWeather 闸门', /async function ensureWeather[\s\S]{0,400}shouldRequestWeather\(/.test(dbSrc), '');
ok('先记「已经试过」再动手（挂起也不会被重复触发）', /weatherTriedAt = Date\.now\(\)[\s\S]{0,300}weatherLocation\(/.test(dbSrc), '');
ok('三个原生定位调用都包了 guard 超时', (dbSrc.match(/guard\('(查定位权限|申请定位权限|获取定位)'/g) || []).length >= 3, '');
ok('定位是网络 + 卫星两路并发', dbSrc.includes('enableHighAccuracy: false') && dbSrc.includes('enableHighAccuracy: true'), '');
ok('所有界面文件都没有直接调用 fetchWeather/geocode', vueFiles.every((f) => !/fetchWeather\(|geocode\(/.test(read(f))), vueFiles.filter((f) => /fetchWeather\(|geocode\(/.test(read(f))).join(','));
ok('课表页那一行只在开关打开且有数据时渲染', /v-if="wxNow"/.test(ttv) && /weatherEnabled \? db\.settings\.weatherNow : null/.test(ttv), '');
ok('课表页挂载时按节流拉一次', /void db\.ensureWeather\(\);/.test(ttv), '');
ok('点天气卡走的是节流版（不是 force）', /async function refreshWeather[\s\S]{0,400}db\.ensureWeather\(\);/.test(ttv), '');
ok('「我的 → 天气」入口存在', /open\('weather'\)/.test(mev), '');
ok('关着时「立即更新」按钮是禁用的（界面不撒谎）', /:disabled="db\.weatherBusy \|\| !db\.settings\.weatherEnabled"/.test(mev), '');
ok('改城市 / 开开关后保存会立刻拉一次，纯粹重复保存仍受节流', /const changed = [\s\S]{0,240}ensureWeather\(changed\)/.test(mev), '');
ok('隐私文案含 Net.md 指定原句', mev.includes('开启天气后会向 Open-Meteo 发送你的大致位置用于查询天气，不发送其他信息'), '');
ok('面板写明了「关着一次请求都不发」与「30 分钟最多更新一次」', mev.includes('一次请求都不发') && mev.includes('30 分钟最多更新一次'), '');
ok('天气条用的 CSS 变量在主题里有定义', ['--card', '--shadow', '--strong', '--muted', '--warn'].every((k) => styles.includes(k + ':')), '');
// 有了联网功能，登录页那句"不联网"就变成不实文案了；顺带修掉它指向的"清空本账号数据"（这个入口根本不存在）
// 2026-10-07：产品负责人删掉了登录页那段"会联网的功能"说明 —— 披露不再在登录页，上面几条已钉住「我的 → 关于」里的口径
const loginVue = read('src/screens/Login.vue');
ok('登录页不再声称"不联网"', !loginVue.includes('不联网') && !/会联网的功能/.test(loginVue), '');
ok('登录页不再指向不存在的「清空本账号数据」', !loginVue.includes('清空本账号数据'), '');
ok('禁用的按钮看起来就是禁用的（.btn:disabled 有样式）', /\.btn:disabled\s*\{[^}]*opacity/.test(styles), '');

console.log('\n结果：' + pass + ' 通过 / ' + fails.length + ' 失败');
for (const f of fails) console.log('  ✗ ' + f);
if (fails.length) process.exit(1);
