// 教务系统地址解析测试（v2.71「正方识别」面板的纯函数部分）。
//
// 这一层存在的理由：面板里写着"优先从完整网址解析；教务位于网站根目录时留空"，
// 而 AGENTS.md 硬规则 6 要求"UI 文案必须与实现一致"——所以那些提示必须有真代码兑现，
// 并且**能被单测钉住**，否则改坏了没人知道。
//
// 重点守四件事：
//  1) 三种输入形态（完整网址 / 只有域名 / 域名+路径）都能归一成同一组 baseUrl；
//  2) 常见教务目录名（/jwglxt、/jsxsd…）要**截到那一段**，后面的页面路径丢掉；
//  3) 认不出的自建路径要原样保留，**不许擅自删**；
//  4) 协议白名单：只认 http/https；javascript:/data:/file: 一律拒。
import { parseJwAddress, loginUrlFor, isVendorDir, addressHint } from '../src/services/jwAddress.ts';

let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? ' -> ' + extra : ''));
}

console.log('--- 完整网址：拆成 baseUrl / domain / basePath / protocol ---');
{
  const p = parseJwAddress('https://jw.example.edu.cn:30443/jwglxt/xtgl/login_slogin.html');
  ok('解析通过', p.ok, p.error);
  ok('baseUrl = 协议 + 主机端口 + 基础路径（不含页面路径）',
    p.parts.baseUrl === 'https://jw.example.edu.cn:30443/jwglxt', p.parts.baseUrl);
  ok('domain 是主机 + 端口（不含路径）', p.parts.domain === 'jw.example.edu.cn:30443', p.parts.domain);
  ok('basePath 截到 /jwglxt（后面的 login_slogin.html 丢掉）', p.parts.basePath === '/jwglxt', p.parts.basePath);
  ok('protocol 是 https', p.parts.protocol === 'https', p.parts.protocol);
  // 这条是真的踩出来的：baseUrl 已含 /jwglxt 时再补整段会变成 /jwglxt/jwglxt/xtgl/...
  ok('loginUrl 不会把 /jwglxt 拼两遍',
    p.parts.loginUrl === 'https://jw.example.edu.cn:30443/jwglxt/xtgl/login_slogin.html', p.parts.loginUrl);
}

console.log('\n--- 只有域名（面板上"教务系统域名"那一格） ---');
{
  const a = parseJwAddress('jw.example.edu.cn');
  ok('裸域名也能解析', a.ok, a.error);
  ok('默认补 https', a.parts.baseUrl === 'https://jw.example.edu.cn', a.parts.baseUrl);
  ok('根目录时 basePath 为空串（对应提示语"留空"）', a.parts.basePath === '', JSON.stringify(a.parts.basePath));

  const b = parseJwAddress('jw.example.edu.cn', 'http');
  ok('fallbackProtocol=http 时补 http（协议二选一真的生效）',
    b.ok && b.parts.baseUrl === 'http://jw.example.edu.cn', b.parts.baseUrl);
  ok('http 下 loginUrl 也是 http（不会偷偷升到 https 打不开）',
    b.parts.loginUrl === 'http://jw.example.edu.cn/jwglxt/xtgl/login_slogin.html', b.parts.loginUrl);

  const c = parseJwAddress('jwxt.example.edu.cn:8080');
  ok('非标准端口保留（提示语里举的 :30443 就是这个场景）',
    c.ok && c.parts.domain === 'jwxt.example.edu.cn:8080', c.parts.domain);
}

console.log('\n--- 域名 + 路径，且输入里写了协议 → 以输入为准 ---');
{
  const p = parseJwAddress('http://jw.example.edu.cn/jwglxt/', 'https');
  ok('输入里的 http 覆盖面板选的 https', p.ok && p.parts.protocol === 'http', p.parts.protocol);
  ok('尾斜杠被去掉', p.parts.basePath === '/jwglxt', p.parts.basePath);
  ok('baseUrl 不带尾斜杠', p.parts.baseUrl === 'http://jw.example.edu.cn/jwglxt', p.parts.baseUrl);
}

console.log('\n--- 各种教务目录名都认得 ---');
{
  const cases: [string, string][] = [
    ['https://a.edu.cn/jwglxt/xtgl/login_slogin.html', '/jwglxt'],
    ['https://a.edu.cn/jwweb/Login.aspx', '/jwweb'],
    ['https://a.edu.cn/jsxsd/framework/xsMain.jsp', '/jsxsd'],
    ['https://a.edu.cn/jw/sso/login', '/jw'],
    ['https://a.edu.cn/jwc/index.html', '/jwc'],
    ['https://a.edu.cn/qzdatasoft/login', '/qzdatasoft'],
    ['https://a.edu.cn/urp/login', '/urp']
  ];
  for (const [url, want] of cases) {
    const p = parseJwAddress(url);
    ok('截断到 ' + want, p.ok && p.parts.basePath === want, p.parts.basePath + '  ← ' + url);
  }
}

