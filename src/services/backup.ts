// 备份与恢复（PRD 7.2 / 7.3）：单文件 .unimate.zip（标准 ZIP，store 模式）
import { makeZip, readZip, bytesToBase64, base64ToBytes } from './zip.ts';
import { readText, readJson, writeText, writeJson, writeBinaryBase64, readBinaryBase64, exists, nativeUri } from './io.ts';
import { sha256Base64, sha256Text } from './crypto.ts';
import { uuid, nowStamp } from './id.ts';
import { SCHEMA_VERSION, APP_VERSION } from '../stores/db.ts';
import type { SecondClassRecord, Account } from '../types.ts';

const TEXT_FILES = [
  'timetable/timetables.json', 'timetable/courses.json',
  'notes/notes.json', 'secondclass/records.json', 'settings.json'
];

export interface BackupManifest {
  app: 'Unimate';
  version: string;
  schemaVersion: number;
  exportedAt: string;
  schoolId: string;
  schoolName: string;
  username: string;
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
  userBase: string, accounts: Account[], accountId: string): Promise<ExportResult> {
  const enc = new TextEncoder();
  const files: { name: string; data: Uint8Array }[] = [];
  const listed: BackupManifest['files'] = [];
  const counts: BackupManifest['counts'] = { timetables: 0, courses: 0, notes: 0, records: 0, photos: 0 };

  const texts: Record<string, string> = {};
  for (const f of TEXT_FILES) {
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

  const manifest: BackupManifest = {
    app: 'Unimate', version: APP_VERSION, schemaVersion: SCHEMA_VERSION, exportedAt: nowStamp(),
    schoolId, schoolName, username, counts, files: listed
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
  await writeJson(userBase + '/timetable/timetables.json', merge ? mergeById(current.timetables, dec(get('timetable/timetables.json'), [])) : dec(get('timetable/timetables.json'), []));
  await writeJson(userBase + '/timetable/courses.json', merge ? mergeById(current.courses, dec(get('timetable/courses.json'), [])) : dec(get('timetable/courses.json'), []));
  await writeJson(userBase + '/notes/notes.json', merge ? mergeById(current.notes, dec(get('notes/notes.json'), [])) : dec(get('notes/notes.json'), []));
  await writeJson(userBase + '/secondclass/records.json', merge ? mergeById(current.records, dec(get('secondclass/records.json'), [])) : dec(get('secondclass/records.json'), []));
  const st = get('settings.json');
  if (st) await writeText(userBase + '/settings.json', new TextDecoder().decode(st));

  for (const item of items) {
    if (!item.name.startsWith('files/')) continue;
    await writeBinaryBase64(item.name.slice('files/'.length), bytesToBase64(item.data));
  }
}
