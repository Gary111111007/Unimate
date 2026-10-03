import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentCore, type AgentTool } from '../src/services/agentCore.ts';
import { normalizeAssistantText } from '../src/services/assistantText.ts';
import { AGENT_API_BASE, HttpAIProvider, NetworkAwarePlanner, type AgentDecision, type AgentPlanRequest, type AgentPlanner } from '../src/services/aiProvider.ts';
import { createStudentTools, LocalRulePlanner, type StudentAgentPort } from '../src/services/uniTools.ts';

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

const restoredProvider = new QueuePlanner([{ type: 'message', content: '恢复后的回答' }]);
const restoredAgent = new AgentCore({ planner: restoredProvider });
restoredAgent.restore(agent.messages());
await restoredAgent.ask('恢复后继续');
ok('本机历史记录可恢复且继续用于在线多轮上下文', restoredAgent.messages().length === 6 && restoredProvider.calls[0]?.messages.length === 5);

ok('Uni 回复移除列表开头的彩色 Emoji 并保留正文内容', normalizeAssistantText('- 📅 查看课表\n- 📝 查看记事\n正文里的 ☀️ 保留') === '- 查看课表\n- 查看记事\n正文里的 ☀️ 保留');
const emojiHistoryAgent = new AgentCore({ planner: new QueuePlanner([]) });
emojiHistoryAgent.restore([{ role: 'assistant', content: '- ⚙️ 打开设置', source: 'ai', createdAt: Date.now() }]);
ok('已有历史记录中的彩色列表图标也会在恢复时清理', emojiHistoryAgent.messages()[0]?.content === '- 打开设置');

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

const client = readFileSync(join(process.cwd(), 'src/services/aiProvider.ts'), 'utf8');
const worker = readFileSync(join(process.cwd(), 'cloudflare/sync-worker/src/index.js'), 'utf8');
const pages = readFileSync(join(process.cwd(), 'cloudflare/pages/_worker.js'), 'utf8');
const view = readFileSync(join(process.cwd(), 'src/views/UniView.vue'), 'utf8');
const main = readFileSync(join(process.cwd(), 'src/screens/Main.vue'), 'utf8');
const moon = readFileSync(join(process.cwd(), 'src/components/MoonAgentButton.vue'), 'utf8');
const nativePlugin = readFileSync(join(process.cwd(), 'android/app/src/main/java/com/unimate/app/JwWebViewPlugin.java'), 'utf8');
const jwBridge = readFileSync(join(process.cwd(), 'src/services/jwwebview.ts'), 'utf8');
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
ok('Worker 要求 Uni 使用与 App 一致的无 Emoji 文本列表', worker.includes('不要使用 Emoji、彩色图标或 Markdown 图标'));
ok('Workers AI 默认模型与 Tool 白名单真实传入 binding', capturedModel === '@cf/zai-org/glm-4.7-flash' && capturedInput?.tools?.length === 1 && capturedInput.tools[0]?.function?.name === 'getSchedule');
ok('Workers AI Tool Call 被校验并转换成 App 协议', workerResponse.status === 200 && workerDecision?.provider === 'workers-ai' && workerDecision?.call?.arguments?.query === 'tomorrow');
ok('健康检查公开 Agent 绑定状态', healthBody?.agent === 'workers-ai' && healthBody?.agentReady === true && healthBody?.agentModel === '@cf/zai-org/glm-4.7-flash');
ok('免费额度或网关失败会回落本机提示', client.includes('return offlineNotice()') && client.includes('已切换到本机离线模式'));
ok('Uni 页面不再显示连接状态卡与模式说明', !view.includes('Workers AI 在线 + 本机离线兜底') && !view.includes('Online Mode 只把你主动发送'));
ok('Pages 转发 Agent API', pages.includes("'/v1/agent/chat'"));
// v2.73：滚动容器换成整页后，"最后一条"不能再靠 lastElementChild（会拿到输入框那条表单），
// 改成显式查 .uni-chat-message:last-of-type / .uni-chat-loading；错误卡片仍优先。
ok('长对话直接定位最后回复或错误卡片',
  view.includes("errorBox.value?.scrollIntoView({ block: 'end', behavior: 'smooth' })")
  && view.includes(".uni-chat-message:last-of-type")
  && view.includes("el.scrollTop = el.scrollHeight"), '');
