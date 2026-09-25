// ─────────────────────────────────────────────────────────────────────────────
// UniCore —— 纯 TypeScript 的「本机规则」实现
//
// 定位（主规划 v2.3.2 §1.4）：未来可直接嵌进 Android WebView 包的 LocalRulesAdapter。
// 【硬约束】不访问 DOM、Capacitor、网络、文件或原生插件。只吃 UniRequest，只吐 UniResponse。
//
// 五类核心能力：下一节 / 今日安排 / 一句话记事 / 空档查询 / 课表冲突 / 每日简报。
// 修改与删除、二课、天气、开放问答一律返回 E_UNSUPPORTED（§1.4 明确后移）。
//
// 与 n8n 的关系：`agent_intent_router` 的规则表必须与本文件的 RULES 完全一致——
// 由 tests/uni-core-contract.test.mjs 的一致性断言锁住，防止两套规则漂移。
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ActionCard,
  BusySlot,
  Capability,
  Intent,
  TodoSummary,
  UniRequest,
  UniResponse,
} from './types.ts'

// ═══ 1. 意图规则表 ═══════════════════════════════════════════════════════════

/** 契约 §6.4 的封闭枚举。顺序与 intent.schema.json 的 enum 一致。 */
export const INTENTS: readonly Intent[] = [
  'schedule.today', 'schedule.tomorrow', 'schedule.week', 'schedule.date',
  'weather.today', 'weather.tomorrow', 'weather.date',
  'notes.create', 'notes.query', 'notes.update', 'notes.delete',
  'records.summary', 'smalltalk', 'unsupported',
] as const

export interface Rule {
  intent: Intent
  /** 越大越先匹配。数字留空隙，便于后续插入。 */
  prio: number
  re: RegExp
}

/**
 * 规则表。**这是唯一真源**——n8n 侧的路由节点必须与它逐条一致。
 * 新增说法时改这里，并同步 n8n 的 Code 节点，然后跑一致性测试。
 */
export const RULES: readonly Rule[] = [
  // ── 记事：写操作优先，因为「记一下明天下午三点开会」里也有「明天」
  { intent: 'notes.create', prio: 20, re: /(记一下|记下|帮我记|帮我写|加个记事|新建记事|提醒我)/ },
  // 裸任务陈述：没有指令词，但有「时间 + 动作」。
  // ★ 这条是冒烟测试逼出来的——§1.4 九十秒答辩的原句「今晚 8 点交高数作业」
  //   正是这种形态；原先只匹配指令词，于是最该演示的那一句反而落到 unsupported。
  // 动作词刻意不含「上课/有课」，避免把「明天几点上课」抢成记事。
  {
    intent: 'notes.create', prio: 18,
    re: /(今晚|今天|明天|后天|周[一二三四五六日天]|星期[一二三四五六日天]).{0,12}(\d{1,2}\s*点|\d{1,2}\s*[:：]\s*\d{2}).{0,24}(交|写|做|买|去|开|报|发|提交|复习|打卡|取|面|聊)/,
  },
  { intent: 'notes.delete', prio: 20, re: /(删掉|删除|去掉).{0,6}(记事|笔记|那条|记录)/ },
  { intent: 'notes.update', prio: 20, re: /(改一下|修改|改成).{0,6}(记事|笔记|那条)/ },

  // ── 课表
  // 「下一节什么课」不含任何时间词，所以单独给一条高优先级规则
  { intent: 'schedule.today', prio: 16, re: /(下一节|下节课|接下来.{0,4}(上什么|什么课|的课))/ },
  { intent: 'schedule.tomorrow', prio: 15, re: /(明天|明日).{0,10}(几点|什么课|哪些课|有课|上课|课程|课表|安排|简报)/ },
  { intent: 'schedule.today', prio: 15, re: /(今天|今日).{0,10}(几点|什么课|哪些课|有课|上课|课程|课表|安排|简报|总结|还有什么|剩什么|剩下)/ },
  { intent: 'schedule.week', prio: 15, re: /(这周|本周|这个星期|这一周).{0,8}(几节课|多少节课|几节|几次课|几门课|几门|课程安排|课表|有课)/ },
  // 空档与冲突也是课表查询，但用词不含「几点/什么课」，所以单独给规则
  { intent: 'schedule.date', prio: 14, re: /(有空|空闲|空档|有时间|冲突|撞(?:课|了)?)/ },
  { intent: 'schedule.date', prio: 12, re: /(\d{1,2}\s*月\s*\d{1,2}\s*[日号]|\d{4}-\d{1,2}-\d{1,2}|周[一二三四五六日天]|星期[一二三四五六日天]).{0,8}(几点|什么课|有课|上课|课表|有空|空闲|冲突)/ },

  // ── 二课（比赛口径：不阻塞 MVP，规则命中后仍返回 E_UNSUPPORTED）
  { intent: 'records.summary', prio: 15, re: /(二课|第二课堂|第二学分).{0,8}(还差|差多少|多少分|够不够|进度|修满)/ },

  // ── 天气（比赛口径：移出 MVP，命中后返回 E_UNSUPPORTED）
  { intent: 'weather.tomorrow', prio: 15, re: /(明天|明日).{0,8}(天气|下雨|下雪|气温|多少度|冷不冷|热不热|带伞)/ },
  { intent: 'weather.today', prio: 15, re: /(今天|今日).{0,8}(天气|下雨|下雪|气温|多少度|冷不冷|热不热|带伞)/ },
  { intent: 'weather.date', prio: 12, re: /(\d{1,2}\s*月\s*\d{1,2}\s*[日号]).{0,8}(天气|下雨|气温|多少度)/ },

  // ── 记事查询
  // 「待办」的语序很多（我的待办有哪些 / 有什么待办 / 待办事项），逐个枚举会漏；
  // 直接把「待办」当关键词。安全性靠优先级保证：schedule.* 是 prio 15，
  // 所以「今天还有什么待办」会被课表规则先接走，不会误落到这里。
  { intent: 'notes.query', prio: 12, re: /(我的记事|有哪些记事|记事里|笔记里|找一下.{0,6}(记事|笔记)|我记过什么|待办)/ },

  // ── 闲聊：只匹配「整句就是这句」，避免「你好，明天几点上课」被截走
  { intent: 'smalltalk', prio: 5, re: /^\s*(你好|您好|hi|hello|在吗|你是谁|你能干什么|你能做什么)\s*[!！?？。.,，]*\s*$/i },
] as const

