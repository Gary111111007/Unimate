<script setup lang="ts">
import { computed, ref } from 'vue';
import { watch } from 'vue';
import RuleTables from './RuleTables.vue';
import HoursPanel from '../components/HoursPanel.vue';
import { exportRecordZip, exportAllZip, savePhotoToDevice, shareFile } from '../services/export.ts';
import ImageViewer from '../components/ImageViewer.vue';
import { Camera, CameraSource } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import { useDb } from '../stores/db.ts';
import { BLOCK_HINTS, QUICK_SCORES, SCORE_PRESETS, SECOND_CLASS_BLOCKS, TOTAL_FULL_SCORE, blockDef } from '../catalog/secondClass.ts';
import { FILLABLE, clauseById, clauseLabel, clausesOf, chapterIntro, STAGE_LABEL, clauseNo, type HandbookClause } from '../catalog/handbook.ts';
import { applyWatermark } from '../services/watermark.ts';
import { writeBinaryBase64, writeJson, fileUri } from '../services/io.ts';
import { sha256Base64 } from '../services/crypto.ts';
import { uuid, nowStamp, dateStamp } from '../services/id.ts';
import type { BlockKey, PhotoEvidence, SecondClassRecord } from '../types.ts';
import AppleIcon from '../components/AppleIcon.vue';

const db = useDb();
const active = ref<BlockKey | 'all'>('all');
/**
 * 本校有没有第二课堂（由高校档案决定）。
 * 北二外这类"没有二课"的学校：第二栏改名「活动材料」，只留志愿时长 / 劳育时长两块台账，
 * 绝不套用北化的手册分值表 —— 界面必须说清楚为什么（见下方 notice 卡片）。
 */
const hasErke = computed(() => db.profile?.secondClass.enabled !== false);
/** 三个 sheet：二课填报记「分」，志愿与劳育各记「小时」，口径互相独立。没有二课的学校默认落在"志愿时长"。 */
const sheet = ref<'erke' | 'vol' | 'labor'>(hasErke.value ? 'erke' : 'vol');
// 切换学校后如果当前停在二课 sheet 而新学校没有二课，自动落到"志愿时长"，避免出现空白页
watch(hasErke, (on) => { if (!on && sheet.value === 'erke') sheet.value = 'vol'; });
const showForm = ref(false);
const detail = ref<SecondClassRecord | null>(null);
const busy = ref('');
const thumbs = ref<Record<string, string>>({});
const showRules = ref(false);
const exporting = ref(false);
/** 板块简介默认只露两行，点「展开完整简介」看全文（旧写法是硬截断，用户根本读不到后半句） */
const introOpen = ref(false);
const lastExport = ref<{ fileName: string; path: string; photos: number } | null>(null);

async function doExportRecord(r: SecondClassRecord): Promise<void> {
  exporting.value = true;
  try {
    lastExport.value = await exportRecordZip(r);
    db.notify('已导出 ' + lastExport.value.photos + ' 张照片：' + lastExport.value.fileName);
  } catch (e: any) { db.notify('导出失败：' + (e?.message || e)); } finally { exporting.value = false; }
}
async function doExportAll(): Promise<void> {
  exporting.value = true;
  try {
    lastExport.value = await exportAllZip(db.records.filter((x) => !x.deletedAt));
    db.notify('材料包已生成：' + lastExport.value.photos + ' 张照片');
  } catch (e: any) { db.notify('导出失败：' + (e?.message || e)); } finally { exporting.value = false; }
}
async function doSaveOne(r: SecondClassRecord, i: number): Promise<void> {
  try { const p = await savePhotoToDevice(r, i); db.notify('已存到手机存储：' + p); }
  catch (e: any) { db.notify('保存失败：' + (e?.message || e)); }
}
async function doShare(): Promise<void> {
  if (!lastExport.value) return;
  // 直接分享"可分享副本"的 URI（外部 Documents，FileProvider 一定能解析），
// 不再回退到私有目录相对路径 —— 那正是微信"获取资源失败"的来源。
const okShare = await shareFile(lastExport.value.path, lastExport.value.fileName);
if (!okShare) db.notify('系统分享未打开，请按下方路径手动取文件');
  if (!okShare) db.notify('已保存到：' + lastExport.value.path);
}
const viewer = ref<{ items: { url: string; title: string; sub: string }[]; index: number } | null>(null);

function openViewer(items: { url: string; title: string; sub: string }[], index: number): void {
  const list = items.filter((x) => !!x.url);
  if (!list.length) { db.notify('这张照片还没有可显示的内容'); return; }
  viewer.value = { items: list, index: Math.min(index, list.length - 1) };
}

const form = ref({
  block: 'de' as BlockKey, stage: 'basic' as 'basic' | 'extended', clauseId: '', activityName: '', description: '',
  activityDate: dateStamp(), score: 10, scorePreset: '', hours: 0, watermark: true, address: '', photos: [] as { ev: PhotoEvidence; uri: string }[]
});

const records = computed(() => db.records
  .filter((r) => !r.deletedAt && (active.value === 'all' || r.block === active.value))
  .sort((a, b) => (a.activityDate < b.activityDate ? 1 : -1)));

const stats = computed(() => SECOND_CLASS_BLOCKS.map((b) => ({
  def: b, score: db.blockScore(b.key),
  over: b.key === active.value && db.blockScore(b.key) > b.fullScore
})));

/**
 * 大类抬头：基础/拓展分别的小计与上限、合计与满分，全部由条款记录实时汇总。
 * 需求原话：大类可以看到所有小类的信息并且有总和。
 */
