import { AwsClient } from 'aws4fetch';

const MAX_CIPHER_BYTES = 30 * 1024 * 1024;
const EXPIRES_SECONDS = 15 * 60;
const CONTENT_TYPE = 'application/vnd.unimate.sync+json';
/** v2.43 账号备份正文（客户端上传的是备份 zip 原文） */
const BACKUP_CONTENT_TYPE = 'application/octet-stream';

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.APP_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);
  return !origin || allowed.includes(origin) ? origin : null;
}

function headers(origin) {
  const h = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  if (origin) h.set('Access-Control-Allow-Origin', origin);
  h.set('Vary', 'Origin');
  return h;
}

function json(value, status, origin) {
  return new Response(JSON.stringify(value), { status, headers: headers(origin) });
}

function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function objectKey(syncId, pepper) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(syncId));
  return 'v1/' + hex(new Uint8Array(digest)) + '.umig';
}

/* ---------------------------------------------------------------------------
 * v2.43：账号登录（服务器托管）
 *
 * 产品负责人明确撤销了"数据只在本机 / 只上传密文"这条口径，要求做成"账号登录 + 云端存数据、
 * 换台手机登录就有课表"。于是这一版新增账号 API。三件事必须说清楚：
 *  1) 服务端**存的是备份正文**（不是密文），落盘时用 DATA_KEY 做 AES-256-GCM 加密；
 *     设了 DATA_KEY 就是"服务器持有钥匙"—— 换来的是**忘记口令时开发者能帮着重置**（普通 App 的做法）。
 *  2) 口令本身**不上传**：客户端先做 210k 次 PBKDF2 派生出一个 verifier，只把 verifier 发上来，
 *     服务端再存 `sha256(服务器盐 + verifier)`。所以即使 R2 里的记录被拖走，攻击者拿到的是
 *     "还要再爆破一轮"的东西，而不是口令原文。
 *  3) 账号记录与数据对象都放在**已有的 R2 桶**里（`acct/`、`data/` 前缀），不新增 D1/KV 绑定 ——
 *     Worker 只需重新 deploy，不需要新开服务、不需要新的 storage 绑定。
 * 注意：R2 在 Cloudflare（境外）。面向真实用户运营前要么换境内存储，要么按要求处理数据出境。
 * ------------------------------------------------------------------------- */

const TOKEN_TTL_MS = 90 * 24 * 3600 * 1000;
const MAX_BACKUP_BYTES = 30 * 1024 * 1024;
/** verifier = base64url(32 字节) = 43 字符 */
const VERIFIER_RE = /^[A-Za-z0-9_-]{43}$/;

/** 与客户端 `normalizeAccount` 必须完全一致，否则"同一个账号在两处算成两个人" */
function normAccount(raw) {
  return String(raw || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function badAccount(name) {
  if (name.length < 3) return '账号至少 3 个字符';
  if (name.length > 64) return '账号最长 64 个字符';
  if (/[\u0000-\u001f\u007f]/.test(name)) return '账号含有不允许的字符';
  return '';
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))));
}

async function sha256Hex(text) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

/** 记录对象名：账号名不落盘，只留 HMAC(pepper, 归一化账号) */
function accountObjectKey(env, name) {
  return hmacHex(env.SYNC_OBJECT_PEPPER, 'acct:' + name).then((digest) => 'acct/' + digest + '.json');
}

function backupObjectKey(id) {
  return 'data/' + id + '.bin';
}

function s3(env) {
  return new AwsClient({ service: 's3', region: 'auto',
    accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY });
}

function objectUrl(env, key) {
  return 'https://' + env.R2_ACCOUNT_ID + '.r2.cloudflarestorage.com/' +
    encodeURIComponent(env.R2_BUCKET_NAME) + '/' + key;
}

async function r2Object(env, key, init) {
  return s3(env).fetch(objectUrl(env, key), init);
}