/** 按 prio 降序取第一个命中；不命中返回 unsupported。 */
export function detectIntent(text: string): { intent: Intent; matched: number | null } {
  const sorted = [...RULES].sort((a, b) => b.prio - a.prio)
  for (const r of sorted) {
    if (r.re.test(text)) return { intent: r.intent, matched: r.prio }
  }
  return { intent: 'unsupported', matched: null }
}

/**
 * 比赛 MVP 不支持的意图。命中即 E_UNSUPPORTED，不接任何网络、也不猜答案。
 *
 * `schedule.week` **曾经**在这里（P03～P07），理由是 §1.4 的六项能力清单里没有"整周课数"。
 * 产品负责人 2026-09-25 裁决为「实现」，故 P07.1 移出本名单并新增 `week_plan` 能力。
 * 裁决的语义口径逐条落在 `handleWeekPlan` 的注释里——**要改口径先改那段注释与测试**。
 */
export const UNSUPPORTED_INTENTS: ReadonlySet<Intent> = new Set<Intent>([
  'weather.today', 'weather.tomorrow', 'weather.date',
  'records.summary',
  'notes.update', 'notes.delete',
])

// ═══ 2. 文本归一化（对应主规划 §4.2.1）══════════════════════════════════════

// 用显式转义而不是字面量——字面量的零宽字符在源码里不可见，改一次就可能被编辑器吃掉
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u2060]/g

export function normalizeText(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFKC')          // 全角字母数字标点 → 半角
    .replace(ZERO_WIDTH, '')    // 零宽字符是隐形注入的载体
    .replace(/\s+/g, ' ')
    .trim()
}

// ═══ 3. 时间（对应主规划 §4.2.2）═════════════════════════════════════════════

const WD: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }

/**
 * ★ 本模块的**硬契约是不抛异常**，而 `Intl.DateTimeFormat.format()` 拿到 Invalid Date
 * 会直接抛 RangeError。所有 Intl 调用前都要过这一关——P07 的「非法窗口」用例
 * 就是踩在 `atLocal('明天'…)` 上炸出来的，说明这个契约原先只是"打算这么写"。
 */
const isRealDate = (d: Date): boolean => !Number.isNaN(d.getTime())

/** 取某时区的「今天」。en-CA 的日期格式天然是 YYYY-MM-DD。 */
export function todayIn(tz: string, at: Date): string {
  if (!isRealDate(at)) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at)
}

/** 纯日期加减。用 UTC 正午构造，避开 DST 与本地时区边界。 */
export function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** 某天是星期几（1=周一…7=周日）。日期本身的星期与时区无关。 */
export function weekdayOf(iso: string): number {
  const w = new Date(`${iso}T12:00:00Z`).getUTCDay()
  return w === 0 ? 7 : w
}

/** 某时区在某时刻的 UTC 偏移，如 "+08:00"。无效时刻返回 '+00:00'，不抛。 */
export function offsetOf(tz: string, at: Date): string {
  if (!isRealDate(at)) return '+00:00'
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(at)
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const m = name.match(/GMT([+-]\d{2}:\d{2})/)
  return m ? m[1] : '+00:00'
}

/** 构造某时区某日某时刻的带偏移 ISO-8601。 */
export function atLocal(tz: string, dateISO: string, hm: string): string {
  const probe = new Date(`${dateISO}T12:00:00Z`) // 用当天正午求偏移，避开边界
  return `${dateISO}T${hm}:00${offsetOf(tz, probe)}`
}

export interface ResolvedTime {
  date: string | null
  range: { from: string; to: string } | null
  matched: string | null
  /**
   * 人类可读的判定依据，进 explain 供答辩现场核对。
   * P-01/P-02 这两个默认值原先只存在于代码里，用户与评委都看不见——
   * 「为什么是下周三而不是本周三」必须能当场答出来，所以把它显形。
   */
  basis: string
}

/**
 * 相对时间 → 绝对日期。以**客户端时区**为准，不用服务器时区。
 * ★ 匹配顺序有讲究：长模式必须排在短模式前面（「大后天」不能被「后天」截走）。
 * ★ P-01：今天周四说「本周三」→ 默认取**未来最近的那一个**（OQ-07 默认行为）。
 * ★ P-02：只说「9月25日」且今年已过 → 默认取**今年**，不跨年猜测。
 */
