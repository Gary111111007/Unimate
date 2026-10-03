/**
 * 教务系统地址解析（v2.71）。
 *
 * 背景：产品负责人要求把「去正方系统识别」做成一个**用户能自己填地址**的面板
 * （《教务助手》的"添加学校"就是这个形态：粘贴完整网址 → 识别 → 填域名/基础路径/协议）。
 *
 * 【为什么单独一层纯函数】
 *  面板里那几行"提示文案"（"优先从完整网址解析；教务位于网站根目录时留空"）如果只是说说，
 *  就变成硬规则 6 说的"UI 文案与实现不一致"。所以把**解析规则真的实现出来并可单测**：
 *    粘贴 https://jw.example.edu.cn:30443/jwglxt/xtgl/login_slogin.html
 *      → baseUrl   https://jw.example.edu.cn:30443
 *        domain    jw.example.edu.cn:30443
 *        basePath  /jwglxt
 *        protocol  https
 *        loginUrl  https://jw.example.edu.cn:30443/jwglxt/xtgl/login_slogin.html
 *
 * 【边界（很重要，别越界）】
 *  - **纯字符串处理**：不发请求、不探测、不做 DNS。识别不到就如实回 null + 原因。
 *  - **不猜厂商**：`guessVendorPath()` 只看路径特征（/jwglxt、/jsxsd…），认不出就是 null。
 *    真正决定"能不能导入"的仍然是 `jwSystems.importable`（AGENTS.md 硬规则 6）。
 *  - **http 要如实提醒**：明文 http 下 WebView 的 crypto.subtle 不存在（v2.26 踩过），
 *    这条由调用方拿去提示用户，本层只负责如实回一个 protocol。
 */

/** 用户可选的协议。默认 https（面板里也是这个默认值）。 */
export type JwProtocol = 'https' | 'http';

export interface JwAddressParts {
  /** 协议 + 主机 + 端口，例如 `https://jw.example.edu.cn:30443`；**不带尾斜杠、不带路径** */
  baseUrl: string;
  /** 主机 + 端口，例如 `jw.example.edu.cn:30443` */
  domain: string;
  /** 规范化后的基础路径：`''`（根目录）或 `/jwglxt`（**没有尾斜杠**） */
  basePath: string;
  protocol: JwProtocol | '';
  /** 拼好的登录页地址（走 zfImport.loginUrlOf 的同一口径） */
  loginUrl: string;
}

export interface JwAddressParse {
  ok: boolean;
  parts: JwAddressParts;
  /** 不合法时的原因（直接给用户看，措辞要能指导下一步） */
  error: string;
}

/** 域名校验：允许中文域名以外的常规主机名 + 可选端口；不接受空格与路径字符。 */
const DOMAIN_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-_.]*[a-zA-Z0-9])?(?::\d{1,5})?$/;

function hostWithPort(u: URL): string {
  return u.port ? u.hostname + ':' + u.port : u.hostname;
}

/**
 * 把一段用户输入归一成"域名 + 基础路径"。
 *
 * 三种输入都要能接住（面板上三个输入框分别对应中间两项）：
 *  1. 完整网址      `https://jw.example.edu.cn:30443/jwglxt/xtgl/login_slogin.html`
 *  2. 只有域名      `jw.example.edu.cn:30443` / `https://jw.example.edu.cn`
 *  3. 域名 + 路径   `jw.example.edu.cn/jwglxt`
 *
 * `fallbackProtocol` 是面板上那个 HTTPS/HTTP 二选一的当前值：
 * 输入里写了协议就以输入为准，没写才用它补。
 */
