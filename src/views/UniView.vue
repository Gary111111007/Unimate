<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { guard } from '../services/guard.ts';
import { AgentCore, type AgentMessage, type AgentReply } from '../services/agentCore.ts';
import { HttpAIProvider, NetworkAwarePlanner } from '../services/aiProvider.ts';
import { createStudentTools, LocalRulePlanner, type AgentFeature, type StudentAgentPort } from '../services/uniTools.ts';
import { agoText, weatherText } from '../services/weather.ts';
import { readJson, writeJson } from '../services/io.ts';
import { toPlainText, hasMarkdown } from '../services/markdown.ts';
import AppleIcon from '../components/AppleIcon.vue';
import MarkdownText from '../components/MarkdownText.vue';
import type { ActionCard } from '../../p5-assistant/n8n/core/types.ts';

const db = useDb();
const text = ref('');
const loading = ref(false);
const historyReady = ref(false);
const showHistory = ref(false);
const errorText = ref('');
const messageList = ref<HTMLElement | null>(null);
const errorBox = ref<HTMLElement | null>(null);
const composerInput = ref<HTMLInputElement | null>(null);
/** 历史面板里的搜索词（按问题文字过滤，不是全文检索）。 */
const historyQuery = ref('');
/** 最近一次复制成功的消息 id，用于把"复制"按钮短暂改成"已复制"。 */
const copiedId = ref('');
/** 是否已经滚到底 —— 不在底部时冒出一个"回到最新"，否则用户被自动滚动抢走阅读位置。 */
const atBottom = ref(true);

/*
 * 开场白建议（v2.70）。
 * 原来只有 4 个 chip、且都是"查课/记事"这类功能命令，第一次进来不知道还能聊什么。
 * 现在按"最常用 → 最像个助手"排序并各配一个线性图标，降低首屏的空屏焦虑。
 */
const examples: { icon: 'calendar' | 'book' | 'bookmark' | 'sparkles'; label: string; ask: string }[] = [
  { icon: 'calendar', label: '下一节什么课', ask: '下一节什么课' },
  { icon: 'calendar', label: '明天有几节课', ask: '明天有几节课' },
  { icon: 'bookmark', label: '查一下记事', ask: '查一下记事' },
  { icon: 'book', label: '帮我规划复习', ask: '帮我规划一下这周的复习安排' },
  { icon: 'sparkles', label: '你能做什么', ask: '你能做什么' }
];

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
/** 用户最近问过的问题，用于「重新生成」。 */
const lastQuestion = ref('');

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

/**
 * 把「Uni 标题栏的实际高度」写进 `--unih-head`，供顶部历史条的 sticky top 使用（v2.76）。
 *
 * 为什么要量而不是写死：`.head` 的高度 = calc(12px + safe-t) + 内容 + 10px，
 * 而内容随页签变（课表页多了 .sheetbar 那一排）；Uni 页虽然只有标题，
 * 但安全区 safe-t 在真机上是 0～60px 不等的真实数值，写死必错位。
 *
 * 取 `.head` 的 offsetHeight（含 border，是它占据的视觉高度）。
 * 取不到就清掉变量，CSS 里 `var(--unih-head, 0px)` 会退化成 0（顶到视口最上沿）。
 */
const headOffset = ref(0);
function syncHeadHeight() {
  const head = document.querySelector('.head') as HTMLElement | null;
  const h = head ? Math.round(head.getBoundingClientRect().height) : 0;
  if (h !== headOffset.value) headOffset.value = h;
}

onMounted(() => {
  void loadHistory();
  // 首帧后量一次；再补一次 nextTick，避开字体加载引起的行高跳动。
  syncHeadHeight();
  void nextTick(syncHeadHeight);
  window.addEventListener('resize', syncHeadHeight);
  window.addEventListener('orientationchange', syncHeadHeight);
});

onUnmounted(() => {
  window.removeEventListener('resize', syncHeadHeight);
  window.removeEventListener('orientationchange', syncHeadHeight);
});

/**
 * 滚到底部。
 * 【v2.70 改动】以前每次都硬滚，用户在往上翻历史时会被新回复强行拽走；
 * 现在只有"本来就在底部"（默认）才滚，其它情况交给底部的「回到最新」。
 * 【v2.73 改动】滚动容器从 `.uni-chat-list` 换成整页 `.uni-chat-page`（见下方样式注释），
 * 所以"最后一条"不能再靠 `lastElementChild`（那会拿到输入框那条表单），改成显式查最后一条消息。
 */