const blockTotals = computed(() => SECOND_CLASS_BLOCKS.map((b) => {
  const mine = db.records.filter((r) => !r.deletedAt && r.block === b.key);
  const sumOf = (stage: 'basic' | 'extended') => Math.round(mine.filter((r) => r.stage === stage).reduce((a, r) => a + r.score, 0) * 2) / 2;
  const basic = sumOf('basic');
  const extended = sumOf('extended');
  const total = Math.round((basic + extended) * 2) / 2;
  return {
    def: b, basic, extended, total, count: mine.length,
    basicOver: basic > b.basicCap, extendedOver: extended > b.extendedCap, totalOver: total > b.fullScore,
    intro: chapterIntro(b.key)
  };
}));

/** 当前板块的"节 → 条款 → 该条款记录"三级结构（条款一条不落，全按手册顺序排） */
const clauseSections = computed(() => {
  if (active.value === 'all') return [];
  const bk = active.value as BlockKey;
  const defs = SECOND_CLASS_BLOCKS.find((x) => x.key === bk)!;
  return (['basic', 'extended'] as const).map((stage) => ({
    stage,
    label: (stage === 'basic' ? '第一节 基础评定' : '第二节 拓展评定') + '（上限 ' + (stage === 'basic' ? defs.basicCap : defs.extendedCap) + ' 分）',
    cap: stage === 'basic' ? defs.basicCap : defs.extendedCap,
    sum: Math.round(db.records.filter((r) => !r.deletedAt && r.block === bk && r.stage === stage).reduce((a, r) => a + r.score, 0) * 2) / 2,
    clauses: clausesOf(bk, stage).map((c) => {
      const recs = db.records.filter((r) => !r.deletedAt && r.clauseId === c.id);
      const legacy = db.records.filter((r) => !r.deletedAt && r.block === bk && r.stage === stage && !r.clauseId);
      const sum = Math.round(recs.reduce((a, r) => a + r.score, 0) * 2) / 2;
      return { c, recs, sum, over: typeof c.cap === 'number' && sum > c.cap };
    }),
    legacyCount: stage === 'basic' ? db.records.filter((r) => !r.deletedAt && r.block === bk && !r.clauseId).length : 0
  }));
});

/** 当前板块的抬头数据 */
const curTotal = computed(() => {
  const bk = active.value;
  return bk === 'all' ? null : blockTotals.value.find((x) => x.def.key === bk) || null;
});
/** 展开状态：默认收起，点条款行才展开它的记录 */
const openClauseIds = ref<string[]>([]);
function toggleClause(id: string): void {
  const i = openClauseIds.value.indexOf(id);
  if (i >= 0) openClauseIds.value.splice(i, 1); else openClauseIds.value.push(id);
}
function clauseSumOf(id: string): number {
  return Math.round(db.records.filter((r) => !r.deletedAt && r.clauseId === id).reduce((a, r) => a + r.score, 0) * 2) / 2;
}

/** 志愿时长统计（对应需求：像课表/记事本那样能累计）。 */
const HOUR_PRESETS = [1, 2, 3, 4, 6, 8, 10, 12, 20, 24];
const hourTotal = computed(() => Math.round(db.records.filter((r) => !r.deletedAt).reduce((a, r) => a + (r.hours || 0), 0) * 10) / 10);
const hourCount = computed(() => db.records.filter((r) => !r.deletedAt && (r.hours || 0) > 0).length);
const hourThisMonth = computed(() => {
  const m = new Date().toISOString().slice(0, 7);
  return Math.round(db.records.filter((r) => !r.deletedAt && (r.activityDate || '').startsWith(m)).reduce((a, r) => a + (r.hours || 0), 0) * 10) / 10;
});
const hourByBlock = computed(() => SECOND_CLASS_BLOCKS.map((b) => ({
  name: b.name,
  h: Math.round(db.records.filter((r) => !r.deletedAt && r.block === b.key).reduce((a, r) => a + (r.hours || 0), 0) * 10) / 10
})).filter((x) => x.h > 0));
/** 模板里避免嵌套引号：时长文案统一由这里生成。 */
function hoursText(r: SecondClassRecord): string {
  const h = (r && (r as any).hours) || 0;
  return h > 0 ? ' · 志愿时长 ' + h + ' 小时' : '';
}
function resetForm(clause?: HandbookClause): void {
  const bk = (clause ? clause.block : (active.value === 'all' ? 'de' : active.value)) as BlockKey;
  form.value = {
    block: bk,
    stage: clause ? clause.stage : 'basic',
    clauseId: clause ? clause.id : '',
    activityName: '', description: '', activityDate: dateStamp(),
    score: clause && clause.options && clause.options.length ? clause.options[0].score : 10,
    scorePreset: clause && clause.options && clause.options.length ? clause.options[0].label : '',
    hours: 0, watermark: db.settings.watermarkEnabledDefault, address: '', photos: []
  };
}
function openForm(): void { resetForm(); showForm.value = true; }
/** 从某一条条款直接开填：板块、节次、条款、预设分值都带过去 */
function openClause(c: HandbookClause): void { resetForm(c); showForm.value = true; }
/** 点手册给定的分值档（如"国家级 30"）直接带着分数开表单，少一次手输 */
/** 点手册分值档：填进当前表单，不重开，避免丢掉已选照片 */
function pickOption(o: { label: string; score: number }): void {
  form.value.score = o.score;
  form.value.scorePreset = o.label;
}
function openClauseWith(c: HandbookClause, o: { label: string; score: number }): void {
  resetForm(c);
  form.value.score = o.score;
  form.value.scorePreset = o.label;
  showForm.value = true;
}
const formClause = computed<HandbookClause | null>(() => clauseById(form.value.clauseId) || null);

