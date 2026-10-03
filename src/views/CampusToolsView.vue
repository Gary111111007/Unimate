<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { guard } from '../services/guard.ts';
import { JwWebView, isNativeWebView } from '../services/jwwebview.ts';
import {
  BUCT_COURSE_SELECTION_URL, BUCT_FREE_CLASSROOM_URL, BUCT_SCHOOL_SCHEDULE_URL,
  campusCapabilities, campusUserBase, loadSelectionTargets, parseCourseCatalog, parseFreeClassrooms,
  saveSelectionTargets, type CourseCatalogItem, type CourseSelectionTarget, type FreeClassroom
} from '../services/campusData.ts';
import { BUCT_CAMPUS_LANDMARKS, resolveCampusLandmark, searchCampusLandmarks, type CampusLandmark } from '../services/campusMap.ts';
import { calculateFitness, type FitnessGender, type FitnessGrade } from '../services/fitnessScore.ts';
import { discoverMotionVenues, queryMotionVenue, type MotionVenue, type VenueStatus } from '../services/motionVenue.ts';

const emit = defineEmits<{ close: [] }>();
const db = useDb();
const panel = ref<'home' | 'map' | 'venues' | 'fitness' | 'rooms' | 'courses'>('home');
const capabilities = computed(() => campusCapabilities(db.profile?.schoolId));
const status = ref('');

const tools = [
  { key: 'map', icon: '🗺️', name: '校园地图', desc: '离线示意图 · 教室定位' },
  { key: 'venues', icon: '🏟️', name: '场馆状态', desc: 'MOTION 公开状态 · 只读' },
  { key: 'fitness', icon: '🏃', name: '体测评分', desc: '本机估算 · 不上传数据' },
  { key: 'rooms', icon: '🏫', name: '空闲教室', desc: '登录教务后读取结果' },
  { key: 'courses', icon: '🎯', name: '选课工具', desc: '目录与目标 · 提交已关闭' }
] as const;

