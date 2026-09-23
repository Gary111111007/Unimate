// 备份与恢复（PRD 7.2 / 7.3）：单文件 .unimate.zip（标准 ZIP，store 模式）
import { makeZip, readZip, bytesToBase64, base64ToBytes } from './zip.ts';
import { readText, readJson, writeText, writeJson, writeBinaryBase64, readBinaryBase64, exists, nativeUri } from './io.ts';
import { sha256Base64, sha256Text } from './crypto.ts';
import { uuid, nowStamp } from './id.ts';
import { SCHEMA_VERSION, APP_VERSION } from '../stores/db.ts';
import type { SecondClassRecord, Account } from '../types.ts';

/**
 * 全量备份的文本文件（**本机导出/留底**用它，包含二课记录）。
 */
const FULL_TEXT_FILES = [
  'timetable/timetables.json', 'timetable/courses.json',
  'notes/notes.json', 'secondclass/records.json', 'settings.json'
];

/**
 * 【v2.50】**换机备份**只带这些 —— 产品负责人定的口径：
 * "在二课那里做成本地记录，换机登录只换课表"（顺带把体积压下来，不至于把照片都推上云）。
 *
 * 所以云端（账号模式 / 端到端同步）用的是这一份：**课表 + 记事 + 设置**，不含二课记录，也不含二课照片。
 * 二课数据仍然存在本机（`schools/<schoolId>/users/<accountId>/secondclass/records.json`），
 * 退出再登录同一账号还在，切到别的账号看不到，换回来又出现 —— 这正是产品负责人要的行为。
 */
export const STUDY_TEXT_FILES = [
  'timetable/timetables.json', 'timetable/courses.json',
  'notes/notes.json', 'settings.json'
];

export type BackupScope = 'full' | 'study';

/** 这个范围要打包哪些文本文件（导出给测试用，避免单测里跑 Capacitor 文件系统） */
export function textFilesFor(scope: BackupScope): string[] {
  return scope === 'study' ? STUDY_TEXT_FILES.slice() : FULL_TEXT_FILES.slice();
}

export interface BackupManifest {
  app: 'Unimate';
  version: string;
  schemaVersion: number;
  exportedAt: string;
  schoolId: string;
  schoolName: string;
  username: string;
  /** v2.50：full = 本机全量（含二课与照片）；study = 换机用（只有课表/记事/设置） */
  scope?: BackupScope;
  counts: { timetables: number; courses: number; notes: number; records: number; photos: number };
  files: { path: string; size: number; sha256: string }[];
}

export interface ExportResult {
  fileName: string;
  path: string;
  /** 应用私有目录中的相对路径；P3 加密上传复用同一份 ZIP 字节，不重复组包。 */
  storagePath: string;
  size: number;
  manifest: BackupManifest;
  bytes: Uint8Array;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}

export async function exportBackup(schoolId: string, schoolName: string, username: string,
  userBase: string, accounts: Account[], accountId: string, scope: BackupScope = 'full'): Promise<ExportResult> {
  const enc = new TextEncoder();
  const files: { name: string; data: Uint8Array }[] = [];
  const listed: BackupManifest['files'] = [];
  const counts: BackupManifest['counts'] = { timetables: 0, courses: 0, notes: 0, records: 0, photos: 0 };

  const texts: Record<string, string> = {};
  for (const f of textFilesFor(scope)) {
    const raw = await readText(userBase + '/' + f);
    if (raw === null) continue;
    texts[f] = raw;
    files.push({ name: 'account/' + f, data: enc.encode(raw) });
    listed.push({ path: 'account/' + f, size: raw.length, sha256: await sha256Text(raw) });
  }
  const parse = <T,>(f: string, fb: T): T => { try { return f in texts ? JSON.parse(texts[f]) as T : fb; } catch { return fb; } };
  counts.timetables = parse<any[]>('timetable/timetables.json', []).length;
  counts.courses = parse<any[]>('timetable/courses.json', []).length;
  counts.notes = parse<any[]>('notes/notes.json', []).length;
  const recs = parse<SecondClassRecord[]>('secondclass/records.json', []);
  counts.records = recs.length;

  const acc = accounts.find((a) => a.id === accountId);
  if (acc) {
    const safe = { ...acc, passwordHash: acc.passwordHash, salt: acc.salt };
    files.push({ name: 'account/profile.json', data: enc.encode(JSON.stringify(safe, null, 2)) });
  }
  const interests = await readText('catalog/interests.json');
  if (interests) files.push({ name: 'catalog/interests.json', data: enc.encode(interests) });

  // 二课照片属于"本地记录"，换机范围不带（v2.50）
  if (scope === 'full') {
    for (const r of recs) {
      for (const p of r.photos) {
        for (const key of ['watermarkPath', 'originalPath'] as const) {
          const rel = p[key];
          if (!rel) continue;
          const b64 = await readBinaryBase64(rel);
          if (!b64) continue;
          counts.photos++;
          files.push({ name: 'files/' + rel, data: base64ToBytes(b64) });
          listed.push({ path: 'files/' + rel, size: Math.round(b64.length * 0.75), sha256: await sha256Base64(b64) });
        }
      }
    }
  }

  const manifest: BackupManifest = {
    app: 'Unimate', version: APP_VERSION, schemaVersion: SCHEMA_VERSION, exportedAt: nowStamp(),
    schoolId, schoolName, username, scope, counts, files: listed
  };
  files.push({ name: 'BACKUP_MANIFEST.json', data: enc.encode(JSON.stringify(manifest, null, 2)) });

  const zip = makeZip(files);
  const fileName = 'unimate-backup-' + schoolId + '-' + username + '-' + stamp() + '.unimate.zip';
  const outPath = 'exports/' + fileName;
  await writeBinaryBase64(outPath, bytesToBase64(zip));
  return { fileName, path: await nativeUri(outPath), storagePath: outPath, size: zip.length, manifest, bytes: zip };
}

