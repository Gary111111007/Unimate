/**
 * 课表分享（PRD 5.12，v2.23）。
 *
 * v2 二进制格式：比 v1 文本格式小约 30%，QR 版本从 ~30 降到 ~12-15。
 * 核心优化：中文课程名/教室从 UTF-8 3字节压缩为 2字节定长编码（ASCII 仍 1字节）。
 * 数据放在链接 # 片段里不上传服务器（同 v1）。不含教师姓名（同 v1）。
 * 解码先试 v2（首字节 0x02），再回退 v1 文本（向后兼容旧链接）。
 *
 * v2 二进制布局（紧凑 CJK 编码）：
 *   [0]       = 0x02 (版本魔数)
 *   [1]       = flags (bit0: hasDate)
 *   [2]       = nameLen (uint8, 字节数)
 *   [3..]     = 课表名（紧凑编码）
 *   [..+3]    = year-2000, month, day（hasDate 时，各 1B）
 *   [..+1]    = totalWeeks (uint8)
 *   [..+2]    = nameCount (uint16 LE)
 *   每个名字: [1B byteLen][紧凑编码字节]
 *   [..+2]    = roomCount (uint16 LE)
 *   每个教室: [1B byteLen][紧凑编码字节]
 *   [..+2]    = blockCount (uint16 LE)
 *   每个块:  [nameIdx:1][roomIdx:1][day:1][start:1][end:1][weeks:4B LE] = 9B
 *
 * 紧凑 CJK 编码规则：
 *   byte < 0x80  → ASCII 字符（1B）
 *   byte >= 0x80 → 双字节 CJK：cp = ((b1 - 0x80) << 8) + b2 + 0x2000
 *     覆盖 0x2000-0x9FFF（含 CJK 0x4E00-0x9FFF、通用标点、数字形式等）
 *   超出范围的字符 → 0xFF 转义 + 2B 大端 codepoint
 */

/**
 * 三种分隔符必须各管一层，否则字典项会被当成顶层字段切开（第一版就踩了这个坑，
 * 结果是"自己编的码自己解不开"——测试里第一条往返断言就直接红了）：
 *   SEP(0x1F) 顶层字段 | UNIT(0x1E) 字典项 | REC(0x1D) 课程块
 */
const SEP = String.fromCharCode(0x1f);
const UNIT = String.fromCharCode(0x1e);
const REC = String.fromCharCode(0x1d);

export interface SharedCourse {
  name: string; day: number; startPeriod: number; endPeriod: number; weeks: number[]; room: string;
}
export interface SharedTimetable {
  name: string; semesterStart: string; totalWeeks: number; courses: SharedCourse[];
}

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (b64.length % 4)) % 4;
  const bin = atob(b64 + "=".repeat(pad));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** base64url → 原始字节（v2 解码用） */
function b64ToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (b64.length % 4)) % 4;
  const bin = atob(b64 + "=".repeat(pad));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 原始字节 → base64url（v2 编码用） */
function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---- 紧凑 CJK 编码（中文 2B / ASCII 1B / 其他 3B 转义）----

