<script setup lang="ts">
import { computed, ref } from 'vue';
import RuleTables from './RuleTables.vue';
import { exportRecordZip, exportAllZip, savePhotoToDevice, shareFile } from '../services/export.ts';
import ImageViewer from '../components/ImageViewer.vue';
import { Camera, CameraSource } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import { useDb } from '../stores/db.ts';
import { BLOCK_HINTS, QUICK_SCORES, SCORE_PRESETS, SECOND_CLASS_BLOCKS, TOTAL_FULL_SCORE, blockDef } from '../catalog/secondClass.ts';
import { applyWatermark } from '../services/watermark.ts';
import { writeBinaryBase64, writeJson, fileUri } from '../services/io.ts';
import { sha256Base64 } from '../services/crypto.ts';
import { uuid, nowStamp, dateStamp } from '../services/id.ts';
import type { BlockKey, PhotoEvidence, SecondClassRecord } from '../types.ts';

const db = useDb();
const active = ref<BlockKey | 'all'>('all');
const showForm = ref(false);
const detail = ref<SecondClassRecord | null>(null);
const busy = ref('');
const thumbs = ref<Record<string, string>>({});
const showRules = ref(false);
const exporting = ref(false);
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
  block: 'de' as BlockKey, stage: 'basic' as 'basic' | 'extended', activityName: '', description: '',
  activityDate: dateStamp(), score: 10, scorePreset: '', watermark: true, address: '', photos: [] as { ev: PhotoEvidence; uri: string }[]
});

const records = computed(() => db.records
  .filter((r) => !r.deletedAt && (active.value === 'all' || r.block === active.value))
  .sort((a, b) => (a.activityDate < b.activityDate ? 1 : -1)));

const stats = computed(() => SECOND_CLASS_BLOCKS.map((b) => ({
  def: b, score: db.blockScore(b.key),
  over: b.key === active.value && db.blockScore(b.key) > b.fullScore
})));

function resetForm(): void {
  form.value = { block: (active.value === 'all' ? 'de' : active.value) as BlockKey, stage: 'basic', activityName: '', description: '', activityDate: dateStamp(), score: 10, scorePreset: '', watermark: db.settings.watermarkEnabledDefault, address: '', photos: [] };
}
function openForm(): void { resetForm(); showForm.value = true; }

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
  // 室内 GPS 常常 8 秒定不出来，先高精度再退到 WiFi/基站定位，别一次失败就放弃
  const attempts: { opt: any; from: 'gps' | 'network' }[] = [
    { opt: { enableHighAccuracy: true, timeout: 9000, maximumAge: 0 }, from: 'gps' },
    { opt: { enableHighAccuracy: false, timeout: 7000, maximumAge: 300000 }, from: 'network' }
  ];
  let lastErr = '定位超时或系统未返回坐标';
  for (const a of attempts) {
    try {
      const p = await Geolocation.getCurrentPosition(a.opt);
      const acc = Math.round(p.coords.accuracy || 0);
      locState.value = { text: (a.from === 'gps' ? '卫星定位' : 'WiFi/基站定位') + ' ' + p.coords.latitude.toFixed(5) + ', ' + p.coords.longitude.toFixed(5) + (acc ? ' ±' + acc + 'm' : ''), ok: true };
      return { lat: p.coords.latitude, lng: p.coords.longitude, acc, error: '', from: a.from };
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
      const p = await Camera.getPhoto({
        resultType: 'base64', allowEditing: false,
        source: source === 'camera' ? CameraSource.Camera : CameraSource.PhotosLibrary,
        quality: 85
      } as any);
      base64 = (p as any).base64String || (p as any).base64 || '';
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
    block: f.block, stage: f.stage, activityName: f.activityName.trim(), description: f.description.trim(),
    activityDate: f.activityDate, score: Math.round(f.score * 2) / 2, scorePreset: f.scorePreset,
    photos: f.photos.map((p) => p.ev)
  });
  await db.saveData();
  showForm.value = false;
  active.value = f.block;
  db.notify('已保存：' + blockDef(f.block).name + ' +' + f.score + ' 分');
}