async function scrollToBottom(force = true): Promise<void> {
  if (!force && !atBottom.value) return;
  await nextTick();
  if (errorText.value) { errorBox.value?.scrollIntoView({ block: 'end', behavior: 'smooth' }); atBottom.value = true; return; }
  const el = messageList.value;
  if (!el) return;
  /*
   * 优先滚"正在输入"的那个点（用户最想看到它），否则滚最后一条消息；
   * 两者都没有（空对话）就滚到底 —— 让整页 scrollTop 拉满即可。
   */
  const node = el.querySelector('.uni-chat-loading') || el.querySelector('.uni-chat-message:last-of-type');
  if (node) node.scrollIntoView({ block: 'end', behavior: 'smooth' });
  else el.scrollTop = el.scrollHeight;
  atBottom.value = true;
}

/** 滚动位置监听：离底部 24px 内算"在底部"。监听的是整页滚动容器。 */
function onListScroll(): void {
  const el = messageList.value;
  if (!el) return;
  atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
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
  loading.value = true;
  // 用户自己发消息 → 无条件滚到底（这是明确意图，不算"抢阅读位置"）
  await scrollToBottom(true);
  try {
    const reply = await agent.ask(value);
    lastQuestion.value = value;
    await applyConfirmation(reply);
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : 'Uni 暂时无法回答，请稍后再试';
  } finally {
    messages.value = agent.messages();
    await persistHistory();
    loading.value = false;
    await scrollToBottom(true);
  }
}

/**
 * 重新生成：往前找到这条回复对应的那个问题、再问一遍。
 * 刻意**不原地替换**旧记录 —— 那会让"历史只保存在本机"的承诺变得含糊
 * （用户以为记录还在，其实被静默改写了）。重问一次，新旧都看得见。
 */
async function regenerate(index: number): Promise<void> {
  for (let i = index - 1; i >= 0; i -= 1) {
    const m = messages.value[i];
    if (m.role === 'user') { await send(m.content); return; }
  }
}

/** 复制单条消息。手动复制是对话类应用最高频的操作之一。 */
async function copyMessage(message: AgentMessage): Promise<void> {
  const body = toPlainText(message.content);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(body);
    } else {
      // 部分 WebView 不提供 clipboard API，退回到临时 textarea
      const ta = document.createElement('textarea');
      ta.value = body;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    copiedId.value = message.id;
    setTimeout(() => { if (copiedId.value === message.id) copiedId.value = ''; }, 1600);
  } catch {
    db.notify('复制失败，请长按文字手动选择');
  }
}

/* ---- 对话人性化：日期分组、头像、去重时间 ---- */

/** 一天的起点（本地时区），用于把消息按"天"分组。 */
function dayStart(value: number): number {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 0;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function clockText(value: number): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

/** 日期分隔条文案：今天 / 昨天 / 9月21日 星期一。 */
function dayLabel(value: number): string {
  const start = dayStart(value);
  if (!start) return '';
  const today = dayStart(Date.now());
  if (start === today) return '今天';
  if (start === today - 86_400_000) return '昨天';
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(start));
}

interface ChatEntry {
  message: AgentMessage;
  index: number;
  /** 与上一条消息不是同一天时为 true，需要插入日期分隔条。 */
  newDay: boolean;
  /** 与上一条消息不同角色时为 true，需要显示头像与"尾巴"。 */
  newGroup: boolean;
  /** 是不是最后一条 —— 只有最后一条回复才给「重新生成」。 */
  isLast: boolean;
}

const chatEntries = computed<ChatEntry[]>(() => {
  const list = messages.value;
  return list.map((message, index) => {
    const prev = index > 0 ? list[index - 1] : null;
    return {
      message,
      index,
      newDay: !prev || dayStart(prev.createdAt) !== dayStart(message.createdAt),
      newGroup: !prev || prev.role !== message.role || dayStart(prev.createdAt) !== dayStart(message.createdAt),
      isLast: index === list.length - 1
    };
  });
});

/** 助手回复里出现 Markdown 记号时就走走渲染分支（纯文本保持轻量）。 */
function richReply(content: string): boolean {
  return hasMarkdown(content);
}

/* ---- 历史记录：把"一堆消息"整理成"一轮轮对话" ---- */

interface ChatTurn {
  /** 这一轮的稳定 key（用提问那条消息的 id） */
  key: string;
  /** 用户的问题（已去 Markdown 记法） */
  question: string;
  /** 提问消息的 id，点击历史条目后滚到它 */
  anchorId: string;
  /** 助手回答的摘要（去 Markdown 记法） */
  answer: string;
  /** 回答产生的可执行卡片数 */
  cards: number;
  createdAt: number;
}

/**
 * 把消息流配对成一轮轮对话。
 *
 * 【为什么按"轮"而不是按"条"】
 *  v2.67 的历史面板把每条消息平铺出来 —— 真机上就是"问一句、答一大段"，
 *  长回答占满整屏，想找"上次问的那件事"只能一路翻。对话类应用的通行做法是
 *  **以会话为单位**（ChatGPT / Claude 的侧栏都是这样）：问题当标题、回答当预览，点一下跳回去。
 *
 * 配对规则：遇到 user 就开一轮，其后紧邻的 assistant 归入这一轮；
 * 结构异常（历史来自旧版本、只有半截）也不能丢消息 —— 兜底会保留最后一条。
 */
