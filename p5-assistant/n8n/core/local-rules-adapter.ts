// ─────────────────────────────────────────────────────────────────────────────
// LocalRulesAdapter —— 把「读课表」与「答问题」接起来的那一层
//
// 依据：主规划 v2.3.2 §1.4（`LocalRulesAdapter`：纯 TypeScript、无原生依赖，
//       未来直接随现有 Vue/Capacitor 包进入 APK）+ 引导词 P07 步骤 1/4。
//
// 职责只有三件：
//   ① 先用规则判意图与能力（**不读课表**）
//   ② 按能力算一个**最小窗口**，只读这一窗口的课表（跨周/节次差异全在 reader 里）
//   ③ 把读到的统一 BusySlot[] 交给 UniCore，并把「数据来源」追加进 explain
//
// 【为什么窗口重要】`next_class` 看未来 7 天、`week_plan` 看本周一到周日、
// `今日安排/空档/冲突/简报` 只看那一天。不是"读整份课表再过滤"——那既浪费
// 又让数据边界变模糊。
//
// 【拒绝路径零副作用】不支持的意图、闲聊、记事查询在**读课表之前**就返回，
// reader 一次都不会被调用。这条由测试用计数 reader 硬断言。
//
// 学校差异：**本文件不出现任何学校名、节次表或周次规则**，全部在 ScheduleReader 实现里。
// 学校时区也属学校数据源配置，住在**构造配置**里（OQ-13），不挂在请求上。
// ─────────────────────────────────────────────────────────────────────────────

import type { Capability, TodoSummary, UniRequest, UniResponse } from './types.ts'
import type { ScheduleReadResult, ScheduleReader } from './schedule-reader.ts'
import {
  UNSUPPORTED_INTENTS,
  ask,
  detectCapability,
  detectIntent,
  normalizeText,
  resolveTime,
  shiftDate,
  todayIn,
  weekdayOf,
} from './uni-core.ts'

/** explain 里那行「数据来源」。测试靠这个前缀把它与 UniCore 自己的依据行分开。 */
export const PROVENANCE_PREFIX = '数据来源：'

/**
 * Adapter 的**构造配置**。
 *
 * ★ 学校时区住在**这里**，不住在用户请求上（OQ-13 裁决，产品负责人 2026-09-25）：
 *   「学校时区属于**学校数据源配置**，不属于用户请求。Android 接线时由已选学校的
 *    签名档案 / Adapter 配置提供 IANA timezone。」
 *
 *   放在请求上会让"同一份课表在不同请求里被解释成不同时区"成为可能——那是数据源
 *   的属性，不是这一次提问的属性。而且冻结的 Layer A `UniRequest` 也没有这个字段，
 *   放在请求上等于**偷偷绕过契约**。
 */
export interface LocalRulesAdapterConfig {
  reader: ScheduleReader
  /**
   * 学校所在地的 IANA 时区。
   * 缺省 = 使用者时区（**安全默认**：学生与学校同时区是绝大多数情况；见 OQ-13 的保留说明）。
   */
  scheduleTimezone?: string
}

export interface LocalAdapterInput {
  text: string
  /** 使用者（客户端）时区。相对时间换算**只**用它——它表达的是"用户问的是哪一天"。 */
  timezone: string
  /** Layer A 的待办摘要。**只在本机**，出网时由 buildCapsule 折叠成计数。 */
  todos?: TodoSummary[]
}

export interface LocalAdapterOptions {
  requestId: string
  /** 注入「现在」，便于测试固定时间。不传则取系统时钟。 */
  now?: Date
}

/**
 * 能力 → 查询窗口。返回 null 表示**这个能力不需要读课表**。
 *
 * `next_class` 取「今天起 7 天」（**正式决策**，产品负责人 2026-09-25 确认）：
 * 一周内找不到后续课程就如实说找不到，而不是把窗口无限放大。
 * `week_plan` 取**使用者时区**的本周一 → 周日（OQ-11 裁决的窗口定义）。
 * `note_draft` 完全不读课表——记事只看时间。
 */
