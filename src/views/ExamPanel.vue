<script setup lang="ts">
// 考试查询面板（PRD 5.11）。
// 两条路径落到同一段逻辑：教务系统真实抓取 / 内置演示样本（离线可用）。
// 不管哪条路径，都是 parseJwglxtExams → examNoteDraft → 写进课表的记事本，
// 提醒固定为「提前 1 天 + 提前 30 分钟」。
import { ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { JwWebView, isNativeWebView } from '../services/jwwebview.ts';
import { parseJwglxtExams, examNoteDraft } from '../services/parser/jwglxtExam.ts';
import { buildExamSampleHtml } from '../services/examDemo.ts';

const props = defineProps<{ startUrl: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();
const db = useDb();

const step = ref<'intro' | 'working' | 'error'>('intro');
const errMsg = ref('');
const summary = ref<{ total: number; added: number; dup: number; past: number; items: { title: string; when: string }[]; demo: boolean } | null>(null);

/** 真实抓取：打开教务系统考试页 → 学生自己点「查询」→ 点常驻的「识别考试」→ 回传表格 HTML */
async function openJwglxt(): Promise<void> {
  if (!isNativeWebView()) {
    errMsg.value = '当前是桌面预览环境，打不开内嵌教务系统。请点下面的「用内置演示样本」走一遍完整流程（识别 → 写进记事本 → 提醒）。';
    step.value = 'error';
    return;
  }
  step.value = 'working';
  const r = await JwWebView.open({
    url: db.profile?.systems.jwglxtUrl || props.startUrl,
    startUrl: props.startUrl,
    title: '考试查询',
    allowExternal: true,
    mode: 'exam',
    scrapeSelector: '#gbox_tabGrid,#tabGrid,table.ui-jqgrid-btable,body'
  });
  if (!r.ok) {
    const reason = r.reason || '';
    errMsg.value = reason === 'cancelled' ? '已取消：这次没有识别考试。'
      : reason === 'no-table' ? '当前页面里没有考试表格。请先在教务系统里进入「考试信息查询」，选学期并点「查询」，出现考试列表后再点「识别考试」。'
      : '未能识别考试：' + reason;
    step.value = 'error';
    return;
  }
  await importHtml(r.html || '', false);
}

/** 演示路径：用内置样本走完全一样的解析与写入逻辑（离线可用） */
async function useSample(): Promise<void> {
  step.value = 'working';
  await importHtml(buildExamSampleHtml(), true);
}

async function importHtml(html: string, demo: boolean): Promise<void> {
  const parsed = parseJwglxtExams(html);
  if (!parsed.exams.length) {
    errMsg.value = parsed.diagnostics[0]?.message || '没有解析到考试安排。';
    step.value = 'error';
    return;
  }
  let added = 0; let dup = 0; let past = 0;
  const items: { title: string; when: string }[] = [];
  const now = new Date();
  for (const ex of parsed.exams) {
    const d = examNoteDraft(ex, now);
    if (d.past) past++;
    // 同一条考试（标题 + 提醒时刻一致）不重复写入：反复识别、两条路径各来一次都不会堆重复
    if (db.notes.some((n) => !n.deletedAt && n.title === d.title && n.remindAt === d.remindAt)) { dup++; continue; }
    db.addNote({ title: d.title, content: d.content, remindAt: d.remindAt, alarms: d.alarms, repeat: 'none', colorIndex: 0 });
    added++;
    items.push({ title: d.title, when: d.remindAt.slice(5, 16) });
  }
  await db.saveData();
  summary.value = { total: parsed.exams.length, added, dup, past, items: items.slice(0, 5), demo };
  step.value = 'intro';
  db.notify(added
    ? '已写入记事本 ' + added + ' 条考试（提前 1 天 + 提前 30 分钟提醒）'
    : '这 ' + parsed.exams.length + ' 场考试都已经在记事本里了');
}
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="sheet">
      <div class="row"><div class="title grow">考试查询</div><button class="btn sm ghost" @click="emit('close')">关闭</button></div>
      <div class="hairline"></div>

      <template v-if="step === 'intro'">
        <div class="li col" style="align-items: flex-start">
          <div class="bold">1. 打开教务系统并进入考试信息查询</div>
          <div class="small muted">App 内直接打开教务系统，自行登录后进入「考试信息查询」，选好学期点「查询」，出现考试列表。</div>
        </div>
        <div class="li col" style="align-items: flex-start">
          <div class="bold">2. 点右下角常驻的「识别考试」</div>
          <div class="small muted">只读取页面上的考试表格，不读取、不保存账号密码，也不会代填表单。</div>
        </div>
        <div class="li col" style="align-items: flex-start">
          <div class="bold">3. 自动写进记事本并设定提醒</div>
          <div class="small muted">每条考试写入「课表 → 记事本」，并带两个提醒：<b>提前 1 天</b> + <b>提前 30 分钟</b>。已识别过的不会重复写入。</div>
        </div>
        <button class="btn block" style="margin-top: 14px" @click="openJwglxt">🏛 打开教务系统（识别考试）</button>
        <button class="btn block grey" style="margin-top: 10px" @click="useSample">用内置演示样本走一遍（离线可用）</button>
        <div class="small muted" style="margin-top: 10px">演示样本是虚构数据，考试日期会跟着今天走（今天 +2 / +9 / +16 / +23 天），所以「提前 1 天 / 半小时」的提醒能真的触发。样本结构与真实教务页面一致，走的是同一个解析器。</div>

        <div v-if="summary" class="card res">
          <div class="row" style="justify-content: space-between">
            <b class="small">{{ summary.demo ? '演示样本' : '教务系统' }}：识别到 {{ summary.total }} 场考试</b>
            <span class="pill live">已写入 {{ summary.added }} 条</span>
          </div>
          <div class="small muted" style="margin-top: 4px">
            新增 {{ summary.added }} 条<template v-if="summary.dup">，已存在 {{ summary.dup }} 条（跳过）</template><template v-if="summary.past">；其中 {{ summary.past }} 场时间已过，不会提醒</template>
          </div>
          <div v-for="it in summary.items" :key="it.title + it.when" class="small" style="margin-top: 4px">{{ it.when }} · {{ it.title }}</div>
          <div class="small muted" style="margin-top: 6px">在「课表 → 记事本」里可以看到，提醒为提前 1 天与提前 30 分钟。</div>
        </div>
      </template>

      <div v-else-if="step === 'working'" class="empty"><div class="big">⏳</div>正在识别考试…</div>

      <div v-else>
        <div class="pill danger">没有识别到考试</div>
        <p class="small">{{ errMsg }}</p>
        <div class="row">
          <button class="btn grow" @click="step = 'intro'">返回重试</button>
          <button class="btn grey grow" @click="useSample">改用演示样本</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.res { background: var(--soft); box-shadow: none; margin-top: 12px; }
</style>