const chatTurns = computed<ChatTurn[]>(() => {
  const turns: ChatTurn[] = [];
  const list = messages.value;
  for (let i = 0; i < list.length; i += 1) {
    const m = list[i];
    if (m.role !== 'user') continue;
    const reply = list[i + 1] && list[i + 1].role === 'assistant' ? list[i + 1] : null;
    turns.push({
      key: m.id,
      question: toPlainText(m.content),
      anchorId: m.id,
      answer: reply ? toPlainText(reply.content) : '',
      cards: reply ? reply.cards.length : 0,
      createdAt: m.createdAt
    });
  }
  // 没有以提问开头的记录（例如只剩一条助手消息）也要看得见
  if (!turns.length && list.length) {
    const m = list[list.length - 1];
    turns.push({
      key: m.id, question: toPlainText(m.content), anchorId: m.id,
      answer: '', cards: m.cards.length, createdAt: m.createdAt
    });
  }
  return turns;
});

interface HistoryGroup { label: string; turns: ChatTurn[] }

/** 历史面板：按天分组、组内新→旧；搜索按问题文字过滤。 */
const historyGroups = computed<HistoryGroup[]>(() => {
  const k = historyQuery.value.trim().toLowerCase();
  const list = k ? chatTurns.value.filter((t) => t.question.toLowerCase().includes(k) || t.answer.toLowerCase().includes(k)) : chatTurns.value;
  const groups: HistoryGroup[] = [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const turn = list[i];
    const label = historyDayLabel(turn.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.turns.push(turn);
    else groups.push({ label, turns: [turn] });
  }
  return groups;
});

const turnCount = computed(() => chatTurns.value.length);

/** 历史面板里的分组标题：比聊天区更完整（含年份）。 */
function historyDayLabel(value: number): string {
  const start = dayStart(value);
  if (!start) return '更早';
  const today = dayStart(Date.now());
  const date = new Date(start);
  const prefix = start === today ? '今天' : start === today - 86_400_000 ? '昨天' : '';
  const detail = new Intl.DateTimeFormat('zh-CN', {
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    month: 'long', day: 'numeric'
  }).format(date);
  return prefix ? prefix + ' · ' + detail : detail;
}

/** 点历史条目 → 关面板、滚回原处。 */
async function jumpTo(anchorId: string): Promise<void> {
  showHistory.value = false;
  await nextTick();
  const el = messageList.value?.querySelector('[data-mid="' + anchorId + '"]') as HTMLElement | null;
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/** 点历史条目右侧的「再问一次」。 */
async function askAgain(turn: ChatTurn): Promise<void> {
  showHistory.value = false;
  await send(turn.question);
}

/**
 * 清空历史。**删除必须二次确认**（AGENTS.md 硬规则 1），且要说清影响面与能否恢复。
 */
async function clearHistory(): Promise<void> {
  if (!turnCount.value) return;
  const ok = await db.confirm({
    title: '确认清空全部历史对话？',
    body: '本机这一份共 ' + turnCount.value + ' 轮对话（' + messages.value.length + ' 条消息）将被删除。',
    detail: '只清空这一台手机上的对话记录：课表、记事、二课数据都不受影响。清空后无法恢复，也无法从云端找回。',
    confirmText: '清空历史'
  });
  if (!ok) return;
  await guard('Uni 清空历史记录', writeJson(historyPath(), []), 8000, undefined);
  // AgentCore 没有 reset()，但 restore([]) 就是"清空 + 重置上下文"（它先 splice(0) 再灌数据）
  agent.restore([]);
  messages.value = agent.messages();
  lastQuestion.value = '';
  historyQuery.value = '';
  showHistory.value = false;
}

/** 历史条目的时间：今天只给 HH:mm，更早给 月/日。 */
function turnTime(value: number): string {
  const start = dayStart(value);
  const today = dayStart(Date.now());
  if (start === today) return clockText(value);
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(value));
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
  <!--
    【v2.76 结构性修正 —— 这才是"钉不住"的真正原因】

    前四轮（v2.72~v2.75）我都把历史入口放在 `.uni-chat-page` **内部**，然后调它的
    底色、边框、负边距。真机实测（Playwright 量 getBoundingClientRect）证明这样永远钉不住：

      滚动 500px 后 → .head.top = 0（稳）      .uni-chat-history.top = -434（跟着滚走了）

    原因是 CSS 规范里 sticky 的两条硬约束，`.uni-chat-page` 同时踩中：
      1) **父容器有 overflow 就算约束容器**：`.uni-chat-page` 带 `.scroll` 的 overflow-y:auto，
         sticky 子元素只能在这个父容器的**高度范围**内吸附；父容器整体滚出视口，它就一起走。
      2) 真正在滚的是 **`<html>`**（`.screen` 是 min-height:100% 而非 height:100%，
         `.scroll{flex:1}` 拿不到确定高度 → 不滚动、只被内容撑开，由页面级滚动兜底）。
         `.head` 之所以一直好使，正因为它是 `.uni-chat-page` 的**兄弟**、直接受 `<html>` 约束。

    所以修法只有一条：**把历史入口挪出 `.uni-chat-page`，和 `.head` 做兄弟**。
    再加一层 `.uni-chat-wrap` 当根（SFC 只能有一个根节点），它自己不滚动、不裁剪
    （overflow: visible），保证 sticky 的约束祖先仍是 `<html>`。

    职责仍然留在 UniView 内（没有塞进 Main.vue 的 `.head`），只是层级从"页内"提到"页同级"。
  -->
  <div class="uni-chat-wrap" :style="{ '--unih-head': headOffset + 'px' }">
    <div class="uni-chat-history">
      <button class="uni-chat-history-in" type="button" aria-haspopup="dialog" @click="showHistory = true">
        <span class="uni-chat-history-title"><AppleIcon name="history" :size="17" /><b>历史对话</b><span>{{ turnCount ? ' · ' + turnCount + ' 轮' : ' · 暂无记录' }}</span></span>
        <span class="uni-chat-history-accessory">仅保存在本机 <AppleIcon name="chevronRight" :size="14" /></span>
      </button>
    </div>

    <div ref="messageList" class="scroll uni-chat-page" @scroll.passive="onListScroll">
      <!-- 空态：把建议当成"能聊什么"的说明，而不是一排功能按钮 -->
      <div v-if="historyReady && !messages.length" class="uni-chat-intro">
        <div class="uni-chat-intro-head"><AppleIcon name="star" :size="26" /></div>
        <div class="uni-chat-intro-title">我是 Uni</div>
        <div class="uni-chat-intro-sub">问课程安排、查记事、看天气；也可以直接说说准备做什么，我帮你理一理。</div>
        <div class="uni-chat-sugs">
          <button v-for="item in examples" :key="item.label" class="uni-chat-sug" :disabled="loading" @click="send(item.ask)">
            <AppleIcon :name="item.icon" :size="15" /><span>{{ item.label }}</span>
          </button>
        </div>
      </div>

      <!-- 有过对话：建议收成一行小 chip，把主视觉让给对话本身 -->
      <div v-else class="chips uni-chat-examples">
        <button v-for="item in examples.slice(0, 3)" :key="item.label" class="chip sm" :disabled="loading" @click="send(item.ask)">{{ item.label }}</button>
      </div>

      <section class="uni-chat-list" aria-live="polite">
      <div v-if="!historyReady" class="empty small">正在读取本机历史记录…</div>
      <template v-for="entry in chatEntries" :key="entry.message.id">
        <div v-if="entry.newDay" class="uni-chat-day"><span>{{ dayLabel(entry.message.createdAt) }}</span></div>
        <article class="uni-chat-message" :class="['uni-chat-' + entry.message.role, { 'uni-chat-group-start': entry.newGroup }]" :data-mid="entry.message.id">
          <div v-if="entry.newGroup" class="uni-chat-avatar" aria-hidden="true">
            <AppleIcon v-if="entry.message.role === 'assistant'" name="moon" :size="17" />
            <span v-else>我</span>
          </div>
          <div v-else class="uni-chat-avatar uni-chat-avatar-ghost" aria-hidden="true"></div>
          <div class="uni-chat-col">
            <div class="uni-chat-bubble">
              <!-- 助手回复：Markdown 走结构化渲染（不产生 HTML 字符串，见 services/markdown.ts） -->
              <MarkdownText v-if="entry.message.role === 'assistant' && richReply(entry.message.content)" :text="entry.message.content" />
              <div v-else class="uni-chat-content">{{ entry.message.content }}</div>
              <div v-if="entry.message.cards.length" class="uni-chat-cards">
                <button v-for="(card, index) in entry.message.cards" :key="card.type + index" class="uni-chat-action" :disabled="card.operation === 'none'" @click="runCard(card)">
                  <span class="grow"><b>{{ card.title }}</b><small v-if="cardTime(card)">{{ cardTime(card) }}</small></span><span v-if="card.operation !== 'none'">执行 →</span>
                </button>
              </div>
              <details v-if="entry.message.explain.length" class="uni-chat-explain"><summary>查看回答依据</summary><div v-for="line in entry.message.explain" :key="line">· {{ line }}</div></details>
            </div>
            <!-- 行动栏：只在需要时出现，平时安静（复制是高频操作；重新生成只给最后一条） -->
            <div class="uni-chat-tools">
              <button class="uni-chat-tool" type="button" :aria-label="copiedId === entry.message.id ? '已复制' : '复制'" @click="copyMessage(entry.message)">
                {{ copiedId === entry.message.id ? '已复制' : '复制' }}
              </button>
              <button v-if="entry.message.role === 'assistant' && entry.isLast && !loading" class="uni-chat-tool" type="button" aria-label="重新生成" @click="regenerate(entry.index)">重新生成</button>
              <span class="uni-chat-stamp">
                <span v-if="entry.message.source" class="uni-chat-source">{{ entry.message.source === 'ai' ? 'Workers AI' : '本机 Tool' }}</span>
                <time :datetime="new Date(entry.message.createdAt).toISOString()">{{ clockText(entry.message.createdAt) }}</time>
              </span>
            </div>
          </div>
        </article>
      </template>
      <div v-if="loading" class="uni-chat-message uni-chat-assistant uni-chat-group-start">
        <div class="uni-chat-avatar" aria-hidden="true"><AppleIcon name="moon" :size="17" /></div>
        <div class="uni-chat-bubble uni-chat-loading"><span class="uni-chat-dots"><i></i><i></i><i></i></span></div>
      </div>
    </section>

    <!-- 不在底部时冒出来，避免自动滚动把正在往上读的用户拽走 -->
    <button v-if="!atBottom && messages.length" class="uni-chat-tobottom" type="button" @click="scrollToBottom(true)">
      回到最新 <AppleIcon name="chevronRight" :size="13" />
    </button>

    <div v-if="errorText" ref="errorBox" class="uni-chat-error" role="alert">
      <div>{{ errorText }}</div>
      <button class="uni-chat-offline" type="button" @click="send('下一节什么课')">试试离线查课</button>
    </div>
    <form class="uni-chat-compose" @submit.prevent="send()">
      <input ref="composerInput" v-model="text" maxlength="500" enterkeyhint="send" placeholder="和 Uni 说点什么…" :disabled="loading || !historyReady" />
      <button class="btn" type="submit" :disabled="!text.trim() || loading || !historyReady">发送</button>
    </form>

    <div v-if="showHistory" class="uni-history-mask" @click.self="showHistory = false">
      <section class="uni-history-sheet" role="dialog" aria-modal="true" aria-label="Uni 历史记录">
        <header class="uni-history-head">
          <div class="uni-history-titles"><b>历史对话</b><small>仅保存在本机 · {{ turnCount }} 轮 · {{ messages.length }} 条消息</small></div>
          <button type="button" class="uni-history-done" @click="showHistory = false">完成</button>
        </header>

        <div v-if="turnCount" class="uni-history-search">
          <AppleIcon name="compass" :size="14" />
          <input v-model="historyQuery" placeholder="搜索问过什么…" enterkeyhint="search" />
          <button v-if="historyQuery" type="button" @click="historyQuery = ''">清空</button>
        </div>

        <div v-if="!messages.length" class="empty small">暂无历史记录</div>
        <div v-else-if="!historyGroups.length" class="empty small">没有匹配「{{ historyQuery }}」的对话</div>
        <div v-else class="uni-history-list">
          <div v-for="group in historyGroups" :key="group.label" class="uni-history-group">
            <div class="uni-history-day">{{ group.label }}</div>
            <article v-for="turn in group.turns" :key="'turn-' + turn.key" class="uni-history-turn">
              <button class="uni-history-main" type="button" @click="jumpTo(turn.anchorId)">
                <span class="uni-history-q">{{ turn.question }}</span>
                <span v-if="turn.answer" class="uni-history-a">{{ turn.answer }}</span>
                <span v-else class="uni-history-a uni-history-a-empty">（这一轮还没有回答）</span>
                <span class="uni-history-flags">
                  <span class="uni-history-flag">回复 {{ turn.answer.length }} 字</span>
                  <span v-if="turn.cards" class="uni-history-flag">{{ turn.cards }} 个动作</span>
                  <span class="uni-history-flag">{{ turnTime(turn.createdAt) }}</span>
                </span>
              </button>
              <button class="uni-history-again" type="button" aria-label="再问一次" @click="askAgain(turn)">再问</button>
            </article>
          </div>
        </div>

        <footer v-if="turnCount" class="uni-history-foot">
          <button class="uni-history-clear" type="button" @click="clearHistory">清空历史</button>
        </footer>
      </section>
    </div>
    </div>
  </div>
