<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useDb } from '../stores/db.ts';
import { COURSE_COLORS, assignCourseColors, courseColorIndex } from '../catalog/periods.ts';
import { uuid, nowStamp } from '../services/id.ts';
import type { Course, CourseMaterial } from '../types.ts';
import { writeBinaryBase64, remove } from '../services/io.ts';
import { JwWebView } from '../services/jwwebview.ts';
import { anchorFromLegacy, anchorFromPos, clampToBox, posFromAnchor, toolBox } from '../services/toolbox.ts';
import { textZoomFactor } from '../services/display.ts';
import { buildShareUrl, encodeShare, shareHost } from '../services/share.ts';
import { canEncodeQr, qrSvg } from '../services/qr.ts';
import ImportPanel from './ImportPanel.vue';
import SettingsPanel from '../components/SettingsPanel.vue';

const db = useDb();
const week = ref(db.currentWeek);
const wkDir = ref<'r' | 'l'>('r');
const showWeekPicker = ref(false);
const showImport = ref(false);
const showMenu = ref(false);
const showSettings = ref(false);
const showShare = ref(false);
const detail = ref<Block | null>(null);
const editing = ref<Course | null>(null);
const isNew = ref(false);

const ROW_H = 58;
const DAY_FULL = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const DAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'];

const dayIndexes = computed(() => {
  const all = [0, 1, 2, 3, 4, 5, 6];
  return db.settings.showWeekend ? all : all.slice(0, 5);
});
const todayIdx = computed(() => (new Date().getDay() + 6) % 7);
/** 当前展示周次内、第 di 天（0=周一）对应的真实日期。改"课表设置 → 学期第一周周一"即整体平移。 */
function dateForDay(di: number): Date {
  const tt = db.activeTimetable;
  const d = tt ? new Date(tt.semesterStartMonday.replace(/-/g, '/') + ' 00:00:00') : new Date();
  d.setDate(d.getDate() + (week.value - 1) * 7 + di);
  return d;
}
function mdOf(di: number): string { const d = dateForDay(di); return (d.getMonth() + 1) + '/' + d.getDate(); }
/** 只有"本周"视图下才高亮今天，翻到别周不该继续标红。 */
function isTodayCol(di: number): boolean { return di === todayIdx.value && week.value === db.currentWeek; }
const weekRange = computed(() => {
  const f = (d: Date) => (d.getMonth() + 1) + '月' + d.getDate() + '日';
  return f(dateForDay(0)) + '–' + f(dateForDay(6));
});
const nowPeriod = computed(() => {
  const mins = new Date().getHours() * 60 + new Date().getMinutes();
  for (const p of db.settings.periodTimes) {
    const [ah, am] = p.start.split(':').map(Number);
    const [bh, bm] = p.end.split(':').map(Number);
    if (mins >= ah * 60 + am && mins <= bh * 60 + bm) return p.period;
  }
  return -1;
});

interface Block {
  key: string; name: string; day: number; startPeriod: number; endPeriod: number;
  weeks: number[]; rooms: string[]; teachers: string[]; colorIndex: number; colorSet: boolean;
  pendingFilter: boolean; credit: number | null; examMode: string; courseCode: string;
  lessonType: string; weeksRaw: string; first: Course;
}

/** 同一门课、同一天、同一节次区间、同一周次 = 一条显示块（多机房/多教学班合并，不再被压窄） */
function mergeDay(list: Course[]): Block[] {
  const map = new Map<string, Block>();
  for (const c of list) {
    const key = [c.name, c.startPeriod, c.endPeriod, c.weeks.join(',')].join('|');
    const b = map.get(key);
    if (b) {
      if (c.room && b.rooms.indexOf(c.room) < 0) b.rooms.push(c.room);
      if (c.teacher && b.teachers.indexOf(c.teacher) < 0) b.teachers.push(c.teacher);
      if (c.pendingFilter) b.pendingFilter = true;
      if (c.colorSet) { b.colorSet = true; b.colorIndex = c.colorIndex; }
    } else {
      map.set(key, {
        key, name: c.name, day: c.day, startPeriod: c.startPeriod, endPeriod: c.endPeriod,
        weeks: c.weeks, rooms: [c.room].filter(Boolean), teachers: [c.teacher].filter(Boolean),
        colorIndex: c.colorIndex, colorSet: !!c.colorSet, pendingFilter: c.pendingFilter, credit: c.credit, examMode: c.examMode,
        courseCode: c.courseCode, lessonType: c.lessonType, weeksRaw: c.weeksRaw, first: c
      });
    }
  }
  return [...map.values()];
}

const placed = computed(() => {
  const ttId = db.activeTimetable?.id;
  return dayIndexes.value.map((dayIdx) => {
    const day = dayIdx + 1;
    const list = mergeDay(
      db.courses.filter((c) => c.timetableId === ttId && c.day === day && c.weeks.indexOf(week.value) >= 0)
    ).sort((a, b) => a.startPeriod - b.startPeriod || a.name.localeCompare(b.name, 'zh'));
    const laneEnd: number[] = [];
    const withLane = list.map((b) => {
      let lane = laneEnd.findIndex((end) => end < b.startPeriod);
      if (lane < 0) { lane = laneEnd.length; laneEnd.push(b.endPeriod); } else { laneEnd[lane] = b.endPeriod; }
      return { b, lane };
    });
    const lanes = Math.max(1, laneEnd.length);
    return withLane.map((x) => ({ ...x, lanes }));
  });
});

/**
 * 当前使用中的课表里到底有没有课。
 * 旧写法用全局的 db.courses.length 判断空态：多课表场景下，切到一份新导入/新建的
 * 空课表时既看不到「还没有课表」的引导（全局有课），又看到一片空网格，用户不知道下一步做什么。
 */
const ttHasCourses = computed(() => {
  const id = db.activeTimetable?.id;
  return !!id && db.courses.some((c) => c.timetableId === id);
});

/**
 * 课表网格的反向文字补偿系数。
 * 网格几何（节次列 52px、12 行 × 58px、7 天分栏）是按像素定死的，而"字号"只放大文字：
 * 于是字号一调大，课程名就被挤成一列一个字、时间竖排（真机截图反馈："左边弄得太大、课表里的课太小"）。
 * 这里的做法是让**课表网格内部的文字保持固定大小**（用 calc(字号 / 补偿系数) 抵消 textZoom），
 * 网格外观在任何字号下都与"标准"完全一致；其余界面照常跟随字号放大。
 * 桌面预览走的是整页 CSS zoom（几何也在缩放），此时系数为 1，不做补偿。
 */
const gridTz = computed(() => {
  const k = textZoomFactor.value;
  return k > 0.5 && k <= 2 ? k : 1;
});

