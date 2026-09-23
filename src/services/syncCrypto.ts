/**
 * P3 跨机同步的端到端加密层。
 *
 * 云端只拿到这个模块产出的 JSON 密文包。备份正文使用随机 256-bit 数据密钥加密；
 * 数据密钥分别由“同步口令”和一次性展示的“恢复码”包裹。这样忘记口令时恢复码
 * 真能解密，而不是只做一个无法恢复数据的校验码。
 */
import { gcm } from '@noble/ciphers/aes';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToBase64, base64ToBytes } from './zip.ts';

export const SYNC_KDF_ITERATIONS = 210_000;
export const SYNC_MAX_BYTES = 20 * 1024 * 1024;
const FORMAT = 'unimate-sync';
const AAD_PREFIX = 'Unimate/P3/v1/';

export interface SyncKeyWrap {
  salt: string;
  iterations: number;
  nonce: string;
  ciphertext: string;
}

export interface SyncConfig {
  syncId: string;
  passwordWrap: SyncKeyWrap;
  recoveryWrap: SyncKeyWrap;
  lastUploadedAt?: string;
}

export interface SyncEnvelope {
  format: typeof FORMAT;
  version: 1;
  cipher: 'AES-256-GCM';
  createdAt: string;
  backupSize: number;
  backupSha256: string;
  passwordWrap: SyncKeyWrap;
  recoveryWrap: SyncKeyWrap;
  payload: { nonce: string; ciphertext: string };
}

export interface EncryptedSync {
  bytes: Uint8Array;
  envelope: SyncEnvelope;
  config: SyncConfig;
  /** 只在首次建立同步时返回；界面必须要求用户另行保存。 */
  recoveryCode?: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // WebCrypto 在部分 Android WebView 不接受带 offset 的 ArrayBufferView，统一拷贝成独立 ArrayBuffer。
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function webCrypto(): SubtleCrypto | null {
  const subtle = globalThis.crypto?.subtle;
  return subtle && typeof subtle.importKey === 'function' && typeof subtle.deriveBits === 'function' &&
    typeof subtle.encrypt === 'function' && typeof subtle.decrypt === 'function' ? subtle : null;
}

async function cryptoTimeout<T>(label: string, promise: Promise<T>, ms = 60_000): Promise<T> {
  let timer = 0;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(label + '超时')), ms) as unknown as number;
      })
    ]);
  } finally { clearTimeout(timer as any); }
}

function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  const c = globalThis.crypto;
  if (typeof c?.getRandomValues !== 'function') throw new Error('当前系统没有安全随机数能力，已拒绝生成同步密钥');
  c.getRandomValues(out);
  return out;
}

function b64u(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromB64u(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('同步码格式不正确');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4);
  return base64ToBytes(b64);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function aad(syncId: string): Uint8Array { return enc.encode(AAD_PREFIX + syncId); }

function assertPassphrase(passphrase: string): void {
  if (passphrase.length < 10) throw new Error('同步口令至少 10 个字符');
}

async function derive(secret: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  if (!Number.isInteger(iterations) || iterations < SYNC_KDF_ITERATIONS) throw new Error('密文包的口令派生强度不足，已拒绝');
  const subtle = webCrypto();
  if (subtle) {
    try {
      const material = await cryptoTimeout('导入同步口令', subtle.importKey(
        'raw', arrayBuffer(enc.encode(secret)), { name: 'PBKDF2' }, false, ['deriveBits']
      ));
      const bits = await cryptoTimeout('派生同步密钥', subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: arrayBuffer(salt), iterations }, material, 256
      ));
      return new Uint8Array(bits);
    } catch {
      // 某些厂商 WebView 声明了 SubtleCrypto 却不完整实现，退回纯 JS 实现。
    }
  }
  return pbkdf2Async(sha256, enc.encode(secret), salt, { c: iterations, dkLen: 32, asyncTick: 8 });
}

