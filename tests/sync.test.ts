import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gcm } from '@noble/ciphers/aes';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import {
  SYNC_KDF_ITERATIONS, configFromRecovery, decryptSync, deriveAccountSyncId, deriveAuthVerifier, encryptForSync, isTombstone,
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
// v2.47：同步/找回那一屏从「我的」搬到了主页入口的 components/AccountRecovery.vue，
// 所以下面所有"界面里有没有这些字"的断言，两个文件一起看。
const me = read('src/views/MeView.vue') + read('src/components/AccountRecovery.vue');
const login = read('src/screens/Login.vue');
const cloud = read('src/services/cloudSync.ts');
const syncCryptoSource = read('src/services/syncCrypto.ts');
const worker = read('cloudflare/sync-worker/src/index.js');
ok('设置页有加密换机同步入口', me.includes('加密换机同步') && me.includes('确认并上传密文'));
ok('恢复前仍走统一二次确认', /await db\.confirm\(\{/.test(me) && /开始恢复/.test(me));
ok('口令输入禁止浏览器自动填充', (me.match(/autocomplete="off"/g) || []).length >= 3);
// v2.42 起关于页还要点名"账号"：账号同步上线后，只说"口令和恢复码"就不够了
// v2.47：关于页按产品负责人要求精简（只留用户要知道的），话术跟着改成更短的句子，要点不变
ok('关于页如实写明可选密文上传（含账号同步）',
  me.includes('服务器只拿到读不懂的密文') && me.includes('口令和恢复码不上传')
  && me.includes('服务器持有密钥、可以读取这份备份'));
// v2.43/v2.44 起登录页同时挂着两条路径，文案必须都写出来、且不许出现"绝不上传"这类绝对话术
ok('登录页如实说明两条可选云端路径（账号登录可读 / 端到端只存密文）',
  login.includes('账号登录') && login.includes('端到端加密同步') && login.includes('服务器只存密文')
  && !/绝不上传|不会上传任何/.test(login));
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
  // v2.45：env 访问改成容错写法（Node 单测里没有 import.meta.env），断言跟着放宽但要点不变
  ok('客户端默认 API 基地址是 pages.dev，不是 workers.dev',
    /VITE_SYNC_API_BASE \|\| 'https:\/\/unimate3\.pages\.dev'/.test(cloudSrc)
    && !/SYNC_API_BASE[^\n]*workers\.dev/.test(cloudSrc), '');

  const pagesWorker = read('cloudflare/pages/_worker.js');
  ok('Pages 上有 Advanced Mode 入口 _worker.js', pagesWorker.length > 500, '');
  // v2.41 多了 /v1/put、/v1/get（正文中转）；v2.43 又多了账号 API 四条。静态资源仍然交给 env.ASSETS
  ok('只接管同步/账号/管理员 API 的几条路径，其余交给静态资源',
    /const API_PATHS = \['\/health', '\/v1\/presign', '\/v1\/put', '\/v1\/get',/.test(pagesWorker)
    && /'\/v1\/signup', '\/v1\/login', '\/v1\/account', '\/v1\/backup',/.test(pagesWorker)
    && /'\/admin', '\/v1\/admin\/list', '\/v1\/admin\/reset'\]/.test(pagesWorker)
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
    /API_PATHS = \['\/health', '\/v1\/presign', '\/v1\/put', '\/v1\/get',/.test(pagesWorker), '');
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
  const me = read('src/views/MeView.vue') + read('src/components/AccountRecovery.vue');
  // v2.45 把端到端那条的 `accountUpload` 改名成 `accountSyncUpload`：它和云账号上传重名，
  // 属于 v2.40 `guard` 那一类"编译期悄悄改 import 名"的雷（现在的 test:order 会扫出来）
  // v2.47：这一屏搬进 components/AccountRecovery.vue，函数名也改成更直白的 e2eeUpload / e2eeFetch
  ok('界面：端到端账号同步的三个动作都接上了（上传 / 找回 / 删除云端备份）',
    /async function e2eeUpload\(/.test(me) && /async function e2eeFetch\(/.test(me) && /async function deleteCloudBackup\(/.test(me), '');
  ok('界面：账号找回走"下载 → 解密 → 预览 → 覆盖/合并 → 二次确认"同一条链路',
    /const syncId = deriveAccountSyncId\(account\)/.test(me) && /downloadSyncCipher\(syncId\)/.test(me)
    && /decryptSync\(cipher, syncId, acctPass\.value\)/.test(me), '');
  ok('界面：删除云端备份走 db.confirm 二次确认（硬规则 1）',
    /async function deleteCloudBackup[\s\S]{0,400}db\.confirm\(/.test(me), '');
  ok('界面：换同步方式时销毁旧云端备份也要二次确认',
    /要顺手销毁旧的云端备份吗/.test(me), '');
  ok('文案与实现一致：不再写"直传 Cloudflare R2"（正文已改走 pages.dev 中转）',
    !/直传 Cloudflare R2/.test(me) && !/unimate3\.pages\.dev/.test(read('src/views/MeView.vue')), '');
  ok('隐私文案说清"口令/恢复码不上传、不保存"（端到端那条路）',
    /口令和恢复码不上传/.test(me), '');
  const types = read('src/types.ts');
  const dbSrc = read('src/stores/db.ts');
  ok('设置里只多存一个账号名（口令绝不落盘）',
    /syncAccount\?: string \| null/.test(types) && /syncAccount: null/.test(dbSrc)
    && !/syncPassword|syncPassphrase|syncPass\b/.test(types + dbSrc), '');
}

/*
 * v2.43：账号登录（服务器托管）。产品负责人撤销了"数据只在本机/只上传密文"，
 * 要求做成普通 App：注册/登录后数据存云端，换机登录就有课表。
 * 这一段的重点是**行为**：把 R2 打桩，真的走一遍注册 → 登录 → 上传 → 下载 → 注销，
 * 并确认"密码原文不上传""账号名不落进对象名""落盘加密真的生效"。
 */
console.log('\n--- v2.43：账号登录（服务器托管）---');
{
  const verifier = await deriveAuthVerifier('zhixiaohui', 'a-good-password');
  ok('口令校验值 = 43 字符 base64url（本地 210k 次 PBKDF2 派生，密码原文不上传）',
    /^[A-Za-z0-9_-]{43}$/.test(verifier), verifier);
  ok('同一个账号+密码每次一致；换密码或换账号就不同',
    (await deriveAuthVerifier('zhixiaohui', 'a-good-password')) === verifier
    && (await deriveAuthVerifier('zhixiaohui', 'another-password')) !== verifier
    && (await deriveAuthVerifier('someone-else', 'a-good-password')) !== verifier, '');
  let shortPass = '';
  try { await deriveAuthVerifier('zhixiaohui', 'short'); } catch (e: any) { shortPass = e.message; }
  ok('密码太短直接拒绝', /至少 8 个字符/.test(shortPass), shortPass);

  const worker3: any = await import('../cloudflare/sync-worker/src/index.js');
  const syncWorker = worker3.default;
  const realFetch3 = globalThis.fetch;
  /** 打桩 R2（S3 协议）：只用到 GET/PUT/DELETE */
  const bucket = new Map<string, { body: Uint8Array; type: string }>();
  const r2Requests: Array<{ key: string; method: string }> = [];
  globalThis.fetch = (async (input: any, init: any = {}) => {
    // aws4fetch 会把请求规范化成一个 Request 再调 fetch，所以方法/正文要从 Request 上读
    const req = input instanceof Request ? input : new Request(typeof input === 'string' ? input : input.url, init);
    const path = new URL(req.url).pathname.replace(/^\/[^/]+\//, '');
    const method = req.method.toUpperCase();
    r2Requests.push({ key: path, method });
    if (method === 'PUT') {
      const raw = new Uint8Array(await req.arrayBuffer());
      bucket.set(path, { body: raw, type: req.headers.get('content-type') || 'application/octet-stream' });
      return new Response(null, { status: 200 });
    }
    if (method === 'DELETE') { bucket.delete(path); return new Response(null, { status: 204 }); }
    const found = bucket.get(path);
    if (!found) return new Response('not found', { status: 404 });
    return new Response(found.body, { status: 200, headers: { 'Content-Type': found.type } });
  }) as any;

  const accountEnv = {
    APP_ORIGINS: 'https://localhost,https://unimate3.pages.dev', R2_BUCKET_NAME: 'unimate-sync', R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    R2_ACCESS_KEY_ID: 'test-access-key', R2_SECRET_ACCESS_KEY: 'test-secret-key', SYNC_OBJECT_PEPPER: 'test-only-pepper-at-least-32-bytes-long',
    DATA_KEY: 'test-only-at-rest-key-do-not-reuse', SYNC_RATE_LIMITER: { limit: async () => ({ success: true }) }
  };
  const call = (path: string, init: any = {}) => syncWorker.fetch(new Request('https://sync.example' + path, {
    ...init, headers: { Origin: 'https://localhost', ...(init.headers || {}) }
  }), accountEnv);

  try {
    const health = await syncWorker.fetch(new Request('https://sync.example/health'), accountEnv);
    const healthBody: any = await health.json();
    ok('健康检查自报支持账号模式与落盘加密（客户端据此判断服务端是否已升级）',
      healthBody.accounts === true && healthBody.atRest === true, JSON.stringify(healthBody));

    const signup = await call('/v1/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: '  ZhiXiaoHui ', verifier }) });
    const signed: any = await signup.json();
    ok('注册成功并返回会话令牌（大小写/空格归一后是同一个账号）',
      signup.status === 201 && signed.account === 'zhixiaohui' && typeof signed.token === 'string' && signed.token.length >= 40, JSON.stringify(signed).slice(0, 120));
    ok('注册接口带了 CORS 回显（手机来源 https://localhost）',
      signup.headers.get('Access-Control-Allow-Origin') === 'https://localhost', '');

    const dup = await call('/v1/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'zhixiaohui', verifier }) });
    ok('同账号重复注册被拒（409）', dup.status === 409, String(dup.status));

    // 账号记录：账号名不能出现在对象名里；verifier 原文不能落盘
    const recordKey = [...bucket.keys()].find((k) => k.startsWith('acct/'))!;
    const recordRaw = new TextDecoder().decode(bucket.get(recordKey)?.body ?? new Uint8Array());
    ok('账号记录的对象名是 HMAC，不含账号名明文', !recordKey.includes('zhixiaohui') && /^acct\/[0-9a-f]{64}\.json$/.test(recordKey), recordKey);
    ok('落盘的是 sha256(盐 + verifier)，不是 verifier 原文', !recordRaw.includes(verifier) && /"verifierHash":"[0-9a-f]{64}"/.test(recordRaw), '');

    const wrongLogin = await call('/v1/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'zhixiaohui', verifier: await deriveAuthVerifier('zhixiaohui', 'wrong-password-here') }) });
    ok('口令不对 → 401，且不泄露"账号是否存在"',
      wrongLogin.status === 401 && /账号或口令不正确/.test(await wrongLogin.text()), String(wrongLogin.status));

    const login = await call('/v1/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'zhixiaohui', verifier }) });
    const session: any = await login.json();
    ok('正确口令可登录并换到新令牌', login.status === 200 && session.token !== signed.token, '');

    const noAuth = await call('/v1/backup?account=zhixiaohui', { method: 'GET' });
    ok('没有令牌读备份 → 401（账号数据不是公开的）', noAuth.status === 401, String(noAuth.status));
    const badToken = await call('/v1/backup?account=zhixiaohui', { method: 'GET', headers: { Authorization: 'Bearer not-a-real-token' } });
    ok('伪造令牌 → 401', badToken.status === 401, String(badToken.status));

    const payloadText = 'PK\u0003\u0004课表备份：高等数学 / 学生 智小汇';
    const payload3 = new TextEncoder().encode(payloadText);
    const upload = await call('/v1/backup?account=zhixiaohui', { method: 'PUT',
      headers: { Authorization: 'Bearer ' + session.token, 'Content-Type': 'application/octet-stream' }, body: payload3 });
    const uploaded: any = await upload.json();
    ok('带令牌上传备份成功，并回写大小/时间', upload.status === 200 && uploaded.size === payload3.length && !!uploaded.updatedAt, JSON.stringify(uploaded));

    const dataKey = [...bucket.keys()].find((k) => k.startsWith('data/'))!;
    const storedRaw = new TextDecoder().decode(bucket.get(dataKey)!.body);
    ok('落盘时真的加密了：桶里看不到课表明文',
      !!dataKey && !storedRaw.includes('高等数学') && /"alg":"AES-256-GCM"/.test(storedRaw), '');
    ok('数据对象名是随机 id，不含账号名', /^data\/[0-9a-f]{32}\.bin$/.test(dataKey), dataKey);

    const download = await call('/v1/backup?account=zhixiaohui', { method: 'GET', headers: { Authorization: 'Bearer ' + session.token } });
    const got = new Uint8Array(await download.arrayBuffer());
    ok('换机下载：解密后与上传逐字节一致（服务器持钥匙，但客户端拿回的是原件）',
      download.status === 200 && Buffer.from(got).equals(Buffer.from(payload3)), String(got.length));

    const meta = await call('/v1/account?account=zhixiaohui', { method: 'GET', headers: { Authorization: 'Bearer ' + session.token } });
    const metaBody: any = await meta.json();
    ok('账号信息接口能报出"云端有没有备份、多大、是否落盘加密"',
      metaBody.size === payload3.length && metaBody.sealed === true && !!metaBody.updatedAt, JSON.stringify(metaBody));

    const wiped = await call('/v1/account?account=zhixiaohui', { method: 'DELETE', headers: { Authorization: 'Bearer ' + session.token } });
    ok('注销成功返回 ok', wiped.status === 200 && (await wiped.json()).ok === true, '');
    ok('注销后账号记录与云端备份都从桶里消失', !bucket.has(recordKey) && !bucket.has(dataKey), [...bucket.keys()].join(','));
    const afterWipe = await call('/v1/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'zhixiaohui', verifier }) });
    ok('注销后再登录 → 401（不是"还在"）', afterWipe.status === 401, String(afterWipe.status));

    // 没设 DATA_KEY 时：按原样存（靠 R2 自带静态加密），这一条是为了把行为写清楚
    const plainEnv = { ...accountEnv, DATA_KEY: '' };
    const signup2 = await syncWorker.fetch(new Request('https://sync.example/v1/signup', { method: 'POST',
      headers: { Origin: 'https://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'no-seal-user', verifier }) }), plainEnv);
    const signed2: any = await signup2.json();
    await syncWorker.fetch(new Request('https://sync.example/v1/backup?account=no-seal-user', { method: 'PUT',
      headers: { Origin: 'https://localhost', Authorization: 'Bearer ' + signed2.token, 'Content-Type': 'application/octet-stream' },
      body: new TextEncoder().encode('未加密模式的正文') }), plainEnv);
    const noSealKey = [...bucket.keys()].find((k) => k.startsWith('data/'))!;
    const noSealRaw = new TextDecoder().decode(bucket.get(noSealKey)!.body);
    ok('没设 DATA_KEY 时按原样存正文（此时只能靠 R2 静态加密，界面会如实提示"未设落盘密钥"）',
      noSealRaw.includes('未加密模式的正文'), '');
  } finally {
    globalThis.fetch = realFetch3;
  }

  // 客户端与界面接线
  const accountSrc = read('src/services/account.ts');
  ok('客户端账号服务覆盖注册/登录/信息/上传/下载/注销，且每条都走 pages.dev 中转',
    ['/v1/signup', '/v1/login', '/v1/account', '/v1/backup'].every((p) => accountSrc.includes(p))
    && accountSrc.includes('SYNC_API_BASE'), '');
  ok('客户端只发送 verifier，不发送密码原文',
    /deriveAuthVerifier\(account, password\)/.test(accountSrc) && !/JSON\.stringify\(\{[^}]*password/.test(accountSrc), '');

  const me3 = read('src/views/MeView.vue') + read('src/components/AccountRecovery.vue');
  // v2.47：账号登录/注册搬去登录页，「账号与找回」面板留下取回与云端管理，函数名也跟着改直白
  ok('界面：账号取回与云端管理的动作都接上了',
    ['fetchFromCloud', 'uploadNow', 'logoutCloud', 'deleteCloudAccount']
      .every((fn) => new RegExp('function ' + fn + '\\(').test(me3)), '');
  ok('界面：注册/登录前必须勾选"同意上传到云端"（不能默认同意）',
    /v-model="cloudConsent"/.test(read('src/screens/Login.vue')) && /!cloudConsent/.test(read('src/screens/Login.vue')), '');
  ok('界面：注销账号走 db.confirm 二次确认（硬规则 1）',
    /async function deleteCloudAccount[\s\S]{0,600}db\.confirm\(/.test(me3), '');
  ok('界面：如实写明"服务器持有密钥、可以读取"（口径变了，文案必须跟着变）',
    /服务器持有密钥、可以读取/.test(me3) && /服务端存的是可读取的备份/.test(me3), '');
  // v2.47：云端取回改走"预览(previewCloudBackup) → db.confirm → adoptCloudBackup"，
  // 本机文件那条走"inspectBackup → db.confirm → restoreBackup" —— 两条都必须先预览再二次确认
  ok('界面：云端恢复仍然要过"预览 → 二次确认 → 落地"',
    /await previewCloudBackup\(bytes, db\)/.test(me3) && /await db\.confirm\(\{/.test(me3)
    && /await adoptCloudBackup\(bytes, db, session\)/.test(me3)
    && /await inspectBackup\(base64ToBytes\(b64\)\)/.test(me3), '');
  ok('设置里只存账号名/令牌，不存密码',
    /cloudAccount\?: \{/.test(read('src/types.ts')) && /cloudAccount: null/.test(read('src/stores/db.ts'))
    && !/cloudPassword|cloudPass:/ .test(read('src/types.ts') + read('src/stores/db.ts')), '');
  ok('Pages 中继把账号 API 也纳入转发表，且预检允许 Authorization/PUT/DELETE',
    /'\/v1\/signup', '\/v1\/login', '\/v1\/account', '\/v1\/backup'/.test(read('cloudflare/pages/_worker.js'))
    && /Access-Control-Allow-Headers', 'Content-Type, Authorization'/.test(read('cloudflare/pages/_worker.js'))
    && /GET,POST,PUT,DELETE,OPTIONS/.test(read('cloudflare/pages/_worker.js')), '');
}

/*
 * v2.44：开机登录页"用 Unimate 账号取回课表" —— 产品负责人要的"一个登录就全好"。
 */
console.log('\n--- v2.44：登录页直接取回云端课表 ---');
{
  const { makeZip } = await import('../src/services/zip.ts');
  const { inspectBackup, readBackupProfile } = await import('../src/services/backup.ts');
  const { adoptBlockedReason, previewCloudBackup } = await import('../src/services/cloudAdopt.ts');
  const enc2 = new TextEncoder();
  const savedAccount: any = {
    id: 'acc-0001', username: 'zhixiaohui', displayName: '智小汇', isDemo: false,
    passwordHash: 'deadbeef', salt: 'cafe', createdAt: '2026-09-23 08:00', lastLoginAt: ''
  };
  const manifest: any = {
    app: 'Unimate', version: '1.0.0', schemaVersion: 1, exportedAt: '2026-09-23 12:00',
    schoolId: 'buct', schoolName: '北京化工大学', username: 'zhixiaohui',
    counts: { timetables: 1, courses: 3, notes: 2, records: 0, photos: 0 }, files: []
  };
  const withProfile = makeZip([
    { name: 'BACKUP_MANIFEST.json', data: enc2.encode(JSON.stringify(manifest)) },
    { name: 'account/profile.json', data: enc2.encode(JSON.stringify(savedAccount)) },
    { name: 'account/timetable/courses.json', data: enc2.encode('[{"id":"c1"}]') }
  ]);
  const noProfile = makeZip([{ name: 'BACKUP_MANIFEST.json', data: enc2.encode(JSON.stringify(manifest)) }]);

  ok('能从备份里取出原账号记录（换机后连本机密码都还是原来那个）',
    readBackupProfile(withProfile)?.id === 'acc-0001' && readBackupProfile(withProfile)?.username === 'zhixiaohui', '');
  ok('老备份/第三方包没有 profile.json 时返回 null（由调用方新建本机账号承载）',
    readBackupProfile(noProfile) === null, '');

  const previewInfo = await inspectBackup(withProfile);
  ok('确认框需要的摘要（学校、时间、条数）都拿得到',
    previewInfo.manifest.schoolName === '北京化工大学' && previewInfo.manifest.counts.courses === 3, '');

  // 学校档案缺失必须拦住：否则会把数据"恢复"到一个不存在的学校目录
  const noSchool: any = { profileOf: () => null, accounts: [], timetables: [] };
  const hasSchool: any = { profileOf: () => ({}), accounts: [], timetables: [] };
  ok('本机没有这所学校的档案时给出明确提示，而不是硬恢复',
    /北京化工大学/.test(adoptBlockedReason(previewInfo.manifest, noSchool))
    && adoptBlockedReason(previewInfo.manifest, hasSchool) === '', '');
  ok('本机已有同 id 账号且有数据时，预览会标记"要覆盖"（提醒调用方去二次确认）',
    (await previewCloudBackup(withProfile, { ...hasSchool, timetables: [{}], accounts: [{ id: 'acc-0001' }] } as any)).willOverwrite === true
    && (await previewCloudBackup(withProfile, hasSchool as any)).willOverwrite === false, '');

  const adoptSrc = read('src/services/cloudAdopt.ts');
  ok('落地流程：接管/新建本机账号 → 绑定高校 → 恢复数据 → 重新读数据',
    /db\.accounts\.push\(account\)/.test(adoptSrc) && /selectSchool\(manifest\.schoolId, true\)/.test(adoptSrc)
    && /restoreBackup\(bytes, base, false\)/.test(adoptSrc) && /await db\.loadUserData\(\)/.test(adoptSrc), '');
  ok('落地流程把云账号会话一起存下（进主界面后不用再登一次）',
    /db\.settings\.cloudAccount = \{ \.\.\.cloud \}/.test(adoptSrc), '');
  ok('落地流程自己不做破坏性操作（覆盖确认交给调用方的 db.confirm）',
    !/remove\(/.test(adoptSrc) && /writeJson\('accounts\.json'/.test(adoptSrc), '');
  ok('落地流程把学校绑到账号上、并且恢复失败会退回登录页（不留空课表）',
    /account\.schoolId = manifest\.schoolId/.test(adoptSrc) && /db\.screen = 'login'/.test(adoptSrc), '');

  const loginSrc = read('src/screens/Login.vue');
  ok('登录页接上了"取回云端课表"：登录 → 读信息 → 下载 → 预览 → 确认 → 落地',
    /accountLogin\(name, cloudPass\.value\)/.test(loginSrc) && /accountDownload\(session\)/.test(loginSrc)
    && /previewCloudBackup\(bytes, db\)/.test(loginSrc) && /await adoptCloudBackup\(bytes, db, session\)/.test(loginSrc), '');
  ok('登录页取回前必过 db.confirm，且覆盖本机数据时标红',
    /await db\.confirm\(\{/.test(loginSrc) && /danger: preview\.willOverwrite/.test(loginSrc), '');
  // v2.46 登录页"二合一"后，云端说明在页面底部的隐私段落里（不再单独占一张卡）
  ok('登录页文案与实现一致：明说账号模式的备份存在云端服务器、服务端可读',
    /备份存云端服务器/.test(loginSrc) && /服务端持密钥可读/.test(loginSrc), '');
}

/*
 * v2.45：账号模式自动同步。不只看代码，真的跑一遍防抖/指纹/开关/失败分支。
 */
console.log('\n--- v2.45：改完自动同步（账号模式）---');
{
  const { AUTO_MAX_BYTES, createAutoSync, fingerprintOf } = await import('../src/services/cloudAutoSync.ts');
  type Deps = Parameters<typeof createAutoSync>[0];

  /** 造一个可控的 runner：默认已登录、开关开、内容可变 */
  function makeRunner(over: Partial<Deps> = {}) {
    let payload = new TextEncoder().encode('课表 v1');
    let fingerprint = '';
    const uploads: number[] = [];
    const statuses: string[] = [];
    const deps: Deps = {
      build: async () => payload,
      session: () => ({ account: 'zhixiaohui', token: 't', id: 'i', updatedAt: '', size: 0 }),
      enabled: () => true,
      upload: async (_s, bytes) => { uploads.push(bytes.length); return { updatedAt: '2026-09-23 13:00', size: bytes.length }; },
      onUploaded: (_m, fp) => { fingerprint = fp; },
      onStatus: (s) => { statuses.push(s.state); },
      lastFingerprint: () => fingerprint,
      debounceMs: 30,
      ...over
    };
    const runner = createAutoSync(deps);
    return {
      runner, uploads, statuses,
      setPayload(text: string) { payload = new TextEncoder().encode(text); },
      get fingerprint() { return fingerprint; }
    };
  }
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  {
    const t = makeRunner();
    t.runner.onDataChanged(); t.runner.onDataChanged(); t.runner.onDataChanged(); t.runner.onDataChanged();
    await wait(120);
    ok('连着改 4 次只上传一次（15 秒防抖，测试里用 30ms 等价验证）', t.uploads.length === 1, String(t.uploads.length));
  }
  {
    const t = makeRunner();
    await t.runner.flush();
    const first = t.uploads.length;
    t.runner.onDataChanged();
    await wait(120);
    ok('内容没变时不重复上传（指纹比对）', first === 1 && t.uploads.length === 1, String(t.uploads.length));
    t.setPayload('课表 v2');
    t.runner.onDataChanged();
    await wait(120);
    ok('内容变了才再传一次', t.uploads.length === 2, String(t.uploads.length));
    await t.runner.flush(true);
    ok('手动"立即同步"忽略指纹（force）', t.uploads.length === 3, String(t.uploads.length));
  }
  {
    const t = makeRunner({ session: () => null });
    t.runner.onDataChanged();
    await wait(120);
    ok('未登录云账号：一次请求都不发', t.uploads.length === 0 && t.runner.status().state === 'off', t.runner.status().message);
  }
  {
    const t = makeRunner({ enabled: () => false });
    t.runner.onDataChanged();
    await wait(120);
    ok('自动同步关掉后：一次请求都不发（与天气开关同口径）', t.uploads.length === 0, String(t.uploads.length));
    await t.runner.flush(true);
    ok('手动同步不受开关影响（用户主动点的照样传）', t.uploads.length === 1, String(t.uploads.length));
  }
  {
    let failed = 0;
    const t = makeRunner({ upload: async () => { failed++; throw new Error('网络断了'); } });
    const s = await t.runner.flush();
    ok('上传失败不抛异常、只记状态（本机数据不受影响）', failed === 1 && s.state === 'error' && /网络断了/.test(s.message), s.message);
  }
  {
    const big = new Uint8Array(AUTO_MAX_BYTES + 1);
    const t = makeRunner({ build: async () => big });
    const s = await t.runner.flush();
    ok('数据超过自动同步上限时跳过并提示手动上传（不偷偷烧流量）',
      s.state === 'skipped' && t.uploads.length === 0 && /手动上传/.test(s.message), s.message);
  }
  {
    const t = makeRunner({ build: async () => { throw new Error('磁盘读不到'); } });
    const s = await t.runner.flush();
    ok('打包失败只记状态、不抛（saveData 的调用方不受影响）', s.state === 'error' && /磁盘读不到/.test(s.message), s.message);
  }
  ok('指纹是 sha256 十六进制（64 字符）且同内容同指纹',
    /^[0-9a-f]{64}$/.test(fingerprintOf(new Uint8Array([1, 2, 3])))
    && fingerprintOf(new Uint8Array([1, 2, 3])) === fingerprintOf(new Uint8Array([1, 2, 3])), '');

  // 接线：数据落盘会发信号、App 启动会注册、面板有开关与状态行
  const dbSrc2 = read('src/stores/db.ts');
  ok('saveData 落盘后发"数据变更"信号（不阻塞保存、也不 import 上层服务）',
    /notifyDataChanged\(\);/.test(dbSrc2) && /function onDataChanged\(cb: \(\) => void\)/.test(dbSrc2)
    && !/from '..\/services\/cloudAutoSync/.test(dbSrc2), '');
  const appSrc = read('src/App.vue');
  ok('App 启动时注册自动同步（放在开屏之后，卡住也不影响进 App）',
    /initCloudAutoSync\(db\)/.test(appSrc) && appSrc.indexOf('splashDone.value = true') < appSrc.indexOf('initCloudAutoSync(db)'), '');
  const meSrc = read('src/views/MeView.vue') + read('src/components/AccountRecovery.vue');
  ok('面板有自动同步开关 + 状态行（文案说清"关掉后一次请求都不发"）',
    /toggleAutoSync/.test(meSrc) && /cloudAutoSync !== false/.test(meSrc) && /关掉后一次请求都不发/.test(meSrc), '');
  ok('手动上传与自动同步共用同一条流水线（syncNow），口径不会两样',
    /const result = await syncNow\(\)/.test(meSrc), '');
}

/*
 * v2.48：登录页只留「账号登录 / 注册账号」，「账号与找回」搬进登录页。
 */
console.log('\n--- v2.48：登录页只留账号、找回搬到登录页 ---');
{
  const login48 = read('src/screens/Login.vue');
  const tt48 = read('src/views/TimetableView.vue');
  const ar48 = read('src/components/AccountRecovery.vue');
  // 只看模板：注释里会提到"本机登录/离线进入"这些历史写法，扫全文会误判
  const loginTpl = (login48.match(/<template>([\s\S]*)<\/template>/) || [, ''])[1];

  ok('登录页只有两个页签：账号登录 / 注册账号',
    /mode === 'login'[\s\S]{0,80}账号登录/.test(loginTpl) && /mode === 'register'[\s\S]{0,80}注册账号/.test(loginTpl)
    // 页签按钮只有两个：数 `@click="mode = ..."` 的出现次数（"换机取回"这四个字在同意文案里是正常话术，不能一并禁掉）
    && (loginTpl.match(/@click="mode = /g) || []).length === 2
    && !/本机登录|创建本地账号/.test(loginTpl), '');
  ok('演示账号入口保留（离线也能进）', /用演示账号登录（admin \/ buct）/.test(loginTpl), '');
  ok('登录页不再有"本机登录"表单（登录态是持久化的，用不着它）',
    !/离线进入|本机已有账号/.test(loginTpl), '');
  ok('登录页写明"登录状态会保留、只有退出后要再登"',
    /登录状态会保留/.test(loginTpl) && /第一次登录需要联网/.test(loginTpl), '');
  ok('「账号与找回」入口在登录页，不在主页',
    /db\.openRecovery\(\)/.test(loginTpl) && !/openRecovery/.test(tt48), '');
  // v2.49：产品负责人要求"账号与找回单独留一个按钮"，不再是一行小字
  ok('「账号与找回」在登录页是一个独立按钮', /class="btn block ghost sm"[\s\S]{0,80}db\.openRecovery\(\)/.test(loginTpl), '');
  // 文案口径：界面上不提"服务器在境外"，只说"可能有点慢"
  ok('登录/找回界面不出现"境外"字样（只说服务器可能有点慢）',
    !/境外/.test(loginTpl) && !/境外/.test(ar48)
    && /服务器可能有点慢/.test(loginTpl) && /服务器可能有点慢/.test(ar48), '');
  ok('登录按钮只写"登录"（"取回课表"是登录后自动发生的事，不写进按钮承诺）',
    /: '登录' \}\}/.test(loginTpl) && /: '注册' \}\}/.test(loginTpl) && !/登录并取回课表/.test(loginTpl), '');

  ok('找回面板在"还没进 App"时也能用：文件恢复走接管流程（离线换机）',
    /if \(!db\.session \|\| !db\.profile\)[\s\S]{0,900}adoptCloudBackup\(bytes, db, null\)/.test(ar48), '');
  ok('找回面板仍然先预览再二次确认才落地',
    /await previewCloudBackup\(bytes, db\)/.test(ar48) && /confirmText: '恢复并进入'/.test(ar48), '');
}

/*
 * v2.50：① 本机找回（列本机账号直接进入）；② 云备份只带课表/记事（二课与照片留本机）；
 *       ③ 管理员重置密码（页面 + 两个接口）；④ 找回面板里 ② 只出现一次。
 */
console.log('\n--- v2.50：本机找回 / 二课不上云 / 管理员重置 ---');
{
  const { textFilesFor } = await import('../src/services/backup.ts');
  const backupSrc = read('src/services/backup.ts');
  ok('换机备份不含二课记录（只带课表/记事/设置）',
    !textFilesFor('study').some((f) => f.startsWith('secondclass/'))
    && textFilesFor('study').some((f) => f.startsWith('timetable/'))
    && textFilesFor('full').some((f) => f.startsWith('secondclass/')), textFilesFor('study').join(','));
  ok('换机范围不打包二课照片（只在 full 里走 files/）',
    /if \(scope === 'full'\) \{[\s\S]{0,400}files\//.test(backupSrc), '');
  ok('恢复时"包里没有的文件不动"（否则换机备份会把本机二课清空）',
    /const putIfPresent[\s\S]{0,400}if \(!data\) return;/.test(backupSrc)
    && !/dec\(get\('secondclass\/records\.json'\), \[\]\)/.test(backupSrc), '');
  ok('云上传与端到端上传都用换机范围（study）',
    /accountId, 'study'\)/.test(read('src/services/cloudAutoSync.ts'))
    && /db\.session\.accountId, 'study'\)/.test(read('src/components/AccountRecovery.vue')), '');

  const ar50 = read('src/components/AccountRecovery.vue');
  ok('找回面板第一项是"从本机找回"，并列出本机记录过的账号',
    /① 从本机找回/.test(ar50) && /v-for="a in localAccounts"/.test(ar50) && /db\.enterAccount\(id\)/.test(ar50), '');
  ok('本机找回不校验密码（设备即信任边界），并说明这一点', /不用再输密码/.test(ar50), '');
  ok('db 里有 enterAccount，且复用 finishLogin（有学校就直接进主界面）',
    /async function enterAccount\(accountId: string\)/.test(read('src/stores/db.ts'))
    && /await finishLogin\(\)/.test(read('src/stores/db.ts')), '');
  // 只数模板里的**标题元素**（注释里也会写"② …"，别把注释数进来）
  const arTpl50 = (ar50.match(/<template>([\s\S]*)<\/template>/) || [, ''])[1];
  const blocks = (arTpl50.match(/<div class="bold">② 用账号从云端取回<\/div>/g) || []).length;
  ok('找回面板里 ② 只渲染一次（截图里那块重复是长截图拼接，代码里只有一份）', blocks === 1, '出现 ' + blocks + ' 次');
  ok('面板写明"忘了密码找管理员重置"并给出管理员入口',
    /admin/.test(ar50) && /unimate3\.pages\.dev\/admin/.test(ar50), '');
  ok('面板如实写明云端备份的范围（只带课表与记事）', /只带课表与记事/.test(ar50), '');

  const pages50 = read('cloudflare/pages/_worker.js');
  ok('Pages 中继转发管理员页面与接口（手机才打得开）',
    /'\/admin', '\/v1\/admin\/list', '\/v1\/admin\/reset'/.test(pages50), '');

  // 管理员重置：打桩 R2，真跑一遍"注册 → 管理员列账号 → 重置 → 旧密码失效、新密码可登录"
  const worker50: any = await import('../cloudflare/sync-worker/src/index.js');
  const realFetch50 = globalThis.fetch;
  const store50 = new Map<string, Uint8Array>();
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const req = input instanceof Request ? input : new Request(typeof input === 'string' ? input : input.url, init);
    const u = new URL(req.url);
    const path = u.pathname.replace(/^\/[^/]+\//, '');
    const method = req.method.toUpperCase();
    if (u.searchParams.get('list-type') === '2') {             // ListObjectsV2
      const keys = [...store50.keys()].filter((k) => k.startsWith(u.searchParams.get('prefix') || ''));
      return new Response('<?xml version="1.0"?><ListBucketResult>' + keys.map((k) => '<Key>' + k + '</Key>').join('') + '</ListBucketResult>',
        { status: 200, headers: { 'Content-Type': 'application/xml' } });
    }
    if (method === 'PUT') { store50.set(path, new Uint8Array(await req.arrayBuffer())); return new Response(null, { status: 200 }); }
    if (method === 'DELETE') { store50.delete(path); return new Response(null, { status: 204 }); }
    const hit = store50.get(path);
    if (!hit) return new Response('nf', { status: 404 });
    return new Response(hit, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as any;
  const env50 = {
    APP_ORIGINS: 'https://localhost', R2_BUCKET_NAME: 'unimate-sync', R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', SYNC_OBJECT_PEPPER: 'p'.repeat(32),
    ADMIN_KEY: 'admin-key-for-test-only', SYNC_RATE_LIMITER: { limit: async () => ({ success: true }) }
  };
  const call50 = (path: string, body: any) => worker50.default.fetch(new Request('https://sync.example' + path,
    { method: 'POST', headers: { Origin: 'https://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env50);
  try {
    const page = await worker50.default.fetch(new Request('https://sync.example/admin'), env50);
    const html = await page.text();
    ok('管理员页面能打开，且内置了与客户端一致的 PBKDF2 派生（浏览器里算 verifier）',
      page.status === 200 && html.includes('PBKDF2') && html.includes('210000') && html.includes('unimate-auth-v1'), '');
    ok('管理员页面不提供下载用户数据的能力（只有列账号 + 重置）',
      !/\/v1\/backup/.test(html) && /重置密码/.test(html), '');

    const noKey50 = await worker50.default.fetch(new Request('https://sync.example/v1/admin/list',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), { ...env50, ADMIN_KEY: '' });
    ok('没配 ADMIN_KEY 时管理员接口 503（其它功能不受影响）', noKey50.status === 503, String(noKey50.status));
    const wrong50 = await call50('/v1/admin/list', { key: 'nope' });
    ok('管理员密钥不对 → 403', wrong50.status === 403, String(wrong50.status));

    const oldVerifier = await deriveAuthVerifier('reset-target', 'old-password-123');
    const up = await call50('/v1/signup', { account: 'reset-target', verifier: oldVerifier });
    ok('先注册一个账号用于验证重置流程', up.status === 201, String(up.status));
    const listed: any = await (await call50('/v1/admin/list', { key: env50.ADMIN_KEY })).json();
    ok('管理员能看到账号名单（含是否有云端备份）',
      Array.isArray(listed.accounts) && listed.accounts.some((a: any) => a.account === 'reset-target'), JSON.stringify(listed).slice(0, 120));

    const newVerifier = await deriveAuthVerifier('reset-target', 'new-password-456');
    const reset: any = await (await call50('/v1/admin/reset', { key: env50.ADMIN_KEY, account: 'reset-target', verifier: newVerifier })).json();
    ok('管理员重置成功并记录时间', reset.ok === true && !!reset.resetAt, JSON.stringify(reset));
    const oldLogin = await call50('/v1/login', { account: 'reset-target', verifier: oldVerifier });
    const newLogin = await call50('/v1/login', { account: 'reset-target', verifier: newVerifier });
    ok('重置后：旧密码登录失败、新密码可用（这是"找管理员重置"的核心承诺）',
      oldLogin.status === 401 && newLogin.status === 200, 'old=' + oldLogin.status + ' new=' + newLogin.status);
  } finally {
    globalThis.fetch = realFetch50;
  }
}

console.log('\n通过：' + pass + ' 条 P3 同步断言');
if (process.exitCode) process.exit(process.exitCode);
