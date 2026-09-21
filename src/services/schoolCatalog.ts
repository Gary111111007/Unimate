/**
 * 学校档案热更新（Net.md P2 / PRD 5.14）。
 *
 * 一句话："新增一所高校不用发新版 APK"。做法是**纯静态下发**：
 *   `catalog/index.json`（清单，**Ed25519 签名**）+ `catalog/<schoolId>.json`（档案，sha256 落在签名里）
 * 公钥硬编码在 APK（`src/catalog/schoolKey.ts`），验签不过一律拒收。
 *
 * 四条不可退让的口径：
 *  1) **验签是唯一信任来源**：清单签名不过 → 整份清单丢掉（连"已下载"的徽标都不刷新）；
 *     单份档案再用清单里的 sha256 校验字节；平台不支持 Ed25519 时**直接拒绝安装**（宁可没有热更新）。
 *  2) **域名白名单**：档案里的网址只允许 https，且不许 IP/localhost —— 这是防钓鱼的最后一道闸。
 *  3) **限频**：每天最多成功检查一次；失败后 5 分钟内不重试（避免每次打开选校页都发请求）。
 *  4) **降级**：拉不到就用 APK 内置的 53 所名单，用户无感；全程 guard() 超时、不阻塞界面。
 *
 * 这一层只做纯函数 + 两个 fetch；"什么时候检查、下载写到哪"由 store 决定（与 weather 同一套分工）。
 */
import { guard } from './guard.ts';
import { shareBase } from './share.ts';
import type { SchoolProfile } from '../types.ts';
import { verify as edVerify, etc as edEtc } from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { sha256 } from '@noble/hashes/sha256';
import { validateRulePack } from './parser/rules.ts';

/*
 * 【为什么验签是纯 JS 实现，而不是用平台自带的 WebCrypto】
 * 规范（Net.md 2.3）要求"公钥内置 + 验签失败即拒收"。第一版用 WebCrypto 的 ECDSA 实现，
 * 结果**真机（2026-09-21，产品负责人手机）直接显示"当前系统的 WebCrypto 用不了 ECDSA 验签"**：
 * 安卓 WebView 的实现差异（`importKey('raw', …)` 这类较晚才支持的用法）会让功能在部分机型上整体不可用。
 * 隔离实验还证明：明文 http 下 `crypto.subtle` 根本不存在（WebCrypto 只在安全上下文可用）。
 * 结论：**不要把安身立命的能力押在平台密码学上** —— 改用 @noble/ed25519（纯 JS、无二级依赖、社区审计），
 * 算法回到规范原本写的 Ed25519，SHA-256/512 也用 @noble/hashes 纯 JS 算。
 * 这样在任何 WebView 上行为完全一致：能验就是能验，验不过就是拒收，不存在"这台机器不支持"的第三种结局。
 */
edEtc.sha512Sync = (...m: Uint8Array[]): Uint8Array => sha512(edEtc.concatBytes(...m));

/** 清单格式版本：App 只认自己支持的版本，更高的一律拒收（提示升级 App） */
export const CATALOG_SCHEMA = 1;
/** 每天最多成功检查一次 */
export const CATALOG_OK_MS = 24 * 60 * 60 * 1000;
/** 失败后的退避：这段时间内不重复请求 */
export const CATALOG_RETRY_MS = 5 * 60 * 1000;

export interface CatalogEntry {
  id: string;
  name: string;
  shortName: string;
  province: string;
  status: 'live' | 'developing';
  /** 校名拼音首字母（分组用）；远端档案自带，App 不猜拼音 */
  letter: string;
  /** 在内置名单里的名次；新高校由档案自己给 */
  order: number;
  /** 档案版本：比内置的大才算「可更新」 */
  version: number;
  file: string;
  sha256: string;
  size: number;
}

/**
 * 解析适配器规则包（Net.md P2.5 / PRD 5.15）：与学校档案**共用同一份签名清单**，
 * 所以限频、验签、失败降级全都不需要再来一套。文件放在站点的 `/adapters/` 下。
 */
export interface AdapterEntry {
  id: string;
  kind: 'timetable' | 'exam';
  version: number;
  file: string;
  sha256: string;
  size: number;
  note: string;
}

export interface CatalogIndex { schemaVersion: number; updatedAt: string; schools: CatalogEntry[]; adapters: AdapterEntry[] }

/** 选校页渲染用的行（内置 + 远端 + 已下载 合成后的结果） */
export interface DownloadedMeta {
  version: number;
  name?: string;
  shortName?: string;
  province?: string;
  order?: number;
  letter?: string;
}

