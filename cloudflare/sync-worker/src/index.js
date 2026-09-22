import { AwsClient } from 'aws4fetch';

const MAX_CIPHER_BYTES = 30 * 1024 * 1024;
const EXPIRES_SECONDS = 15 * 60;
const CONTENT_TYPE = 'application/vnd.unimate.sync+json';

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

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (origin === null) return json({ error: '来源不允许' }, 403, '');
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      const h = headers(origin);
      h.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      h.set('Access-Control-Allow-Headers', 'Content-Type');
      h.set('Access-Control-Max-Age', '86400');
      return new Response(null, { status: 204, headers: h });
    }
    if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, service: 'unimate-sync' }, 200, origin);
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