async function readRecord(env, name) {
  const response = await r2Object(env, await accountObjectKey(env, name), { method: 'GET' });
  if (response.status === 404) return null;1
  if (!response.ok) throw new Error('读取账号记录失败（' + response.status + '）');
  try { return await response.json(); } catch { throw new Error('账号记录损坏'); }
}

async function writeRecord(env, name, record) {
  const response = await r2Object(env, await accountObjectKey(env, name), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record)
  });
  if (!response.ok) throw new Error('写入账号记录失败（' + response.status + '）');
}

/**
 * 落盘加密：设了 DATA_KEY 就是"服务器持有钥匙"（可读、可帮着重置），没设就原样存（由 R2 自带静态加密兜底）。
 * 注意：crypto.subtle.encrypt 要的是 CryptoKey，不是裸字节 —— 必须先 importKey（这里被单测抓过一次）。
 */
async function atRestKey(env, usage) {
  if (!env.DATA_KEY) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.DATA_KEY));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [usage]);
}

async function sealBackup(env, bytes) {
  const key = await atRestKey(env, 'encrypt');
  if (!key) return { body: bytes, contentType: BACKUP_CONTENT_TYPE, sealed: false };
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, bytes));
  return { body: new TextEncoder().encode(JSON.stringify({ v: 1, alg: 'AES-256-GCM', nonce: hex(nonce), ct: hex(ct) })),
    contentType: 'application/json', sealed: true };
}

async function openBackup(env, bytes) {
  const text = new TextDecoder().decode(bytes);
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* 未加密的原始备份 */ }
  if (!parsed || parsed.alg !== 'AES-256-GCM' || typeof parsed.ct !== 'string') return bytes;
  const key = await atRestKey(env, 'decrypt');
  if (!key) throw new Error('服务端缺少 DATA_KEY，无法读取这份备份');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(parsed.nonce) }, key, unhex(parsed.ct));
  return new Uint8Array(plain);
}

function unhex(text) {
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 会话令牌只发一次，服务端只存它的哈希（记录泄露也换不来一个能用的 token） */
async function newSession() {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const token = b64url(raw);
  return { token, tokenHash: await sha256Hex(token), expiresAt: Date.now() + TOKEN_TTL_MS };
}

function b64url(bytes) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function withinRate(request, env) {
  if (!env.SYNC_RATE_LIMITER) return true;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const limited = await env.SYNC_RATE_LIMITER.limit({ key: ip });
  return limited.success;
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

const AGENT_TOOLS = [
  { type: 'function', function: { name: 'getSchedule', description: '查询手机本机课表。', parameters: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', enum: ['next', 'today', 'tomorrow', 'week', 'free', 'conflicts', 'brief'] }, date: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'getNote', description: '查询手机本机记事或待办。', parameters: { type: 'object', additionalProperties: false, properties: { keyword: { type: 'string' }, includeDone: { type: 'boolean' } } } } },
  { type: 'function', function: { name: 'addNote', description: '在手机本机新增一条不带提醒时间的记事。', parameters: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, content: { type: 'string' } }, required: ['title'] } } },
  { type: 'function', function: { name: 'createReminder', description: '在手机本机新增一条带提醒时间的记事。remindAt 使用 ISO 8601。', parameters: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, content: { type: 'string' }, remindAt: { type: 'string' } }, required: ['title', 'remindAt'] } } },
  { type: 'function', function: { name: 'getWeather', description: '读取手机本机缓存天气，必要时按现有开关刷新。', parameters: { type: 'object', additionalProperties: false, properties: { refresh: { type: 'boolean' } } } } },
  { type: 'function', function: { name: 'openFeature', description: '打开 App 内的指定功能。', parameters: { type: 'object', additionalProperties: false, properties: { feature: { type: 'string', enum: ['schedule', 'notes', 'weather', 'settings', 'secondClass', 'online'] } }, required: ['feature'] } } }
];

const DEFAULT_WORKERS_AI_MODEL = '@cf/zai-org/glm-4.7-flash';

/**
 * 在线模式只接收用户主动输入的文字。Workers AI 只做理解、规划和 Tool Calling；
 * Tool 最终仍由 Android 校验参数并在本机执行，模型名不进入 APK。
 */