/** 定位状态要在界面上看得见。旧写法 catch 后静默返回 null，用户只会发现"经纬度没了"。 */
const locState = ref({ text: '尚未定位', ok: false });
const manLat = ref(''); const manLng = ref('');

function manualCoords(): { lat: number | null; lng: number | null } {
  const la = parseFloat(manLat.value); const lo = parseFloat(manLng.value);
  if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) return { lat: la, lng: lo };
  return { lat: null, lng: null };
}

async function locate(): Promise<{ lat: number | null; lng: number | null; acc: number | null; error: string; from: 'gps' | 'network' | 'manual' | 'none' }> {
  const mc = manualCoords();
  if (mc.lat !== null && mc.lng !== null) {
    locState.value = { text: '使用手填坐标 ' + mc.lat.toFixed(5) + ', ' + mc.lng.toFixed(5), ok: true };
    return { lat: mc.lat, lng: mc.lng, acc: null, error: '', from: 'manual' };
  }
  // 先把权限要到手，并明确告知失败原因，而不是让插件抛个匿名异常
  try {
    const cur = await Geolocation.checkPermissions();
    if (cur.location !== 'granted' && cur.coarseLocation !== 'granted') {
      const req = await Geolocation.requestPermissions();
      if (req.location !== 'granted' && req.coarseLocation !== 'granted') {
        locState.value = { text: '定位权限未授予', ok: false };
        return { lat: null, lng: null, acc: null, error: '定位权限未授予（系统设置 → 应用 → Unimate → 权限 → 位置信息）', from: 'none' };
      }
    }
  } catch { /* 预览环境没有该插件，继续往下试 */ }
  // 之前是"先等 GPS 9 秒、失败再等网络 7 秒"，串行最坏 16 秒，界面上就一直转圈。
  // 改成两路**同时发起**，谁先回来用谁：室内通常网络定位 1~2 秒就能出，
  // 室外 GPS 也照样能抢到（它更快时）。总等待压到 5 秒内。
  const race = [
    Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 }).then((p) => ({ p, from: 'network' as const })),
    Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }).then((p) => ({ p, from: 'gps' as const }))
  ];
  let lastErr = '定位超时或系统未返回坐标';
  const winner = await Promise.race([
    (Promise as any).any ? (Promise as any).any(race.map((x) => x.catch(() => new Promise<never>(() => { })))) : race[0].catch(() => race[1]),
    new Promise<null>((r) => setTimeout(() => r(null), 5200))
  ]).catch(() => null);
  {
    const w: any = winner;
    try {
      if (!w) throw new Error(lastErr);
      const p = w.p;
      const acc = Math.round(p.coords.accuracy || 0);
      locState.value = { text: (w.from === 'gps' ? '卫星定位' : 'WiFi/基站定位') + ' ' + p.coords.latitude.toFixed(5) + ', ' + p.coords.longitude.toFixed(5) + (acc ? ' ±' + acc + 'm' : ''), ok: true };
      return { lat: p.coords.latitude, lng: p.coords.longitude, acc, error: '', from: w.from };
    } catch (e: any) { lastErr = (e && e.message) ? e.message : lastErr; }
  }
  locState.value = { text: '未取到坐标：' + lastErr, ok: false };
  return { lat: null, lng: null, acc: null, error: lastErr, from: 'none' };
}

async function relocate(): Promise<void> {
  locState.value = { text: '定位中…', ok: false };
  const r = await locate();
  db.notify(r.lat !== null ? '坐标已获取（' + (r.from === 'gps' ? '卫星' : '网络') + '）' : '仍未取到坐标：' + r.error);
}

async function addPhoto(source: 'camera' | 'gallery' | 'sample'): Promise<void> {
  if (form.value.photos.length >= 9) { db.notify('单条最多 9 张'); return; }
  busy.value = '处理中…';
  try {
    let base64 = '';
    let capturedAt = nowStamp();
    if (source === 'sample') {
      const c = document.createElement('canvas');
      c.width = 960; c.height = 640;
      const g = c.getContext('2d')!;
      g.fillStyle = '#2E5AAC'; g.fillRect(0, 0, 960, 640);
      g.fillStyle = 'rgba(255,255,255,.16)';
      for (let i = 0; i < 20; i++) { g.beginPath(); g.arc(70 + i * 45, 150 + (i % 4) * 110, 26, 0, Math.PI * 2); g.fill(); }
      base64 = c.toDataURL('image/jpeg', 0.85).split(',')[1];
    } else {
      // 关键：必须传 width/height。不传时 resultType:'base64' 会把千万像素原图整张编码成
      // 5~6MB 字符串过 JS 桥，部分 vivo/iQOO 机型直接卡死在"处理中"（真机已复现）。
      // 1600px 足够看清证书/现场照片上的文字，体积降到几百 KB。
      const photo = await Promise.race([
        Camera.getPhoto({
          resultType: 'base64', allowEditing: false,
          source: source === 'camera' ? CameraSource.Camera : CameraSource.PhotosLibrary,
          quality: 82, width: 1600, height: 1600, correctOrientation: true
        } as any),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('系统相册未在 45 秒内返回，请重试或改用拍照')), 45000))
      ]);
      base64 = (photo as any).base64String || (photo as any).base64 || '';
      if (!base64) throw new Error('没有拿到照片数据');
    }
    const loc = await locate();
    if (loc.lat === null) db.notify('本张照片未获取到经纬度：' + loc.error);
    const customText = (form.value.activityName || '第二课堂活动') + (db.settings.watermarkCustomText ? ' · ' + db.settings.watermarkCustomText : '');
    const wm = form.value.watermark
      ? await applyWatermark({
        base64, title: form.value.activityName, capturedAt, latitude: loc.lat, longitude: loc.lng,
        address: form.value.address, schoolBadge: db.profile!.watermark.schoolBadgeText,
        lines: db.settings.watermarkLines, customText, opacity: db.settings.watermarkOpacity
      })
      : { base64 };
    const id = uuid();
    const dir = 'schools/' + db.profile!.schoolId + '/users/' + db.session!.accountId + '/photos/' + new Date().getFullYear();
    const relW = dir + '/' + form.value.block + '-' + id + '.jpg';
    const relO = dir + '/' + form.value.block + '-' + id + '_src.jpg';
    await writeBinaryBase64(relW, wm.base64);
    await writeBinaryBase64(relO, base64);
    const ev: PhotoEvidence = {
      id, originalPath: relO, watermarkPath: relW, capturedAt,
      latitude: loc.lat, longitude: loc.lng, accuracyMeters: loc.acc,
      address: form.value.address, addressSource: form.value.address ? 'manual' : (loc.lat !== null ? 'coordinate-only' : 'none'),
      coordSource: (loc as any).from && (loc as any).from !== 'none' ? (loc as any).from : undefined,
      source: source === 'gallery' ? 'gallery' : 'camera', watermarked: form.value.watermark,
      originalSha256: await sha256Base64(base64), watermarkSha256: await sha256Base64(wm.base64),
      deviceLabel: navigator.userAgent.slice(0, 40), appVersion: '1.0.0'
    };
    await writeJson(dir + '/evidence/' + id + '.json', ev);
    form.value.photos.push({ ev, uri: 'data:image/jpeg;base64,' + wm.base64 });
    thumbs.value[ev.id] = 'data:image/jpeg;base64,' + wm.base64;
  } catch (e: any) {
    db.notify('相机不可用：' + (e?.message || '已取消') + '（可用"示例照片"演示）');
  } finally { busy.value = ''; }
}

