/**
 * 教务系统类型：**从用户填的网址推断**（v2.75）。
 *
 * 【为什么要单独一层】
 * 面板上的「教务类型」下拉以前是个摆设 —— 选什么最后都按正方走。
 * 产品负责人原话：「教务系统识别课表，是我需要你去做的」——
 * 那就把"识别"做成真的：**给一个网址，判断它更像哪套教务系统**。
 *
 * 判定依据全部来自**可观察的路径特征**（正方 jwglxt、强智 jsxsd、URP、青果…），
 * 不联网、不探测、不猜域名 —— 只解析用户自己粘贴/输入的那串地址。
 *
 * 【诚实优先（AGENTS.md 硬规则 6）】
 * 认不出来就返回 `'auto'`，UI 上写"按网址判断不出来"，**绝不硬猜一个厂商**。
 * "能不能真的导入"由调用方按链路判断（现在只有正方新版做得出来），
 * 本文件只负责"这是哪一套"，不负责"能不能用"。
 */

/** 教务系统类型。`auto` = 没认出来 / 让系统自己判断。 */
export type JwKind = 'auto' | 'zf' | 'zf-old' | 'qz' | 'urp' | 'other';

/**
 * 路径 / 主机名特征表。
 *
 * 每条都是**实际见过的部署习惯**，不是推测：
 *  - 正方新版固定挂在 `/jwglxt`，登录页 `/jwglxt/xtgl/login_slogin.html`；
 *  - 正方老版是 `/jwweb` 系列（也有学校直接放根目录的 `default2.aspx`）；
 *  - 强智科技的路径特征非常稳定：`/jsxsd/`（老版）与 `/jsxsd1/`、`/jsxsd2/`（多校区）；
 *  - URP 的特征是 `/urp/` 或主机名含 `urp`；
 *  - 青果软件常见 `/qgjw/`、`/qg/`。
 *
 * `zf-old` 排在 `zf` 后面判：`/jwweb` 不含 `jwglxt`，两条互斥，顺序其实无关，
 * 但保持"新版优先"的阅读顺序，将来正则放宽时不容易出错。
 */
const RULES: { kind: JwKind; test: RegExp }[] = [
  { kind: 'zf', test: /jwglxt/i },
  { kind: 'zf-old', test: /jwweb|default2\.aspx|default\d?\.aspx/i },
  { kind: 'qz', test: /jsxsd|jsxsd\d|qzjw|qgjw|qg\//i },
  { kind: 'urp', test: /(^|[./-])urp([./-]|$)/i },
  { kind: 'other', test: /(^|[./-])(jw|jwc|jiaowu|jwxt|eams|ehall)([./-]|$)/i }
];

/**
 * 从一个网址（或只有域名 / 只有路径的残片）推断教务类型。
 *
 * 传进来的东西**不保证是合法 URL**（用户可能只填了 `jwglxt`，或只填了域名），
 * 所以这里不做 `new URL()`，直接把整串当文本去匹特征 —— 对残缺输入更宽容。
 *
 * @returns 认出来就返回具体类型；认不出来返回 `'auto'`（**不硬猜**）。
 */
export function inferTypeFromUrl(input: string): JwKind {
  const s = String(input || '').trim();
  if (!s) return 'auto';
  for (const r of RULES) {
    if (r.test.test(s)) return r.kind;
  }
  return 'auto';
}

/** 类型 → 人话（下拉选项与提示共用一处，避免两处文案漂移）。 */
export function kindLabel(k: JwKind): string {
  switch (k) {
    case 'zf': return '正方教务（新版 jwglxt）';
    case 'zf-old': return '正方教务（老版 jwweb）';
    case 'qz': return '强智教务';
    case 'urp': return 'URP 教务';
    case 'other': return '其它教务系统';
    default: return '自动识别';
  }
}

/**
 * 这套教务系统**现在有没有可用的导入链路**。
 *
 * 只有正方新版（jwglxt）的 kbList 接口链路是真做出来的（`zfClient` + `zfImport`，
 * 有 Golden Test）。其余一律 false —— 面板据此**如实说明**，而不是给一个点了会失败的按钮。
 */
export function kindImportable(k: JwKind): boolean {
  return k === 'zf' || k === 'auto';
}
