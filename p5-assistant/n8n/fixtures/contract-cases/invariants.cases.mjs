// 跨字段不变量用例（主规划 v2.3.2 §1.4 的「字段不变量」三条 + 胶囊的时间先后）
//
// 为什么不写进 schema：JSON Schema draft-07 表达不了「endAt 晚于 startAt」这类时间先后，
// 也表达不了「operation 为 note.create 时 noteDraft 必填」这类【条件必填】。
// P02.1 步骤 5 明确要求：**独立不变量测试，不要让 schema 写了但测试器忽略。**
//
// 每条用例：rule（用哪条不变量）+ data（被检查的对象）+ violates（期望是否违规）。
// 实现见 tests/lib/invariants.mjs。

export const kind = 'invariants';

const T = (s) => `2026-09-30T${s}:00+08:00`;

export const cases = [
  // ── 规则 1：BusySlot.endAt 必须晚于 startAt ────────────────────────────────
  {
    id: 'p-01 忙闲段时间正序（合规）',
    rule: 'busySlot.order',
    data: { startAt: T('10:00'), endAt: T('11:40'), title: '高等数学' },
    violates: false,
  },
  {
    id: 'x-01 忙闲段 endAt 早于 startAt',
    rule: 'busySlot.order',
    data: { startAt: T('11:40'), endAt: T('10:00') },
    violates: true,
  },
  {
    id: 'x-02 忙闲段 endAt 等于 startAt（零长度，无意义）',
    rule: 'busySlot.order',
    data: { startAt: T('10:00'), endAt: T('10:00') },
    violates: true,
  },
  {
    id: 'p-02 跨时区但确实正序（UTC 偏移不同，按真实时刻比）',
    rule: 'busySlot.order',
    data: { startAt: '2026-09-30T10:00:00+08:00', endAt: '2026-09-30T03:00:00+00:00' }, // 03:00Z == 11:00+08:00
    violates: false,
  },
  {
    id: 'x-03 跨时区且实际倒序（字符串比较会误判为"正序"，必须按时刻比）',
    rule: 'busySlot.order',
    data: { startAt: '2026-09-30T10:00:00+08:00', endAt: '2026-09-30T09:00:00+08:00' },
    violates: true,
  },

  // ── 规则 2 / 3：胶囊内部的时间先后 ─────────────────────────────────────────
  {
    id: 'p-03 胶囊 busySlots 正序（合规）',
    rule: 'capsule.busySlot.order',
    data: { busySlots: [{ startAt: T('14:00'), endAt: T('15:40') }] },
    violates: false,
  },
  {
    id: 'x-04 胶囊 busySlots 有倒序段',
    rule: 'capsule.busySlot.order',
    data: { busySlots: [{ startAt: T('14:00'), endAt: T('15:40') }, { startAt: T('18:00'), endAt: T('17:00') }] },
    violates: true,
  },
  {
    id: 'p-04 胶囊 window 正序（合规）',
    rule: 'capsule.window.order',
    data: { window: { startAt: T('13:00'), endAt: T('18:00') } },
    violates: false,
  },
  {
    id: 'x-05 胶囊 window 倒序',
    rule: 'capsule.window.order',
    data: { window: { startAt: T('18:00'), endAt: T('13:00') } },
    violates: true,
  },

  // ── 规则 4：operation === 'note.create' ⇒ noteDraft 必填 且 requiresConfirmation === true ──
  {
    id: 'p-05 note.create 带 noteDraft 且需确认（合规）',
    rule: 'actionCard.noteCreateRequiresDraftAndConfirm',
    data: {
      type: 'note_draft',
      title: '交高数作业',
      operation: 'note.create',
      noteDraft: { title: '交高数作业' },
      requiresConfirmation: true,
    },
    violates: false,
  },
  {
    id: 'x-06 note.create 但缺 noteDraft（卡片没说要写什么）',
    rule: 'actionCard.noteCreateRequiresDraftAndConfirm',
    data: { type: 'note_draft', title: '交高数作业', operation: 'note.create', requiresConfirmation: true },
    violates: true,
  },
  {
    id: 'x-07 note.create 但 requiresConfirmation 为 false（绕过确认，最危险的一类）',
    rule: 'actionCard.noteCreateRequiresDraftAndConfirm',
    data: {
      type: 'note_draft',
      title: '交高数作业',
      operation: 'note.create',
      noteDraft: { title: '交高数作业' },
      requiresConfirmation: false,
    },
    violates: true,
  },

  // ── 规则 5：operation !== 'note.create' ⇒ 不得携带 noteDraft ───────────────
  {
    id: 'p-06 纯展示卡片不带 noteDraft（合规）',
    rule: 'actionCard.nonNoteCreateHasNoDraft',
    data: { type: 'brief_item', title: '今日 2 节课', operation: 'none', requiresConfirmation: false },
    violates: false,
  },
  {
    id: 'p-07 open.schedule 卡片不带 noteDraft（合规）',
    rule: 'actionCard.nonNoteCreateHasNoDraft',
    data: { type: 'schedule_hint', title: '下一节', operation: 'open.schedule', requiresConfirmation: false },
    violates: false,
  },
  {
    id: 'x-08 operation 为 none 却夹带 noteDraft（隐蔽的写入意图）',
    rule: 'actionCard.nonNoteCreateHasNoDraft',
    data: {
      type: 'brief_item',
      title: '看似只展示',
      operation: 'none',
      noteDraft: { title: '偷偷写了一笔' },
      requiresConfirmation: false,
    },
    violates: true,
  },

  // ── 规则 6：胶囊投影剥离（Layer A → Layer B 的必要条件）────────────────────
  {
    id: 'p-08 投影后的忙闲段只含时间（合规）',
    rule: 'capsule.projectionStripped',
    data: { busySlots: [{ startAt: T('14:00'), endAt: T('15:40') }], todoStatus: { pendingCount: 2, nextDueAt: T('20:00') } },
    violates: false,
  },
  {
    id: 'x-09 投影后仍带着课程名（剥离不彻底）',
    rule: 'capsule.projectionStripped',
    data: { busySlots: [{ startAt: T('14:00'), endAt: T('15:40'), title: '高等数学' }] },
    violates: true,
  },
  {
    id: 'x-10 投影后 todoStatus 仍带标题',
    rule: 'capsule.projectionStripped',
    data: { todoStatus: { pendingCount: 2, title: '交高数作业' } },
    violates: true,
  },
];
