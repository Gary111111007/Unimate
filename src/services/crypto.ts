// 本地哈希（水印存证，PRD 5.6.4）。不上传任何数据。
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function fnv(bytes: Uint8Array): string {
  // 仅用于无 WebCrypto 的桌面预览环境（开发兜底），不用于安全场景
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < bytes.length; i++) {
    h1 = (h1 ^ bytes[i]) >>> 0; h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = (h2 + bytes[i]) >>> 0; h2 = Math.imul(h2, 2246822519) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).repeat(4);
}

export async function sha256Base64(b64: string): Promise<string> {
  const bytes = base64ToBytes(b64);
  const subtle = (globalThis as any).crypto && (globalThis as any).crypto.subtle;
  if (!subtle) return 'local-' + fnv(bytes);
  const buf = await subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Text(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const subtle = (globalThis as any).crypto && (globalThis as any).crypto.subtle;
  if (!subtle) return 'local-' + fnv(enc);
  const buf = await subtle.digest('SHA-256', enc.buffer as ArrayBuffer);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomSalt(): string {
  const a = new Uint8Array(16);
  if ((globalThis as any).crypto && (globalThis as any).crypto.getRandomValues) (globalThis as any).crypto.getRandomValues(a);
  else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
