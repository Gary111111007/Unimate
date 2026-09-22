/**
 * Pages（Advanced Mode）入口：把同步 API 搬到 **pages.dev 域名**上（v2.39）。
 *
 * 为什么必须这么做（都有实测依据）：
 *  1) `*.workers.dev` 在大陆**被 DNS 污染**：`unimate-sync.2025040140.workers.dev` 实测解析到 69.171.228.74
 *     （Meta 的地址段，不是 Cloudflare），443 连接超时；而 `unimate3.pages.dev` 实测 200 / 1.3s。
 *     手机上只能走 pages.dev，否则 P3 同步必然失败。
 *  2) Worker 的来源白名单里只有 `http://localhost`，而 APK 里页面源是 **`https://localhost`**（Capacitor androidScheme=https），
 *     直接打 Worker 会被 403「来源不允许」。
 *
 * 本文件只做四件事，**不含任何密钥**（R2 与 pepper 仍然只在 Worker 的 secrets 里）：
 *  a) 对同步 API 处理 CORS（允许 APK 的 https://localhost、桌面调试的 http://localhost:任意端口、站点自身）；
 *  b) 把 `/health`、`/v1/presign` **边缘转发**给真正的 Worker —— Cloudflare 内部解析不受本地 DNS 污染影响；
 *     转发时**剥掉 Origin**，Worker 侧按"服务端到服务端（无 Origin）"放行；
 *  c) 【v2.41】**密文正文也走这里**：`/v1/put`、`/v1/get` 由本函数代取预签名短链、代传代取 R2，
 *     这样手机只与 pages.dev 通信，不再需要直连 `*.r2.cloudflarestorage.com`。
 *     为什么必须代传：真机点"确认并上传密文"报"上传加密备份失败，请检查网络后重试" —— 预签名是成功的，
 *     失败在**直传 R2**这一步：① 桶的 CORS 白名单里只有 `http://localhost`，而 APK 的来源是 `https://localhost`，
 *     WebView 直接拦掉响应；② 大陆移动网络能否稳定连到 R2 的 S3 域名本身也不受我们控制。
 *     两条都归零的办法只有一个：让正文也走 pages.dev（这一条域名已实测 200/1.3s）。
 *  d) 其它路径一律交给静态资源（env.ASSETS）。
 */
const UPSTREAM = 'https://unimate-sync.2025040140.workers.dev';
const API_PATHS = ['/health', '/v1/presign', '/v1/put', '/v1/get'];
const SYNC_CONTENT_TYPE = 'application/vnd.unimate.sync+json';
/** 与 Worker 的 MAX_CIPHER_BYTES 对齐：中转只多做一次内存拷贝，不额外放宽上限 */
const MAX_RELAY_BYTES = 30 * 1024 * 1024;
const EXACT_ORIGINS = ['https://unimate3.pages.dev'];
/**
 * 本机来源允许任意端口：APK 里是 `https://localhost`（无端口），而 `npm run dev` 调试时是
 * `http://localhost:5204` 这类**带端口**的来源 —— v2.39 的白名单只写了不带端口的写法，
 * 结果网页端调试一律被预检拒掉（手机不受影响，但这种"只有真机能测"的坑必须消掉）。
 */
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function pickOrigin(raw) {
  if (!raw) return '';
  if (EXACT_ORIGINS.indexOf(raw) >= 0) return raw;
  if (LOCAL_ORIGIN.test(raw)) return raw;
  return '';
}

function corsHeaders(origin, preflight) {
  const h = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  if (origin) h.set('Access-Control-Allow-Origin', origin);
  h.set('Vary', 'Origin');
  if (preflight) {
    h.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Content-Type');
    h.set('Access-Control-Max-Age', '86400');
  }
  return h;
}

function jsonError(message, status, origin) {
  const h = corsHeaders(origin, false);
  h.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify({ error: message }), { status, headers: h });
}

function jsonOk(value, origin) {
  const h = corsHeaders(origin, false);
  h.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(value), { status: 200, headers: h });
}

/**
 * 服务端到服务端调 Worker 拿预签名短链。
 * 透传 `CF-Connecting-IP`：Worker 按它做限频，不透传的话所有中转请求会挤在同一个桶里。
 */
async function presignUpstream(request, syncId, operation, size) {
  const payload = { syncId, operation };
  if (operation === 'put') payload.size = size;
  const headers = { 'Content-Type': 'application/json', 'X-Unimate-Via': 'pages' };
  const clientIp = request.headers.get('CF-Connecting-IP');
  if (clientIp) headers['CF-Connecting-IP'] = clientIp;
  let upstream;
  try {
    upstream = await fetch(UPSTREAM + '/v1/presign', { method: 'POST', headers, body: JSON.stringify(payload) });
  } catch {
    return { ok: false, status: 502, body: null, unreachable: true };
  }
  let body = null;
  try { body = await upstream.json(); } catch { /* 上游返回了非 JSON（例如 502 错误页） */ }
  return { ok: upstream.ok, status: upstream.status, body };
}

