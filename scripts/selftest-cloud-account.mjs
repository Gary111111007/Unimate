/**
 * 线上账号链路自检（v2.45）。用法：
 *
 *   npm run check:cloud
 *   UNIMATE_API_BASE=https://unimate3.pages.dev npm run check:cloud   # 换站点
 *
 * 做一件很具体的事：**用一个临时账号把线上链路整条走一遍，然后把账号和云端数据删掉**。
 *   健康检查 → 注册 → 上传备份 → 下载比对 → 账号信息 → 注销 → 注销后不能再登录
 *
 * 为什么值得单独留一个脚本：真机之前先在线把"服务端 + 中转 + R2"这段钉死，
 * 手机上再出问题就只剩"手机自己"这一种可能（v2.39/v2.41/v2.43 三次都是靠这种分层核对定位的）。
 *
 * 注意：
 *  · 它会往你的私有 R2 里写一个几 KB 的测试对象，**结束时通过注销接口删除**（自清理）；
 *  · 口令是本地随机生成的，只用于这次自检，不打印完整口令；
 *  · CORS 预检要带 Origin（curl 能做、Node 的 fetch 不允许设 Origin 头），所以那部分用 curl 单独核对，见 PRD 14.3。
 */
import { deriveAuthVerifier } from '../src/services/syncCrypto.ts';

const base = (process.env.UNIMATE_API_BASE || 'https://unimate3.pages.dev').replace(/\/+$/, '');
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const account = 'unimate-selftest-' + stamp;
const password = 'selftest-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

let pass = 0;
let failed = 0;
function ok(name, yes, detail = '') {
  if (yes) { pass++; console.log('  ok  ' + name + (detail ? ' — ' + detail : '')); return; }
  failed++; console.error('  FAIL ' + name + (detail ? ' — ' + detail : ''));
}

const payload = new TextEncoder().encode(JSON.stringify({
  note: 'Unimate 线上自检（可删）', account, at: new Date().toISOString(),
  filler: 'x'.repeat(1500)
}));

async function jsonOf(res) { try { return await res.json(); } catch { return null; } }

let token = '';
let created = false;

try {
  console.log('自检目标：' + base + '（临时账号 ' + account + '）\n');

  const health = await fetch(base + '/health', { method: 'GET' });
  const healthBody = await jsonOf(health);
  ok('健康检查：账号模式 + 落盘加密都已开启',
    health.ok && healthBody?.accounts === true && healthBody?.atRest === true, JSON.stringify(healthBody));

  const verifier = await deriveAuthVerifier(account, password);
  ok('本地口令校验值是 43 字符 base64url（口令原文不上传）', /^[A-Za-z0-9_-]{43}$/.test(verifier));

  const signup = await fetch(base + '/v1/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, verifier })
  });
  const signed = await jsonOf(signup);
  token = String(signed?.token || '');
  created = signup.status === 201;
  ok('注册成功（201 + 会话令牌）', created && token.length >= 40, 'HTTP ' + signup.status);
  if (!created) throw new Error('注册没成功，后面的步骤没法继续');

  const reSignup = await fetch(base + '/v1/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, verifier })
  });
  ok('同账号重复注册被拒（409）', reSignup.status === 409, 'HTTP ' + reSignup.status);

  const badLogin = await fetch(base + '/v1/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, verifier: await deriveAuthVerifier(account, password + '-wrong') })
  });
  ok('口令不对 → 401', badLogin.status === 401, 'HTTP ' + badLogin.status);

  const emptyBackup = await fetch(base + '/v1/backup?account=' + encodeURIComponent(account), {
    method: 'GET', headers: { Authorization: 'Bearer ' + token }
  });
  ok('还没上传时取备份 → 404', emptyBackup.status === 404, 'HTTP ' + emptyBackup.status);

  const upload = await fetch(base + '/v1/backup?account=' + encodeURIComponent(account), {
    method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream' }, body: payload
  });
  const uploaded = await jsonOf(upload);
  ok('上传备份成功（大小与时间都回写）',
    upload.ok && uploaded?.size === payload.length && !!uploaded?.updatedAt, JSON.stringify(uploaded));
  ok('服务端确认已做落盘加密（sealed=true）', uploaded?.sealed === true, String(uploaded?.sealed));

  const download = await fetch(base + '/v1/backup?account=' + encodeURIComponent(account), {
    method: 'GET', headers: { Authorization: 'Bearer ' + token }
  });
  const got = new Uint8Array(await download.arrayBuffer());
  ok('换机下载：取回的字节与上传完全一致',
    download.ok && got.length === payload.length && Buffer.from(got).equals(Buffer.from(payload)),
    got.length + ' / ' + payload.length + ' 字节');

  const info = await fetch(base + '/v1/account?account=' + encodeURIComponent(account), {
    method: 'GET', headers: { Authorization: 'Bearer ' + token }
  });
  const infoBody = await jsonOf(info);
  ok('账号信息能看到云端备份的时间/大小/加密状态',
    info.ok && infoBody?.size === payload.length && infoBody?.sealed === true, JSON.stringify(infoBody));

  const noAuth = await fetch(base + '/v1/backup?account=' + encodeURIComponent(account), { method: 'GET' });
  ok('不带令牌读备份 → 401', noAuth.status === 401, 'HTTP ' + noAuth.status);
} catch (e) {
  failed++;
  console.error('  FAIL 自检中断：' + (e?.message || e));
} finally {
  if (created) {
    const wiped = await fetch(base + '/v1/account?account=' + encodeURIComponent(account), {
      method: 'DELETE', headers: { Authorization: 'Bearer ' + token }
    });
    ok('注销成功（临时账号与云端数据一起删除）', wiped.ok, 'HTTP ' + wiped.status);
    const relogin = await fetch(base + '/v1/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account, verifier: await deriveAuthVerifier(account, password) })
    });
    ok('注销后再登录 → 401（数据确实没了）', relogin.status === 401, 'HTTP ' + relogin.status);
  } else {
    console.log('  --  没建过账号，无需清理');
  }
}

console.log('\n线上自检结果：' + pass + ' 通过 / ' + failed + ' 失败');
if (failed) process.exitCode = 1;
