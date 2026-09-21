<script setup lang="ts">
// 只读分享页（PRD 5.12）。
// 打开形如 `https://<站点>/#s=<payload>` 的链接时，App 不进入登录/主界面，
// 直接渲染这张"别人分享给你的课表"。
// 说明写在页面上：数据就在链接里、没有上传服务器、这是只读页。
import { computed } from 'vue';
import type { SharedTimetable } from '../services/share.ts';
import { weeksText } from '../services/share.ts';

const props = defineProps<{ data: SharedTimetable }>();

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
/** 按星期分组；同一天按开始节次排序 */
const byDay = computed(() => DAYS.map((label, i) => ({
  label, day: i + 1,
  list: props.data.courses.filter((c) => c.day === i + 1)
    .sort((a, b) => a.startPeriod - b.startPeriod || a.name.localeCompare(b.name, 'zh'))
})));
const total = computed(() => props.data.courses.length);
/** 课程名去重（和课表页口径一致：同一门课的多个时段算一门） */
const distinct = computed(() => new Set(props.data.courses.map((c) => c.name)).size);
function periodText(sp: number, ep: number): string { return '第 ' + sp + (ep > sp ? '-' + ep : '') + ' 节'; }
</script>

<template>
  <div class="screen">
    <div class="head">
      <div class="bar">
        <div>
          <div class="title">{{ data.name || '分享的课表' }}</div>
          <div class="small muted">Unimate · 只读分享 · {{ distinct }} 门课 / {{ total }} 个时段</div>
        </div>
        <span class="pill brand">只读</span>
      </div>
    </div>

    <div class="scroll">
      <div class="card note">
        <div class="small bold">这张课表是同学分享给你的</div>
        <div class="small muted" style="margin-top: 6px; line-height: 1.7">
          数据就在这条链接里，<b>没有上传到任何服务器</b>（链接 # 后面的内容浏览器不会发给服务器），本页只读。
          学期第一周周一：{{ data.semesterStart || '—' }} · 共 {{ data.totalWeeks }} 周。
        </div>
      </div>

      <div v-for="d in byDay" :key="d.day" class="sec">
        <div class="sechead"><span class="grow small bold">{{ d.label }}</span><span class="small muted">{{ d.list.length }} 节</span></div>
        <div v-if="!d.list.length" class="small muted" style="padding: 6px 2px">没课</div>
        <div v-for="(c, i) in d.list" :key="d.day + '-' + i" class="card row-card">
          <div class="grow">
            <div class="bold">{{ c.name }}</div>
            <div class="small muted">{{ periodText(c.startPeriod, c.endPeriod) }}{{ c.room ? ' · ' + c.room : '' }} · {{ weeksText(c.weeks) }}</div>
          </div>
        </div>
      </div>

      <div class="card cta">
        <div class="small bold">也想把自己的课表管起来？</div>
        <div class="small muted" style="margin-top: 6px; line-height: 1.7">
          Unimate 是本校学生做的校园助手：课表 / 待办提醒 / 活动材料 / 校园服务，数据全部存在你自己的手机里。
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.note { background: var(--soft); box-shadow: none; }
.sec { margin: 14px 0 4px; }
.sechead { display: flex; align-items: center; gap: 8px; padding: 6px 2px; border-bottom: 1px solid var(--line); }
.row-card { margin-top: 8px; padding: 12px 14px; }
.cta { background: var(--soft); box-shadow: none; margin-top: 16px; }
</style>