async function saveRecord(): Promise<void> {
  const f = form.value;
  if (!f.activityName.trim()) { db.notify('请填写活动名称'); return; }
  if (!f.photos.length) { db.notify('至少添加 1 张照片'); return; }
  if (f.score <= 0 || f.score > 180) { db.notify('分数需在 0~180 之间'); return; }
  db.addRecord({
    block: f.block, stage: f.stage, clauseId: f.clauseId || '', activityName: f.activityName.trim(), description: f.description.trim(),
    activityDate: f.activityDate, score: Math.round(f.score * 2) / 2, scorePreset: f.scorePreset,
    hours: Math.round((Number(f.hours) || 0) * 10) / 10,
    photos: f.photos.map((p) => p.ev)
  });
  await db.saveData();
  showForm.value = false;
  active.value = f.block;
  const cl = clauseById(f.clauseId);
  db.notify('已保存：' + blockDef(f.block).name + (cl ? ' ' + clauseNo(cl) : '') + ' +' + f.score + ' 分' + (f.hours ? ' · ' + f.hours + ' 小时' : ''));
}

/** 删除走全局二次确认：二课记录带照片与存证，误删代价高。 */
async function askDelRecord(r: SecondClassRecord): Promise<void> {
  const ok = await db.confirm({
    title: '确认删除这条二课记录？',
    body: r.activityName + '｜' + blockDef(r.block).name + '｜自评 ' + r.score + ' 分',
    detail: r.activityDate + (r.hours ? ' · 志愿时长 ' + r.hours + ' 小时' : '')
      + ' · ' + r.photos.length + ' 张已存证照片。删除后本机移除且不可恢复；若只是想留档，建议先导出 zip。'
  });
  if (!ok) return;
  const i = db.records.findIndex((x) => x.id === r.id);
  if (i >= 0) db.records.splice(i, 1);
  await db.saveData();
  detail.value = null;
  db.notify('已删除「' + r.activityName + '」');
}

function thumb(p: PhotoEvidence): string { return thumbs.value[p.id] || ''; }

/** 详情打开时把该记录的照片全部读成 data URL（Android WebView 不能直接加载 file://） */
async function openDetail(r: SecondClassRecord): Promise<void> {
  detail.value = r;
  for (const p of r.photos) {
    if (thumbs.value[p.id]) continue;
    try { thumbs.value[p.id] = await fileUri(p.watermarked ? p.watermarkPath : p.originalPath); }
    catch { thumbs.value[p.id] = ''; }
  }
}

function copyEvidence(r: SecondClassRecord): void {
  const lines = r.photos.map((p) => [
    p.capturedAt, p.watermarked ? '有水印' : '无水印',
    p.latitude !== null ? p.latitude.toFixed(5) + ',' + p.longitude.toFixed(5) + (p.coordSource === 'manual' ? '（手填）' : p.coordSource === 'network' ? '（网络）' : '（卫星）') : '无坐标',
    p.address || '未填地址', 'sha256:' + p.watermarkSha256.slice(0, 16)
  ].join(' | ')).join('\n');
  const text = '【Unimate 第二课堂存证】' + r.activityName + '\n板块：' + blockDef(r.block).name + ' 自评分：' + r.score + '\n日期：' + r.activityDate + '\n' + lines +
    '\n—— 本记录由 Unimate 在本机生成，仅供材料自证，非学校官方认定';
  try { void navigator.clipboard?.writeText(text); db.notify('存证信息已复制'); } catch { db.notify(text); }
}

const total = computed(() => db.totalScore());
</script>