console.log('\n--- 认不出的自建路径：原样保留，不许擅自删 ---');
{
  const p = parseJwAddress('https://jw.a.edu.cn/school-portal/jwglxt/login.html');
  ok('认不出 school-portal 就整段留着', p.ok && p.parts.basePath === '/school-portal/jwglxt', p.parts.basePath);

  const q = parseJwAddress('https://a.edu.cn/abcdef/');
  ok('完全认不出 → 保留 abcdef', q.ok && q.parts.basePath === '/abcdef', q.parts.basePath);

  ok('isVendorDir 对 jwglxt 为真', isVendorDir('jwglxt') === true);
  ok('isVendorDir 对 abcdef 为假', isVendorDir('abcdef') === false);
  ok('isVendorDir 大小写不敏感', isVendorDir('JwGlXt') === true);
}

console.log('\n--- 协议白名单：只认 http / https ---');
{
  const bad = [
    'javascript:alert(1)',
    'data:text/html,<script>1</script>',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
    'ftp://a.edu.cn/jwglxt'
  ];
  for (const s of bad) {
    const p = parseJwAddress(s);
    ok('拒绝 ' + s, !p.ok, '竟然通过：' + p.parts.baseUrl);
  }
  // 不变量：任何输入都不可能产出非 http(s) 的 baseUrl
  const probes = ['javascript:alert(1)', 'a.edu.cn', 'HTTPS://a.edu.cn/x', 'http://a.cn:1/x', '   ', '///', 'ftp://x'];
  const allSafe = probes.every((s) => {
    const p = parseJwAddress(s);
    return !p.ok || /^https?:\/\//.test(p.parts.baseUrl);
  });
  ok('【不变量】任何输入都不会产出非 http(s) 的 baseUrl', allSafe);
}

console.log('\n--- 非法/边界输入：给得出原因，不是静默失败 ---');
{
  const empty = parseJwAddress('');
  ok('空串被拒', !empty.ok);
  ok('空串有可读原因', empty.error.length > 0, empty.error);

  const spaces = parseJwAddress('https://a.edu.cn /jwglxt');
  ok('含空格被拒（从浏览器复制常带一段文字）', !spaces.ok, spaces.parts.baseUrl);

  const noDot = parseJwAddress('jwxt');
  ok('没有点的 hostname 被拒（不像域名）', !noDot.ok, noDot.parts.baseUrl);

  const nullish = parseJwAddress(null as unknown as string);
  ok('null 不炸、按空处理', !nullish.ok);

  const zw = parseJwAddress('\u200Bhttps://a.edu.cn/jwglxt');
  ok('零宽字符被清掉后仍能解析', zw.ok, zw.error);
}

console.log('\n--- loginUrlFor：与 zfImport.loginUrlOf 同一口径 ---');
{
  ok('只给域名 → 补标准登录页',
    loginUrlFor('https://a.edu.cn') === 'https://a.edu.cn/jwglxt/xtgl/login_slogin.html', loginUrlFor('https://a.edu.cn'));
  ok('已经指到 .html → 原样用',
    loginUrlFor('https://a.edu.cn/custom/login.html') === 'https://a.edu.cn/custom/login.html');
  ok('尾斜杠不影响', loginUrlFor('https://a.edu.cn/') === 'https://a.edu.cn/jwglxt/xtgl/login_slogin.html');
  ok('空串回空串（调用方能据此判断）', loginUrlFor('') === '');
}

console.log('\n--- addressHint：给了提示，但绝不把"猜的"说成"确定的" ---');
{
  const zf = addressHint('https://a.edu.cn/jwglxt/xtgl/login_slogin.html');
  ok('jwglxt 提示像正方新版', /正方新版/.test(zf), zf);

  const old = addressHint('https://a.edu.cn/jwweb/Login.aspx');
  ok('jwweb 提示像老版且提醒可能失败', /老版/.test(old) && /失败/.test(old), old);

  const qz = addressHint('https://a.edu.cn/qzdatasoft/login');
  ok('强智如实说"暂未适配"', /强智/.test(qz) && /暂未适配/.test(qz), qz);

  const unknown = addressHint('https://a.edu.cn/abcdef');
  ok('认不出时明确说"不做猜测"', /不做猜测|需要.*导入时.*确认|系统自己确认/.test(unknown), unknown);

  const bad = addressHint('not a url');
  ok('地址不合法时直接把原因当提示', bad.length > 0 && !/正方|强智/.test(bad), bad);
}

console.log('\n结果：' + pass + ' 通过 / ' + fails.length + ' 失败');
for (const f of fails) console.log('  ✗ ' + f);
if (fails.length) process.exit(1);