export interface SchoolRow {
  schoolId: string;
  name: string;
  shortName: string;
  province: string;
  letter: string;
  order: number;
  /** 本机有档案（内置 live 或已下载）→ 可以直接进 */
  usable: boolean;
  builtin: boolean;
  remote: boolean;
  downloaded: boolean;
  /** 远端版本比本机的大 → 显示「可更新」 */
  updatable: boolean;
  version: number;
}

// ---------------- 纯函数：限频与地址 ----------------

/**
 * 该不该发这次"检查清单"的请求。
 * 成功过 → 24 小时内不再检查；失败过 → 5 分钟内不再重试；force（用户点「检查更新」）除外。
 */
export function catalogCheckAllowed(o: { lastOkAt: number; lastTryAt: number; now?: number; force?: boolean }): boolean {
  if (o.force) return true;
  const now = o.now === undefined ? Date.now() : o.now;
  const tryAt = Number(o.lastTryAt) || 0;
  const okAt = Number(o.lastOkAt) || 0;
  if (tryAt && now - tryAt < CATALOG_RETRY_MS) return false;
  if (okAt && now - okAt < CATALOG_OK_MS) return false;
  return true;
}

/** 站点根 → 下发文件地址（Capacitor 里是 https://localhost，share.ts 已统一换回公网站点） */
export function catalogUrl(file: string, base?: string): string {
  const b = base || shareBase();
  return b.replace(/\/+$/, '') + '/catalog/' + file;
}

/** 规则包地址：`/adapters/<file>`（Net.md 3.3 的目录约定） */
export function adapterUrl(file: string, base?: string): string {
  const b = base || shareBase();
  return b.replace(/\/+$/, '') + '/adapters/' + file;
}

// ---------------- 纯函数：结构与域名校验 ----------------

/** 下发网址的唯一白名单规则：https + 非 IP/localhost */
export function urlAllowed(u: unknown): boolean {
  let url: URL;
  try { url = new URL(String(u)); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':') || /^(localhost|127\.|0\.0\.0\.0)/i.test(host)) return false;
  return true;
}

function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : NaN }

export function parseCatalogEntry(x: any): CatalogEntry | null {
  if (!x || typeof x !== 'object') return null;
  const id = String(x.id || '');
  if (!/^[a-z][a-z0-9-]{1,15}$/.test(id)) return null;
  if (x.status !== 'live' && x.status !== 'developing') return null;
  if (!x.name || !x.shortName || !x.province) return null;
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(String(x.file || ''))) return null;
  if (!/^[0-9a-f]{64}$/i.test(String(x.sha256 || ''))) return null;
  const version = num(x.version);
  const order = num(x.order);
  if (!(version >= 1) || !Number.isFinite(order)) return null;
  return {
    id, name: String(x.name), shortName: String(x.shortName), province: String(x.province),
    status: x.status, letter: String(x.letter || '').slice(0, 2) || String(x.name).slice(0, 1),
    order, version, file: String(x.file), sha256: String(x.sha256).toLowerCase(), size: num(x.size) || 0
  };
}

export function parseAdapterEntry(x: any): AdapterEntry | null {
  if (!x || typeof x !== 'object') return null;
  const id = String(x.id || '');
  if (!/^[a-z][a-z0-9-]{2,31}$/.test(id)) return null;
  if (x.kind !== 'timetable' && x.kind !== 'exam') return null;
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(String(x.file || ''))) return null;
  if (!/^[0-9a-f]{64}$/i.test(String(x.sha256 || ''))) return null;
  if (!(Number(x.version) >= 1)) return null;
  return {
    id, kind: x.kind, version: Number(x.version), file: String(x.file),
    sha256: String(x.sha256).toLowerCase(), size: Number(x.size) || 0, note: String(x.note || '')
  };
}

/**
 * 解析清单。**schemaVersion 比 App 支持的更高 → 返回 null**（而不是硬着头皮用）：
 * 新版清单可能有 App 看不懂的字段，装作能用才是真危险。
 */