ok('Uni 历史按学校和账号保存在本机并在进页时恢复', view.includes("'/agent/history.json'") && view.includes('readJson<unknown[]>') && view.includes('writeJson(historyPath()') && view.includes('历史记录'));
// v2.67 人性化对话：日期分隔条 + 头像 + 分组 + 呼吸点加载 + 历史面板按天分组。
ok('对话区按天插入日期分隔条', view.includes('uni-chat-day') && view.includes('dayLabel') && view.includes("'今天'") && view.includes("'昨天'"));
ok('对话区为我和 Uni 显示头像并合并连续同一方发言', view.includes('uni-chat-avatar') && view.includes('chatEntries') && view.includes('newGroup') && view.includes('uni-chat-avatar-ghost'));
ok('等待回复使用呼吸点而不是裸文字', view.includes('uni-chat-dots') && !view.includes('正在听，请说话'));
// v2.70：历史面板从"平铺每条消息"改成"一轮轮对话"（问题当标题、回答当预览、点一下跳回去）。
ok('历史面板按天分组并可回看谁说了什么', view.includes('historyGroups') && view.includes('uni-history-group') && view.includes('uni-history-day') && view.includes('chatTurns'));
ok('历史面板把消息配成"一轮轮对话"而不是平铺每条消息',
  view.includes('interface ChatTurn') && view.includes('uni-history-turn') && view.includes('uni-history-q') && view.includes('uni-history-a'));
ok('历史条目可点回原处（锚点 + 定位）',
  view.includes('data-mid=') && view.includes('function jumpTo') && view.includes('scrollIntoView({ block: \'center\''));
ok('历史面板支持搜索与"再问一次"', view.includes('historyQuery') && view.includes('uni-history-search') && view.includes('askAgain'));
ok('历史摘要去掉 Markdown 记法（不显示 ## 与 **）',
  view.includes('toPlainText(m.content)') && view.includes('toPlainText(reply.content)'));
ok('清空历史走 db.confirm 二次确认并说明影响面与不可恢复',
  view.includes('function clearHistory') && view.includes('确认清空全部历史对话') && view.includes('清空后无法恢复'));
// v2.70：模型喜欢输出 Markdown，真机上曾原样显示 `## 标题` / `**加粗**`。
ok('助手回复使用结构化 Markdown 渲染组件', view.includes('<MarkdownText') && view.includes('richReply(entry.message.content)'));
/*
 * 注意：不能直接 `includes('v-html')` —— MarkdownText.vue 的注释里**故意**写了
 * "为什么不是 v-html"，那是给人看的说明。断言必须只看模板/代码部分，剥掉注释。
 * （这和 v2.67 那次"注释里写断言关键词导致假失败"是同一个坑：AGENTS.md 记着。）
 */