async function agentChat(request, env, origin) {
  if (!(await withinRate(request, env))) return json({ error: '请求过于频繁，请稍后再试' }, 429, origin);
  if (!env.AI || typeof env.AI.run !== 'function') {
    return json({ error: 'Workers AI 尚未绑定' }, 503, origin);
  }
  const body = await readJson(request);
  const input = Array.isArray(body?.messages) ? body.messages : [];
  if (!input.length || input.length > 12) return json({ error: '对话消息数量不允许' }, 400, origin);
  let total = 0;
  const messages = [];
  for (const item of input) {
    const role = item?.role;
    const content = typeof item?.content === 'string' ? item.content.trim() : '';
    if ((role !== 'user' && role !== 'assistant') || !content || content.length > 500) {
      return json({ error: '对话消息格式错误' }, 400, origin);
    }
    total += content.length;
    messages.push({ role, content });
  }
  if (total > 6000 || messages[messages.length - 1].role !== 'user') {
    return json({ error: '对话上下文不允许' }, 400, origin);
  }
  const requested = new Set(Array.isArray(body?.toolNames) ? body.toolNames.filter((name) => typeof name === 'string') : []);
  const tools = AGENT_TOOLS.filter((item) => requested.size === 0 || requested.has(item.function.name));
  const system = '你是 Uni，高校学生的任务型助手。使用简体中文。需要课表、记事、天气或页面跳转时必须选择提供的 Tool，并只输出结构化 Tool Call；不要声称已经读取数据或执行成功，Android 会在本机校验和执行。不要索取教务密码、Cookie、验证码。普通学习生活交流可以直接回答。一次只选择一个最合适的 Tool。';
  const model = String(env.WORKERS_AI_MODEL || DEFAULT_WORKERS_AI_MODEL);
  let timer;
  let result;
  try {
    result = await Promise.race([
      env.AI.run(model, {
        messages: [{ role: 'system', content: system }, ...messages],
        tools,
        tool_choice: 'auto',
        parallel_tool_calls: false,
        temperature: 0.2,
        max_completion_tokens: 800
      }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Workers AI timeout')), 25000); })
    ]);
  } catch (error) {
    const limited = /(?:429|quota|rate|limit|neuron)/i.test(String(error?.message || error || ''));
    return json({ error: limited ? 'Workers AI 免费额度暂时用完' : 'Workers AI 暂时无法连接' }, limited ? 429 : 502, origin);
  } finally { clearTimeout(timer); }
  const message = result?.choices?.[0]?.message;
  const toolCall = Array.isArray(message?.tool_calls) ? message.tool_calls[0] : null;
  if (toolCall?.type === 'function' && typeof toolCall.function?.name === 'string') {
    if (!tools.some((item) => item.function.name === toolCall.function.name)) return json({ error: 'Workers AI 选择了未授权 Tool' }, 502, origin);
    let args;
    try {
      args = toolCall.function.arguments && typeof toolCall.function.arguments === 'object'
        ? toolCall.function.arguments
        : JSON.parse(toolCall.function.arguments || '{}');
    }
    catch { return json({ error: 'Workers AI Tool 参数不是有效 JSON' }, 502, origin); }
    if (!args || typeof args !== 'object' || Array.isArray(args)) return json({ error: 'Workers AI Tool 参数必须是对象' }, 502, origin);
    return json({ type: 'tool_call', call: { id: String(toolCall.id || crypto.randomUUID()), name: toolCall.function.name, arguments: args }, provider: 'workers-ai' }, 200, origin);
  }
  const content = typeof message?.content === 'string' ? message.content.trim() : '';
  if (!content) return json({ error: 'Workers AI 没有返回内容' }, 502, origin);
  return json({ type: 'message', content: content.slice(0, 4000), provider: 'workers-ai' }, 200, origin);
}

/** 鉴权：`?account=` 定位记录 + `Authorization: Bearer <token>` 换会话 */
async function authorize(request, env, url) {
  const name = normAccount(url.searchParams.get('account') || '');
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!name || !token) return { error: json({ error: '请先登录' }, 401, '') };
  const record = await readRecord(env, name);
  if (!record) return { error: json({ error: '账号不存在或已被注销' }, 404, '') };
  const session = record.session;
  if (!session || session.expiresAt < Date.now() || session.tokenHash !== await sha256Hex(token)) {
    return { error: json({ error: '登录已过期，请重新登录' }, 401, '') };
  }
  return { record, name };
}