export function parseCatalogIndex(json: any): CatalogIndex | null {
  if (!json || typeof json !== 'object') return null;
  const sv = num(json.schemaVersion);
  if (!(sv >= 1) || sv > CATALOG_SCHEMA) return null;
  if (!Array.isArray(json.schools)) return null;
  const seen = new Set<string>();
  const schools: CatalogEntry[] = [];
  for (const raw of json.schools) {
    const e = parseCatalogEntry(raw);
    if (!e || seen.has(e.id)) return null;          // 清单里有一行不合法 → 整份拒收（签名只保证"没被人改"，不保证"写的人没写错"）
    seen.add(e.id);
    schools.push(e);
  }
  // 规则包列表：旧版清单里没有这个字段 → 当成空数组（向后兼容）
  const adapters: AdapterEntry[] = [];
  if (json.adapters !== undefined) {
    if (!Array.isArray(json.adapters)) return null;
    const seenA = new Set<string>();
    for (const raw of json.adapters) {
      const a = parseAdapterEntry(raw);
      if (!a || seenA.has(a.id)) return null;
      seenA.add(a.id);
      adapters.push(a);
    }
  }
  return { schemaVersion: sv, updatedAt: String(json.updatedAt || ''), schools, adapters };
}

/** 档案结构校验（含域名白名单）。返回错误原因，空串 = 通过。 */
export function profileProblem(p: any, expectedId: string): string {
  if (!p || typeof p !== 'object') return '档案不是对象';
  if (p.schoolId !== expectedId) return '档案里的 schoolId 与清单不一致';
  if (!/^[a-z][a-z0-9-]{1,15}$/.test(String(p.schoolId))) return 'schoolId 不合法';
  // 只安装"核实过、可对外说已支持"的档案：开发中的高校不许借热更新混进来
 if (p.dataDir !== 'schools/' + expectedId) return 'dataDir 与 schoolId 对不上';
  if (!(Number(p.profileVersion) >= 1)) return 'profileVersion 不合法';
  if (p.status !== 'live') return '档案状态不是 live（没核实过的不许安装）';
  if (!p.name || !p.shortName || !p.province) return '缺 name/shortName/province';
  if (!p.academic || !Array.isArray(p.academic.periodTimes) || p.academic.periodTimes.length !== Number(p.academic.periodCount)) {
    return '节次表与 periodCount 对不上';
  }
  const urls: Array<[string, unknown]> = [
    ['教务系统', p.systems && p.systems.jwglxtUrl],
    ['课表页', p.systems && p.systems.timetableUrl],
    ['在线平台', p.systems && p.systems.onlinePlatformUrl]
  ];
  for (const c of (Array.isArray(p.campusApps) ? p.campusApps : [])) {
    urls.push(['校园入口 ' + String(c && c.name), c && c.url]);
  }
  for (const pair of urls) {
    if (!pair[1] || !urlAllowed(pair[1])) return pair[0] + ' 的网址不允许（只允许 https 且非 IP）';
  }
  return '';
}

// ---------------- 纯函数：合并成选校页的行 ----------------

/**
 * 内置名单 + 远端清单 + 已下载 合并成选校页要显示的行。
 * 规则：
 *  - 内置 live 高校永远可用；远端有更新版本（version > 内置版本）且还没下载 → updatable；
 *  - 远端独有的高校（新高校）：只有**下载后**才 usable，之前只显示「可下载」；
 *  - 已下载的：usable，且不再提示"可更新"（用户已经拿到那一版了）。
 */
