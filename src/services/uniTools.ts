import { askUniLocal, actionTimeToNoteStamp, deviceTimezone, type UniLocalSnapshot } from './uniAssistant.ts';
import type { AgentTool, AgentToolResult, PreparedToolAction } from './agentCore.ts';
import type { AgentDecision, AgentPlanRequest, AgentPlanner, ToolDefinition } from './aiProvider.ts';
import { detectCapability, detectIntent, resolveTime } from '../../p5-assistant/n8n/core/uni-core.ts';

export type AgentFeature = 'schedule' | 'notes' | 'weather' | 'settings' | 'secondClass' | 'online';

export interface StudentNoteSummary {
  id: string;
  title: string;
  remindAt: string;
  done: boolean;
}

export interface StudentWeatherSnapshot {
  enabled: boolean;
  summary: string;
  location?: string;
  updatedAt?: number;
  status?: string;
}

export interface StudentNoteInput {
  title: string;
  content: string;
  remindAt: string;
}

/**
 * Tool Layer 面向 App 的唯一端口。具体 Pinia store、文件落盘和页面跳转都留在 Adapter 中，
 * Agent Core、Workers AI 与 UI Adapter 不会 import 数据库或 Android UI。
 */
export interface StudentAgentPort {
  scheduleSnapshot(): UniLocalSnapshot;
  notes(): readonly StudentNoteSummary[];
  addNote(input: StudentNoteInput): Promise<{ id: string; saved: boolean }>;
  weather(refresh: boolean): Promise<StudentWeatherSnapshot>;
  openFeature(feature: AgentFeature): Promise<void> | void;
}

const SCHEDULE_QUERIES = ['next', 'today', 'tomorrow', 'week', 'free', 'conflicts', 'brief'] as const;
type ScheduleQuery = typeof SCHEDULE_QUERIES[number];

const definitions: Record<string, ToolDefinition> = {
  getSchedule: {
    name: 'getSchedule',
    description: '查询本机课表：下一节、今天、明天、本周、空档、冲突或每日简报。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        query: { type: 'string', enum: [...SCHEDULE_QUERIES] },
        date: { type: 'string', description: '可选，YYYY-MM-DD' }
      },
      required: ['query']
    }
  },
  getNote: {
    name: 'getNote',
    description: '查询本机未删除的记事和待办，可按关键词筛选。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { keyword: { type: 'string' }, includeDone: { type: 'boolean' } }
    }
  },
  addNote: {
    name: 'addNote',
    description: '在本机新增一条不带提醒时间的记事。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { title: { type: 'string' }, content: { type: 'string' } },
      required: ['title']
    }
  },
  createReminder: {
    name: 'createReminder',
    description: '在本机新增一条带明确提醒时间的记事。remindAt 必须是可解析的 ISO 8601 时间。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { title: { type: 'string' }, content: { type: 'string' }, remindAt: { type: 'string' } },
      required: ['title', 'remindAt']
    }
  },
  getWeather: {
    name: 'getWeather',
    description: '读取本机缓存天气；refresh=true 时按 App 现有开关和节流规则尝试更新。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { refresh: { type: 'boolean' } }
    }
  },
  openFeature: {
    name: 'openFeature',
    description: '打开 App 内的课表、记事本、我的页面（含天气与设置入口）、第二课堂或校园在线页面。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { feature: { type: 'string', enum: ['schedule', 'notes', 'weather', 'settings', 'secondClass', 'online'] } },
      required: ['feature']
    }
  }
};

