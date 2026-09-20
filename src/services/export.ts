// 二课材料导出（用于填报学校第二课堂系统）：照片打包、存到手机存储、系统分享
import { makeZip, bytesToBase64, base64ToBytes } from './zip.ts';
import { readBinaryBase64, writeBinaryBase64, nativeUri, fileUri } from './io.ts';
import { blockDef } from '../catalog/secondClass.ts';
import { clauseById, clauseLabel, clausesOf, STAGE_LABEL } from '../catalog/handbook.ts';
import { nowStamp } from './id.ts';
import type { SecondClassRecord } from '../types.ts';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const enc = new TextEncoder();

function safeName(s: string): string {
  return (s || '活动').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
}
function stamp(): string {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, '0');
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}
/**
 * 导出文件的"可分享副本"。
 * 先写进应用私有目录（数据归属），再复制一份到 Directory.Documents
 * （= getExternalFilesDir(DIRECTORY_DOCUMENTS)，实际路径
 *  /storage/emulated/0/Android/data/com.unimate.app/files/Documents），
 * 这样用户能在文件管理器里直接取到，微信也能从"手机文件"里选到；
 * 同时该位置落在 FileProvider 的 <external-path> 白名单内，content:// 一定能解析。
 * 复制失败则退回私有目录 URI（file_paths.xml 已补 <files-path>，同样可分享）。
 */
const PUB_DIR = 'Unimate导出';

/**
 * 依次尝试三个落点，取第一个成功的：
 *  1) Directory.PublicDocuments —— Android 10+ 经 MediaStore 写入**真正的公共 Documents**，
 *     任何文件管理器和微信都能直接读到（首选，因为小米/澎湃默认不允许浏览 Android/data）；
 *  2) Directory.Documents —— 应用私有的外部目录，低版本或 MediaStore 失败时兜底；
 *  3) 应用内部 exports/ —— 至少保证数据不丢。
 * 三者都在 FileProvider 白名单内（file_paths.xml 已补 files-path / external-files-path）。
 */
async function publishFile(relPath: string, fileName: string): Promise<{ uri: string; hint: string }> {
  const b64 = await readBinaryBase64(relPath);
  const attempts: { dir: any; label: string }[] = [
    { dir: Directory.PublicDocuments, label: '手机存储 → Documents/' + PUB_DIR },
    { dir: Directory.Documents, label: '文件管理器 → Android/data/com.unimate.app/files/Documents/' + PUB_DIR }
  ];
  for (const a of attempts) {
    try {
      const dest = a.dir === Directory.Documents ? PUB_DIR + '/' + fileName : fileName;
      if (a.dir === Directory.Documents) {
        await Filesystem.mkdir({ path: PUB_DIR, directory: a.dir, recursive: true }).catch(() => { /* 已存在 */ });
      }
      await Filesystem.writeFile({ path: dest, data: b64, directory: a.dir, recursive: true });
      const u = await Filesystem.getUri({ path: dest, directory: a.dir });
      return { uri: u.uri, hint: '已存入：' + a.label + '（微信可从"手机文件"里直接选到）' };
    } catch { /* 换下一个落点 */ }
  }
  return { uri: await nativeUri(relPath), hint: '公共目录写入失败，仅存于应用私有目录 exports/' };
}