function available(key: typeof tools[number]['key']): boolean {
  return key === 'rooms' ? capabilities.value.freeClassrooms
    : key === 'courses' ? capabilities.value.courseCatalog
      : !!capabilities.value[key];
}
function openTool(key: typeof tools[number]['key']): void {
  if (!available(key)) { db.notify('该高校暂未适配此功能'); return; }
  panel.value = key;
  status.value = '';
}
function goBack(): void { if (panel.value === 'home') emit('close'); else panel.value = 'home'; }
function compactParts(parts: Array<string | undefined>): string { return parts.filter(Boolean).join(' · '); }
function localIsoDate(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

// ---------------- 地图 ----------------
const mapQuery = ref('');
const selectedLandmark = ref<CampusLandmark | null>(null);
const mapMarks = computed(() => searchCampusLandmarks(mapQuery.value));
function selectLandmark(mark: CampusLandmark): void { selectedLandmark.value = mark; mapQuery.value = mark.name; }
function locateRoom(): void {
  const mark = resolveCampusLandmark(mapQuery.value);
  if (!mark) { db.notify('暂时无法从这个教室名称判断建筑'); return; }
  selectLandmark(mark);
}

// ---------------- 场馆 ----------------
const venueBusy = ref(false);
const venues = ref<MotionVenue[]>([]);
const venueCapturedAt = ref('');
const venueQuality = ref('');
const chosenVenue = ref<MotionVenue | null>(null);
const venueDate = ref(localIsoDate());
const venueStatus = ref<VenueStatus | null>(null);
async function loadVenues(): Promise<void> {
  venueBusy.value = true; status.value = '正在读取 MOTION 公开场馆目录…';
  try {
    const result = await discoverMotionVenues();
    venues.value = result.data; venueCapturedAt.value = result.capturedAt; venueQuality.value = result.quality;
    chosenVenue.value = chosenVenue.value || result.data[0] || null;
    status.value = result.message || '已读取 ' + result.data.length + ' 个场馆入口。';
  } catch (e: any) { status.value = '读取失败：' + String(e?.message || e); }
  finally { venueBusy.value = false; }
}
async function loadVenueStatus(): Promise<void> {
  if (!chosenVenue.value) { db.notify('请先选择场馆'); return; }
  venueBusy.value = true; status.value = '正在读取公开状态…'; venueStatus.value = null;
  try {
    const result = await queryMotionVenue(chosenVenue.value, venueDate.value);
    venueStatus.value = result.data; status.value = result.message || '状态已更新。';
  } catch (e: any) { status.value = '读取失败：' + String(e?.message || e); }
  finally { venueBusy.value = false; }
}
function venueStateLabel(state: string): string { return ({ available: '可用', occupied: '占用', closed: '关闭', expired: '已过期', unknown: '未知' } as Record<string, string>)[state] || '未知'; }

// ---------------- 体测 ----------------
const fitness = ref({ gender: 'male' as FitnessGender, grade: '12' as FitnessGrade, heightCm: '', weightKg: '', vitality: '', run50: '', flex: '', jump: '', strength: '', enduranceMin: '', enduranceSec: '' });
const fitnessResult = computed(() => {
  const value = fitness.value;
  if ([value.heightCm, value.weightKg, value.vitality, value.run50, value.flex, value.jump, value.strength, value.enduranceMin, value.enduranceSec]
    .some((item) => String(item).trim() === '')) return null;
  return calculateFitness({
    gender: value.gender, grade: value.grade,
    heightCm: Number(value.heightCm), weightKg: Number(value.weightKg),
    vitality: Number(value.vitality), run50: Number(value.run50), flex: Number(value.flex),
    jump: Number(value.jump), strength: Number(value.strength),
    enduranceSeconds: Number(value.enduranceMin) * 60 + Number(value.enduranceSec)
  });
});
const fitnessRows = computed(() => {
  const r = fitnessResult.value;
  if (!r) return [];
  return [
    ['BMI', r.bmi, '15%'], ['肺活量', r.vitality, '15%'], ['50 米跑', r.run50, '20%'],
    ['坐位体前屈', r.flex, '10%'], ['立定跳远', r.jump, '10%'],
    [fitness.value.gender === 'male' ? '引体向上' : '仰卧起坐', r.strength, '10%'],
    [fitness.value.gender === 'male' ? '1000 米跑' : '800 米跑', r.endurance, '20%']
  ];
});

// ---------------- 教务只读采集 ----------------
const rooms = ref<FreeClassroom[]>([]);
const roomKeyword = ref('');
const roomBusy = ref(false);
const filteredRooms = computed(() => {
  const q = roomKeyword.value.trim().toLowerCase();
  return rooms.value.filter((item) => !q || [item.room, item.campus, item.building, item.type].some((x) => x.toLowerCase().includes(q)));
});
async function captureFreeClassrooms(): Promise<void> {
  if (!isNativeWebView()) { loadDemoRooms(); status.value = '桌面预览已载入脱敏演示结果；APK 中可登录教务读取真实结果。'; return; }
  roomBusy.value = true; status.value = '请在教务页面选择条件并查询，再点右下角「读取空闲教室」。';
  const result = await guard('读取空闲教室页面', JwWebView.open({
    url: BUCT_FREE_CLASSROOM_URL, title: '空闲教室查询', mode: 'campus', actionLabel: '读取空闲教室',
    scrapeSelector: '#kbgrid,.ui-jqgrid-btable,table', allowExternal: true
  }), 10 * 60 * 1000, { ok: false, reason: 'timeout' });
  roomBusy.value = false;
  if (!result.ok || !result.html) { status.value = result.reason === 'cancelled' ? '已关闭，未读取数据。' : '读取失败：' + (result.reason || '未找到结果表格'); return; }
  rooms.value = parseFreeClassrooms(result.html);
  status.value = rooms.value.length ? '已从当前教务结果读取 ' + rooms.value.length + ' 间教室。' : '没有识别到教室；请确认页面已经显示查询结果。';
}
function loadDemoRooms(): void {
  rooms.value = [
    { id: 'demo-1', room: '一教 A-203', campus: '昌平校区', building: '第一教学楼', type: '多媒体教室', capacity: '80' },
    { id: 'demo-2', room: '二教 B-301', campus: '昌平校区', building: '第二教学楼', type: '普通教室', capacity: '60' },
    { id: 'demo-3', room: '实验楼 A-315', campus: '昌平校区', building: '实验楼 A', type: '机房', capacity: '48' }
  ];
}

const catalog = ref<CourseCatalogItem[]>([]);
const courseQuery = ref('');
const courseBusy = ref(false);
const targets = ref<CourseSelectionTarget[]>([]);
const visibleCourses = computed(() => {
  const q = courseQuery.value.trim().toLowerCase();
  return catalog.value.filter((item) => !q || [item.title, item.courseCode, item.className, item.teacher].some((x) => x.toLowerCase().includes(q))).slice(0, 100);
});
const userBase = computed(() => db.session && db.profile ? campusUserBase(db.profile.schoolId, db.session.accountId) : '');
async function captureCourseCatalog(): Promise<void> {
  if (!isNativeWebView()) { loadDemoCourses(); status.value = '桌面预览已载入脱敏演示目录；APK 中可登录教务读取真实目录。'; return; }
  courseBusy.value = true; status.value = '请在全校课表页面查询，再点右下角「读取课程目录」。';
  const result = await guard('读取课程目录页面', JwWebView.open({
    url: BUCT_SCHOOL_SCHEDULE_URL, title: '全校课表查询', mode: 'campus', actionLabel: '读取课程目录',
    scrapeSelector: '#kbgrid,.ui-jqgrid-btable,table', allowExternal: true
  }), 10 * 60 * 1000, { ok: false, reason: 'timeout' });
  courseBusy.value = false;
  if (!result.ok || !result.html) { status.value = result.reason === 'cancelled' ? '已关闭，未读取数据。' : '读取失败：' + (result.reason || '未找到结果表格'); return; }
  catalog.value = parseCourseCatalog(result.html);
  status.value = catalog.value.length ? '已读取 ' + catalog.value.length + ' 个课程/教学班。' : '没有识别到课程；请确认页面已经显示查询结果。';
}
function loadDemoCourses(): void {
  catalog.value = [
    { id: 'demo-c1', title: '高等数学（A）', courseCode: 'MATH1001', className: '教学班 01', teacher: '教师A', credits: '5', time: '周一 1-2节', room: '一教 A-203', status: '有余量' },
    { id: 'demo-c2', title: '大学物理', courseCode: 'PHYS1002', className: '教学班 02', teacher: '教师B', credits: '4', time: '周三 3-4节', room: '二教 B-301', status: '待开放' }
  ];
}
async function addTarget(item: CourseCatalogItem): Promise<void> {
  if (targets.value.some((target) => target.id === item.id)) { db.notify('这个教学班已在目标列表中'); return; }
  if (targets.value.length >= 30) { db.notify('本机最多保存 30 个选课目标'); return; }
  const added = { ...item, savedAt: new Date().toISOString() };
  targets.value.push(added);
  if (userBase.value) {
    const saved = await guard('保存选课目标', saveSelectionTargets(userBase.value, targets.value).then(() => true), 8000, false);
    if (!saved) { targets.value = targets.value.filter((target) => target !== added); db.notify('本机保存失败，请稍后重试'); return; }
  }
  db.notify('已保存目标；不会自动提交选课');
}
async function removeTarget(item: CourseSelectionTarget): Promise<void> {
  const ok = await db.confirm({
    title: '删除选课目标？', body: item.title + (item.className ? ' · ' + item.className : ''),
    detail: '将删除 1 条本机目标记录，不会退课，也不会改变学校教务系统中的任何数据。删除后不可恢复。',
    confirmText: '删除目标', danger: true
  });
  if (!ok) return;
  const before = targets.value;
  targets.value = targets.value.filter((target) => target.id !== item.id);
  if (userBase.value) {
    const saved = await guard('删除选课目标', saveSelectionTargets(userBase.value, targets.value).then(() => true), 8000, false);
    if (!saved) { targets.value = before; db.notify('本机保存失败，目标未删除'); }
  }
}
async function openSelectionPortal(): Promise<void> {
  if (!isNativeWebView()) { db.notify('请在 APK 中打开教务选课页'); return; }
  status.value = '只打开学校选课页面；Unimate 不会点击提交。';
  await guard('打开选课页面', JwWebView.open({ url: BUCT_COURSE_SELECTION_URL, title: '学校选课页面', allowExternal: true }), 10 * 60 * 1000, { ok: false, reason: 'timeout' });
}

onMounted(async () => {
  if (userBase.value) targets.value = await guard('读取选课目标', loadSelectionTargets(userBase.value), 8000, []);
});
</script>

<template>
  <div class="ct-shell">
    <header class="ct-head">
      <button class="ct-back" @click="goBack">‹</button>
      <div class="grow"><div class="ct-title">{{ panel === 'home' ? '校园工具' : tools.find((x) => x.key === panel)?.name }}</div><div class="ct-sub">{{ db.profile?.name || '当前高校' }} · 本机优先</div></div>
      <button class="btn sm ghost" @click="emit('close')">关闭</button>
    </header>

    <main class="ct-body">
      <template v-if="panel === 'home'">
        <div class="ct-hero"><b>校园学习与生活工具</b><span>离线能力直接使用；学校数据只在你主动登录并读取时更新。</span></div>
        <div class="ct-grid">
          <button v-for="tool in tools" :key="tool.key" class="ct-tile" :class="{ disabled: !available(tool.key) }" @click="openTool(tool.key)">
            <span class="ct-icon">{{ tool.icon }}</span><b>{{ tool.name }}</b><small>{{ available(tool.key) ? tool.desc : '该高校暂未适配' }}</small>
          </button>
        </div>
        <div class="ct-note">成绩、体测明细和选课目标默认不发送给 Uni、n8n 或云端。教务密码、Cookie 值与登录表单内容不会被读取或保存。</div>
      </template>

      <template v-else-if="panel === 'map'">
        <div class="ct-search"><input v-model="mapQuery" placeholder="输入建筑或教室，如：二教 D-302" /><button class="btn sm" @click="locateRoom">定位</button></div>
        <div class="ct-map" aria-label="北京化工大学昌平校区离线示意图">
          <div class="ct-road ct-road-a"></div><div class="ct-road ct-road-b"></div>
          <button v-for="mark in BUCT_CAMPUS_LANDMARKS" :key="mark.key" class="ct-mark" :class="['kind-' + mark.kind, { active: selectedLandmark?.key === mark.key, dim: mapQuery && !mapMarks.some((x) => x.key === mark.key) }]" :style="{ left: mark.x + '%', top: mark.y + '%' }" @click="selectLandmark(mark)"><span></span>{{ mark.shortName }}</button>
          <div class="ct-north">N ↑</div>
        </div>
        <div v-if="selectedLandmark" class="card ct-map-detail"><b>{{ selectedLandmark.name }}</b><span>已在离线示意图中定位。路线与位置仅供校园内找方向参考。</span></div>
        <div class="small muted">本页不调用第三方地图、不上传位置。当前为建筑示意图，不是测绘导航。</div>
      </template>

      <template v-else-if="panel === 'venues'">
        <button class="btn block" :disabled="venueBusy" @click="loadVenues">{{ venueBusy ? '读取中…' : (venues.length ? '刷新公开场馆目录' : '读取公开场馆目录') }}</button>
        <div v-if="venues.length" class="ct-form-grid">
          <label><span>场馆/项目</span><select v-model="chosenVenue"><option v-for="venue in venues" :key="venue.id" :value="venue">{{ venue.campus }} · {{ venue.label }}</option></select></label>
          <label><span>日期</span><input v-model="venueDate" type="date" /></label>
        </div>
        <button v-if="venues.length" class="btn block ghost" :disabled="venueBusy || !chosenVenue" @click="loadVenueStatus">查询状态</button>
        <div v-if="venueCapturedAt" class="small muted">目录来源：MOTION 公开页面 · {{ venueQuality === 'cached' ? '缓存/可能过期' : '实时' }} · {{ new Date(venueCapturedAt).toLocaleString() }}</div>
        <div v-if="venueStatus" class="ct-status-table">
          <div class="ct-status-head"><b>{{ venueStatus.venue.label }}</b><span>{{ venueStatus.date }} · {{ venueStatus.place }}</span></div>
          <div v-for="slot in venueStatus.slots" :key="slot.time" class="ct-slot"><b>{{ slot.time }}</b><div><span v-for="cell in slot.courts" :key="cell.court" class="ct-state" :class="'state-' + cell.state">{{ cell.court }} · {{ venueStateLabel(cell.state) }}</span></div></div>
          <div v-if="!venueStatus.slots.length" class="empty small">没有识别到状态表，请以场馆原页面为准。</div>
        </div>
      </template>

      <template v-else-if="panel === 'fitness'">
        <div class="ct-chips"><button class="chip" :class="{ on: fitness.gender === 'male' }" @click="fitness.gender = 'male'">男</button><button class="chip" :class="{ on: fitness.gender === 'female' }" @click="fitness.gender = 'female'">女</button><button class="chip" :class="{ on: fitness.grade === '12' }" @click="fitness.grade = '12'">大一/大二</button><button class="chip" :class="{ on: fitness.grade === '34' }" @click="fitness.grade = '34'">大三/大四</button></div>
        <div class="ct-form-grid ct-fitness-grid">
          <label><span>身高 cm</span><input v-model="fitness.heightCm" type="number" placeholder="170" /></label><label><span>体重 kg</span><input v-model="fitness.weightKg" type="number" placeholder="65" /></label>
          <label><span>肺活量 mL</span><input v-model="fitness.vitality" type="number" placeholder="4500" /></label><label><span>50 米 秒</span><input v-model="fitness.run50" type="number" step="0.1" placeholder="7.5" /></label>
          <label><span>坐位体前屈 cm</span><input v-model="fitness.flex" type="number" step="0.1" placeholder="15" /></label><label><span>立定跳远 cm</span><input v-model="fitness.jump" type="number" placeholder="240" /></label>
          <label><span>{{ fitness.gender === 'male' ? '引体向上 次' : '仰卧起坐 次' }}</span><input v-model="fitness.strength" type="number" placeholder="12" /></label>
          <label><span>{{ fitness.gender === 'male' ? '1000 米' : '800 米' }}</span><div class="ct-time"><input v-model="fitness.enduranceMin" type="number" placeholder="4" /><i>分</i><input v-model="fitness.enduranceSec" type="number" placeholder="30" /><i>秒</i></div></label>
        </div>
        <div v-if="fitnessResult" class="card ct-fitness-result"><div class="ct-total"><strong>{{ fitnessResult.total.toFixed(1) }}</strong><b>{{ fitnessResult.level }}</b></div><div class="small muted">标准分 {{ fitnessResult.standard.toFixed(1) }} + 附加分 {{ fitnessResult.bonus }} · BMI {{ fitnessResult.bmiValue.toFixed(1) }}</div><div class="ct-score-rows"><div v-for="row in fitnessRows" :key="String(row[0])"><span>{{ row[0] }} <small>{{ row[2] }}</small></span><b>{{ row[1] }}</b></div></div></div>
        <div v-else class="ct-note">填写全部项目后自动计算。结果是本机辅助估算，不是学校或国家平台的正式认定。</div>
      </template>

      <template v-else-if="panel === 'rooms'">
        <div class="ct-note">请在打开的教务页面中选择学期、校区、周次、星期和节次并点击查询，出现结果后再读取。</div>
        <div class="ct-form-grid"><label><span>筛选已读结果</span><input v-model="roomKeyword" placeholder="教学楼 / 教室 / 类型" /></label></div>
        <button class="btn block" :disabled="roomBusy" @click="captureFreeClassrooms">{{ roomBusy ? '等待教务页面…' : '打开教务并读取查询结果' }}</button>
        <div v-if="rooms.length" class="ct-list"><div v-for="room in filteredRooms" :key="room.id" class="ct-row"><div class="grow"><b>{{ room.room }}</b><span>{{ compactParts([room.campus, room.building, room.type]) }}</span></div><em>{{ room.capacity ? room.capacity + ' 座' : '容量未知' }}</em></div></div>
        <div v-else class="empty small">尚未读取结果。桌面预览会载入脱敏演示数据，APK 中读取你主动查询的教务结果。</div>
      </template>

      <template v-else-if="panel === 'courses'">
        <div class="ct-warning"><b>真实自动提交暂未开放</b><span>学校规则与允许频率尚未明确。当前只读课程目录、保存精确目标并打开学校原页面，不发送选课 POST。</span></div>
        <div v-if="targets.length" class="ct-targets"><div class="small muted">本机目标（{{ targets.length }}）</div><div v-for="target in targets" :key="target.id" class="ct-row"><div class="grow"><b>{{ target.title }}</b><span>{{ compactParts([target.courseCode, target.className, target.teacher]) }}</span></div><button class="btn sm danger" @click="removeTarget(target)">删除</button></div></div>
        <div class="ct-search"><input v-model="courseQuery" placeholder="课程名 / 课程号 / 教师" /><button class="btn sm" :disabled="courseBusy" @click="captureCourseCatalog">{{ courseBusy ? '等待…' : '读取目录' }}</button></div>
        <div v-if="catalog.length" class="ct-list"><div v-for="course in visibleCourses" :key="course.id" class="ct-row"><div class="grow"><b>{{ course.title }}</b><span>{{ compactParts([course.courseCode, course.className, course.teacher, course.time, course.room]) }}</span><small>{{ course.status || '状态以教务页面为准' }}</small></div><button class="btn sm ghost" @click="addTarget(course)">加入目标</button></div></div>
        <div v-else class="empty small">尚未读取课程目录。</div>
        <button class="btn block grey" style="margin-top: 10px" @click="openSelectionPortal">只打开学校选课页面</button>
      </template>

      <div v-if="status" class="card ct-message">{{ status }}</div>
    </main>
  </div>
</template>

<style scoped>
.ct-shell { position: fixed; inset: 0; z-index: 180; background: var(--bg); color: var(--ink); display: flex; flex-direction: column; }
.ct-head { flex: none; display: flex; align-items: center; gap: 10px; padding: calc(10px + var(--safe-t)) 12px 10px; background: var(--card); border-bottom: 1px solid var(--line); }
.ct-back { width: 34px; height: 34px; border-radius: 11px; background: var(--soft-2); color: var(--ink); font-size: 26px; line-height: 1; }
.ct-title { font-size: 18px; font-weight: 800; }.ct-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }
.ct-body { flex: 1; overflow: auto; padding: 14px 14px calc(24px + var(--safe-b)); }
.ct-hero { background: linear-gradient(140deg, var(--brand), #7257c8); color: #fff; padding: 18px; border-radius: 18px; display: flex; flex-direction: column; gap: 5px; }.ct-hero b { font-size: 19px; }.ct-hero span { font-size: 12px; opacity: .86; line-height: 1.6; }
.ct-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 12px; }.ct-tile { text-align: left; padding: 14px; border-radius: 15px; background: var(--card); box-shadow: var(--shadow); color: var(--ink); display: flex; flex-direction: column; gap: 5px; }.ct-tile:last-child { grid-column: 1 / -1; }.ct-tile.disabled { opacity: .48; box-shadow: none; }.ct-icon { font-size: 25px; }.ct-tile b { font-size: 14px; }.ct-tile small { color: var(--muted); line-height: 1.4; }
.ct-note { margin-top: 12px; padding: 11px 12px; border-radius: 12px; background: var(--soft); color: var(--muted); font-size: 12px; line-height: 1.65; }
.ct-search { display: flex; gap: 8px; margin-bottom: 10px; }.ct-search input { flex: 1; min-width: 0; }
.ct-map { position: relative; height: 58vh; min-height: 410px; border-radius: 18px; overflow: hidden; background: linear-gradient(135deg,#e8f2e1,#f5ead4); border: 1px solid var(--line); }.ct-road { position: absolute; background: rgba(255,255,255,.72); border: 1px solid rgba(140,130,100,.18); }.ct-road-a { width: 12%; height: 120%; left: 52%; top: -10%; transform: rotate(-8deg); }.ct-road-b { width: 110%; height: 8%; left: -5%; top: 56%; transform: rotate(3deg); }.ct-mark { position: absolute; transform: translate(-50%,-50%); z-index: 2; max-width: 72px; padding: 4px 6px; border-radius: 8px; background: rgba(255,255,255,.94); color: #263238; font-size: 9px; box-shadow: 0 2px 7px rgba(20,30,40,.18); white-space: nowrap; }.ct-mark span { display: block; width: 8px; height: 8px; margin: 0 auto 2px; border-radius: 3px; background: #4e7bd6; }.ct-mark.kind-dorm span { background:#8b79c8; }.ct-mark.kind-dining span { background:#db8c35; }.ct-mark.kind-sports span { background:#2b9a74; }.ct-mark.active { outline: 3px solid var(--brand); z-index: 5; font-weight: 800; }.ct-mark.dim { opacity: .23; }.ct-north { position:absolute; right:10px; top:10px; padding:5px 8px; border-radius:9px; background:rgba(255,255,255,.86); font-size:11px; font-weight:800; }.ct-map-detail { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }.ct-map-detail span { color: var(--muted); font-size: 12px; }
.ct-form-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 9px; margin: 12px 0; }.ct-form-grid label { display: flex; flex-direction: column; gap: 5px; font-size: 11px; color: var(--muted); }.ct-form-grid label:only-child { grid-column: 1 / -1; }.ct-form-grid input,.ct-form-grid select,.ct-search input { width:100%; padding:10px; border:1px solid var(--line); border-radius:10px; background:var(--field); color:var(--ink); }.ct-chips { display:flex; gap:7px; flex-wrap:wrap; margin-bottom:10px; }.ct-time { display:grid; grid-template-columns:1fr auto 1fr auto; gap:4px; align-items:center; }.ct-time i { font-style:normal; }
.ct-fitness-result { margin-top: 12px; }.ct-total { display:flex; justify-content:space-between; align-items:center; }.ct-total strong { font-size:38px; color:var(--brand); }.ct-total b { padding:5px 10px; border-radius:999px; background:var(--tint); color:var(--brand); }.ct-score-rows { margin-top:10px; }.ct-score-rows div { display:flex; justify-content:space-between; padding:7px 0; border-top:1px solid var(--line); font-size:12px; }.ct-score-rows small { color:var(--muted); }
.ct-list,.ct-targets,.ct-status-table { margin-top: 12px; }.ct-row { display:flex; gap:9px; align-items:center; padding:10px 0; border-bottom:1px solid var(--line); }.ct-row .grow { min-width:0; display:flex; flex-direction:column; gap:3px; }.ct-row b { font-size:13px; }.ct-row span,.ct-row small { font-size:11px; color:var(--muted); line-height:1.45; }.ct-row em { font-size:11px; color:var(--brand); font-style:normal; white-space:nowrap; }
.ct-warning { padding:12px; border-radius:13px; background:#fff3dc; color:#704d16; display:flex; flex-direction:column; gap:4px; }.ct-warning span { font-size:11.5px; line-height:1.6; }.ct-message { margin-top:12px; font-size:12px; line-height:1.6; }.ct-status-head { display:flex; justify-content:space-between; gap:8px; padding:10px 0; }.ct-status-head span { color:var(--muted); font-size:11px; }.ct-slot { padding:9px 0; border-top:1px solid var(--line); }.ct-slot>b { font-size:12px; }.ct-slot>div { display:flex; flex-wrap:wrap; gap:5px; margin-top:6px; }.ct-state { padding:4px 7px; border-radius:8px; font-size:10px; background:var(--soft); }.state-available { color:#167447; background:#e4f6eb; }.state-occupied,.state-closed { color:#a33a32; background:#fde9e7; }
@media (max-width: 360px) { .ct-form-grid { grid-template-columns:1fr; }.ct-map { min-height:360px; } }
</style>
