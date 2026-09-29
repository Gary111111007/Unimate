/**
 * PROTOTYPE ONLY — Uni 临时本地模型网关。
 *
 * 目的：在不买服务器、不改 Android 数据层的前提下，验证
 * DeepSeek-R1-Distill-Qwen-1.5B 是否足够承担普通聊天与结构化 Tool 选择。
 * 状态只在内存中；不保存用户输入，不访问 Unimate 数据库。
 */
import http from 'node:http';

const HOST = process.env.PROTOTYPE_HOST || '127.0.0.1';
const PORT = integer(process.env.PROTOTYPE_PORT, 8787, 1, 65535);
const LLAMA_URL = String(process.env.LLAMA_CHAT_URL || 'http://127.0.0.1:8080/v1/chat/completions');
const MODEL = String(process.env.PROTOTYPE_MODEL || 'deepseek-r1-distill-qwen-1.5b');
const MOCK = process.env.UNIMATE_PROTOTYPE_MOCK === '1';
const DEBUG = process.env.PROTOTYPE_DEBUG === '1';
const TOOL_MODE = process.env.PROTOTYPE_TOOL_MODE === 'llm' ? 'llm' : 'hybrid';
const MAX_BODY_BYTES = 32 * 1024;
const WINDOW_MS = 60_000;
const MAX_REQUESTS = integer(process.env.PROTOTYPE_RATE_LIMIT, 20, 1, 120);
const buckets = new Map();

const TOOL_NAMES = new Set([
  'getSchedule',
  'getNote',
  'addNote',
  'createReminder',
  'getWeather',
  'openFeature'
]);

const server = http.createServer(async (request, response) => {
  const startedAt = Date.now();
  const url = new URL(request.url || '/', 'http://prototype.local');
  const origin = allowedOrigin(request.headers.origin, request.headers.host);
  if (request.headers.origin && !origin) return send(response, 403, { error: '来源不允许' }, '');
  if (request.method === 'OPTIONS') return preflight(response, origin);
  if (url.pathname === '/' && request.method === 'GET') return sendHtml(response, prototypePage());
  if (url.pathname === '/health' && request.method === 'GET') {
    return send(response, 200, {
      ok: true,
      service: 'unimate-local-distill-prototype',
      prototype: true,
      mock: MOCK,
      toolMode: TOOL_MODE,
      model: MODEL,
      upstream: redactUrl(LLAMA_URL)
    }, origin);
  }
  if (url.pathname !== '/v1/agent/chat' || request.method !== 'POST') {
    return send(response, 404, { error: 'not found' }, origin);
  }
  if (!withinRate(clientKey(request))) return send(response, 429, { error: '请求过于频繁，请稍后再试' }, origin);

  try {
    const body = await readJson(request);
    const input = validateInput(body);
    const requestedTools = input.toolNames.filter((name) => TOOL_NAMES.has(name));
    const localDecision = !MOCK && TOOL_MODE === 'hybrid'
      ? routeBasicCommand(input.messages, requestedTools)
      : null;
    const decision = MOCK
      ? mockDecision(input.messages.at(-1).content, requestedTools)
      : localDecision || await askLlama(input.messages, TOOL_MODE === 'llm' ? requestedTools : []);
    send(response, 200, decision, origin);
    console.log(JSON.stringify({ route: url.pathname, status: 200, ms: Date.now() - startedAt, mock: MOCK }));
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 502;
    const message = error instanceof Error ? error.message : '临时模型服务不可用';
    send(response, status, { error: message }, origin);
    console.error(JSON.stringify({ route: url.pathname, status, ms: Date.now() - startedAt, error: message }));
  }
});

server.listen(PORT, HOST, () => {
  console.log('PROTOTYPE ONLY — Uni 本地蒸馏模型网关');
  console.log(`Gateway: http://${HOST}:${PORT}`);
  console.log(`Mode: ${MOCK ? 'mock（不调用模型）' : 'llama.cpp upstream'}`);
  console.log('不会保存聊天内容；Ctrl+C 停止。');
});