const mdComponent = readFileSync(join(process.cwd(), 'src/components/MarkdownText.vue'), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
const uniNoComment = stripComments(view);
const mdNoComment = stripComments(mdComponent);
ok('Markdown 渲染不经过 v-html（无 XSS 面）',
  !uniNoComment.includes('v-html') && !mdNoComment.includes('v-html') && !stripComments(readFileSync(join(process.cwd(), 'src/services/markdown.ts'), 'utf8')).includes('innerHTML'));
ok('气泡可复制，且复制的是去 Markdown 记法的纯文本',
  view.includes('function copyMessage') && view.includes('navigator.clipboard') && view.includes('toPlainText(message.content)'));
ok('最后一条回复可重新生成（重放原问题，不原地改写历史）',
  view.includes('function regenerate') && view.includes('isLast') && view.includes("aria-label=\"重新生成\""));
ok('不在底部时给"回到最新"入口，不强行拽走用户阅读位置',
  view.includes('atBottom') && view.includes('uni-chat-tobottom') && view.includes('onListScroll'));
ok('气泡内的重复元信息已移除（时间/来源挪到气泡外的行动栏）', !view.includes('uni-chat-meta'));

/*
 * v2.71：产品负责人要求「UNI 的最上方历史记录要保持可以始终看到」。
 * v2.73：产品负责人又强调「这里把历史记录固定在本界面的最上方」——
 *   说明 v2.71 那次**没真的吸住**：当时 `.uni-chat-list` 自己也是滚动容器，
 *   两层嵌套时内层先滚、外层不动，`sticky` 便无从谈起。
 *   现在把 ref 与 @scroll 都移到整页 `.uni-chat-page`，内层只做布局。
 *
 * 关键不是"加了个按钮"，而是**它得真的吸住**：z-index 要**低于** compose(42) 与
 * 回到最新(43)，否则往上滚时会盖住输入框那一栏。
 * 这几条一起断言，是因为少任何一个都会在真机上表现为"看着像吸顶其实没吸住"。
 *
 * 【v2.76 修正】上面这条 top 断言原来钉的是 `top: 0` —— 那是个**错的期望值**，
 * 真机实测（Playwright 量 getBoundingClientRect）在滚动 500px 后是
 * `.head.top = 0` / `.uni-chat-history.top = -434`：**根本没吸住**，
 * 未滚动时看着"贴住了"只是因为自然位置恰好在那儿。
 * 详见下面 v2.76 那一组"结构性"断言 —— 光改 top 的数值没用。
 */
ok('历史入口 sticky 常驻且吸附到标题栏下沿（top 走 --unih-head 变量）',
  /\.uni-chat-history \{[^}]*position:\s*sticky;[^}]*top:\s*var\(--unih-head/.test(uniNoComment));
ok('历史入口层级低于输入框与"回到最新"（不遮挡输入）',
  /\.uni-chat-history \{[^}]*z-index:\s*41;/.test(uniNoComment)
  && /\.uni-chat-compose \{[^}]*z-index:\s*42;/.test(uniNoComment)
  && /\.uni-chat-tobottom \{[^}]*z-index:\s*43;/.test(uniNoComment));
ok('吸顶条用不透明底色 var(--bg)（透明会糊住滚过去的内容）',
  /\.uni-chat-history \{[^}]*background:\s*var\(--bg\);/.test(uniNoComment));
ok('吸顶条的外层与内层卡片分开（外层挡内容、内层做圆角）',
  view.includes('class="uni-chat-history-in"') && uniNoComment.includes('.uni-chat-history-in'));
/*
 * v2.73 核心：**滚动容器必须是整页**。
 * 只断言 `position: sticky` 是查不出"没吸住"的 —— 必须同时守住"内层不再自己滚"。
 */
ok('ref 与 @scroll 都挂在整页上（滚动容器 = .uni-chat-page）',
  /ref="messageList"[^>]*class="scroll uni-chat-page"[^>]*@scroll\.passive="onListScroll"/.test(view), '');
ok('内层 .uni-chat-list 不再是自己滚动的容器（双层滚动会让 sticky 失效）',
  !/ref="messageList"[^>]*class="uni-chat-list"/.test(view)
  && !/@scroll\.passive="onListScroll"[^>]*class="uni-chat-list"/.test(view)
  && !/\.uni-chat-list \{[^}]*overflow/.test(uniNoComment), '');
// v2.73：底部空白 = 内外两层各留一段 padding 叠成 272px；现在只留外层（给 fixed 输入框让位）
ok('底部不再双重留白（内层去掉了 118px，只保留外层给输入框让位）',
  !/\.uni-chat-list \{[^}]*padding:[^}]*118px/.test(uniNoComment)
  && /\.uni-chat-page \{[^}]*padding-bottom:\s*calc\(154px/.test(uniNoComment), '');
// v2.73：grid 默认 align-content: stretch 会把短对话的行拉开，看起来就是"下面一大片空"
ok('对话列表 align-content: start（否则短对话会被 grid 拉开成大片空白）',
  /\.uni-chat-list \{[^}]*align-content:\s*start/.test(uniNoComment));
/*
 * v2.74：产品负责人「把历史对话固定在最顶部的 UNI 下面」——
 * v2.73 已经吸住了，但负边距只有 -12px（正好抵 `.scroll` 的左右 padding），
 * 视觉上依然跟 header 之间留着一条缝，看起来不像 header 的延伸。
 *
 * 【v2.76 更新】横向出血到 -16px 保留（底色通栏），但**纵向的 -12px 上出血删掉了**：
 * 结构改了以后它已不在 `.uni-chat-page` 内，不需要再抵那个 padding；
 * 纵向改为 `0`，靠 `top: var(--unih-head)` 精确吸附。
 */
ok('历史入口横向出血到 -16px（底色通栏），纵向不再靠负边距硬凑（v2.76）',
  /\.uni-chat-history \{[^}]*margin:\s*0 -16px 10px;/.test(uniNoComment), '');
/*
 * v2.75：产品负责人第三次推进同一件事 ——「**把历史对话给我固定在UNI下沿别动**」。
 * v2.74 已经把底色条做到通栏，但内层还是"一张带边框的圆角卡"，
 * 真机上看得出"这是页面里的一张卡"，不像标题栏的一部分。
 * 这一版把它读成标题栏的延伸：
 *   - 内层去掉边框/底色，不再是独立卡片（否则跟标题栏是两截）；
 *   - 外层底色必须是**不透明**的 var(--bg) —— sticky 块背后会有内容滚过去，
 *     半透明/毛玻璃都会糊成一团（v2.74 踩过，别改回去）；
 *   - 下边框留着，作为"标题栏到此为止"的分界。
 */
ok('历史入口内层去卡片化（无边框无底色，读起来是标题栏的一行）（v2.75）',
  /\.uni-chat-history-in \{[^}]*background:\s*transparent;[^}]*border:\s*none;/.test(uniNoComment), '');
