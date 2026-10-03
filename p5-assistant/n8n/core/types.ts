// ─────────────────────────────────────────────────────────────────────────────
// UniCore 类型层
//
// 真源：主规划 v2.3.2 §1.4。本文件的每个接口都逐字对应 §1.4，
// 契约侧的权威定义在 schemas/uni-assistant-bridge.schema.json —— 两边由
// tests/uni-core-contract.test.mjs 的一致性断言锁住。
//
// 【约束】本文件只出类型。擦除后产物是 `export {}` 空壳，不进 gzip 预算。
// 不要在这里放任何运行时代码（常量表也不行）——那会让空壳变成实际负载。
// ─────────────────────────────────────────────────────────────────────────────

/** §1.4 正式定义 */
export interface BusySlot {
  startAt: string
  endAt: string
  /** 仅本机可见。投影到线上胶囊时必须剥离。 */
  title?: string
  /** 仅本机可见。投影到线上胶囊时必须剥离。 */
  location?: string
  /** 如「第3-4节」。仅本机可见。投影到线上胶囊时必须剥离。 */
  periodLabel?: string
}

/** §1.4 正式定义 */
export interface TodoSummary {
  title: string
  dueAt?: string
  done: boolean
}

/** §1.4 正式定义 */
export type ActionCardType = 'note_draft' | 'schedule_hint' | 'conflict_hint' | 'brief_item'
export type ActionOperation = 'none' | 'note.create' | 'open.schedule'

export interface NoteDraft {
  title: string
  remindAt?: string
}

export interface ActionCard {
  type: ActionCardType
  title: string
  time?: string
  impact?: string
  operation: ActionOperation
  noteDraft?: NoteDraft
  requiresConfirmation: boolean
}

/** §1.4 正式定义 */
export interface UniRequest {
  text: string
  now: string
  timezone: string
  context: {
    schedule?: BusySlot[]
    todoSummary?: TodoSummary[]
  }
}

/** §1.4 正式定义 */
export type UniSource = 'local_rule' | 'n8n_rule' | 'llm_fallback'

export interface UniResponse {
  answer: string
  source: UniSource
  cards: ActionCard[]
  explain: string[]
  offlineCapable: boolean
  requestId: string
}

// ─── 内部类型（不是契约，不出网）─────────────────────────────────────────────

/** 契约 §6.4 的 14 个意图。与 intent.schema.json 的 enum 必须一致。 */
export type Intent =
  | 'schedule.today'
  | 'schedule.tomorrow'
  | 'schedule.week'
  | 'schedule.date'
  | 'weather.today'
  | 'weather.tomorrow'
  | 'weather.date'
  | 'notes.create'
  | 'notes.query'
  | 'notes.update'
  | 'notes.delete'
  | 'records.summary'
  | 'smalltalk'
  | 'unsupported'

/**
 * 五类核心能力（§1.4）。**不是**意图——意图是给线上路由用的，
 * 能力决定 answer 的形状。一个意图可以对应多个能力
 * （例如 schedule.today 既可能是「下一节」，也可能是「每日简报」）。
 * 与线上胶囊的 `purpose` 对应关系见 android-embed-contract.md。
 */
export type Capability =
  | 'next_class'     // 下一节
  | 'today_plan'     // 今日安排（课 + 待办）
  | 'note_draft'     // 一句话记事
  | 'availability'   // 空档查询
  | 'conflict'       // 课表冲突
  | 'daily_brief'    // 每日简报
  /**
   * 本周课程统计（OQ-11，产品负责人 2026-09-25 裁决为「实现」）。
   * 口径见 `uni-core.ts` 的 `handleWeekPlan`。
   */
  | 'week_plan'

/** UniCore 的对外错误码（子集，与 §6.3 一致） */
export type CoreErrorCode = 'E_UNSUPPORTED' | 'E_SCHEMA'

export interface CoreOptions {
  /** 由适配器生成并传入；UniCore 不自己造，保证可追踪 */
  requestId: string
  /** 注入「现在」，便于测试固定时间。不传则用 request.now */
  now?: Date
}
