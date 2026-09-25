// ─────────────────────────────────────────────────────────────────────────────
// iso-dir-guard —— 隔离实例目录的路径守卫
//
// 为什么单独成一个模块：**它是唯一挡住"误删保留目录"的东西**，而误删是不可逆的。
// 把校验抽成纯函数，才能对每一种拒绝情形写自动化测试（J 组 7 个用例）。
//
// 【设计原则：fail closed】任何一项校验不通过都**只报错、不做任何事**。
//   尤其：**本模块里没有任何删除、清空或覆盖动作**，一行都没有。
//   调用方必须在**做任何事之前**先调它，并且不得在它失败后继续。
//
// 【OQ-15 裁决（产品负责人 2026-09-25）的 10 条】：
//   1 删除危险的默认目标          → 这里：没传值直接拒（没有默认值）
//   2 必须显式提供 UNIMATE_ISO_N8N → `missing` 规则
//   3 目标解析为绝对路径           → `notAbsolute` + resolve()
//   4 目标必须位于系统临时目录内    → `outsideTemp`
//   5 目录名必须以 unimate-n8n-iso- 开头 → `badPrefix`
//   6 目标在执行前必须不存在        → `alreadyExists`
//   7 已存在则立即停止，不删/不清/不复用 → 同上（且本模块没有删除动作）
//   8 显式拒绝四个保留目录及其父子路径 → `reserved`
//   9 全部路径校验在任何删除动作之前完成 → 本模块是纯函数，天然满足
//  10 新目录跑完保留，不自动清理      → 由调用方保证（本模块不提供清理）
//
// 【《C 盘存储红线》§七.4 的追加（产品负责人 2026-09-25）】：
//   原守卫只认系统 `%TEMP%`，而 `%TEMP%` 在 Windows 上就是 **C 盘** ——
//   于是"跑一次往返核对"与"C 盘红线"直接冲突，且**不得拿"测试要求"当继续写 C 盘的理由**。
//   现在守卫接受**经过校验的运行根**（`runtimeRoots`），并可用 `allowTemp: false`
//   彻底关掉 TEMP 这条路径。运行根本身也要过 `validateRuntimeRoot`：
//   绝对路径、不是盘符根、不在 C 盘、不与 TEMP 重叠、不与保留目录互相包含。
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync } from 'node:fs'
import { isAbsolute, resolve, sep, normalize } from 'node:path'
import { tmpdir } from 'node:os'

/** 目录名必须以此开头。**这是白名单前缀，不是命名建议**——不匹配就拒绝。 */
export const ISO_DIR_PREFIX = 'unimate-n8n-iso-'

/** 从 open-questions.md 里读保留目录清单的那段机器可读块。 */
export const RESERVED_BLOCK_BEGIN = '<!-- RESERVED-ISO-DIRS-BEGIN -->'
export const RESERVED_BLOCK_END = '<!-- RESERVED-ISO-DIRS-END -->'

/**
 * 解析保留目录清单。
 * **块缺失 → 返回 null**（而不是空数组）：调用方必须据此拒绝运行。
 * 空数组会让守卫看起来在工作、实际什么都没挡。
 */
export function parseReservedDirs(markdownText) {
  const b = markdownText.indexOf(RESERVED_BLOCK_BEGIN)
  const e = markdownText.indexOf(RESERVED_BLOCK_END)
  if (b < 0 || e < 0 || e < b) return null
  const lines = markdownText.slice(b + RESERVED_BLOCK_BEGIN.length, e)
    .split('\n').map((l) => l.trim()).filter(Boolean)
  const dirs = lines.filter((l) => /^[A-Za-z]:\\/.test(l) || l.startsWith('/'))
  return dirs.length ? dirs : null
}

/** Windows 路径比较用：大小写不敏感 + 统一分隔符。 */
function canon(p) {
  if (typeof p !== 'string') return ''
  let s = normalize(p)
  if (s.length > 1 && s.endsWith(sep)) s = s.slice(0, -1)
  return process.platform === 'win32' ? s.toLowerCase() : s
}

/** a 是否等于 b、或在 b 之内（b 是 a 的祖先）。 */
function isInsideOrEqual(a, b) {
  const A = canon(a), B = canon(b)
  if (!A || !B) return false
  return A === B || A.startsWith(B + sep) || A.startsWith(B + '/')
}

/**
 * 校验一个「F 盘运行根」是否可用于承载隔离实例。
 *
 * 《C 盘存储红线》§七.4 要求：守卫不能只认系统 `%TEMP%`，必须允许经过校验的 F 盘运行根。
 * 但"允许 F 盘"不等于"随便一个目录都行"——运行根自身也要过一遍校验，否则等于把守卫拆了。
 *
 * @param {string} root
 * @param {{tempDir:string, reserved:string[]}} ctx
 * @returns {string[]} 错误列表（空 = 该运行根可用）
 */
