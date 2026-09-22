import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gcm } from '@noble/ciphers/aes';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import {
  SYNC_KDF_ITERATIONS, configFromRecovery, decryptSync, deriveAccountSyncId, encryptForSync, isTombstone,
  normalizeAccount, parseRecoveryCode, parseSyncEnvelope, tombstoneBytes
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
// v2.42 起关于页还要点名"账号"：账号同步上线后，只说"口令和恢复码"就不够了
ok('关于页如实写明可选密文上传（含账号同步）',
  me.includes('服务器只保存 AES-256-GCM 密文') && me.includes('同步账号、口令和恢复码不上传、不保存'));
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

/*
 * v2.39：把同步 API 搬到 pages.dev 上（真机阻断修复）
 *
 * 实测依据：
 *  · `unimate-sync.2025040140.workers.dev` 在大陆被 DNS 污染 —— 解析到 69.171.228.74（Meta 段），443 连接超时；
 *    而 `unimate3.pages.dev` 200 / 1.3s。手机只能走 pages.dev。
 *  · Worker 的 APP_ORIGINS 原来只有 `http://localhost`，而 APK 页面源是 `https://localhost`，直接打 Worker 会 403。
 */
console.log('\n--- v2.39：同步 API 走 pages.dev（绕开被污染/不可达的 workers.dev）---');
{
  const cloudSrc = read('src/services/cloudSync.ts');
  ok('客户端默认 API 基地址是 pages.dev，不是 workers.dev',
    /SYNC_API_BASE = \(import\.meta\.env\.VITE_SYNC_API_BASE \|\| 'https:\/\/unimate3\.pages\.dev'\)/.test(cloudSrc)
    && !/SYNC_API_BASE[^\n]*workers\.dev/.test(cloudSrc), '');

  const pagesWorker = read('cloudflare/pages/_worker.js');
  ok('Pages 上有 Advanced Mode 入口 _worker.js', pagesWorker.length > 500, '');
  // v2.41 起这条列表多了 /v1/put 与 /v1/get（正文中转），静态资源仍然交给 env.ASSETS
  ok('只接管同步 API 的几条路径，其余交给静态资源',
    /const API_PATHS = \['\/health', '\/v1\/presign', '\/v1\/put', '\/v1\/get'\]/.test(pagesWorker)
    && /return env\.ASSETS\.fetch\(request\)/.test(pagesWorker), '');
  ok('上游仍是真 Worker（边缘转发，Cloudflare 内部解析不受本地污染影响）',
    /const UPSTREAM = 'https:\/\/unimate-sync\.2025040140\.workers\.dev'/.test(pagesWorker), '');
  ok('转发时剥掉 Origin（Worker 侧按服务端到服务端放行）',
    /headers\.delete\('Origin'\)/.test(pagesWorker), '');
  ok('CORS 允许 APK 的来源 https://localhost（原来只有 http://localhost，会被 403）',
    pagesWorker.includes("EXACT_ORIGINS = ['https://unimate3.pages.dev']")
    && pagesWorker.includes('LOCAL_ORIGIN = /^https?:\\/\\/(localhost|127\\.0\\.0\\.1)(:\\d+)?$/'), '');
  ok('本机调试的带端口来源（http://localhost:5204）也被允许 —— v2.39 的坑',
    /function pickOrigin\(raw\)/.test(pagesWorker) && /LOCAL_ORIGIN\.test\(raw\)/.test(pagesWorker), '');
  ok('预检返回 204 且带 Allow-Methods/Allow-Headers',
    /request\.method === 'OPTIONS'\) return new Response\(null, \{ status: 204/.test(pagesWorker)
    && /Access-Control-Allow-Methods/.test(pagesWorker) && /Access-Control-Allow-Headers/.test(pagesWorker), '');
  ok('上游不可达时给 502 而不是抛异常', /jsonError\('同步服务暂时不可达', 502/.test(pagesWorker), '');
  ok('Pages worker 里不含任何密钥（只有转发与 CORS）',
    !/pepper|SECRET|ACCESS_KEY|ACCOUNT_ID/i.test(pagesWorker.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')), '');

  const wrangler = read('cloudflare/sync-worker/wrangler.toml');
  ok('Worker 白名单补上 https://localhost（改了要 redeploy，真机走 Pages 转发）',
    /APP_ORIGINS = "http:\/\/localhost,https:\/\/localhost,https:\/\/unimate3\.pages\.dev"/.test(wrangler), '');

  const packer = read('scripts/make-pages-package.mjs');
  ok('Pages 打包脚本存在且把 _worker.js 放到上传目录根部',
    /cpSync\(workerSrc, join\(outDir, '_worker\.js'\)\)/.test(packer), '');
  ok('Pages 打包脚本可用（不再手工拷目录）',
    /unimate-cloudflare-' \+ version \+ '-upload'/.test(packer), '');

  const docs = read('PRD.md') + read('Net.md');
  ok('文档记录了 workers.dev 在大陆被污染/不可达这一事实',
    /workers\.dev/.test(docs) && /69\.171\.228\.74|DNS 污染/.test(docs), '');
}

/*
 * v2.41：正文也走 pages.dev 中转。
 *
 * 真机证据（截图）：点「建立同步并生成恢复码」成功、恢复码正常显示，再点「确认并上传密文」报
 * 「上传加密备份失败，请检查网络后重试」—— 该文案来自客户端 `fetchTimed('上传加密备份', …)`，
 * 也就是**预签名已经成功、失败在直传 R2 那一步**。而 `cloudflare/sync-worker/cors.json` 当时只有
 * `http://localhost` / `https://unimate3.pages.dev`，缺 APK 的来源 `https://localhost`
 * （与 v2.39 那次 403 是同一个坑，只是换了张表），WebView 会拦掉直传响应。
 * 顺带：大陆移动网络能否稳定连到 R2 的 S3 域名也不由我们决定 —— 所以正文也搬到 pages.dev。
 */
console.log('\n--- v2.41：密文正文改走 pages.dev 中转（不再让手机直连 R2）---');
{
  const pagesWorker = read('cloudflare/pages/_worker.js');
  ok('Pages worker 接管 /v1/put 与 /v1/get',
    /API_PATHS = \['\/health', '\/v1\/presign', '\/v1\/put', '\/v1\/get'\]/.test(pagesWorker), '');
  ok('中转上传：先调上游 /v1/presign（operation=put）再代 PUT',
    /async function relayPut\(/.test(pagesWorker)
    && /presignUpstream\(request, syncId, 'put', bytes\.length\)/.test(pagesWorker)
    && /method: 'PUT'/.test(pagesWorker), '');
  ok('代 PUT 带 Content-Type（短链是按它签的，必须一致）',
    /headers: \{ 'Content-Type': SYNC_CONTENT_TYPE \}/.test(pagesWorker)
    && /SYNC_CONTENT_TYPE = 'application\/vnd\.unimate\.sync\+json'/.test(pagesWorker), '');
  ok('中转下载：把密文正文原样返回（Content-Type 即同步包类型）',
    /async function relayGet\(/.test(pagesWorker)
    && /out\.headers\.set\('Content-Type', SYNC_CONTENT_TYPE\)/.test(pagesWorker), '');
  ok('对象不存在 → 404，且文案与客户端一致',
    /jsonError\('这个同步码还没有云端备份', 404, origin\)/.test(pagesWorker), '');
  ok('中转失败给 502 而不是抛异常（含"边缘连不上 R2"两种情形）',
    /边缘连不上 R2/.test(pagesWorker) && /jsonError\('同步服务暂时不可达', 502, origin\)/.test(pagesWorker), '');
  ok('中转有上限，不放宽 Worker 的 30MB',
    /const MAX_RELAY_BYTES = 30 \* 1024 \* 1024/.test(pagesWorker) && /413/.test(pagesWorker), '');
  ok('中转透传 CF-Connecting-IP（Worker 按它限频，不透传会挤成一个桶）',
    /CF-Connecting-IP/.test(pagesWorker), '');
  ok('Pages worker 里依然没有任何密钥',
    !/pepper|SECRET|ACCESS_KEY|ACCOUNT_ID/i.test(pagesWorker.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')), '');

  const cloudSrc = read('src/services/cloudSync.ts');
  ok('客户端正文默认走中转端点 /v1/put 与 /v1/get',
    /relayUrl\('\/v1\/put', syncId\)/.test(cloudSrc) && /relayUrl\('\/v1\/get', syncId\)/.test(cloudSrc), '');
  ok('中转不可用时回退直传（老版 Pages 仍能按原路走）',
    /return relayed !== null \? relayed : directUpload\(syncId, bytes\)/.test(cloudSrc)
    && /return relayed !== null \? relayed : directDownload\(syncId\)/.test(cloudSrc), '');
  ok('直传与中转的报错分得开（下次真机截图能直接定位在哪一步）',
    /直传 R2 上传失败（/.test(cloudSrc) && /经中转上传加密备份/.test(cloudSrc), '');
  ok('中转失败会把服务端文案/状态码透出来，不再只有一句"请检查网络"',
    /typeof body\?\.error === 'string' \? body\.error : '上传加密备份失败（' \+ response\.status \+ '）'/.test(cloudSrc), '');

  // 这一条才是本次真机失败的直接原因：桶的 CORS 白名单缺 APK 的来源
  const bucketCors = read('cloudflare/sync-worker/cors.json');
  ok('R2 桶 CORS 补上 https://localhost（APK 的页面源，原来只有 http://localhost）',
    /"https:\/\/localhost"/.test(bucketCors) && /"http:\/\/localhost"/.test(bucketCors), bucketCors);
  ok('桶 CORS 仍允许站点自身与 Content-Type',
    /unimate3\.pages\.dev/.test(bucketCors) && /"Content-Type"/.test(bucketCors), '');
}

/*
 * v2.41 行为验证：把上游 Worker 与 R2 打桩，真的走一遍中转。
 * 光有结构断言不够 —— 上一次真机失败的教训就是"看着都对，一跑就炸"。
 */
console.log('\n--- v2.41 行为：中转路径真跑一遍（打桩上游 Worker 与 R2）---');
{
  const pagesModule: any = await import('../cloudflare/pages/_worker.js');
  const relay = pagesModule.default;
  const realFetch = globalThis.fetch;
  const seen: Array<{ url: string; method: string; headers: any; body: any }> = [];
  const ticketUrl = 'https://acct.r2.cloudflarestorage.com/unimate-sync/v1/hmac.umig?X-Amz-Expires=900&X-Amz-Signature=stub';
  const assets = { fetch: () => new Response('<!doctype html>asset', { status: 200, headers: { 'Content-Type': 'text/html' } }) };

  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    seen.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    if (url.includes('/v1/presign')) {
      return new Response(JSON.stringify({ url: ticketUrl, method: 'PUT', expiresAt: '2026-09-22T12:00:00.000Z', headers: { 'Content-Type': 'application/vnd.unimate.sync+json' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url === ticketUrl) {
      // 打桩的"R2"：GET 时回一段密文，PUT 时记下来
      if ((init.method || 'GET') === 'GET') {
        return new Response(new Uint8Array([9, 8, 7]), { status: 200, headers: { 'Content-Type': 'application/vnd.unimate.sync+json' } });
      }
      return new Response(null, { status: 200 });
    }
    return new Response('missing', { status: 404 });
  }) as any;

  try {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const putRes = await relay.fetch(new Request('https://unimate3.pages.dev/v1/put?syncId=' + first.config.syncId, {
      method: 'POST', headers: { Origin: 'https://localhost', 'Content-Type': 'application/vnd.unimate.sync+json' }, body: payload
    }), { ASSETS: assets });
    const putBody: any = await putRes.json();
    ok('中转上传：APK 的来源 https://localhost 被放行（这正是真机失败的那一格）',
      putRes.status === 200 && putBody.ok === true && putRes.headers.get('Access-Control-Allow-Origin') === 'https://localhost', JSON.stringify(putBody));
    const putCall = seen.find((x) => x.url === ticketUrl && x.method === 'PUT');
    ok('中转上传：真的把密文 PUT 给了 R2，且字节一致',
      !!putCall && Buffer.from(putCall.body).equals(Buffer.from(payload)), String(putCall && putCall.body?.length));
    ok('中转上传：代 PUT 的 Content-Type 与短链签名时一致',
      !!putCall && putCall.headers['Content-Type'] === 'application/vnd.unimate.sync+json', JSON.stringify(putCall?.headers));
    const presignCall = seen.find((x) => x.url.includes('/v1/presign'));
    ok('中转上传：调上游预签名时剥掉了 Origin（服务端到服务端放行）',
      !!presignCall && !presignCall.headers.Origin && /"operation":"put"/.test(String(presignCall.body)), JSON.stringify(presignCall?.headers));

    const getRes = await relay.fetch(new Request('https://unimate3.pages.dev/v1/get?syncId=' + first.config.syncId, {
      method: 'POST', headers: { Origin: 'https://localhost', 'Content-Type': 'application/json' }, body: '{}'
    }), { ASSETS: assets });
    const got = new Uint8Array(await getRes.arrayBuffer());
    ok('中转下载：正文原样带回，且 Content-Type 是同步包类型（客户端据此区分错误 JSON）',
      got.length === 3 && got[0] === 9 && (getRes.headers.get('Content-Type') || '').includes('application/vnd.unimate.sync+json'), '');

    const denied = await relay.fetch(new Request('https://unimate3.pages.dev/v1/put?syncId=x', {
      method: 'POST', headers: { Origin: 'https://evil.example' }, body: new Uint8Array([1])
    }), { ASSETS: assets });
    ok('中转上传：非白名单来源 403（不因为要传正文就把门开大）', denied.status === 403, '');

    const unknown = await relay.fetch(new Request('https://unimate3.pages.dev/sample-timetable.html'), { ASSETS: assets });
    ok('非同步路径仍然交给静态资源', unknown.status === 200 && (await unknown.text()).includes('<!doctype html>'), '');
  } finally {
    globalThis.fetch = realFetch;
  }
}

/*
 * v2.42：账号同步（A 方案）——把"要抄的同步码"换成"账号 + 口令"。
 * 账号名只在本机参与派生；服务器看到的仍然只有同步码（再经 pepper 变对象名）。
 */
console.log('\n--- v2.42：账号同步（A 方案）---');
{
  const id1 = deriveAccountSyncId('zhixiaohui');
  ok('账号派生的同步码是 22 字符 base64url（与随机同步码同一命名空间，云端接口不用改）',
    /^[A-Za-z0-9_-]{22}$/.test(id1), id1);
  ok('同一个账号每次算出来都一样（换机才找得到）', deriveAccountSyncId('zhixiaohui') === id1, '');
  ok('归一化：大小写、首尾空格、全角、连续空格都不影响结果',
    deriveAccountSyncId('  ZhiXiaoHui ') === id1 && normalizeAccount('张　三') === normalizeAccount('张 三'), '');
  ok('不同账号 → 不同同步码', deriveAccountSyncId('zhixiaohui') !== deriveAccountSyncId('zhixiaohui2'), '');
  ok('账号名不会原样出现在同步码里（它是哈希）', !id1.includes('zhixiaohui'), id1);
  let short = '';
  try { deriveAccountSyncId('ab'); } catch (e: any) { short = e.message; }
  ok('账号太短直接拒绝', /至少 3 个字符/.test(short), short);
  let tooLong = '';
  try { deriveAccountSyncId('a'.repeat(65)); } catch (e: any) { tooLong = e.message; }
  ok('账号过长直接拒绝（避免有人拿它当存储用）', /64/.test(tooLong), tooLong);

  // 账号模式建包：同步码必须等于账号派生的那个，否则换机查不到对象
  const plain2 = new TextEncoder().encode('账号同步的课表数据：高等数学 周一 1-2 节'.repeat(8));
  const pack = await encryptForSync(plain2, 'correct horse battery staple', undefined, '  ZhiXiaoHui ');
  ok('账号模式建包：同步码 = 账号派生值', pack.config.syncId === id1, pack.config.syncId);
  ok('账号模式也生成恢复码', !!pack.recoveryCode && pack.recoveryCode.startsWith('UM1.'));
  ok('账号模式的恢复码指向同一份云端对象（否则恢复码在别的手机上会查空）',
    parseRecoveryCode(pack.recoveryCode!).syncId === id1, parseRecoveryCode(pack.recoveryCode!).syncId);
  ok('账号模式同样能只凭恢复码解密（口令忘了还有这条路）',
    Buffer.from((await decryptSync(pack.bytes, pack.recoveryCode!)).backup).equals(Buffer.from(plain2)), '');

  // 打桩上游 Worker 与 R2，把"新手机用账号找回"整条链真跑一遍
  const pagesModule2: any = await import('../cloudflare/pages/_worker.js');
  const relay2 = pagesModule2.default;
  const realFetch2 = globalThis.fetch;
  const seen2: Array<{ url: string; method: string; headers: any; body: any }> = [];
  const ticket2 = 'https://acct.r2.cloudflarestorage.com/unimate-sync/v1/from-account.umig?X-Amz-Signature=stub';
  const cloud = new Map<string, Uint8Array>();
  let lastPresignBody = '';
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    seen2.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    if (url.includes('/v1/presign')) {
      lastPresignBody = String(init.body || '');
      return new Response(JSON.stringify({ url: ticket2, method: 'PUT', expiresAt: '2026-09-22T13:00:00.000Z' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url === ticket2) {
      const method = init.method || 'GET';
      const stored = cloud.get('obj');
      if (method === 'PUT') { cloud.set('obj', new Uint8Array(init.body)); return new Response(null, { status: 200 }); }
      if (!stored) return new Response('nope', { status: 404 });
      return new Response(stored, { status: 200, headers: { 'Content-Type': 'application/vnd.unimate.sync+json' } });
    }
    return new Response('missing', { status: 404 });
  }) as any;

  try {
    // 1) 第一台手机：账号 + 口令 → 加密 → 经 pages.dev 中转上传
    const putRes = await relay2.fetch(new Request('https://unimate3.pages.dev/v1/put?syncId=' + pack.config.syncId, {
      method: 'POST', headers: { Origin: 'https://localhost', 'Content-Type': 'application/vnd.unimate.sync+json' }, body: pack.bytes
    }), { ASSETS: { fetch: () => new Response('asset') } });
    ok('账号模式上传：中转返回 200', putRes.status === 200, '');
    ok('上传给服务端的只有同步码/操作/大小 —— 不含账号名，也不含口令',
      /"syncId":"[A-Za-z0-9_-]{22}"/.test(lastPresignBody) && !lastPresignBody.includes('zhixiaohui')
      && !lastPresignBody.includes('battery') && !/password|account/i.test(lastPresignBody), lastPresignBody);
    ok('中转 URL 里也没有账号名明文', !seen2[0].url.includes('zhixiaohui'), seen2[0].url);

    // 2) 第二台手机：只输账号 + 口令，自动算出同步码 → 下载 → 解密
    const getRes = await relay2.fetch(new Request('https://unimate3.pages.dev/v1/get?syncId=' + deriveAccountSyncId('zhixiaohui'), {
      method: 'POST', headers: { Origin: 'https://localhost', 'Content-Type': 'application/json' }, body: '{}'
    }), { ASSETS: { fetch: () => new Response('asset') } });
    const fromCloud = new Uint8Array(await getRes.arrayBuffer());
    const opened = await decryptSync(fromCloud, deriveAccountSyncId('zhixiaohui'), 'correct horse battery staple');
    ok('换机：只凭"账号 + 口令"就把备份拿回来，且逐字节一致',
      Buffer.from(opened.backup).equals(Buffer.from(plain2)), '');
    let wrongMsg = '';
    try { await decryptSync(fromCloud, deriveAccountSyncId('zhixiaohui'), 'wrong password here'); }
    catch (e: any) { wrongMsg = e.message; }
    ok('口令错 → 明确拒绝，不返回数据', /不正确|校验失败/.test(wrongMsg), wrongMsg);

    // 3) 删除云端备份（撤回）：墓碑覆盖，密文随之销毁
    const stone = tombstoneBytes();
    ok('墓碑是合法的小 JSON，且不含任何用户数据',
      isTombstone(stone) && stone.length < 300 && !new TextDecoder().decode(stone).includes('高等数学'), '');
    await relay2.fetch(new Request('https://unimate3.pages.dev/v1/put?syncId=' + pack.config.syncId, {
      method: 'POST', headers: { Origin: 'https://localhost', 'Content-Type': 'application/vnd.unimate.sync+json' }, body: stone
    }), { ASSETS: { fetch: () => new Response('asset') } });
    const afterDelete = cloud.get('obj')!;
    ok('删除后桶里只剩墓碑，原密文被覆盖销毁（R2 不开版本控制）',
      isTombstone(afterDelete) && !Buffer.from(afterDelete).equals(Buffer.from(pack.bytes)), '');
  } finally {
    globalThis.fetch = realFetch2;
  }

  // 界面与存储接线（光有算法、没接上也没用）
  const me = read('src/views/MeView.vue');
  ok('界面：账号同步的三个动作都接上了（上传 / 找回 / 删除云端备份）',
    /async function accountUpload\(/.test(me) && /async function accountFetch\(/.test(me) && /async function deleteCloudBackup\(/.test(me), '');
  ok('界面：账号找回走"下载 → 解密 → 预览 → 覆盖/合并 → 二次确认"同一条链路',
    /const syncId = deriveAccountSyncId\(account\)/.test(me) && /downloadSyncCipher\(syncId\)/.test(me)
    && /decryptSync\(cipher, syncId, acctPass\.value\)/.test(me), '');
  ok('界面：删除云端备份走 db.confirm 二次确认（硬规则 1）',
    /async function deleteCloudBackup[\s\S]{0,400}db\.confirm\(/.test(me), '');
  ok('界面：换同步方式时销毁旧云端备份也要二次确认',
    /要顺手销毁旧的云端备份吗/.test(me), '');
  ok('文案与实现一致：不再写"直传 Cloudflare R2"（正文已改走 pages.dev 中转）',
    !/直传 Cloudflare R2/.test(me) && /经 <b>unimate3\.pages\.dev<\/b> 中转上传/.test(me), '');
  ok('隐私文案说清"账号/口令/恢复码不上传、不保存"',
    /你的同步账号、口令和恢复码不上传、不保存/.test(me), '');
  const types = read('src/types.ts');
  const dbSrc = read('src/stores/db.ts');
  ok('设置里只多存一个账号名（口令绝不落盘）',
    /syncAccount\?: string \| null/.test(types) && /syncAccount: null/.test(dbSrc)
    && !/syncPassword|syncPassphrase|syncPass\b/.test(types + dbSrc), '');
}

console.log('\n通过：' + pass + ' 条 P3 同步断言');
if (process.exitCode) process.exit(process.exitCode);
