<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { guard } from '../services/guard.ts';
import { AgentCore, type AgentMessage, type AgentReply } from '../services/agentCore.ts';
import { HttpAIProvider, NetworkAwarePlanner } from '../services/aiProvider.ts';
import { createStudentTools, LocalRulePlanner, type AgentFeature, type StudentAgentPort } from '../services/uniTools.ts';
import { agoText, weatherText } from '../services/weather.ts';
import { readJson, writeJson } from '../services/io.ts';
import { BrowserSpeechInput, BrowserSpeechOutput, VoiceAgent } from '../services/voiceAI.ts';
import { JwWebView } from '../services/jwwebview.ts';
import AppleIcon from '../components/AppleIcon.vue';
import type { ActionCard } from '../../p5-assistant/n8n/core/types.ts';

const db = useDb();
const text = ref('');
const loading = ref(false);
const listening = ref(false);
const historyReady = ref(false);
const showHistory = ref(false);
const errorText = ref('');
const voiceHint = ref('');
const messageList = ref<HTMLElement | null>(null);
const errorBox = ref<HTMLElement | null>(null);
const composerInput = ref<HTMLInputElement | null>(null);
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
const voiceAgent = new VoiceAgent(new BrowserSpeechInput(), new BrowserSpeechOutput(), agent);
const messages = ref<readonly AgentMessage[]>(agent.messages());

function historyPath(): string {
  const schoolId = db.profile?.schoolId || 'default';
  const accountId = db.session?.accountId || 'anonymous';
  return 'schools/' + schoolId + '/users/' + accountId + '/agent/history.json';
}

function historyPayload(): object[] {
  return agent.messages().map((message) => ({
    role: message.role, content: message.content, source: message.source, createdAt: message.createdAt
  }));
}

async function persistHistory(): Promise<void> {
  await guard('Uni 保存历史记录', writeJson(historyPath(), historyPayload()), 8000, undefined);
}

async function loadHistory(): Promise<void> {
  const stored = await guard('Uni 读取历史记录', readJson<unknown[]>(historyPath(), []), 8000, []);
  agent.restore(stored);
  messages.value = agent.messages();
  historyReady.value = true;
  if (messages.value.length) await scrollToBottom();
}

onMounted(() => { void loadHistory(); });

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
  if (!value || loading.value || !historyReady.value) return;
  text.value = '';
  errorText.value = '';
  voiceHint.value = '';
  loading.value = true;
  try {
    const reply = await agent.ask(value);
    await applyConfirmation(reply);
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : 'Uni 暂时无法回答，请稍后再试';
  } finally {
    messages.value = agent.messages();
    await persistHistory();
    loading.value = false;
    await scrollToBottom();
  }
}

async function listenVoice(): Promise<void> {
  if (loading.value || !historyReady.value) return;
  let keyboardFallback = false;
  errorText.value = '';
  voiceHint.value = '';
  listening.value = true;
  loading.value = true;
  try {
    const result = await voiceAgent.run('zh-CN');
    await applyConfirmation(result.reply);
  } catch (error) {
    const message = error instanceof Error ? error.message : '语音输入失败，请重试';
    if (message.includes('系统没有可用的语音识别服务')) {
      keyboardFallback = true;
      voiceHint.value = '已打开系统键盘，请点击键盘上的麦克风进行语音输入';
    } else {
      errorText.value = message;
    }
  } finally {
    messages.value = agent.messages();
    await persistHistory();
    listening.value = false;
    loading.value = false;
    if (keyboardFallback) {
      await nextTick();
      composerInput.value?.focus();
      const keyboard = await guard('Uni 打开系统输入法', JwWebView.showKeyboard(), 3000, { ok: false, error: '打开系统键盘超时' });
      if (!keyboard.ok) errorText.value = keyboard.error || '请点一下输入框，再使用键盘上的麦克风';
    } else {
      await scrollToBottom();
    }
  }
}