<template>
  <div class="scroll">

    <div class="modes3">
      <button v-if="hasErke" :class="{ on: sheet === 'erke' }" :aria-pressed="sheet === 'erke'" @click="sheet = 'erke'"><AppleIcon name="award" :size="16" />二课填报</button>
      <button :class="{ on: sheet === 'vol' }" :aria-pressed="sheet === 'vol'" @click="sheet = 'vol'"><AppleIcon name="handHeart" :size="16" />志愿时长</button>
      <button :class="{ on: sheet === 'labor' }" :aria-pressed="sheet === 'labor'" @click="sheet = 'labor'"><AppleIcon name="broom" :size="16" />劳育时长</button>
    </div>

    <HoursPanel v-if="sheet === 'vol'" kind="volunteer" label="志愿时长" />
    <HoursPanel v-if="sheet === 'labor'" kind="labor" label="劳育时长" />

    <!-- 没有第二课堂的学校：说明为什么不套用分值表，别让用户以为数据丢了或被"简化"了 -->
    <div v-if="!hasErke" class="card norule">
      <div class="bold">本校专属活动规则尚未核实</div>
      <div class="small muted" style="margin-top: 6px">{{ db.profile?.secondClass.notice }}</div>
    </div>

    <template v-if="sheet === 'erke' && hasErke">
    <div class="card sum">
      <div><div class="big-num">{{ total }}</div><div class="small muted">合计自评 / {{ TOTAL_FULL_SCORE }}</div></div>
      <div class="grow bars">
        <div v-for="s in stats" :key="s.def.key" class="brow" @click="active = s.def.key">
          <span class="bk">{{ s.def.name }}</span>
          <span class="progress grow"><i :style="{ width: Math.min(100, s.score / s.def.fullScore * 100) + '%', background: s.over ? 'var(--warn)' : 'var(--brand)' }"></i></span>
          <span class="small muted">{{ s.score }}/{{ s.def.fullScore }}</span>
        </div>
      </div>
    </div>

    <button class="btn block ghost" style="margin-bottom: 10px" @click="showRules = true">📖 手册分值表（板块上限 / 学科 / 体育 / 美育 / 计分条款）</button>
    <button class="btn block" style="margin-bottom: 10px" :disabled="exporting" @click="doExportAll">📤 导出全部二课材料包（照片 + 清单，用于填报学校系统）</button>
    <div v-if="lastExport" class="card exp">
      <div class="row"><b class="small grow">📦 {{ lastExport.fileName }}</b><button class="btn sm ghost" @click="doShare">分享</button></div>
      <div class="small muted" style="margin-top: 4px">{{ lastExport.photos }} 张照片 · 已保存到</div>
      <div class="small path">{{ lastExport.path }}</div>
        <div v-if="lastExport.hint" class="small muted" style="margin-top: 4px">{{ lastExport.hint }}</div>
    </div>

    <div class="chips" style="margin: 12px 0">
      <button class="chip sm" :class="{ on: active === 'all' }" @click="active = 'all'">全部</button>
      <button v-for="b in SECOND_CLASS_BLOCKS" :key="b.key" class="chip sm" :class="{ on: active === b.key }" @click="active = b.key">{{ b.name }} · {{ b.fullName }}</button>
    </div>

    <!-- 大类视图：抬头（基础/拓展/合计与各自上限）+ 手册逐条填写。
         需求原话：不要用简化版、每一条都写上、每个小条能单独填写、大类能看到所有小条与总和。 -->
    <template v-if="curTotal">
      <div class="card blkhead">
        <div class="row" style="align-items: flex-end; gap: 10px">
          <div><div class="hnum">{{ curTotal.total }}</div><div class="small muted">合计自评 / {{ curTotal.def.fullScore }}</div></div>
          <div class="grow" style="text-align: right">
            <div class="small">基础 <b>{{ curTotal.basic }}</b> / {{ curTotal.def.basicCap }}　拓展 <b>{{ curTotal.extended }}</b> / {{ curTotal.def.extendedCap }}</div>
            <div class="small muted">{{ curTotal.def.fullName }}评定 · {{ curTotal.count }} 条记录</div>
          </div>
        </div>
        <div v-if="curTotal.intro" class="small muted intro" :class="{ open: introOpen }">{{ curTotal.intro.text }}</div>
        <button v-if="curTotal.intro" class="btn sm ghost introbtn" @click="introOpen = !introOpen">{{ introOpen ? '收起简介' : '展开完整简介' }}</button>
        <div v-if="curTotal.totalOver" class="small warn">合计已超过本章满分，按满分计算。</div>
      </div>

      <div v-for="sec in clauseSections" :key="sec.stage" class="sec">
        <div class="sechead">
          <span class="grow small bold">{{ sec.label }}</span>
          <span class="small muted">小计 {{ sec.sum }} / {{ sec.cap }}</span>
        </div>
        <div v-if="sec.stage === 'basic' && sec.legacyCount" class="legacy small">
          另有 {{ sec.legacyCount }} 条未对应条款的旧记录，已计入板块合计；点上方「全部」可查看明细。
        </div>
        <div v-for="row in sec.clauses" :key="row.c.id" class="clause">
          <div class="crow" @click="toggleClause(row.c.id)">
            <div class="grow cmain">
              <div class="ctop"><b>{{ clauseNo(row.c) }}</b><span class="ctitle">{{ row.c.title }}</span></div>
              <div class="small muted cunit">{{ row.c.unit }}<span v-if="row.c.cap"> · 上限 {{ row.c.cap }} 分</span></div>
            </div>
            <div class="csum" :class="{ over: row.over }">{{ row.sum }}<span v-if="row.c.cap" class="small muted"> / {{ row.c.cap }}</span></div>
            <button class="btn sm cbtn" @click.stop="openClause(row.c)">记一条</button>
            <span class="chev">{{ openClauseIds.includes(row.c.id) ? '▾' : '▸' }}</span>
          </div>
          <div v-if="openClauseIds.includes(row.c.id)" class="cbody">
            <div class="ctext">{{ row.c.text }}</div>
            <div v-if="row.c.options && row.c.options.length" class="chips">
              <button v-for="o in row.c.options" :key="o.label" class="chip sm" @click.stop="openClauseWith(row.c, o)">{{ o.label }} {{ o.score }}</button>
            </div>
            <div v-if="!row.recs.length" class="small muted" style="padding: 2px 0 4px">这一条还没有记录</div>
            <div v-for="r in row.recs" :key="r.id" class="crec" @click.stop="openDetail(r)">
              <span class="grow small">{{ r.activityName }}<span class="muted"> · {{ r.activityDate }} · {{ r.photos.length }} 张存证照片</span></span>
              <b class="score">+{{ r.score }}</b>
            </div>
          </div>
        </div>
      </div>
    </template>

      <div v-if="!records.length" class="empty"><AppleIcon class="big empty-award" name="award" :size="34" />还没有填报记录<div class="small">选一个板块，逐条点「记一条」；或点右下角自由填报</div></div>

    <div v-if="hourCount" class="card hoursum">
      <div class="row" style="align-items: flex-end; gap: 10px">
        <div><div class="hnum">{{ hourTotal }}</div><div class="small muted">累计志愿时长（小时）</div></div>
        <div class="grow" style="text-align: right">
          <div class="small">本月 {{ hourThisMonth }} 小时 · 有时长记录 {{ hourCount }} 条</div>
          <div v-for="hb in hourByBlock" :key="hb.name" class="small muted">{{ hb.name }} {{ hb.h }} 小时</div>
        </div>
      </div>
    </div>
    <div v-if="active === 'all'" v-for="r in records" :key="r.id" class="card rec" @click="openDetail(r)">
      <div class="tag">{{ blockDef(r.block).name }}</div>
      <div class="grow">
        <div class="bold">{{ r.activityName }}</div>
        <div class="small muted">{{ r.activityDate }}<span v-if="r.hours"> · 志愿时长 <b>{{ r.hours }} 小时</b></span> · {{ r.photos.length }} 张照片 · {{ r.photos.every((p) => p.watermarked) ? '全部有水印' : '含无水印照片' }}</div>
      </div>
      <div class="score">+{{ r.score }}</div>
    </div>

    <div class="disclaim small muted">分数为你自行填报与自评，上限依据《北京化工大学本科生学生手册》第二课堂五部分评定分值，不代表学校官方认定结果。</div>
    </template>
  </div>

  <RuleTables v-if="showRules" @close="showRules = false" />
  <ImageViewer v-if="viewer" :items="viewer.items" :start="viewer.index" @close="viewer = null" />

  <button v-if="sheet === 'erke' && hasErke" class="fab" @click="openForm">填报<br />活动</button>

  <div v-if="busy" class="busy">{{ busy }}</div>

  <div v-if="showForm" class="mask" @click.self="showForm = false">
    <div class="sheet">
      <div class="title">第二课堂填报</div>
      <div class="hairline"></div>
      <div class="field"><label>选择板块</label>
        <div class="chips"><button v-for="b in SECOND_CLASS_BLOCKS" :key="b.key" class="chip" :class="{ on: form.block === b.key }" @click="form.block = b.key">{{ b.name }} {{ b.fullName }}</button></div>
      </div>
      <div v-if="formClause" class="clausectx">
        <div class="small bold">{{ clauseNo(formClause) }} · {{ formClause.title }}</div>
        <div class="small muted">{{ formClause.text }}</div>
        <div v-if="formClause.cap" class="small">该条上限 {{ formClause.cap }} 分（本条已填 {{ clauseSumOf(formClause.id) }} 分）</div>
      </div>
      <div v-else-if="form.clauseId === '' && form.block" class="small muted" style="margin: 2px 0 8px">
        未指定条款时记作自由填报，仍会计入所选板块合计；建议从板块页对应条款点「记一条」，学校填报时更好核对。
      </div>
      <div class="field"><label>活动名称（必填）</label><input v-model="form.activityName" maxlength="40" placeholder="如：社区志愿服务" /></div>
      <div class="field"><label>描述（选填）</label><textarea v-model="form.description" rows="2" maxlength="300"></textarea></div>
      <div class="grid2">
        <div class="field"><label>活动时间</label><input v-model="form.activityDate" type="date" /></div>
        <div class="field"><label>基础 / 拓展</label>
          <select v-model="form.stage"><option value="basic">基础评定</option><option value="extended">拓展评定</option></select>
        </div>
      </div>
      <div class="field"><label>志愿 / 活动时长（小时，选填）</label>
        <div class="chips"><button v-for="h in HOUR_PRESETS" :key="h" class="chip sm" :class="{ on: form.hours === h }" @click="form.hours = h">{{ h }} 小时</button></div>
        <div class="row" style="margin-top: 8px">
          <input v-model.number="form.hours" type="number" min="0" max="400" step="0.5" style="flex: 1; padding: 10px; border: 1px solid var(--line); border-radius: 10px" />
          <span class="small muted">0 ~ 400，0.5 小时步进；用于志愿时长统计与填报</span>
        </div>
      </div>      <div class="field"><label>照片（含水印，最多 9 张）</label>
        <div class="row" style="gap: 8px; margin-bottom: 8px">
          <button class="btn sm grow" @click="addPhoto('camera')">📷 拍照</button>
          <button class="btn sm grey grow" @click="addPhoto('gallery')">🖼 相册</button>
          <button class="btn sm ghost grow" @click="addPhoto('sample')">示例照片</button>
        </div>
        <div class="photos">
          <div v-for="(p, i) in form.photos" :key="p.ev.id" class="ph">
            <img :src="p.uri" @click="openViewer(form.photos.map((x) => ({ url: x.uri, title: x.ev.watermarked ? '水印照片' : '原图', sub: x.ev.capturedAt })), i)" />
            <span v-if="!p.ev.watermarked" class="nw">无水印</span>
            <button class="rm" @click="form.photos.splice(i, 1)">×</button>
          </div>
        </div>
      </div>
      <div class="card" style="box-shadow: none; background: var(--soft)">
        <div class="row" style="justify-content: space-between"><span class="small bold">拍照水印（自主开关）</span>
          <button class="chip sm" :class="{ on: form.watermark }" @click="form.watermark = !form.watermark">{{ form.watermark ? '已开启' : '已关闭' }}</button>
        </div>
        <div class="small muted" style="margin-top: 6px">将烧录：{{ db.settings.watermarkLines.time ? '拍摄时间 ' : '' }}{{ db.settings.watermarkLines.coordinate ? '经纬度 ' : '' }}{{ db.settings.watermarkLines.custom ? '自定义文字 ' : '' }}{{ db.settings.watermarkLines.address && form.address ? '地址 ' : '' }}校名角标。不依赖任何第三方地图服务。</div>
        <div class="locrow">
          <span class="locdot" :class="{ ok: locState.ok }"></span>
          <span class="small grow">{{ locState.text }}</span>
          <button class="btn sm ghost" @click="relocate">重新定位</button>
        </div>
        <div class="row" style="gap: 8px; margin-top: 8px">
          <input v-model="manLat" class="addr grow" placeholder="纬度（手填可覆盖，选填）" inputmode="decimal" />
          <input v-model="manLng" class="addr grow" placeholder="经度" inputmode="decimal" />
        </div>
        <div class="small muted" style="margin-top: 4px">手填坐标会在水印与存证里标为 manual，与卫星定位区分开，不冒充 GPS。</div>
        <input v-model="form.address" class="addr" style="margin-top: 8px" placeholder="地址（选填，本机手写，不做逆地理编码）" />
      </div>
      <div class="field" style="margin-top: 12px"><label>自评分数</label>
        <div class="chips"><button v-for="s in QUICK_SCORES" :key="s" class="chip sm" :class="{ on: form.score === s }" @click="form.score = s">{{ s }} 分</button></div>
        <div class="row" style="margin-top: 8px">
          <input v-model.number="form.score" type="number" min="0" max="180" step="0.5" style="flex: 1; padding: 10px; border: 1px solid var(--line); border-radius: 10px" />
          <span class="small muted">0 ~ 180，0.5 分步进</span>
        </div>
        <div class="chips" style="margin-top: 8px">
          <button v-for="p in SCORE_PRESETS" :key="p.label" class="chip sm" @click="form.score = p.score; form.scorePreset = p.label">{{ p.score }}·{{ p.label }}</button>
        </div>
      <div v-if="formClause && formClause.options && formClause.options.length" class="field">
        <label>该条手册给定的分值档（点一下即填入）</label>
        <div class="chips">
          <button v-for="o in formClause.options" :key="o.label" class="chip sm" :class="{ on: form.scorePreset === o.label }" @click="pickOption(o)">{{ o.label }} {{ o.score }}</button>
        </div>
      </div>
      </div>
      <div class="row">
        <button class="btn grow" @click="saveRecord">保存</button>
        <button class="btn ghost grow" @click="showForm = false">取消</button>
      </div>
    </div>
  </div>

  <div v-if="detail" class="mask" @click.self="detail = null">
    <div class="sheet">
      <div class="row"><div class="tag">{{ blockDef(detail.block).name }}</div><div class="title grow">{{ detail.activityName }}</div><div class="score">+{{ detail.score }}</div></div>
      <div class="hairline"></div>
      <div class="small muted">{{ detail.activityDate }}{{ hoursText(detail) }} · {{ blockDef(detail.block).fullName }} · {{ detail.stage === 'basic' ? '基础评定' : '拓展评定' }}</div>
      <p v-if="detail.description">{{ detail.description }}</p>
      <div class="photos big-p">
        <div v-for="p in detail.photos" :key="p.id">
          <img v-if="thumb(p)" :src="thumb(p)" @click="openViewer(detail.photos.map((x) => ({ url: thumb(x), title: detail.activityName, sub: x.capturedAt + (x.watermarked ? ' · 有水印' : ' · 无水印') })), detail.photos.indexOf(p))" />
          <div v-else class="ph-missing">🖼<br />照片未找到<br /><span class="small">{{ p.capturedAt }}</span></div>
          <span class="small muted">{{ p.capturedAt }} · {{ p.watermarked ? '有水印' : '无水印' }}</span>
        </div>
      </div>
      <div class="row" style="margin-top: 12px">
        <button class="btn grow" :disabled="exporting" @click="doExportRecord(detail)">导出本条(zip)</button>
        <button class="btn grey grow" @click="copyEvidence(detail)">复制存证</button>
        <button class="btn danger grow" @click="askDelRecord(detail)">删除</button>
      </div>
      <div class="small muted" style="margin-top: 8px">点照片可放大；长按照片可单独存到手机存储：</div>
      <div class="row" style="flex-wrap: wrap; gap: 6px; margin-top: 6px">
        <button v-for="(p, i) in detail.photos" :key="p.id" class="btn sm ghost" @click="doSaveOne(detail, i)">存第 {{ i + 1 }} 张</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 悬浮「填报活动」按钮固定在右下角（.fab：bottom 74px + 高 56px），
   滚动区底部必须留出比它更高的余量：否则滚到底时，最后几条条款的「记一条」
   永远被它压住、点不到（真机截图里"第三十七条"就是这么被挡的）。 */