ok('历史入口外层底色仍是不透明的 var(--bg)（透明会糊住滚过去的内容）',
  /\.uni-chat-history \{[^}]*background:\s*var\(--bg\);/.test(uniNoComment)
  && !/\.uni-chat-history \{[^}]*background:\s*color-mix/.test(uniNoComment), '');
ok('历史入口保留下边框作为与标题栏的分界（v2.75）',
  /\.uni-chat-history \{[^}]*border-bottom:\s*1px solid var\(--line\);/.test(uniNoComment), '');
/*
 * ================= v2.76：真正让 sticky 生效的**结构性**约束 =================
 *
 * 这一组是本轮的核心教训。前四轮（v2.72~2.75）每次都在调 `.uni-chat-history` 的
 * 颜色/边框/边距，测试也只查这些"外观特征"，于是**"根本没吸住"可以一路蒙混过关**。
 *
 * CSS 规范里 sticky 的约束：**祖先只要有 overflow（非 visible）就构成约束容器**，
 * sticky 子元素只能在该容器的高度范围内吸附 —— 而 `.uni-chat-page` 带着全局
 * `.scroll` 的 `overflow-y: auto`。同时真正在滚的是 `<html>`（`.screen` 是
 * `min-height: 100%` 而非 `height: 100%`，`.scroll{flex:1}` 拿不到确定高度，
 * 自己永不滚动，交给页面级滚动兜底）。
 *
 * 所以唯一的修法是把历史入口挪出 `.uni-chat-page`、与 `.head` 做兄弟。
 * 下面这几条钉的就是"层级关系"，靠正则从模板里验：
 *   A. 历史入口在滚动容器**之外**（滚动容器那层必须先开、后关，历史入口不在其中）；
 *   B. 外面有一层不裁剪的 `.uni-chat-wrap` 当根（overflow 必须 visible，否则又是约束容器）；
 *   C. `top` 由脚本量的 `--unih-head` 提供，且有兜底与重新测量（改页签/转屏不会错位）。
 */
const pageOpen = view.indexOf('class="scroll uni-chat-page"');
const histIdx = view.indexOf('class="uni-chat-history"');
ok('历史入口在滚动容器之外（与 .head 同级，否则 sticky 被约束容器限制，永远吸不住）（v2.76）',
  pageOpen !== -1 && histIdx !== -1 && histIdx < pageOpen, '');
