<script setup lang="ts">
// ============================================================================
// 时长台账（志愿 / 劳育共用一套，按 8 个学期分组统计）
// 本app为果崇舜，刘佳乐，赵梓缘三人共同开发，未经允许，不得擅自使用。
//
// 与"第二课堂自评分"是两套独立口径：这里记的是**小时**，那边记的是**分**。
// ============================================================================
import { computed, onMounted, ref, watch } from 'vue';
import { Camera, CameraSource } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import { useDb } from '../stores/db.ts';
import { applyWatermark } from '../services/watermark.ts';
import { writeBinaryBase64, writeJson, fileUri } from '../services/io.ts';
import { sha256Base64 } from '../services/crypto.ts';
import { uuid, nowStamp, dateStamp } from '../services/id.ts';
import { SEMESTERS, type HourEntry, type HourKind, type PhotoEvidence, type Semester } from '../types.ts';
import ImageViewer, { type ViewerItem } from '../components/ImageViewer.vue';

const props = defineProps<{ kind: HourKind; label: string }>();
const db = useDb();

const HOUR_CHIPS = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 30, 40, 50];
const mine = computed(() => db.hours.filter((x) => x.kind === props.kind && !x.deletedAt));
const total = computed(() => Math.round(mine.value.reduce((a, x) => a + (x.hours || 0), 0) * 10) / 10);
const thisYear = computed(() => {
  const y = String(new Date().getFullYear());
  return Math.round(mine.value.filter((x) => (x.date || '').startsWith(y)).reduce((a, x) => a + (x.hours || 0), 0) * 10) / 10;
});

/** 8 个学期固定做小标题，没记的也显示 0，方便一眼看出哪个学期还空着。 */
const groups = computed(() => SEMESTERS.map((s) => {
  const list = mine.value.filter((x) => x.semester === s).sort((a, b) => (a.date < b.date ? 1 : -1));
  return { semester: s as Semester, list, sum: Math.round(list.reduce((a, x) => a + (x.hours || 0), 0) * 10) / 10 };
}));

/** 记住上次用的学期，连续录入时少点一次。 */
const lastSemester = ref<Semester>('大一上');
/** 列表缩略图缓存：Android WebView 不能直接加载 file://，必须转 data URL。 */
const thumbs = ref<Record<string, string>>({});
async function loadThumbs(): Promise<void> {
  for (const e of mine.value) {
    for (const p of e.photos) {
      if (thumbs.value[p.id]) continue;
      try { thumbs.value[p.id] = await fileUri(p.watermarkPath); } catch { /* 缺文件就留空 */ }
    }
  }
}
onMounted(loadThumbs);
watch(() => db.hours, loadThumbs, { deep: true });
watch(() => form.value.semester, (v) => { if (v) lastSemester.value = v; });
// ---------------- 新建 ----------------
const showForm = ref(false);
const busy = ref('');
const form = ref({ semester: '大一上' as Semester, title: '', hours: 0, date: dateStamp(), note: '', photos: [] as { ev: PhotoEvidence; uri: string }[] });
function openForm(): void {
  form.value = { semester: lastSemester.value, title: '', hours: 0, date: dateStamp(), note: '', photos: [] };
  showForm.value = true;
}
/** 选填项再点一次取消：时长为 0 时点同一个 chip 归零。 */
function pickHours(h: number): void { form.value.hours = form.value.hours === h ? 0 : h; }

async function locate(): Promise<{ lat: number | null; lng: number | null; from: string }> {
  try {
    const race = [
      Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 }).then((p) => ({ p, from: 'network' })),
      Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }).then((p) => ({ p, from: 'gps' }))
    ];
    const w: any = await Promise.race([
      (Promise as any).any(race.map((x) => x.catch(() => new Promise<never>(() => { })))),
      new Promise<null>((r) => setTimeout(() => r(null), 5200))
    ]).catch(() => null);
    if (!w) return { lat: null, lng: null, from: 'none' };
    return { lat: w.p.coords.latitude, lng: w.p.coords.longitude, from: w.from };
  } catch { return { lat: null, lng: null, from: 'none' }; }
}