async function askLlama(messages, toolNames) {
  const agentMode = toolNames.length > 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  let response;
  try {
    response = await fetch(LLAMA_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        temperature: 0,
        max_tokens: agentMode ? 220 : 512,
        reasoning_effort: 'none',
        chat_template_kwargs: { enable_thinking: false },
        ...(agentMode ? { response_format: { type: 'json_schema', schema: decisionSchema(toolNames) } } : {}),
        messages: [{ role: 'system', content: agentMode ? systemPrompt(toolNames) : chatPrompt() }, ...messages]
      })
    });
  } catch {
    throw new RequestError(502, '连接不到本机 llama-server');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new RequestError(502, `llama-server 返回 ${response.status}`);
  let payload;
  try { payload = await response.json(); }
  catch { throw new RequestError(502, 'llama-server 返回的不是 JSON'); }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new RequestError(502, '蒸馏模型没有返回内容');
  if (DEBUG) console.log(JSON.stringify({ prototypeDebug: true, modelOutput: content }));
  return agentMode ? normalizeDecision(content, toolNames) : messageDecision(content);
}

function chatPrompt() {
  return [
    '你是 Uni，一个面向大学生的简体中文聊天助手。',
    '回答要自然、简短、友好；不知道时明确说不知道。',
    '不要假装读取了课表、记事本或其他 App 数据，不要声称已经执行操作。',
    '不要索取教务密码、Cookie 或验证码。'
  ].join('\n');
}

function systemPrompt(toolNames) {
  const descriptions = {
    getSchedule: '查询本机课表。arguments: {"query":"next|today|tomorrow|week|free|conflicts|brief","date":"可选 YYYY-MM-DD"}',
    getNote: '查询本机记事。arguments: {"keyword":"可选","includeDone":false}',
    addNote: '新增普通记事。arguments: {"title":"标题","content":"可选"}',
    createReminder: '新增提醒。arguments: {"title":"标题","content":"可选","remindAt":"ISO 8601"}',
    getWeather: '读取天气。arguments: {"refresh":false}',
    openFeature: '打开页面。arguments: {"feature":"schedule|notes|weather|settings|secondClass|online"}'
  };
  const list = toolNames.map((name) => `- ${name}: ${descriptions[name]}`).join('\n') || '- 当前没有可用 Tool';
  return [
    '你是 Uni，一个面向大学生的简体中文助手。不要索取教务密码、Cookie 或验证码。',
    '始终只返回一个 JSON 对象，并且必须包含 type、content、call 三个字段。',
    '普通聊天：{"type":"message","content":"简短回答","call":{"name":"none","arguments":{}}}',
    '需要 App 数据或操作：{"type":"tool_call","content":"","call":{"name":"准确的 Tool 名","arguments":{}}}',
    '例：明天有什么课 -> {"type":"tool_call","content":"","call":{"name":"getSchedule","arguments":{"query":"tomorrow"}}}',
    '例：帮我记一下周五交高数作业 -> {"type":"tool_call","content":"","call":{"name":"addNote","arguments":{"title":"周五交高数作业"}}}',
    '例：打开记事本 -> {"type":"tool_call","content":"","call":{"name":"openFeature","arguments":{"feature":"notes"}}}',
    '不要声称 Tool 已执行；手机会校验参数并执行。一次最多选择一个 Tool。',
    '除 JSON 外不要输出 Markdown、代码围栏或解释。',
    `当前时间：${new Date().toISOString()}；用户时区：Asia/Shanghai。`,
    '可用 Tool：',
    list
  ].join('\n');
}

function decisionSchema(toolNames) {
  return {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['message', 'tool_call'] },
      content: { type: 'string', maxLength: 1200 },
      call: {
        type: 'object',
        properties: {
          name: { type: 'string', enum: ['none', ...toolNames] },
          arguments: {
            type: 'object',
            properties: {
              query: { type: 'string', enum: ['next', 'today', 'tomorrow', 'week', 'free', 'conflicts', 'brief'] },
              date: { type: 'string' },
              keyword: { type: 'string' },
              includeDone: { type: 'boolean' },
              title: { type: 'string' },
              content: { type: 'string' },
              remindAt: { type: 'string' },
              refresh: { type: 'boolean' },
              feature: { type: 'string', enum: ['schedule', 'notes', 'weather', 'settings', 'secondClass', 'online'] }
            },
            additionalProperties: false
          }
        },
        required: ['name', 'arguments'],
        additionalProperties: false
      }
    },
    required: ['type', 'content', 'call'],
    additionalProperties: false
  };
}

function normalizeDecision(raw, allowedTools) {
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const parsed = parseDecisionJson(cleaned);
  if (!parsed) return messageDecision(cleaned);
  if (parsed.type === 'message') return messageDecision(parsed.content);
  if (parsed.type !== 'tool_call') throw new RequestError(502, '模型返回了未知决策类型');
  const call = parsed.call || parsed;
  const name = String(call.name || '');
  const args = call.arguments;
  if (!allowedTools.includes(name) || !TOOL_NAMES.has(name)) throw new RequestError(502, '模型选择了未授权 Tool');
  if (!isObject(args)) throw new RequestError(502, '模型 Tool 参数必须是 JSON 对象');
  validateToolArguments(name, args);
  return {
    type: 'tool_call',
    call: { id: `local-${Date.now()}`, name, arguments: args },
    provider: 'local-distill-prototype'
  };
}

