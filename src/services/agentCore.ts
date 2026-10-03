import { uuid } from './id.ts';
import { normalizeAssistantText } from './assistantText.ts';
import type { ActionCard } from '../../p5-assistant/n8n/core/types.ts';
import type {
  AgentDecision,
  AgentPlanRequest,
  AgentPlanner,
  AIChatMessage,
  ToolDefinition
} from './aiProvider.ts';

export type AgentSource = 'local_rule' | 'tool' | 'ai';
export type ToolRisk = 'read' | 'write' | 'high';

export interface AgentToolResult {
  content: string;
  source?: Exclude<AgentSource, 'ai'>;
  cards?: ActionCard[];
  explain?: string[];
}

export interface AgentConfirmation {
  id: string;
  toolName: string;
  title: string;
  body: string;
  detail: string;
  confirmText: string;
  cancelText: string;
  danger: boolean;
}

export interface PreparedToolAction {
  risk: ToolRisk;
  run(): Promise<AgentToolResult>;
  confirmation?: Omit<AgentConfirmation, 'id' | 'toolName'>;
}

/**
 * Tool 的小 Interface：定义、参数校验、风险判定和执行准备全部收在 Tool 内。
 * Agent Core 与模型都拿不到数据库，只能持有这组能力对象。
 */
export interface AgentTool {
  readonly definition: ToolDefinition;
  prepare(args: unknown): Promise<PreparedToolAction>;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  source?: AgentSource;
  cards: ActionCard[];
  explain: string[];
  createdAt: number;
}

export interface AgentReply {
  content: string;
  source: AgentSource;
  cards: ActionCard[];
  explain: string[];
  confirmation?: AgentConfirmation;
}

export interface AgentCoreOptions {
  planner: AgentPlanner;
  tools?: readonly AgentTool[];
  /** 本机规则优先：命中时不联网；返回 null 才交给在线模型。 */
  localPlanner?: AgentPlanner;
  now?: () => number;
}

interface PendingAction {
  action: PreparedToolAction;
  toolName: string;
  expiresAt: number;
}

const MAX_TRANSCRIPT = 40;
const MAX_CONTEXT_MESSAGES = 12;
const MAX_CONTEXT_CHARS = 6000;
const CONFIRM_TTL_MS = 5 * 60 * 1000;

/**
 * Agent 的唯一外部 seam：理解意图、选择 Tool、风险门、执行与上下文裁剪都藏在这里。
 * 隐私不变量：Tool 结果只进入本机 transcript，不进入在线模型上下文。
 */
export class AgentCore {
  private readonly planner: AgentPlanner;
  private readonly localPlanner: AgentPlanner | null;
  private readonly tools = new Map<string, AgentTool>();
  private readonly transcript: AgentMessage[] = [];
  private readonly pending = new Map<string, PendingAction>();
  private providerHistory: AIChatMessage[] = [];
  private readonly now: () => number;

  constructor(options: AgentCoreOptions) {
    this.planner = options.planner;
    this.localPlanner = options.localPlanner || null;
    this.now = options.now || Date.now;
    for (const tool of options.tools || []) {
      const name = tool.definition.name;
      if (!name || this.tools.has(name)) throw new Error('Tool 名称重复或为空：' + name);
      this.tools.set(name, tool);
    }
  }

  messages(): readonly AgentMessage[] {
    return this.transcript.map((m) => ({ ...m, cards: [...m.cards], explain: [...m.explain] }));
  }

  /**
   * 恢复本机保存的聊天记录。历史记录只恢复纯文本与时间，不恢复旧操作卡或确认 token，
   * 避免用户重启 App 后误触一张已经过期的写操作卡。
   */
  restore(raw: unknown): void {
    this.transcript.splice(0);
    this.pending.clear();
    this.providerHistory = [];
    if (!Array.isArray(raw)) return;

    const restored = raw.slice(-MAX_TRANSCRIPT);
    for (const item of restored) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      if (row.role !== 'user' && row.role !== 'assistant') continue;
      const rawContent = String(row.content || '').trim().slice(0, 4000);
      const content = row.role === 'assistant' ? normalizeAssistantText(rawContent) : rawContent;
      if (!content) continue;
      const source = row.source === 'local_rule' || row.source === 'tool' || row.source === 'ai'
        ? row.source as AgentSource : undefined;
      const createdAt = Number(row.createdAt);
      this.transcript.push({
        id: uuid(), role: row.role, content, source, cards: [], explain: [],
        createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : this.now()
      });
    }