export function mergeSchoolRows(
  builtin: Array<{ schoolId: string; name: string; shortName: string; province: string; status: string; letter: string; order: number }>,
  builtinVersions: Record<string, number>,
  remote: CatalogIndex | null,
  downloaded: Record<string, number | DownloadedMeta>
): SchoolRow[] {
  /** 已下载的元信息：允许只给版本号（测试里省事），缺字段时用 id 兜底 */
  const metaOf = (id: string): DownloadedMeta => {
    const d = downloaded[id];
    return typeof d === 'number' ? { version: d } : (d || { version: 0 });
  };
  const rows: SchoolRow[] = [];
  const remoteById = new Map<string, CatalogEntry>();
  for (const e of (remote ? remote.schools : [])) remoteById.set(e.id, e);
  for (const b of builtin) {
    const r = remoteById.get(b.schoolId);
    const dl = Object.prototype.hasOwnProperty.call(downloaded, b.schoolId);
    const localVersion = (dl ? metaOf(b.schoolId).version : 0) || builtinVersions[b.schoolId] || 0;
    rows.push({
      schoolId: b.schoolId, name: b.name, shortName: b.shortName, province: b.province,
      letter: b.letter || '', order: b.order,
      usable: b.status === 'live' || dl,
      builtin: b.status === 'live', remote: !!r, downloaded: dl,
      updatable: !!r && r.version > localVersion,
      version: localVersion
    });
    remoteById.delete(b.schoolId);
  }
  for (const e of remoteById.values()) {
    const dl = Object.prototype.hasOwnProperty.call(downloaded, e.id);
    rows.push({
      schoolId: e.id, name: e.name, shortName: e.shortName, province: e.province,
      letter: e.letter, order: e.order,
      usable: dl && e.status === 'live',
      builtin: false, remote: true, downloaded: dl,
      // 远端独有的学校：没下载就是「可下载」，下载完就是「已下载」
      updatable: !dl && e.status === 'live',
      version: dl ? metaOf(e.id).version : 0
    });
  }
  /*
   * 兜底：**已经下载、但远端清单里没有**的学校也要显示出来。
   * 真实场景：用户下完某校档案，后来清单缓存被清掉（或那次检查验签失败被拒收），
   * 若不兜底，这所高校就从选校页上"凭空消失"，而它的档案其实还在本机 —— 用户会以为丢了。
   */
  for (const id of Object.keys(downloaded)) {
    if (rows.some((r) => r.schoolId === id)) continue;
    const m = metaOf(id);
    rows.push({
      schoolId: id, name: m.name || id, shortName: m.shortName || m.name || id, province: m.province || '',
      letter: m.letter || '#', order: typeof m.order === 'number' ? m.order : 899,
      usable: true, builtin: false, remote: false, downloaded: true, updatable: false, version: m.version
    });
  }
  return rows.sort((a, b) => a.order - b.order || a.schoolId.localeCompare(b.schoolId));
}

// ---------------- 验签（Ed25519，纯 JS 实现） ----------------

function b64urlToBytes(s: string): Uint8Array {
  const t = String(s || '').trim().replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (t.length % 4)) % 4;
  const bin = atob(t + '='.repeat(pad));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type VerifyResult = 'ok' | 'bad-signature';

/**
 * 用硬编码公钥验签（Ed25519：公钥 32 字节、签名 64 字节），纯 JS 计算，**不依赖 WebCrypto**。
 * 注意：**没有任何"跳过验签"的开关** —— 任何解析/验签异常都当 'bad-signature' 处理，
 * 调用方据此拒收（检验不了就不装）。
 */
export async function verifySignature(bytes: Uint8Array, sigB64: string, pubB64: string): Promise<VerifyResult> {
  try {
    const pub = b64urlToBytes(pubB64);
    const sig = b64urlToBytes(sigB64);
    // 长度先卡死：Ed25519 公钥必须 32 字节、签名必须 64 字节
    if (pub.length !== 32) return 'bad-signature';
    if (sig.length !== 64) return 'bad-signature';
    return edVerify(sig, bytes, pub) ? 'ok' : 'bad-signature';
  } catch {
    return 'bad-signature';
  }
}