async function signup(request, env, origin) {
  if (!(await withinRate(request, env))) return json({ error: '请求过于频繁' }, 429, origin);
  const body = await readJson(request);
  if (!body) return json({ error: '请求格式错误' }, 400, origin);
  const name = normAccount(body.account);
  const complaint = badAccount(name);
  if (complaint) return json({ error: complaint }, 400, origin);
  if (!VERIFIER_RE.test(String(body.verifier || ''))) return json({ error: '口令校验值格式不正确' }, 400, origin);

  const existing = await readRecord(env, name);
  if (existing) return json({ error: '这个账号已经注册过了，直接登录吧' }, 409, origin);

  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const session = await newSession();
  const record = {
    v: 1, id: hex(crypto.getRandomValues(new Uint8Array(16))), account: name,
    salt, verifierHash: await sha256Hex(salt + ':' + body.verifier),
    createdAt: new Date().toISOString(), updatedAt: '', size: 0,
    session: { tokenHash: session.tokenHash, expiresAt: session.expiresAt }
  };
  await writeRecord(env, name, record);
  return json({ account: name, id: record.id, token: session.token, updatedAt: '', size: 0 }, 201, origin);
}

async function login(request, env, origin) {
  if (!(await withinRate(request, env))) return json({ error: '请求过于频繁' }, 429, origin);
  const body = await readJson(request);
  if (!body) return json({ error: '请求格式错误' }, 400, origin);
  const name = normAccount(body.account);
  if (badAccount(name)) return json({ error: '账号或口令不正确' }, 401, origin);
  if (!VERIFIER_RE.test(String(body.verifier || ''))) return json({ error: '账号或口令不正确' }, 401, origin);

  const record = await readRecord(env, name);
  if (!record) return json({ error: '账号或口令不正确' }, 401, origin);
  if (record.verifierHash !== await sha256Hex(record.salt + ':' + body.verifier)) {
    return json({ error: '账号或口令不正确' }, 401, origin);
  }
  const session = await newSession();
  record.session = { tokenHash: session.tokenHash, expiresAt: session.expiresAt };
  await writeRecord(env, name, record);
  return json({ account: name, id: record.id, token: session.token, updatedAt: record.updatedAt || '', size: record.size || 0 }, 200, origin);
}

async function accountInfo(request, env, url, origin) {
  const auth = await authorize(request, env, url);
  if (auth.error) return auth.error;
  const { record } = auth;
  return json({ account: record.account, id: record.id, updatedAt: record.updatedAt || '', size: record.size || 0, sealed: !!env.DATA_KEY }, 200, origin);
}

/**
 * v2.51 **用户自己改密码**（管理页那句"让他改成自己的密码"要能兑现）。
 *
 * 设计取舍：**不需要会话令牌，只要当前密码**（`oldVerifier`）。
 * 因为管理员重置之后旧令牌已经作废 —— 用户这时手里只有管理员给的临时密码，
 * 用"当前密码"验证才走得通；改成功顺便发一个新令牌回来，客户端直接换成新会话。
 */