function messageTime(value: number): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date);
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
    <button class="uni-chat-history" type="button" aria-haspopup="dialog" @click="showHistory = true">
      <span class="uni-chat-history-title"><AppleIcon name="history" :size="17" /><b>历史记录</b><span>{{ messages.length ? ' · ' + messages.length + ' 条' : ' · 暂无记录' }}</span></span>
      <span class="uni-chat-history-accessory">仅保存在本机 <AppleIcon name="chevronRight" :size="14" /></span>
    </button>
    <div class="chips uni-chat-examples">
      <button v-for="item in examples" :key="item" class="chip sm" :disabled="loading" @click="send(item)">{{ item }}</button>
    </div>
    <section ref="messageList" class="uni-chat-list" aria-live="polite">
      <div v-if="!historyReady" class="empty small">正在读取本机历史记录…</div>
      <div v-else-if="!messages.length" class="empty small"><AppleIcon class="uni-chat-empty-icon" name="star" :size="28" />问问课程安排，也可以和 Uni 聊学习与校园生活。</div>
      <article v-for="message in messages" :key="message.id" class="uni-chat-message" :class="'uni-chat-' + message.role">
        <div class="uni-chat-bubble">
          <div class="uni-chat-content">{{ message.content }}</div>
          <div class="uni-chat-meta">
            <span v-if="message.source" class="uni-chat-source">{{ message.source === 'ai' ? 'Workers AI' : '本机 Tool' }}</span>
            <time :datetime="new Date(message.createdAt).toISOString()">{{ messageTime(message.createdAt) }}</time>
          </div>
          <div v-if="message.cards.length" class="uni-chat-cards">
            <button v-for="(card, index) in message.cards" :key="card.type + index" class="uni-chat-action" :disabled="card.operation === 'none'" @click="runCard(card)">
              <span class="grow"><b>{{ card.title }}</b><small v-if="cardTime(card)">{{ cardTime(card) }}</small></span><span v-if="card.operation !== 'none'">执行 →</span>
            </button>
          </div>
          <details v-if="message.explain.length" class="uni-chat-explain"><summary>查看回答依据</summary><div v-for="line in message.explain" :key="line">· {{ line }}</div></details>
        </div>
      </article>
      <div v-if="loading" class="uni-chat-message uni-chat-assistant"><div class="uni-chat-bubble uni-chat-loading">{{ listening ? '正在听，请说话…' : 'Uni 正在处理…' }}</div></div>
    </section>
    <div v-if="errorText" ref="errorBox" class="uni-chat-error" role="alert">
      <div>{{ errorText }}</div>
      <button class="uni-chat-offline" type="button" @click="send('下一节什么课')">试试离线查课</button>
    </div>
    <div v-if="voiceHint" class="uni-chat-voice-hint" role="status">{{ voiceHint }}</div>
    <form class="uni-chat-compose" @submit.prevent="send()">
      <button class="uni-chat-mic" type="button" aria-label="语音输入" :aria-pressed="listening" :disabled="loading || !historyReady" @click="listenVoice">
        <AppleIcon name="microphone" :size="20" />
      </button>
      <input ref="composerInput" v-model="text" maxlength="500" enterkeyhint="send" placeholder="和 Uni 说点什么…" :disabled="loading || !historyReady" />
      <button class="btn" type="submit" :disabled="!text.trim() || loading || !historyReady">发送</button>
    </form>

    <div v-if="showHistory" class="uni-history-mask" @click.self="showHistory = false">
      <section class="uni-history-sheet" role="dialog" aria-modal="true" aria-label="Uni 历史记录">
        <header class="uni-history-head"><div><b>历史记录</b><small>仅保存在本机</small></div><button type="button" @click="showHistory = false">完成</button></header>
        <div v-if="!messages.length" class="empty small">暂无历史记录</div>
        <div v-else class="uni-history-list">
          <article v-for="message in messages" :key="'history-' + message.id" class="uni-history-item">
            <div class="uni-history-meta"><b>{{ message.role === 'user' ? '我' : 'Uni' }}</b><time :datetime="new Date(message.createdAt).toISOString()">{{ messageTime(message.createdAt) }}</time></div>
            <div>{{ message.content }}</div>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.uni-chat-page { padding-bottom: calc(154px + var(--safe-b)); }