</template>

<style scoped>
/* ---- 顶部历史入口 ----
 * 【v2.76 结构性修正：这才是前四轮"钉不住"的真正原因】
 *
 * 前四轮（v2.72~v2.75）历史入口都放在 `.uni-chat-page` **内部**，我在那里反复调
 * 底色 / 边框 / 负边距 / z-index。Playwright 真机实测（量 getBoundingClientRect）证明：
 *
 *     滚动 500px 后 →  .head.top = 0（稳如磐石）
 *                      .uni-chat-history.top = **-434**（跟着内容滚走了）
 *
 * 也就是说这条**从来没有真的 sticky 过**；未滚动时看起来"贴住了"，
 * 只是因为它的自然位置恰好就在标题栏下面 —— 一旦滚动立刻露馅。
 *
 * 原因是 CSS 规范里 sticky 的两条约束，`.uni-chat-page` 同时踩中：
 *   1) **祖先只要有 overflow 就算约束容器**。`.uni-chat-page` 带全局 `.scroll` 的
 *      `overflow-y: auto`，sticky 子元素只能在它的**高度范围**内吸附；这个容器整体
 *      滚出视口时，子元素跟着一起走 —— 吸附完全失效。
 *   2) 真正在滚的是 **`<html>`**。`.screen` 是 `min-height: 100%` 而不是 `height: 100%`，
 *      `.scroll { flex: 1 }` 因此拿不到确定高度 → 自己永远不滚（clientHeight === scrollHeight），
 *      只被内容撑开，最后交给页面级滚动兜底。`.head` 一直是好使的，正因为它
 *      **不在 `.uni-chat-page` 里**、直接受 `<html>` 约束。
 *
 * 所以修法不是调样式，而是**改层级**：把历史入口挪出 `.uni-chat-page`，与 `.head` 做兄弟。
 * 外面再包一层 `.uni-chat-wrap` 当根节点（SFC 只能有一个根），它自己不滚动、不裁剪
 * （overflow: visible），确保 sticky 的约束祖先仍然是 `<html>`。
 *
 * 职责仍归 UniView（**没有**塞进 Main.vue 的 `.head`），只是从"页内元素"提成"页同级元素"。
 *
 * 【sticky top 取多少】
 * 吸附目标是「`<head>` 的下沿」，所以 `top` 必须等于 `.head` 的实际高度。
 * `.head` 高度会随页签变化（课表页多了 .sheetbar），写死数字会在别的页签错位；
 * 因此由脚本挂载时量一次、写进 `--unih-head`（见 onMounted 的 syncHeadHeight），
 * 这里只做兜底默认值。若取不到（极早期/测试环境），退化成 0 —— 顶到视口最上沿，
 * 至少不会浮在半空。
 *
 * 其余从未变、也别改回去的：
 *   - 底色**不透明**的 var(--bg)：sticky 元素背后会有内容滚过去，透明/毛玻璃会糊成一团；
 *   - 下边框作为"标题栏到此为止"的分界；
 *   - z-index 41：高于 `.head`(30) 才盖得住，但低于 compose(42)/回到最新(43)/历史面板(90)。
 */
