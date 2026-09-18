<script setup lang="ts">
import { computed, ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { uuid, nowStamp } from '../services/id.ts';
import type { NoteItem } from '../types.ts';

const db = useDb();
const mode = ref<'calendar' | 'list'>('calendar');
const now = new Date();
const y = ref(now.getFullYear());
const m = ref(now.getMonth());            // 0-based
const sel = ref(keyOf(now));
const q = ref('');
const editing = ref<NoteItem | null>(null);
const isNew = ref(false);

const ALARMS = [{ v: 0, t: '发生时' }, { v: 5, t: '提前5分钟' }, { v: 15, t: '提前15分钟' }, { v: 60, t: '提前1小时' }];
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function pad(n: number): string { return String(n).padStart(2, '0'); }
function keyOf(d: Date): string { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function todayKey(): string { return keyOf(new Date()); }
function noteDate(n: NoteItem): string { return n.remindAt ? n.remindAt.slice(0, 10) : ''; }

const live = computed(() => db.notes.filter((n) => !n.deletedAt));
const byDate = computed(() => {
  const map = new Map<string, NoteItem[]>();
  for (const n of live.value) {
    const k = noteDate(n);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(n);
  }
  for (const list of map.values()) list.sort((a, b) => (a.remindAt < b.remindAt ? -1 : 1));
  return map;
});

const cells = computed(() => {
  const first = new Date(y.value, m.value, 1);
  const startIdx = first.getDay();
  const daysInMonth = new Date(y.value, m.value + 1, 0).getDate();
  const total = Math.ceil((startIdx + daysInMonth) / 7) * 7;
  const out: { key: string; day: number; inMonth: boolean; has: boolean; done: boolean; isToday: boolean }[] = [];
  // 用日期游标推进，跨月/跨年由 Date 自己算，避免手算日序出错
  const cursor = new Date(y.value, m.value, 1 - startIdx);
  for (let i = 0; i < total; i++) {
    const key = keyOf(cursor);
    const list = byDate.value.get(key) || [];
    out.push({
      key, day: cursor.getDate(), inMonth: cursor.getMonth() === m.value && cursor.getFullYear() === y.value,
      has: list.length > 0, done: list.length > 0 && list.every((n) => n.done), isToday: key === todayKey()
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
});

const selList = computed(() => byDate.value.get(sel.value) || []);
const selLabel = computed(() => {
  const d = new Date(sel.value.replace(/-/g, '/') + ' 00:00:00');
  const w = '周' + WEEK[d.getDay()];
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + w;
});
const monthLabel = computed(() => y.value + '年' + (m.value + 1) + '月');
const monthCount = computed(() => {
  const prefix = y.value + '-' + pad(m.value + 1);
  return live.value.filter((n) => noteDate(n).startsWith(prefix)).length;
});

const calAnim = ref('');
let touchX = 0; let touchY = 0;

function shiftMonth(d: number, animate = true): void {
  let mm = m.value + d;
  let yy = y.value;
  if (mm < 0) { mm = 11; yy -= 1; } else if (mm > 11) { mm = 0; yy += 1; }
  if (animate) calAnim.value = d > 0 ? 'slide-l' : 'slide-r';
  y.value = yy; m.value = mm;
}
function endCal(): void { calAnim.value = ''; }
function onCalTouchStart(e: TouchEvent): void {
  touchX = e.changedTouches[0].clientX; touchY = e.changedTouches[0].clientY;
}
function onCalTouchEnd(e: TouchEvent): void {
  const dx = e.changedTouches[0].clientX - touchX;
  const dy = e.changedTouches[0].clientY - touchY;
  // 横向位移足够大且明显大于纵向才判定为切月手势，避免和上下滚动打架
  if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
  shiftMonth(dx < 0 ? 1 : -1);
}
function goToday(): void {
  const d = new Date();
  y.value = d.getFullYear(); m.value = d.getMonth(); sel.value = keyOf(d);
}
let sx = 0; let sy = 0;
function onTouchStart(e: TouchEvent): void { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }
function onTouchEnd(e: TouchEvent): void {
  const dx = e.changedTouches[0].clientX - sx;
  const dy = e.changedTouches[0].clientY - sy;
  if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) shiftMonth(dx < 0 ? 1 : -1);
}

const listShown = computed(() => {
  const k = q.value.trim();
  return live.value.filter((n) => (!k || n.title.includes(k) || n.content.includes(k)))
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (!a.remindAt) return 1;
      if (!b.remindAt) return -1;
      return a.remindAt < b.remindAt ? -1 : 1;
    });
});

/**
 * 解析 remindAt。老数据里同时存在 "2026-09-18 19:52:33" 与带 T 的 ISO 串，
 * 统一斜杠写法可避免部分 WebView 把 "2026-09-18" 当 UTC 零点解析（会整体偏 8 小时）。
 * 只有日期没有时间时按当天 23:59 算 —— 用户写"9月20日交"不会一过零点就变成逾期一天。
 */
function parseWhen(s: string): number | null {
  if (!s) return null;
  const iso = s.trim().replace('T', ' ');
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const norm = (dateOnly ? iso + ' 23:59:00' : iso).replace(/-/g, '/');
  const ms = new Date(norm).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** 分钟数转"X 天 X 小时 X 分"里非零的高位部分，最多两级，避免出现"1 小时"这种看不出精度的显示 */
function span(mins: number): string {
  const d = Math.floor(mins / 1440); const h = Math.floor((mins % 1440) / 60); const m = mins % 60;
  if (d > 0) return h > 0 ? d + ' 天 ' + h + ' 小时' : d + ' 天';
  if (h > 0) return m > 0 ? h + ' 小时 ' + m + ' 分' : h + ' 小时';
  return Math.max(1, m) + ' 分钟';
}

/** 逾期：显示到"小时+分钟"两级精度，不再把 1 小时 42 分糊成"1 小时" */
function overdueText(n: NoteItem): string {
  if (!n.remindAt || n.done) return '';
  const at = parseWhen(n.remindAt);
  if (at === null) return '';
  const diff = Date.now() - at;
  if (diff <= 0) return '';
  return '已逾期 ' + span(Math.floor(diff / 60000));
}

/** 未到期也要明确显示，否则用户无法区分"还没到"和"算错了" */
function dueText(n: NoteItem): string {
  if (!n.remindAt || n.done) return '';
  const at = parseWhen(n.remindAt);
  if (at === null) return '';
  const diff = at - Date.now();
  if (diff <= 0) return '';
  return '还有 ' + span(Math.ceil(diff / 60000)) + ' 到期';
}

/** 提前量文案：alarms 只含 0 表示"发生时"，不能渲染成空白的"提前 分" */
function alarmText(n: NoteItem): string {
  const a = (n.alarms || []).slice().sort((x, y) => x - y);
  const pos = a.filter((x) => x > 0);
  if (!a.length) return '';
  if (!pos.length) return ' · 发生时提醒';
  return ' · 提前 ' + pos.join('/') + ' 分';
}
function toInput(s: string): string { return s ? s.slice(0, 16).replace(' ', 'T') : ''; }
function fromInput(v: string): string { return v ? v.replace('T', ' ') + (v.length === 16 ? ':00' : '') : ''; }

function openNew(at?: string): void {
  isNew.value = true;
  const base = at || (sel.value + ' 09:00:00');
  editing.value = {
    id: '', sheet: 'sheet2', title: '', content: '', remindAt: base,
    alarms: db.settings.noteDefaultAlarms.slice(), repeat: 'none', done: false, doneAt: null,
    colorIndex: 2, linkedCourseId: null, createdAt: nowStamp(), updatedAt: nowStamp(), deletedAt: null
  } as NoteItem;
}
function openEdit(n: NoteItem): void { isNew.value = false; editing.value = { ...n, alarms: n.alarms.slice() }; }

async function save(): Promise<void> {
  const n = editing.value!;
  if (!n.title.trim()) { db.notify('请填写标题'); return; }
  n.updatedAt = nowStamp();
  if (isNew.value) { n.id = uuid(); db.notes.unshift({ ...n }); }
  else { const i = db.notes.findIndex((x) => x.id === n.id); if (i >= 0) db.notes[i] = { ...n }; }
  await db.saveData();
  if (n.remindAt) sel.value = n.remindAt.slice(0, 10);
  editing.value = null;
  db.notify(n.remindAt ? '已保存，将按时提醒' : '已保存（未设置提醒）');
}
async function toggleDone(n: NoteItem): Promise<void> {
  n.done = !n.done;
  n.doneAt = n.done ? nowStamp() : null;
  if (n.done && n.repeat !== 'none') {
    const step = n.repeat === 'daily' ? 86400000 : n.repeat === 'weekly' ? 7 * 86400000 : 30 * 86400000;
    db.notes.unshift({ ...n, id: uuid(), done: false, doneAt: null, remindAt: nowStamp(new Date(Date.now() + step)) });
  }
  await db.saveData();
}
async function del(n: NoteItem): Promise<void> {
  const i = db.notes.findIndex((x) => x.id === n.id);
  if (i >= 0) db.notes.splice(i, 1);
  await db.saveData();
  db.notify('已删除');
}
function toggleAlarm(v: number): void {
  const a = editing.value!.alarms;
  const i = a.indexOf(v);
  if (i >= 0) a.splice(i, 1); else a.push(v);
  a.sort((x, z) => z - x);
}
</script>

<template>
  <div class="scroll" @touchstart="onTouchStart" @touchend="onTouchEnd">
    <div class="modes">
      <button :class="{ on: mode === 'calendar' }" @click="mode = 'calendar'">日历</button>
      <button :class="{ on: mode === 'list' }" @click="mode = 'list'">全部（{{ live.length }}）</button>
    </div>

    <template v-if="mode === 'calendar'">
      <div class="mhead">
        <button class="mnav" @click="shiftMonth(-1)">‹</button>
        <div class="grow center">
          <div class="bold">{{ monthLabel }}</div>
          <div class="small muted">本月 {{ monthCount }} 条记事</div>
        </div>
        <button class="mnav" @click="shiftMonth(1)">›</button>
        <button class="btn sm ghost" @click="goToday">今天</button>
      </div>

      <div class="card cal" :class="calAnim" @animationend="endCal" @touchstart="onCalTouchStart" @touchend="onCalTouchEnd">
        <div v-for="w in WEEK" :key="w" class="wd">{{ w }}</div>
        <div
          v-for="c in cells" :key="c.key" class="dc"
          :class="{ dim: !c.inMonth, sel: c.key === sel }"
          @click="sel = c.key"
        >
          <span class="num" :class="{ today: c.isToday }">{{ c.day }}</span>
          <span class="dots" v-if="c.has"><i :class="{ done: c.done }"></i></span>
        </div>
      </div>

      <div class="dayhead">
        <span class="bold">{{ selLabel }}</span>
        <button class="btn sm ghost" @click="openNew()">在这一天记一条</button>
      </div>

      <div v-if="!selList.length" class="empty small">这一天还没有记事</div>
      <div v-for="n in selList" :key="n.id" class="card item" :class="{ done: n.done }">
        <button class="cb" :class="{ on: n.done }" @click="toggleDone(n)">{{ n.done ? '✓' : '' }}</button>
        <div class="grow" @click="openEdit(n)">
          <div class="bold">{{ n.title }}</div>
          <div v-if="n.content" class="small muted">{{ n.content }}</div>
          <div class="row" style="margin-top: 5px; gap: 6px; flex-wrap: wrap">
            <span class="pill">{{ n.remindAt ? n.remindAt.slice(11, 16) : '未设时间' }}{{ alarmText(n) }}</span>
            <span v-if="dueText(n)" class="pill live">{{ dueText(n) }}</span>
            <span v-if="overdueText(n)" class="pill danger">{{ overdueText(n) }}</span>
            <span v-if="n.repeat !== 'none'" class="pill">{{ n.repeat === 'daily' ? '每天' : n.repeat === 'weekly' ? '每周' : '每月' }}</span>
          </div>
        </div>
        <button class="btn sm danger" @click="del(n)">删</button>
      </div>
    </template>

    <template v-else>
      <input v-model="q" class="search" placeholder="搜索标题或内容" />
      <div v-if="!listShown.length" class="empty small">还没有记事</div>
      <div v-for="n in listShown" :key="n.id" class="card item" :class="{ done: n.done }">
        <button class="cb" :class="{ on: n.done }" @click="toggleDone(n)">{{ n.done ? '✓' : '' }}</button>
        <div class="grow" @click="openEdit(n)">
          <div class="bold">{{ n.title }}</div>
          <div v-if="n.content" class="small muted">{{ n.content }}</div>
          <div class="row" style="margin-top: 5px; gap: 6px; flex-wrap: wrap">
            <span v-if="n.remindAt" class="pill" :class="{ danger: !!overdueText(n) }">{{ n.remindAt.slice(5, 16) }}{{ overdueText(n) ? ' · ' + overdueText(n) : '' }}</span>
            <span v-else class="pill dev">未设提醒</span>
          </div>
        </div>
        <button class="btn sm danger" @click="del(n)">删</button>
      </div>
    </template>
  </div>

  <button class="fab" @click="openNew()">新建<br />记事</button>

  <div v-if="editing" class="mask" @click.self="editing = null">
    <div class="sheet">
      <div class="title">{{ isNew ? '新建记事' : '编辑记事' }}</div>
      <div class="hairline"></div>
      <div class="field"><label>标题（必填）</label><input v-model="editing.title" maxlength="30" placeholder="如：高数作业" /></div>
      <div class="field"><label>内容（选填）</label><textarea v-model="editing.content" rows="3" maxlength="500"></textarea></div>
      <div class="field"><label>提醒时间</label><input :value="toInput(editing.remindAt)" type="datetime-local" @input="editing.remindAt = fromInput(($event.target as HTMLInputElement).value)" /></div>
      <div class="field"><label>提前提醒（可多选）</label>
        <div class="chips"><button v-for="a in ALARMS" :key="a.v" class="chip" :class="{ on: editing.alarms.includes(a.v) }" @click="toggleAlarm(a.v)">{{ a.t }}</button></div>
      </div>
      <div class="field"><label>重复</label>
        <div class="chips">
          <button v-for="r in ([['none', '不重复'], ['daily', '每天'], ['weekly', '每周'], ['monthly', '每月']] as const)" :key="r[0]"
            class="chip" :class="{ on: editing.repeat === r[0] }" @click="editing.repeat = r[0] as any">{{ r[1] }}</button>
        </div>
      </div>
      <div class="row">
        <button class="btn grow" @click="save">保存</button>
        <button class="btn ghost grow" @click="editing = null">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modes { display: flex; gap: 8px; margin-bottom: 10px; }
.modes button { flex: 1; padding: 8px; border-radius: 9px; background: #fff; color: var(--muted); font-size: 13px; font-weight: 600; box-shadow: var(--shadow); }
.modes button.on { background: var(--brand); color: #fff; }
.mhead { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.mnav { width: 34px; height: 34px; border-radius: 10px; background: #fff; color: var(--brand); font-size: 20px; box-shadow: var(--shadow); flex: none; }
.cal.slide-l { animation: cal-slide-l .28s cubic-bezier(.22,.61,.36,1); }
.cal.slide-r { animation: cal-slide-r .28s cubic-bezier(.22,.61,.36,1); }
@keyframes cal-slide-l { from { opacity: .25; transform: translateX(26%); } to { opacity: 1; transform: translateX(0); } }
@keyframes cal-slide-r { from { opacity: .25; transform: translateX(-26%); } to { opacity: 1; transform: translateX(0); } }
.cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; padding: 8px 6px; }
.wd { text-align: center; font-size: 11px; color: var(--muted); padding-bottom: 4px; }
.dc { aspect-ratio: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; border-radius: 10px; gap: 2px; }
.dc.sel { background: #EDF3FF; outline: 1.5px solid var(--brand); }
.dc.dim .num { opacity: .32; }
.num { width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; }
.num.today { background: var(--brand); color: #fff; font-weight: 700; }
.dots i { display: block; width: 5px; height: 5px; border-radius: 50%; background: var(--brand-2); }
.dots i.done { background: #B9C1CC; }
.dayhead { display: flex; align-items: center; justify-content: space-between; margin: 14px 2px 8px; gap: 8px; }
.item { display: flex; gap: 10px; align-items: flex-start; }
.item.done { opacity: .55; }
.item.done .bold { text-decoration: line-through; }
.cb { width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--line); background: #fff; flex: none; margin-top: 2px; color: #fff; font-size: 14px; }
.cb.on { background: var(--ok); border-color: var(--ok); }
.search { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: #fff; margin-bottom: 10px; }
.field { margin-bottom: 12px; }
.field label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 6px; }
.field input, .field textarea { width: 100%; padding: 11px 12px; border: 1px solid var(--line); border-radius: 10px; background: #FBFCFE; }
</style>