/**
 * 点系统通知进来时定位到对应课程（PRD 5.10「点击行为：打开首页 Sheet1 并高亮该课程块」）。
 * 排期时把课次 id 与周次塞进通知的 extra，这里收到就切到那一周并直接弹出该课详情。
 */
function applyFocus(): void {
  const f = db.focus;
  if (!f || f.kind !== 'course') return;
  const c = db.courses.find((x) => x.id === f.id);
  db.focus = null;                     // 只消费一次，避免来回切页反复弹层
  if (!c) return;
  const total = db.activeTimetable?.totalWeeks || 18;
  const w = f.week && c.weeks.indexOf(f.week) >= 0 ? f.week : (c.weeks[0] || db.currentWeek);
  week.value = Math.min(Math.max(w, 1), total);
  const flat: { b: Block }[] = [];
  for (const day of placed.value) for (const x of day) flat.push(x);
  const hit = flat.find((x) => x.b.first.id === c.id)
    || flat.find((x) => x.b.name === c.name && x.b.day === c.day && x.b.startPeriod === c.startPeriod);
  if (hit) detail.value = hit.b;
}
watch(() => db.focus, applyFocus, { immediate: true });

/**
 * 「下一节」必须按**当前真实时刻**往后找，而不是"今天的第一节课"。
 * 旧写法在深夜、午休、放学后（nowPeriod 落不到任何区间）会退化成今天第一节，
 * 于是出现"课早结束了还提示这节课"。现在从今天起最多往后扫 8 天，
 * 按 周次 + 星期 + 开始分钟 组成一个可比较的绝对分钟数，取第一个大于"现在"的。
 */
interface NextInfo {
  name: string; rooms: string[]; teachers: string[]; startPeriod: number; endPeriod: number;
  colorIndex: number; colorSet: boolean; dayLabel: string; timeLabel: string; minutesUntil: number;
}
const WEEK_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const nextClass = computed<NextInfo | null>(() => {
  const tt = db.activeTimetable;
  if (!tt) return null;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const times = new Map(db.settings.periodTimes.map((x) => [x.period, x] as const));
  const total = tt.totalWeeks || 18;
  const baseWeek = db.currentWeek;
  const todayWd = (now.getDay() + 6) % 7;
  let best: NextInfo | null = null;
  let bestAbs = Number.POSITIVE_INFINITY;
  for (let off = 0; off <= 8; off++) {
    const w = baseWeek + Math.floor((todayWd + off) / 7);
    if (w < 1 || w > total) continue;
    const wd = (todayWd + off) % 7;
    for (const c of db.courses) {
      if (c.timetableId !== tt.id || c.day !== wd + 1) continue;
      if (c.weeks.indexOf(w) < 0) continue;
      const sp = times.get(c.startPeriod);
      if (!sp) continue;
      const [sh, sm] = sp.start.split(':').map(Number);
      const abs = off * 1440 + sh * 60 + sm;
      if (abs <= nowMin || abs >= bestAbs) continue;
      const ep = times.get(c.endPeriod) || sp;
      bestAbs = abs;
      best = {
        name: c.name,
        rooms: [c.room].filter(Boolean) as string[],
        teachers: [c.teacher].filter(Boolean) as string[],
        startPeriod: c.startPeriod, endPeriod: c.endPeriod,
        colorIndex: c.colorIndex || 0, colorSet: !!c.colorSet,
        dayLabel: off === 0 ? '今天' : off === 1 ? '明天' : WEEK_NAMES[wd] + '（第 ' + w + ' 周）',
        timeLabel: sp.start + '–' + ep.end,
        minutesUntil: abs - nowMin
      };
    }
  }
  return best;
});
function untilText(m: number): string {
  if (m < 60) return '还有 ' + m + ' 分钟';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) return mm ? '还有 ' + h + ' 小时 ' + mm + ' 分' : '还有 ' + h + ' 小时';
  return '还有 ' + Math.floor(h / 24) + ' 天';
}

// ---------------- 课程资料（PRD 5.4.11） ----------------
// 说明：Android WebView 里 <input type=file> 由 Capacitor 原生接管，可以选到
// 系统里的文档；文件副本写进应用私有目录，打开时经 FileProvider 交给系统应用。
// 因此本 App 能"存下来、找得回、点开就用别的 App 看"，但**不做 Office 预览**。
const matBusy = ref('');
function courseKey(b: Block): string { return (b.first?.timetableId || '') + '|' + (b.name || ''); }
const detailMats = computed<CourseMaterial[]>(() => detail.value ? db.materials.filter((m) => m.courseId === courseKey(detail.value!)) : []);
function humanSize(n: number): string {
  if (!n) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : 'bin';
}
async function onPickMaterial(e: Event): Promise<void> {
  const b = detail.value; if (!b) return;
  const inp = e.target as HTMLInputElement;
  const files = inp.files ? Array.from(inp.files) : [];
  if (!files.length) return;
  matBusy.value = '保存中…';
  try {
    for (const f of files) {
      if (f.size > 25 * 1024 * 1024) { db.notify('跳过 ' + f.name + '：超过 25MB'); continue; }
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result || '').split(',')[1] || '');
        r.onerror = () => rej(new Error('读取失败'));
        r.readAsDataURL(f);
      });
      if (!b64) { db.notify('跳过 ' + f.name + '：读不到内容'); continue; }
      const id = uuid();
      const rel = 'schools/' + db.profile!.schoolId + '/users/' + db.session!.accountId
        + '/materials/' + new Date().getFullYear() + '/' + id + '.' + extOf(f.name);
      await writeBinaryBase64(rel, b64);
      db.addMaterial({ courseId: courseKey(b), name: f.name, path: rel, mime: f.type || '', size: f.size });
    }
    await db.saveData();
    db.notify('资料已保存到本机');
  } catch (err: any) {
    db.notify('保存资料失败：' + ((err && err.message) || err));
  } finally { matBusy.value = ''; inp.value = ''; }
}
async function openMaterial(m: CourseMaterial): Promise<void> {
  const r = await JwWebView.openFile({ path: m.path, name: m.name, mime: m.mime });
  if (!r.ok) db.notify(r.error || '打不开该文件');
}
async function delMaterial(m: CourseMaterial): Promise<void> {
  const ok = await db.confirm({
    title: '确认删除这个资料文件？',
    body: m.name,
    detail: humanSize(m.size) + ' · ' + m.addedAt.slice(0, 10) + '。删除后本机文件一并移除，不可恢复。'
  });
  if (!ok) return;
  db.removeMaterial(m.id);
  await db.saveData();
  try { await remove(m.path); } catch { /* 文件删不掉也不影响索引 */ }
  db.notify('已删除资料');
}
/**
 * 本表配色分配：同一门课恒定同色，且同表内不同课尽量不同色。
 * 只按课程名哈希会"生日撞车"（真机反馈：默认变成一个颜色），所以这里按**当前课表里出现过的
 * 全部课程名**算一张分配表；它只依赖课程名集合，不依赖导入顺序，也不依赖当前周次。
 */
