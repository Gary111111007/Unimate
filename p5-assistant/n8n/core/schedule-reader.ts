// ─────────────────────────────────────────────────────────────────────────────
// ScheduleReader —— 「高校可迁移」的 seam
//
// 依据：主规划 v2.3.2 §1.4 创新点 4（学校差异留在 Adapter）+ §4.7 节点 5
//       （`Schedule Adapter`：**学校差异全部在这里**）+ 引导词 P07。
//
// 本文件是**学校差异的唯一落点**。它把任意来源的课表投影成 UniCore 认识的统一
// `BusySlot[]`；UniCore 与其余 Workflow 里不出现任何学校名、教务字段或选择器。
//
// 【硬约束】
//   · 不读教务网页、不解析 HTML、不含任何学校选择器
//   · 不接触教务密码 / Cookie —— 本模块只接收【已结构化】的行
//   · 纯函数：无网络、无 DOM、无文件、无原生依赖、不读环境变量
//   · 同一输入必得同一输出；非法输入**丢弃并计数**，不抛异常
//
// 【与既有契约的关系】本模块不改动任何已冻结的 schema。
//   `Course` 里的 `teacher` 在契约里【没有对应字段】——BusySlot 只有
//   `title/location/periodLabel`，所以教师名投影时自然消失，不需要额外剥离代码。
//   `periodLabel` 是白名单字段，但**只在本机可见**：出网时由 buildCapsule 剥掉。
// ─────────────────────────────────────────────────────────────────────────────

import type { BusySlot } from './types.ts'
import { atLocal, shiftDate, weekdayOf } from './uni-core.ts'

// ═══ 1. 统一课程对象（学校无关）═══════════════════════════════════════════════

/**
 * 统一课程对象。**这是 seam 的另一侧**：任何学校的东西都不许出现在这里。
 * 字段刻意只有「时间 + 名字 + 地点 + 节次」，不含周次、节次号、教务内部 ID——
 * 那些是**学校形态**，在 Adapter 里就已经被展开成具体日期了。
 */
export interface Course {
  /** 本地日期 YYYY-MM-DD */
  date: string
  /** 'HH:MM' */
  startHM: string
  /** 'HH:MM' */
  endHM: string
  name: string
  location?: string
  /** 仅本机可见。契约的 BusySlot 没有这个字段，投影时自然丢弃。 */
  teacher?: string
  /** 如「第3-4节」。仅本机可见，出网时由 buildCapsule 剥离。 */
  periodLabel?: string
}

export interface ScheduleQuery {
  /**
   * **使用者（客户端）时区**。相对时间换算只用它（§4.2.2），没有它整条规则会偏一天。
   * `from` / `to` 是**这个时区的日期**。
   */
  timezone: string
  /**
   * **课表本身用哪个时区表达**。缺省 = `timezone`（学生与学校同时区，绝大多数情况）。
   *
   * 为什么必须分开：课表上的「周三 10:00」是**学校当地时间**，而用户问的「明天」
   * 是**他自己所在地的明天**。两者不同时，按日期字符串过滤会错一整天。
   * 所以窗口判定走**时刻交叠**，不走日期字符串相等。
   */
  scheduleTimezone?: string
  /** YYYY-MM-DD，含 */
  from: string
  /** YYYY-MM-DD，含 */
  to: string
}

export interface ScheduleReadResult {
  /** 与 ScheduleReader.id 一致。用于 explain 与测试断言，**不得含学校名**。 */
  readerId: string
  busySlots: BusySlot[]
  /** 被丢弃的条数（行不可解析 / 时段非法 / 节次不在表中）。丢弃不抛异常。 */
  dropped: number
}

/**
 * 稳定接口。调用方（`LocalRulesAdapter` / 未来的 `N8nAdapter`）只认识它，
 * 换学校 = 换一个实现，调用方与 UniCore 一行不改。
 */
export interface ScheduleReader {
  readonly id: string
  read(q: ScheduleQuery): ScheduleReadResult
}

// ═══ 2. 投影：Course → BusySlot ═════════════════════════════════════════════

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * 单个 Course → BusySlot。
 *
 * 返回 null 表示**这一条必须丢弃**，而不是产出一个坏段：
 * 契约 §1.4 的不变量要求 `endAt > startAt`（按真实时刻比），
 * 放出去会让 `busySlot.order` 不变量在更远的环节炸掉——不如在源头丢。
 */
export function courseToBusySlot(c: Course, tz: string): BusySlot | null {
  if (!c || !DATE_RE.test(String(c.date))) return null
  if (!HM_RE.test(String(c.startHM)) || !HM_RE.test(String(c.endHM))) return null
  if (Number.isNaN(Date.parse(`${c.date}T12:00:00Z`))) return null

  const startAt = atLocal(tz, c.date, c.startHM)
  const endAt = atLocal(tz, c.date, c.endHM)
  if (!(Date.parse(endAt) > Date.parse(startAt))) return null // 反序或零长段
  if (!c.name) return null

  const slot: BusySlot = { startAt, endAt, title: c.name }
  if (c.location) slot.location = c.location
  if (c.periodLabel) slot.periodLabel = c.periodLabel
  return slot
}

