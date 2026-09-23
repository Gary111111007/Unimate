/**
 * P3 云端传输。
 *
 * v2.41 起：**正文也走 pages.dev 中转**（`/v1/put`、`/v1/get`），不再由手机直连
 * `*.r2.cloudflarestorage.com`。真机点「确认并上传密文」报"上传加密备份失败，请检查网络后重试"，
 * 而预签名那一步是成功的 —— 失败在直传 R2：桶的 CORS 白名单只有 `http://localhost`，
 * APK 的来源却是 `https://localhost`（Capacitor androidScheme=https），WebView 直接拦掉；
 * 另外大陆移动网络能否稳定连到 R2 的 S3 域名本身也不由我们决定。
 * 直传代码保留为**兜底**（老版 Pages 还没部署中转端点时仍可按原路走）。
 */
import { SYNC_MAX_BYTES } from './syncCrypto.ts';

export const SYNC_CONTENT_TYPE = 'application/vnd.unimate.sync+json';
/**
 * 同步 API 的基地址（v2.39 改）。
 *
 * 为什么不是 Worker 自己的 `*.workers.dev` 域名：那条域名在大陆**被 DNS 污染**
 * （实测解析到 69.171.228.74 / 连接超时，见 PRD 11.47），而 `unimate3.pages.dev` 实测 200 / 1.3s。
 * 现在 API 由 Pages 上的 `_worker.js` 同域提供，它在边缘转发给真正的 Worker —— 手机只与 pages.dev 通信。
 */
/**
 * 注意：这里必须能容忍"没有 `import.meta.env`"的环境（Node 里跑单测就是 —— v2.45 加自动同步单测时踩到，
 * 直接写 `import.meta.env.VITE_...` 会在导入模块时就抛 `Cannot read properties of undefined`）。
 */
const ENV: Record<string, string | undefined> = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {};
export const SYNC_API_BASE = (ENV.VITE_SYNC_API_BASE || 'https://unimate3.pages.dev').replace(/\/+$/, '');

interface PresignReply { url: string; method: 'GET' | 'PUT'; expiresAt: string; headers?: Record<string, string> }

export async function fetchTimed(label: string, input: RequestInfo | URL, init: RequestInit, ms = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  catch (e: any) {
    if (e?.name === 'AbortError') throw new Error(label + '超时，请检查网络后重试');
    throw new Error(label + '失败，请检查网络后重试');
  } finally { clearTimeout(timer); }
}

async function presign(syncId: string, operation: 'get' | 'put', size?: number): Promise<PresignReply> {
  const response = await fetchTimed('连接同步服务', SYNC_API_BASE + '/v1/presign', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ syncId, operation, size })
  });
  let body: any = null;
  try { body = await response.json(); } catch { /* Worker/网络错误页 */ }
  if (!response.ok) {
    if (response.status === 404 && operation === 'get') throw new Error('这个同步码还没有云端备份');
    if (response.status === 429) throw new Error('同步操作过于频繁，请稍后再试');
    throw new Error(typeof body?.error === 'string' ? body.error : '同步服务暂时不可用（' + response.status + '）');
  }
  if (!body?.url || (body.method !== 'GET' && body.method !== 'PUT')) throw new Error('同步服务返回格式异常');
  return body as PresignReply;
}

async function jsonSafe(response: Response): Promise<any> {
  try { return await response.json(); } catch { return null; }
}

function isJsonResponse(response: Response): boolean {
  return (response.headers.get('content-type') || '').includes('application/json');
}

function relayUrl(path: string, syncId: string): string {
  return SYNC_API_BASE + path + '?syncId=' + encodeURIComponent(syncId);
}

const TOO_BIG = SYNC_MAX_BYTES * 1.5;

/** 返回 null = 站点上还没有中转端点（旧版 Pages，请求会回落到静态资源）→ 调用方走直传兜底 */
async function relayUpload(syncId: string, bytes: Uint8Array): Promise<string | null> {
  let response: Response | null = null;
  try {
    response = await fetchTimed('经中转上传加密备份', relayUrl('/v1/put', syncId), {
      method: 'POST', headers: { 'Content-Type': SYNC_CONTENT_TYPE }, body: bytes as BodyInit
    }, 60_000);
  } catch { return null; }
  if (!isJsonResponse(response)) return null;
  const body = await jsonSafe(response);
  if (!response.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : '上传加密备份失败（' + response.status + '）');
  }
  return String(body?.expiresAt || '');
}

async function directUpload(syncId: string, bytes: Uint8Array): Promise<string> {
  const ticket = await presign(syncId, 'put', bytes.length);
  const response = await fetchTimed('直传 R2 上传加密备份', ticket.url, {
    method: 'PUT', headers: { ...(ticket.headers || {}), 'Content-Type': SYNC_CONTENT_TYPE }, body: bytes as BodyInit
  }, 45_000);
  if (!response.ok) throw new Error('直传 R2 上传失败（' + response.status + '）');
  return ticket.expiresAt;
}

export async function uploadSyncCipher(syncId: string, bytes: Uint8Array): Promise<string> {
  if (!bytes.length || bytes.length > TOO_BIG) throw new Error('加密同步包过大，不能上传');
  const relayed = await relayUpload(syncId, bytes);
  return relayed !== null ? relayed : directUpload(syncId, bytes);
}

async function relayDownload(syncId: string): Promise<Uint8Array | null> {
  let response: Response | null = null;
  try {
    response = await fetchTimed('经中转下载加密备份', relayUrl('/v1/get', syncId), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ syncId })
    }, 60_000);
  } catch { return null; }
  const type = response.headers.get('content-type') || '';
  // 错误一律是 JSON；正文成功时是 SYNC_CONTENT_TYPE；旧版站点会把未知路径回落到首页 HTML
  if (type.includes('application/json')) {
    const body = await jsonSafe(response);
    if (response.status === 404) throw new Error('这个同步码还没有云端备份');
    if (!response.ok) {
      throw new Error(typeof body?.error === 'string' ? body.error : '同步服务暂时不可用（' + response.status + '）');
    }
    return null;
  }
  if (!type.includes(SYNC_CONTENT_TYPE)) return null;
  if (!response.ok) throw new Error('下载加密备份失败（' + response.status + '）');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > TOO_BIG) throw new Error('云端同步包大小异常');
  return bytes;
}

async function directDownload(syncId: string): Promise<Uint8Array> {
  const ticket = await presign(syncId, 'get');
  const response = await fetchTimed('直传下载加密备份', ticket.url, { method: 'GET', headers: ticket.headers || {} }, 45_000);
  if (response.status === 404) throw new Error('这个同步码还没有云端备份');
  if (!response.ok) throw new Error('下载加密备份失败（' + response.status + '）');
  const length = Number(response.headers.get('content-length') || 0);
  if (length > TOO_BIG) throw new Error('云端同步包超过安全大小限制');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > TOO_BIG) throw new Error('云端同步包大小异常');
  return bytes;
}

export async function downloadSyncCipher(syncId: string): Promise<Uint8Array> {
  const relayed = await relayDownload(syncId);
  return relayed !== null ? relayed : directDownload(syncId);
}

export async function syncServiceReady(): Promise<boolean> {
  try { return (await fetchTimed('检查同步服务', SYNC_API_BASE + '/health', { method: 'GET' }, 5000)).ok; }
  catch { return false; }
}