async function passwordChange(request, env, origin) {
  if (!(await withinRate(request, env))) return json({ error: '请求过于频繁' }, 429, origin);
  const body = await readJson(request);
  if (!body) return json({ error: '请求格式错误' }, 400, origin);
  const name = normAccount(body.account);
  if (badAccount(name)) return json({ error: '账号或密码不正确' }, 401, origin);
  const oldVerifier = String(body.oldVerifier || '');
  const newVerifier = String(body.newVerifier || '');
  if (!VERIFIER_RE.test(oldVerifier) || !VERIFIER_RE.test(newVerifier)) {
    return json({ error: '口令校验值格式不正确' }, 400, origin);
  }
  if (oldVerifier === newVerifier) return json({ error: '新密码不能和当前密码一样' }, 400, origin);

  const record = await readRecord(env, name);
  if (!record) return json({ error: '账号或密码不正确' }, 401, origin);
  if (record.verifierHash !== await sha256Hex(record.salt + ':' + oldVerifier)) {
    return json({ error: '当前密码不正确' }, 401, origin);
  }

  record.verifierHash = await sha256Hex(record.salt + ':' + newVerifier);
  record.passwordChangedAt = new Date().toISOString();
  const session = await newSession();              // 换密码顺手换令牌：别的地方的旧会话立即失效
  record.session = { tokenHash: session.tokenHash, expiresAt: session.expiresAt };
  await writeRecord(env, name, record);
  return json({ account: name, id: record.id, token: session.token,
    updatedAt: record.updatedAt || '', size: record.size || 0 }, 200, origin);
}

async function accountDelete(request, env, url, origin) {
  const auth = await authorize(request, env, url);
  if (auth.error) return auth.error;
  const { record } = auth;
  await r2Object(env, backupObjectKey(record.id), { method: 'DELETE' });
  await r2Object(env, await accountObjectKey(env, record.account), { method: 'DELETE' });
  return json({ ok: true, deleted: 1 }, 200, origin);
}

async function backupPut(request, env, url, origin) {
  const auth = await authorize(request, env, url);
  if (auth.error) return auth.error;
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return json({ error: '备份内容为空' }, 400, origin);
  if (bytes.length > MAX_BACKUP_BYTES) return json({ error: '备份超过 30 MB 上限' }, 413, origin);
  const { record } = auth;
  const sealedBody = await sealBackup(env, bytes);
  const put = await r2Object(env, backupObjectKey(record.id), {
    method: 'PUT', headers: { 'Content-Type': sealedBody.contentType }, body: sealedBody.body
  });
  if (!put.ok) return json({ error: '写入云端备份失败（' + put.status + '）' }, 502, origin);
  record.updatedAt = new Date().toISOString();
  record.size = bytes.length;
  await writeRecord(env, record.account, record);
  return json({ ok: true, updatedAt: record.updatedAt, size: record.size, sealed: sealedBody.sealed }, 200, origin);
}

async function backupGet(request, env, url, origin) {
  const auth = await authorize(request, env, url);
  if (auth.error) return auth.error;
  const { record } = auth;
  const got = await r2Object(env, backupObjectKey(record.id), { method: 'GET' });
  if (got.status === 404) return json({ error: '这个账号还没有云端备份' }, 404, origin);
  if (!got.ok) return json({ error: '读取云端备份失败（' + got.status + '）' }, 502, origin);
  let bytes;
  try { bytes = await openBackup(env, new Uint8Array(await got.arrayBuffer())); }
  catch (e) { return json({ error: e.message || '云端备份无法读取' }, 500, origin); }
  const h = headers(origin);
  h.set('Content-Type', BACKUP_CONTENT_TYPE);
  h.set('X-Unimate-Updated-At', record.updatedAt || '');
  return new Response(bytes, { status: 200, headers: h });
}

/* ---------------------------------------------------------------------------
 * v2.50 管理员：给"忘了密码找管理员重置"做一个人工入口（电脑/手机浏览器都能开）。
 *
 * 边界（刻意的）：
 *  · 只有**重置密码**和**列账号名单**两个能力，**没有**下载用户数据、没有改环境的接口；
 *  · 管理员密钥是单独的 secret `ADMIN_KEY`，没设就整个管理员接口 503；
 *  · 新密码的 verifier 由**管理员浏览器**算（PBKDF2 210k 在浏览器里跑，不占 Worker 的 CPU 额度），
 *    服务端只把 `sha256(盐 + verifier)` 换掉，并且顺手清掉该账号的会话令牌（被重置的设备必须重新登录）。
 * ------------------------------------------------------------------------- */