/*
 * 兜底声明：`--unih-head` 正常由脚本挂载时量出来、以 inline style 写到这个元素上
 * （见 syncHeadHeight）。这里给一个静态默认值，作用有两个：
 *   1) JS 未跑起来（极早期 / 测试环境）时 `.uni-chat-history` 的 top 也有确定值，不会变 NaN；
 *   2) `test:css` 的「没有未定义的 CSS 变量」扫描器只认 CSS 里的 `--x:` 声明，
 *      不认 `var()` 的兜底参数 —— 不写这一行就会被判成"未定义变量"（v2.76 踩过）。
 * inline style 优先级高于本类，所以真机量到的高度照样生效，这里只是默认。
 */
.uni-chat-wrap { display: flex; flex-direction: column; --unih-head: 0px; }
.uni-chat-page { padding-bottom: calc(154px + var(--safe-b)); }
.uni-chat-history {
  position: sticky; top: var(--unih-head, 0px); z-index: 41;
  min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 10px;
  margin: 0 -16px 10px; padding: 0 16px;
  color: var(--muted); font-size: 11px; text-align: left;
  background: var(--bg); border-bottom: 1px solid var(--line);
}
/*
 * 内层：v2.75 起不再是"一张带边框的卡"——那样看起来跟标题栏是两截。
 * 改成**透明 + 无边框**，只保留按下反馈，让它读起来就是标题栏下面的一行。
 * （外层已经给了底色与下边框的分界，这里再加边框会显得脏。）
 */
