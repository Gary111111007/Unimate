// 极简 ZIP（store 模式，无压缩）读写：不引入第三方依赖，备份文件仍是标准 .zip。
function crcTable(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const TABLE = crcTable();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n: number): Uint8Array { return new Uint8Array([n & 255, (n >>> 8) & 255]); }
function u32(n: number): Uint8Array { return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]); }
function cat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/**
 * 文件名含非 ASCII 时必须置 general purpose bit 11（0x0800 = UTF-8）。
 * 不置位的话，Windows 资源管理器会按 OEM 码页（简体中文即 cp437/GBK）解文件名 ——
 * 手机解压软件宽容所以看着正常，拷到电脑上全是乱码。这是真实交付缺陷。
 */
function nameFlag(name: string): number {
  return /[^\x00-\x7F]/.test(name) ? 0x0800 : 0x0000;
}

/** DOS 时间格式（本地时区），避免解压后文件时间全是 1980-01-01。 */
function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

export function makeZip(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  const { time: dTime, date: dDate } = dosDateTime(new Date());
  let offset = 0;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const flag = nameFlag(e.name);
    const crc = crc32(e.data);
    const local = cat([u32(0x04034b50), u16(20), u16(flag), u16(0), u16(dTime), u16(dDate),
      u32(crc), u32(e.data.length), u32(e.data.length), u16(nameBytes.length), u16(0), nameBytes, e.data]);
    locals.push(local);
    centrals.push(cat([u32(0x02014b50), u16(20), u16(20), u16(flag), u16(0), u16(dTime), u16(dDate),
      u32(crc), u32(e.data.length), u32(e.data.length), u16(nameBytes.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), nameBytes]));
    offset += local.length;
  }
  const central = cat(centrals);
  const end = cat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(central.length), u32(offset), u16(0)]);
  return cat([...locals, central, end]);
}

export function readZip(bytes: Uint8Array): { name: string; data: Uint8Array }[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  let eocd = -1;
  const limit = Math.max(0, bytes.length - 22);
  for (let i = limit; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip 文件');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: { name: string; data: Uint8Array }[] = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (method !== 0) throw new Error('该备份包含压缩条目，请使用 Unimate 导出的备份文件');
    const lhNameLen = dv.getUint16(localOff + 26, true);
    const lhExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
    out.push({ name, data: bytes.subarray(dataStart, dataStart + size) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
