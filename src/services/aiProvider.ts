import { fetchTimed } from './cloudSync.ts';

const ENV: Record<string, string | undefined> = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {};
export const AGENT_API_BASE = (ENV.VITE_AGENT_API_BASE || 'https://unimate3-ai-pages.pages.dev').replace(/\/+$/, '');

export type AIChatRole = 'user' | 'assistant';

export interface AIChatMessage {
  role: AIChatRole;
  content: string;
}

export interface JsonSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type AgentDecision =
  | { type: 'message'; content: string; source?: 'local_rule' }
  | { type: 'tool_call'; call: AgentToolCall };

export interface AgentPlanRequest {
  messages: readonly AIChatMessage[];
  tools: readonly ToolDefinition[];
}

export interface AgentPlanner {
  /** Offline Planner 对不支持的命令返回 null，由组合 Planner 决定如何降级。 */
  plan(request: AgentPlanRequest): Promise<AgentDecision | null>;
}

/**
 * Android 只认识 Unimate 自己的 Agent 网关，不直接调用模型，也不持有 API Key。
 * Workers AI 的绑定与模型名全部留在用户自己的 Cloudflare Worker。
 */
export class HttpAIProvider implements AgentPlanner {
  private readonly endpoint: string;

  constructor(endpoint = AGENT_API_BASE + '/v1/agent/chat') {
    this.endpoint = endpoint;
  }

  async plan(request: AgentPlanRequest): Promise<AgentDecision> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('当前没有网络');
    }
    const safe = request.messages
      .slice(-12)
      .map((m) => ({ role: m.role, content: String(m.content).trim().slice(0, 500) }))
      .filter((m) => m.content);
    if (!safe.length || safe[safe.length - 1]?.role !== 'user') throw new Error('没有可发送的用户消息');
    const toolNames = request.tools.map((tool) => tool.name).filter(Boolean).slice(0, 32);

    let response: Response;
    try {
      response = await fetchTimed('连接 Uni Agent 网关', this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: safe, toolNames, locale: 'zh-CN' })
      }, 30_000);
    } catch {
      throw new Error('在线 Agent 暂时无法连接');
    }
    let body: any = null;
    try { body = await response.json(); } catch { /* 非 JSON 错误页 */ }
    if (!response.ok) {
      if (response.status === 429) throw new Error('AI 请求太频繁，请稍后再试');
      if (response.status === 503) throw new Error('服务器尚未绑定 Workers AI');
      if (response.status === 404) throw new Error('在线 Agent 服务尚未部署');
      throw new Error(typeof body?.error === 'string' ? body.error : '在线 Agent 暂时不可用（' + response.status + '）');
    }
    if (body?.type === 'message' && typeof body.content === 'string' && body.content.trim()) {
      return { type: 'message', content: body.content.trim().slice(0, 4000) };
    }
    const call = body?.type === 'tool_call' ? body.call : null;
    if (call && typeof call.id === 'string' && typeof call.name === 'string' && isObject(call.arguments)) {
      return { type: 'tool_call', call: { id: call.id.slice(0, 120), name: call.name, arguments: call.arguments } };
    }
    throw new Error('Workers AI 没有返回有效的消息或 Tool Call');
  }
}

/**
 * 双模式选择器：在线时 Workers AI 负责理解和选 Tool；断网或网关不可达时自动退回本机规则。
 * 网络恢复后的下一次请求会重新尝试 Online，不需要重启 App。
 */
export class NetworkAwarePlanner implements AgentPlanner {
  private readonly online: AgentPlanner;
  private readonly offline: AgentPlanner;
  private active: 'online' | 'offline' = 'offline';

  constructor(online: AgentPlanner, offline: AgentPlanner) {
    this.online = online;
    this.offline = offline;
  }

  mode(): 'online' | 'offline' { return this.active; }

  async plan(request: AgentPlanRequest): Promise<AgentDecision | null> {
    const connected = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (connected) {
      try {
        const decision = await this.online.plan(request);
        if (decision) { this.active = 'online'; return decision; }
      } catch {
        const fallback = await this.offline.plan(request);
        if (fallback) { this.active = 'offline'; return fallback; }
        this.active = 'offline';
        return offlineNotice();
      }
    }
    this.active = 'offline';
    const fallback = await this.offline.plan(request);
    if (fallback) return fallback;
    return offlineNotice();
  }
}

function offlineNotice(): AgentDecision {
  return {
    type: 'message',
    content: '当前在线 AI 不可用，已切换到本机离线模式。你仍可查询课表、记事、天气，或打开 App 内功能。',
    source: 'local_rule'
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