const colorAlloc = computed<Record<string, number>>(() => {
  const ttId = db.activeTimetable?.id;
  const names = db.courses.filter((c) => c.timetableId === ttId).map((c) => c.name);
  return assignCourseColors(names);
});
const normName = (x: string | undefined) => (x || '').replace(/\s+/g, '');

/** 当前生效的色号：手动选过的课优先手动色，否则查分配表，最后兜底哈希 */
function colorIndexOf(c: { name?: string; colorIndex?: number; colorSet?: boolean }): number {
  if (c.colorSet) return (c.colorIndex || 0) % COURSE_COLORS.length;
  const k = normName(c.name);
  const fromTable = colorAlloc.value[k];
  return fromTable === undefined ? courseColorIndex(k) : fromTable;
}

/** 多个教室合并显示（放这儿是为了模板里不再嵌引号） */
function roomsText(list: string[]): string { return list.join(' / '); }

function colorOf(b: Block): string {
  return COURSE_COLORS[colorIndexOf(b)];
}
function timeOf(period: number, end = false): string {
  const p = db.settings.periodTimes.find((x) => x.period === period);
  return p ? (end ? p.end : p.start) : '';
}
function shift(d: number): void {
  const total = db.activeTimetable?.totalWeeks || 18;
  const next = Math.min(Math.max(week.value + d, 1), total);
  if (next === week.value) return;
  wkDir.value = next > week.value ? 'r' : 'l';
  week.value = next;
}

let sx = 0; let sy = 0;
function onTouchStart(e: TouchEvent): void { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }
function onTouchEnd(e: TouchEvent): void {
  const dx = e.changedTouches[0].clientX - sx;
  const dy = e.changedTouches[0].clientY - sy;
  if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.4) shift(dx < 0 ? 1 : -1);
}

function blank(): Course {
  return {
    id: '', timetableId: '', name: '', lessonType: 'lecture', teacher: '', campus: db.profile?.campuses[0] || '', room: '',
    day: 1, startPeriod: 1, endPeriod: 2, weeksRaw: '', weeks: [], credit: null, weeklyHours: null, totalHours: null,
    examMode: '', courseCode: '', classNames: '', hoursDetail: '', colorIndex: 0, source: 'manual',
    pendingFilter: false, editedFields: [], remark: ''
  } as Course;
}
function openNew(): void {
  if (!db.timetables.length) db.newTimetable(db.profile?.academic.semesterLabel || '我的课表');
  isNew.value = true; editing.value = blank(); showMenu.value = false;
}
function editBlock(b: Block): void {
  isNew.value = false;
  editing.value = JSON.parse(JSON.stringify(b.first));
  detail.value = null;
}
/**
 * 颜色面板：手点一下 = 给这门课（含它在整张课表里的所有时段）定色。
 * 之所以要"同名一起改"，是因为产品要求同一门课颜色必须统一，
 * 只改一条会让"高等数学"在周二和周四长得不一样。
 */
function pickColor(i: number): void {
  const c = editing.value;
  if (!c) return;
  c.colorIndex = i;
  c.colorSet = true;
}
function autoColor(): void {
  const c = editing.value;
  if (!c) return;
  c.colorSet = false;
  c.colorIndex = colorIndexOf(c);
}

/** 把这门课的颜色写给它的所有同名时段（含刚保存的这条） */
/** 把这门课的颜色写给它在整张课表里的所有同名时段（保存时调用） */
function syncColor(name: string, idx: number, set: boolean): void {
  if (!name) return;
  const ttId = db.activeTimetable?.id;
  for (const x of db.courses) {
    if (x.timetableId === ttId && x.name === name && (x.colorIndex !== idx || !!x.colorSet !== set)) {
      x.colorIndex = idx;
      x.colorSet = set;
    }
  }
}

async function saveCourse(): Promise<void> {
  const c = editing.value!;
  if (!c.name.trim()) { db.notify('请填写课程名称'); return; }
  if (!c.weeks.length) { db.notify('请选择至少一个周次'); return; }
  if (isNew.value) {
    c.id = uuid(); c.timetableId = db.activeTimetable!.id; c.colorIndex = c.colorSet ? c.colorIndex : colorIndexOf(c);
    db.courses.push(c);
  } else {
    const i = db.courses.findIndex((x) => x.id === c.id);
    if (i >= 0) db.courses[i] = { ...c, editedFields: Array.from(new Set(c.editedFields.concat('manual'))) } as Course;
  syncColor(c.name, c.colorIndex, !!c.colorSet);
  }
  await db.saveData();
  editing.value = null; detail.value = null;
  db.notify(isNew.value ? '课程已添加' : '课程已保存');
}
async function delBlock(b: Block): Promise<void> {
  const ids = db.courses.filter((c) => c.timetableId === b.first.timetableId && c.name === b.name && c.day === b.day && c.startPeriod === b.startPeriod && c.endPeriod === b.endPeriod).map((c) => c.id);
  const mats = db.materials.filter((m) => m.courseId === courseKey(b)).length;
  const ok = await db.confirm({
    title: '确认删除这门课？',
    body: b.name + '｜' + DAY_FULL[b.day - 1] + ' 第 ' + b.startPeriod + '-' + b.endPeriod + ' 节',
    detail: '涉及 ' + ids.length + ' 条同名同时段记录，周次 ' + (b.weeksRaw || b.weeks.join(','))
      + (mats ? '。这门课还挂了 ' + mats + ' 个资料文件，删除课程不会自动删文件，可稍后在「我的 → 备份与恢复」里清理。' : '。'),
    confirmText: '确定删除'
  });
  if (!ok) return;
  db.courses = db.courses.filter((c) => ids.indexOf(c.id) < 0);
  await db.saveData();
  detail.value = null;
  db.notify('已删除该课程时段');
}
async function pickTimetable(id: string): Promise<void> {
  db.settings.lastActiveTimetableId = id;
  await db.saveData();
  showMenu.value = false;
  week.value = db.currentWeek;
}
async function createTimetable(): Promise<void> {
  db.newTimetable(db.profile?.academic.semesterLabel || '新课表 ' + (db.timetables.length + 1));
  await db.saveData();
  showMenu.value = false;
  db.notify('已新建课表，可点右下角的「工具箱」从教务系统抓取');
}
/**
 * 删除一整份课表（用户明确点名："课表文件的删除没有第二次确认"）。
 * 会连带删掉该课表下所有节次与挂在这些节次上的资料文件，所以确认框里必须报出数量。
 */