/**
 * 窗口过滤 + 去重 + 稳定排序。两个 Adapter 共用这一条，保证行为逐字节一致。
 *
 * ★ 窗口判定用**时刻交叠**（`endAt > 窗口起 && startAt < 窗口止`），
 *   不是「日期字符串落在 [from,to] 里」。课表日期是**学校当地日**，窗口是**使用者当地日**，
 *   跨时区时它们不是同一天。交叠语义与 UniCore 内部 `slotsIn` 的边界规则完全一致，
 *   所以两处不会互相打架。
 * ★ 窗口不可解析（from/to 不是合法日期）→ 返回空结果，不抛异常。
 *   上游负责保证合法性：workflow 侧有 `Clamp Range` 节点，本机侧由 resolveTime 产出。
 */
function project(courses: readonly Course[], q: ScheduleQuery, readerId: string): ScheduleReadResult {
  const schedTz = q.scheduleTimezone ?? q.timezone
  const fromMs = Date.parse(atLocal(q.timezone, q.from, '00:00'))
  const toMs = Date.parse(atLocal(q.timezone, q.to, '23:59'))
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
    return { readerId, busySlots: [], dropped: 0 }
  }

  const seen = new Set<string>()
  const slots: BusySlot[] = []
  let dropped = 0

  for (const c of courses ?? []) {
    if (!c || typeof c.date !== 'string') { dropped++; continue }
    const s = courseToBusySlot(c, schedTz)
    if (!s) { dropped++; continue }
    if (!(Date.parse(s.endAt) > fromMs && Date.parse(s.startAt) < toMs)) continue
    // ★ 去重：同名同日同起止的重复行（周次范围重叠、导出重复）只算一次。
    //   注意**不同**课程落在同一时段是真实冲突，必须都保留——所以 key 里含 name。
    const key = `${c.name}|${c.date}|${c.startHM}|${c.endHM}`
    if (seen.has(key)) continue
    seen.add(key)
    slots.push(s)
  }

  // 稳定排序：先按开始时刻，再按课程名。没有第二键的话，同一时刻两门课的
  // 顺序取决于输入顺序，会让「相同输入 → 相同输出」在某些调用路径上不成立。
  slots.sort((a, b) =>
    Date.parse(a.startAt) - Date.parse(b.startAt) ||
    String(a.title ?? '').localeCompare(String(b.title ?? '')) ||
    String(a.endAt).localeCompare(String(b.endAt)),
  )
  return { readerId, busySlots: slots, dropped }
}

// ═══ 3. Adapter 甲：标准课程对象 ════════════════════════════════════════════
//
// 输入端已经是统一 Course（例如主工程 P4 解析器已经解析并落库的课表）。
// 它证明 seam 接受统一对象——没有第二套字段。

export class StandardCourseReader implements ScheduleReader {
  readonly id = 'standard-course'
  // ★ 不能写 `constructor(private readonly courses: ...)`：Node 24 的原生类型擦除是
  //   **strip-only** 模式，parameter property 会真的往构造函数里注入赋值代码，
  //   擦除器直接抛 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX。`core/` 下所有类都必须
  //   显式声明字段 + 在构造函数体里赋值。
  private readonly courses: readonly Course[]
  constructor(courses: readonly Course[]) {
    this.courses = courses
  }
  read(q: ScheduleQuery): ScheduleReadResult {
    return project(this.courses, q, this.id)
  }
}

// ═══ 4. Adapter 乙：教务导出形态（节次 + 周次）══════════════════════════════
//
// 输入端是**学校形态**：课按「星期几 + 第几节 + 第几周」描述，不是具体日期。
// 这里做两件学校特有的事：
//   ① 节次表映射（第 3-4 节 → 10:00–11:40）——节次表本身就是学校差异，必须由调用方传入
//   ② 周次展开（'1-16' + 单双周 → 16 个具体日期）
//
// 它证明 seam 不是假设：两次实现**真的需要不同的代码**。

export interface Period {
  /** 节次号，从 1 开始 */
  period: number
  /** 'HH:MM' */
  start: string
  end: string
}

export interface FixtureRow {
  courseName: string
  /** 1=周一 … 7=周日 */
  weekday: number
  /** 节次号序列，如 [3, 4] */
  periods: number[]
  /** 周次表达式：'1-16' 或 '1-8,10-16' */
  weeks: string
  /** 单双周；缺省 'all' */
  parity?: 'all' | 'odd' | 'even'
  room?: string
  /** 脱敏教师名（教师A~S）。仅本机可见。 */
  teacherName?: string
}