    // 只把真正的在线 AI 问答恢复为模型上下文；本机 Tool/规则结果仍不发给在线模型。
    const context: AIChatMessage[] = [];
    let pendingUser: AIChatMessage | null = null;
    for (const message of this.transcript) {
      if (message.role === 'user') {
        pendingUser = { role: 'user', content: message.content };
      } else {
        if (pendingUser && message.source === 'ai') {
          context.push(pendingUser, { role: 'assistant', content: message.content });
        }
        pendingUser = null;
      }
    }
    this.providerHistory = this.trimContext(context);
  }

  aiContext(): readonly AIChatMessage[] {
    return this.providerHistory.map((m) => ({ ...m }));
  }

  toolDefinitions(): readonly ToolDefinition[] {
    return [...this.tools.values()].map((tool) => ({
      ...tool.definition,
      parameters: { ...tool.definition.parameters }
    }));
  }

  async ask(raw: string): Promise<AgentReply> {
    const message = String(raw || '').trim();
    if (!message) throw new Error('请输入消息');
    if (message.length > 500) throw new Error('消息不能超过 500 个字符');
    this.push('user', message);
    this.expirePending();

    const request: AgentPlanRequest = {
      messages: this.trimContext([...this.providerHistory, { role: 'user', content: message }]),
      tools: this.toolDefinitions()
    };

    let decision: AgentDecision | null = null;
    if (this.localPlanner) decision = await this.localPlanner.plan(request);
    if (!decision) decision = await this.planner.plan(request);
    if (!decision) throw new Error('Agent 没有找到可执行的处理方式');
    return this.applyDecision(decision, request.messages);
  }

  /** 高风险动作只能从这个入口执行；确认 token 一次性且 5 分钟失效。 */
  async confirm(id: string, approved: boolean): Promise<AgentReply> {
    this.expirePending();
    const pending = this.pending.get(id);
    if (!pending) throw new Error('这项操作已失效，请重新发起');
    this.pending.delete(id);
    if (!approved) {
      return this.recordReply({ content: '已取消，本机数据没有变化。', source: 'tool', cards: [], explain: [] });
    }
    const result = await pending.action.run();
    return this.recordToolResult(result);
  }

  private async applyDecision(decision: AgentDecision, requestHistory: readonly AIChatMessage[]): Promise<AgentReply> {
    if (decision.type === 'message') {
      const content = normalizeAssistantText(String(decision.content || '').trim().slice(0, 4000));
      if (!content) throw new Error('AI 没有返回有效内容');
      this.providerHistory = this.trimContext([...requestHistory, { role: 'assistant', content }]);
      return this.recordReply({ content, source: decision.source === 'local_rule' ? 'local_rule' : 'ai', cards: [], explain: [] });
    }

    // 保留用户的 Tool 请求，但绝不把 Tool 结果回灌给在线模型；同时让两轮确认在执行后自然失效。
    this.providerHistory = this.trimContext(requestHistory);
    const tool = this.tools.get(decision.call.name);
    if (!tool) throw new Error('模型选择了不可用的 Tool：' + decision.call.name);
    const action = await tool.prepare(decision.call.arguments);
    if (action.risk !== 'high') return this.recordToolResult(await action.run());

    const detail = action.confirmation;
    if (!detail) throw new Error('高风险 Tool 缺少确认说明：' + decision.call.name);
    const id = uuid();
    this.pending.set(id, { action, toolName: decision.call.name, expiresAt: this.now() + CONFIRM_TTL_MS });
    const confirmation: AgentConfirmation = { id, toolName: decision.call.name, ...detail };
    const reply: AgentReply = {
      content: '这项操作需要你确认后才能执行。',
      source: 'tool', cards: [], explain: ['高风险操作尚未执行'], confirmation
    };
    this.push('assistant', reply.content, reply.source, reply.cards, reply.explain);
    return reply;
  }

  private recordToolResult(result: AgentToolResult): AgentReply {
    return this.recordReply({
      content: result.content,
      source: result.source || 'tool',
      cards: [...(result.cards || [])],
      explain: [...(result.explain || [])]
    });
  }

  private recordReply(reply: AgentReply): AgentReply {
    const normalized = { ...reply, content: normalizeAssistantText(reply.content) };
    this.push('assistant', normalized.content, normalized.source, normalized.cards, normalized.explain);
    return normalized;
  }

  private push(
    role: AgentMessage['role'],
    content: string,
    source?: AgentSource,
    cards: ActionCard[] = [],
    explain: string[] = []
  ): void {
    this.transcript.push({ id: uuid(), role, content, source, cards: [...cards], explain: [...explain], createdAt: this.now() });
    if (this.transcript.length > MAX_TRANSCRIPT) this.transcript.splice(0, this.transcript.length - MAX_TRANSCRIPT);
  }

  private trimContext(messages: readonly AIChatMessage[]): AIChatMessage[] {
    const out: AIChatMessage[] = [];
    let chars = 0;
    for (let i = messages.length - 1; i >= 0 && out.length < MAX_CONTEXT_MESSAGES; i--) {
      const message = messages[i];
      if (!message) continue;
      const content = String(message.content || '').slice(0, 500);
      if (chars + content.length > MAX_CONTEXT_CHARS) break;
      out.unshift({ role: message.role, content });
      chars += content.length;
    }
    return out;
  }

  private expirePending(): void {
    const now = this.now();
    for (const [id, action] of this.pending) {
      if (action.expiresAt <= now) this.pending.delete(id);
    }
  }
}
