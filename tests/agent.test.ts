import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentCore, type AgentTool } from '../src/services/agentCore.ts';
import { AGENT_API_BASE, HttpAIProvider, NetworkAwarePlanner, type AgentDecision, type AgentPlanRequest, type AgentPlanner } from '../src/services/aiProvider.ts';
import { createStudentTools, LocalRulePlanner, type StudentAgentPort } from '../src/services/uniTools.ts';
import { VoiceAgent, type VoiceInput, type VoiceOutput } from '../src/services/voiceAI.ts';

let pass = 0; let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name); }
}

class QueuePlanner implements AgentPlanner {
  calls: AgentPlanRequest[] = [];
  queue: AgentDecision[];
  constructor(queue: AgentDecision[]) { this.queue = [...queue]; }
  async plan(request: AgentPlanRequest): Promise<AgentDecision> {
    this.calls.push({ messages: request.messages.map((message) => ({ ...message })), tools: [...request.tools] });
    return this.queue.shift() || { type: 'message', content: '默认回答' };
  }
}

const provider = new QueuePlanner([
  { type: 'message', content: '在线回答 1' },
  { type: 'message', content: '在线回答 2' },
  { type: 'tool_call', call: { id: 'c1', name: 'getSchedule', arguments: { query: 'next' } } }
]);
const tool: AgentTool = {
  definition: { name: 'getSchedule', description: '测试课表', parameters: { type: 'object' } },
  async prepare(args) {
    return { risk: 'read', async run() { return { content: '本机课表回答 ' + String((args as any).query), source: 'tool' }; } };
  }
};
const agent = new AgentCore({ planner: provider, tools: [tool] });
await agent.ask('你好');
await agent.ask('继续说');
ok('普通交流调用在线 Planner', provider.calls.length === 2);
ok('第二轮携带基本多轮上下文', provider.calls[1]?.messages.length === 3);

await agent.ask('下一节课是什么');
ok('LLM 只选择结构化 Tool，由本机 Tool 回答', provider.calls.length === 3 && agent.messages().at(-1)?.source === 'tool');
ok('本机课表回答不进入在线上下文', !agent.aiContext().some((message) => message.content.includes('课表')));

let destructiveRuns = 0;
const highPlanner = new QueuePlanner([{ type: 'tool_call', call: { id: 'danger-1', name: 'dangerousBatch', arguments: { count: 3 } } }]);
const highTool: AgentTool = {
  definition: { name: 'dangerousBatch', description: '测试高风险动作', parameters: { type: 'object' } },
  async prepare() {
    return {
      risk: 'high',
      confirmation: {
        title: '确认批量修改？', body: '3 条记事', detail: '将影响 3 条记录；本动作不可恢复。',
        confirmText: '确认修改', cancelText: '取消', danger: true
      },
      async run() { destructiveRuns++; return { content: '已修改 3 条', source: 'tool' }; }
    };
  }
};
const highAgent = new AgentCore({ planner: highPlanner, tools: [highTool] });
const pending = await highAgent.ask('批量修改三条');
ok('高风险 Tool 在确认前零执行', !!pending.confirmation && destructiveRuns === 0);
await highAgent.confirm(pending.confirmation!.id, true);
ok('用户确认后才执行一次', destructiveRuns === 1);
let replayBlocked = false;
try { await highAgent.confirm(pending.confirmation!.id, true); } catch { replayBlocked = true; }
ok('确认 token 一次性，不能重放', replayBlocked);