export function parseJwAddress(raw: string, fallbackProtocol: JwProtocol = 'https'): JwAddressParse {
  const empty: JwAddressParts = { baseUrl: '', domain: '', basePath: '', protocol: '', loginUrl: '' };
  const text = String(raw || '').trim();
  if (!text) {
    return { ok: false, parts: empty, error: '请先粘贴教务系统的登录页地址，或至少填一个域名。' };
  }
  // 用户从浏览器地址栏复制过来经常带前后空白与零宽字符
  const cleaned = text.replace(/[\u200B-\u200D\uFEFF]/g, '');
  if (/\s/.test(cleaned)) {
    return { ok: false, parts: empty, error: '地址里不能有空格，请检查是否多粘了一段文字。' };
  }

  // 没写协议就补一个，才能用 URL 解析
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(cleaned);
  const protoInInput = /^(https?):\/\//i.exec(cleaned)?.[1];
  const scheme: JwProtocol = protoInInput ? (protoInInput.toLowerCase() as JwProtocol) : fallbackProtocol;
  const candidate = hasScheme ? cleaned : scheme + '://' + cleaned;

  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return { ok: false, parts: empty, error: '这不是一个能识别的网址，示例：jw.example.edu.cn:30443 或 https://jw.example.edu.cn/jwglxt' };
  }

  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, parts: empty, error: '只支持 http / https 开头的教务系统地址。' };
  }
  const domain = hostWithPort(u);
  if (!DOMAIN_RE.test(domain) || !domain.includes('.')) {
    return { ok: false, parts: empty, error: '域名看起来不完整（例如少了 .edu.cn），请核对后重填。' };
  }

  /*
   * 基础路径的归一规则：
   *  - 去掉尾斜杠，根目录用 ''（面板的"基础路径"输入框就显示空）
   *  - 认得出教务系统目录名（/jwglxt、/jsxsd…）就取到那一段，**后面的页面路径丢掉**
   *    —— 因为导入只需要"登录页在哪"，多留一段反而会拼出错误的登录地址
   *  - 认不出的目录**原样保留**（用户可能把教务挂在 /jw 之类自建路径下），不擅自删
   */
  const segments = u.pathname.split('/').filter(Boolean);
  const markerIdx = segments.findIndex((s) => isVendorDir(s));
  const keep = markerIdx >= 0 ? segments.slice(0, markerIdx + 1) : segments;
  const basePath = keep.length ? '/' + keep.join('/') : '';

  const baseUrl = scheme + '://' + domain + basePath;
  return {
    ok: true,
    parts: { baseUrl, domain, basePath, protocol: scheme, loginUrl: loginUrlFor(baseUrl) },
    error: ''
  };
}

/**
 * 拼登录页地址。
 *
 * **与 `zfImport.loginUrlOf()` 同一口径**（已经指到 `.html` 就原样用），
 * 另外多处理一种这里才会遇到的情况：baseUrl **已经带上了教务目录**
 * （`https://host/jwglxt`）—— 那就只补 `/xtgl/login_slogin.html`，
 * 否则会拼出 `/jwglxt/jwglxt/xtgl/login_slogin.html`（v2.71 单测抓出来的真 bug）。
 */
export function loginUrlFor(baseUrl: string): string {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  if (/\.html(\?|$)/i.test(base)) return base;
  // 末段已经是教务目录名 → 只补目录内部的登录页相对路径
  const last = base.split('/').pop() || '';
  if (isVendorDir(last)) return base + '/xtgl/login_slogin.html';
  return base + '/jwglxt/xtgl/login_slogin.html';
}

/**
 * 只按**路径段特征**认教务系统的目录名 —— 不做厂商判断，只用来决定"路径截到哪一段"。
 * 认不出返回 false（路径原样保留）。
 */
export function isVendorDir(seg): boolean {
  const s = String(seg || '').toLowerCase();
  return [
    'jwglxt',   // 正方新版
    'jwweb',    // 正方老版
    'jsxsd',    // 正方另一套
    'jw', 'jwc', 'jwcnew', 'jwmis',
    'qzdatasoft', // 强智
    'urp'
  ].indexOf(s) >= 0;
}

/**
 * 面板"识别网址"按钮用的**离线提示**：只根据路径/主机名给一句"像是哪一类"，
 * 并**明确说明这不是最终判定** —— 真正的判定在下载档案之后由 `jwSystems` 做。
 * 这样既满足"点了按钮要有反馈"，也不会把"猜的"说成"确定的"（硬规则 6）。
 */
export function addressHint(raw: string, fallbackProtocol: JwProtocol = 'https'): string {
  const p = parseJwAddress(raw, fallbackProtocol);
  if (!p.ok) return p.error;
  const path = p.parts.basePath.toLowerCase();
  if (path.includes('jwglxt') || path.includes('jsxsd')) {
    return '路径里有 /' + path.split('/').filter(Boolean).pop() + '，像正方新版，可以直接试导入。';
  }
  if (path.includes('jwweb')) return '路径里有 /jwweb，像正方老版，导入可能失败，需要先确认。';
  if (path.includes('qzdatasoft')) return '路径里有 /qzdatasoft，像强智教务，Unimate 暂未适配。';
  if (path.includes('urp')) return '路径里有 /urp，像 URP 教务，Unimate 暂未适配。';
  return '地址格式没问题。是不是正方需要在导入时由系统自己确认，Unimate 不做猜测。';
}
