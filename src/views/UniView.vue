<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { guard } from '../services/guard.ts';
import { AgentCore, type AgentMessage, type AgentReply } from '../services/agentCore.ts';
import { HttpAIProvider, NetworkAwarePlanner } from '../services/aiProvider.ts';
import { createStudentTools, LocalRulePlanner, type AgentFeature, type StudentAgentPort } from '../services/uniTools.ts';
import { agoText, weatherText } from '../services/weather.ts';
import type { ActionCard } from '../../p5-assistant/n8n/core/types.ts';

const db = useDb();
const text = ref('');
const loading = ref(false);
const errorText = ref('');
const messageList = ref<HTMLElement | null>(null);
const errorBox = ref<HTMLElement | null>(null);
const examples = ['下一节什么课', '查一下记事', '记一下带实验报告', '打开记事本'];

const port: StudentAgentPort = {
  scheduleSnapshot: () => ({
    activeTimetable: db.activeTimetable, courses: db.courses, notes: db.notes,
    periodTimes: db.settings.periodTimes, scheduleTimezone: 'Asia/Shanghai'
  }),
  notes: () => db.notes.filter((note) => !note.deletedAt).map((note) => ({
    id: note.id, title: note.title, remindAt: note.remindAt, done: note.done
  })),
  addNote: async (input) => {
    const note = db.addNote({ title: input.title, content: input.content || '由 Uni Agent 添加', remindAt: input.remindAt });
    const saved = await guard('Uni 保存记事', db.saveData().then(() => true), 8000, false);
    return { id: note.id, saved };
  },
  weather: async (refresh) => {
    if (refresh && db.settings.weatherEnabled) {
      await guard('Uni 查询天气', db.ensureWeather(true).then(() => true), 10_000, false);
    }
    const current = db.settings.weatherNow;
    return {
      enabled: !!db.settings.weatherEnabled,
      summary: current ? weatherText(current) : '',
      location: db.settings.weatherLoc?.name,
      updatedAt: current?.fetchedAt,
      status: current ? agoText(current.fetchedAt) + '更新' : db.weatherMsg
    };
  },
  openFeature: async (feature: AgentFeature) => {
    if (feature === 'schedule') { db.activeTab = 0; db.activeSheet = 'sheet1'; return; }
    if (feature === 'notes') { db.activeTab = 0; db.activeSheet = 'sheet2'; return; }
    if (feature === 'secondClass') { db.activeTab = 1; return; }
    if (feature === 'online') { db.activeTab = 3; return; }
    db.activeTab = 4;
  }
};

const localPlanner = new LocalRulePlanner();
const dualPlanner = new NetworkAwarePlanner(new HttpAIProvider(), localPlanner);
const agent = new AgentCore({ planner: dualPlanner, localPlanner, tools: createStudentTools(port) });
const messages = ref<readonly AgentMessage[]>(agent.messages());

