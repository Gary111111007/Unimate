<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useDb } from '../stores/db.ts';
import TimetableView from '../views/TimetableView.vue';
import NotesView from '../views/NotesView.vue';
import SecondClassView from '../views/SecondClassView.vue';
import OnlineView from '../views/OnlineView.vue';
import MeView from '../views/MeView.vue';
import UniView from '../views/UniView.vue';
import AppleIcon from '../components/AppleIcon.vue';

const db = useDb();
/**
 * 第 2、4 项显示名都由高校档案决定：
 *  - 第 2 项：有二课的学校显示 "第二课堂"；没有二课的学校（如北二外）显示 "活动材料"
 *    （该档案 secondClass.enabled = false，只保留志愿时长 / 劳育时长两块台账）。
 *  - 第 4 项：北化 = "北化通"，北二外 = "校园服务"。
 */
const TABS = computed(() => [
  { label: '课表', icon: 'calendar' },
  { label: db.profile?.secondClass.label || '第二课堂', icon: db.profile?.secondClass.enabled ? 'award' : 'bookmark' },
  { label: 'Uni', icon: 'star' },
  { label: db.profile?.tabs.online || '校园在线', icon: 'book' },
  { label: '我的', icon: 'user' }
]);
const titles = computed(() => {
  if (db.activeTab === 0) return (db.profile?.shortName || '') + ' · 课表';
  if (db.activeTab === 1) return db.profile?.secondClass.label || '第二课堂';
  if (db.activeTab === 2) return 'Uni';
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
onUnmounted(() => {
  delete (window as any).__unimateBack;
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

    <nav class="tabbar" aria-label="主导航">
      <button v-for="(t, i) in TABS" :key="t.label" type="button" class="tab" :class="{ on: db.activeTab === i }" :aria-current="db.activeTab === i ? 'page' : undefined" @click="db.activeTab = i">
        <AppleIcon class="ic" :name="t.icon" :size="22" />
        <span class="lb">{{ t.label }}</span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
.sheetbar { display: flex; gap: 2px; margin-top: 8px; padding: 2px; border-radius: 9px; background: var(--soft-2); }
.sheetbar button { flex: 1; min-height: 30px; padding: 4px 6px; border-radius: 7px; color: var(--muted); font-size: 13px; font-weight: 500; }
.sheetbar button.on { background: var(--card); color: var(--text); box-shadow: 0 1px 3px rgba(0, 0, 0, .14); }
.tabbar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 50; display: flex; align-items: stretch;
  padding: 5px 4px calc(5px + var(--safe-b)); background: color-mix(in srgb, var(--card) 88%, transparent);
  border-top: .5px solid var(--line); backdrop-filter: saturate(180%) blur(20px);
}
.tab {
  flex: 1 1 0; min-width: 0; min-height: 49px; padding: 4px 2px 3px; border-radius: 10px;
  font-size: 10px; line-height: 13px; font-weight: 500; color: var(--muted); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  transition: color .18s ease, transform .1s ease, opacity .18s ease;
}
.tab.on { color: var(--brand); font-weight: 600; }
.tab:active { transform: scale(.96); opacity: .72; }
.ic { transition: transform .18s ease; }
.tab.on .ic { transform: translateY(-1px); }
.lb { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (prefers-reduced-motion: reduce) {
  .tab, .ic, .lb { transition: none; }
  .tab:active, .tab.on .ic { transform: none; }
}
</style>