.scroll { padding-bottom: calc(152px + var(--safe-b)); }
/* 手册条款树 */
.blkhead { margin-bottom: 10px; }
.blkhead .intro { margin-top: 8px; line-height: 1.65; max-height: 3.3em; overflow: hidden; }
/* 简介原先硬截断到 3.3em 且没有任何展开入口，真机截图里就是"以美育人、以美化人、以美"戛然而止。
   要么给完整内容，要么给能点开的入口 —— 这里给两行 + 「展开完整简介」。 */
.blkhead .intro.open { max-height: none; }
.introbtn { margin-top: 6px; }
.warn { color: var(--warn); margin-top: 6px; }
.sec { margin: 14px 0 6px; }
.sechead { display: flex; align-items: center; gap: 8px; padding: 6px 2px; border-bottom: 1px solid var(--line); }
.legacy { padding: 7px 9px; margin: 6px 0; background: var(--tint); border-radius: 9px; line-height: 1.55; }
.clause { border-bottom: 1px dashed var(--line); }
.crow { display: flex; align-items: center; gap: 8px; padding: 9px 2px; }
/* 条款行必须能"挤"：中文在 flex 里的最小宽度只有一个字，
   不给 .grow 显式 min-width:0，长标题就会把右边的分数与按钮压到竖排换行（真机截图里的"记一/条"）。 */