/** 只用于"档案 sha256 与签名清单一致"这一层（纯 JS，任何环境结果都一样） */
export async function sha256Hex(text: string): Promise<string> {
  const out = sha256(new TextEncoder().encode(text));
  return [...out].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 文件里的 BOM/CRLF 会改变字节 → 验签与 sha256 之前先归一化 */
function normalize(text: string): string {
  return String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

// ---------------- 两个 fetch（都由调用方决定何时触发） ----------------

export type FetchCatalogResult = { ok: true; index: CatalogIndex } | { ok: false; reason: string };

/** 拉清单 → 验签 → 解析。任何一步不过都返回 ok:false（调用方保留旧缓存/内置名单） */
export async function fetchCatalog(pubB64: string, base?: string): Promise<FetchCatalogResult> {
  try {
    // 连 HTTP 状态与 content-type 一起拿回来：站点"还没部署 catalog/"和"清单被人改过"必须给不同的文案，
    // 否则用户（和验收的人）会以为站点被投毒了，其实只是没上传（真机验收时就是这么误报的）。
    const grab = (u: string) => fetch(u).then(async (r: any) => ({
      ok: !!r.ok,
      type: String((r.headers && r.headers.get && r.headers.get('content-type')) || ''),
      text: await r.text()
    }));
    const res: any = await guard('拉学校清单', Promise.all([
      grab(catalogUrl('index.json', base)),
      grab(catalogUrl('index.json.sig', base))
    ]), 8000, null);
    if (!res) return { ok: false, reason: '拉取超时或断网' };
    const a = res[0] || { ok: false, type: '', text: '' };
    const b = res[1] || { ok: false, type: '', text: '' };
    /** 静态托管对未知路径常回落到首页（200 + text/html）——那是"还没部署"，不是"签名不对" */
    const looksHtml = (x: any) => /text\/html/i.test(x.type) || /^\s*<(!doctype|html)/i.test(String(x.text || ''));
    if ((a.ok && looksHtml(a)) || (b.ok && looksHtml(b))) {
      return { ok: false, reason: '站点上还没有下发清单（取回来的是网页而不是 JSON）：多半是演示站还没部署 catalog/ 目录' };
    }
    if (!a.ok && !b.ok) return { ok: false, reason: '站点上没有清单或签名文件（HTTP 404）：还没部署，或部署的路径不对' };
    if (!a.ok || !b.ok) return { ok: false, reason: '站点上的清单与签名文件不齐（一个在、一个不在），已跳过' };
    const indexText = normalize(a.text);
    const sigText = String(b.text || '').trim();
    if (!indexText || !sigText) return { ok: false, reason: '站点上没有清单或签名文件' };
    const v = await verifySignature(new TextEncoder().encode(indexText), sigText, pubB64);
    if (v !== 'ok') return { ok: false, reason: '签名校验失败：这份清单不是官方发布的，已拒收' };
    let json: any;
    try { json = JSON.parse(indexText); } catch { return { ok: false, reason: '清单不是合法 JSON' }; }
    const index = parseCatalogIndex(json);
    if (!index) return { ok: false, reason: '清单格式不受支持（可能是给更新版 App 的），已跳过' };
    return { ok: true, index };
  } catch (e: any) {
    return { ok: false, reason: '拉取失败：' + ((e && e.message) || e) };
  }
}

export type DownloadResult = { ok: true; profile: SchoolProfile; version: number } | { ok: false; reason: string };

/**
 * 下载一份解析规则包：sha256 必须与签名清单一致 → 再走 `validateRulePack`（键白名单 + 正则可编译 + 取值）。
 * 规则包**不含任何可执行代码**，最坏情况只是"读得更多/更少"，这也是 Net.md 2.4 划的红线。
 */
export async function downloadAdapterPack(entry: AdapterEntry, base?: string): Promise<{ ok: true; pack: any } | { ok: false; reason: string }> {
  try {
    const text: any = await guard('下载解析规则包', fetch(adapterUrl(entry.file, base)).then((r) => r.text()), 8000, null);
    if (text === null || text === undefined) return { ok: false, reason: '下载超时或断网' };
    const norm = normalize(String(text));
    const got = await sha256Hex(norm);
    if (got !== entry.sha256.toLowerCase()) return { ok: false, reason: '校验和不一致（文件被改过），已拒收' };
    let json: any;
    try { json = JSON.parse(norm); } catch { return { ok: false, reason: '规则包不是合法 JSON' }; }
    const v = validateRulePack(json);
    if (!v.ok) return { ok: false, reason: '规则包不合格：' + v.error };
    if (v.pack.adapterId !== entry.id) return { ok: false, reason: '规则包的 adapterId 与清单不一致' };
    if (v.pack.kind !== entry.kind) return { ok: false, reason: '规则包的 kind 与清单不一致' };
    if (v.pack.version !== entry.version) return { ok: false, reason: '规则包版本与清单不一致' };
    return { ok: true, pack: v.pack };
  } catch (e: any) {
    return { ok: false, reason: '下载失败：' + ((e && e.message) || e) };
  }
}

/** 下载单份档案 → sha256 必须与签过名的清单一致 → 结构/域名校验 */
export async function downloadSchoolProfile(entry: CatalogEntry, base?: string): Promise<DownloadResult> {
  try {
    const text: any = await guard('下载学校档案', fetch(catalogUrl(entry.file, base)).then((r) => r.text()), 8000, null);
    if (text === null || text === undefined) return { ok: false, reason: '下载超时或断网' };
    const norm = normalize(String(text));
    const got = await sha256Hex(norm);
    if (got !== entry.sha256.toLowerCase()) return { ok: false, reason: '校验和不一致（文件被改过），已拒收' };
    let json: any;
    try { json = JSON.parse(norm); } catch { return { ok: false, reason: '档案不是合法 JSON' }; }
    const prob = profileProblem(json, entry.id);
    if (prob) return { ok: false, reason: '档案不合格：' + prob };
    if (Number(json.profileVersion) !== entry.version) return { ok: false, reason: '档案版本与清单不一致，已拒收' };
    return { ok: true, profile: json as SchoolProfile, version: entry.version };
  } catch (e: any) {
    return { ok: false, reason: '下载失败：' + ((e && e.message) || e) };
  }
}
