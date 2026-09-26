<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useDb } from '../stores/db.ts';
import TimetableView from '../views/TimetableView.vue';
import NotesView from '../views/NotesView.vue';
import SecondClassView from '../views/SecondClassView.vue';
import OnlineView from '../views/OnlineView.vue';
import MeView from '../views/MeView.vue';
import UniView from '../views/UniView.vue';

const db = useDb();
/**
 * 第 2、4 项显示名都由高校档案决定：
 *  - 第 2 项：有二课的学校显示 "第二课堂"；没有二课的学校（如北二外）显示 "活动材料"
 *    （该档案 secondClass.enabled = false，只保留志愿时长 / 劳育时长两块台账）。
 *  - 第 4 项：北化 = "北化通"，北二外 = "校园服务"。
 */
const TABS = computed(() => [
  { label: '课表', icon: '🗓' },
  { label: db.profile?.secondClass.label || '第二课堂', icon: db.profile?.secondClass.enabled ? '🏅' : '📌' },
  { label: 'Uni', icon: '✦' },
  { label: db.profile?.tabs.online || '校园在线', icon: '📚' },
  { label: '我的', icon: '👤' }
]);
const titles = computed(() => {
  if (db.activeTab === 0) return (db.profile?.shortName || '') + ' · 课表';
  if (db.activeTab === 1) return db.profile?.secondClass.label || '第二课堂';
  if (db.activeTab === 2) return 'Uni · 本机助手';
  if (db.activeTab === 3) return db.profile?.tabs.online || '校园在线';
  return '我的';
});
const subline = computed(() => {
  const d = new Date();
  const w = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + w + ' · 第 ' + db.currentWeek + ' 周 · ' + (db.session?.displayName || '');
});

function sheetName(key: 'sheet1' | 'sheet2'): string { return key === 'sheet1' ? '课表' : '记事本'; }

onMounted(() => {
  (window as any).__unimateBack = () => {
    if (db.activeTab !== 0) db.activeTab = 0;
  };
});
</script>

<template>
  <div class="screen">
    <div class="head">
      <div class="bar">
        <div>
          <div class="title">{{ titles }}</div>
          <div class="small muted">{{ subline }}</div>
        </div>
        <span v-if="db.session?.isDemo" class="pill warn">演示模式</span>
      </div>
      <div v-if="db.activeTab === 0" class="sheetbar">
        <button v-for="k in (['sheet1', 'sheet2'] as const)" :key="k" :class="{ on: db.activeSheet === k }" @click="db.activeSheet = k">{{ sheetName(k) }}</button>
      </div>
    </div>

    <TimetableView v-if="db.activeTab === 0 && db.activeSheet === 'sheet1'" />
    <NotesView v-else-if="db.activeTab === 0 && db.activeSheet === 'sheet2'" />
    <SecondClassView v-else-if="db.activeTab === 1" />
    <UniView v-else-if="db.activeTab === 2" />
    <OnlineView v-else-if="db.activeTab === 3" />
    <MeView v-else />

    <nav class="tabbar">
      <button v-for="(t, i) in TABS" :key="t.label" class="tab" :class="{ on: db.activeTab === i }" @click="db.activeTab = i">
        <span class="ic">{{ t.icon }}</span>
        <span class="lb">{{ t.label }}</span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
.sheetbar { display: flex; gap: 8px; margin-top: 7px; }
.sheetbar button { flex: 1; padding: 6px; border-radius: 8px; background: var(--soft-2); color: var(--muted); font-size: 13px; font-weight: 600; }
.sheetbar button.on { background: var(--brand); color: #fff; }
/* 固定底栏：任何页面、任何滚动位置都常驻可见 */
.tabbar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 50; display: flex; background: var(--card); border-top: 1px solid var(--line); padding-bottom: var(--safe-b); box-shadow: 0 -2px 10px rgba(20, 30, 60, .06); }
.tab { flex: 1; padding: 7px 0 8px; font-size: 11px; color: var(--muted); display: flex; flex-direction: column; align-items: center; gap: 2px; }
.tab.on { color: var(--brand); font-weight: 700; }
.ic { font-size: 20px; line-height: 1.1; }
.lb { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
