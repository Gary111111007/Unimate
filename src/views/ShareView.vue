<script setup lang="ts">
// 只读分享页：按正常课表呈现（节次行 × 星期列 + 色块），可滑动/点按切周次，今天高亮。
// 数据全在链接 # 片段里，不上传服务器。
import { computed, ref } from 'vue';
import type { SharedTimetable } from '../services/share.ts';
import { COURSE_COLORS, assignCourseColors, courseColorIndex } from '../catalog/periods.ts';

const props = defineProps<{ data: SharedTimetable }>();
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const ROW_H = 54;

function parseDay(s: string): Date { return new Date((s || '2026-09-01').replace(/-/g, '/') + ' 00:00:00'); }
function dateOf(di: number, w: number): string {
  const d = parseDay(props.data.semesterStart);
  d.setDate(d.getDate() + (w - 1) * 7 + di);
  return (d.getMonth() + 1) + '/' + d.getDate();
}
const totalWeeks = computed(() => Math.max(1, props.data.totalWeeks || 18));
const nowWeek = computed(() => {
  const diff = Math.floor((Date.now() - parseDay(props.data.semesterStart).getTime()) / 86400000 / 7) + 1;
  return Math.min(Math.max(diff, 1), totalWeeks.value);
});
const week = ref(nowWeek.value);
const todayIdx = computed(() => (new Date().getDay() + 6) % 7);
function isToday(di: number): boolean { return di === todayIdx.value && week.value === nowWeek.value; }

const colorAlloc = computed(() => assignCourseColors(props.data.courses.map((c) => c.name)));
function colorOf(name: string): string {
  const i = colorAlloc.value[name.replace(/\s+/g, '')];
  return COURSE_COLORS[i === undefined ? courseColorIndex(name) : i];
}
/** 每天内按时段分泳道：同时段的课并排显示，不会被压成一个 */
const placed = computed(() => DAYS.map((_, di) => {
  const list = props.data.courses
    .filter((c) => c.day === di + 1 && c.weeks.indexOf(week.value) >= 0)
    .sort((a, b) => a.startPeriod - b.startPeriod || a.name.localeCompare(b.name, 'zh'));
  const laneEnd: number[] = [];
  const withLane = list.map((c) => {
    let lane = laneEnd.findIndex((end) => end < c.startPeriod);
    if (lane < 0) { lane = laneEnd.length; laneEnd.push(c.endPeriod); } else { laneEnd[lane] = c.endPeriod; }
    return { c, lane };
  });
  const lanes = Math.max(1, laneEnd.length);
  return withLane.map((x) => ({ ...x, lanes }));
}));
const count = computed(() => placed.value.reduce((a, d) => a + d.length, 0));
function shift(d: number): void { week.value = Math.min(Math.max(week.value + d, 1), totalWeeks.value); }
let sx = 0; let sy = 0;
function onStart(e: TouchEvent): void { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }
function onEnd(e: TouchEvent): void {
  const dx = e.changedTouches[0].clientX - sx;
  const dy = e.changedTouches[0].clientY - sy;
  if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.4) shift(dx < 0 ? 1 : -1);
}
</script>