async function addPhoto(source: 'camera' | 'gallery'): Promise<void> {
  if (form.value.photos.length >= 9) { db.notify('单条最多 9 张'); return; }
  busy.value = '处理中…';
  try {
    const ph = await Promise.race([
      Camera.getPhoto({
        resultType: 'base64', allowEditing: false,
        source: source === 'camera' ? CameraSource.Camera : CameraSource.PhotosLibrary,
        quality: 82, width: 1600, height: 1600, correctOrientation: true
      } as any),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('系统未在 45 秒内返回照片，请重试')), 45000))
    ]);
    const b64 = (ph as any).base64String || (ph as any).base64 || '';
    if (!b64) throw new Error('没有拿到照片数据');
    const loc = await locate();
    const capturedAt = nowStamp();
    const custom = (form.value.title || props.label) + (db.settings.watermarkCustomText ? ' · ' + db.settings.watermarkCustomText : '');
    const wm = await applyWatermark({
      base64: b64, title: form.value.title || props.label, capturedAt,
      latitude: loc.lat, longitude: loc.lng, address: '',
      schoolBadge: db.profile!.watermark.schoolBadgeText,
      lines: db.settings.watermarkLines, customText: custom, opacity: db.settings.watermarkOpacity
    });
    const id = uuid();
    const dir = 'schools/' + db.profile!.schoolId + '/users/' + db.session!.accountId + '/photos/' + new Date().getFullYear();
    const relW = dir + '/' + props.kind + '-' + id + '.jpg';
    const relO = dir + '/' + props.kind + '-' + id + '_src.jpg';
    await writeBinaryBase64(relW, wm.base64);
    await writeBinaryBase64(relO, b64);
    const ev: PhotoEvidence = {
      id, originalPath: relO, watermarkPath: relW, capturedAt,
      latitude: loc.lat, longitude: loc.lng, accuracyMeters: loc.lat ? 30 : null,
      address: '', addressSource: loc.lat ? 'coordinate-only' : 'none',
      source: source === 'gallery' ? 'gallery' : 'camera', watermarked: true,
      coordSource: (loc.from === 'gps' || loc.from === 'network') ? loc.from : undefined,
      originalSha256: await sha256Base64(b64), watermarkSha256: await sha256Base64(wm.base64),
      deviceLabel: navigator.userAgent.slice(0, 40), appVersion: '1.0.0'
    } as PhotoEvidence;
    await writeJson(dir + '/evidence/' + id + '.json', ev);
    form.value.photos.push({ ev, uri: 'data:image/jpeg;base64,' + wm.base64 });
    if (!loc.lat) db.notify('这张没取到经纬度，水印里不会有时空信息');
  } catch (e: any) {
    db.notify('取图失败：' + ((e && e.message) || e));
  } finally { busy.value = ''; }
}

async function save(): Promise<void> {
  const f = form.value;
  if (!f.title.trim()) { db.notify('请填写事项名称'); return; }
  if (!f.hours || f.hours <= 0) { db.notify('请填写时长（小时）'); return; }
  db.addHour({
    kind: props.kind, semester: f.semester, title: f.title.trim(),
    hours: Math.round(f.hours * 10) / 10, date: f.date, note: f.note.trim(),
    photos: f.photos.map((p) => p.ev)
  });
  await db.saveData();
  showForm.value = false;
  db.notify('已记 ' + f.hours + ' 小时 · ' + f.semester);
}

const pendingDel = ref<HourEntry | null>(null);
async function doDel(): Promise<void> {
  const e = pendingDel.value; if (!e) return;
  db.removeHour(e.id);
  await db.saveData();
  pendingDel.value = null;
  db.notify('已删除「' + e.title + '」');
}

const viewer = ref<{ items: ViewerItem[]; at: number } | null>(null);
function openViewer(list: PhotoEvidence[], i: number): void {
  Promise.all(list.map(async (p) => ({ url: await fileUri(p), title: props.label, sub: p.capturedAt } as ViewerItem)))
    .then((items) => { viewer.value = { items, at: i }; });
}
</script>