function routeBasicCommand(messages, allowedTools) {
  const text = messages.at(-1).content.trim();
  const toolCall = (name, args) => allowedTools.includes(name)
    ? { type: 'tool_call', call: { id: `hybrid-${Date.now()}`, name, arguments: args }, provider: 'local-distill-hybrid-router' }
    : null;
  const localMessage = (content) => ({ type: 'message', content, provider: 'local-distill-hybrid-router' });

  const pendingTitle = pendingNoteTitle(messages);
  if (pendingTitle && isNoteConfirmation(text)) {
    return toolCall('addNote', { title: pendingTitle })
      || localMessage('当前版本暂时不能加入记事本。');
  }
  if (pendingTitle && isNoteDecline(text)) return localMessage('好的，不加入记事本。');

  if (/^(?:你好|您好|嗨|hi|hello|在吗|你是谁)[!！?？。]*$/i.test(text)) {
    return localMessage('你好，我是 Uni。你可以问课表、记事、天气，也可以直接说准备做什么。');
  }
  if (/^(?:谢谢|感谢|多谢|辛苦了|好的|好|知道了|明白了)[!！。]*$/.test(text)) {
    return localMessage('不客气，有需要继续告诉我。');
  }
  if (/(?:你会什么|你能做什么|有什么功能|怎么用你)/.test(text)) {
    return localMessage('我可以帮你查课表、查记事、看天气、打开 App 功能，也能在你提到待办时先询问是否加入记事本。');
  }

  if (/明天.*(?:课|课程|课表)|(?:课|课程|课表).*明天/.test(text)) return toolCall('getSchedule', { query: 'tomorrow' });
  if (/今天.*(?:课|课程|课表)|(?:课|课程|课表).*今天/.test(text)) return toolCall('getSchedule', { query: 'today' });
  if (/本周|这周|一周/.test(text) && /课|课程|课表/.test(text)) return toolCall('getSchedule', { query: 'week' });
  if (/下一?节|接下来/.test(text) && /课|课程/.test(text)) return toolCall('getSchedule', { query: 'next' });

  const requestedNote = explicitNoteTitle(text);
  if (requestedNote) return noteProposal(requestedNote);
  if (/把刚才.*(?:记|写).*(?:记事|笔记)/.test(text)) {
    const previous = [...messages.slice(0, -1)].reverse().find((item) => item.role === 'user');
    if (previous?.content) return noteProposal(cleanNoteTitle(previous.content));
  }

  if (/(?:查询|搜索|查找|找).*(?:记事|笔记)|(?:记事|笔记).*(?:查询|搜索|查找)/.test(text)) {
    const keyword = text.replace(/查询|搜索|查找|找|记事本?|笔记|里|一下/g, '').trim();
    return toolCall('getNote', keyword ? { keyword, includeDone: false } : { includeDone: false });
  }
  if (/天气|气温|下雨/.test(text)) return toolCall('getWeather', { refresh: false });

  if (/打开|进入|跳转/.test(text)) {
    const feature = /记事|笔记/.test(text) ? 'notes'
      : /课表|课程/.test(text) ? 'schedule'
        : /天气/.test(text) ? 'weather'
          : /设置/.test(text) ? 'settings'
            : /第二课堂/.test(text) ? 'secondClass'
              : /在线|教务/.test(text) ? 'online'
                : '';
    if (feature) return toolCall('openFeature', { feature });
  }

  const plannedNote = plannedNoteTitle(text);
  if (plannedNote) return noteProposal(plannedNote);
  return null;
}

function noteProposal(title) {
  return {
    type: 'message',
    content: `要把“${title}”加入记事本吗？回复“是”确认，回复“否”取消。`,
    provider: 'local-distill-hybrid-router'
  };
}

function pendingNoteTitle(messages) {
  if (messages.length < 3) return '';
  const assistant = messages.at(-2);
  const original = messages.at(-3);
  if (assistant?.role !== 'assistant' || original?.role !== 'user') return '';
  const title = assistant.content.match(/^要把“([\s\S]{1,120})”加入记事本吗？回复“是”确认，回复“否”取消。$/)?.[1];
  return title ? cleanNoteTitle(title) : '';
}