.uni-chat-history-in { width: 100%; min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 4px; background: transparent; border: none; font-family: inherit; cursor: pointer; }
.uni-chat-history-in:active { opacity: .6; }
.uni-chat-history-title, .uni-chat-history-accessory { display: flex; align-items: center; gap: 5px; }
.uni-chat-history-title { color: var(--brand); }
.uni-chat-history b { color: var(--text); font-size: 13px; font-weight: 600; }
.uni-chat-history-accessory { flex: none; }
.uni-chat-examples { margin-bottom: 10px; }

/* ---- 空态：第一次进来先告诉用户"我能做什么" ---- */
.uni-chat-intro { padding: 22px 4px 18px; text-align: center; }
.uni-chat-intro-head { display: flex; justify-content: center; margin-bottom: 10px; color: var(--brand); }
.uni-chat-intro-title { font-size: 19px; font-weight: 600; letter-spacing: -.2px; }
.uni-chat-intro-sub { margin: 7px auto 0; max-width: 21em; color: var(--muted); font-size: 13px; line-height: 1.62; }
.uni-chat-sugs { display: grid; gap: 8px; margin-top: 18px; text-align: left; }
.uni-chat-sug { display: flex; align-items: center; gap: 10px; min-height: 46px; padding: 0 14px; color: var(--text); font-size: 14px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; }
.uni-chat-sug:active { background: var(--pressed); }
.uni-chat-sug svg { flex: none; color: var(--brand); }

