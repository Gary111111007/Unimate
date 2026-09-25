// ─────────────────────────────────────────────────────────────────────────────
// 跨字段不变量检查（主规划 v2.3.2 §1.4 的「字段不变量」）
//
// 这些约束 JSON Schema draft-07 表达不了：
//   · 时间先后（endAt > startAt）—— 没有比较两个字段的关键字
//   · 条件必填（operation 为某值时 noteDraft 必填）—— 没有 if/then 之外的机制，
//     而 mini-schema 刻意不实现 if/then（见 tests/README.md 的关键字覆盖说明）
//
// 所以用独立函数实现。每个函数返回【违规信息数组】，空数组 = 合规。
// ─────────────────────────────────────────────────────────────────────────────

const parse = (s) => {
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
};

/** 检查单个时间段是否正序 */
function checkOrder(label, startAt, endAt) {
  const s = parse(startAt);
  const e = parse(endAt);
  if (s === null) return [`${label}.startAt 无法解析为时间: ${startAt}`];
  if (e === null) return [`${label}.endAt 无法解析为时间: ${endAt}`];
  // 按【真实时刻】比较，不是按字符串。跨时区时 "10:00+08:00" vs "03:00+00:00" 字符串比会判错。
  if (e <= s) return [`${label} 的 endAt(${endAt}) 必须晚于 startAt(${startAt})`];
  return [];
}

export const RULES = {
  /** 规则 1：BusySlot.endAt > startAt */
  'busySlot.order': (data) => checkOrder('BusySlot', data?.startAt, data?.endAt),

  /** 规则 2：胶囊里每个忙闲段都要正序 */
  'capsule.busySlot.order': (data) => {
    const slots = data?.busySlots;
    if (!Array.isArray(slots)) return []; // 结构问题由 schema 测试负责
    return slots.flatMap((s, i) => checkOrder(`busySlots[${i}]`, s?.startAt, s?.endAt));
  },

  /** 规则 3：胶囊 window 正序 */
  'capsule.window.order': (data) => checkOrder('window', data?.window?.startAt, data?.window?.endAt),

  /** 规则 4：operation === 'note.create' ⇒ noteDraft 必填 且 requiresConfirmation === true */
  'actionCard.noteCreateRequiresDraftAndConfirm': (data) => {
    if (data?.operation !== 'note.create') return [];
    const errs = [];
    if (data.noteDraft === undefined || data.noteDraft === null) {
      errs.push('operation 为 note.create 时 noteDraft 必填');
    }
    if (data.requiresConfirmation !== true) {
      errs.push(`operation 为 note.create 时 requiresConfirmation 必须为 true，实际 ${JSON.stringify(data.requiresConfirmation)}`);
    }
    return errs;
  },

  /** 规则 5：operation !== 'note.create' ⇒ 不得携带 noteDraft */
  'actionCard.nonNoteCreateHasNoDraft': (data) => {
    if (data?.operation === 'note.create') return [];
    if (data?.noteDraft !== undefined && data?.noteDraft !== null) {
      return [`operation 为 ${JSON.stringify(data.operation)} 时不得携带 noteDraft`];
    }
    return [];
  },

  /**
   * 规则 6：胶囊投影必须剥离
   * 忙闲段只留 {startAt,endAt}；todoStatus 只留 {pendingCount,nextDueAt}。
   * 这条是 Layer A → Layer B 投影的【必要条件】——schema 的 additionalProperties:false
   * 是最后一道防线，这里检查的是"投影函数有没有把该剥的剥掉"。
   */
  'capsule.projectionStripped': (data) => {
    const errs = [];
    const SLOT_OK = new Set(['startAt', 'endAt']);
    const TODO_OK = new Set(['pendingCount', 'nextDueAt']);
    for (const [i, s] of (data?.busySlots ?? []).entries()) {
      for (const k of Object.keys(s ?? {})) {
        if (!SLOT_OK.has(k)) errs.push(`busySlots[${i}] 投影后仍带着 ${k}——应在投影时剥离`);
      }
    }
    for (const k of Object.keys(data?.todoStatus ?? {})) {
      if (!TODO_OK.has(k)) errs.push(`todoStatus 投影后仍带着 ${k}——应折叠为 pendingCount/nextDueAt`);
    }
    return errs;
  },
};

/** 跑一条用例；返回违规信息数组 */
export function checkInvariant(ruleName, data) {
  const rule = RULES[ruleName];
  if (!rule) return [`未知的不变量规则: ${ruleName}`];
  return rule(data);
}

export const RULE_NAMES = Object.keys(RULES);
