/** P3 云端传输：Worker 只签 15 分钟 R2 短链，密文由 App 直传直取。 */
import { SYNC_MAX_BYTES } from './syncCrypto.ts';

export const SYNC_CONTENT_TYPE = 'application/vnd.unimate.sync+json';
export const SYNC_API_BASE = (import.meta.env.VITE_SYNC_API_BASE || 'https://unimate-sync.2025040140.workers.dev').replace(/\/+$/, '');

interface PresignReply { url: string; method: 'GET' | 'PUT'; expiresAt: string; headers?: Record<string, string> }

async function fetchTimed(label: string, input: RequestInfo | URL, init: RequestInit, ms = 10_000): Promise<Response> {
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

export async function uploadSyncCipher(syncId: string, bytes: Uint8Array): Promise<string> {
  if (!bytes.length || bytes.length > SYNC_MAX_BYTES * 1.5) throw new Error('加密同步包过大，不能上传');
  const ticket = await presign(syncId, 'put', bytes.length);
  const response = await fetchTimed('上传加密备份', ticket.url, {
    method: 'PUT', headers: { ...(ticket.headers || {}), 'Content-Type': SYNC_CONTENT_TYPE }, body: bytes as BodyInit
  }, 45_000);
  if (!response.ok) throw new Error('上传加密备份失败（' + response.status + '）');
  return ticket.expiresAt;
}

export async function downloadSyncCipher(syncId: string): Promise<Uint8Array> {
  const ticket = await presign(syncId, 'get');
  const response = await fetchTimed('下载加密备份', ticket.url, { method: 'GET', headers: ticket.headers || {} }, 45_000);
  if (response.status === 404) throw new Error('这个同步码还没有云端备份');
  if (!response.ok) throw new Error('下载加密备份失败（' + response.status + '）');
  const length = Number(response.headers.get('content-length') || 0);
  if (length > SYNC_MAX_BYTES * 1.5) throw new Error('云端同步包超过安全大小限制');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > SYNC_MAX_BYTES * 1.5) throw new Error('云端同步包大小异常');
  return bytes;
}

export async function syncServiceReady(): Promise<boolean> {
  try { return (await fetchTimed('检查同步服务', SYNC_API_BASE + '/health', { method: 'GET' }, 5000)).ok; }
  catch { return false; }
}