export function validateRuntimeRoot(root, ctx) {
  const errors = []
  if (typeof root !== 'string' || root.trim() === '') {
    return ['badRuntimeRoot: 运行根为空']
  }
  const raw = root.trim()
  if (!isAbsolute(raw)) return [`badRuntimeRoot: 运行根必须是绝对路径，收到「${raw}」`]
  const r = resolve(raw)

  // ① 不得是盘符根（`F:\`）——那等于把整个盘当运行根
  const rootPart = parseRoot(r)
  if (canon(r) === canon(rootPart)) {
    errors.push(`badRuntimeRoot: 运行根不能是盘符根（「${rootPart}」）——范围过大`)
  }

  // ② Windows 上不得位于 C 盘。《C 盘存储红线》的全部目的就是这条。
  if (process.platform === 'win32' && /^[a-z]:/i.test(r) && r[0].toLowerCase() === 'c') {
    errors.push(`badRuntimeRoot: 运行根不得位于 C 盘，收到「${r}」`)
  }

  // ③ 不得与系统临时目录重叠（运行根套着 TEMP 或反过来，都说明配置错了）
  if (isInsideOrEqual(r, ctx.tempDir) || isInsideOrEqual(ctx.tempDir, r)) {
    errors.push(`badRuntimeRoot: 运行根不得与系统临时目录重叠（TEMP=${ctx.tempDir}，运行根=${r}）`)
  }

  // ④ 运行根**不得落在**保留目录之内。
  //
  //    ⚠️ 反向关系（保留目录落在运行根内）**不是错误**，是常态：
  //    运行根里跑出来的每个隔离实例都会被登记进保留清单，于是运行根天然包含若干保留目录。
  //    第一版把这条写成"互为包含都拒绝"，结果**运行根自己把自己否掉了**
  //    （保留清单里一有该根下的实例，这个根就再也用不了）——由 J-9b 实测抓出。
  //    真正要防的是"把运行根塞进某个受保护的目录里"，那是单向的。
  for (const res of ctx.reserved) {
    if (isInsideOrEqual(r, res)) errors.push(`badRuntimeRoot: 运行根落在保留目录「${res}」内`)
  }

  return errors
}

/** 取路径的盘符根（Windows: `F:\`；POSIX: `/`）。 */
function parseRoot(p) {
  const m = /^([A-Za-z]:[\\/])/.exec(p)
  if (m) return m[1]
  return p.startsWith('/') ? '/' : ''
}

/**
 * 校验隔离目录。
 *
 * @param {string|undefined} rawValue  UNIMATE_ISO_N8N 的值
 * @param {object} [opts]
 * @param {string} [opts.tempDir]  系统临时目录（默认 os.tmpdir()，测试可注入）
 * @param {string[]} [opts.runtimeRoots] 额外允许的运行根（F 盘运行根）；每个都要过 validateRuntimeRoot
 * @param {boolean} [opts.allowTemp] 是否仍允许系统临时目录（默认 true；**传 false 时才真正禁止写 C 盘**）
 * @param {string[]|null} [opts.reserved] 保留目录清单；null 表示清单不可用 → 拒绝
 * @param {(p:string)=>boolean} [opts.exists] 存在性判定（测试可注入）
 * @returns {{ok:boolean, errors:string[], path:string|null}}
 */
export function guardIsoDir(rawValue, opts = {}) {
  const tempDir = opts.tempDir ?? tmpdir()
  const reserved = opts.reserved === undefined ? [] : opts.reserved
  const exists = opts.exists ?? existsSync
  const runtimeRoots = opts.runtimeRoots ?? []
  const allowTemp = opts.allowTemp !== false
  const errors = []

  // ① 必须显式提供（**没有默认值**——危险的默认目标就是被这条删掉的）
  if (rawValue === undefined || rawValue === null) {
    return { ok: false, errors: ['missing: 必须显式提供 UNIMATE_ISO_N8N；本脚本不再有默认目标'], path: null }
  }
  const raw = String(rawValue).trim()
  if (raw === '') return { ok: false, errors: ['missing: UNIMATE_ISO_N8N 是空值'], path: null }

  // ② 保留清单必须可用（fail closed）
  if (reserved === null) {
    return { ok: false, errors: ['reservedListUnavailable: 读不到保留目录清单，拒绝运行'], path: null }
  }

  // ②b 每个运行根都要先自己过校验；有问题的运行根**不参与**白名单
  const goodRoots = []
  for (const root of runtimeRoots) {
    const errs = validateRuntimeRoot(root, { tempDir, reserved })
    if (errs.length) errors.push(...errs)
    else goodRoots.push(resolve(root))
  }

  // ③ 必须是绝对路径
  if (!isAbsolute(raw)) {
    errors.push(`notAbsolute: 必须是绝对路径，收到「${raw}」`)
    return { ok: false, errors, path: null }
  }
  const target = resolve(raw)

  // ④ 必须落在**允许的根**之内：系统临时目录（若允许）或某个通过校验的运行根
  const allowed = (allowTemp ? [tempDir] : []).concat(goodRoots)
  if (!allowed.some((r) => isInsideOrEqual(target, r))) {
    errors.push(
      `outsideAllowedRoots: 必须位于允许的根之内（${allowed.join(' ｜ ')}），收到「${target}」`
    )
  }

  // ⑤ 目录名必须带白名单前缀
  const base = canon(target).split(sep).pop() ?? ''
  if (!base.startsWith(ISO_DIR_PREFIX.toLowerCase())) {
    errors.push(`badPrefix: 目录名必须以「${ISO_DIR_PREFIX}」开头，收到「${base}」`)
  }

  // ⑥ 不得命中保留目录 —— 含**三种**关系：等于、在其内、把它套进来
  for (const r of reserved) {
    if (isInsideOrEqual(target, r)) errors.push(`reserved: 目标是保留目录「${r}」本身或其子路径`)
    else if (isInsideOrEqual(r, target)) errors.push(`reserved: 保留目录「${r}」位于目标的子路径内`)
  }

  // ⑦ 执行前必须不存在（已存在就停，**不删、不清、不复用**）
  if (exists(target)) {
    errors.push(`alreadyExists: 目标已存在，拒绝运行（不删除、不清空、不复用）：「${target}」`)
  }

  return { ok: errors.length === 0, errors, path: target }
}