const memoryNotes: { id: string; title: string; remindAt: string; done: boolean }[] = [];
const port: StudentAgentPort = {
  scheduleSnapshot: () => ({ activeTimetable: null, courses: [], notes: [], periodTimes: [] }),
  notes: () => memoryNotes,
  async addNote(input) { memoryNotes.push({ id: 'n' + memoryNotes.length, title: input.title, remindAt: input.remindAt, done: false }); return { id: 'n1', saved: true }; },
  async weather() { return { enabled: true, summary: '20° 晴', location: '北京' }; },
  openFeature() {}
};
const offlineAgent = new AgentCore({ planner: new LocalRulePlanner(), tools: createStudentTools(port) });
const noteProposal = await offlineAgent.ask('记一下带实验报告');
ok('说出待办后先询问是否加入记事本', noteProposal.content === '要把“带实验报告”加入记事本吗？回复“是”确认，回复“否”取消。');
ok('用户确认前记事零写入', memoryNotes.length === 0);
await offlineAgent.ask('是');
ok('用户确认后才用结构化 addNote 写本机数据', memoryNotes.length === 1 && memoryNotes[0]?.title === '带实验报告');
let repeatedConfirmationBlocked = false;
try { await offlineAgent.ask('是'); } catch { repeatedConfirmationBlocked = true; }
ok('同一次记事确认不能重复执行', repeatedConfirmationBlocked && memoryNotes.length === 1);
const plannedProposal = await offlineAgent.ask('周五交高数作业');
ok('自然待办表达也会询问加入记事本', plannedProposal.content.includes('周五交高数作业'));
await offlineAgent.ask('不用');
ok('拒绝加入后记事数据不变', memoryNotes.length === 1);
const noteReply = await offlineAgent.ask('查一下记事本');
ok('Offline Mode 可查询本机记事', noteReply.content.includes('带实验报告'));

const onlineSpy = new QueuePlanner([{ type: 'message', content: '不应调用在线模型' }]);
const priorityAgent = new AgentCore({
  planner: onlineSpy,
  localPlanner: new LocalRulePlanner(),
  tools: createStudentTools(port)
});
const fastGreeting = await priorityAgent.ask('你好');
ok('高频问候优先走本机快速规则', onlineSpy.calls.length === 0 && fastGreeting.source === 'local_rule' && fastGreeting.content.includes('我是 Uni'));
const lunchReply = await priorityAgent.ask('我中午吃什么呢');
ok('常见用餐建议在网关不可用时也能本机回答', onlineSpy.calls.length === 0 && lunchReply.source === 'local_rule' && lunchReply.content.includes('食堂'));

const failingOnline: AgentPlanner = { async plan() { throw new Error('网关失败'); } };
const fallbackPlanner = new NetworkAwarePlanner(failingOnline, new LocalRulePlanner());
const fallbackAgent = new AgentCore({ planner: fallbackPlanner, tools: createStudentTools(port) });
const fallbackReply = await fallbackAgent.ask('查一下记事本');
ok('网关不可达自动切 Offline Mode', fallbackPlanner.mode() === 'offline' && fallbackReply.content.includes('带实验报告'));

class FakeVoiceInput implements VoiceInput {
  available(): boolean { return true; }
  async listen() { return { text: '你好' }; }
}
class FakeVoiceOutput implements VoiceOutput {
  spoken = '';
  available(): boolean { return true; }
  async speak(text: string) { this.spoken = text; }
  stop() {}
}
const voicePlanner = new QueuePlanner([{ type: 'message', content: '你好，我是 Uni' }]);
const voiceCore = new AgentCore({ planner: voicePlanner });
const voiceOutput = new FakeVoiceOutput();
await new VoiceAgent(new FakeVoiceInput(), voiceOutput, voiceCore).run();
ok('Voice 链路按 ASR → Agent → TTS 执行', voiceOutput.spoken === '你好，我是 Uni');