async function encryptAesGcm(keyBytes: Uint8Array, nonce: Uint8Array, additionalData: Uint8Array,
  plaintext: Uint8Array): Promise<Uint8Array> {
  const subtle = webCrypto();
  if (subtle) {
    try {
      const key = await cryptoTimeout('导入同步密钥', subtle.importKey(
        'raw', arrayBuffer(keyBytes), { name: 'AES-GCM' }, false, ['encrypt']
      ));
      const encrypted = await cryptoTimeout('加密同步数据', subtle.encrypt(
        { name: 'AES-GCM', iv: arrayBuffer(nonce), additionalData: arrayBuffer(additionalData), tagLength: 128 },
        key, arrayBuffer(plaintext)
      ));
      return new Uint8Array(encrypted);
    } catch {
      // 保留纯 JS AES-GCM 兼容路径，两种实现产出相同的标准密文格式。
    }
  }
  return gcm(keyBytes, nonce, additionalData).encrypt(plaintext);
}

async function decryptAesGcm(keyBytes: Uint8Array, nonce: Uint8Array, additionalData: Uint8Array,
  ciphertext: Uint8Array): Promise<Uint8Array> {
  const subtle = webCrypto();
  if (subtle) {
    try {
      const key = await cryptoTimeout('导入同步密钥', subtle.importKey(
        'raw', arrayBuffer(keyBytes), { name: 'AES-GCM' }, false, ['decrypt']
      ));
      const decrypted = await cryptoTimeout('解密同步数据', subtle.decrypt(
        { name: 'AES-GCM', iv: arrayBuffer(nonce), additionalData: arrayBuffer(additionalData), tagLength: 128 },
        key, arrayBuffer(ciphertext)
      ));
      return new Uint8Array(decrypted);
    } catch {
      // 转纯 JS 路径后仍会做 GCM tag 校验，不会降级安全性。
    }
  }
  return gcm(keyBytes, nonce, additionalData).decrypt(ciphertext);
}

async function wrapKey(dataKey: Uint8Array, secret: string, syncId: string): Promise<SyncKeyWrap> {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = await derive(secret, salt, SYNC_KDF_ITERATIONS);
  const ciphertext = await encryptAesGcm(key, nonce, aad(syncId), dataKey);
  key.fill(0);
  return { salt: b64u(salt), iterations: SYNC_KDF_ITERATIONS, nonce: b64u(nonce), ciphertext: b64u(ciphertext) };
}

async function unwrapKey(wrap: SyncKeyWrap, secret: string, syncId: string): Promise<Uint8Array> {
  try {
    const key = await derive(secret, fromB64u(wrap.salt), wrap.iterations);
    const out = await decryptAesGcm(key, fromB64u(wrap.nonce), aad(syncId), fromB64u(wrap.ciphertext));
    key.fill(0);
    if (out.length !== 32) throw new Error('bad key');
    return out;
  } catch {
    throw new Error('同步口令或恢复码不正确，云端数据未改动');
  }
}

export function newSyncIdentity(): { syncId: string; recoverySecret: string; recoveryCode: string } {
  const syncId = b64u(randomBytes(16));
  const recoverySecret = b64u(randomBytes(32));
  return { syncId, recoverySecret, recoveryCode: 'UM1.' + syncId + '.' + recoverySecret };
}

export function parseRecoveryCode(code: string): { syncId: string; secret: string } {
  const parts = code.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'UM1') throw new Error('恢复码格式不正确');
  if (fromB64u(parts[1]).length !== 16 || fromB64u(parts[2]).length !== 32) throw new Error('恢复码格式不正确');
  return { syncId: parts[1], secret: parts[2] };
}

/**
 * 账号同步（v2.42，A 方案）：把"要抄的同步码"换成"记得住的账号 + 口令"。
 *
 * 账号名在**本机**参与派生，算出同一把同步码 —— 换机时只要输账号和口令，课表就回来了。
 * 服务器看到的仍然只是 syncId（再经 pepper 变成对象名），它既不知道账号名、也不知道口令。
 *
 * 这条路的代价（界面必须如实写明，见 AGENTS.md 第 7 条）：
 *  - 账号名是可猜的（尤其是学号），所以**口令是唯一的秘密**：至少 10 位，别用生日/学号；
 *  - 忘记口令且恢复码也丢失时，谁都救不回来 —— 云端没有钥匙。
 */