async function dropTimetable(id: string): Promise<void> {
  const t = db.timetables.find((x) => x.id === id);
  const nCourses = db.courses.filter((c) => c.timetableId === id).length;
  const prefix = id + '|';
  const mats = db.materials.filter((m) => (m.courseId || "").startsWith(prefix));
  const used = Math.round(mats.reduce((a, m) => a + (m.size || 0), 0) / 1024 / 1024 * 10) / 10;
  const last = db.timetables.length <= 1;
  const ok = await db.confirm({
    title: '确认删除整份课表？',
    body: (t && t.name ? t.name : '这份课表') + ' · ' + nCourses + ' 个上课时段',
    detail: mats.length
      ? '同时会删掉挂在这份课表上的 ' + mats.length + ' 个资料文件（约 ' + used + ' MB），本机文件一并移除，不可恢复。'
      : '该课表下的全部上课时段会被删除，不可恢复。'
      + (last ? ' 这是最后一份课表，删掉后首页会变空白，可随时点「导入课表」重建。' : ''),
    confirmText: '确定删除整份课表'
  });
  if (!ok) { showMenu.value = false; return; }
  for (const m of mats) {
    db.removeMaterial(m.id);
    try { await remove(m.path); } catch { /* 文件删不掉不影响索引 */ }
  }
  db.timetables = db.timetables.filter((x) => x.id !== id);
  db.courses = db.courses.filter((c) => c.timetableId !== id);
  db.settings.lastActiveTimetableId = db.timetables[0]?.id || null;
  await db.saveData();
  showMenu.value = false;
  db.notify('已删除课表（含 ' + nCourses + ' 个时段' + (mats.length ? '、' + mats.length + ' 个资料文件' : '') + '）');
}
/**
 * 课表工具箱：把「导入课表」和原来那个 ⋯ 合成一个悬浮按钮（需求 2）。
 *
 * 【可拖动，但只能在"允许区域"内（v2.15 第二次修订）】
 * 产品负责人要求：必须能拖（不然周日晚上有课的人，右下角那块正好被按钮压住），
 * 但必须"框定一个范围，让它不能超出这个范围"。所以：
 *   1) 允许区域 = 可视区去掉底部导航栏（底栏高度**实时量**，不写死），左右各留 8px；
 *   2) 拖动过程中实时夹取，松手再夹一次，永远出不去；
 *   3) 存下来的是**相对锚点** fx / fy（0~1 的比例），不是像素坐标 ——
 *      字号变大、底栏长高、横竖屏切换后按新尺寸换算位置，不可能像旧版那样
 *      "拖到右下角、改大字号就找不到"（旧版存像素，换尺寸后那个坐标落到了屏幕外/底栏底下）；
 *   4) 每次按下之前、窗口尺寸变化、页面重新可见时都重新换算一次，老数据也会被夹回范围内。
 */
const TOOL_SIZE = 52;
const TOOL_PAD = 8;
const toolPos = ref({ x: 0, y: 0 });
const toolDragging = ref(false);
/** 位置用"相对锚点"（0~1 的比例）持久化，避免存像素坐标导致的换尺寸即丢失 */
const toolAnchor = ref({ fx: 1, fy: 1 });
const toolStyle = computed(() => ({
  transform: 'translate3d(' + toolPos.value.x + 'px, ' + toolPos.value.y + 'px, 0)'
}));
let toolDrag: { id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null = null;

/**
 * 当前页面缩放系数。
 * 设备上用原生 textZoom 时布局不缩放（=1）；桌面预览、或原生不可用时走 CSS zoom 兜底。
 * **必须换算**：`window.innerWidth` / `getBoundingClientRect()` 给的是"缩放之后"的视觉像素，
 * 而 `translate3d(x, y)` 用的是"被缩放前"的布局像素 —— 两者差一个 zoom。
 * 不换算就是旧版那个事故：大字号下算出来的坐标再被放大一次，按钮直接出了屏幕。
 */
function zoomFactor(): number {
  try {
    const z = parseFloat(getComputedStyle(document.documentElement).zoom);
    return Number.isFinite(z) && z > 0 ? z : 1;
  } catch { return 1; }
}

/** 工具箱允许出现的矩形区域（单位：布局像素，与 translate3d 同一坐标系） */
function toolBounds() {
  const bar = document.querySelector('.tabbar') as HTMLElement | null;
  const barH = bar && bar.getBoundingClientRect ? bar.getBoundingClientRect().height : 0;
  return toolBox({
    viewW: window.innerWidth, viewH: window.innerHeight, zoom: zoomFactor(),
    barH, size: TOOL_SIZE, pad: TOOL_PAD
  });
}

/** 相对锚点 → 当前尺寸下的像素位置 */
function placeTool(): void {
  toolPos.value = posFromAnchor(toolAnchor.value, toolBounds());
}

/** 当前像素位置 → 相对锚点（松手时回写） */
function anchorToolFromPos(): void {
  toolAnchor.value = anchorFromPos(toolPos.value, toolBounds());
}

/** 读回上次的位置：新格式是锚点；老备份里是像素，先夹进范围再换算 */
function loadToolPos(): void {
  const s = db.settings.toolFab as { fx?: number; fy?: number; x?: number; y?: number } | null | undefined;
  if (s && typeof s.fx === 'number' && typeof s.fy === 'number') {
    toolAnchor.value = { fx: Math.min(1, Math.max(0, s.fx)), fy: Math.min(1, Math.max(0, s.fy)) };
  } else if (s && typeof s.x === 'number' && typeof s.y === 'number') {
    toolAnchor.value = anchorFromLegacy(s.x, s.y, toolBounds());
  }
  placeTool();   // 没存过就是默认右下角
}

function toolDown(e: PointerEvent): void {
  placeTool();                     // 先按当前尺寸摆回允许区域内（字号可能刚变过）
  const el = e.currentTarget as HTMLElement;
  toolDrag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: toolPos.value.x, oy: toolPos.value.y, moved: false };
  try { el.setPointerCapture(e.pointerId); } catch { /* 个别 ROM 不支持，忽略 */ }
}
function toolMove(e: PointerEvent): void {
  const d = toolDrag;
  if (!d || d.id !== e.pointerId) return;
  const z = zoomFactor();
  const dx = (e.clientX - d.sx) / z;   // 指针坐标是视觉像素，换算成布局像素
  const dy = (e.clientY - d.sy) / z;
  if (!d.moved && Math.abs(dx) + Math.abs(dy) > 8) { d.moved = true; toolDragging.value = true; }
  if (!d.moved) return;
  // 拖动过程中实时夹取：拖多远都出不去允许区域
  toolPos.value = clampToBox(d.ox + dx, d.oy + dy, toolBounds());
}
function toolUp(): void {
  const d = toolDrag;
  toolDrag = null;
  toolDragging.value = false;
  if (!d) return;
  if (!d.moved) { showMenu.value = !showMenu.value; return; }   // 点一下 = 开菜单
  anchorToolFromPos();                                         // 拖动超过 8px = 移动
  db.settings.toolFab = { fx: toolAnchor.value.fx, fy: toolAnchor.value.fy };
  void db.saveData();
}

