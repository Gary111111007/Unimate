<script setup lang="ts">
// 课表设置（PRD 5.10 / 附录 C）。按需求第 9 条，入口放在"课表"页里。
import { ref } from 'vue';
import { useDb } from '../stores/db.ts';

const db = useDb();
const saved = ref(false);

async function save(): Promise<void> {
  const tt = db.activeTimetable;
  if (tt) {
    tt.semesterStartMonday = db.settings.semesterStartMonday;
    tt.totalWeeks = db.settings.totalWeeks;
    tt.periodCount = db.settings.periodTimes.length;
  }
  await db.saveData();
  saved.value = true;
  db.notify('课表设置已保存');
}
function useDefaultTimes(): void {
  import('../catalog/periods.ts').then((m) => {
    db.settings.periodTimes = m.DEFAULT_PERIOD_TIMES.map((x) => ({ ...x }));
    db.notify('已恢复默认节次时间');
  });
}
</script>

<template>
  <div>
    <div class="field"><label>学期第一周周一</label><input v-model="db.settings.semesterStartMonday" type="date" /></div>
    <div class="field"><label>学期总周数</label><input v-model.number="db.settings.totalWeeks" type="number" min="1" max="30" /></div>
    <div class="li" style="padding: 10px 0">
      <span class="grow small">显示周末</span>
      <button class="chip sm" :class="{ on: db.settings.showWeekend }" @click="db.settings.showWeekend = !db.settings.showWeekend">{{ db.settings.showWeekend ? '显示' : '隐藏' }}</button>
    </div>
    <div class="row" style="justify-content: space-between; margin: 10px 0 6px">
      <span class="small bold">节次时间（{{ db.profile?.shortName }}默认值）</span>
      <button class="btn sm ghost" @click="useDefaultTimes">恢复默认</button>
    </div>
    <div class="periods">
      <div v-for="pt in db.settings.periodTimes" :key="pt.period" class="prow">
        <span class="pn">{{ pt.period }}</span>
        <input v-model="pt.start" type="time" step="300" /><span class="dash">—</span><input v-model="pt.end" type="time" step="300" />
      </div>
    </div>
    <div class="small muted" style="margin: 8px 0">修改节次时间会同步影响课表显示与上课提醒的触发时刻。</div>
    <button class="btn block" @click="save">保存课表设置</button>
  </div>
</template>

<style scoped>
.field { margin-bottom: 12px; }
.field label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 6px; }
.field input { width: 100%; padding: 11px 12px; border: 1px solid var(--line); border-radius: 10px; background: #FBFCFE; }
.li { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
.grow { flex: 1; }
.periods { max-height: 250px; overflow: auto; }
.prow { display: grid; grid-template-columns: 26px 1fr 14px 1fr; gap: 6px; align-items: center; margin-bottom: 6px; }
.pn { font-size: 13px; color: var(--muted); text-align: center; }
.dash { text-align: center; color: var(--muted); }
.prow input { padding: 7px; border: 1px solid var(--line); border-radius: 8px; width: 100%; }
</style>