async function scrollToBottom(): Promise<void> {
  await nextTick();
  const target = errorText.value ? errorBox.value : messageList.value?.lastElementChild;
  target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

async function applyConfirmation(reply: AgentReply): Promise<void> {
  const confirmation = reply.confirmation;
  if (!confirmation) return;
  const approved = await db.confirm({
    title: confirmation.title, body: confirmation.body, detail: confirmation.detail,
    confirmText: confirmation.confirmText, cancelText: confirmation.cancelText, danger: confirmation.danger
  });
  await agent.confirm(confirmation.id, approved);
}

async function send(question?: string): Promise<void> {
  const value = String(question ?? text.value).trim();
  if (!value || loading.value) return;
  text.value = '';
  errorText.value = '';
  loading.value = true;
  try {
    const reply = await agent.ask(value);
    await applyConfirmation(reply);
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : 'Uni 暂时无法回答，请稍后再试';
  } finally {
    messages.value = agent.messages();
    loading.value = false;
    await scrollToBottom();
  }
}

function cardTime(card: ActionCard): string {
  if (!card.time) return '';
  const date = new Date(card.time);
  if (!Number.isFinite(date.getTime())) return card.time;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function runCard(card: ActionCard): void {
  if (card.operation === 'open.schedule') { db.activeSheet = 'sheet1'; db.activeTab = 0; }
}
</script>

<template>
  <div class="scroll uni-chat-page">
    <div class="chips uni-chat-examples">
      <button v-for="item in examples" :key="item" class="chip sm" :disabled="loading" @click="send(item)">{{ item }}</button>
    </div>
    <section ref="messageList" class="uni-chat-list" aria-live="polite">
      <div v-if="!messages.length" class="empty small"><div class="big">✦</div>问问课程安排，也可以和 Uni 聊学习与校园生活。</div>
      <article v-for="message in messages" :key="message.id" class="uni-chat-message" :class="'uni-chat-' + message.role">
        <div class="uni-chat-bubble">
          <div class="uni-chat-content">{{ message.content }}</div>
          <span v-if="message.source" class="uni-chat-source">{{ message.source === 'ai' ? 'Workers AI' : '本机 Tool' }}</span>
          <div v-if="message.cards.length" class="uni-chat-cards">
            <button v-for="(card, index) in message.cards" :key="card.type + index" class="uni-chat-action" :disabled="card.operation === 'none'" @click="runCard(card)">
              <span class="grow"><b>{{ card.title }}</b><small v-if="cardTime(card)">{{ cardTime(card) }}</small></span><span v-if="card.operation !== 'none'">执行 →</span>
            </button>
          </div>
          <details v-if="message.explain.length" class="uni-chat-explain"><summary>查看回答依据</summary><div v-for="line in message.explain" :key="line">· {{ line }}</div></details>
        </div>
      </article>
      <div v-if="loading" class="uni-chat-message uni-chat-assistant"><div class="uni-chat-bubble uni-chat-loading">Uni 正在处理…</div></div>
    </section>
    <div v-if="errorText" ref="errorBox" class="uni-chat-error" role="alert">
      <div>{{ errorText }}</div>
      <button class="uni-chat-offline" type="button" @click="send('下一节什么课')">试试离线查课</button>
    </div>
    <form class="uni-chat-compose" @submit.prevent="send()">
      <input v-model="text" maxlength="500" enterkeyhint="send" placeholder="和 Uni 说点什么…" :disabled="loading" />
      <button class="btn" type="submit" :disabled="!text.trim() || loading">发送</button>
    </form>
  </div>
</template>

<style scoped>
.uni-chat-page { padding-bottom: calc(154px + var(--safe-b)); }
.uni-chat-examples { margin-bottom: 12px; }
.uni-chat-list { display: grid; gap: 10px; padding: 2px 2px 90px; }
.uni-chat-message { display: flex; }
.uni-chat-user { justify-content: flex-end; }
.uni-chat-bubble { max-width: 88%; padding: 10px 12px; border-radius: 14px; background: var(--soft); border: 1px solid var(--line); }
.uni-chat-user .uni-chat-bubble { color: #fff; background: var(--brand); border-color: var(--brand); border-bottom-right-radius: 4px; }
.uni-chat-assistant .uni-chat-bubble { border-bottom-left-radius: 4px; }
.uni-chat-content { white-space: pre-wrap; line-height: 1.65; }
.uni-chat-source { display: inline-block; margin-top: 7px; font-size: 10px; color: var(--muted); }
.uni-chat-loading { color: var(--muted); }
.uni-chat-error { margin-top: 10px; padding: 9px 11px; border-radius: 10px; color: #b42318; background: #fff0ee; }
.uni-chat-offline { margin-top: 7px; padding: 5px 9px; border: 1px solid currentColor; border-radius: 8px; color: inherit; background: transparent; }
.uni-chat-cards { display: grid; gap: 7px; margin-top: 9px; }
.uni-chat-action { width: 100%; padding: 8px; display: flex; gap: 8px; text-align: left; color: var(--brand); background: var(--card); border: 1px solid var(--line); border-radius: 9px; }
.uni-chat-action b, .uni-chat-action small { display: block; color: var(--text); }
.uni-chat-explain { margin-top: 8px; color: var(--muted); font-size: 12px; }
.uni-chat-compose { position: fixed; z-index: 42; left: 12px; right: 12px; bottom: calc(70px + var(--safe-b)); display: flex; gap: 8px; padding: 8px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); box-shadow: 0 6px 18px rgba(20,30,60,.14); }
.uni-chat-compose input { min-width: 0; flex: 1; border: 0; outline: 0; padding: 0 6px; color: var(--text); background: transparent; }
.uni-chat-compose .btn { min-height: 40px; padding: 0 14px; }
</style>
