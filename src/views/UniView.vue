<script setup lang="ts">
import { ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { guard } from '../services/guard.ts';
import { actionTimeToNoteStamp, askUniLocal, type UniLocalAnswer } from '../services/uniAssistant.ts';
import type { ActionCard } from '../../p5-assistant/n8n/core/types.ts';

const db = useDb();
const text = ref('');
const lastQuestion = ref('');
const answer = ref<UniLocalAnswer | null>(null);
const asking = ref(false);

const examples = [
  '下一节什么课',
  '给我明天的安排',
  '这周有几节课',
  '周三下午有空吗',
  '我还有什么待办',
  '今晚 8 点交高数作业'
];

function snapshot() {
  return {
    activeTimetable: db.activeTimetable,
    courses: db.courses,
    notes: db.notes,
    periodTimes: db.settings.periodTimes,
    scheduleTimezone: 'Asia/Shanghai'
  };
}

function ask(question?: string): void {
  const q = String(question ?? text.value).trim();
  if (!q || asking.value) return;
  asking.value = true;
  try {
    lastQuestion.value = q;
    answer.value = askUniLocal(snapshot(), q);
    text.value = '';
  } catch (e) {
    db.lastError = 'Uni 本机回答失败：' + (e instanceof Error ? e.message : String(e));
    db.notify('Uni 暂时没答出来，请换个说法');
  } finally {
    asking.value = false;
  }
}

function cardTime(card: ActionCard): string {
  if (!card.time) return '';
  const d = new Date(card.time);
  if (!Number.isFinite(d.getTime())) return card.time;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(d);
}

async function runCard(card: ActionCard): Promise<void> {
  if (card.operation === 'open.schedule') {
    db.activeSheet = 'sheet1';
    db.activeTab = 0;
    return;
  }
  if (card.operation !== 'note.create' || !card.noteDraft || !answer.value) return;
  const remindAt = actionTimeToNoteStamp(card, answer.value.timezone);
  const ok = await db.confirm({
    title: '确认添加这条记事？',
    body: card.noteDraft.title,
    detail: remindAt ? `提醒时间 ${remindAt.slice(5, 16)}。确认后新增 1 条记事，可在记事本继续编辑或删除。` : '确认后新增 1 条无提醒时间的记事，可在记事本继续编辑或删除。',
    confirmText: '确认添加', cancelText: '先不添加', danger: false
  });
  if (!ok) return;
  db.addNote({ title: card.noteDraft.title, remindAt, content: '由 Uni 本机助手生成' });
  const saved = await guard('Uni 保存记事', db.saveData().then(() => true), 8000, false);
  if (!saved) { db.notify('记事已加入内存，但落盘超时，请稍后再试'); return; }
  db.notify('已添加到记事本');
}
</script>

<template>
  <div class="scroll uni-page">
    <section class="card uni-intro">
      <div class="uni-mark">U</div>
      <div class="grow">
        <div class="bold">Uni 本机助手</div>
        <div class="small muted">读取本机课表与记事，断网也能回答</div>
      </div>
      <span class="pill live">离线可用</span>
    </section>

    <div class="uni-boundary small">
      当前版本不连接大模型；课表、教师、教室和记事内容只在本机用于回答。账号备份与同步是独立功能，按你选择的云端模式处理。
    </div>

    <div class="chips uni-examples">
      <button v-for="item in examples" :key="item" class="chip sm" @click="ask(item)">{{ item }}</button>
    </div>

    <section v-if="answer" class="card uni-answer">
      <div class="small muted">你问：{{ lastQuestion }}</div>
      <div class="uni-answer-text">{{ answer.response.answer }}</div>
      <div class="row uni-answer-meta">
        <span class="pill uni-source-pill">本机规则</span>
        <span v-if="answer.response.offlineCapable" class="pill live">无需联网</span>
      </div>

      <div v-if="answer.response.cards.length" class="uni-cards">
        <button
          v-for="(card, i) in answer.response.cards"
          :key="card.type + '-' + i"
          class="uni-action"
          :class="{ clickable: card.operation !== 'none' }"
          :disabled="card.operation === 'none'"
          @click="runCard(card)"
        >
          <span class="grow">
            <b>{{ card.title }}</b>
            <small v-if="cardTime(card)">{{ cardTime(card) }}</small>
          </span>
          <span v-if="card.operation === 'open.schedule'">打开课表 ›</span>
          <span v-else-if="card.operation === 'note.create'">确认添加 ›</span>
        </button>
      </div>

      <details v-if="answer.response.explain.length" class="uni-explain">
        <summary>查看回答依据</summary>
        <div v-for="line in answer.response.explain" :key="line">· {{ line }}</div>
      </details>
    </section>

    <div v-else class="empty small">
      <div class="big">✦</div>
      试着问一句。Uni 会优先用确定性规则回答，不会编造课表。
    </div>

    <form class="uni-compose" @submit.prevent="ask()">
      <input v-model="text" maxlength="500" enterkeyhint="send" placeholder="问课表、空档、冲突，或说一句记事…" />
      <button class="btn" type="submit" :disabled="!text.trim() || asking">发送</button>
    </form>
  </div>
</template>

<style scoped>
.uni-page { padding-bottom: calc(152px + var(--safe-b)); }
.uni-intro { display: flex; align-items: center; gap: 12px; }
.uni-mark { width: 42px; height: 42px; flex: none; border-radius: 14px; display: flex; align-items: center; justify-content: center; background: linear-gradient(145deg, var(--brand), #5f82c8); color: #fff; font-size: 22px; font-weight: 800; }
.uni-boundary { margin: 10px 2px 12px; padding: 10px 12px; border-radius: 12px; color: var(--muted); background: var(--tint); border: 1px solid var(--line); }
.uni-examples { margin-bottom: 12px; }
.uni-answer-text { margin-top: 8px; font-size: 16px; line-height: 1.75; white-space: pre-wrap; }
.uni-answer-meta { margin-top: 10px; gap: 6px; }
.uni-source-pill { color: var(--brand); background: var(--tint); }
.uni-cards { margin-top: 12px; display: grid; gap: 8px; }
.uni-action { width: 100%; min-height: 48px; padding: 9px 11px; border: 1px solid var(--line); border-radius: 11px; background: var(--soft); display: flex; align-items: center; gap: 10px; text-align: left; color: var(--muted); }
.uni-action.clickable { color: var(--brand); background: var(--tint); }
.uni-action b { display: block; color: var(--text); font-size: 13px; }
.uni-action small { display: block; margin-top: 2px; color: var(--muted); }
.uni-explain { margin-top: 12px; color: var(--muted); font-size: 12px; }
.uni-explain summary { cursor: pointer; color: var(--brand); margin-bottom: 5px; }
.uni-compose { position: fixed; z-index: 42; left: 12px; right: 12px; bottom: calc(70px + var(--safe-b)); display: flex; gap: 8px; padding: 8px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); box-shadow: 0 6px 18px rgba(20, 30, 60, .14); }
.uni-compose input { min-width: 0; flex: 1; border: 0; outline: 0; padding: 0 6px; background: transparent; }
.uni-compose .btn { min-height: 40px; padding: 0 14px; }
</style>