export interface ImportPreview { manifest: BackupManifest; entries: number }

/** 保存端到端加密后的单文件迁移包，供系统分享/网盘离线中转。 */
export async function saveEncryptedMigration(bytes: Uint8Array, syncId: string): Promise<{ fileName: string; path: string }> {
  const fileName = 'unimate-encrypted-' + syncId.slice(0, 8) + '-' + stamp() + '.umig';
  const outPath = 'exports/' + fileName;
  await writeBinaryBase64(outPath, bytesToBase64(bytes));
  return { fileName, path: await nativeUri(outPath) };
}

export async function inspectBackup(bytes: Uint8Array): Promise<ImportPreview> {
  const items = readZip(bytes);
  const m = items.find((i) => i.name === 'BACKUP_MANIFEST.json');
  if (!m) throw new Error('备份缺少 BACKUP_MANIFEST.json，可能不是 Unimate 导出的文件');
  const manifest = JSON.parse(new TextDecoder().decode(m.data)) as BackupManifest;
  if (manifest.app !== 'Unimate') throw new Error('该文件不是 Unimate 备份');
  if (manifest.schemaVersion > SCHEMA_VERSION) throw new Error('备份版本高于当前 App 支持版本，请升级 App');
  return { manifest, entries: items.length };
}

/**
 * 取出备份里的本机账号记录（`account/profile.json`）。
 *
 * v2.44：开机登录页的"用 Unimate 账号登录并取回课表"靠它 —— 备份里带着原设备的
 * `id / username / passwordHash / salt`，所以换机后**连本机密码都还是原来那个**，
 * 数据目录也对得上（`schools/<schoolId>/users/<accountId>`）。
 * 老备份或第三方构造的包可能没有这一段，那就返回 null，由调用方新建一个账号来承载。
 */
export function readBackupProfile(bytes: Uint8Array): Account | null {
  const items = readZip(bytes);
  const f = items.find((i) => i.name === 'account/profile.json');
  if (!f) return null;
  try {
    const acc = JSON.parse(new TextDecoder().decode(f.data)) as Account;
    if (!acc || typeof acc.id !== 'string' || typeof acc.username !== 'string') return null;
    return acc;
  } catch { return null; }
}

export async function restoreBackup(bytes: Uint8Array, userBase: string, merge: boolean): Promise<void> {
  const items = readZip(bytes);
  const current = merge ? {
    timetables: await readJson<any[]>(userBase + '/timetable/timetables.json', []),
    courses: await readJson<any[]>(userBase + '/timetable/courses.json', []),
    notes: await readJson<any[]>(userBase + '/notes/notes.json', []),
    records: await readJson<any[]>(userBase + '/secondclass/records.json', [])
  } : { timetables: [], courses: [], notes: [], records: [] };

  const byName = (n: string): Uint8Array | undefined => items.find((i) => i.name === n)?.data;
  const dec = <T,>(data: Uint8Array | undefined, fb: T): T => {
    if (!data) return fb;
    try { return JSON.parse(new TextDecoder().decode(data)) as T; } catch { return fb; }
  };
  const mergeById = <T extends { id: string }>(a: T[], b: T[]): T[] => {
    const m = new Map<string, T>();
    a.forEach((x) => m.set(x.id, x));
    b.forEach((x) => { if (!m.has(x.id)) m.set(x.id, x); });
    return [...m.values()];
  };

  const get = (f: string) => byName('account/' + f);
  /*
   * 【v2.50 关键修正】**包里没有的文件一律不动**。
   * 旧写法是 `dec(get(f), [])` —— 包里没有就写个空数组，等于"换机备份顺手把本机的二课记录清空了"。
   * 现在换机备份本来就不带二课（scope=study），如果还按旧写法，新设备恢复后没事、但**在已用过的设备上恢复会把二课清掉**。
   */
  const putIfPresent = async (file: string, target: string, currentList: any[]) => {
    const data = get(file);
    if (!data) return;                       // 包里没有 → 保持本机现状（v2.50 修正）
    const fromPack = dec<any[]>(data, []);
    await writeJson(target, merge ? mergeById(currentList, fromPack) : fromPack);
  };
  await putIfPresent('timetable/timetables.json', userBase + '/timetable/timetables.json', current.timetables);
  await putIfPresent('timetable/courses.json', userBase + '/timetable/courses.json', current.courses);
  await putIfPresent('notes/notes.json', userBase + '/notes/notes.json', current.notes);
  await putIfPresent('secondclass/records.json', userBase + '/secondclass/records.json', current.records);
  const st = get('settings.json');
  if (st) await writeText(userBase + '/settings.json', new TextDecoder().decode(st));

  for (const item of items) {
    if (!item.name.startsWith('files/')) continue;
    await writeBinaryBase64(item.name.slice('files/'.length), bytesToBase64(item.data));
  }
}
