// ─────────────────────────────────────────────────────────────────────────────
// 运行时手写校验片段 —— 【逐字】抄自主规划 §4.2.5「节点 9 Validate LLM Output」
//
// 为什么放在这里：主规划 §13.1 #4 要求有一条测试断言
//   「运行时手写校验逻辑」与「schemas/intent.schema.json」的枚举完全一致，
// 这是防止 F3 漂移的唯一手段（改了 schema 忘了改代码，或反过来）。
//
// ⚠️ 维护约定：主规划 §4.2.5 一改，本文件必须同步重抄一遍。
//    不同步的话，tests/run-contract-tests.mjs 的 D-4 会失败——那正是它的用途。
//
// 只有函数体是逐字的；外层包一层 function 是为了让本文件本身可被 Node 解析。
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
function runtimeValidateLlmOutput($input) {
  const raw = $input.first().json;

  const INTENTS = new Set([
    'schedule.today', 'schedule.tomorrow', 'schedule.week', 'schedule.date',
    'weather.today', 'weather.tomorrow', 'weather.date',
    'notes.create', 'notes.query', 'notes.update', 'notes.delete',
    'records.summary', 'smalltalk', 'unsupported',
  ]);

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const SLOT_RULES = {
    date: (v) => typeof v === 'string' && DATE_RE.test(v),
    locationScope: (v) => v === 'city' || v === 'explicit',
    keyword: (v) => typeof v === 'string' && v.length <= 50,
    targetHint: (v) => typeof v === 'string' && v.length <= 50,
    title: (v) => typeof v === 'string' && v.length <= 50,
    content: (v) => typeof v === 'string' && v.length <= 500,
    remindAt: (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v)),
  };

  const errs = [];
  const out = { slots: {} };

  if (!INTENTS.has(raw.intent)) {
    errs.push(`intent 越界: ${String(raw.intent).slice(0, 40)}`);
  } else {
    out.intent = raw.intent;
  }

  const c = Number(raw.confidence);
  if (!Number.isFinite(c) || c < 0 || c > 1) errs.push('confidence 非 [0,1] 数值');
  else out.confidence = c;

  for (const [k, v] of Object.entries(raw.slots ?? {})) {
    if (v === null || v === undefined) continue;
    const rule = SLOT_RULES[k];
    if (!rule) { errs.push(`slots 未知字段: ${k}`); continue; }
    if (!rule(v)) { errs.push(`slots.${k} 非法`); continue; }
    out.slots[k] = v;
  }

  const dr = raw.slots?.dateRange;
  if (dr) {
    if (DATE_RE.test(dr.from) && DATE_RE.test(dr.to) && dr.from <= dr.to) {
      out.slots.dateRange = { from: dr.from, to: dr.to };
    } else {
      errs.push('dateRange 非法');
    }
  }

  const needsDate = /\.(date)$/.test(out.intent ?? '');
  if (needsDate && !out.slots.date && !out.slots.dateRange) {
    errs.push('intent 要求 date，但 slots 里没有');
  }

  if (errs.length) {
    return [{ json: {
      ...raw,
      intent: 'unsupported', confidence: 0, slots: {},
      validationErrors: errs, intentSource: 'llm_rejected',
    }}];
  }

  return [{ json: { ...raw, ...out, validationErrors: [], intentSource: 'llm' } }];
}

export { runtimeValidateLlmOutput };