.cmain { min-width: 0; }
.ctop { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.ctop b { font-size: 12px; color: var(--brand); flex: none; }
.ctitle { font-size: 13.5px; font-weight: 600; min-width: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.cunit { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 分数与「记一条」都不参与压缩，否则会被压窄成两行 */
.csum { font-size: 15px; font-weight: 700; flex: none; min-width: 42px; text-align: right; }
.csum.over { color: var(--warn); }
.cbtn { flex: none; white-space: nowrap; }
.chev { font-size: 11px; color: var(--muted); flex: none; width: 12px; text-align: center; }
.cbody { padding: 0 2px 10px; }
.ctext { font-size: 12px; line-height: 1.7; color: var(--muted); background: var(--soft); border-radius: 9px; padding: 8px 10px; margin-bottom: 7px; }
.crec { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 9px; background: var(--soft-2); margin-top: 5px; }
.clausectx { background: var(--soft); border-radius: 10px; padding: 9px 11px; margin: 8px 0; }
.clausectx .small { line-height: 1.65; }
.modes3 { display: flex; gap: 2px; margin-bottom: 16px; padding: 2px; border-radius: 10px; background: var(--soft-2); }
.modes3 button { flex: 1; min-width: 0; min-height: 38px; padding: 6px 3px; border-radius: 8px; color: var(--muted); font-size: 12px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 4px; transition: color .18s ease, background-color .18s ease, box-shadow .18s ease; }
.modes3 button.on { background: var(--card); color: var(--text); box-shadow: 0 1px 3px rgba(0, 0, 0, .14); }
.empty-award { margin: 0 auto 8px; color: var(--muted); }
@media (prefers-reduced-motion: reduce) { .modes3 button { transition: none; } }
/* 没有第二课堂的学校：这条说明替代了原来的分值表与填报入口 */
.norule { background: var(--soft); box-shadow: none; line-height: 1.7; }
.big-num { font-size: 30px; font-weight: 800; color: var(--brand); line-height: 1.1; }
.bars { display: flex; flex-direction: column; gap: 5px; }
.brow { display: flex; align-items: center; gap: 8px; }
.bk { width: 16px; font-weight: 700; font-size: 13px; }
.rec { display: flex; gap: 10px; align-items: center; }
.tag { width: 34px; height: 34px; border-radius: 10px; background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; flex: none; }
.score { font-size: 19px; font-weight: 800; color: var(--brand-2); }
.hints { background: #FFF9EC; }
.hoursum { background: #F3F8F5; border: 1px solid #D6E7DC; }
.hnum { font-size: 26px; font-weight: 800; color: #2F7A52; line-height: 1.1; }
.disclaim { padding: 14px 6px; line-height: 1.6; }
.photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.ph { position: relative; }
.ph img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 10px; }
.rm { position: absolute; right: 4px; top: 4px; width: 22px; height: 22px; border-radius: 50%; background: rgba(0, 0, 0, .55); color: #fff; font-size: 14px; }
.nw { position: absolute; left: 4px; bottom: 4px; font-size: 10px; background: rgba(0, 0, 0, .6); color: #fff; padding: 1px 5px; border-radius: 6px; }
.big-p img { width: 100%; border-radius: 10px; cursor: pointer; }
.ph img { cursor: pointer; }
.locrow { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.locdot { width: 8px; height: 8px; border-radius: 50%; background: #C9CED6; flex: none; }
.locdot.ok { background: #2FA35C; }
.addr { width: 100%; margin-top: 8px; padding: 9px 10px; border: 1px solid var(--line); border-radius: 9px; }
.exp { background: var(--soft); box-shadow: none; }
.path { word-break: break-all; color: var(--strong); }
.ph-missing { width: 100%; aspect-ratio: 1.4; border-radius: 10px; background: #F0F2F5; color: var(--muted); display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 12px; text-align: center; }
.busy { position: fixed; inset: 0; background: rgba(0, 0, 0, .25); display: flex; align-items: center; justify-content: center; color: #fff; z-index: 80; }
</style>
