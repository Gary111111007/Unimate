<script setup lang="ts">
import { computed, ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { COURSE_COLORS } from '../catalog/periods.ts';
import { uuid, nowStamp } from '../services/id.ts';
import type { Course } from '../types.ts';
import ImportPanel from './ImportPanel.vue';
import SettingsPanel from '../components/SettingsPanel.vue';

const db = useDb();
const week = ref(db.currentWeek);
const wkDir = ref<'r' | 'l'>('r');
const showWeekPicker = ref(false);
const showImport = ref(false);
const showMenu = ref(false);
const showSettings = ref(false);
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
  weeks: number[]; rooms: string[]; teachers: string[]; colorIndex: number;
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
    } else {
      map.set(key, {
        key, name: c.name, day: c.day, startPeriod: c.startPeriod, endPeriod: c.endPeriod,
        weeks: c.weeks, rooms: [c.room].filter(Boolean), teachers: [c.teacher].filter(Boolean),
        colorIndex: c.colorIndex, pendingFilter: c.pendingFilter, credit: c.credit, examMode: c.examMode,
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

const nextClass = computed(() => {
  const col = placed.value[dayIndexes.value.indexOf(todayIdx.value)];
  if (!col) return null;
  const list = col.map((x) => x.b).sort((a, b) => a.startPeriod - b.startPeriod);
  return list.find((b) => b.startPeriod > nowPeriod.value) || null;
});

function colorOf(b: Block): string { return COURSE_COLORS[(b.colorIndex || 0) % COURSE_COLORS.length]; }
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
async function saveCourse(): Promise<void> {
  const c = editing.value!;
  if (!c.name.trim()) { db.notify('请填写课程名称'); return; }
  if (!c.weeks.length) { db.notify('请选择至少一个周次'); return; }
  if (isNew.value) {
    c.id = uuid(); c.timetableId = db.activeTimetable!.id; c.colorIndex = db.courses.length % 12;
    db.courses.push(c);
  } else {
    const i = db.courses.findIndex((x) => x.id === c.id);
    if (i >= 0) db.courses[i] = { ...c, editedFields: Array.from(new Set(c.editedFields.concat('manual'))) } as Course;
  }
  await db.saveData();
  editing.value = null; detail.value = null;
  db.notify(isNew.value ? '课程已添加' : '课程已保存');
}
async function delBlock(b: Block): Promise<void> {
  const ids = db.courses.filter((c) => c.timetableId === b.first.timetableId && c.name === b.name && c.day === b.day && c.startPeriod === b.startPeriod && c.endPeriod === b.endPeriod).map((c) => c.id);
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
  db.notify('已新建课表，可用「一键保存」从教务系统导入');
}
async function dropTimetable(id: string): Promise<void> {
  db.timetables = db.timetables.filter((t) => t.id !== id);
  db.courses = db.courses.filter((c) => c.timetableId !== id);
  db.settings.lastActiveTimetableId = db.timetables[0]?.id || null;
  await db.saveData();
  showMenu.value = false;
  db.notify('课表已删除');
}
function goToday(): void { week.value = db.currentWeek; }
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
    <div class="card weeknav">
      <button class="nav" @click="shift(-1)" :disabled="week <= 1">‹</button>
      <div class="cur" @click="showWeekPicker = true">
        <div class="bold">第 {{ week }} 周 <span class="wr">{{ weekRange }}</span></div>
        <div class="small muted">{{ db.activeTimetable?.name || '还没有课表' }} · 共 {{ db.activeTimetable?.totalWeeks || 0 }} 周</div>
      </div>
      <button class="nav" @click="shift(1)" :disabled="week >= (db.activeTimetable?.totalWeeks || 18)">›</button>
      <button v-if="week !== db.currentWeek" class="btn sm ghost today" @click="goToday">回本周</button>
    </div>
    <div class="swipe-hint center">左右滑动可切换周次</div>

    <div v-if="nextClass" class="card next">
      <span class="dot" :style="{ background: colorOf(nextClass) }"></span>
      <div class="grow">
        <div class="small muted">下一节 · 第 {{ nextClass.startPeriod }}-{{ nextClass.endPeriod }} 节 {{ timeOf(nextClass.startPeriod) }}-{{ timeOf(nextClass.endPeriod, true) }}</div>
        <div class="bold">{{ nextClass.name }}</div>
        <div class="small">{{ nextClass.rooms.join(' / ') }}<span v-if="nextClass.teachers.length"> · {{ nextClass.teachers.join('、') }}</span></div>
      </div>
      <button class="btn sm ghost" @click="detail = nextClass">详情</button>
    </div>

    <div v-if="!db.courses.length" class="empty">
      <div class="big">🗓</div>
      <div>还没有课表</div>
      <div class="small">点右下角「一键保存」<br />从教务系统导入个人课表</div>
      <button class="btn sm" style="margin-top: 14px" @click="openNew">手动添加课程</button>
    </div>

    <transition :name="'wk-' + wkDir" mode="out-in">
    <div v-if="placed.length" class="grid" :key="week" :style="{ gridTemplateColumns: '38px repeat(' + dayIndexes.length + ', 1fr)' }">
      <div class="corner">节次</div>
      <div v-for="di in dayIndexes" :key="di" class="dayhead" :class="{ today: isTodayCol(di) }"><div class="dw">{{ DAY_FULL[di] }}</div><div class="dd">{{ mdOf(di) }}</div></div>
      <div class="timecol">
        <div v-for="p in 12" :key="p" class="timelab" :style="{ height: ROW_H + 'px' }"><b>{{ p }}</b><span>{{ timeOf(p) }}</span></div>
      </div>
      <div v-for="(day, i) in placed" :key="i" class="daycol" :class="{ today: isTodayCol(dayIndexes[i]) }">
        <div v-for="p in 12" :key="p" class="cell" :style="{ height: ROW_H + 'px' }"></div>
        <div
          v-for="x in day" :key="x.b.key" class="block"
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
          <div class="bm">{{ x.b.rooms[0] }}</div>
        </div>
      </div>
    </div>
    </transition>
  </div>

  <button class="fab" @click="showImport = true">一键<br />保存</button>
  <button class="fab2" @click="showMenu = true">⋯</button>

  <div v-if="showMenu" class="mask" @click.self="showMenu = false">
    <div class="sheet">
      <div class="title">课表</div>
      <div class="hairline"></div>
      <div class="li" @click="showImport = true; showMenu = false"><span class="ico2">🏛</span><span class="grow">教务系统（jwglxt.buct.edu.cn）</span><span>›</span></div>
      <div class="li" @click="openNew"><span class="ico2">＋</span><span class="grow">手动添加课程</span><span>›</span></div>
      <div class="li" @click="showSettings = true; showMenu = false"><span class="ico2">⚙</span><span class="grow">课表设置（学期起始周 / 节次时间）</span><span>›</span></div>
      <div class="li" @click="createTimetable"><span class="ico2">🗂</span><span class="grow">新建课表</span><span>›</span></div>
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
      <div class="row"><div class="title grow">课表设置</div><button class="btn sm ghost" @click="showSettings = false">关闭</button></div>
      <div class="hairline"></div>
      <SettingsPanel />
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
        <div class="chips"><button v-for="(c, i) in COURSE_COLORS" :key="i" class="sw" :class="{ on: editing.colorIndex === i }" :style="{ background: c }" @click="editing.colorIndex = i"></button></div>
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
.weeknav { display: flex; align-items: center; gap: 6px; padding: 8px 10px; }
.nav { width: 34px; height: 34px; border-radius: 10px; background: #EDF0F5; color: var(--brand); font-size: 20px; line-height: 1; flex: none; }
.nav:disabled { opacity: .35; }
.cur { flex: 1; text-align: center; }
.today { flex: none; }
.wr { font-size: 11px; font-weight: 500; color: var(--muted); margin-left: 4px; }
.swipe-hint { margin: 4px 0 8px; }
.next { display: flex; gap: 10px; align-items: center; border-left: 4px solid var(--brand); }
.dot { width: 12px; height: 12px; border-radius: 4px; flex: none; }
.grid { display: grid; grid-template-columns: 38px repeat(7, 1fr); background: #fff; border-radius: 12px; overflow: hidden; box-shadow: var(--shadow); }
.corner { font-size: 11px; color: var(--muted); text-align: center; padding: 7px 0; border-bottom: 1px solid var(--line); background: #F7F9FC; }
.dayhead { font-size: 11px; color: var(--muted); text-align: center; padding: 5px 0 6px; border-bottom: 1px solid var(--line); background: #F7F9FC; line-height: 1.25; }
.dayhead .dw { font-size: 11.5px; }
.dayhead .dd { font-size: 10px; opacity: .78; font-variant-numeric: tabular-nums; }
.dayhead.today { color: var(--brand); background: #EDF3FF; }
.dayhead.today .dw { font-weight: 700; }
.dayhead.today .dd { opacity: 1; font-weight: 600; }
.timecol { border-right: 1px solid var(--line); }
.timelab { display: flex; flex-direction: column; align-items: center; padding-top: 3px; font-size: 10px; color: var(--muted); border-bottom: 1px dashed var(--line); }
.timelab b { font-size: 12px; color: #3A424E; }
.daycol { position: relative; border-right: 1px solid var(--line); }
.daycol.today { background: #F6F9FF; }
.cell { border-bottom: 1px dashed var(--line); }
.block { position: absolute; border-radius: 7px; color: #fff; padding: 3px 4px; overflow: hidden; font-size: 10px; line-height: 1.25; }
.block.now { outline: 2.5px solid #14181F; outline-offset: -2px; }
.bn { font-weight: 700; font-size: 11px; word-break: break-all; }
.bm { opacity: .88; word-break: break-all; }
.fab2 { position: fixed; right: 18px; bottom: calc(150px + var(--safe-b)); width: 42px; height: 42px; border-radius: 50%; background: #fff; color: var(--brand); box-shadow: var(--shadow); font-size: 20px; z-index: 39; }
.ico2 { width: 24px; text-align: center; }
.kv { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px dashed var(--line); font-size: 14px; }
.kv span { color: var(--muted); flex: none; }
.kv b { text-align: right; word-break: break-all; }
.sw { width: 30px; height: 30px; border-radius: 9px; border: 2px solid transparent; }
.sw.on { border-color: #14181F; }
/* 周次滑动切换动画 */
.grid { transition: none; }
.wk-r-enter-active, .wk-r-leave-active, .wk-l-enter-active, .wk-l-leave-active { transition: transform .2s ease, opacity .2s ease; }
.wk-r-enter-from { transform: translateX(26%); opacity: 0; }
.wk-r-leave-to { transform: translateX(-26%); opacity: 0; }
.wk-l-enter-from { transform: translateX(-26%); opacity: 0; }
.wk-l-leave-to { transform: translateX(26%); opacity: 0; }
</style>