/** 视口尺寸变化 / 页面重新可见时重新贴合（横竖屏、分屏、系统字体变化都走这里） */
function onToolViewport(): void { placeTool(); }
onMounted(() => {
  loadToolPos();
  window.addEventListener('resize', onToolViewport);
  document.addEventListener('visibilitychange', onToolViewport);
});
onUnmounted(() => {
  window.removeEventListener('resize', onToolViewport);
  document.removeEventListener('visibilitychange', onToolViewport);
});

function goToday(): void { week.value = db.currentWeek; }

/**
 * 分享整张课表（PRD 5.12）。
 * 数据编码进链接的 # 片段（**不上传服务器**），二维码在本机生成；
 * 课表内容太多、二维码放不下时自动降级为"只给链接"。
 */
const shareLink = computed(() => {
  const tt = db.activeTimetable;
  if (!tt) return '';
  const courses = db.courses.filter((c) => c.timetableId === tt.id)
    .map((c) => ({ name: c.name, day: c.day, startPeriod: c.startPeriod, endPeriod: c.endPeriod, weeks: c.weeks, room: c.room || '' }));
  if (!courses.length) return '';
  return buildShareUrl(encodeShare({
    name: tt.name, semesterStart: tt.semesterStartMonday, totalWeeks: tt.totalWeeks, courses
  }));
});
/** 二维码画大一点（260px）：课表内容多时模块很密，画小了手机扫不出来 */
const shareQr = computed(() => (shareLink.value && canEncodeQr(shareLink.value) ? qrSvg(shareLink.value, 320) : ''));
function openShare(): void { showMenu.value = false; showShare.value = true; }
async function copyShareLink(): Promise<void> {
  const link = shareLink.value;
  if (!link) { db.notify('这张课表还是空的，没有可分享的内容'); return; }
  try { await navigator.clipboard.writeText(link); db.notify('分享链接已复制'); }
  catch { db.notify('复制失败，请长按下面的链接手动复制'); }
}

/** 打开导入面板（工具箱第一项 / 空态主按钮都走这里） */
function openImport(): void {
  showImport.value = true;
  showMenu.value = false;
}
function toggleWeek(w: number): void {
  const c = editing.value!;
  const i = c.weeks.indexOf(w);
  if (i >= 0) c.weeks.splice(i, 1); else c.weeks.push(w);
  c.weeks.sort((a, b) => a - b);
  c.weeksRaw = c.weeks.length ? c.weeks.join('周,') + '周' : '';
}
</script>