async function delRecord(r: SecondClassRecord): Promise<void> {
  const i = db.records.findIndex((x) => x.id === r.id);
  if (i >= 0) db.records.splice(i, 1);
  await db.saveData();
  detail.value = null;
  db.notify('记录已删除');
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

    <div v-if="active !== 'all'" class="card hints">
      <div class="small bold" style="margin-bottom: 6px">{{ blockDef(active as BlockKey).fullName }} · 手册常见计分档</div>
      <div v-for="(h, i) in BLOCK_HINTS[active as BlockKey]" :key="i" class="small muted">· {{ h }}</div>
    </div>

    <div v-if="!records.length" class="empty"><div class="big">🏅</div>还没有填报记录<div class="small">点右下角「填报活动」</div></div>

    <div v-for="r in records" :key="r.id" class="card rec" @click="openDetail(r)">
      <div class="tag">{{ blockDef(r.block).name }}</div>
      <div class="grow">
        <div class="bold">{{ r.activityName }}</div>
        <div class="small muted">{{ r.activityDate }} · {{ r.photos.length }} 张照片 · {{ r.photos.every((p) => p.watermarked) ? '全部有水印' : '含无水印照片' }}</div>
      </div>
      <div class="score">+{{ r.score }}</div>
    </div>

    <div class="disclaim small muted">分数为你自行填报与自评，上限依据《北京化工大学本科生学生手册》第二课堂五部分评定分值，不代表学校官方认定结果。</div>
  </div>

  <RuleTables v-if="showRules" @close="showRules = false" />
  <ImageViewer v-if="viewer" :items="viewer.items" :start="viewer.index" @close="viewer = null" />

  <button class="fab" @click="openForm">填报<br />活动</button>
  <div v-if="busy" class="busy">{{ busy }}</div>

  <div v-if="showForm" class="mask" @click.self="showForm = false">
    <div class="sheet">
      <div class="title">第二课堂填报</div>
      <div class="hairline"></div>
      <div class="field"><label>选择板块</label>
        <div class="chips"><button v-for="b in SECOND_CLASS_BLOCKS" :key="b.key" class="chip" :class="{ on: form.block === b.key }" @click="form.block = b.key">{{ b.name }} {{ b.fullName }}</button></div>
      </div>
      <div class="field"><label>活动名称（必填）</label><input v-model="form.activityName" maxlength="40" placeholder="如：社区志愿服务" /></div>
      <div class="field"><label>描述（选填）</label><textarea v-model="form.description" rows="2" maxlength="300"></textarea></div>
      <div class="grid2">
        <div class="field"><label>活动时间</label><input v-model="form.activityDate" type="date" /></div>
        <div class="field"><label>基础 / 拓展</label>
          <select v-model="form.stage"><option value="basic">基础评定</option><option value="extended">拓展评定</option></select>
        </div>
      </div>
      <div class="field"><label>照片（含水印，最多 9 张）</label>
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
      <div class="card" style="box-shadow: none; background: #F7F9FC">
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
      <div class="small muted">{{ detail.activityDate }} · {{ blockDef(detail.block).fullName }} · {{ detail.stage === 'basic' ? '基础评定' : '拓展评定' }}</div>
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
        <button class="btn danger grow" @click="delRecord(detail)">删除</button>
      </div>
      <div class="small muted" style="margin-top: 8px">点照片可放大；长按照片可单独存到手机存储：</div>
      <div class="row" style="flex-wrap: wrap; gap: 6px; margin-top: 6px">
        <button v-for="(p, i) in detail.photos" :key="p.id" class="btn sm ghost" @click="doSaveOne(detail, i)">存第 {{ i + 1 }} 张</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sum { display: flex; gap: 14px; align-items: center; }
.big-num { font-size: 30px; font-weight: 800; color: var(--brand); line-height: 1.1; }
.bars { display: flex; flex-direction: column; gap: 5px; }
.brow { display: flex; align-items: center; gap: 8px; }
.bk { width: 16px; font-weight: 700; font-size: 13px; }
.rec { display: flex; gap: 10px; align-items: center; }
.tag { width: 34px; height: 34px; border-radius: 10px; background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; flex: none; }
.score { font-size: 19px; font-weight: 800; color: var(--brand-2); }
.hints { background: #FFF9EC; }
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
.exp { background: #F7F9FC; box-shadow: none; }
.path { word-break: break-all; color: #3A424E; }
.ph-missing { width: 100%; aspect-ratio: 1.4; border-radius: 10px; background: #F0F2F5; color: var(--muted); display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 12px; text-align: center; }
.busy { position: fixed; inset: 0; background: rgba(0, 0, 0, .25); display: flex; align-items: center; justify-content: center; color: #fff; z-index: 80; }
</style>