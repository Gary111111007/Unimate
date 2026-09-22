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
 * 本文件只做三件事，**不含任何密钥**（R2 与 pepper 仍然只在 Worker 的 secrets 里）：
 *  a) 对 `/health`、`/v1/presign` 处理 CORS（允许 APK 的 https://localhost、桌面调试的 http://localhost、站点自身）；
 *  b) 把请求**边缘转发**给真正的 Worker —— Cloudflare 网络内部解析不受本地 DNS 污染影响；转发时**剥掉 Origin**，
 *     Worker 侧按"服务端到服务端（无 Origin）"放行；
 *  c) 其它路径一律交给静态资源（env.ASSETS）。
 */
const UPSTREAM = 'https://unimate-sync.2025040140.workers.dev';
const API_PATHS = ['/health', '/v1/presign'];
const ALLOWED_ORIGINS = ['https://localhost', 'http://localhost', 'https://unimate3.pages.dev'];

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (API_PATHS.indexOf(url.pathname) < 0) return env.ASSETS.fetch(request);

    const rawOrigin = request.headers.get('Origin') || '';
    const origin = ALLOWED_ORIGINS.indexOf(rawOrigin) >= 0 ? rawOrigin : '';
    if (rawOrigin && !origin) return jsonError('来源不允许', 403, '');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin, true) });

    // 转发：剥掉 Origin/Referer，Worker 侧按"无 Origin"（服务端到服务端）放行
    const headers = new Headers(request.headers);
    headers.delete('Origin');
    headers.delete('Referer');
    headers.delete('Host');
    headers.set('X-Unimate-Via', 'pages');
    let body;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      // 这里的请求体很小（同步码 + 操作名），密文是直传 R2 的，不经过本函数
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