<template>
  <div class="scroll" @touchstart="onTouchStart" @touchend="onTouchEnd">
    <!-- 还没有课表时不显示周次条：否则空账号会看到"第 1 周 · 共 0 周"这种自相矛盾的抬头 -->
    <div v-if="db.activeTimetable" class="card weeknav">
      <button class="nav" @click="shift(-1)" :disabled="week <= 1">‹</button>
      <div class="cur" @click="showWeekPicker = true">
        <div class="bold">第 {{ week }} 周 <span class="wr">{{ weekRange }}</span></div>
        <div class="small muted">{{ db.activeTimetable?.name || '还没有课表' }} · 共 {{ db.activeTimetable?.totalWeeks || 0 }} 周</div>
      </div>
      <button class="nav" @click="shift(1)" :disabled="week >= (db.activeTimetable?.totalWeeks || 18)">›</button>
      <button v-if="week !== db.currentWeek" class="btn sm ghost today" @click="goToday">回本周</button>
    </div>
    <div v-if="db.activeTimetable" class="swipe-hint center">左右滑动可切换周次</div>
      <!-- 真机反馈：这块原来是三行大卡片，把课表整个顶到屏幕外。压成一条，点整条看详情。 -->
      <div v-if="nextClass" class="nextbar" @click="detail = nextClass">
        <span class="ndot" :style="{ background: colorOf(nextClass) }"></span>
        <div class="ngrow">
          <div class="n1"><b>{{ nextClass.name }}</b><span class="nu">{{ untilText(nextClass.minutesUntil) }}</span></div>
          <div class="n2">{{ nextClass.dayLabel }} · 第 {{ nextClass.startPeriod }}-{{ nextClass.endPeriod }} 节 {{ nextClass.timeLabel }}<span v-if="nextClass.rooms.length"> · {{ roomsText(nextClass.rooms) }}</span></div>
        </div>
        <span class="ncv">详情 ›</span>
      </div>

    <!-- 新账号 / 新建课表后就是这一屏：导入入口必须摆在明面上，不能只藏在悬浮工具箱里。
         同一份课表一旦有课，这个入口就收进「工具箱」（需求原话的"已导入则放进工具箱"）。 -->
    <div v-if="!ttHasCourses" class="empty">
      <div class="big">🗓</div>
      <div>这份课表还是空的</div>
      <div class="small">新账号或新建课表后，先从这里把课表导进来</div>
      <button class="btn block" style="margin-top: 16px" @click="openImport()">📥 导入课表（从教务系统抓取）</button>
      <button class="btn block ghost" style="margin-top: 10px" @click="openNew">＋ 手动添加一节课</button>
      <div class="small muted" style="margin-top: 12px">导入完成后，这个入口会收进右下角的「工具箱」</div>
    </div>

    <transition :name="'wk-' + wkDir" mode="out-in">
    <div v-if="ttHasCourses" class="grid" :key="week" :style="{ gridTemplateColumns: '52px repeat(' + dayIndexes.length + ', 1fr)', '--tz': gridTz }">
      <div class="corner">节次</div>
      <div v-for="di in dayIndexes" :key="di" class="dayhead" :class="{ today: isTodayCol(di) }"><div class="dw">{{ DAY_FULL[di] }}</div><div class="dd">{{ mdOf(di) }}</div></div>
      <div class="timecol">
        <div v-for="p in 12" :key="p" class="timelab" :style="{ height: ROW_H + 'px' }"><b>{{ p }}</b><span>{{ timeOf(p) }}</span><span class="te">{{ timeOf(p, true) }}</span></div>
      </div>
      <div v-for="(day, i) in placed" :key="i" class="daycol" :class="{ today: isTodayCol(dayIndexes[i]) }">
        <div v-for="p in 12" :key="p" class="cell" :style="{ height: ROW_H + 'px' }"></div>
        <div
          v-for="x in day" :key="x.b.key" class="cblock"
          :style="{
            top: (x.b.startPeriod - 1) * ROW_H + 2 + 'px',
            height: (x.b.endPeriod - x.b.startPeriod + 1) * ROW_H - 4 + 'px',
            left: 'calc(' + (x.lane * 100 / x.lanes) + '% + 2px)',
            width: 'calc(' + (100 / x.lanes) + '% - 4px)',
            background: colorOf(x.b)
          }"
          :class="{ now: dayIndexes[i] === todayIdx && week === db.currentWeek && x.b.startPeriod <= nowPeriod && x.b.endPeriod >= nowPeriod }"
          @click="detail = x.b"
        >
          <div class="bn">{{ x.b.name }}</div>
          <div class="bm">{{ timeOf(x.b.startPeriod) }}–{{ timeOf(x.b.endPeriod, true) }}</div>
          <div class="bm rm">{{ x.b.rooms[0] }}</div>
        </div>
      </div>
    </div>
    </transition>
  </div>

      <!-- 可拖动，但只能在脚本算出的"允许区域"内（详见脚本里 v2.15 的说明） -->
      <button
        class="toolbox"
        :class="{ dragging: toolDragging }"
        :style="toolStyle"
        aria-label="课表工具箱（可拖动，不会拖出屏幕）"
        @pointerdown="toolDown"
        @pointermove="toolMove"
        @pointerup="toolUp"
        @pointercancel="toolUp"
      ><span class="tico">🧰</span><span class="tlabel">工具箱</span></button>

  <div v-if="showMenu" class="mask" @click.self="showMenu = false">
    <div class="sheet">
        <div class="title">课表工具箱</div>
      <div class="hairline"></div>
        <!-- 工具箱 = 动作菜单，顺序按产品负责人指定（v2.15）：
             导入课表 → 更改课表信息 → 手动添加课程 → 新建课表 → 切换课表。
             原先那条「打开教务系统」已按要求删掉（导入流程里本来就会打开教务系统）。 -->
        <div class="li" @click="openImport()">
          <span class="ico2">📥</span>
          <span class="grow"><b>导入课表</b><br /><span class="small muted">从教务系统抓取个人课表；这份课表已有课时会先问「合并还是覆盖」</span></span>
          <span>›</span>
        </div>
        <div class="li" @click="showSettings = true; showMenu = false">
          <span class="ico2">✏️</span>
          <span class="grow"><b>更改课表信息</b><br /><span class="small muted">课表名称 / 学期第一周周一 / 总周数 / 节次时间</span></span>
          <span>›</span>
        </div>
        <div class="li" @click="openShare()">
          <span class="ico2">📤</span>
          <span class="grow"><b>分享这张课表</b><br /><span class="small muted">生成二维码 / 链接；数据在链接里，不上传服务器</span></span>
          <span>›</span>
        </div>
        <div class="li" @click="openNew"><span class="ico2">＋</span><span class="grow">手动添加课程</span><span>›</span></div>
        <div class="li" @click="createTimetable">
          <span class="ico2">🗂</span>
          <span class="grow"><b>新建课表</b><br /><span class="small muted">再导入一份别的学期，两份互不覆盖</span></span>
          <span>›</span>
        </div>
      <div class="hairline"></div>
      <div class="small muted" style="margin-bottom: 6px">切换课表</div>
      <div v-for="t in db.timetables" :key="t.id" class="li" @click="pickTimetable(t.id)">
        <span class="grow">{{ t.name }}</span>
        <span v-if="t.id === db.settings.lastActiveTimetableId" class="pill brand">使用中</span>
        <button v-else class="btn sm danger" @click.stop="dropTimetable(t.id)">删除</button>
      </div>
      <div v-if="!db.timetables.length" class="muted small">暂无课表</div>
    </div>
  </div>

  <div v-if="showSettings" class="mask" @click.self="showSettings = false">
    <div class="sheet">
      <div class="row"><div class="title grow">更改课表信息</div><button class="btn sm ghost" @click="showSettings = false">关闭</button></div>
      <div class="hairline"></div>
      <SettingsPanel />
    </div>
  </div>

  <!-- 分享：二维码 + 链接。数据全在链接里，不上传服务器 -->
  <div v-if="showShare" class="mask" @click.self="showShare = false">
    <div class="sheet">
      <div class="row"><div class="title grow">分享这张课表</div><button class="btn sm ghost" @click="showShare = false">关闭</button></div>
      <div class="hairline"></div>
      <template v-if="shareLink">
        <div v-if="shareQr" class="qrbox" v-html="shareQr"></div>
        <div v-else class="small warn" style="margin-bottom: 8px">
          这张课表内容较多，二维码放不下 —— 用下面的链接分享（一样能打开）。
        </div>
        <div class="small muted" style="line-height: 1.7">
          同学扫这个码（或点链接）就能看到你的课表只读页，页面在 <b>{{ shareHost() }}</b> 上。<br />
          链接里<b>只含课程名、教室、时间与周次，不含教师姓名</b>；<b>不会上传到任何服务器</b>——
          数据就在链接的 # 部分，浏览器不会把它发给服务器。发给谁，谁就能看到，请按需分享。<br />
          课表内容多时码会比较密：扫不动就点「复制分享链接」直接发链接。
        </div>
        <div class="row" style="gap: 8px; margin-top: 12px">
          <button class="btn grow" @click="copyShareLink()">复制分享链接</button>
          <button class="btn ghost grow" @click="showShare = false">关闭</button>
        </div>
        <div class="linkbox">{{ shareLink }}</div>
      </template>
      <div v-else class="empty">这张课表还是空的，先导入或添加课程再来分享。</div>
    </div>
  </div>

  <div v-if="showWeekPicker" class="mask" @click.self="showWeekPicker = false">
    <div class="sheet">
      <div class="title">选择周次</div>
      <div class="hairline"></div>
      <div class="chips">
        <button v-for="w in db.activeTimetable?.totalWeeks || 18" :key="w" class="chip" :class="{ on: w === week }" @click="week = w; showWeekPicker = false">{{ w }}</button>
      </div>
      <button class="btn block grey" style="margin-top: 14px" @click="goToday(); showWeekPicker = false">回到本周（第 {{ db.currentWeek }} 周）</button>
      <div class="hairline" style="margin:14px 0 8px"></div>
      <div class="row" style="justify-content: space-between"><span class="small muted">第 1 周周一</span><b class="small">{{ db.activeTimetable?.semesterStartMonday || '未设置' }}</b></div>
      <div class="row" style="justify-content: space-between; margin-top: 4px"><span class="small muted">学期总周数</span><b class="small">{{ db.activeTimetable?.totalWeeks || '—' }} 周</b></div>
      <button class="btn block ghost" style="margin-top: 10px" @click="showWeekPicker = false; showSettings = true">调整学期起始周与总周数</button>
    </div>
  </div>

  <div v-if="detail" class="mask" @click.self="detail = null">
    <div class="sheet">
      <div class="row"><span class="dot" :style="{ background: colorOf(detail) }"></span><div class="title grow">{{ detail.name }}</div></div>
      <div class="hairline"></div>
      <div class="kv"><span>时间</span><b>{{ DAY_FULL[detail.day - 1] }} 第 {{ detail.startPeriod }}-{{ detail.endPeriod }} 节 {{ timeOf(detail.startPeriod) }}-{{ timeOf(detail.endPeriod, true) }}</b></div>
      <div class="kv"><span>周次</span><b>{{ detail.weeksRaw || detail.weeks.join(',') }}</b></div>
      <div class="kv"><span>地点</span><b>{{ detail.rooms.join(' / ') || '未填写' }}</b></div>
      <div class="kv"><span>教师</span><b>{{ detail.teachers.join('、') || '未填写' }}</b></div>
      <div class="kv"><span>学分 / 考核</span><b>{{ detail.credit ?? '—' }} / {{ detail.examMode || '—' }}</b></div>
      <div class="kv"><span>课序号</span><b>{{ detail.courseCode || '—' }}</b></div>
      <div v-if="detail.rooms.length > 1" class="small muted" style="margin-top: 6px">该时段有 {{ detail.rooms.length }} 个可选上课地点，已合并显示。</div>
      <div v-if="detail.pendingFilter" class="pill warn" style="margin-top: 6px">教务系统标记为"待筛选"，请确认是否修读</div>
      <div class="hairline" style="margin: 14px 0 10px"></div>
      <div class="row" style="justify-content: space-between; align-items: baseline">
        <span class="small bold">课程资料</span>
        <label class="btn sm ghost filebtn">＋ 添加文件
          <input type="file" multiple accept="*/*" style="display:none" @change="onPickMaterial" />
        </label>
      </div>
      <div v-if="matBusy" class="small muted">{{ matBusy }}</div>
      <div v-if="!detailMats.length" class="small muted" style="margin-top: 4px">
        还没有资料。可添加课件 PPT / Word / PDF / 图片等，文件保存在本机，点开由系统应用（WPS、PDF 阅读器等）打开。
      </div>
      <div v-for="m in detailMats" :key="m.id" class="mat">
        <span class="mi">{{ extOf(m.name).toUpperCase().slice(0, 4) }}</span>
        <div class="grow" @click="openMaterial(m)">
          <div class="small bold mt">{{ m.name }}</div>
          <div class="tiny muted">{{ humanSize(m.size) }} · {{ m.addedAt.slice(0, 10) }}</div>
        </div>
        <button class="btn sm ghost" @click="openMaterial(m)">打开</button>
        <button class="btn sm danger" @click="delMaterial(m)">删</button>
      </div>
      <div class="row" style="margin-top: 16px">
        <button class="btn grow" @click="editBlock(detail)">编辑</button>
        <button class="btn grey grow" @click="db.activeSheet = 'sheet2'; detail = null">记待办</button>
        <button class="btn danger grow" @click="delBlock(detail)">删除</button>
      </div>
    </div>
  </div>

  <div v-if="editing" class="mask" @click.self="editing = null">
    <div class="sheet">
      <div class="title">{{ isNew ? '添加课程' : '编辑课程' }}</div>
      <div class="hairline"></div>
      <div class="field"><label>课程名称</label><input v-model="editing.name" placeholder="如：数字电子技术" /></div>
      <div class="grid2">
        <div class="field"><label>星期</label><select v-model.number="editing.day"><option v-for="(d, i) in DAY_FULL" :key="d" :value="i + 1">{{ d }}</option></select></div>
        <div class="field"><label>教师</label><input v-model="editing.teacher" /></div>
        <div class="field"><label>开始节次</label><select v-model.number="editing.startPeriod"><option v-for="p in 12" :key="p" :value="p">第 {{ p }} 节</option></select></div>
        <div class="field"><label>结束节次</label><select v-model.number="editing.endPeriod"><option v-for="p in 12" :key="p" :value="p">第 {{ p }} 节</option></select></div>
        <div class="field"><label>校区</label><input v-model="editing.campus" /></div>
        <div class="field"><label>教室</label><input v-model="editing.room" /></div>
        <div class="field"><label>学分</label><input v-model.number="editing.credit" type="number" step="0.5" /></div>
        <div class="field"><label>考核方式</label><input v-model="editing.examMode" placeholder="考试 / 考查" /></div>
      </div>
      <div class="field"><label>周次（点击选择）</label>
        <div class="chips"><button v-for="w in db.activeTimetable?.totalWeeks || 18" :key="w" class="chip sm" :class="{ on: editing.weeks.includes(w) }" @click="toggleWeek(w)">{{ w }}</button></div>
      </div>
      <div class="field"><label>颜色</label>
        <div class="chips"><button v-for="(c, i) in COURSE_COLORS" :key="i" class="sw" :class="{ on: colorIndexOf(editing) === i }" :style="{ background: c }" @click="pickColor(i)"></button><button class="chip sm" :class="{ on: !editing.colorSet }" @click="autoColor">按课程名自动</button></div>
      </div>
      <div class="row">
        <button class="btn grow" @click="saveCourse">保存</button>
        <button class="btn ghost grow" @click="editing = null">取消</button>
      </div>
    </div>
  </div>

  <ImportPanel v-if="showImport" @close="showImport = false" />