/* ---- 对话流 ----
 * 【v2.73：底部空白】`.uni-chat-list` 以前自带 padding-bottom: 118px，而外层 `.uni-chat-page`
 * 还有 154px —— 两段叠起来 272px，短对话下面就是一大片空白（真机图三）。
 * 现在**只保留外层那一段**（输入框是 fixed 的，需要让出它的高度），
 * 内层只留一点收尾间距；并且用 :has 让"最后一条消息"之后不再多顶一段。
 */
.uni-chat-list { display: grid; gap: 4px; padding: 2px 2px 8px; align-content: start; }
.uni-chat-day { display: flex; align-items: center; justify-content: center; margin: 12px 0 8px; }
.uni-chat-day span { padding: 3px 10px; color: var(--muted); font-size: 11px; background: var(--soft); border-radius: 999px; }
.uni-chat-message { display: flex; align-items: flex-start; gap: 8px; margin-top: 2px; }
.uni-chat-group-start { margin-top: 12px; }
.uni-chat-user { flex-direction: row-reverse; }
.uni-chat-avatar { width: 30px; height: 30px; flex: none; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: var(--brand); background: var(--tint); font-size: 11px; font-weight: 600; }
.uni-chat-assistant .uni-chat-avatar { color: #fff; background: linear-gradient(135deg, var(--brand), #7868ff); }
.uni-chat-avatar-ghost { background: transparent; }
/*
 * 气泡外面多包一层 .uni-chat-col：气泡自己控宽度，行动栏跟着气泡走。
 * 用户的一侧要右对齐，所以这里也要跟着翻转。
 */
.uni-chat-col { min-width: 0; max-width: calc(100% - 38px); display: flex; flex-direction: column; align-items: flex-start; }
.uni-chat-user .uni-chat-col { align-items: flex-end; }
/*
 * 【v2.70 可读性】气泡宽度从 80% 提到 88%，并给助手回复放开到 100%。
 * 真机截图里长回答被挤在窄栏里、一行只有十来个字，读起来非常累 ——
 * 助手的长文本本来就是主体内容，不该和短消息共用那么小的宽度。
 */
.uni-chat-bubble { max-width: 100%; padding: 10px 13px; border-radius: 17px; background: var(--card); border: 1px solid var(--line); }
.uni-chat-user .uni-chat-bubble { color: #fff; background: var(--brand); border-color: var(--brand); }
.uni-chat-group-start.uni-chat-assistant .uni-chat-bubble { border-top-left-radius: 6px; }
.uni-chat-group-start.uni-chat-user .uni-chat-bubble { border-top-right-radius: 6px; }
.uni-chat-content { white-space: pre-wrap; line-height: 1.68; word-break: break-word; }

/* ---- 行动栏：复制 / 重新生成 / 时间 · 来源 ---- */
.uni-chat-tools { display: flex; align-items: center; gap: 6px; margin-top: 3px; padding: 0 2px; opacity: .72; transition: opacity .18s; }
.uni-chat-user .uni-chat-tools { flex-direction: row-reverse; }
.uni-chat-tool { padding: 3px 7px; color: var(--muted); font-size: 11px; border-radius: 7px; }
.uni-chat-tool:active { background: var(--pressed); color: var(--text); }
.uni-chat-stamp { display: flex; align-items: center; gap: 5px; margin-left: 2px; color: var(--muted); font-size: 10px; }
.uni-chat-source { display: inline-block; }

.uni-chat-loading { display: flex; align-items: center; min-height: 38px; color: var(--muted); }
.uni-chat-dots { display: inline-flex; gap: 4px; }
.uni-chat-dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); opacity: .5; animation: uni-chat-dot 1.1s ease-in-out infinite; }
.uni-chat-dots i:nth-child(2) { animation-delay: .15s; }
.uni-chat-dots i:nth-child(3) { animation-delay: .3s; }
@keyframes uni-chat-dot { 0%, 100% { opacity: .3; transform: translateY(0); } 50% { opacity: .95; transform: translateY(-3px); } }
@media (prefers-reduced-motion: reduce) { .uni-chat-dots i { animation: none; opacity: .6; } }