<template>
  <div>
    <div class="card sumcard">
      <div>
        <div class="bignum">{{ total }}</div>
        <div class="small muted">累计{{ label }}（小时）</div>
      </div>
      <div class="grow right">
        <div class="small">今年 {{ thisYear }} 小时 · 共 {{ mine.length }} 条</div>
        <div class="small muted">与第二课堂自评分是两套独立口径</div>
      </div>
    </div>

    <button class="btn block" style="margin: 12px 0" @click="openForm">＋ 记一条{{ label }}</button>

    <div v-for="g in groups" :key="g.semester" class="sem">
      <div class="semhead">
        <span class="sname">{{ g.semester }}</span>
        <span class="ssum" :class="{ zero: !g.sum }">{{ g.sum }} 小时</span>
      </div>
      <div v-if="!g.list.length" class="small muted emptysem">还没有记录</div>
      <div v-for="e in g.list" :key="e.id" class="card item" @click="pendingDel = e">
        <div class="grow">
          <div class="bold">{{ e.title }}</div>
          <div class="small muted">{{ e.date }}<span v-if="e.note"> · {{ e.note }}</span></div>
          <div v-if="e.photos.length" class="thumbs">
            <img v-for="(p, i) in e.photos" :key="p.id" :src="thumbs[p.id]" alt="" @click.stop="openViewer(e.photos, i)" />
          </div>
        </div>
        <div class="hrs">{{ e.hours }}<span>h</span></div>
      </div>
    </div>

    <!-- 新建 -->
    <div v-if="showForm" class="mask" @click.self="showForm = false">
      <div class="sheet">
        <div class="row"><div class="title grow">记一条{{ label }}</div><button class="btn sm ghost" @click="showForm = false">取消</button></div>
        <div class="hairline"></div>
        <div class="field"><label>学期</label>
          <div class="chips"><button v-for="s in SEMESTERS" :key="s" class="chip sm" :class="{ on: form.semester === s }" @click="form.semester = s">{{ s }}</button></div>
        </div>
        <div class="field"><label>事项名称（必填）</label><input v-model="form.title" maxlength="40" :placeholder="kind === 'volunteer' ? '如：社区志愿服务' : '如：校园包干劳动'" /></div>
        <div class="field"><label>时长（小时，必填；再点一次可取消）</label>
          <div class="chips"><button v-for="h in HOUR_CHIPS" :key="h" class="chip sm" :class="{ on: form.hours === h }" @click="pickHours(h)">{{ h }}</button></div>
          <div class="row" style="margin-top: 8px">
            <input v-model.number="form.hours" type="number" min="0" max="400" step="0.5" class="grow num" />
            <span class="small muted">可手动输入 0.5 步进</span>
          </div>
        </div>
        <div class="field"><label>日期</label><input v-model="form.date" type="date" /></div>
        <div class="field"><label>备注（选填）</label><input v-model="form.note" maxlength="80" placeholder="组织方、证明人等" /></div>
        <div class="field"><label>照片（带水印存证，最多 9 张）</label>
          <div class="row" style="gap: 8px">
            <button class="btn sm grow" :disabled="!!busy" @click="addPhoto('camera')">📷 拍照</button>
            <button class="btn sm grey grow" :disabled="!!busy" @click="addPhoto('gallery')">🖼 相册</button>
          </div>
          <div v-if="busy" class="small muted" style="margin-top: 6px">{{ busy }}</div>
          <div class="row" style="flex-wrap: wrap; gap: 8px; margin-top: 8px">
            <div v-for="(p, i) in form.photos" :key="p.ev.id" class="th2">
              <img :src="p.uri" @click="openViewer(form.photos.map((x) => x.ev), i)" />
              <button class="x" @click="form.photos.splice(i, 1)">×</button>
            </div>
          </div>
        </div>
        <button class="btn block" :disabled="!!busy" @click="save">保存</button>
      </div>
    </div>

    <!-- 删除确认 -->
    <div v-if="pendingDel" class="mask" @click.self="pendingDel = null">
      <div class="sheet">
        <div class="title">确认删除这条{{ label }}记录？</div>
        <div class="hairline"></div>
        <div class="small" style="line-height: 1.75">
          <b>{{ pendingDel.title }}</b><br />
          {{ pendingDel.semester }} · {{ pendingDel.date }} · <b>{{ pendingDel.hours }} 小时</b><span v-if="pendingDel.photos.length"> · {{ pendingDel.photos.length }} 张存证照片</span>
        </div>
        <div class="small muted" style="margin-top: 10px">删除后本机移除且不可恢复，会影响累计时长统计。</div>
        <div class="row" style="gap: 8px; margin-top: 14px">
          <button class="btn grey grow" @click="pendingDel = null">取消，留着</button>
          <button class="btn danger grow" @click="doDel()">确定删除</button>
        </div>
      </div>
    </div>

    <ImageViewer v-if="viewer" :items="viewer.items" :start="viewer.at" @close="viewer = null" />
  </div>
</template>

<style scoped>
.sumcard { display: flex; align-items: flex-end; gap: 12px; }
.bignum { font-size: 30px; font-weight: 800; color: #2F7A52; line-height: 1.1; }
.right { text-align: right; }
.sem { margin-bottom: 14px; }
.semhead { display: flex; justify-content: space-between; align-items: baseline; padding: 4px 2px 6px; }
.sname { font-size: 13px; font-weight: 700; color: var(--ink); }
.ssum { font-size: 12px; color: var(--muted); }
.ssum.zero { opacity: .45; }
.emptysem { padding: 2px 2px 6px; font-size: 11.5px; }
.item { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.hrs { font-size: 20px; font-weight: 800; color: var(--brand); flex: none; }
.hrs span { font-size: 11px; font-weight: 500; margin-left: 2px; opacity: .7; }
.thumbs { display: flex; gap: 4px; margin-top: 6px; }
.thumbs img { width: 34px; height: 34px; border-radius: 7px; object-fit: cover; background: #EEF1F6; }
.field { margin-bottom: 12px; }
.field label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 6px; }
.field input { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: #FBFCFE; font-size: 14px; }
.num { flex: none; width: 96px; }
.th2 { position: relative; }
.th2 img { width: 58px; height: 58px; border-radius: 10px; object-fit: cover; display: block; }
.th2 .x { position: absolute; top: -5px; right: -5px; width: 20px; height: 20px; border-radius: 50%; border: none; background: rgba(0,0,0,.6); color: #fff; font-size: 13px; line-height: 1; }
</style>