</template>

<style scoped>
/* 工具箱固定在右下角（bottom 88px + 高 52px），滚动区底部要留够余量，
   否则滚到底时课表最后一行永远压在按钮底下点不到。 */
.scroll { padding-bottom: calc(152px + var(--safe-b)); }
.weeknav { display: flex; align-items: center; gap: 6px; padding: 8px 10px; }
.nav { width: 34px; height: 34px; border-radius: 10px; background: var(--soft-2); color: var(--brand); font-size: 20px; line-height: 1; flex: none; }
.nav:disabled { opacity: .35; }
.cur { flex: 1; text-align: center; }
.today { flex: none; }
.wr { font-size: 11px; font-weight: 500; color: var(--muted); margin-left: 4px; }
.mat { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px dashed var(--line); }
.mi { flex: none; min-width: 40px; text-align: center; font-size: 10px; font-weight: 700; color: var(--brand); background: var(--tint); border-radius: 7px; padding: 5px 4px; }
.mt { word-break: break-all; line-height: 1.35; }
.tiny { font-size: 10.5px; }
.filebtn { cursor: pointer; }
.swipe-hint { margin: 4px 0 8px; }
.nextbar { display: flex; align-items: center; gap: 9px; background: var(--card); border-radius: 11px; padding: 7px 10px; margin: 0 0 7px; box-shadow: var(--shadow); }
.ndot { width: 9px; height: 9px; border-radius: 3px; flex: none; }
.ngrow { flex: 1; min-width: 0; }
.n1 { display: flex; align-items: baseline; gap: 7px; font-size: 13px; line-height: 1.3; }
.n1 b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nu { font-size: 11px; color: var(--brand); flex: none; }
.n2 { font-size: 11px; color: var(--muted); line-height: 1.3; margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ncv { font-size: 11.5px; color: var(--muted); flex: none; }
.dot { width: 12px; height: 12px; border-radius: 4px; flex: none; }
/* --tz：文字缩放补偿系数，默认 1（标准字号 / 桌面预览）。真机上是原生 textZoom 的倍数，
   由模板根据 display 服务里的 textZoomFactor 内联覆盖；这里给个默认值，避免变量未定义时整条 calc 失效。 */
.grid { --tz: 1; display: grid; grid-template-columns: 52px repeat(7, 1fr); background: var(--card); border-radius: 12px; overflow: hidden; box-shadow: var(--shadow); }
/* 网格内的字号统一写成 calc(px / var(--tz))：
   --tz 是原生 textZoom 的倍数（桌面预览的整页 zoom 路径下为 1）。
   这样网格在任何字号档位下外观都与"标准"一致 —— 文字不会把格子挤爆，节次列也不会显得特别大。 */
.corner { font-size: calc(11px / var(--tz, 1)); color: var(--muted); text-align: center; padding: 7px 0; border-bottom: 1px solid var(--line); background: var(--soft); }
.dayhead { font-size: calc(11px / var(--tz, 1)); color: var(--muted); text-align: center; padding: 5px 0 6px; border-bottom: 1px solid var(--line); background: var(--soft); line-height: 1.25; }
.dayhead .dw { font-size: calc(11.5px / var(--tz, 1)); }
.dayhead .dd { font-size: calc(10px / var(--tz, 1)); opacity: .78; font-variant-numeric: tabular-nums; }
.dayhead.today { color: var(--brand); background: var(--tint); }
.dayhead.today .dw { font-weight: 700; }
.dayhead.today .dd { opacity: 1; font-weight: 600; }
.timecol { border-right: 1px solid var(--line); }
.timelab { display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding-top: 3px; font-size: calc(9.5px / var(--tz, 1)); line-height: 1.25; color: var(--muted); border-bottom: 1px dashed var(--line); }
.timelab b { font-size: calc(11px / var(--tz, 1)); color: var(--ink); }
.timelab .te { color: var(--muted); }
.timelab b { font-size: calc(12px / var(--tz, 1)); color: var(--strong); }
.daycol { position: relative; border-right: 1px solid var(--line); }
.daycol.today { background: #F6F9FF; }
.cell { border-bottom: 1px dashed var(--line); }
/* 课程色块。
   类名必须避开 .block：全局 .btn.block 是"整行按钮"的宽度工具类，
   而 scoped 样式对所有带该 class 的子元素都生效 —— 两者同名过会把
   本组件里所有「整行按钮」变成绝对定位的 10px 色块（真机截图上就是错位和叠字）。 */
.cblock { position: absolute; border-radius: 7px; color: #fff; padding: 3px 4px; overflow: hidden; font-size: calc(10px / var(--tz, 1)); line-height: 1.25; }
.cblock.now { outline: 2.5px solid #14181F; outline-offset: -2px; }
.bm.rm { opacity: .82; }
.bn { font-weight: 700; font-size: calc(11px / var(--tz, 1)); word-break: break-all; }
.bm { opacity: .88; word-break: break-all; }
/* 工具箱：可拖动，位置由 JS 按"允许区域"算出来（left/top + transform）。
   - z-index 抬到 56（高于底栏 50）：万一极大字号把底栏顶得很高，按钮也仍在最上层可见可点。
   - touch-action: none 是拖动的前提，否则浏览器会把手势当成滚动手势。 */
.toolbox {
  position: fixed; left: 0; top: 0;
  width: 52px; height: 52px; border-radius: 17px; border: none;
  background: var(--brand); color: #fff; box-shadow: 0 6px 16px rgba(20, 32, 60, .30);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
  z-index: 56; touch-action: none; user-select: none; -webkit-user-select: none; will-change: transform;
}
.toolbox.dragging { opacity: .82; box-shadow: 0 10px 22px rgba(20, 32, 60, .38); }
.tico { font-size: 19px; line-height: 1; }
.tlabel { font-size: 9.5px; line-height: 1; opacity: .9; }
.ico2 { width: 24px; text-align: center; }
.kv { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px dashed var(--line); font-size: 14px; }
.kv span { color: var(--muted); flex: none; }
.kv b { text-align: right; word-break: break-all; }
.sw { width: 30px; height: 30px; border-radius: 9px; border: 2px solid transparent; }
.sw.on { border-color: #14181F; }
/* 分享面板：二维码居中、链接可选中（长按复制） */
.qrbox { display: flex; justify-content: center; margin: 4px 0 12px; }
.qrbox :deep(svg) { border-radius: 12px; border: 1px solid var(--line); background: #fff; }
.linkbox { margin-top: 10px; padding: 10px; border-radius: 10px; background: var(--soft); color: var(--muted); font-size: 11px; line-height: 1.6; word-break: break-all; user-select: text; -webkit-user-select: text; }
/* 周次滑动切换动画 */
.grid { transition: none; }
.wk-r-enter-active, .wk-r-leave-active, .wk-l-enter-active, .wk-l-leave-active { transition: transform .2s ease, opacity .2s ease; }
.wk-r-enter-from { transform: translateX(26%); opacity: 0; }
.wk-r-leave-to { transform: translateX(-26%); opacity: 0; }
.wk-l-enter-from { transform: translateX(-26%); opacity: 0; }
.wk-l-leave-to { transform: translateX(26%); opacity: 0; }
</style>