function normAccountForAdmin(raw) {
  return String(raw || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function adminGuard(request, env, body) {
  if (!env.ADMIN_KEY) return json({ error: '这个部署没有配置管理员密钥（secret ADMIN_KEY）' }, 503, '');
  const key = String((body && body.key) || request.headers.get('X-Unimate-Admin') || '');
  if (!key || key !== env.ADMIN_KEY) return json({ error: '管理员密钥不正确' }, 403, '');
  return null;
}

/** R2 的 ListObjectsV2：列出所有账号记录对象（不需要自己维护索引，也就没有并发写索引的问题） */
async function listAccountKeys(env) {
  const url = 'https://' + env.R2_ACCOUNT_ID + '.r2.cloudflarestorage.com/' +
    encodeURIComponent(env.R2_BUCKET_NAME) + '?list-type=2&prefix=' + encodeURIComponent('acct/') + '&max-keys=1000';
  const res = await s3(env).fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error('列出账号失败（' + res.status + '）');
  const xml = await res.text();
  return Array.from(xml.matchAll(/<Key>([^<]+)<\/Key>/g)).map((m) => m[1]);
}

async function adminList(request, env, origin) {
  const body = await readJson(request);
  const denied = adminGuard(request, env, body);
  if (denied) return denied;
  try {
    const keys = await listAccountKeys(env);
    const accounts = [];
    for (const key of keys) {
      const res = await r2Object(env, key, { method: 'GET' });
      if (!res.ok) continue;
      try {
        const rec = await res.json();
        if (rec && rec.account) {
          accounts.push({ account: rec.account, updatedAt: rec.updatedAt || '', size: rec.size || 0 });
        }
      } catch { /* 坏记录跳过 */ }
    }
    accounts.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return json({ ok: true, accounts }, 200, origin);
  } catch (e) {
    return json({ error: e.message || '列出账号失败' }, 502, origin);
  }
}

async function adminReset(request, env, origin) {
  const body = await readJson(request);
  const denied = adminGuard(request, env, body);
  if (denied) return denied;
  const name = normAccountForAdmin(body && body.account);
  if (badAccount(name)) return json({ error: '账号格式不正确' }, 400, origin);
  if (!VERIFIER_RE.test(String((body && body.verifier) || ''))) return json({ error: '口令校验值格式不正确' }, 400, origin);
  try {
    const record = await readRecord(env, name);
    if (!record) return json({ error: '这个账号不存在' }, 404, origin);
    record.verifierHash = await sha256Hex(record.salt + ':' + body.verifier);
    record.session = null;                       // 被重置之后，旧设备的令牌立即失效
    record.passwordResetAt = new Date().toISOString();
    await writeRecord(env, name, record);
    return json({ ok: true, account: name, resetAt: record.passwordResetAt }, 200, origin);
  } catch (e) {
    return json({ error: e.message || '重置失败' }, 502, origin);
  }
}

/** 管理员页面（单文件、无外部依赖；手机和电脑都能开） */
const ADMIN_PAGE = [
  '<!doctype html><html lang="zh"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<title>Unimate 管理员</title><style>',
  'body{margin:0;padding:16px;font:15px/1.6 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#F5F7FA;color:#1B1F27}',
  'h1{font-size:18px;margin:4px 0 10px}',
  '.card{background:#fff;border-radius:12px;padding:14px;box-shadow:0 2px 10px rgba(20,24,31,.06);margin-bottom:12px}',
  'input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #D8DEE7;border-radius:9px;font:inherit;margin:6px 0}',
  'button{padding:10px 14px;border:0;border-radius:9px;font:inherit;font-weight:600;background:#2E5AAC;color:#fff}',
  'button.grey{background:#EDF0F5;color:#1B1F27}',
  'table{width:100%;border-collapse:collapse;font-size:13px}',
  'td,th{padding:8px 6px;border-bottom:1px solid #EEF1F6;text-align:left;word-break:break-all}',
  '.muted{color:#6B7482;font-size:12px}',
  '.ok{color:#1B7F3B}.bad{color:#B42318}',
  '</style></head><body>',
  '<h1>Unimate 管理员</h1>',
  '<div class="card"><div class="muted">用于给<b>忘记密码</b>的用户重置密码。<b>看不到用户数据</b>，只有这一件事。</div>',
  '<input id="key" type="password" placeholder="管理员密钥（ADMIN_KEY）" autocomplete="off">',
  '<button id="list">列出账号</button> <button class="grey" id="clear">清除本机保存的密钥</button>',
  '<div id="out" class="muted"></div></div>',
  '<div class="card"><div id="rows" class="muted">先输入密钥并点「列出账号」。</div></div>',
  '<script>',
  'var KEY="unimate-admin-key";',
  'function b64url(buf){var b=new Uint8Array(buf),s="";for(var i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);',
  'return btoa(s).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");}',
  'function norm(a){return String(a||"").normalize("NFKC").trim().replace(/\\s+/g," ").toLowerCase();}',
  'async function verifierOf(account,password){',
  'var salt=new TextEncoder().encode("unimate-auth-v1\\u0000"+norm(account));',
  'var km=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),{name:"PBKDF2"},false,["deriveBits"]);',
  'var bits=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:salt,iterations:210000},km,256);',
  'return b64url(bits);}',
  'var $=function(id){return document.getElementById(id)};',
  'function say(t,bad){$("out").innerHTML=\'<span class="\'+(bad?"bad":"ok")+\'">\'+t+\'</span>\';}',
  'async function post(path,body){var r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});',
  'var j=null;try{j=await r.json()}catch(e){} return {ok:r.ok,status:r.status,body:j||{}};}',
  'function render(list){var rows=$("rows");if(!list.length){rows.textContent="还没有账号。";return;}',
  'rows.innerHTML="<table><tr><th>账号</th><th>云端备份</th><th></th></tr>"+list.map(function(a){',
  'return "<tr><td>"+a.account+"</td><td>"+(a.size?Math.round(a.size/1024)+" KB · "+a.updatedAt:"还没上传" )+"</td>"+',
  '"<td><button data-a=\\""+a.account+"\\">重置密码</button></td></tr>"}).join("")+"</table>";',
  'rows.querySelectorAll("button").forEach(function(b){b.onclick=function(){reset(b.getAttribute("data-a"))}});}',
  'async function list(){var k=$("key").value.trim();if(!k){say("先填管理员密钥",1);return;}',
  'localStorage.setItem(KEY,k);say("查询中…");',
  'var r=await post("/v1/admin/list",{key:k});',
  'if(!r.ok){say(r.body.error||("失败 "+r.status),1);return;}',
  'say("共 "+r.body.accounts.length+" 个账号");render(r.body.accounts);}',
  'async function reset(account){var k=localStorage.getItem(KEY)||$("key").value.trim();',
  'var p=prompt("给 "+account+" 设置新密码（至少 8 位，请当面告知用户）");if(!p)return;',
  'if(p.length<8){say("密码至少 8 位",1);return;}say("正在重置 "+account+"…");',
  'var v=await verifierOf(account,p);',
  'var r=await post("/v1/admin/reset",{key:k,account:account,verifier:v});',
  'if(!r.ok){say(r.body.error||("失败 "+r.status),1);return;}',
  // v2.51 起 App 里真的有「修改密码」了，这句可以放心写
  'say("已重置 "+account+" —— 把新密码告诉用户；他在 App 的「账号与找回 → 修改密码」里换成自己的密码即可。");}',
  '$("list").onclick=list;',
  '$("clear").onclick=function(){localStorage.removeItem(KEY);$("key").value="";say("已清除本机保存的密钥");};',
  '$("key").value=localStorage.getItem(KEY)||"";',
  'if($("key").value)list();',
  '</script></body></html>'
].join('');

function adminPage() {
  return new Response(ADMIN_PAGE, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (origin === null) return json({ error: '来源不允许' }, 403, '');
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      const h = headers(origin);
      h.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      h.set('Access-Control-Max-Age', '86400');
      return new Response(null, { status: 204, headers: h });
    }
    if (url.pathname === '/health' && request.method === 'GET') {
      // atRest 告诉客户端：服务端有没有启用落盘加密（DATA_KEY）
      return json({ ok: true, service: 'unimate-sync', atRest: !!env.DATA_KEY, accounts: true,
        agent: 'workers-ai', agentReady: !!env.AI, agentModel: String(env.WORKERS_AI_MODEL || DEFAULT_WORKERS_AI_MODEL) }, 200, origin);
    }

    // v2.43 账号登录（服务器托管）：注册 / 登录 / 账号信息 / 注销 / 备份读写
    if (url.pathname === '/v1/signup' && request.method === 'POST') return signup(request, env, origin);
    if (url.pathname === '/v1/login' && request.method === 'POST') return login(request, env, origin);
    if (url.pathname === '/v1/account' && request.method === 'GET') return accountInfo(request, env, url, origin);
    if (url.pathname === '/v1/account' && request.method === 'DELETE') return accountDelete(request, env, url, origin);
    if (url.pathname === '/v1/password' && request.method === 'POST') return passwordChange(request, env, origin);
    if (url.pathname === '/v1/backup' && request.method === 'PUT') return backupPut(request, env, url, origin);
    if (url.pathname === '/v1/backup' && request.method === 'GET') return backupGet(request, env, url, origin);
    if (url.pathname === '/v1/agent/chat' && request.method === 'POST') return agentChat(request, env, origin);

    // v2.50 管理员：页面 + 两个接口（列账号 / 重置密码）
    if (url.pathname === '/admin' && request.method === 'GET') return adminPage();
    if (url.pathname === '/v1/admin/list' && request.method === 'POST') return adminList(request, env, origin);
    if (url.pathname === '/v1/admin/reset' && request.method === 'POST') return adminReset(request, env, origin);

    if (url.pathname !== '/v1/presign' || request.method !== 'POST') return json({ error: 'not found' }, 404, origin);

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (env.SYNC_RATE_LIMITER) {
      const limited = await env.SYNC_RATE_LIMITER.limit({ key: ip });
      if (!limited.success) return json({ error: '请求过于频繁' }, 429, origin);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: '请求格式错误' }, 400, origin); }
    const syncId = String(body.syncId || '');
    const operation = body.operation;
    if (!/^[A-Za-z0-9_-]{22}$/.test(syncId)) return json({ error: '同步码格式错误' }, 400, origin);
    if (operation !== 'get' && operation !== 'put') return json({ error: '操作不允许' }, 400, origin);
    if (operation === 'put' && (!Number.isInteger(body.size) || body.size < 1 || body.size > MAX_CIPHER_BYTES)) {
      return json({ error: '同步包大小不允许' }, 413, origin);
    }
    if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.SYNC_OBJECT_PEPPER) {
      return json({ error: '同步服务尚未完成密钥配置' }, 503, origin);
    }

    const key = await objectKey(syncId, env.SYNC_OBJECT_PEPPER);
    const endpoint = 'https://' + env.R2_ACCOUNT_ID + '.r2.cloudflarestorage.com/' +
      encodeURIComponent(env.R2_BUCKET_NAME) + '/' + key + '?X-Amz-Expires=' + EXPIRES_SECONDS;
    const client = new AwsClient({ service: 's3', region: 'auto', accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY });
    const method = operation === 'put' ? 'PUT' : 'GET';
    const requestInit = operation === 'put' ? { method, headers: { 'Content-Type': CONTENT_TYPE } } : { method };
    const signed = await client.sign(new Request(endpoint, requestInit), { aws: { signQuery: true } });
    return json({
      url: signed.url.toString(), method, expiresAt: new Date(Date.now() + EXPIRES_SECONDS * 1000).toISOString(),
      headers: operation === 'put' ? { 'Content-Type': CONTENT_TYPE } : {}
    }, 200, origin);
  }
};