export function queryWindowFor(
  cap: Capability,
  tz: string,
  now: Date,
  date: string | null,
): { from: string; to: string } | null {
  const today = todayIn(tz, now)
  switch (cap) {
    case 'next_class':
      return { from: today, to: shiftDate(today, 7) }
    case 'week_plan': {
      // 使用者时区的周一到周日。注意这里**只用 tz**：周统计的窗口定义就是"用户在的那一周"
      const wd = weekdayOf(today)
      return { from: shiftDate(today, 1 - wd), to: shiftDate(today, 7 - wd) }
    }
    case 'today_plan':
    case 'availability':
    case 'conflict':
    case 'daily_brief':
      return { from: date ?? today, to: date ?? today }
    case 'note_draft':
      return null
  }
}

export class LocalRulesAdapter {
  // ★ 不能用 parameter property（Node 24 strip-only 擦除器不认），字段要显式声明。
  private readonly reader: ScheduleReader
  private readonly scheduleTimezone: string | null

  constructor(config: LocalRulesAdapterConfig) {
    this.reader = config.reader
    this.scheduleTimezone = config.scheduleTimezone ?? null
  }

  /** 只用于 explain 与测试断言。 */
  get readerId(): string {
    return this.reader.id
  }

  /** 学校时区（缺省时返回 null，表示"与使用者时区相同"）。只用于 explain 与测试。 */
  get schoolTimezone(): string | null {
    return this.scheduleTimezone
  }

  /**
   * 唯一入口。**纯函数**：同样的输入（含 `opts.now`）必得同样的输出。
   * 不抛异常——任何问题都以 UniResponse 形式返回。
   */
  ask(input: LocalAdapterInput, opts: LocalAdapterOptions): UniResponse {
    const tz = input.timezone || 'Asia/Shanghai'
    const now = opts.now ?? new Date()
    const text = normalizeText(input.text)

    // ── ① 先在规则层判，一步数据都不读
    const { intent } = detectIntent(text)
    const capability = detectCapability(text, intent)

    const blocked =
      intent === 'unsupported' ||
      intent === 'smalltalk' ||
      intent === 'notes.query' ||
      UNSUPPORTED_INTENTS.has(intent)

    if (blocked) {
      return ask(this.envelope(text, tz, now, opts.requestId, input.todos, []), {
        requestId: opts.requestId,
        now,
      })
    }

    // ── ② 算最小窗口，只读这一窗口
    const time = resolveTime(text, tz, now)
    const win = capability ? queryWindowFor(capability, tz, now, time.date) : null

    let read: ScheduleReadResult | null = null
    if (win) {
      read = this.reader.read({
        timezone: tz,
        // 学校时区来自**构造配置**，不来自请求（OQ-13）。它是 seam 内部字段，不出网。
        ...(this.scheduleTimezone ? { scheduleTimezone: this.scheduleTimezone } : {}),
        from: win.from,
        to: win.to,
      })
    }

    // ── ③ 交给 UniCore
    const res = ask(
      this.envelope(text, tz, now, opts.requestId, input.todos, read?.busySlots ?? []),
      { requestId: opts.requestId, now },
    )

    if (!read || !win) return res
    // 课表时区与使用者时区不同时才写出来——同时区时多这一句只是噪音
    const tzNote =
      this.scheduleTimezone && this.scheduleTimezone !== tz ? `，课表时区 ${this.scheduleTimezone}` : ''
    return {
      ...res,
      explain: [
        ...res.explain,
        `${PROVENANCE_PREFIX}本机课表读取器 ${read.readerId}，窗口 ${win.from}..${win.to}${tzNote}，` +
          `命中 ${read.busySlots.length} 条` +
          (read.dropped ? `，丢弃 ${read.dropped} 条` : ''),
      ],
    }
  }

  /** 组装 Layer A 请求。`schedule` 为空数组时**不发这个字段**，与胶囊同一个道理。 */
  private envelope(
    text: string,
    tz: string,
    now: Date,
    _requestId: string,
    todos: TodoSummary[] | undefined,
    schedule: readonly { startAt: string; endAt: string }[],
  ): UniRequest {
    const context: UniRequest['context'] = {}
    if (schedule.length) context.schedule = [...schedule]
    if (todos && todos.length) context.todoSummary = [...todos]
    return { text, now: now.toISOString(), timezone: tz, context }
  }
}
