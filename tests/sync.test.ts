import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gcm } from '@noble/ciphers/aes';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import {
  SYNC_KDF_ITERATIONS, configFromRecovery, decryptSync, encryptForSync, parseRecoveryCode, parseSyncEnvelope
} from '../src/services/syncCrypto.ts';

const root = resolve(import.meta.dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
let pass = 0;
function ok(name: string, yes: boolean, detail = ''): void {
  if (!yes) { console.error('FAIL', name, detail); process.exitCode = 1; return; }
  pass++; console.log('ok', pass, '-', name);
}

console.log('--- P3 端到端加密 ---');
const plain = new TextEncoder().encode('PK\u0003\u0004课表：高等数学；学生：智小汇；照片内容占位'.repeat(12));
const first = await encryptForSync(plain, 'correct horse battery staple');
ok('首次建立生成 128-bit 随机同步码', /^[A-Za-z0-9_-]{22}$/.test(first.config.syncId), first.config.syncId);
ok('首次建立只返回一次恢复码', !!first.recoveryCode && first.recoveryCode.startsWith('UM1.'));
ok('PBKDF2 强度不少于 210k', first.config.passwordWrap.iterations >= SYNC_KDF_ITERATIONS);
ok('密文包不出现课表明文', !new TextDecoder().decode(first.bytes).includes('高等数学'));
ok('密文包声明 AES-256-GCM', parseSyncEnvelope(first.bytes).cipher === 'AES-256-GCM');

const byPassword = await decryptSync(first.bytes, first.config.syncId, 'correct horse battery staple');
ok('同一同步码+口令可恢复原始备份', Buffer.from(byPassword.backup).equals(Buffer.from(plain)));
const byRecovery = await decryptSync(first.bytes, first.recoveryCode!);
ok('恢复码可真正解密，不只是校验码', Buffer.from(byRecovery.backup).equals(Buffer.from(plain)));
ok('恢复码包含同一随机同步码', parseRecoveryCode(first.recoveryCode!).syncId === first.config.syncId);

let wrong = '';
try { await decryptSync(first.bytes, first.config.syncId, 'this password is wrong'); } catch (e: any) { wrong = e.message; }
ok('口令错误明确拒绝且不返回数据', /不正确/.test(wrong), wrong);

const tampered = first.bytes.slice();
const env: any = JSON.parse(new TextDecoder().decode(tampered));
env.payload.ciphertext = env.payload.ciphertext.slice(0, -2) + 'AA';
let damaged = '';
try { await decryptSync(new TextEncoder().encode(JSON.stringify(env)), first.config.syncId, 'correct horse battery staple'); }
catch (e: any) { damaged = e.message; }
ok('密文改动后 GCM 完整性校验拒绝', /损坏|校验/.test(damaged), damaged);

const adopted = await configFromRecovery(first.bytes, first.recoveryCode!, 'a brand new safe password');
const second = await encryptForSync(new TextEncoder().encode('第二台设备的新备份'), 'a brand new safe password', adopted);
ok('恢复码接管后可换新口令继续上传', (await decryptSync(second.bytes, adopted.syncId, 'a brand new safe password')).backup.length > 0);
ok('换口令不改变原恢复码能力', new TextDecoder().decode((await decryptSync(second.bytes, first.recoveryCode!)).backup) === '第二台设备的新备份');

console.log('--- WebCrypto / 纯 JS 格式交叉验证 ---');
const vectorPass = new TextEncoder().encode('unimate-cross-implementation');
const vectorSalt = Uint8Array.from({ length: 16 }, (_v, i) => i + 1);
const nativeMaterial = await crypto.subtle.importKey('raw', vectorPass, { name: 'PBKDF2' }, false, ['deriveBits']);
const nativeBits = new Uint8Array(await crypto.subtle.deriveBits(
  { name: 'PBKDF2', hash: 'SHA-256', salt: vectorSalt, iterations: 210_000 }, nativeMaterial, 256
));
const jsBits = pbkdf2(sha256, vectorPass, vectorSalt, { c: 210_000, dkLen: 32 });
ok('WebCrypto 与纯 JS 派生相同 PBKDF2 密钥', Buffer.from(nativeBits).equals(Buffer.from(jsBits)));
const vectorNonce = Uint8Array.from({ length: 12 }, (_v, i) => 20 + i);
const vectorAad = new TextEncoder().encode('Unimate/P3/v1/cross-check');
const vectorPlain = new TextEncoder().encode('密文格式跨实现交叉验证');
const nativeAesKey = await crypto.subtle.importKey('raw', nativeBits, { name: 'AES-GCM' }, false, ['encrypt']);
const nativeCipher = new Uint8Array(await crypto.subtle.encrypt(
  { name: 'AES-GCM', iv: vectorNonce, additionalData: vectorAad, tagLength: 128 }, nativeAesKey, vectorPlain
));
const jsCipher = gcm(jsBits, vectorNonce, vectorAad).encrypt(vectorPlain);
ok('WebCrypto 与纯 JS 生成逐字节相同 AES-GCM 密文', Buffer.from(nativeCipher).equals(Buffer.from(jsCipher)));

console.log('--- P3 界面、隐私与云端边界 ---');
const me = read('src/views/MeView.vue');
const login = read('src/screens/Login.vue');
const cloud = read('src/services/cloudSync.ts');
const syncCryptoSource = read('src/services/syncCrypto.ts');
const worker = read('cloudflare/sync-worker/src/index.js');
ok('设置页有加密换机同步入口', me.includes('加密换机同步') && me.includes('确认并上传密文'));
ok('恢复前仍走统一二次确认', /await db\.confirm\(\{/.test(me) && /开始恢复/.test(me));
ok('口令输入禁止浏览器自动填充', (me.match(/autocomplete="off"/g) || []).length >= 3);
ok('关于页如实写明可选密文上传', me.includes('只保存 AES-256-GCM 密文') && me.includes('同步口令和恢复码不上传、不保存'));
ok('登录页不再宣称绝不上传', login.includes('同步只上传端到端加密密文'));
ok('Android WebView 优先使用标准 WebCrypto', /subtle\.deriveBits/.test(syncCryptoSource) &&
  /subtle\.encrypt/.test(syncCryptoSource) && /subtle\.decrypt/.test(syncCryptoSource));
ok('WebCrypto 调用有超时与纯 JS 兼容兜底', /cryptoTimeout/.test(syncCryptoSource) &&
  /pbkdf2Async/.test(syncCryptoSource) && /return gcm\(/.test(syncCryptoSource));
ok('客户端只请求短链，不含 R2 凭据', cloud.includes('/v1/presign') && !/R2_SECRET|ACCESS_KEY/.test(cloud));
ok('Worker 短链固定 15 分钟', /15 \* 60/.test(worker) && /signQuery: true/.test(worker));
ok('Worker 对象名使用服务端 HMAC 隐藏同步码', /HMAC/.test(worker) && /SYNC_OBJECT_PEPPER/.test(worker));
ok('R2 密钥只从 Worker secret 读取', /env\.R2_SECRET_ACCESS_KEY/.test(worker) && !/secretAccessKey:\s*['"][^'"]+/.test(worker));
ok('Cloudflare 部署文档要求私有 R2 与费用告警', /保持私有/.test(read('cloudflare/sync-worker/README.md')) && /费用告警/.test(read('cloudflare/sync-worker/README.md')));

console.log('--- P3 Worker 本地行为 ---');
const workerModule: any = await import('../cloudflare/sync-worker/src/index.js');
const workerEnv = {
  APP_ORIGINS: 'http://localhost,https://unimate3.pages.dev', R2_BUCKET_NAME: 'unimate-sync',
  R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef', R2_ACCESS_KEY_ID: 'test-access-key',
  R2_SECRET_ACCESS_KEY: 'test-secret-key', SYNC_OBJECT_PEPPER: 'test-only-pepper-at-least-32-bytes-long',
  SYNC_RATE_LIMITER: { limit: async () => ({ success: true }) }
};
const health = await workerModule.default.fetch(new Request('https://sync.example/health'), workerEnv);
ok('Worker 健康检查可用', health.status === 200 && (await health.json()).ok === true);
const forbidden = await workerModule.default.fetch(new Request('https://sync.example/v1/presign', {
  method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
  body: JSON.stringify({ syncId: first.config.syncId, operation: 'get' })
}), workerEnv);
ok('Worker 拒绝非白名单来源', forbidden.status === 403);
const ticketResponse = await workerModule.default.fetch(new Request('https://sync.example/v1/presign', {
  method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
  body: JSON.stringify({ syncId: first.config.syncId, operation: 'put', size: first.bytes.length })
}), workerEnv);
const ticket: any = await ticketResponse.json();
ok('Worker 能本地签发 PUT 短链', ticketResponse.status === 200 && ticket.method === 'PUT' && /X-Amz-Signature=/.test(ticket.url));
ok('预签名 URL 不暴露原同步码', !ticket.url.includes(first.config.syncId));

console.log('\n通过：' + pass + ' 条 P3 同步断言');
if (process.exitCode) process.exit(process.exitCode);