function isNoteConfirmation(text) {
  return /^(?:是|好的?|好啊|可以|行|要|加入|确认|嗯+|对)(?:吧|的)?[。！!]*$/.test(text);
}

function isNoteDecline(text) {
  return /^(?:不|不要|不用|不加|否|算了|取消)(?:了)?[。！!]*$/.test(text);
}

function explicitNoteTitle(text) {
  const matched = text.match(/^(?:请|麻烦)?(?:帮我)?(?:记一下|记下|记住|添加?一?条?记事(?:本)?|加个记事)(?:[：:\s]+)?([\s\S]+)$/);
  return matched?.[1] ? cleanNoteTitle(matched[1]) : '';
}

function plannedNoteTitle(text) {
  const normalized = cleanNoteTitle(text);
  if (!normalized) return '';
  const action = /交|提交|完成|学习|复习|预习|写|做|准备|开会|报名|缴费|考试|答辩|汇报|联系|回复|发送|打印|预约|打卡|跑步|健身|买|取|拿|还|去/;
  const stated = normalized.match(/^(?:我)?(?:要|得|需要|准备|打算|计划|记得|别忘了)([\s\S]+)$/)?.[1]?.trim();
  if (stated && action.test(stated)) return cleanNoteTitle(stated);
  const hasTime = /今天|明天|后天|大后天|上午|中午|下午|晚上|今晚|周[一二三四五六日天]|星期[一二三四五六日天]|下周|月底|\d{1,2}月\d{1,2}日|\d{1,2}[点时]/.test(normalized);
  return hasTime && action.test(normalized) ? normalized : '';
}

function cleanNoteTitle(value) {
  return String(value || '').trim().replace(/[。！？!?；;]+$/, '').trim().slice(0, 120);
}

function validateToolArguments(name, args) {
  const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
  if (name === 'getSchedule' && args.query !== undefined && !['next', 'today', 'tomorrow', 'week', 'free', 'conflicts', 'brief'].includes(args.query)) {
    throw new RequestError(502, '模型课表查询参数无效');
  }
  if (name === 'addNote' && !hasText(args.title)) throw new RequestError(502, '模型记事标题无效');
  if (name === 'openFeature' && !['schedule', 'notes', 'weather', 'settings', 'secondClass', 'online'].includes(args.feature)) {
    throw new RequestError(502, '模型页面参数无效');
  }
  if (name === 'createReminder' && (!hasText(args.title) || !hasText(args.remindAt))) {
    throw new RequestError(502, '模型提醒参数无效');
  }
}

function parseDecisionJson(text) {
  try { return JSON.parse(text); } catch { /* 尝试截取最后一个 JSON 对象 */ }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    try { return JSON.parse(fenced.trim()); } catch { /* 再尝试平衡花括号 */ }
  }
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    const candidate = balancedJsonObject(text, start);
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch { /* 继续寻找下一个对象 */ }
  }
  return null;
}

function balancedJsonObject(text, start) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return '';
}

function messageDecision(content) {
  const text = String(content || '').trim().slice(0, 4000);
  if (!text) throw new RequestError(502, '蒸馏模型没有返回可用回答');
  return { type: 'message', content: text, provider: 'local-distill-prototype' };
}

function mockDecision(message, tools) {
  if (/明天.*课|课.*明天/.test(message) && tools.includes('getSchedule')) {
    return { type: 'tool_call', call: { id: 'mock-schedule', name: 'getSchedule', arguments: { query: 'tomorrow' } }, provider: 'prototype-mock' };
  }
  return { type: 'message', content: `临时模型原型已收到：${message}`, provider: 'prototype-mock' };
}

function validateInput(body) {
  if (!isObject(body)) throw new RequestError(400, '请求格式错误');
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 12) {
    throw new RequestError(400, '对话消息数量不允许');
  }
  let total = 0;
  const messages = body.messages.map((item) => {
    if (!isObject(item)) throw new RequestError(400, '对话消息格式错误');
    const role = item.role;
    const content = typeof item.content === 'string' ? item.content.trim() : '';
    if ((role !== 'user' && role !== 'assistant') || !content || content.length > 500) {
      throw new RequestError(400, '对话消息格式错误');
    }
    total += content.length;
    return { role, content };
  });
  if (total > 6000 || messages.at(-1).role !== 'user') throw new RequestError(400, '对话上下文不允许');
  const toolNames = Array.isArray(body.toolNames)
    ? [...new Set(body.toolNames.filter((name) => typeof name === 'string'))].slice(0, 32)
    : [];
  return { messages, toolNames };
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new RequestError(413, '请求体过大');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RequestError(400, '请求不是有效 JSON'); }
}