/** 字符串 → 紧凑字节序列 */
function encodeCompact(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0) || 0;
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp >= 0x2000 && cp <= 0x9fff) {
      const v = cp - 0x2000;
      out.push(0x80 + (v >> 8));
      out.push(v & 0xff);
    } else {
      out.push(0xff);
      out.push((cp >> 8) & 0xff);
      out.push(cp & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** 紧凑字节序列 → 字符串 */
function decodeCompact(bytes: Uint8Array, start: number, end: number): string {
  let s = "";
  let i = start;
  while (i < end) {
    const b = bytes[i];
    if (b === 0xff && i + 2 < end) {
      s += String.fromCharCode((bytes[i + 1] << 8) | bytes[i + 2]);
      i += 3;
    } else if (b >= 0x80 && i + 1 < end) {
      s += String.fromCharCode(((b - 0x80) << 8) + bytes[i + 1] + 0x2000);
      i += 2;
    } else {
      s += String.fromCharCode(b);
      i += 1;
    }
  }
  return s;
}

/** 解析 YYYY-MM-DD → [year-2000, month, day] 或 null */
function parseDate3(s: string): [number, number, number] | null {
  const m = (s || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 2000 || y > 2255 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return [y - 2000, mo, d];
}

/** [year-2000, month, day] → YYYY-MM-DD */
function formatDate3(y2k: number, mo: number, d: number): string {
  return (2000 + y2k) + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}

/** 周次 → 位图（第 1 周 = 最低位），再用 36 进制压短 */
export function weeksToBits(weeks: number[]): string {
  let bits = 0;
  for (const w of weeks) if (w >= 1 && w <= 32) bits |= (1 << (w - 1));
  return bits.toString(36);
}

/** 位图 → 周次数组 */
export function bitsToWeeks(s: string): number[] {
  if (!/^[0-9a-z]{1,8}$/.test(String(s || ""))) return [];
  const bits = parseInt(s, 36);
  const out: number[] = [];
  if (!Number.isFinite(bits)) return out;
  for (let w = 1; w <= 32; w++) if (bits & (1 << (w - 1))) out.push(w);
  return out;
}

function dict(list: string[]): string[] { return Array.from(new Set(list.map((x) => String(x || "")))); }

// ---- v1 文本编解码（保留用于向后兼容旧链接）----

export function encodeTimetable(t: SharedTimetable): string {
  const names = dict(t.courses.map((c) => c.name));
  const rooms = dict(t.courses.map((c) => c.room || ""));
  const body = t.courses.map((c) => [
    names.indexOf(c.name), rooms.indexOf(c.room || ""), c.day, c.startPeriod, c.endPeriod, weeksToBits(c.weeks)
  ].join(",")).join(REC);
  return b64urlEncode([
    "U1", t.name || "", t.semesterStart || "", t.totalWeeks || 18,
    names.join(UNIT), rooms.join(UNIT), body
  ].join(SEP));
}

// ---- v2 二进制编解码（更小，QR 更简洁）----

const V2_MAGIC = 0x02;
const V2_FLAG_DATE = 0x01;

export function encodeTimetableV2(t: SharedTimetable): string {
  const names = dict(t.courses.map((c) => c.name));
  const rooms = dict(t.courses.map((c) => c.room || ""));
  const nameIdx = (n: string): number => names.indexOf(n);
  const roomIdx = (r: string): number => rooms.indexOf(r);

  const nameBytes = encodeCompact(t.name || "");
  if (nameBytes.length > 255) throw new Error("name too long");
  const date = parseDate3(t.semesterStart || "");
  const flags = date ? V2_FLAG_DATE : 0;

  const nameDict = names.map((n) => encodeCompact(n));
  const roomDict = rooms.map((r) => encodeCompact(r));
  for (const nd of nameDict) { if (nd.length > 255) throw new Error("course name too long"); }
  for (const rd of roomDict) { if (rd.length > 255) throw new Error("room too long"); }
  if (names.length > 255 || rooms.length > 255) throw new Error("too many entries");

  const parts: Uint8Array[] = [];
  parts.push(new Uint8Array([V2_MAGIC, flags, nameBytes.length]));
  parts.push(nameBytes);
  if (date) parts.push(new Uint8Array([date[0], date[1], date[2]]));
  parts.push(new Uint8Array([t.totalWeeks || 18]));

  parts.push(new Uint8Array([names.length & 0xff, (names.length >> 8) & 0xff]));
  for (const nd of nameDict) { parts.push(new Uint8Array([nd.length])); parts.push(nd); }

  parts.push(new Uint8Array([rooms.length & 0xff, (rooms.length >> 8) & 0xff]));
  for (const rd of roomDict) { parts.push(new Uint8Array([rd.length])); parts.push(rd); }

  parts.push(new Uint8Array([t.courses.length & 0xff, (t.courses.length >> 8) & 0xff]));
  const blocks = new Uint8Array(t.courses.length * 9);
  for (let i = 0; i < t.courses.length; i++) {
    const c = t.courses[i];
    const o = i * 9;
    blocks[o] = nameIdx(c.name) & 0xff;
    blocks[o + 1] = roomIdx(c.room || "") & 0xff;
    blocks[o + 2] = Math.min(Math.max(c.day, 1), 7);
    blocks[o + 3] = Math.min(Math.max(c.startPeriod, 1), 255);
    blocks[o + 4] = Math.min(Math.max(c.endPeriod, 1), 255);
    let bits = 0;
    for (const w of (c.weeks || [])) if (w >= 1 && w <= 32) bits |= (1 << (w - 1));
    blocks[o + 5] = bits & 0xff;
    blocks[o + 6] = (bits >> 8) & 0xff;
    blocks[o + 7] = (bits >> 16) & 0xff;
    blocks[o + 8] = (bits >>> 24) & 0xff;
  }
  parts.push(blocks);

  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return bytesToB64(out);
}

function decodeV2(bytes: Uint8Array): SharedTimetable | null {
  try {
    if (bytes.length < 4 || bytes[0] !== V2_MAGIC) return null;
    const flags = bytes[1];
    let off = 2;
    const nameLen = bytes[off]; off++;
    const name = decodeCompact(bytes, off, off + nameLen); off += nameLen;
    let semesterStart = "";
    if (flags & V2_FLAG_DATE) {
      semesterStart = formatDate3(bytes[off], bytes[off + 1], bytes[off + 2]); off += 3;
    }
    const totalWeeks = bytes[off]; off++;
    const nameCount = bytes[off] | (bytes[off + 1] << 8); off += 2;
    const names: string[] = [];
    for (let i = 0; i < nameCount; i++) {
      const len = bytes[off]; off++;
      names.push(decodeCompact(bytes, off, off + len)); off += len;
    }
    const roomCount = bytes[off] | (bytes[off + 1] << 8); off += 2;
    const rooms: string[] = [];
    for (let i = 0; i < roomCount; i++) {
      const len = bytes[off]; off++;
      rooms.push(decodeCompact(bytes, off, off + len)); off += len;
    }
    const blockCount = bytes[off] | (bytes[off + 1] << 8); off += 2;
    const courses: SharedCourse[] = [];
    for (let i = 0; i < blockCount; i++) {
      const ni = bytes[off];
      const ri = bytes[off + 1];
      const day = bytes[off + 2];
      const sp = bytes[off + 3];
      const ep = bytes[off + 4];
      const bits = bytes[off + 5] | (bytes[off + 6] << 8) | (bytes[off + 7] << 16) | (bytes[off + 8] << 24);
      off += 9;
      const nm = names[ni];
      if (!nm) continue;
      const weeks: number[] = [];
      for (let w = 1; w <= 32; w++) if (bits & (1 << (w - 1))) weeks.push(w);
      courses.push({ name: nm, room: rooms[ri] || "", day: day || 1, startPeriod: sp || 1, endPeriod: ep || 1, weeks });
    }
    if (!courses.length) return null;
    return { name, semesterStart, totalWeeks: totalWeeks || 18, courses };
  } catch { return null; }
}

/**
 * 统一入口：先试 v2（更小），v2 编码失败时回退 v1。
 * 解码端 decodeTimetable 会自动识别两种格式。
 */
export function encodeShare(t: SharedTimetable): string {
  try { return encodeTimetableV2(t); }
  catch { return encodeTimetable(t); }
}

export function decodeTimetable(payload: string): SharedTimetable | null {
  try {
    const rawBytes = b64ToBytes(payload);
    // 先试 v2 二进制
    if (rawBytes.length >= 4 && rawBytes[0] === V2_MAGIC) {
      const v2 = decodeV2(rawBytes);
      if (v2) return v2;
    }
    // 回退 v1 文本
    const raw = new TextDecoder().decode(rawBytes);
    const parts = raw.split(SEP);
    if (parts.length < 7 || parts[0] !== "U1") return null;
    const names = parts[4] ? parts[4].split(UNIT) : [];
    const rooms = parts[5] ? parts[5].split(UNIT) : [];
    const courses: SharedCourse[] = [];
    for (const rec of parts[6].split(REC)) {
      if (!rec) continue;
      const f = rec.split(",");
      if (f.length < 6) continue;
      const name = names[Number(f[0])] || "";
      if (!name) continue;
      courses.push({
        name,
        room: rooms[Number(f[1])] || "",
        day: Number(f[2]) || 1,
        startPeriod: Number(f[3]) || 1,
        endPeriod: Number(f[4]) || 1,
        weeks: bitsToWeeks(f[5])
      });
    }
    if (!courses.length) return null;
    return { name: parts[1], semesterStart: parts[2], totalWeeks: Number(parts[3]) || 18, courses };
  } catch { return null; }
}

/** 从 #s=xxxx 里取出 payload */
export function payloadFromHash(hash: string): string {
  const h = (hash || "").replace(/^#/, "");
  const m = h.match(/(?:^|&)s=([A-Za-z0-9\-_]+)/);
  return m ? m[1] : "";
}

/**
 * 公网分享站点。
 * 必须写死一个公网地址：APK 里 location.origin 是 Capacitor 的虚拟域名 https://localhost，
 * 用它拼出来的链接发给别人是打不开的（真机截图里就是这样）。
 */
export const PUBLIC_SHARE_BASE = "https://unimate3.pages.dev/";

/** 分享用的站点根地址：只有真正的公网地址才用当前页面，否则一律回退到演示站 */
export function shareBase(href?: string): string {
  const h = String(href || (typeof location !== "undefined" ? location.href : ""));
  const plain = h.split("#")[0];
  if (!plain) return PUBLIC_SHARE_BASE;
  // Capacitor 的虚拟域名 / 本地调试地址：换掉
  if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(plain)) return PUBLIC_SHARE_BASE;
  return plain;
}

/** 分享链接：站内只读页 + payload（# 片段不会发给服务器） */
export function buildShareUrl(payload: string, href?: string): string {
  return shareBase(href) + "#s=" + payload;
}

/** 分享链接会指向哪个站点（面板里显示给用户看） */
export function shareHost(href?: string): string {
  try { return new URL(shareBase(href)).host; } catch { return PUBLIC_SHARE_BASE.replace(/^https?:\/\//, "").replace(/\/$/, ""); }
}

/** 周次数组 → "1-16周" 这种可读写法（分享页用） */
export function weeksText(weeks: number[]): string {
  if (!weeks.length) return "—";
  const ys = weeks.slice().sort((a, b) => a - b);
  if (ys.length >= 3 && ys[ys.length - 1] - ys[0] === ys.length - 1) return ys[0] + "-" + ys[ys.length - 1] + "周";
  return ys.join(",") + "周";
}