async function shareableUri(relPath: string, fileName: string): Promise<{ uri: string; hint: string }> {
  if (!Capacitor.isNativePlatform()) return { uri: relPath, hint: '浏览器预览环境，未写入手机存储' };
  return publishFile(relPath, fileName);
}
function evidenceLines(r: SecondClassRecord): string {
  return r.photos.map((p, i) => [
    '  照片' + (i + 1) + '：' + (p.watermarked ? '有水印' : '无水印'),
    '    拍摄时间：' + p.capturedAt,
    '    坐标：' + (p.latitude !== null && p.longitude !== null ? p.latitude.toFixed(5) + ', ' + p.longitude.toFixed(5) + (p.accuracyMeters ? '（精度约 ' + p.accuracyMeters + ' 米）' : '') : '未获取定位'),
    '    地址：' + (p.address || '未填写'),
    '    水印图 SHA-256：' + p.watermarkSha256
  ].join('\n')).join('\n');
}
function recordTxt(r: SecondClassRecord): string {
  return [
    '活动名称：' + r.activityName,
    '板块：' + blockDef(r.block).name + ' · ' + blockDef(r.block).fullName + '（' + (r.stage === 'basic' ? '基础评定' : '拓展评定') + '）',
    '手册依据：' + (clauseById(r.clauseId) ? clauseLabel(clauseById(r.clauseId)!) : '未对应具体条款（自由填报）'),
    '自评分数：' + r.score + ' 分' + (r.scorePreset ? '（参考档：' + r.scorePreset + '）' : ''),
    '活动时间：' + r.activityDate,
    '志愿 / 活动时长：' + ((r as any).hours || 0) + ' 小时',
    '描述：' + (r.description || '（无）'),
    '照片数量：' + r.photos.length,
    '',
    '—— 本机存证信息 ——',
    evidenceLines(r),
    '',
    '导出时间：' + nowStamp(),
    '由 Unimate 在本机生成；分数为本人自评，最终以学校审核认定为准。'
  ].join('\n');
}

async function photoBytes(r: SecondClassRecord, index: number): Promise<{ name: string; data: Uint8Array } | null> {
  const p = r.photos[index];
  const b64 = await readBinaryBase64(p.watermarkPath);
  if (!b64) return null;
  const ext = p.watermarkPath.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
  return { name: 'photo-' + (index + 1) + '.' + ext, data: base64ToBytes(b64) };
}

/** 单条记录导出为 zip：照片 + 说明.txt */
export async function exportRecordZip(r: SecondClassRecord): Promise<{ fileName: string; path: string; hint: string; photos: number }> {
  const entries: { name: string; data: Uint8Array }[] = [];
  const dir = safeName(blockDef(r.block).name + '_' + r.activityName);
  let n = 0;
  for (let i = 0; i < r.photos.length; i++) {
    const item = await photoBytes(r, i);
    if (item) { entries.push({ name: dir + '/' + item.name, data: item.data }); n++; }
  }
  entries.push({ name: dir + '/说明.txt', data: enc.encode(recordTxt(r)) });
  const zip = makeZip(entries);
  const fileName = 'unimate-二课-' + safeName(r.activityName) + '-' + stamp() + '.zip';
  const outPath = 'exports/' + fileName;
  await writeBinaryBase64(outPath, bytesToBase64(zip));
  const s = await shareableUri(outPath, fileName);
  return { fileName, path: s.uri, hint: s.hint, photos: n };
}