const client = readFileSync(join(process.cwd(), 'src/services/aiProvider.ts'), 'utf8');
const worker = readFileSync(join(process.cwd(), 'cloudflare/sync-worker/src/index.js'), 'utf8');
const pages = readFileSync(join(process.cwd(), 'cloudflare/pages/_worker.js'), 'utf8');
const view = readFileSync(join(process.cwd(), 'src/views/UniView.vue'), 'utf8');
const main = readFileSync(join(process.cwd(), 'src/screens/Main.vue'), 'utf8');
const moon = readFileSync(join(process.cwd(), 'src/components/MoonAgentButton.vue'), 'utf8');
const syncWorker = (await import('../cloudflare/sync-worker/src/index.js')).default;
let capturedModel = '';
let capturedInput: any = null;
const workerResponse = await syncWorker.fetch(new Request('https://worker.example/v1/agent/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: '查明天课表' }], toolNames: ['getSchedule'] })
}), {
  AI: {
    async run(model: string, input: any) {
      capturedModel = model;
      capturedInput = input;
      return { choices: [{ message: { tool_calls: [{ id: 'cf-call-1', type: 'function', function: { name: 'getSchedule', arguments: '{"query":"tomorrow"}' } }] } }] };
    }
  }
});
const workerDecision: any = await workerResponse.json();
const healthResponse = await syncWorker.fetch(new Request('https://worker.example/health'), { AI: { run: async () => ({}) } });
const healthBody: any = await healthResponse.json();
ok('APK 不包含模型 API Key', !/sk-[A-Za-z0-9_-]{12,}/.test(client));
ok('Planner 不 import 数据库或 Pinia store', !/stores\/db|useDb|indexedDB/.test(client));
ok('Agent 使用独立 VITE_AGENT_API_BASE', client.includes('VITE_AGENT_API_BASE') && client.includes("AGENT_API_BASE + '/v1/agent/chat'"));
ok('网络恢复后下一次请求会重新尝试 Online', client.includes("navigator.onLine !== false") && client.includes("this.active = 'online'"));
ok('Worker 使用 Cloudflare Workers AI 绑定', worker.includes('env.AI.run(model') && worker.includes("DEFAULT_WORKERS_AI_MODEL = '@cf/zai-org/glm-4.7-flash'"));
ok('Worker 不再依赖第三方模型 Key', !worker.includes('DEEPSEEK_API_KEY') && !worker.includes('api.deepseek.com') && !worker.includes('SILICONFLOW_API_KEY'));
ok('Worker 使用 Function Calling', worker.includes('AGENT_TOOLS') && worker.includes("tool_choice: 'auto'") && worker.includes('message?.tool_calls'));
ok('Workers AI 默认模型与 Tool 白名单真实传入 binding', capturedModel === '@cf/zai-org/glm-4.7-flash' && capturedInput?.tools?.length === 1 && capturedInput.tools[0]?.function?.name === 'getSchedule');
ok('Workers AI Tool Call 被校验并转换成 App 协议', workerResponse.status === 200 && workerDecision?.provider === 'workers-ai' && workerDecision?.call?.arguments?.query === 'tomorrow');
ok('健康检查公开 Agent 绑定状态', healthBody?.agent === 'workers-ai' && healthBody?.agentReady === true && healthBody?.agentModel === '@cf/zai-org/glm-4.7-flash');
ok('免费额度或网关失败会回落本机提示', client.includes('return offlineNotice()') && client.includes('已切换到本机离线模式'));
ok('Uni 页面如实显示 Workers AI 在线与本机兜底', view.includes('Workers AI 在线 + 本机离线兜底') && view.includes('免费额度用完'));
ok('Pages 转发 Agent API', pages.includes("'/v1/agent/chat'"));
ok('长对话直接定位最后回复或错误卡片', view.includes("target?.scrollIntoView({ block: 'center', behavior: 'smooth' })") && view.includes('errorText.value ? errorBox.value'));
ok('高风险确认统一走 db.confirm', view.includes('await db.confirm({') && view.includes('agent.confirm(confirmation.id'));
ok('本机快速规则先于在线 Provider', view.includes('const localPlanner = new LocalRulePlanner()') && view.includes('localPlanner, tools: createStudentTools(port)'));
ok('月亮短按文字、长按语音', moon.includes("emit('text')") && moon.includes("emit('voice')") && moon.includes('560'));
ok('月亮平时小、点击放大并支持全窗口拖动', moon.includes('moonExpanded') && moon.includes('uni-moon-expanded') && moon.includes('clampToBox') && moon.includes('barH: 0'));
ok('月亮按钮本体仍透明无边框且没有文字标签', !moon.includes('uni-moon-mode') && moon.includes('border: none') && moon.includes('background: transparent') && moon.includes('box-shadow: none'));
ok('月亮本体使用 Gemini 风格渐变流光且尊重减少动态效果设置', moon.includes('linear-gradient(135deg') && moon.includes('background-clip: text') && moon.includes('drop-shadow') && moon.includes('@keyframes uni-moon-aurora') && moon.includes('prefers-reduced-motion: reduce'));
ok('月亮外层使用四向收尖的 Gemini 玻璃星芒并随展开同步放大', moon.includes('.uni-moon-launcher::before') && moon.includes('backdrop-filter: blur') && moon.includes('clip-path: polygon(50% 0%') && moon.includes('uni-moon-glass-ring') && moon.includes('.uni-moon-expanded::before'));
ok('月牙通过尺寸和描边加粗', moon.includes('-webkit-text-stroke: 1px') && moon.includes('font-size: 29px') && moon.includes('font-size: 49px'));
ok('月亮入口接入主界面', main.includes('<MoonAgentButton') && main.includes("openAgent('voice')"));
ok('顶部标题保持简洁的 Uni', main.includes("return 'Uni'"));