export function createStudentTools(port: StudentAgentPort): AgentTool[] {
  return [
    tool(definitions.getSchedule!, async (raw) => {
      const args = objectArgs(raw);
      const query = enumArg(args, 'query', SCHEDULE_QUERIES);
      const date = optionalDateArg(args, 'date');
      const prompt = schedulePrompt(query, date);
      return immediate('read', async () => {
        const answer = askUniLocal(port.scheduleSnapshot(), prompt);
        return {
          content: answer.response.answer, source: 'local_rule',
          cards: answer.response.cards, explain: answer.response.explain
        };
      });
    }),
    tool(definitions.getNote!, async (raw) => {
      const args = objectArgs(raw);
      const keyword = optionalStringArg(args, 'keyword', 80).toLowerCase();
      const includeDone = optionalBooleanArg(args, 'includeDone');
      return immediate('read', async () => noteResult(port.notes(), keyword, includeDone));
    }),
    tool(definitions.addNote!, async (raw) => {
      const args = objectArgs(raw);
      const title = stringArg(args, 'title', 120);
      const content = optionalStringArg(args, 'content', 2000);
      return immediate('write', async () => saveNote(port, { title, content, remindAt: '' }));
    }),
    tool(definitions.createReminder!, async (raw) => {
      const args = objectArgs(raw);
      const title = stringArg(args, 'title', 120);
      const content = optionalStringArg(args, 'content', 2000);
      const remindAt = stringArg(args, 'remindAt', 80);
      if (!Number.isFinite(new Date(remindAt).getTime())) throw new Error('提醒时间格式无效');
      return immediate('write', async () => saveNote(port, { title, content, remindAt }));
    }),
    tool(definitions.getWeather!, async (raw) => {
      const args = objectArgs(raw);
      const refresh = optionalBooleanArg(args, 'refresh');
      return immediate('read', async () => {
        const weather = await port.weather(refresh);
        if (!weather.enabled) return { content: '天气功能当前关闭。可让我打开天气设置。', source: 'tool' };
        const detail = [weather.summary, weather.location, weather.status].filter(Boolean).join(' · ');
        return { content: detail || '本机还没有天气数据，请稍后再试。', source: 'tool' };
      });
    }),
    tool(definitions.openFeature!, async (raw) => {
      const args = objectArgs(raw);
      const feature = enumArg(args, 'feature', ['schedule', 'notes', 'weather', 'settings', 'secondClass', 'online'] as const);
      return immediate('read', async () => {
        await port.openFeature(feature);
        return { content: '已打开' + featureLabel(feature) + '。', source: 'tool' };
      });
    })
  ];
}