const ACCOUNT_DOMAIN = 'unimate-account-v1';

/** 归一化：大小写、首尾空格、全角字符、连续空格都不该导致"换个手机上不去了" */
export function normalizeAccount(raw: string): string {
  return String(raw || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 账号 → 同步码（22 字符 base64url，与随机同步码同一命名空间，云端接口不用改） */
export function deriveAccountSyncId(account: string): string {
  const name = normalizeAccount(account);
  if (name.length < 3) throw new Error('账号至少 3 个字符');
  if (name.length > 64) throw new Error('账号名最长 64 个字符');
  return b64u(sha256(enc.encode(ACCOUNT_DOMAIN + '\u0000' + name)).slice(0, 16));
}

/**
 * 账号登录（v2.43，服务器托管模式）用的口令校验值。
 *
 * 口令原文**不上传**：客户端先做 210k 次 PBKDF2 得到一个 verifier 再发上去，
 * 服务端只存 `sha256(服务器盐 + verifier)`。这样即使云端记录被拖走，
 * 攻击者拿到的也只是"还要再爆破一轮"的东西，而不是口令本身。
 * 注意这不能替代 HTTPS：verifier 本身在传输中等价于口令。
 */
const AUTH_DOMAIN = 'unimate-auth-v1';

export async function deriveAuthVerifier(account: string, password: string): Promise<string> {
  const name = normalizeAccount(account);
  if (name.length < 3) throw new Error('账号至少 3 个字符');
  if (password.length < 8) throw new Error('密码至少 8 个字符');
  const bits = await derive(password, enc.encode(AUTH_DOMAIN + '\u0000' + name), SYNC_KDF_ITERATIONS);
  return b64u(bits);
}

/**
 * 删除云端备份用的"墓碑"：一条不含任何用户数据的小 JSON。
 * 覆盖上去就等于把原来的密文从桶里抹掉（R2 默认不开版本控制），
 * 客户端下载到它会明确提示"这份备份已被删除"，而不是报一堆看不懂的解析错。
 */
export function tombstoneBytes(): Uint8Array {
  return enc.encode(JSON.stringify({ format: FORMAT, version: 1, cipher: 'AES-256-GCM', tombstone: true, createdAt: new Date().toISOString() }));
}

export function isTombstone(bytes: Uint8Array): boolean {
  try { return JSON.parse(dec.decode(bytes))?.tombstone === true; } catch { return false; }
}

export function parseSyncEnvelope(bytes: Uint8Array): SyncEnvelope {
  let value: any;
  try { value = JSON.parse(dec.decode(bytes)); } catch { throw new Error('云端文件不是有效的 Unimate 同步包'); }
  if (!value || value.format !== FORMAT || value.version !== 1 || value.cipher !== 'AES-256-GCM') {
    throw new Error('云端文件格式不受支持，请升级 App');
  }
  if (!value.passwordWrap || !value.recoveryWrap || !value.payload || typeof value.payload.ciphertext !== 'string') {
    throw new Error('云端同步包不完整');
  }
  if (!Number.isFinite(value.backupSize) || value.backupSize < 1 || value.backupSize > SYNC_MAX_BYTES) {
    throw new Error('云端同步包大小异常');
  }
  return value as SyncEnvelope;
}

/**
 * @param current 已有的同步配置（更新同一份云端备份时传它，数据密钥会被沿用）
 * @param account 账号同步（A 方案）：首次建立时用账号派生同步码，换机才可能"输账号就找到"
 */
export async function encryptForSync(backup: Uint8Array, passphrase: string, current?: SyncConfig, account?: string): Promise<EncryptedSync> {
  assertPassphrase(passphrase);
  if (!backup.length || backup.length > SYNC_MAX_BYTES) throw new Error('同步包必须小于 20 MB');

  let syncId: string;
  let dataKey: Uint8Array;
  let passwordWrap: SyncKeyWrap;
  let recoveryWrap: SyncKeyWrap;
  let recoveryCode: string | undefined;

  // 账号模式下如果现有配置的同步码与账号派生结果不一致（比如先随机建过同步、后来又设了账号），
  // 一律按"另起一份"处理：沿用旧同步码会让账号在其他手机上找不到这份备份。
  const wanted = account ? deriveAccountSyncId(account) : '';
  const reuse = current && (!wanted || current.syncId === wanted) ? current : undefined;

  if (reuse) {
    syncId = current.syncId;
    dataKey = await unwrapKey(current.passwordWrap, passphrase, syncId);
    passwordWrap = current.passwordWrap;
    recoveryWrap = current.recoveryWrap;
  } else {
    const identity = newSyncIdentity();
    syncId = wanted || identity.syncId;
    recoveryCode = identity.recoveryCode;
    dataKey = randomBytes(32);
    passwordWrap = await wrapKey(dataKey, passphrase, syncId);
    // 恢复码里带着它自己的 syncId，账号模式下要把恢复码里的那一段改成账号派生的同步码，
    // 否则用户拿恢复码去别的手机恢复时，会去查一个不存在的对象（与 v2.37 那次"恢复码要用得上"的初衷冲突）。
    recoveryWrap = await wrapKey(dataKey, identity.recoverySecret, syncId);
    if (wanted) recoveryCode = 'UM1.' + syncId + '.' + identity.recoverySecret;
  }

  const nonce = randomBytes(12);
  const ciphertext = await encryptAesGcm(dataKey, nonce, aad(syncId), backup);
  dataKey.fill(0);
  const envelope: SyncEnvelope = {
    format: FORMAT, version: 1, cipher: 'AES-256-GCM', createdAt: new Date().toISOString(),
    backupSize: backup.length, backupSha256: hex(sha256(backup)), passwordWrap, recoveryWrap,
    payload: { nonce: b64u(nonce), ciphertext: b64u(ciphertext) }
  };
  return {
    bytes: enc.encode(JSON.stringify(envelope)), envelope,
    config: { syncId, passwordWrap, recoveryWrap, lastUploadedAt: envelope.createdAt }, recoveryCode
  };
}

export async function decryptSync(bytes: Uint8Array, syncIdOrRecovery: string, passphrase = ''): Promise<{ backup: Uint8Array; envelope: SyncEnvelope; syncId: string }> {
  const envelope = parseSyncEnvelope(bytes);
  let syncId = syncIdOrRecovery.trim();
  let secret = passphrase;
  let wrap = envelope.passwordWrap;
  if (syncId.startsWith('UM1.')) {
    const recovered = parseRecoveryCode(syncId);
    syncId = recovered.syncId;
    secret = recovered.secret;
    wrap = envelope.recoveryWrap;
  } else {
    assertPassphrase(passphrase);
  }
  const dataKey = await unwrapKey(wrap, secret, syncId);
  let backup: Uint8Array;
  try { backup = await decryptAesGcm(dataKey, fromB64u(envelope.payload.nonce), aad(syncId), fromB64u(envelope.payload.ciphertext)); }
  catch { throw new Error('密文校验失败：同步码不匹配，或云端文件已损坏'); }
  finally { dataKey.fill(0); }
  if (backup.length !== envelope.backupSize || hex(sha256(backup)) !== envelope.backupSha256) {
    throw new Error('解密后的备份校验失败，已拒绝恢复');
  }
  return { backup, envelope, syncId };
}

/** 用恢复码接管后，为当前设备的新口令生成本地包裹信息；口令仍不会保存。 */
export async function configFromRecovery(bytes: Uint8Array, recoveryCode: string, newPassphrase: string): Promise<SyncConfig> {
  assertPassphrase(newPassphrase);
  const envelope = parseSyncEnvelope(bytes);
  const recovered = parseRecoveryCode(recoveryCode);
  const dataKey = await unwrapKey(envelope.recoveryWrap, recovered.secret, recovered.syncId);
  const passwordWrap = await wrapKey(dataKey, newPassphrase, recovered.syncId);
  dataKey.fill(0);
  return { syncId: recovered.syncId, passwordWrap, recoveryWrap: envelope.recoveryWrap };
}