.uni-chat-history { width: 100%; min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0 0 10px; padding: 0 12px; color: var(--muted); font-size: 11px; text-align: left; background: var(--card); border: 1px solid var(--line); border-radius: 12px; }
.uni-chat-history-title, .uni-chat-history-accessory { display: flex; align-items: center; gap: 5px; }
.uni-chat-history-title { color: var(--brand); }
.uni-chat-history b { color: var(--text); font-size: 13px; font-weight: 600; }
.uni-chat-history-accessory { flex: none; }
.uni-chat-examples { margin-bottom: 12px; }
.uni-chat-list { display: grid; gap: 10px; padding: 2px 2px 90px; }
.uni-chat-message { display: flex; }
.uni-chat-user { justify-content: flex-end; }
.uni-chat-bubble { max-width: 88%; padding: 10px 12px; border-radius: 14px; background: var(--soft); border: 1px solid var(--line); }
.uni-chat-user .uni-chat-bubble { color: #fff; background: var(--brand); border-color: var(--brand); border-bottom-right-radius: 4px; }
.uni-chat-assistant .uni-chat-bubble { border-bottom-left-radius: 4px; }
.uni-chat-content { white-space: pre-wrap; line-height: 1.65; }
.uni-chat-meta { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 7px; color: var(--muted); font-size: 10px; }
.uni-chat-source { display: inline-block; }
.uni-chat-empty-icon { margin: 0 auto 8px; color: var(--brand); }
.uni-chat-loading { color: var(--muted); }
.uni-chat-error { margin-top: 10px; padding: 9px 11px; border-radius: 10px; color: #b42318; background: #fff0ee; }
.uni-chat-voice-hint { position: fixed; z-index: 43; left: 18px; right: 18px; bottom: calc(126px + var(--safe-b)); padding: 9px 12px; color: var(--brand); font-size: 12px; line-height: 1.45; background: var(--card); border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--shadow); }
.uni-chat-offline { margin-top: 7px; padding: 5px 9px; border: 1px solid currentColor; border-radius: 8px; color: inherit; background: transparent; }
.uni-chat-cards { display: grid; gap: 7px; margin-top: 9px; }
.uni-chat-action { width: 100%; padding: 8px; display: flex; gap: 8px; text-align: left; color: var(--brand); background: var(--card); border: 1px solid var(--line); border-radius: 9px; }
.uni-chat-action b, .uni-chat-action small { display: block; color: var(--text); }
.uni-chat-explain { margin-top: 8px; color: var(--muted); font-size: 12px; }
.uni-chat-compose { position: fixed; z-index: 42; left: 12px; right: 12px; bottom: calc(70px + var(--safe-b)); display: flex; gap: 8px; padding: 8px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); box-shadow: 0 6px 18px rgba(20,30,60,.14); }
.uni-chat-compose input { min-width: 0; flex: 1; border: 0; outline: 0; padding: 0 6px; color: var(--text); background: transparent; }
.uni-chat-compose .btn { min-height: 40px; padding: 0 14px; }
.uni-chat-mic { width: 40px; height: 40px; flex: none; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: var(--brand); background: var(--tint); }
.uni-chat-mic[aria-pressed="true"] { color: #fff; background: var(--brand); }
.uni-chat-mic:disabled { opacity: .45; }
.uni-history-mask { position: fixed; z-index: 90; inset: 0; display: flex; align-items: flex-end; padding: 12px 12px calc(12px + var(--safe-b)); background: rgba(0,0,0,.28); }
.uni-history-sheet { width: 100%; max-height: 78vh; display: flex; flex-direction: column; padding: 16px; background: var(--card); border-radius: 18px; box-shadow: 0 16px 44px rgba(0,0,0,.22); }
.uni-history-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 12px; }
.uni-history-head b, .uni-history-head small { display: block; }
.uni-history-head b { font-size: 17px; color: var(--text); }
.uni-history-head small { margin-top: 2px; color: var(--muted); }
.uni-history-head button { color: var(--brand); font-size: 15px; }
.uni-history-list { overflow: auto; display: grid; gap: 8px; }
.uni-history-item { padding: 10px 12px; color: var(--text); background: var(--soft); border-radius: 12px; white-space: pre-wrap; line-height: 1.55; }
.uni-history-meta { display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; color: var(--muted); font-size: 10px; }
.uni-history-meta b { color: var(--text); font-size: 12px; }
</style>