/** Offline Mode：只做确定性意图识别，输出与 Workers AI 完全相同的结构化 Tool Call。 */
export class LocalRulePlanner implements AgentPlanner {
  async plan(request: AgentPlanRequest): Promise<AgentDecision | null> {
    const message = request.messages.at(-1)?.content.trim() || '';
    if (!message) return null;

    const pendingNote = pendingLocalNote(request.messages);
    if (pendingNote && isNoteConfirmation(message)) return call(pendingNote.name, pendingNote.args);
    if (pendingNote && isNoteDecline(message)) return localMessage('好的，不加入记事本。');

    if (/^(?:你好|您好|嗨|hi|hello|在吗|你是谁)[!！?？。]*$/i.test(message)) {
      return localMessage('你好，我是 Uni。你可以问课表、记事、天气，也可以直接说准备做什么。');
    }
    if (/^(?:谢谢|感谢|多谢|辛苦了|好的|好|知道了|明白了)[!！。]*$/.test(message)) {
      return localMessage('不客气，有需要继续告诉我。');
    }
    if (/(?:你会什么|你能做什么|有什么功能|怎么用你)/.test(message)) {
      return localMessage('我可以帮你查课表、查记事、看天气、打开 App 功能，也能在你提到待办时先询问是否加入记事本。');
    }

    const meal = mealSuggestion(message);
    if (meal) return localMessage(meal);

    const open = parseOpenFeature(message);
    if (open) return call('openFeature', { feature: open });

    const localNote = parseLocalNote(message);
    if (localNote) return noteProposal(String(localNote.args.title || ''));

    if (/天气|气温|下雨|带伞/.test(message)) return call('getWeather', { refresh: /更新|刷新|现在/.test(message) });
    if (/(记事|笔记|待办)/.test(message)) {
      const matchedKeyword = message.match(/(?:找|查|搜索)(?:一下)?[「“\"]?([^」”\"]{1,40})/)?.[1]?.trim();
      const keyword = matchedKeyword && !/^(记事本?|笔记本?|待办(?:事项)?)$/.test(matchedKeyword) ? matchedKeyword : '';
      return call('getNote', { ...(keyword ? { keyword } : {}), includeDone: /全部|已完成/.test(message) });
    }

    const normalized = message.replace(/\s+/g, '');
    const { intent } = detectIntent(normalized);
    const capability = detectCapability(normalized, intent);
    if (capability && capability !== 'note_draft') {
      const query = capabilityToQuery(capability);
      if (query) {
        const date = resolveTime(normalized, deviceTimezone(), new Date()).date;
        return call('getSchedule', { query, ...(date ? { date } : {}) });
      }
    }

    const plannedNote = plannedNoteTitle(message);
    if (plannedNote) return noteProposal(plannedNote);
    return null;
  }
}

type LocalNoteCall = { name: 'addNote' | 'createReminder'; args: Record<string, unknown> };

function localMessage(content: string): AgentDecision {
  return { type: 'message', content, source: 'local_rule' };
}

function noteProposal(title: string): AgentDecision {
  const cleaned = cleanNoteTitle(title);
  return localMessage(`要把“${cleaned}”加入记事本吗？回复“是”确认，回复“否”取消。`);
}

function pendingLocalNote(messages: AgentPlanRequest['messages']): LocalNoteCall | null {
  if (messages.length < 3) return null;
  const assistant = messages.at(-2);
  const original = messages.at(-3);
  if (assistant?.role !== 'assistant' || original?.role !== 'user') return null;
  const title = assistant.content.match(/^要把“([\s\S]{1,120})”加入记事本吗？回复“是”确认，回复“否”取消。$/)?.[1];
  if (!title) return null;
  const cleaned = cleanNoteTitle(title);
  const explicit = parseLocalNote(original.content);
  if (explicit && cleanNoteTitle(String(explicit.args.title || '')) === cleaned) return explicit;
  const planned = plannedNoteTitle(original.content);
  return planned === cleaned ? { name: 'addNote', args: { title: planned } } : null;
}

function isNoteConfirmation(message: string): boolean {
  return /^(?:是|好的?|好啊|可以|行|要|加入|确认|嗯+|对)(?:吧|的)?[。！!]*$/.test(message);
}

function isNoteDecline(message: string): boolean {
  return /^(?:不|不要|不用|不加|否|算了|取消)(?:了)?[。！!]*$/.test(message);
}

function plannedNoteTitle(message: string): string {
  const normalized = cleanNoteTitle(message);
  if (!normalized) return '';
  const action = /交|提交|完成|学习|复习|预习|写|做|准备|开会|报名|缴费|考试|答辩|汇报|联系|回复|发送|打印|预约|打卡|跑步|健身|买|取|拿|还|去/;
  const stated = normalized.match(/^(?:我)?(?:要|得|需要|准备|打算|计划|记得|别忘了)([\s\S]+)$/)?.[1]?.trim();
  if (stated && action.test(stated)) return cleanNoteTitle(stated);
  const hasTime = /今天|明天|后天|大后天|上午|中午|下午|晚上|今晚|周[一二三四五六日天]|星期[一二三四五六日天]|下周|月底|\d{1,2}月\d{1,2}日|\d{1,2}[点时]/.test(normalized);
  return hasTime && action.test(normalized) ? normalized : '';
}

function cleanNoteTitle(value: string): string {
  return String(value || '').trim().replace(/[。！？!?；;]+$/, '').trim().slice(0, 120);
}

function mealSuggestion(message: string): string {
  const normalized = message.replace(/\s+/g, '');
  const asksMeal = /(?:早餐|早饭|早上|中午|午饭|午餐|晚饭|晚餐|晚上).*(?:吃什么|吃啥|吃点什么|吃点啥|推荐吃)/.test(normalized)
    || /(?:吃什么|吃啥|吃点什么|吃点啥).*(?:早餐|早饭|中午|午饭|午餐|晚饭|晚餐)/.test(normalized);
  if (!asksMeal) return '';
  if (/早餐|早饭|早上/.test(normalized)) {
    return '早餐可以选一份主食加蛋白质：包子或全麦面包，配鸡蛋和牛奶；赶时间就在食堂拿豆浆、鸡蛋和一个包子。';
  }
  if (/晚饭|晚餐|晚上/.test(normalized)) {
    return '晚饭想轻松一点，可以去食堂选一份蔬菜、一份蛋白质和半份主食；如果今天运动量大，再加一份米饭或面。';
  }
  return '中午可以去食堂选“两份蔬菜 + 一份肉或豆制品 + 一份主食”。赶时间选盖饭或面，想清淡就选汤面、麻辣烫少油版，实在纠结就吃今天排队人数最多的窗口。';
}

function tool(definition: ToolDefinition, prepare: (args: unknown) => Promise<PreparedToolAction>): AgentTool {
  return { definition, prepare };
}

async function immediate(risk: 'read' | 'write', run: () => Promise<AgentToolResult>): Promise<PreparedToolAction> {
  return { risk, run };
}

function call(name: string, args: Record<string, unknown>): AgentDecision {
  return { type: 'tool_call', call: { id: 'local-' + Date.now(), name, arguments: args } };
}

function objectArgs(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Tool 参数必须是 JSON 对象');
  return raw as Record<string, unknown>;
}

function stringArg(args: Record<string, unknown>, key: string, max: number): string {
  const value = typeof args[key] === 'string' ? args[key].trim() : '';
  if (!value) throw new Error('Tool 参数缺少 ' + key);
  if (value.length > max) throw new Error('Tool 参数 ' + key + ' 过长');
  return value;
}

function optionalStringArg(args: Record<string, unknown>, key: string, max: number): string {
  if (args[key] == null) return '';
  if (typeof args[key] !== 'string') throw new Error('Tool 参数 ' + key + ' 必须是字符串');
  const value = args[key].trim();
  if (value.length > max) throw new Error('Tool 参数 ' + key + ' 过长');
  return value;
}

function optionalBooleanArg(args: Record<string, unknown>, key: string): boolean {
  if (args[key] == null) return false;
  if (typeof args[key] !== 'boolean') throw new Error('Tool 参数 ' + key + ' 必须是布尔值');
  return args[key];
}

function enumArg<T extends string>(args: Record<string, unknown>, key: string, values: readonly T[]): T {
  const value = stringArg(args, key, 80) as T;
  if (!values.includes(value)) throw new Error('Tool 参数 ' + key + ' 不在允许范围内');
  return value;
}

function optionalDateArg(args: Record<string, unknown>, key: string): string {
  const value = optionalStringArg(args, key, 10);
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Tool 日期必须是 YYYY-MM-DD');
  return value;
}

function schedulePrompt(query: ScheduleQuery, date: string): string {
  const when = date || (query === 'tomorrow' ? '明天' : '今天');
  if (query === 'next') return '下一节什么课';
  if (query === 'week') return '这周有几节课';
  if (query === 'free') return when + '有什么空档';
  if (query === 'conflicts') return when + '有课表冲突吗';
  if (query === 'brief') return when + '的每日简报';
  return when + '有什么安排';
}

function noteResult(notes: readonly StudentNoteSummary[], keyword: string, includeDone: boolean): AgentToolResult {
  const filtered = notes.filter((note) => (includeDone || !note.done) && (!keyword || note.title.toLowerCase().includes(keyword)));
  if (!filtered.length) return { content: keyword ? '没有找到匹配的记事。' : '当前没有未完成记事。', source: 'tool' };
  const shown = filtered.slice(0, 8).map((note, index) => `${index + 1}. ${note.title}${note.remindAt ? ' · ' + note.remindAt.slice(5, 16) : ''}`);
  return {
    content: `找到 ${filtered.length} 条记事：\n` + shown.join('\n') + (filtered.length > shown.length ? `\n另有 ${filtered.length - shown.length} 条未展开。` : ''),
    source: 'tool'
  };
}

async function saveNote(port: StudentAgentPort, input: StudentNoteInput): Promise<AgentToolResult> {
  const remindAt = input.remindAt
    ? actionTimeToNoteStamp({ type: 'note_draft', title: input.title, time: input.remindAt, operation: 'none', requiresConfirmation: false, noteDraft: { title: input.title, remindAt: input.remindAt } }, deviceTimezone())
    : '';
  if (input.remindAt && !remindAt) throw new Error('提醒时间无法转换为本机时间');
  const saved = await port.addNote({ ...input, remindAt });
  const suffix = remindAt ? `，提醒时间 ${remindAt.slice(5, 16)}` : '';
  return {
    content: `已添加记事「${input.title}」${suffix}${saved.saved ? '。' : '，但保存超时，请稍后重试。'}`,
    source: 'tool'
  };
}

function parseLocalNote(message: string): { name: 'addNote' | 'createReminder'; args: Record<string, unknown> } | null {
  if (!/(记一下|记下|帮我记|加个记事|添加记事|新建记事|提醒我)/.test(message)) return null;
  const parsed = askUniLocal({ activeTimetable: null, courses: [], notes: [], periodTimes: [] }, message);
  const draft = parsed.response.cards.find((card) => card.noteDraft)?.noteDraft;
  if (!draft?.title) return null;
  if (draft.remindAt) return { name: 'createReminder', args: { title: draft.title, remindAt: draft.remindAt } };
  return { name: 'addNote', args: { title: draft.title } };
}

function parseOpenFeature(message: string): AgentFeature | null {
  if (!/(打开|进入|跳到|去)/.test(message)) return null;
  if (/记事|笔记|待办/.test(message)) return 'notes';
  if (/课表|课程/.test(message)) return 'schedule';
  if (/天气/.test(message)) return 'weather';
  if (/第二课堂|活动材料/.test(message)) return 'secondClass';
  if (/校园在线|北化通|校园服务/.test(message)) return 'online';
  if (/设置|我的/.test(message)) return 'settings';
  return null;
}

function capabilityToQuery(capability: string): ScheduleQuery | null {
  if (capability === 'next_class') return 'next';
  if (capability === 'week_plan') return 'week';
  if (capability === 'availability') return 'free';
  if (capability === 'conflict') return 'conflicts';
  if (capability === 'daily_brief') return 'brief';
  if (capability === 'today_plan') return 'today';
  return null;
}

function featureLabel(feature: AgentFeature): string {
  return ({
    schedule: '课表',
    notes: '记事本',
    weather: '我的页面（天气入口）',
    settings: '我的页面',
    secondClass: '第二课堂',
    online: '校园在线'
  })[feature];
}
