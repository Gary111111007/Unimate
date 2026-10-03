/**
 * 教务系统品牌识别（选校页用）。
 *
 * 背景：国内高校的教务系统大体是几个厂商的成品（正方 jwglxt、强智、URP、青果…）。
 * 选校页把"这所学校用的是哪套系统"标出来，用户一眼就知道自己能不能用对应的导入方式，
 * 也让"正在按校落地"这件事有可验证的抓手 —— 而不是一句空口号。
 *
 * 设计取舍：
 *  - **纯函数 + 常量表**，不联网、不猜、不读档案以外的东西。识别不出来就如实写"待识别"，
 *    绝不装作知道（AGENTS.md 硬规则 6：UI 文案必须与实现一致）。
 *  - 判定优先级：**档案声明（systems.timetableAdapter）> 内置映射表**。
 *    档案是签名下发的权威来源；表只是"还没下载档案时就先给个准话"的兜底。
 *  - 只做**识别**，不做登录。登录导入走 WebView 自助（用户自己输凭据，App 不接触）。
 */

export type JwVendorId =
  | 'zf'          // 正方 jwglxt（新版）
  | 'zf-old'      // 正方老版（jwweb 系列）
  | 'qz'          // 强智科技
  | 'urp'         // URP 教务
  | 'unknown';

export interface JwVendor {
  id: JwVendorId;
  /** 卡片上显示的短标签 */
  label: string;
  /** 展开说明（来源、能力边界） */
  desc: string;
  /**
   * 是否支持"用该校账号自助导入"。
   * 目前只有正方的适配是真做过的（jwglxt-buct 解析器 + Golden Test），
   * 其它厂商**一律 false** —— 不能因为"看到过"就承诺能用。
   */
  importable: boolean;
}

const VENDORS: Record<JwVendorId, JwVendor> = {
  zf: {
    id: 'zf',
    label: '正方教务',
    desc: '正方 jwglxt 新版。Unimate 已做好该系统的课表导入适配，可在 App 内登录后一键导入。',
    importable: true
  },
  'zf-old': {
    id: 'zf-old',
    label: '正方教务（老版）',
    desc: '正方老版教务系统，页面结构与新版不同。Unimate 暂未适配，导入可能失败。',
    importable: false
  },
  qz: {
    id: 'qz',
    label: '强智教务',
    desc: '强智科技教务系统。Unimate 暂未适配这一套。',
    importable: false
  },
  urp: {
    id: 'urp',
    label: 'URP 教务',
    desc: 'URP 教务系统。Unimate 暂未适配这一套。',
    importable: false
  },
  unknown: {
    id: 'unknown',
    label: '教务系统待识别',
    desc: '这所高校的教务系统尚未确认。Unimate 不做猜测，确认后会更新档案。',
    importable: false
  }
};

/**
 * 内置识别表：**只登记开发方已确认过的**。
 * 未登记 ≠ 用的不是正方，只是"还没查证"（宁缺毋滥）。
 * 这个表最终应被签名云端档案里的 systems 声明取代；表是离线兜底。
 */
const BY_SCHOOL: Record<string, JwVendorId> = {
  buct: 'zf'   // 北京化工大学：新正方 jwglxt（jwglxt.buct.edu.cn）
};

/**
 * 从适配器 ID 推断厂商。适配器命名约定见 PRD 5.15 / docs/school-pack.md：
 *   jwglxt-*  → 正方新版
 *   jwweb-*   → 正方老版
 *   qz-*      → 强智
 *   urp-*     → URP
 * 认不出就返回 null，交给调用方决定是否回落到 unknown。
 */
export function vendorFromAdapter(adapterId: string): JwVendorId | null {
  const id = String(adapterId || '').trim().toLowerCase();
  if (!id) return null;
  if (id.startsWith('jwglxt-') || id === 'jwglxt') return 'zf';
  if (id.startsWith('jwweb-') || id === 'jwweb') return 'zf-old';
  if (id.startsWith('qz-') || id === 'qz') return 'qz';
  if (id.startsWith('urp-') || id === 'urp') return 'urp';
  return null;
}

/**
 * 识别某所高校的教务系统。**不联网、不做探测**。
 * @param schoolId 学校 ID
 * @param adapterId 档案里声明的课表适配器（可选；有就以它为准）
 */
export function identifyVendor(schoolId: string, adapterId?: string): JwVendor {
  const fromAdapter = adapterId ? vendorFromAdapter(adapterId) : null;
  if (fromAdapter) return VENDORS[fromAdapter];
  const byId = BY_SCHOOL[String(schoolId || '').trim().toLowerCase()];
  if (byId) return VENDORS[byId];
  return VENDORS.unknown;
}

/** 取厂商信息本体（按 id）。未知 id 回落 unknown。 */
export function vendorInfo(id: JwVendorId): JwVendor {
  return VENDORS[id] || VENDORS.unknown;
}

/** 是否是"能用 Unimate 的导入能力"的学校卡片 */
export function isImportable(id: JwVendorId): boolean {
  return vendorInfo(id).importable;
}