<template>
  <div class="screen">
    <div class="head">
      <div class="bar">
        <div class="grow">
          <div class="title">{{ data.name || '分享的课表' }}</div>
          <div class="small muted">Unimate · 只读分享 · 共 {{ totalWeeks }} 周</div>
        </div>
        <span class="pill brand">只读</span>
      </div>
      <div class="weeknav">
        <button class="nav" @click="shift(-1)" :disabled="week <= 1">‹</button>
        <div class="cur"><b>第 {{ week }} 周</b><span class="small muted"> · 本周 {{ count }} 节</span></div>
        <button class="nav" @click="shift(1)" :disabled="week >= totalWeeks">›</button>
        <button v-if="week !== nowWeek" class="btn sm ghost" @click="week = nowWeek">回本周</button>
      </div>
    </div>

    <div class="scroll" @touchstart="onStart" @touchend="onEnd">
      <div class="grid" :style="{ gridTemplateColumns: '42px repeat(7, 1fr)' }">
        <div class="corner">节</div>
        <div v-for="(d, di) in DAYS" :key="d" class="dayhead" :class="{ today: isToday(di) }">
          <div class="dw">{{ d }}</div><div class="dd">{{ dateOf(di, week) }}</div>
        </div>
        <div class="timecol"><div v-for="p in 12" :key="p" class="timelab" :style="{ height: ROW_H + 'px' }">{{ p }}</div></div>
        <div v-for="(day, di) in placed" :key="di" class="daycol" :class="{ today: isToday(di) }">
          <div v-for="p in 12" :key="p" class="cell" :style="{ height: ROW_H + 'px' }"></div>
          <div v-for="x in day" :key="x.c.name + x.c.startPeriod + x.lane" class="blk"
            :style="{
              top: (x.c.startPeriod - 1) * ROW_H + 2 + 'px',
              height: (x.c.endPeriod - x.c.startPeriod + 1) * ROW_H - 4 + 'px',
              left: 'calc(' + (x.lane * 100 / x.lanes) + '% + 1px)',
              width: 'calc(' + (100 / x.lanes) + '% - 2px)',
              background: colorOf(x.c.name)
            }">
            <div class="bn">{{ x.c.name }}</div>
            <div class="bm">{{ x.c.room }}</div>
          </div>
        </div>
      </div>
      <div class="small muted center hint">左右滑动切换周次 · 只读页，数据在链接里、没有上传服务器</div>
      <div class="card cta small"><b>Unimate</b><span class="muted"> · 课表 / 待办提醒 / 活动材料 / 校园服务，数据都存在自己手机里</span></div>
    </div>
  </div>
</template>

<style scoped>
.head { padding: calc(12px + var(--safe-t)) 14px 8px; background: var(--card); border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 30; }
.bar { display: flex; align-items: center; gap: 8px; }
.title { font-size: 17px; font-weight: 700; }
.weeknav { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.nav { width: 34px; height: 34px; border-radius: 10px; background: var(--soft-2); color: var(--brand); font-size: 20px; line-height: 1; flex: none; }
.nav:disabled { opacity: .35; }
.cur { flex: 1; text-align: center; }
.scroll { flex: 1; overflow-y: auto; padding: 10px 10px calc(24px + var(--safe-b)); }
.grid { display: grid; background: var(--card); border-radius: 12px; overflow: hidden; box-shadow: var(--shadow); }
.corner { font-size: 10px; color: var(--muted); text-align: center; padding: 6px 0; border-bottom: 1px solid var(--line); background: var(--soft); }
.dayhead { font-size: 11px; color: var(--muted); text-align: center; padding: 4px 0 5px; border-bottom: 1px solid var(--line); background: var(--soft); line-height: 1.2; }
.dayhead.today { color: var(--brand); background: var(--tint); font-weight: 700; }
.dd { font-size: 9.5px; opacity: .8; font-variant-numeric: tabular-nums; }
.timecol { border-right: 1px solid var(--line); }
.timelab { display: flex; align-items: flex-start; justify-content: center; padding-top: 4px; font-size: 10.5px; font-weight: 600; color: var(--muted); border-bottom: 1px dashed var(--line); }
.daycol { position: relative; border-right: 1px solid var(--line); }
.daycol.today { background: #F6F9FF; }
.cell { border-bottom: 1px dashed var(--line); }
.blk { position: absolute; border-radius: 7px; color: #fff; padding: 3px 4px; overflow: hidden; line-height: 1.25; }
.bn { font-size: 10.5px; font-weight: 700; word-break: break-all; }
.bm { font-size: 9.5px; opacity: .85; word-break: break-all; }
.hint { margin: 10px 0; }
.cta { background: var(--soft); box-shadow: none; padding: 12px 14px; }
</style>