ok('Uni 页根节点是不裁剪的 .uni-chat-wrap（overflow 必须 visible，否则又成了约束容器）（v2.76）',
  view.includes('class="uni-chat-wrap"')
  && !/\.uni-chat-wrap \{[^}]*overflow-\w+:\s*(hidden|auto|scroll)/.test(uniNoComment), '');
ok('脚本挂载时量标题栏高度并写入 --unih-head（含兜底 0 与 resize/orientation 重新测量）（v2.76）',
  view.includes("'--unih-head': headOffset + 'px'")
  && /function syncHeadHeight\(\)/.test(view)
  && view.includes('window.addEventListener(\'resize\', syncHeadHeight)')
  && view.includes('window.addEventListener(\'orientationchange\', syncHeadHeight)')
  && /\.uni-chat-history \{[^}]*top:\s*var\(--unih-head,\s*0px\)/.test(uniNoComment), '');
ok('量完的高度要 removeEventListener（组件卸载后不许留着监听器）（v2.76）',
  view.includes("window.removeEventListener('resize', syncHeadHeight)")
  && view.includes("window.removeEventListener('orientationchange', syncHeadHeight)"), '');
// v2.67：语音输入整条链路已下线，用"断言不存在"反向锁死，避免它悄悄回来。
ok('Uni 输入区不再有语音按钮或麦克风入口', !view.includes('aria-label="语音输入"') && !view.includes('name="microphone"') && !view.includes('uni-chat-mic') && !view.includes('listenVoice'));
ok('voiceAI 语音服务模块已删除', !existsSync(join(process.cwd(), 'src/services/voiceAI.ts')));
ok('WebView 桥不再暴露语音识别与系统键盘方法', !jwBridge.includes('speechToText') && !jwBridge.includes('showKeyboard'));
ok('Android 原生桥不再包含语音识别代码', !nativePlugin.includes('speechToText') && !nativePlugin.includes('RecognizerIntent') && !nativePlugin.includes('SpeechRecognizer') && !nativePlugin.includes('handleSpeechResult'));
const androidManifest = readFileSync(join(process.cwd(), 'android/app/src/main/AndroidManifest.xml'), 'utf8');
ok('AndroidManifest 不再申请录音权限', !androidManifest.includes('android.permission.RECORD_AUDIO'));
ok('高风险确认统一走 db.confirm', view.includes('await db.confirm({') && view.includes('agent.confirm(confirmation.id'));
ok('本机快速规则先于在线 Provider', view.includes('const localPlanner = new LocalRulePlanner()') && view.includes('localPlanner, tools: createStudentTools(port)'));
ok('月亮短按放大、再点进入对话（已无长按语音）', moon.includes("emit('text')") && !moon.includes("emit('voice')") && !moon.includes('longTriggered'));
ok('月亮平时小、点击放大并支持全窗口拖动', moon.includes('moonExpanded') && moon.includes('uni-moon-expanded') && moon.includes('clampToBox') && moon.includes('barH: 0'));
ok('月亮按钮本体仍透明无边框且没有文字标签', !moon.includes('uni-moon-mode') && moon.includes('border: none') && moon.includes('background: transparent') && moon.includes('box-shadow: none'));
ok('月亮本体使用 Gemini 风格渐变流光且尊重减少动态效果设置', moon.includes('linear-gradient(135deg') && moon.includes('background-clip: text') && moon.includes('drop-shadow') && moon.includes('@keyframes uni-moon-aurora') && moon.includes('prefers-reduced-motion: reduce'));
ok('月亮外层使用四向收尖的 Gemini 玻璃星芒并随展开同步放大', moon.includes('.uni-moon-launcher::before') && moon.includes('backdrop-filter: blur') && moon.includes('clip-path: polygon(50% 0%') && moon.includes('uni-moon-glass-ring') && moon.includes('.uni-moon-expanded::before'));
ok('月牙通过尺寸和描边加粗', moon.includes('-webkit-text-stroke: 1px') && moon.includes('font-size: 29px') && moon.includes('font-size: 49px'));
ok('月亮入口已从主界面移除', !main.includes('<MoonAgentButton') && !main.includes("openAgent('voice')"));
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
