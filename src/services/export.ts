// 二课材料导出（用于填报学校第二课堂系统）：照片打包、存到手机存储、系统分享
import { makeZip, bytesToBase64, base64ToBytes } from './zip.ts';
import { readBinaryBase64, writeBinaryBase64, nativeUri, fileUri } from './io.ts';
import { blockDef } from '../catalog/secondClass.ts';
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
    '自评分数：' + r.score + ' 分' + (r.scorePreset ? '（参考档：' + r.scorePreset + '）' : ''),
    '活动时间：' + r.activityDate,
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
export async function exportRecordZip(r: SecondClassRecord): Promise<{ fileName: string; path: string; photos: number }> {
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
  return { fileName, path: await nativeUri(outPath), photos: n };
}

/** 全部记录导出为一个材料包：按板块分目录 + 总清单.txt */
export async function exportAllZip(records: SecondClassRecord[]): Promise<{ fileName: string; path: string; photos: number }> {
  const entries: { name: string; data: Uint8Array }[] = [];
  let n = 0;
  const lines: string[] = ['第二课堂填报材料清单', '导出时间：' + nowStamp(), ''];
  for (const b of ['de', 'zhi', 'ti', 'mei', 'lao'] as const) {
    const list = records.filter((r) => r.block === b && !r.deletedAt);
    const sum = list.reduce((a, r) => a + r.score, 0);
    const def = blockDef(b);
    lines.push('【' + def.name + ' · ' + def.fullName + '】自评合计 ' + sum + ' / ' + def.fullScore + ' 分，共 ' + list.length + ' 条');
    for (const r of list) {
      lines.push('  · ' + r.activityName + '｜' + r.activityDate + '｜' + r.score + ' 分｜照片 ' + r.photos.length + ' 张');
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
  return { fileName, path: await nativeUri(outPath), photos: n };
}

/** 把单张照片写到手机存储（文件管理器可见），便于直接上传到学校系统 */
export async function savePhotoToDevice(r: SecondClassRecord, index: number): Promise<string> {
  const p = r.photos[index];
  const b64 = await readBinaryBase64(p.watermarkPath);
  if (!b64) throw new Error('照片文件不存在');
  const name = safeName(r.activityName) + '_' + (index + 1) + '.jpg';
  if (!Capacitor.isNativePlatform()) { await writeBinaryBase64('pictures/' + name, b64); return '（预览环境）pictures/' + name; }
  await Filesystem.writeFile({ path: 'Unimate/' + name, data: b64, directory: Directory.Pictures });
  const u = await Filesystem.getUri({ path: 'Unimate/' + name, directory: Directory.Pictures });
  return u.uri;
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