/**
 * `POST /v1/put?syncId=…`：正文就是密文本身。
 * 代取短链 → 代 PUT → 只回一个 JSON 结果，手机全程只跟 pages.dev 打交道。
 */
async function relayPut(request, url, origin) {
  if (request.method !== 'POST') return jsonError('上传接口只接受 POST', 405, origin);
  const syncId = url.searchParams.get('syncId') || '';
  let bytes;
  try { bytes = new Uint8Array(await request.arrayBuffer()); } catch { return jsonError('读取上传内容失败', 400, origin); }
  if (!bytes.length) return jsonError('上传内容为空', 400, origin);
  if (bytes.length > MAX_RELAY_BYTES) return jsonError('同步包超过中转上限', 413, origin);

  const ticket = await presignUpstream(request, syncId, 'put', bytes.length);
  if (!ticket.ok || !ticket.body?.url) {
    if (ticket.unreachable) return jsonError('同步服务暂时不可达', 502, origin);
    return jsonError(ticket.body?.error || '同步服务暂时不可用（' + ticket.status + '）', ticket.status || 502, origin);
  }

  let put;
  try {
    // 短链是按 Content-Type 签的，这里必须与签发时一致
    put = await fetch(ticket.body.url, { method: 'PUT', headers: { 'Content-Type': SYNC_CONTENT_TYPE }, body: bytes });
  } catch {
    return jsonError('写入云存储失败（边缘连不上 R2）', 502, origin);
  }
  if (!put.ok) return jsonError('写入云存储失败（R2 返回 ' + put.status + '）', 502, origin);
  return jsonOk({ ok: true, expiresAt: ticket.body.expiresAt || '', via: 'pages' }, origin);
}

/** `POST /v1/get?syncId=…`：成功时直接把密文正文吐回来（Content-Type 即同步包类型） */
async function relayGet(request, url, origin) {
  if (request.method !== 'POST') return jsonError('下载接口只接受 POST', 405, origin);
  const syncId = url.searchParams.get('syncId') || '';
  const ticket = await presignUpstream(request, syncId, 'get');
  if (!ticket.ok || !ticket.body?.url) {
    if (ticket.unreachable) return jsonError('同步服务暂时不可达', 502, origin);
    return jsonError(ticket.body?.error || '同步服务暂时不可用（' + ticket.status + '）', ticket.status || 502, origin);
  }

  let got;
  try { got = await fetch(ticket.body.url, { method: 'GET' }); } catch { return jsonError('读取云存储失败（边缘连不上 R2）', 502, origin); }
  if (got.status === 404) return jsonError('这个同步码还没有云端备份', 404, origin);
  if (!got.ok) return jsonError('读取云存储失败（R2 返回 ' + got.status + '）', 502, origin);

  const out = new Response(got.body, { status: 200, headers: corsHeaders(origin, false) });
  out.headers.set('Content-Type', SYNC_CONTENT_TYPE);
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (API_PATHS.indexOf(url.pathname) < 0) return env.ASSETS.fetch(request);

    const rawOrigin = request.headers.get('Origin') || '';
    const origin = pickOrigin(rawOrigin);
    if (rawOrigin && !origin) return jsonError('来源不允许', 403, '');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin, true) });

    // v2.41：密文正文也走 pages.dev，手机不需要直连 R2
    if (url.pathname === '/v1/put') return relayPut(request, url, origin);
    if (url.pathname === '/v1/get') return relayGet(request, url, origin);

    // 转发：剥掉 Origin/Referer，Worker 侧按"无 Origin"（服务端到服务端）放行
    const headers = new Headers(request.headers);
    headers.delete('Origin');
    headers.delete('Referer');
    headers.delete('Host');
    headers.set('X-Unimate-Via', 'pages');
    let body;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      // 走到这里的只剩 /v1/presign（请求体只有同步码 + 操作名）；密文走上面的 /v1/put、/v1/get
      body = await request.arrayBuffer();
    }
    let upstream;
    try {
      upstream = await fetch(UPSTREAM + url.pathname + url.search, { method: request.method, headers, body });
    } catch (e) {
      return jsonError('同步服务暂时不可达', 502, origin);
    }
    const out = new Response(upstream.body, { status: upstream.status, headers: corsHeaders(origin, false) });
    out.headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json; charset=utf-8');
    return out;
  }
};