/** 全部记录导出为一个材料包：按板块分目录 + 总清单.txt */
export async function exportAllZip(records: SecondClassRecord[]): Promise<{ fileName: string; path: string; hint: string; photos: number }> {
  const entries: { name: string; data: Uint8Array }[] = [];
  let n = 0;
  const lines: string[] = ['第二课堂填报材料清单', '导出时间：' + nowStamp(), '', '全部志愿时长合计：' + (Math.round(records.filter((x) => !x.deletedAt).reduce((a, x) => a + ((x as any).hours || 0), 0) * 10) / 10) + ' 小时', ''];
  for (const b of ['de', 'zhi', 'ti', 'mei', 'lao'] as const) {
    const list = records.filter((r) => r.block === b && !r.deletedAt);
    const sum = list.reduce((a, r) => a + r.score, 0);
    const def = blockDef(b);
    lines.push('【' + def.name + ' · ' + def.fullName + '】自评合计 ' + sum + ' / ' + def.fullScore + ' 分，共 ' + list.length + ' 条，志愿时长合计 ' + (Math.round(list.reduce((a, x) => a + ((x as any).hours || 0), 0) * 10) / 10) + ' 小时');
    // 按手册条款分组列清单：学校二课系统就是按条款填报的，逐条小计最有用
    const byClause = new Map<string, typeof list>();
    for (const r of list) {
      const key = r.clauseId || '';
      const arr = byClause.get(key) || [];
      arr.push(r);
      byClause.set(key, arr);
    }
    for (const c of clausesOf(b)) {
      const arr = byClause.get(c.id);
      if (!arr || !arr.length) continue;
      const sub = Math.round(arr.reduce((a, r) => a + r.score, 0) * 2) / 2;
      lines.push('  ' + clauseLabel(c) + '（' + STAGE_LABEL[c.stage] + (c.cap ? '，上限 ' + c.cap + ' 分' : '') + '）小计 ' + sub + ' 分');
      for (const r of arr) {
        lines.push('      · ' + r.activityName + '｜' + r.activityDate + '｜' + r.score + ' 分｜照片 ' + r.photos.length + ' 张');
      }
    }
    const free = byClause.get('');
    if (free && free.length) {
      const sub = Math.round(free.reduce((a, r) => a + r.score, 0) * 2) / 2;
      lines.push('  未对应条款（自由填报）小计 ' + sub + ' 分');
      for (const r of free) {
        lines.push('      · ' + r.activityName + '｜' + r.activityDate + '｜' + r.score + ' 分｜照片 ' + r.photos.length + ' 张');
      }
    }
    for (const r of list) {
      for (let i = 0; i < r.photos.length; i++) {
        const item = await photoBytes(r, i);
        if (!item) continue;
        n++;
        entries.push({ name: def.name + '/' + safeName(r.activityName) + '/' + item.name, data: item.data });
      }
      entries.push({ name: def.name + '/' + safeName(r.activityName) + '/说明.txt', data: enc.encode(recordTxt(r)) });
    }
    lines.push('');
  }
  entries.push({ name: '总清单.txt', data: enc.encode(lines.join('\n')) });
  const zip = makeZip(entries);
  const fileName = 'unimate-二课材料包-' + stamp() + '.zip';
  const outPath = 'exports/' + fileName;
  await writeBinaryBase64(outPath, bytesToBase64(zip));
  const s = await shareableUri(outPath, fileName);
  return { fileName, path: s.uri, hint: s.hint, photos: n };
}

/** 把单张照片写到手机存储（文件管理器可见），便于直接上传到学校系统 */
export async function savePhotoToDevice(r: SecondClassRecord, index: number): Promise<string> {
  const p = r.photos[index];
  const b64 = await readBinaryBase64(p.watermarkPath);
  if (!b64) throw new Error('照片文件不存在');
  const name = safeName(r.activityName) + '_' + (index + 1) + '.jpg';
  if (!Capacitor.isNativePlatform()) { await writeBinaryBase64('pictures/' + name, b64); return '（预览环境）pictures/' + name; }
  // 优先写真正的公共 Pictures（Android 10+ 经 MediaStore），小米/澎湃的相册与文件
  // 管理器才能直接看到；失败再退回应用私有的 Pictures 子目录。
  // 注意：写到哪个目录就必须用哪个目录取 URI，取错目录会直接抛"文件不存在"。
  const tries: { dir: any; path: string; label: string }[] = [
    { dir: Directory.PublicPictures, path: name, label: '公共相册 Pictures/' + name },
    { dir: Directory.Pictures, path: 'Unimate/' + name, label: 'Android/data/com.unimate.app/files/Pictures/Unimate/' + name }
  ];
  for (const c of tries) {
    try {
      if (c.dir === Directory.Pictures) {
        await Filesystem.mkdir({ path: 'Unimate', directory: c.dir, recursive: true }).catch(() => { /* 已存在 */ });
      }
      await Filesystem.writeFile({ path: c.path, data: b64, directory: c.dir, recursive: true });
      await Filesystem.getUri({ path: c.path, directory: c.dir });   // 确认可寻址后再报路径
      return c.label;
    } catch { /* 换下一个落点 */ }
  }
  throw new Error('无法写入手机存储，请检查存储权限');
}

/** 系统分享（可发到微信/QQ/文件管理/网盘） */
export async function shareFile(path: string, title: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const uri = path.startsWith('content://') || path.startsWith('file://') ? path : (await nativeUri(path));
    await Share.share({ title, url: uri, dialogTitle: '发送 ' + title });
    return true;
  } catch { return false; }
}

export async function photoPreviewUrl(p: { watermarkPath: string; originalPath: string; watermarked: boolean }): Promise<string> {
  return fileUri(p.watermarked ? p.watermarkPath : p.originalPath);
}