function withinRate(key) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  current.count += 1;
  return current.count <= MAX_REQUESTS;
}

function clientKey(request) {
  return String(request.headers['cf-connecting-ip'] || request.headers['x-forwarded-for'] || request.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function allowedOrigin(origin, host) {
  if (!origin) return '';
  if (origin === 'https://localhost' || origin === 'https://unimate3.pages.dev') return origin;
  if (/^http:\/\/localhost(?::\d+)?$/.test(origin)) return origin;
  if (host && (origin === `http://${host}` || origin === `https://${host}`)) return origin;
  const extra = String(process.env.PROTOTYPE_ALLOWED_ORIGINS || '').split(',').map((item) => item.trim());
  return extra.includes(origin) ? origin : null;
}

function prototypePage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Uni 临时 Agent</title>
  <style>
    :root{color-scheme:dark;font-family:system-ui,sans-serif;background:#111426;color:#f8f7ff}
    body{margin:0;display:grid;place-items:center;min-height:100vh;background:radial-gradient(circle at 80% 10%,#34306f 0,transparent 35%),#111426}
    main{width:min(680px,calc(100% - 32px));padding:24px;border:1px solid #ffffff20;border-radius:22px;background:#1a1e35ee;box-shadow:0 24px 60px #0007}
    h1{margin:0 0 6px;font-size:24px}.hint{margin:0 0 18px;color:#b9b9cc;font-size:14px;line-height:1.6}
    #chat{height:46vh;min-height:280px;overflow:auto;padding:14px;border-radius:16px;background:#0e1122;white-space:pre-wrap}
    .row{margin:8px 0;padding:10px 12px;border-radius:13px;line-height:1.55}.user{margin-left:15%;background:#635bdb}.uni{margin-right:10%;background:#262b4b}.tool{margin-right:4%;background:#173f38;color:#c7fff2}
    form{display:flex;gap:9px;margin-top:14px}input{flex:1;min-width:0;padding:13px;border:1px solid #ffffff25;border-radius:12px;background:#101328;color:#fff;font-size:16px}
    button{padding:0 18px;border:0;border-radius:12px;background:#8178ff;color:#fff;font-weight:700}button:disabled{opacity:.5}
  </style>
</head>
<body><main>
  <h1>🌙 Uni 临时 Agent</h1>
  <p class="hint">DeepSeek 1.5B 本机原型。基础 Tool 只显示结构化 JSON，不会改动 App 数据。</p>
  <div id="chat"><div class="row uni">可以试试：你好 / 明天有什么课 / 帮我记一下周五交高数作业 / 打开记事本</div></div>
  <form id="form"><input id="input" maxlength="500" autocomplete="off" placeholder="输入消息…"><button id="send">发送</button></form>
</main><script>
const chat=document.querySelector('#chat'),form=document.querySelector('#form'),input=document.querySelector('#input'),send=document.querySelector('#send');
const messages=[];const tools=['getSchedule','getNote','addNote','createReminder','getWeather','openFeature'];
function add(text,kind){const div=document.createElement('div');div.className='row '+kind;div.textContent=text;chat.append(div);chat.scrollTop=chat.scrollHeight}
form.addEventListener('submit',async event=>{event.preventDefault();const text=input.value.trim();if(!text)return;input.value='';add(text,'user');messages.push({role:'user',content:text});send.disabled=true;
try{const res=await fetch('/v1/agent/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:messages.slice(-12),toolNames:tools})});const data=await res.json();if(!res.ok)throw new Error(data.error||('HTTP '+res.status));
if(data.type==='tool_call'){const shown='Tool Call\\n'+JSON.stringify(data.call,null,2);add(shown,'tool');messages.push({role:'assistant',content:shown})}else{add(data.content,'uni');messages.push({role:'assistant',content:data.content})}}
catch(error){add('请求失败：'+error.message,'uni')}finally{send.disabled=false;input.focus()}});
</script></body></html>`;
}

function sendHtml(response, html) {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'"
  });
  response.end(html);
}

function preflight(response, origin) {
  response.writeHead(204, {
    'Access-Control-Allow-Origin': origin || 'https://localhost',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin'
  });
  response.end();
}

function send(response, status, payload, origin) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin'
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  response.writeHead(status, headers);
  response.end(JSON.stringify(payload));
}

function redactUrl(value) {
  try { const url = new URL(value); return `${url.protocol}//${url.host}${url.pathname}`; }
  catch { return 'invalid'; }
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
