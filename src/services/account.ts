/**
 * v2.43 账号登录（服务器托管）。
 *
 * 口径变更（产品负责人 2026-09-23 明确撤销"数据只在本机/只上传密文"）：
 * 这一路是**普通 App 的做法** —— 注册/登录后，备份正文存在云端，服务器持有落盘密钥、可以读取，
 * 换来的是"换台手机输账号密码就有课表"和"忘记密码可以找开发者重置"。
 * 与之并存的还有原来的端到端加密模式（服务器读不懂）；两条路互不影响，用户自己选。
 *
 * 仍然坚持的两件事：
 *  1) 口令原文不上传（本地 210k 次 PBKDF2 派生成 verifier），服务端只存 `sha256(盐 + verifier)`；
 *  2) 所有接口都走 `unimate3.pages.dev` 中转（v2.39~v2.41 的教训：手机直连别的域名不可靠）。
 */
import { deriveAuthVerifier } from './syncCrypto.ts';
import { SYNC_API_BASE, fetchTimed } from './cloudSync.ts';

export interface CloudAccountSession {
  account: string;
  token: string;
  id: string;
  updatedAt: string;
  size: number;
}

export interface CloudAccountMeta {
  updatedAt: string;
  size: number;
  /** 服务端有没有启用落盘加密（DATA_KEY）——界面据此如实说明"服务器能读" */
  sealed: boolean;
}

export const CLOUD_BACKUP_CONTENT_TYPE = 'application/octet-stream';

async function jsonBody(response: Response): Promise<any> {
  try { return await response.json(); } catch { return null; }
}

function fail(response: Response, body: any, fallback: string): never {
  throw new Error(typeof body?.error === 'string' ? body.error : fallback + '（' + response.status + '）');
}

async function post(path: string, payload: unknown, label: string): Promise<Response> {
  return fetchTimed(label, SYNC_API_BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  }, 30_000);
}

function authQuery(account: string): string {
  return '?account=' + encodeURIComponent(account);
}

function authHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: 'Bearer ' + token, ...extra };
}

function toSession(account: string, body: any): CloudAccountSession {
  if (!body?.token || !body?.id) throw new Error('同步服务返回格式异常');
  return { account: String(body.account || account), token: String(body.token), id: String(body.id),
    updatedAt: String(body.updatedAt || ''), size: Number(body.size || 0) };
}

export async function accountSignup(account: string, password: string): Promise<CloudAccountSession> {
  const verifier = await deriveAuthVerifier(account, password);
  const response = await post('/v1/signup', { account, verifier }, '注册账号');
  const body = await jsonBody(response);
  if (!response.ok) fail(response, body, '注册失败');
  return toSession(account, body);
}

export async function accountLogin(account: string, password: string): Promise<CloudAccountSession> {
  const verifier = await deriveAuthVerifier(account, password);
  const response = await post('/v1/login', { account, verifier }, '登录账号');
  const body = await jsonBody(response);
  if (!response.ok) fail(response, body, '登录失败');
  return toSession(account, body);
}

export async function accountInfo(session: CloudAccountSession): Promise<CloudAccountMeta> {
  const response = await fetchTimed('读取云端备份信息',
    SYNC_API_BASE + '/v1/account' + authQuery(session.account), { method: 'GET', headers: authHeaders(session.token) }, 20_000);
  const body = await jsonBody(response);
  if (!response.ok) fail(response, body, '读取账号信息失败');
  return { updatedAt: String(body?.updatedAt || ''), size: Number(body?.size || 0), sealed: body?.sealed !== false };
}

/** 上传备份正文（未加密的备份 zip）——服务器可以读取，这是这一模式的前提 */
export async function accountUpload(session: CloudAccountSession, bytes: Uint8Array): Promise<CloudAccountMeta> {
  const response = await fetchTimed('上传到云端账号',
    SYNC_API_BASE + '/v1/backup' + authQuery(session.account), {
      method: 'PUT', headers: authHeaders(session.token, { 'Content-Type': CLOUD_BACKUP_CONTENT_TYPE }), body: bytes as BodyInit
    }, 90_000);
  const body = await jsonBody(response);
  if (!response.ok) fail(response, body, '上传到云端失败');
  return { updatedAt: String(body?.updatedAt || ''), size: Number(body?.size || 0), sealed: body?.sealed !== false };
}

/** 返回 null = 这个账号云端还没有备份 */
export async function accountDownload(session: CloudAccountSession): Promise<Uint8Array | null> {
  const response = await fetchTimed('从云端账号下载',
    SYNC_API_BASE + '/v1/backup' + authQuery(session.account), {
      method: 'GET', headers: authHeaders(session.token)
    }, 90_000);
  if (response.status === 404) return null;
  if (!response.ok) fail(response, await jsonBody(response), '从云端下载失败');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new Error('云端备份是空的');
  return bytes;
}

/** 注销：删账号记录 + 云端备份（不可恢复，调用方必须先二次确认） */
export async function accountDelete(session: CloudAccountSession): Promise<void> {
  const response = await fetchTimed('注销账号',
    SYNC_API_BASE + '/v1/account' + authQuery(session.account), {
      method: 'DELETE', headers: authHeaders(session.token)
    }, 30_000);
  const body = await jsonBody(response);
  if (!response.ok) fail(response, body, '注销失败');
}

/** 服务端是否支持账号模式（老版 Worker 没有这些接口） */
export async function cloudAccountReady(): Promise<boolean> {
  try {
    const response = await fetchTimed('检查账号服务', SYNC_API_BASE + '/health', { method: 'GET' }, 6000);
    if (!response.ok) return false;
    const body = await jsonBody(response);
    return body?.accounts === true;
  } catch { return false; }
}
