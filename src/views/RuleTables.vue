<script setup lang="ts">
// 手册分值表实时查询（需求第 6 条）：填报时随手可查，不自动算分。
import { ref } from 'vue';
import { BLOCK_CAPS, RULE_ITEMS, TABLES } from '../catalog/ruleTables.ts';

const emit = defineEmits<{ (e: 'close'): void }>();
const tab = ref<'caps' | 'zhi' | 'ti' | 'mei' | 'rules'>('caps');
const q = ref('');
const TABS = [
  { k: 'caps', t: '板块上限' },
  { k: 'zhi', t: '学科竞赛' },
  { k: 'ti', t: '体育竞赛' },
  { k: 'mei', t: '美育比赛' },
  { k: 'rules', t: '计分条款' }
] as const;
const table = () => TABLES.find((x) => x.id === tab.value);
const rules = () => RULE_ITEMS.filter((r) => !q.value.trim() || r.text.includes(q.value.trim()) || r.block === q.value.trim());
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="sheet">
      <div class="row"><div class="title grow">第二课堂 · 手册分值表</div><button class="btn sm ghost" @click="emit('close')">关闭</button></div>
      <div class="small muted">来源：《北京化工大学本科生学生手册 · 学生事务管理制度》第二至六章。仅供参考，最终认定以学校审核为准。</div>
      <div class="chips" style="margin: 10px 0">
        <button v-for="t in TABS" :key="t.k" class="chip sm" :class="{ on: tab === t.k }" @click="tab = t.k">{{ t.t }}</button>
      </div>

      <div v-if="tab === 'caps'" class="tbl caps">
        <div class="tr th"><span>板块</span><span>评定名称</span><span>满分</span><span>基础上限</span><span>拓展上限</span></div>
        <div v-for="b in BLOCK_CAPS" :key="b.name" class="tr">
          <span class="bk">{{ b.name }}</span><span class="small">{{ b.full }}</span><span>{{ b.total }}</span><span>{{ b.basic }}</span><span>{{ b.extended }}</span>
        </div>
        <div class="note">五板块合计满分 {{ BLOCK_CAPS.reduce((a, b) => a + b.total, 0) }} 分；高于满分时按满分计算。</div>
      </div>

      <div v-else-if="table()" class="tbl">
        <div class="tname">{{ table()!.title }}</div>
        <div class="tr th"><span>获奖情况</span><span v-for="c in table()!.cols" :key="c">{{ c }}</span></div>
        <div v-for="r in table()!.rows" :key="r.prize" class="tr">
          <span class="small">{{ r.prize }}</span><span v-for="(s, i) in r.scores" :key="i">{{ s }}</span>
        </div>
        <div class="note">{{ table()!.note }}</div>
        <div class="scrollhint">表格较宽时可左右滑动查看全部列</div>
      </div>

      <div v-else>
        <input v-model="q" class="search" placeholder="搜索关键词，如 志愿 / 打卡 / 宿舍" />
        <div v-for="(r, i) in rules()" :key="i" class="rule">
          <span class="rb">{{ r.block }}</span><span>{{ r.text }}</span>
        </div>
        <div v-if="!rules().length" class="empty small">没有匹配条款</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tbl { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.tr { display: flex; align-items: center; gap: 6px; min-width: 400px; padding: 7px 0; border-bottom: 1px dashed var(--line); font-size: 13px; }
/* 首列固定宽度、可换行；数值列等分且不换行。之前用 grid-auto-columns 时首列的 min-width 撑不开轨道，只会溢出压到隔壁数字上 */
.tr > span:first-child { flex: 0 0 96px; line-height: 1.3; white-space: normal; }
.tr > span:not(:first-child) { flex: 1 1 0; min-width: 40px; text-align: center; white-space: nowrap; }
.tr.th { font-size: 11px; color: var(--muted); border-bottom: 1px solid var(--line); }
/* 板块上限表：名称列（如"道德与思想素质评定"9 个字）以前和数字列等分，
   85px 装不下又 nowrap，直接溢出压到"满分"数字上（真机截图反馈的排版问题）。
   这里让名称列吃掉剩余宽度并允许换行，数字列固定窄宽。 */
.caps .tr { min-width: 0; }
.caps .tr > span:first-child { flex: 0 0 34px; }
.caps .tr > span:nth-child(2) { flex: 1 1 auto; min-width: 0; text-align: left; white-space: normal; line-height: 1.35; }
.caps .tr > span:nth-child(n+3) { flex: 0 0 56px; text-align: center; white-space: normal; line-height: 1.3; }
.caps .tr.th > span:nth-child(n+3) { font-size: 10.5px; }


.bk { font-weight: 700; color: var(--brand); }
.tname { font-size: 13px; font-weight: 700; margin-bottom: 6px; }
.scrollhint { font-size: 10.5px; color: var(--muted); margin-top: 4px; }
.note { margin-top: 8px; font-size: 11px; color: var(--muted); line-height: 1.6; }
.rule { display: flex; gap: 8px; padding: 8px 0; border-bottom: 1px dashed var(--line); font-size: 13px; line-height: 1.5; }
.rb { flex: none; width: 22px; height: 22px; border-radius: 7px; background: var(--brand); color: #fff; font-size: 12px; display: flex; align-items: center; justify-content: center; }
.search { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--field); margin-bottom: 6px; }
</style>
