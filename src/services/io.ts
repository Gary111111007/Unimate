// 本地数据文件读写（PRD 7.1）。原生环境用 Capacitor Filesystem（应用私有目录），
// 浏览器预览用 localStorage，接口一致，便于在桌面端跑通全流程。
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

const isNative = () => Capacitor.isNativePlatform();
// Data = 应用私有外部文件目录（getExternalFilesDir(null)），无需任何权限、不依赖 Documents 子目录是否存在
const DIR = Directory.Data;
const LS = 'unimate:';

async function ensure(path: string): Promise<void> {
  if (!isNative()) return;
  const dir = path.split('/').slice(0, -1).join('/');
  if (!dir) return;
  try { await Filesystem.mkdir({ path: dir, directory: DIR, recursive: true }); } catch { /* exists */ }
}

export async function writeText(path: string, text: string): Promise<void> {
  if (!isNative()) { localStorage.setItem(LS + path, text); return; }
  await ensure(path);
  // 先尝试直接覆盖写（Android 上 rename 偶发失败），失败再退回临时文件 + 改名
  try {
    await Filesystem.writeFile({ path, data: text, directory: DIR, encoding: Encoding.UTF8, recursive: true });
    return;
  } catch (e) {
    const tmp = path + '.tmp';
    await Filesystem.writeFile({ path: tmp, data: text, directory: DIR, encoding: Encoding.UTF8, recursive: true });
    try { await Filesystem.deleteFile({ path, directory: DIR }); } catch { /* 新文件 */ }
    try { await Filesystem.rename({ from: tmp, to: path, fromDirectory: DIR, toDirectory: DIR }); }
    catch (e2) { throw new Error('写入本机文件失败（' + path + '）：' + ((e as any)?.message || e) + ' / 改名也失败：' + ((e2 as any)?.message || e2)); }
  }
}

export async function readText(path: string): Promise<string | null> {
  if (!isNative()) return localStorage.getItem(LS + path);
  try {
    const r = await Filesystem.readFile({ path, directory: DIR, encoding: Encoding.UTF8 });
    return typeof r.data === 'string' ? r.data : null;
  } catch { return null; }
}

export async function remove(path: string): Promise<void> {
  if (!isNative()) { localStorage.removeItem(LS + path); return; }
  try { await Filesystem.deleteFile({ path, directory: DIR }); } catch { /* absent */ }
}

export async function exists(path: string): Promise<boolean> {
  if (!isNative()) return localStorage.getItem(LS + path) !== null;
  try { await Filesystem.stat({ path, directory: DIR }); return true; } catch { return false; }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, JSON.stringify(value, null, 2));
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  const raw = await readText(path);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export async function writeBinaryBase64(path: string, base64: string): Promise<void> {
  if (!isNative()) { localStorage.setItem(LS + path, base64); return; }
  await ensure(path);
  await Filesystem.writeFile({ path, data: base64, directory: DIR, recursive: true });
}

export async function readBinaryBase64(path: string): Promise<string | null> {
  if (!isNative()) return localStorage.getItem(LS + path);
  try {
    const r = await Filesystem.readFile({ path, directory: DIR });
    return typeof r.data === 'string' ? r.data : null;
  } catch { return null; }
}

const dataUrlCache = new Map<string, string>();

/** 给 <img> 用的可显示地址。Android 的 https://localhost 页面无法加载 file://，所以统一转 data URL。 */
export async function fileUri(path: string): Promise<string> {
  const cached = dataUrlCache.get(path);
  if (cached) return cached;
  const b64 = await readBinaryBase64(path);
  if (!b64) return '';
  const ext = path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  const url = 'data:' + ext + ';base64,' + b64;
  dataUrlCache.set(path, url);
  return url;
}

/** 给"备份文件路径"这类需要真实磁盘路径的场景使用。 */
export async function nativeUri(path: string): Promise<string> {
  if (!isNative()) return '(浏览器预览：文件在 localStorage 中) ' + path;
  try { const u = await Filesystem.getUri({ path, directory: DIR }); return u.uri; }
  catch { return path; }
}

/** 开机自检：能不能真的读写本机存储。失败时把原因暴露到界面上，而不是让按钮静默失灵。 */
export async function probeStorage(): Promise<{ ok: boolean; detail: string }> {
  try {
    const p = 'probe/unimate-probe.json';
    const token = 'probe-' + Date.now();
    await writeJson(p, { token });
    const back = await readJson<{ token?: string }>(p, {});
    if (back && back.token === token) return { ok: true, detail: isNative() ? 'Directory.Data（应用私有目录）' : '浏览器 localStorage' };
    return { ok: false, detail: '写入后读回内容不一致' };
  } catch (e: any) {
    return { ok: false, detail: (e && (e.message || String(e))) || '未知错误' };
  }
}