export interface ScheduleFixture {
  /**
   * 第 1 周的周一。
   * 传入非周一时**回退**到该日期所在周的周一——周次展开以周一对齐，
   * 不这样归一，第 N 周的偏移会整体串位。这条已由测试锁住。
   */
  termStart: string
  periods: Period[]
  rows: FixtureRow[]
}

/** '1-16' / '1-8,10-16' → 周次数组；按 parity 过滤。非法表达式返回空数组（调用方丢弃该行）。 */
export function parseWeeks(expr: unknown, parity: unknown): number[] {
  const out = new Set<number>()
  for (const part of String(expr ?? '').split(',')) {
    const s = part.trim()
    const m = s.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/)
    if (m) {
      for (let w = Number(m[1]); w <= Number(m[2]); w++) out.add(w)
    } else if (/^\d{1,2}$/.test(s)) {
      out.add(Number(s))
    }
  }
  return [...out]
    .filter((w) => w >= 1 && w <= 30) // 一学期不会超过 30 周；越界值一律丢
    .filter((w) => (parity === 'odd' ? w % 2 === 1 : parity === 'even' ? w % 2 === 0 : true))
    .sort((a, b) => a - b)
}

/** 节次序列 → 时间跨度。取最小节次的开始、最大节次的结束。缺任一端则整行丢。 */
export function periodSpan(
  nums: readonly number[],
  table: ReadonlyMap<number, Period>,
): { start: string; end: string; label: string } | null {
  if (!Array.isArray(nums) || nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const first = table.get(sorted[0])
  const last = table.get(sorted[sorted.length - 1])
  if (!first || !last) return null
  if (!HM_RE.test(first.start) || !HM_RE.test(last.end)) return null
  const label = sorted.length === 1 ? `第${sorted[0]}节` : `第${sorted[0]}-${sorted[sorted.length - 1]}节`
  return { start: first.start, end: last.end, label }
}

/** 任意日期 → 它所在周的周一。不可解析返回 null。 */
export function mondayOf(iso: unknown): string | null {
  if (typeof iso !== 'string' || !DATE_RE.test(iso)) return null
  if (Number.isNaN(Date.parse(`${iso}T12:00:00Z`))) return null
  return shiftDate(iso, 1 - weekdayOf(iso))
}

/** 学校形态 → 统一 Course[]。返回丢弃行数。 */
export function fixtureToCourses(fx: ScheduleFixture): { courses: Course[]; dropped: number } {
  const rows = Array.isArray(fx?.rows) ? fx.rows : []
  const termMonday = mondayOf(fx?.termStart)
  if (!termMonday) return { courses: [], dropped: rows.length }

  const table = new Map<number, Period>()
  for (const p of Array.isArray(fx?.periods) ? fx.periods : []) {
    if (p && Number.isInteger(p.period)) table.set(p.period, p)
  }

  const courses: Course[] = []
  let dropped = 0
  for (const r of rows) {
    if (!r || !r.courseName) { dropped++; continue }
    if (!Number.isInteger(r.weekday) || r.weekday < 1 || r.weekday > 7) { dropped++; continue }
    const weeks = parseWeeks(r.weeks, r.parity)
    const span = periodSpan(r.periods, table)
    if (weeks.length === 0 || !span) { dropped++; continue }
    for (const w of weeks) {
      courses.push({
        date: shiftDate(termMonday, (w - 1) * 7 + (r.weekday - 1)),
        startHM: span.start,
        endHM: span.end,
        name: r.courseName,
        ...(r.room ? { location: r.room } : {}),
        ...(r.teacherName ? { teacher: r.teacherName } : {}),
        periodLabel: span.label,
      })
    }
  }
  return { courses, dropped }
}

export class FixtureScheduleReader implements ScheduleReader {
  readonly id = 'fixture-period'
  private readonly courses: Course[]
  private readonly rejectedRows: number

  constructor(fx: ScheduleFixture) {
    const { courses, dropped } = fixtureToCourses(fx)
    this.courses = courses
    this.rejectedRows = dropped
  }


  /** 展开后的课程总数（跨全部周次）。测试用它核对周次展开是否完整。 */
  get courseCount(): number {
    return this.courses.length
  }

  read(q: ScheduleQuery): ScheduleReadResult {
    const r = project(this.courses, q, this.id)
    return { ...r, dropped: r.dropped + this.rejectedRows }
  }
}

// ═══ 5. 不支持的来源（显式拒绝，不静默降级）══════════════════════════════════

/**
 * 教务网页读取器**不存在**，而且不会存在：AGENTS.md 第 2 条禁止读取/保存教务密码与
 * Cookie，P07 又明确「不读取教务页面、不硬编码某校选择器」。
 * 这个类存在的唯一目的是让"想做也不行"变得可断言——它永远返回空并计入 dropped。
 */
export class NullScheduleReader implements ScheduleReader {
  readonly id = 'null'
  read(): ScheduleReadResult {
    return { readerId: this.id, busySlots: [], dropped: 0 }
  }
}
