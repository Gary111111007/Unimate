// AI 专用 Pages 中转：不接管账号、备份、R2 或管理员接口。
const UPSTREAM = 'https://unimate-sync.unimate-sync-worker.workers.dev';
const ORIGINS = new Set(['https://localhost', 'http://localhost',
  'https://unimate3.pages.dev', 'https://unimate3-ai-pages.pages.dev']);
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' });
    const reply = (value, status) => new Response(JSON.stringify(value), { status, headers });
    if (origin && !ORIGINS.has(origin) && !LOCAL_ORIGIN.test(origin)) return reply({ error: '来源不允许' }, 403);
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    const chat = url.pathname === '/v1/agent/chat';
    const health = url.pathname === '/health';
    if (!chat && !health) return reply({ error: 'Not found' }, 404);
    if (request.method === 'OPTIONS') {
      headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type');
      headers.set('Access-Control-Max-Age', '86400');
      return new Response(null, { status: 204, headers });
    }
    if ((chat && request.method !== 'POST') || (health && request.method !== 'GET')) return reply({ error: 'Method not allowed' }, 405);
    // 12 条、每条 500 字的对话远小于 64 KiB；按实际流量封顶，避免任意大请求中转。
    let body;
    if (chat) {
      if (!request.body) return reply({ error: '请求体为空' }, 400);
      const reader = request.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 65536) { await reader.cancel(); return reply({ error: '请求过大' }, 413); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    }
    const forward = new Headers({ 'Content-Type': 'application/json', 'X-Unimate-Via': 'agent-pages' });
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) forward.set('CF-Connecting-IP', ip);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 28000);
    try {
      const result = await env.UNIMATE_AI.fetch(UPSTREAM + url.pathname, {
        method: request.method, headers: forward, body, signal: controller.signal, redirect: 'manual'
      });
      return new Response(await result.arrayBuffer(), { status: result.status, headers });
    } catch (error) {
      console.error('AI relay failure', error?.name, error?.message);
      return reply({ error: '在线 AI 暂时无法连接' }, 502);
    }
    finally { clearTimeout(timer); }
  }
};