/* ---- 回到最新 ---- */
.uni-chat-tobottom { position: fixed; z-index: 43; right: 16px; bottom: calc(132px + var(--safe-b)); display: flex; align-items: center; gap: 3px; min-height: 34px; padding: 0 12px; color: #fff; font-size: 12px; background: var(--brand); border-radius: 999px; box-shadow: 0 5px 16px rgba(44, 111, 224, .32); }
.uni-chat-tobottom svg { transform: rotate(90deg); }

.uni-chat-error { margin-top: 10px; padding: 9px 11px; border-radius: 10px; color: #b42318; background: #fff0ee; }
.uni-chat-offline { margin-top: 7px; padding: 5px 9px; border: 1px solid currentColor; border-radius: 8px; color: inherit; background: transparent; }
.uni-chat-cards { display: grid; gap: 7px; margin-top: 9px; }
.uni-chat-action { width: 100%; padding: 8px; display: flex; gap: 8px; text-align: left; color: var(--brand); background: var(--card); border: 1px solid var(--line); border-radius: 9px; }
.uni-chat-action b, .uni-chat-action small { display: block; color: var(--text); }
.uni-chat-explain { margin-top: 8px; color: var(--muted); font-size: 12px; }

/* ---- 输入区 ---- */
.uni-chat-compose { position: fixed; z-index: 42; left: 12px; right: 12px; bottom: calc(70px + var(--safe-b)); display: flex; gap: 8px; padding: 8px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); box-shadow: 0 6px 18px rgba(20,30,60,.14); }
.uni-chat-compose input { min-width: 0; flex: 1; border: 0; outline: 0; padding: 0 6px; color: var(--text); background: transparent; }
.uni-chat-compose .btn { min-height: 40px; padding: 0 14px; }

/* ---- 历史面板 ---- */
.uni-history-mask { position: fixed; z-index: 90; inset: 0; display: flex; align-items: flex-end; padding: 12px 12px calc(12px + var(--safe-b)); background: rgba(0,0,0,.32); }
.uni-history-sheet { width: 100%; max-height: 82vh; display: flex; flex-direction: column; padding: 16px 16px 10px; background: var(--card); border-radius: 18px; box-shadow: 0 16px 44px rgba(0,0,0,.22); }
.uni-history-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.uni-history-titles b, .uni-history-titles small { display: block; }
.uni-history-titles b { font-size: 17px; color: var(--text); }
.uni-history-titles small { margin-top: 2px; color: var(--muted); font-size: 11px; }
.uni-history-done { flex: none; padding: 5px 4px; color: var(--brand); font-size: 15px; }

.uni-history-search { display: flex; align-items: center; gap: 7px; margin: 12px 0 4px; padding: 0 11px; min-height: 40px; background: var(--field); border-radius: 11px; }
.uni-history-search svg { flex: none; color: var(--muted); }
.uni-history-search input { min-width: 0; flex: 1; border: 0; outline: 0; color: var(--text); background: transparent; font-size: 14px; }
.uni-history-search button { flex: none; color: var(--brand); font-size: 12px; }

.uni-history-list { flex: 1; overflow: auto; display: grid; gap: 6px; padding-bottom: 6px; }
.uni-history-group { display: grid; gap: 6px; }
.uni-history-day { position: sticky; top: 0; z-index: 1; padding: 8px 2px 4px; color: var(--muted); font-size: 11px; background: var(--card); }
/* 一轮对话 = 主按钮（问题 + 回答预览 + 标记） + 「再问」副按钮 */
.uni-history-turn { display: flex; align-items: stretch; gap: 6px; }
.uni-history-main { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; text-align: left; background: var(--soft); border-radius: 12px; }
.uni-history-main:active { background: var(--pressed); }
.uni-history-q { color: var(--text); font-size: 14px; font-weight: 600; line-height: 1.45; }
.uni-history-a { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--muted); font-size: 12.5px; line-height: 1.55; }
.uni-history-a-empty { font-style: italic; opacity: .8; }
.uni-history-flags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 3px; }
.uni-history-flag { padding: 1px 7px; color: var(--muted); font-size: 10px; background: var(--card); border-radius: 999px; }
.uni-history-again { flex: none; width: 44px; color: var(--brand); font-size: 12px; background: var(--soft); border-radius: 12px; }
.uni-history-again:active { background: var(--pressed); }

.uni-history-foot { padding-top: 8px; border-top: 1px solid var(--line); }
.uni-history-clear { width: 100%; min-height: 42px; color: var(--danger); font-size: 14px; }
</style>