// 模拟 APK → 独立 Pages → Worker 的 HTTP 契约，账号请求不能流入 AI 服务。
const relay = (await import('../cloudflare/agent-pages/public/_worker.js')).default;
const originalFetch = globalThis.fetch;
let relayRequests = 0;
let forwardedOrigin: string | null = null;
let forwardedBody: any;
const relayEnv = { UNIMATE_AI: { async fetch(url: string, init: RequestInit) {
  relayRequests++;
  forwardedOrigin = new Headers(init.headers).get('Origin');
  forwardedBody = JSON.parse(new TextDecoder().decode(init.body as Uint8Array));
  if (init.redirect !== 'manual') throw new Error('Cloudflare 只允许 manual/follow');
  return Response.json({ type: 'message', content: '在线接入正常', provider: 'workers-ai' });
} } };
try {
  globalThis.fetch = async (input: any, init?: RequestInit) => relay.fetch(new Request(input, {
    ...init, headers: { ...init?.headers, Origin: 'https://localhost' }
  }), relayEnv);
  const answer = await new HttpAIProvider().plan({ messages: [{ role: 'user', content: '解释牛顿第二定律' }], tools: [] });
  ok('APK 默认 Agent 使用独立 Pages 地址', AGENT_API_BASE === 'https://unimate3-ai-pages.pages.dev');
  ok('APK Provider 经 Pages 服务绑定取得在线回答', answer.type === 'message' && answer.content === '在线接入正常' && relayRequests === 1);
  ok('中转剥离 Origin 且保留用户输入', forwardedOrigin === null && forwardedBody.messages[0].content === '解释牛顿第二定律');
  const preflight = await relay.fetch(new Request(AGENT_API_BASE + '/v1/agent/chat', { method: 'OPTIONS', headers: { Origin: 'https://localhost' } }), relayEnv);
  ok('APK 的 AI 预检得到正确 CORS', preflight.status === 204 && preflight.headers.get('Access-Control-Allow-Origin') === 'https://localhost');
  const rejected = await relay.fetch(new Request(AGENT_API_BASE + '/v1/agent/chat', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' }), relayEnv);
  ok('AI 中转拒绝非白名单来源且不调用 Worker', rejected.status === 403 && relayRequests === 1);
  const account = await relay.fetch(new Request(AGENT_API_BASE + '/v1/login', { method: 'POST', body: '{}' }), relayEnv);
  ok('AI 中转不接管账号登录和备份', account.status === 404 && relayRequests === 1);
  const large = await relay.fetch(new Request(AGENT_API_BASE + '/v1/agent/chat', { method: 'POST', body: 'a'.repeat(65537) }), relayEnv);
  ok('AI 中转按实际请求体字节限制大小', large.status === 413 && relayRequests === 1);
} finally { globalThis.fetch = originalFetch; }

console.log(`\nAgent Test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