export function resolveTime(text: string, tz: string, now: Date): ResolvedTime {
  const today = todayIn(tz, now)
  const out: ResolvedTime = { date: null, range: null, matched: null, basis: '未指定日期，按客户端时区的今天' }
  let m: RegExpMatchArray | null

  if (/今天|今日/.test(text)) { out.date = today; out.matched = 'TODAY'; out.basis = `今天（${today}）` }
  else if (/明天|明日/.test(text)) {
    out.date = shiftDate(today, 1); out.matched = 'TOMORROW'
    out.basis = `明天（${out.date}），按客户端时区推算`
  } else if (/大后天/.test(text)) {
    out.date = shiftDate(today, 3); out.matched = 'D3'; out.basis = `大后天（${out.date}）`
  } else if (/后天/.test(text)) {
    out.date = shiftDate(today, 2); out.matched = 'D2'; out.basis = `后天（${out.date}）`
  } else if ((m = text.match(/(下下|下)\s*(?:个)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天])/))) {
    const base = m[1] === '下下' ? 14 : 7
    out.date = shiftDate(today, base - weekdayOf(today) + WD[m[2]])
    out.matched = 'NEXT_WEEK_X'
    out.basis = `${m[1] === '下下' ? '下下' : '下'}周${m[2]}（${out.date}）`
  } else if ((m = text.match(/(?:本|这|这个)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天])/))) {
    let delta = WD[m[1]] - weekdayOf(today)
    const wrapped = delta < 0
    if (wrapped) delta += 7 // P-01：取未来最近的那一个
    out.date = shiftDate(today, delta)
    out.matched = 'THIS_WEEK_X'
    out.basis = wrapped
      ? `本周${m[1]}已过，按 P-01 取未来最近的一个（${out.date}）`
      : `本周${m[1]}（${out.date}）`
  } else if ((m = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/))) {
    out.date = `${today.slice(0, 4)}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
    out.matched = 'ABS_MD'
    out.basis = `按 P-02 取今年（${out.date}），不跨年猜测`
  }

  // 「这周/本周」整体范围（周一 → 周日）。
  // ★ 必须加 `out.date === null` 这一道：「本周三」里也含「本周」，
  //   不加的话「本周三下午有空吗」会被判成整周范围，date 被清成 null，
  //   随后所有「日」级能力都退回今天——问了周三、答了今天。
  //   只有在没有指明具体某天时，才把「这周」理解成范围。
  if (out.date === null && /(这周|本周|这个星期|本星期|这一周)/.test(text)) {
    const wd = weekdayOf(today)
    out.range = { from: shiftDate(today, 1 - wd), to: shiftDate(today, 7 - wd) }
    out.date = null
    out.matched = 'THIS_WEEK_RANGE'
    out.basis = `本周一至周日（${out.range.from}..${out.range.to}）`
  }
  return out
}

/** 从文本里抽「下午」「上午」「晚上」等时段，返回 [startHM, endHM]。没提到返回 null。 */
export function resolveWindow(text: string): { startHM: string; endHM: string; label: string } | null {
  if (/上午|早上|早晨/.test(text)) return { startHM: '08:00', endHM: '12:00', label: '上午' }
  if (/下午/.test(text)) return { startHM: '13:00', endHM: '18:00', label: '下午' }
  if (/晚上|傍晚/.test(text)) return { startHM: '18:00', endHM: '22:00', label: '晚上' }
  if (/中午/.test(text)) return { startHM: '12:00', endHM: '14:00', label: '中午' }
  return null
}

/** 「晚上」的各种说法。漏掉任何一个都会把 20:00 算成 08:00。 */
const EVENING = /(下午|晚上|傍晚|今晚|今夜|夜里|晚间|晚)/

/** 中文数词 → 数字。中文口语里「三点」比「3点」更常见，不支持等于漏掉半个语言。 */
const CN_DIGIT: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}
export function cnToNum(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s)
  if (s === '十') return 10
  if (s.startsWith('十')) return 10 + (CN_DIGIT[s.slice(1)] ?? 0)   // 十一、十二
  if (s.endsWith('十')) return (CN_DIGIT[s[0]] ?? 0) * 10            // 二十
  if (s.length === 1 && s in CN_DIGIT) return CN_DIGIT[s]
  return null
}
/** 小时的写法：阿拉伯数字或中文数词，两种都要认。 */
const HOUR_PAT = '([一二三四五六七八九十]{1,3}|\\d{1,2})'

/** 从「今晚 8 点」「8:30」「下午三点」里抽时刻，返回 HH:MM。 */
export function resolveClock(text: string): string | null {
  let m = text.match(/(\d{1,2})\s*[:：]\s*(\d{2})/)
  if (m) {
    let h = Number(m[1])
    if (EVENING.test(text) && h < 12) h += 12
    return `${String(h).padStart(2, '0')}:${m[2]}`
  }
  m = text.match(new RegExp(`${HOUR_PAT}\\s*点(?:\\s*([一二三四五六七八九十]{1,3}|\\d{1,2})\\s*分?)?`))
  if (m) {
    let h = cnToNum(m[1])
    const mi = m[2] ? cnToNum(m[2]) : 0
    if (h === null) return null
    // ★ 「今晚 8 点」→ 20:00。原先只认「晚上」，漏了「今晚」，于是算成 08:00
    //   —— 差一个字的用词，就会让提醒在早上八点响。冒烟测试抓到的。
    if (EVENING.test(text) && h < 12) h += 12
    return `${String(h).padStart(2, '0')}:${String(mi ?? 0).padStart(2, '0')}`
  }
  return null
}

// ═══ 4. 能力判定 ═════════════════════════════════════════════════════════════

/** 决定 answer 的形状。与线上胶囊的 purpose 对应：availability / conflict / brief。 */
export function detectCapability(text: string, intent: Intent): Capability | null {
  if (intent === 'notes.create') return 'note_draft'
  // ★ 周范围排在日范围前面：「这周有课吗」不能被下面的 schedule.* 兜底判成 today_plan，
  //   否则又会退回"用今日安排冒充周范围"那条老路（OQ-11 明令禁止）。
  if (intent === 'schedule.week') return 'week_plan'
  if (/冲突|撞(?:课|了)?/.test(text)) return 'conflict'
  if (/有空|空闲|空档|有时间/.test(text)) return 'availability'
  if (/简报|总结|汇总/.test(text)) return 'daily_brief'
  // schedule.week 已在上面被接走（week_plan），这里**不再**列它——
  // 留着会是一条永远为假的比较，tsc 报 TS2367。而 tsc 报错不阻止 emit，
  // 所以这条死分支可以一直躺在这里没人发现。
  if (intent === 'schedule.today' || intent === 'schedule.tomorrow' || intent === 'schedule.date') {
    return /下一节|下节课|接下来.*课/.test(text) ? 'next_class' : 'today_plan'
  }
  return null
}

// ═══ 5. 辅助 ═════════════════════════════════════════════════════════════════

const parseAt = (iso: string): number => {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? Number.NaN : t
}
const fmtTime = (iso: string, tz: string): string => {
  const d = new Date(iso)
  if (!isRealDate(d)) return '--:--'   // 同上：宁可显示占位符，也不许抛
  return new Intl.DateTimeFormat('zh-CN', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
}
const fmtRange = (s: BusySlot, tz: string): string => `${fmtTime(s.startAt, tz)}-${fmtTime(s.endAt, tz)}`
const fmtDate = (iso: string, tz: string): string => {
  const d = new Date(iso)
  if (!isRealDate(d)) return '--'
  return new Intl.DateTimeFormat('zh-CN', { timeZone: tz, month: '2-digit', day: '2-digit' }).format(d)
}
const byStart = (a: BusySlot, b: BusySlot): number => parseAt(a.startAt) - parseAt(b.startAt)

/** 取窗口内（含边界）的忙闲段，按开始时间排序。 */
function slotsIn(slots: BusySlot[], fromMs: number, toMs: number): BusySlot[] {
  return slots
    .filter((s) => parseAt(s.endAt) > fromMs && parseAt(s.startAt) < toMs)
    .sort(byStart)
}

/** 把 [from,to] 里未被占用的一段段算出来。 */
function freeGaps(slots: BusySlot[], fromMs: number, toMs: number): Array<[number, number]> {
  const gaps: Array<[number, number]> = []
  let cursor = fromMs
  for (const s of slotsIn(slots, fromMs, toMs)) {
    const st = Math.max(parseAt(s.startAt), fromMs)
    if (st > cursor) gaps.push([cursor, st])
    cursor = Math.max(cursor, Math.min(parseAt(s.endAt), toMs))
  }
  if (cursor < toMs) gaps.push([cursor, toMs])
  return gaps.filter(([a, b]) => b - a >= 30 * 60 * 1000) // 少于 30 分钟不算一段空档
}

function card(partial: Omit<ActionCard, 'requiresConfirmation'> & { requiresConfirmation?: boolean }): ActionCard {
  return { requiresConfirmation: false, ...partial }
}

/**
 * 单次响应的卡片上限。
 *
 * ★ 这不是审美选择，是**体积预算的硬边界**（§1.4：单次响应 ≤ 32 KiB）。
 *   卡片是响应里唯一会随输入规模**线性增长**的部分——一张约 150 字节，
 *   所以"一天塞满课"这种合法输入能把响应顶穿预算：P08 实测 300 条课 → **74,370 字节**，
 *   是预算的 2.3 倍。原先只有简报（`slice(0,8)`）挡了一道，其余四个 handler 敞着。
 *
 * ★ 截断的是**列表**，不是**结论**：答案文本里的计数仍是真实的完整数字
 *   （「2026-09-30 有 488 节课」不会因为只列 12 张卡就变成 12）。
 *   截断时会在 `explain` 里说明——可解释性是硬要求，静默截断就是在骗人。
 */
const MAX_CARDS = 12

function capCards(cards: ActionCard[], explain: string[]): ActionCard[] {
  if (cards.length <= MAX_CARDS) return cards
  explain.push(`卡片已截断：共 ${cards.length} 项，只列出前 ${MAX_CARDS} 项（响应体积预算 ≤ 32 KiB）`)
  return cards.slice(0, MAX_CARDS)
}

// ═══ 6. 五类能力 + 兜底 ══════════════════════════════════════════════════════

interface Ctx {
  req: UniRequest
  tz: string
  now: Date
  slots: BusySlot[]
  todos: TodoSummary[]
  requestId: string
  intent: Intent
  time: ResolvedTime
  text: string
}

function unsupported(ctx: Ctx, why: string): UniResponse {
  return {
    answer: '这件事我暂时做不了。我能帮你查课表、看今天安排、找空档，也能记一条待办。',
    source: 'local_rule',
    cards: [],
    explain: [why, '比赛 MVP 只覆盖五类高频需求'],
    offlineCapable: true,
    requestId: ctx.requestId,
  }
}

function handleNextClass(ctx: Ctx): UniResponse {
  const nowMs = ctx.now.getTime()
  const upcoming = ctx.slots.filter((s) => parseAt(s.startAt) > nowMs).sort(byStart)
  if (upcoming.length === 0) {
    return {
      answer: '接下来的课表里没有找到后续课程。',
      source: 'local_rule',
      cards: [],
      explain: ['依据：本机课表里没有晚于当前时间的安排'],
      offlineCapable: true,
      requestId: ctx.requestId,
    }
  }
  const next = upcoming[0]
  const mins = Math.round((parseAt(next.startAt) - nowMs) / 60000)
  const where = next.location ? `，在${next.location}` : ''
  const howLong = mins >= 60 ? `约 ${Math.round(mins / 60)} 小时后` : `${mins} 分钟后`
  return {
    answer: `下一节是 ${fmtTime(next.startAt, ctx.tz)} 的${next.title ?? '课'}${where}，${howLong}开始。`,
    source: 'local_rule',
    cards: [card({ type: 'schedule_hint', title: next.title ?? '下一节课', time: next.startAt, operation: 'open.schedule' })],
    explain: [
      `依据：本机课表 ${next.periodLabel ?? fmtRange(next, ctx.tz)}`,
      `距开课 ${mins} 分钟`,
    ],
    offlineCapable: true,
    requestId: ctx.requestId,
  }
}

function handleTodayPlan(ctx: Ctx): UniResponse {
  const date = ctx.time.date ?? todayIn(ctx.tz, ctx.now)
  const dayStart = parseAt(atLocal(ctx.tz, date, '00:00'))
  const dayEnd = parseAt(atLocal(ctx.tz, date, '23:59'))
  const daySlots = slotsIn(ctx.slots, dayStart, dayEnd)
  const pending = ctx.todos.filter((t) => !t.done)

  const cards: ActionCard[] = [
    ...daySlots.map((s) => card({
      type: 'schedule_hint' as const,
      title: `${fmtRange(s, ctx.tz)} ${s.title ?? '课程'}`,
      time: s.startAt,
      operation: 'open.schedule' as const,
    })),
    ...pending.map((t) => card({
      type: 'brief_item' as const,
      title: t.title,
      time: t.dueAt,
      operation: 'none' as const,
    })),
  ]

  if (cards.length === 0) {
    return {
      answer: `${date} 没有课程，也没有待办。`,
      source: 'local_rule',
      cards: [],
      explain: [`日期依据：${ctx.time.basis}`, `依据：本机课表与待办在 ${date} 均为空`],
      offlineCapable: true,
      requestId: ctx.requestId,
    }
  }
  const parts: string[] = []
  if (daySlots.length) parts.push(`${daySlots.length} 节课`)
  if (pending.length) parts.push(`${pending.length} 条待办`)
  const explain = [
    `日期依据：${ctx.time.basis}`,
    `依据：本机课表 ${daySlots.length} 条 + 未完成待办 ${pending.length} 条`,
    '课表与待办已合并为一条时间线',
  ]
  return {
    answer: `${date} 有 ${parts.join('、')}。第一项是 ${cards[0].title}。`,
    source: 'local_rule',
    cards: capCards(cards, explain),
    explain,
    offlineCapable: true,
    requestId: ctx.requestId,
  }
}

function handleNoteDraft(ctx: Ctx): UniResponse {
  const clock = resolveClock(ctx.text)
  const date = ctx.time.date ?? todayIn(ctx.tz, ctx.now)
  // 标题 = 原句去掉「指令词 + 时间表达」。时间已经单独进了 noteDraft.remindAt，
  // 再留在标题里就是重复（「今晚 8 点交高数作业」→ 标题应为「交高数作业」）。
  // 剥离后若为空，退回"只去指令词"的结果，避免把标题削没了。
  const INSTRUCTION = /(记一下|记下|帮我记|帮我写|加个记事|新建记事|提醒我)/g
  // 用 HOUR_PAT 拼，保证「三点」和「3点」都能剥掉——两处写法必须共用同一套数词规则
  const TIME_PREFIX = new RegExp(
    '^\\s*(今晚|今天|明天|后天|大后天|周[一二三四五六日天]|星期[一二三四五六日天])?' +
    '\\s*(上午|下午|晚上|早上|中午|傍晚)?' +
    `\\s*(${HOUR_PAT}\\s*点(\\s*([一二三四五六七八九十]{1,3}|\\d{1,2})\\s*分)?|\\d{1,2}\\s*[:：]\\s*\\d{2})?` +
    '\\s*[，,。]?\\s*',
  )
  const withoutInstruction = ctx.text.replace(INSTRUCTION, '').trim()
  const stripped = withoutInstruction.replace(TIME_PREFIX, '').trim()
  const title = (stripped || withoutInstruction).slice(0, 50)

  if (!title) {
    return {
      answer: '你想记什么？说一句完整的话，比如「今晚 8 点交高数作业」。',
      source: 'local_rule',
      cards: [],
      explain: ['没抽出可用的标题'],
      offlineCapable: true,
      requestId: ctx.requestId,
    }
  }

  let remindAt: string | undefined
  if (clock) remindAt = atLocal(ctx.tz, date, clock)

  const action: ActionCard = {
    type: 'note_draft',
    title,
    time: remindAt,
    impact: '新增 1 条记事',
    operation: 'note.create',
    noteDraft: remindAt ? { title, remindAt } : { title },
    requiresConfirmation: true,
  }
  return {
    answer: `要我记下「${title}」吗${remindAt ? `，并在 ${fmtTime(remindAt, ctx.tz)} 提醒你` : ''}？`,
    source: 'local_rule',
    cards: [action],
    explain: [
      `识别为记事创建意图${clock ? `，时间取 ${clock}` : ''}`,
      '写入前需要你确认（不会直接落库）',
    ],
    offlineCapable: true,
    requestId: ctx.requestId,
  }
}

function handleAvailability(ctx: Ctx): UniResponse {
  const date = ctx.time.date ?? todayIn(ctx.tz, ctx.now)
  const win = resolveWindow(ctx.text) ?? { startHM: '08:00', endHM: '22:00', label: '全天' }
  const fromMs = parseAt(atLocal(ctx.tz, date, win.startHM))
  const toMs = parseAt(atLocal(ctx.tz, date, win.endHM))
  const busy = slotsIn(ctx.slots, fromMs, toMs)
  const gaps = freeGaps(ctx.slots, fromMs, toMs)

  const explain = [
    `日期依据：${ctx.time.basis}`,
    `窗口：${date} ${win.label} ${win.startHM}–${win.endHM}`,
    `依据：本机课表在该窗口内有 ${busy.length} 段占用`,
  ]
  if (busy.length === 0) {
    return {
      answer: `${date} ${win.label}整段都是空的，没有课。`,
      source: 'local_rule',
      cards: [card({ type: 'brief_item', title: `${win.label}全空`, operation: 'none' })],
      explain,
      offlineCapable: true,
      requestId: ctx.requestId,
    }
  }
  const gapText = gaps.length
    ? gaps.map(([a, b]) => `${fmtTime(new Date(a).toISOString(), ctx.tz)}-${fmtTime(new Date(b).toISOString(), ctx.tz)}`).join('、')
    : '没有 30 分钟以上的连续空档'
  return {
    answer: `${date} ${win.label}有 ${busy.length} 段安排；空档：${gapText}。`,
    source: 'local_rule',
    cards: capCards(busy.map((s) => card({ type: 'schedule_hint' as const, title: `${fmtRange(s, ctx.tz)} ${s.title ?? '课程'}`, time: s.startAt, operation: 'open.schedule' as const })), explain),
    explain,
    offlineCapable: true,
    requestId: ctx.requestId,
  }
}

function handleConflict(ctx: Ctx): UniResponse {
  const date = ctx.time.date ?? todayIn(ctx.tz, ctx.now)
  const win = resolveWindow(ctx.text) ?? { startHM: '08:00', endHM: '22:00', label: '全天' }
  const fromMs = parseAt(atLocal(ctx.tz, date, win.startHM))
  const toMs = parseAt(atLocal(ctx.tz, date, win.endHM))
  const busy = slotsIn(ctx.slots, fromMs, toMs)

  // 自检：课表内部同一时刻有两段占用，就是冲突
  const clashes: Array<[BusySlot, BusySlot]> = []
  for (let i = 0; i < busy.length; i++) {
    for (let j = i + 1; j < busy.length; j++) {
      if (parseAt(busy[i].startAt) < parseAt(busy[j].endAt) && parseAt(busy[j].startAt) < parseAt(busy[i].endAt)) {
        clashes.push([busy[i], busy[j]])
      }
    }
  }
  // 待办截止时间落在占用段里，也算冲突
  const dueClashes = ctx.todos.filter((t) => {
    if (t.done || !t.dueAt) return false
    const d = parseAt(t.dueAt)
    return busy.some((s) => d >= parseAt(s.startAt) && d <= parseAt(s.endAt))
  })

  const explain = [
    `日期依据：${ctx.time.basis}`,
    `窗口：${date} ${win.label} ${win.startHM}–${win.endHM}`,
    `依据：本机课表该窗口内 ${busy.length} 段占用、未完成待办 ${ctx.todos.filter((t) => !t.done).length} 条`,
  ]
  if (clashes.length === 0 && dueClashes.length === 0) {
    return {
      answer: `${date} ${win.label}没有发现冲突。`,
      source: 'local_rule',
      cards: capCards(busy.map((s) => card({ type: 'schedule_hint' as const, title: fmtRange(s, ctx.tz), time: s.startAt, operation: 'open.schedule' as const })), explain),
      explain,
      offlineCapable: true,
      requestId: ctx.requestId,
    }
  }

  const cards: ActionCard[] = [
    ...clashes.map(([a, b]) => card({
      type: 'conflict_hint' as const,
      title: `${a.title ?? '课程'} 与 ${b.title ?? '课程'} 时间重叠`,
      time: a.startAt,
      impact: '同一时段有两条安排',
      operation: 'none' as const,
    })),
    ...dueClashes.map((t) => card({
      type: 'conflict_hint' as const,
      title: `「${t.title}」的截止时间落在上课时段`,
      time: t.dueAt,
      impact: '可能与上课冲突',
      operation: 'none' as const,
    })),
  ]
  return {
    answer: `${date} ${win.label}发现 ${cards.length} 处冲突，详见卡片。`,
    source: 'local_rule',
    cards: capCards(cards, explain),
    explain,
    offlineCapable: true,
    requestId: ctx.requestId,
  }
}

function handleDailyBrief(ctx: Ctx): UniResponse {
  const today = todayIn(ctx.tz, ctx.now)
  // ★ 「明天的简报」必须给明天。原先固定取 today，于是问了明天却答今天——
  //   与「今晚 8 点算成 08:00」同一类错：日期算出来了，下游却没用它。
  const date = ctx.time.date ?? today
  const dayStart = parseAt(atLocal(ctx.tz, date, '00:00'))
  const dayEnd = parseAt(atLocal(ctx.tz, date, '23:59'))
  const daySlots = slotsIn(ctx.slots, dayStart, dayEnd)
  // 当天从「现在」往后看；未来某天必须从那天 00:00 往后看，
  // 否则未来那天的课会被 now 判成「已过」，简报直接说"没有后续课程"。
  const after = date === today ? ctx.now.getTime() : dayStart
  const upcoming = daySlots.filter((s) => parseAt(s.startAt) > after)
  const pending = ctx.todos.filter((t) => !t.done)
  const withDue = pending.filter((t) => t.dueAt).sort((a, b) => parseAt(a.dueAt!) - parseAt(b.dueAt!))

  const lines: string[] = []
  if (upcoming.length) lines.push(`下一节 ${fmtTime(upcoming[0].startAt, ctx.tz)} ${upcoming[0].title ?? '课'}`)
  else lines.push(date === today ? '今天没有后续课程' : `${date} 没有后续课程`)
  lines.push(`未完成待办 ${pending.length} 条`)
  if (withDue.length) lines.push(`最近截止：${withDue[0].title}（${fmtTime(withDue[0].dueAt!, ctx.tz)}）`)

  const cards: ActionCard[] = [
    ...daySlots.map((s) => card({ type: 'schedule_hint' as const, title: `${fmtRange(s, ctx.tz)} ${s.title ?? '课程'}`, time: s.startAt, operation: 'open.schedule' as const })),
    ...pending.map((t) => card({ type: 'brief_item' as const, title: t.title, time: t.dueAt, operation: 'none' as const })),
  ]
  const explain = [
    `日期依据：${ctx.time.basis}`,
    `依据：本机课表 ${date} 共 ${daySlots.length} 条、未完成待办 ${pending.length} 条`,
    '简报只读本机数据，不联网',
  ]
  return {
    answer: `${date === today ? '今日' : ctx.time.matched === 'TOMORROW' ? '明日' : date}简报：${lines.join('；')}。`,
    source: 'local_rule',
    cards: capCards(cards, explain),
    explain,
    offlineCapable: true,
    requestId: ctx.requestId,
  }
}

/**
 * 本周课程统计（OQ-11，产品负责人 2026-09-25 裁决为「实现」）。
 *
 * **口径逐条来自裁决，不得自行放宽**：
 *   · 窗口 = **使用者时区**的本周一 00:00 → 周日 23:59（不是学校时区，不是服务器时区）
 *   · 统计单位 = **连续的占用时段**：重叠或首尾相接的忙闲段合并成一次「课程安排」
 *   · **不**按 `periodLabel` 拆成多节——「第3-4节」本来就是一段，一条 BusySlot 就是一次
 *   · **不**按课程名称去重——同名课的不同时段各算一次
 *   · 不读待办、不联网、不调用模型
 *
 * ★ 为什么这里的合并方向**和 `handleConflict` 相反**：
 *   冲突问的是"哪两件事撞上了"，所以两条都要摆出来；统计问的是"这一周有几次要上课"，
 *   同一时段两门课在学生眼里就是**一段时间在上课**，算一次。两个都不删——问的问题不一样。
 */
function handleWeekPlan(ctx: Ctx): UniResponse {
  const today = todayIn(ctx.tz, ctx.now)
  const wd = weekdayOf(today)
  const fromISO = shiftDate(today, 1 - wd)
  const toISO = shiftDate(today, 7 - wd)
  const fromMs = parseAt(atLocal(ctx.tz, fromISO, '00:00'))
  const toMs = parseAt(atLocal(ctx.tz, toISO, '23:59'))

  const raw = slotsIn(ctx.slots, fromMs, toMs)

  // 合并连续时段：已按开始时刻排序，只要下一段的开始 ≤ 当前合并段的结束，就属同一段。
  // 用 `<=` 而不是 `<`：**首尾相接也算连续**——08:00-09:00 接 09:00-10:00 对学生的
  // 体感就是"连着上两节"，中间没有可用的空档。有 10 分钟课间的那种不算（有真实空档）。
  const merged: Array<{ startAt: string; endAt: string; names: string[] }> = []
  for (const s of raw) {
    const last = merged[merged.length - 1]
    if (last && parseAt(s.startAt) <= parseAt(last.endAt)) {
      if (parseAt(s.endAt) > parseAt(last.endAt)) last.endAt = s.endAt
      if (s.title && !last.names.includes(s.title)) last.names.push(s.title)
    } else {
      merged.push({ startAt: s.startAt, endAt: s.endAt, names: s.title ? [s.title] : [] })
    }
  }

  const explain = [
    `日期依据：本周一至周日（${fromISO}..${toISO}），按使用者时区 ${ctx.tz}`,
    '统计口径：按课表中的连续上课时段统计，重叠或首尾相接的时段合并为一次课程安排',
    `依据：本机课表本周原始 ${raw.length} 段，合并后 ${merged.length} 次`,
  ]

  if (merged.length === 0) {
    return {
      answer: '本周没有课程安排。',
      source: 'local_rule',
      cards: [],
      explain,
      offlineCapable: true,
      requestId: ctx.requestId,
    }
  }

  return {
    answer: `本周共有 ${merged.length} 次课程安排。`,
    source: 'local_rule',
    cards: capCards(merged.map((m) => card({
      type: 'brief_item' as const,
      title: `${fmtDate(m.startAt, ctx.tz)} ${fmtTime(m.startAt, ctx.tz)}-${fmtTime(m.endAt, ctx.tz)}${m.names.length ? ` ${m.names.join('/')}` : ''}`,
      time: m.startAt,
      operation: 'none' as const,
    })), explain),
    explain,
    offlineCapable: true,
    requestId: ctx.requestId,
  }
}

const HANDLERS: Record<Capability, (ctx: Ctx) => UniResponse> = {
  next_class: handleNextClass,
  today_plan: handleTodayPlan,
  note_draft: handleNoteDraft,
  availability: handleAvailability,
  conflict: handleConflict,
  daily_brief: handleDailyBrief,
  week_plan: handleWeekPlan,
}

// ═══ 7. 胶囊投影（Layer A → Layer B）══════════════════════════════════════════
//
// 对应契约 v1.1 的 `contextCapsule`（request.schema.json）与
// android-embed-contract.md §四的逐字段映射。
//
// ★ 这段是**数据边界的执行者**。它剥掉的东西（课程名/教室/节次/记事标题）
//   在 Layer A 是合法的，一旦出网就越界。P02.1 的 `capsule.projectionStripped`
//   不变量测的就是这个函数。

export interface ContextCapsule {
  projectionVersion: '1'
  purpose: 'availability' | 'conflict' | 'brief'
  window: { startAt: string; endAt: string }
  busySlots?: Array<{ startAt: string; endAt: string }>
  todoStatus?: { pendingCount: number; nextDueAt?: string }
}

export interface CapsuleInput {
  capability: Capability | null
  context: UniRequest['context']
  timezone: string
  now: Date
  /** 查询窗口的日期（YYYY-MM-DD）；不传取今天 */
  date?: string
}

/**
 * 能力 → 胶囊 purpose。只有这三类需要远端上下文；其余返回 null（整个字段不发）。
 *
 * ★ `week_plan` 刻意返回 null：周统计**明文规定在本机完成**（OQ-11 裁决：
 *   "不读取待办，不调用网络，不调用 LLM"），因此没有任何远端需要它的结构化上下文。
 *   这也让它天然不需要新的 `purpose` 值——**不扩胶囊 schema**。
 */
function capsulePurpose(cap: Capability | null): ContextCapsule['purpose'] | null {
  if (cap === 'availability') return 'availability'
  if (cap === 'conflict') return 'conflict'
  if (cap === 'daily_brief' || cap === 'today_plan') return 'brief'
  if (cap === 'week_plan') return null
  return null
}

/**
 * 生成最小数据胶囊。
 *
 * 返回 null 表示**这个请求不需要远端上下文**——调用方应当整个字段都不发，
 * 而不是发一个空对象（空对象也是一种声明，且会占用版本位）。
 */
export function buildCapsule(input: CapsuleInput): ContextCapsule | null {
  const purpose = capsulePurpose(input.capability)
  if (purpose === null) return null

  const date = input.date ?? todayIn(input.timezone, input.now)
  const window = { startAt: atLocal(input.timezone, date, '00:00'), endAt: atLocal(input.timezone, date, '23:59') }
  const fromMs = parseAt(window.startAt)
  const toMs = parseAt(window.endAt)

  const out: ContextCapsule = { projectionVersion: '1', purpose, window }

  // ★ 剥掉 title / location / periodLabel —— 只留时间
  const busy = slotsIn(input.context?.schedule ?? [], fromMs, toMs)
  if (busy.length) {
    out.busySlots = busy.slice(0, 20).map((s) => ({ startAt: s.startAt, endAt: s.endAt }))
  }

  // ★ 折叠 todoSummary → 统计。剥掉 title，只留数量与最近截止时间。
  const todos = input.context?.todoSummary ?? []
  const pending = todos.filter((t) => !t.done)
  if (todos.length) {
    const withDue = pending.filter((t) => t.dueAt).map((t) => t.dueAt!).sort((a, b) => parseAt(a) - parseAt(b))
    out.todoStatus = { pendingCount: pending.length, ...(withDue.length ? { nextDueAt: withDue[0] } : {}) }
  }

  return out
}

// ═══ 8. 入口 ════════════════════════════════════════════════════════════════

/**
 * 唯一入口。纯函数：同样的输入必得同样的输出（`now` 由调用方注入，不在内部取时钟）。
 * 不抛异常——任何问题都以 UniResponse 形式返回（`answer` 说明情况）。
 */
export function ask(req: UniRequest, opts: { requestId: string; now?: Date }): UniResponse {
  const requestId = opts.requestId
  const text = normalizeText(req.text)
  const tz = req.timezone || 'Asia/Shanghai'
  const now = opts.now ?? new Date(req.now)

  const base: Ctx = {
    req, tz, now, requestId, text,
    slots: req.context?.schedule ?? [],
    todos: req.context?.todoSummary ?? [],
    intent: 'unsupported',
    // 占位值：下面会用 resolveTime 覆盖。这里必须给全字段（含 basis），
    // 否则 tsc 报 TS2741——而 tsc 报错不会阻止 emit，会被"构建成功"掩盖过去。
    time: { date: null, range: null, matched: null, basis: '' },
  }

  if (text.length === 0 || text.length > 500) {
    return {
      answer: '我没听清，能再说一次吗？',
      source: 'local_rule', cards: [],
      explain: ['E_SCHEMA：文本为空或超过 500 字'],
      offlineCapable: true, requestId,
    }
  }

  // ★ 时间戳不可解析 = 之后所有相对时间都算不出来。与其让 Intl 在深处抛异常，
  //   不如在这里明确拒绝——这是同一条 E_SCHEMA 分支。
  if (!isRealDate(now)) {
    return {
      answer: '时间没对上，能再说一次吗？',
      source: 'local_rule', cards: [],
      explain: ['E_SCHEMA：now 不是可解析的时间戳'],
      offlineCapable: true, requestId,
    }
  }

  const { intent } = detectIntent(text)
  const ctx: Ctx = { ...base, intent, time: resolveTime(text, tz, now) }

  if (intent === 'smalltalk') {
    return {
      answer: '我是 Uni。可以问我「下一节什么课」「今天还有什么」「周三下午有空吗」，或者直接说「今晚 8 点交作业」让我记一条。',
      source: 'local_rule', cards: [],
      explain: ['能力边界：五类高频需求 + 记事行动卡'],
      offlineCapable: true, requestId,
    }
  }
  if (intent === 'notes.query') {
    const pending = ctx.todos.filter((t) => !t.done)
    return {
      answer: pending.length ? `还有 ${pending.length} 条待办：${pending.slice(0, 3).map((t) => t.title).join('、')}。` : '现在没有未完成的待办。',
      source: 'local_rule',
      cards: pending.map((t) => card({ type: 'brief_item' as const, title: t.title, time: t.dueAt, operation: 'none' as const })),
      explain: [`依据：本机待办未完成 ${pending.length} 条`],
      offlineCapable: true, requestId,
    }
  }
  if (intent === 'unsupported') return unsupported(ctx, '没识别出这是哪一类问题')
  if (UNSUPPORTED_INTENTS.has(intent)) {
    return unsupported(ctx, `「${intent}」在比赛 MVP 里明确不覆盖（改/删、二课、天气都已后移）`)
  }

  const capability = detectCapability(text, intent)
  if (!capability) return unsupported(ctx, `意图 ${intent} 没有对应的本机能力`)

  return HANDLERS[capability](ctx)
}
