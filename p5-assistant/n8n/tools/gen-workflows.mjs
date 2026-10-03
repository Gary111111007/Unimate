#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 由 UniCore 的规则表生成 6 个 n8n Workflow JSON（P03 / n2）
//
// 为什么用生成器而不是手写 JSON：
//   `agent_intent_router` 的 Code 节点里必须有一份意图规则表，而 UniCore 里也有一份。
//   两份手写必然漂移。这里让**生成器从 UniCore 读规则**，把它序列化进 Code 节点——
//   规则只有一处真源。测试再做一遍反向核对（从生成的 JSON 里读回来与 UniCore 比），
//   这样"有人手改了 JSON"也会被抓到。
//
// 用法：node tools/gen-workflows.mjs
//
// ⚠️ 这个 tools/ 目录不在引导词 P03 的文件所有权清单里。它是为满足
//    "UniCore 与 n8n 路由输出一致"这条完成标准而加的开发工具，已在本阶段
//    的 execution-log 里显式声明。
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { RULES, INTENTS, UNSUPPORTED_INTENTS as UNSUP } from '../core/uni-core.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '..', 'workflows')
mkdirSync(OUT, { recursive: true })

// ─── 公共零件 ────────────────────────────────────────────────────────────────

let seq = 0
const nid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`

const node = (name, type, typeVersion, parameters, pos, extra = {}) => ({
  parameters,
  id: nid(),
  name,
  type,
  typeVersion,
  position: pos,
  ...extra,
})

// extra 用于给 Code 节点加 onError 之类的节点级设置（P09 的 `Build Log Input` 需要）
const code = (name, js, pos, extra = {}) => node(name, 'n8n-nodes-base.code', 2, { jsCode: js }, pos, extra)
const trig = (name, fields, pos) => node(name, 'n8n-nodes-base.executeWorkflowTrigger', 1, { workflowInputs: { values: fields } }, pos)
const exec = (name, wfId, pos) => node(name, 'n8n-nodes-base.executeWorkflow', 1.1, {
  workflowId: { __rl: true, value: wfId, mode: 'list' },
  workflowInputs: { mode: 'passthrough' },
  options: { waitForSubWorkflow: true },
}, pos, { onError: 'continueErrorOutput' })

/** 简单串行连线 */
function chain(names) {
  const c = {}
  for (let i = 0; i < names.length - 1; i++) c[names[i]] = { main: [[{ node: names[i + 1], type: 'main', index: 0 }]] }
  return c
}

/**
 * ★ 每个 Workflow 必须有**稳定的、显式的 id**（P11 真实运行时发现）。
 *
 * 为什么不能省：`agent_gateway` 的 `Route To Router` 是 `executeWorkflow` 节点，
 * 它按**工作流 id** 调用子流程。原先生成的 JSON 里**没有 id 字段**，于是 n8n 导入时
 * 自己分配一个随机 nanoId——而引用里写的是**名字**，两者永远对不上。
 *
 * 后果（真实实例里实测到的）：`executeWorkflow` 找不到工作流 → `onError: continueErrorOutput`
 * 又没有对应连线 → 条目被丢弃 → 后两个节点收到 0 条 → **webhook 返回 200 但响应体为空**。
 * 结构核对、往返核对、`new Function` 行为等价**全都发现不了**它，
 * 只有真的让 n8n 跑一次才会暴露。
 *
 * 依据：n8n 的 `import:workflow` 里是 `if (!workflow.id) workflow.id = generateNanoId()`
 * ——**给了 id 就用给的**。
 */
const WF_IDS = {
  agent_gateway: 'unimate-agent-gateway',
  agent_intent_router: 'unimate-agent-intent-router',
  schedule_query: 'unimate-schedule-query',
  notes_query: 'unimate-notes-query',
  notes_create: 'unimate-notes-create',
  agent_observability: 'unimate-agent-observability',
}

const wf = (name, nodes, connections, extra = {}) => ({
  id: WF_IDS[name] ?? `unimate-${name.replace(/_/g, '-')}`,
  name,
  nodes,
  connections,
  settings: { executionOrder: 'v1' },
  active: false,
  pinData: {},
  tags: [],
  ...extra,
})

const write = (file, obj) => {
  writeFileSync(join(OUT, file), JSON.stringify(obj, null, 2) + '\n', 'utf8')
  console.log('  写出', file, '（', obj.nodes.length, '个节点）')
}

// ─── Code 节点正文：由 UniCore 的规则表生成 ──────────────────────────────────

/** 把 UniCore 的 RULES 序列化成可在 n8n Code 节点里求值的字面量。 */
function rulesLiteral() {
  const rows = RULES.map((r) => {
    const src = r.re.source.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    const flags = r.re.flags
    return `  { intent: '${r.intent}', prio: ${r.prio}, re: new RegExp('${src}', '${flags}') },`
  })
  return `[\n${rows.join('\n')}\n]`
}

const ROUTER_JS = `// ── Rule Intent（由 tools/gen-workflows.mjs 从 core/uni-core.ts 生成，勿手改）──
// 规则表与 UniCore 同源；改了 UniCore 的 RULES 必须重跑生成器。
const INTENTS = ${JSON.stringify(INTENTS)};
const UNSUPPORTED = ${JSON.stringify([...UNSUP])};
const RULES = ${rulesLiteral()};

const item = $input.first().json;

// 文本归一化：NFKC 全角→半角、去零宽字符、折叠空白（与 UniCore 一致）
const text = String(item.text ?? '')
  .normalize('NFKC')
  .replace(/[\\u200B-\\u200D\\uFEFF\\u2060]/g, '')
  .replace(/\\s+/g, ' ')
  .trim();

if (text.length === 0 || text.length > 500) {
  return [{ json: { ...item, text, intent: 'unsupported', matchPrio: null, reason: 'E_SCHEMA' } }];
}

// 按 prio 降序取第一个命中
let intent = 'unsupported';
let matchPrio = null;
for (const r of RULES.slice().sort((a, b) => b.prio - a.prio)) {
  if (r.re.test(text)) { intent = r.intent; matchPrio = r.prio; break; }
}

// 比赛 MVP 明确不覆盖的意图：保留 intent 以便观测，但标记为不支持
const unsupported = intent === 'unsupported' || UNSUPPORTED.indexOf(intent) >= 0;

return [{ json: {
  ...item,
  text,
  intent,
  matchPrio,
  unsupported,
  llmUsed: false,          // 比赛 MVP：规则链路，零模型调用
  cacheMode: 'disabled',   // 比赛 MVP：不建 cache_manager
} }];
`

const GATEWAY_PRECHECK_JS = `// ── Precheck Payload ──────────────────────────────────────
// 只做结构与长度的硬校验；业务意图判断一律不在这里。
//
// ★ P08 加固（§13.6 #4 参数污染 / 威胁#1 数据胶囊越界）：
//   ① 所有可选字符串字段都要**先查类型**——数组/对象/null 传进来必须被拒，
//      而不是带着它们进 router（"进了 router 就已经晚了"）。
//   ② 胶囊做**逐层**封闭校验：顶层白名单不够，busySlots 的每一项也只许有 startAt/endAt。
//      这一层是数据边界的**运行期**防线，与 schema 校验互为冗余（不是二选一）。
//
// 【硬约束】不访问网络、不读 $env / process.env、不碰教务页面。
//
// ★ P11 真实运行修的两处（都只有让 n8n 真跑才会暴露）：
//   ① **webhook 的请求体在 body 字段下面**。原先直接读 \`$input.first().json\`，
//      拿到的是 \`{headers, params, query, body, webhookUrl, executionMode}\`，
//      于是 schemaVersion / requestId / message… **七个字段全部判为缺失**，
//      每个请求都走 E_SCHEMA。修法是先解包 body（非 webhook 调用时直接用原对象）。
//   ② **网关说 \`message\`，路由读 \`text\`** —— 两层字段名对不上，路由永远拿不到用户原话。
//      适配是网关的职责，所以在这里补上 \`text\`，而不是让路由去猜两种名字。
const raw = $input.first().json;
const b = (raw && typeof raw.body === 'object' && raw.body !== null && !Array.isArray(raw.body)) ? raw.body : raw;
const errs = [];
const SCHEMA_VERSIONS = ['1.1'];
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const str = (v) => typeof v === 'string';
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

if (!str(b.schemaVersion) || SCHEMA_VERSIONS.indexOf(b.schemaVersion) < 0) errs.push('schemaVersion');
if (!str(b.requestId) || !UUID.test(b.requestId)) errs.push('requestId');
if (!str(b.message)) errs.push('message');
else if (b.message.length === 0 || b.message.length > 500) errs.push('message.length');
if (!str(b.timezone)) errs.push('timezone');
if (!str(b.timestamp)) errs.push('timestamp');
if (!str(b.clientVersion)) errs.push('clientVersion');
if (b.inputType !== 'text' && b.inputType !== 'voice') errs.push('inputType');

// ① 可选字段的类型污染：出现即必须是字符串（不是数组、不是对象、不是 null）
const OPTIONAL_STRINGS = ['userId', 'sessionId', 'idempotencyKey', 'locale'];
for (const f of OPTIONAL_STRINGS) {
  if (b[f] !== undefined && !str(b[f])) errs.push(f + '.type');
}
// userId 是本轮对抗的重点（§13.6 #4）：即使类型对，也要挡住空串与超长
if (b.userId !== undefined) {
  if (!str(b.userId) || b.userId.length === 0 || b.userId.length > 64) errs.push('userId.range');
}

// ② 数据胶囊：可选字段；出现时逐层封闭
if (b.contextCapsule !== undefined) {
  const c = b.contextCapsule;
  if (!isPlainObject(c)) {
    errs.push('contextCapsule.type');
  } else {
    const CAPSULE_KEYS = ['projectionVersion', 'purpose', 'window', 'busySlots', 'todoStatus'];
    const extra = Object.keys(c).filter((k) => CAPSULE_KEYS.indexOf(k) < 0);
    if (extra.length) errs.push('contextCapsule.extra:' + extra.join(','));
    if (c.projectionVersion !== '1') errs.push('projectionVersion');
    if (['availability', 'conflict', 'brief'].indexOf(c.purpose) < 0) errs.push('purpose');

    // window：只许 startAt/endAt 两个字符串
    if (c.window !== undefined) {
      if (!isPlainObject(c.window)) errs.push('window.type');
      else {
        const wk = Object.keys(c.window).filter((k) => k !== 'startAt' && k !== 'endAt');
        if (wk.length) errs.push('window.extra:' + wk.join(','));
        if (!str(c.window.startAt) || !str(c.window.endAt)) errs.push('window.range');
      }
    }

    // busySlots：**每一项**只许 startAt/endAt —— 课程名/教室/节次一旦漏进来必须在这里断掉
    if (c.busySlots !== undefined) {
      if (!Array.isArray(c.busySlots)) errs.push('busySlots.type');
      else if (c.busySlots.length > 20) errs.push('busySlots.length');
      else {
        for (const s of c.busySlots) {
          if (!isPlainObject(s)) { errs.push('busySlots.item.type'); break; }
          const sk = Object.keys(s).filter((k) => k !== 'startAt' && k !== 'endAt');
          if (sk.length) { errs.push('busySlots.item.extra:' + sk.join(',')); break; }
          if (!str(s.startAt) || !str(s.endAt)) { errs.push('busySlots.item.range'); break; }
        }
      }
    }

    // todoStatus：只许 pendingCount / nextDueAt
    if (c.todoStatus !== undefined) {
      if (!isPlainObject(c.todoStatus)) errs.push('todoStatus.type');
      else {
        const tk = Object.keys(c.todoStatus).filter((k) => k !== 'pendingCount' && k !== 'nextDueAt');
        if (tk.length) errs.push('todoStatus.extra:' + tk.join(','));
        if (!Number.isInteger(c.todoStatus.pendingCount)) errs.push('todoStatus.pendingCount');
      }
    }
  }
}

// _precheckOk 是给下游 If 节点用的**布尔**判定。用显式布尔字段而不是让 If 去算
// 数组长度那类表达式：后者的求值语义在 If 节点里实测不可靠
// （P11 真实运行：表达式写法没生效，非法请求照样被路由）。显式字段没有歧义。
// ⚠️ 本段是模板字符串的内容：**不要在这里写裸反引号**，会提前闭合（踩过三次）。
return [{ json: { ...b, text: b.message, _precheckErrors: errs, _precheckOk: errs.length === 0 } }];
`

const GATEWAY_SHAPE_JS = `// ── Shape Response ────────────────────────────────────────
// 唯一出口。任何路径（成功 / 参数错 / 上游挂 / 内部异常）都必须经过这里，
// 响应形状恒定 —— 客户端只解析这 8 个字段，不做自然语言判断。
//
// ★ P11：上游失败时 n8n 会在条目上挂一个 \`error\` 字段（onError: continueErrorOutput
//   把失败条目送到本节点的**第二个输入**）。必须在这里把它变成结构化错误——
//   否则条目被静默丢弃，客户端拿到的是 **HTTP 200 + 空响应体**。
//   这个现象在 P11 真实运行时真的出现过，见 docs/execution-log.md。
const d = $input.first().json;
const pre = d._precheckErrors || [];

const shape = (success, intent, data, errorCode, retryable, messageForUser) => ({
  schemaVersion: '1.1',
  requestId: d.requestId || '00000000-0000-4000-8000-000000000000',
  success,
  intent: intent ?? null,
  data: data ?? {},
  errorCode: errorCode ?? null,
  retryable: retryable ?? false,
  messageForUser: messageForUser ?? null,
});

// ① 上游（子流程）失败：**不泄露内部细节**，只给稳定的错误码与用户能懂的话
if (d.error) {
  return [{ json: shape(false, null, {}, 'E_INTERNAL', true, '服务暂时不可用，请稍后再试') }];
}

// ② 预检未过
if (pre.length) {
  const versionBad = pre.indexOf('schemaVersion') >= 0;
  return [{ json: shape(false, null, { fields: pre },
    versionBad ? 'E_VERSION_UNSUPPORTED' : 'E_SCHEMA',
    false,
    versionBad ? '请升级 App' : '我没听清，能再说一次吗？') }];
}

// ③ 正常路径：结果由 router / Tool 填入；router 没返回内容时给一个明确的降级答复。
const intent = d.intent ?? null;
if (!d.intent && !d.data) {
  return [{ json: shape(false, null, {}, 'E_INTERNAL', true, '服务暂时不可用，请稍后再试') }];
}
// ★ P11 修的：success **必须由结果推导**，不能在这里硬编码 true。
//   §6.2 要求 errorCode 非空时 success 必为 false；原先上游返回
//   {success:false, errorCode:'E_SCHEMA'} 会被这里改写成 success:true，
//   于是客户端看到"成功 + 有错误码"这种自相矛盾的信封（真实运行时实测到）。
const success = d.success !== false && !d.errorCode;
return [{ json: shape(success, intent, d.data ?? {}, d.errorCode ?? null, d.retryable ?? false, d.messageForUser ?? null) }];
`

// ★ P09：把 agent_observability 接进主链路（主规划 §4.11 触发 A）
//
// **在 P09 之前，`agent_observability` 是一个孤儿工作流**：文件在仓库里，
// 6 个 Workflow 都在，但**没有任何节点引用它**（`grep observability workflows/*.json` 为空）。
// §4.11 写着"被 agent_gateway 在响应返回前调用一次（op=log_request）"——本节点就是那句话的落实。
// 这是 P09 唯一一处"修真实缺陷"而不是"补文档"的地方。
//
// ⚠️ 本段是模板字符串的内容：**不要在这里写裸反引号**，会提前闭合（踩过三次）。
const GATEWAY_LOG_INPUT_JS = `// ── Build Log Input（P09）────────────────────────────────
// 把一条**脱敏元数据**送去 agent_observability。
//
// ★ 这里只取**信封里已有的字段** —— 不是"记得别带课程名"，
//   是**上游根本没有**：Shape Response 只产那 8 个字段，message / 课程名 /
//   教师 / 教室 / 记事内容在更早的地方就已经不在数据流里了。
//   结构性约束比纪律可靠。
const d = $input.first().json;

// UTF-8 字节数手算：不用 Buffer / TextEncoder。
// n8n 的 Code 节点跑在沙箱里，Node 全局对象不一定在；
// 一个 6 行的纯函数比"大概率可用"的全局对象可靠。
const utf8Len = (s) => {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }   // 代理对
    else n += 3;
  }
  return n;
};

// payloadBytes 是**实测值**：这一条响应的真实 UTF-8 字节数。
// 与 P08 实测出 74,370 字节（预算 2.3 倍）那次的口径一致，方便日后继续盯体积。
let payloadBytes = null;
try {
  payloadBytes = utf8Len(JSON.stringify(d));
} catch (e) {
  payloadBytes = null;
}

return [{ json: {
  requestId: d.requestId ?? null,
  intent: d.intent ?? null,
  errorCode: d.errorCode ?? null,
  // latencyMs 与 textLength 在本机网关里**取不到**：Shape Response 之后信封只剩 8 个
  // 字段，请求侧的长度与起始时刻都已被有意丢弃（那是数据边界，不是疏忽）。
  // 按 docs/logging-spec.md 的规则：取不到就写 null —— **宁可 null，不臆造**。
  // 换成真值需要一条贯穿 router 的 _meta seam，见 docs/observability.md §四（**未实现**）。
  latencyMs: null,
  textLength: null,
  payloadBytes,   // 唯一一个真值，因为它是从**响应**算的
} }];
`

// ─── schedule_query 的三个节点正文 ───────────────────────────────────────────
//
// ⚠️ 这里出现的每个 `\\d` / `\\s` 都是**双反斜杠**：整段是模板字符串，
//    写成 `\d` 会被模板字符串吃掉反斜杠，生成出一个 /^d{4}$/ 这种假正则。
//    H 组的行为等价断言会当场发现，但别等到那时候。

const SCHEDULE_CLAMP_JS = `// ── Clamp Range（主规划 §4.7 节点 2）──────────────────────────
// 日期范围上限 31 天：**超出直接拒，不静默截断**——截断会让用户以为查了整学期。
// date 与 dateRange 互斥（tool.schedule.query.schema.json 的 oneOf），这里再兜一次。
//
// 【硬约束】不访问网络、不读 $env / process.env、不碰教务页面。
const d = $input.first().json;
const DATE_RE = /^\\d{4}-\\d{2}-\\d{2}$/;
const day = (s) => Date.parse(s + 'T00:00:00Z');

let from = null, to = null, rangeError = null;
if (d.date !== undefined && d.dateRange !== undefined) {
  rangeError = 'date 与 dateRange 不能同时给';
} else if (d.date !== undefined) {
  from = d.date; to = d.date;
} else if (d.dateRange !== undefined) {
  from = d.dateRange.from; to = d.dateRange.to;
} else {
  rangeError = '缺少 date 或 dateRange';
}

if (!rangeError) {
  if (!DATE_RE.test(String(from)) || !DATE_RE.test(String(to))) {
    rangeError = '日期必须是 YYYY-MM-DD';
  } else if (day(to) < day(from)) {
    rangeError = 'to 早于 from';
  } else if ((day(to) - day(from)) / 86400000 > 30) {
    rangeError = '日期范围超过 31 天';   // 含端点最多 31 个自然日
  }
}

return [{ json: { ...d, from, to, rangeError } }];
`;

const SCHEDULE_ADAPTER_JS = `// ── Schedule Adapter（学校差异全部在这里；§4.7 节点 5）─────────
// 做两件学校特有的事：① 节次表映射（第 3-4 节 → 10:00–11:40）
//                    ② 周次展开（'1-16' + 单双周 → 16 个具体日期）
// 节次表由调用方传入 —— 真实学校的作息时间不许硬编码进本文件。
//
// 【硬约束】不访问网络、不读 $env / process.env、不碰教务页面、不含任何学校选择器。
const d = $input.first().json;
if (d.rangeError) return [{ json: { ...d, busySlots: [], dropped: 0 } }];

const DATE_RE = /^\\d{4}-\\d{2}-\\d{2}$/;
const HM_RE = /^([01]\\d|2[0-3]):[0-5]\\d$/;
const tz = d.timezone || 'Asia/Shanghai';
// 课表按【学校当地时】表达，窗口按【使用者当地日】——跨时区时两者不是同一天，必须分开。
const schedTz = d.scheduleTimezone || tz;

const wd = (iso) => { const w = new Date(iso + 'T12:00:00Z').getUTCDay(); return w === 0 ? 7 : w; };
const shift = (iso, n) => {
  const t = new Date(iso + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const mondayOf = (iso) => (DATE_RE.test(String(iso)) ? shift(iso, 1 - wd(iso)) : null);
// Intl.formatToParts 拿到 Invalid Date 会直接抛 RangeError。
// 本节点的契约是不抛异常，所以先挡一道——与 core/uni-core.ts 的 isRealDate 同一处防线。
const offsetOf = (zone, at) => {
  if (isNaN(at.getTime())) return '+00:00';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(at);
  const name = (parts.find((p) => p.type === 'timeZoneName') || {}).value || 'GMT+00:00';
  const m = name.match(/GMT([+-]\\d{2}:\\d{2})/);
  return m ? m[1] : '+00:00';
};
const atLocal = (zone, dateISO, hm) => dateISO + 'T' + hm + ':00' + offsetOf(zone, new Date(dateISO + 'T12:00:00Z'));

const parseWeeks = (expr, parity) => {
  const set = {};
  String(expr === null || expr === undefined ? '' : expr).split(',').forEach((part) => {
    const s = part.trim();
    const m = s.match(/^(\\d{1,2})\\s*-\\s*(\\d{1,2})$/);
    if (m) { for (let w = Number(m[1]); w <= Number(m[2]); w++) set[w] = 1; }
    else if (/^\\d{1,2}$/.test(s)) set[Number(s)] = 1;
  });
  return Object.keys(set).map(Number)
    .filter((w) => w >= 1 && w <= 30)
    .filter((w) => (parity === 'odd' ? w % 2 === 1 : parity === 'even' ? w % 2 === 0 : true))
    .sort((a, b) => a - b);
};

const table = {};
(d.periods || []).forEach((p) => { if (p && Number.isInteger(p.period)) table[p.period] = p; });

const termMonday = mondayOf(d.termStart);
const rows = d.rows || [];
let dropped = 0;
const courses = [];
if (!termMonday) {
  dropped = rows.length;   // 学期起点不可解析 → 整份丢弃，不猜
} else {
  rows.forEach((r) => {
    if (!r || !r.courseName || !Number.isInteger(r.weekday) || r.weekday < 1 || r.weekday > 7) { dropped++; return; }
    const weeks = parseWeeks(r.weeks, r.parity);
    const nums = (Array.isArray(r.periods) ? r.periods.slice() : []).sort((a, b) => a - b);
    const first = nums.length ? table[nums[0]] : null;
    const last = nums.length ? table[nums[nums.length - 1]] : null;
    if (!weeks.length || !first || !last || !HM_RE.test(first.start) || !HM_RE.test(last.end)) { dropped++; return; }
    const label = nums.length === 1 ? '第' + nums[0] + '节' : '第' + nums[0] + '-' + nums[nums.length - 1] + '节';
    weeks.forEach((w) => {
      courses.push({
        date: shift(termMonday, (w - 1) * 7 + (r.weekday - 1)),
        startHM: first.start, endHM: last.end,
        name: r.courseName, location: r.room || null, periodLabel: label,
      });
    });
  });
}

const seen = {};
const busySlots = [];
// 窗口判定用【时刻交叠】，不是日期字符串落在区间里 —— 与 core/schedule-reader.ts 的
// project() 以及 UniCore 内部的 slotsIn() 三处边界规则必须完全一致。
const fromMs = Date.parse(atLocal(tz, d.from, '00:00'));
const toMs = Date.parse(atLocal(tz, d.to, '23:59'));
const windowOk = isFinite(fromMs) && isFinite(toMs) && toMs >= fromMs;

if (windowOk) {
  courses.forEach((c) => {
    const startAt = atLocal(schedTz, c.date, c.startHM);
    const endAt = atLocal(schedTz, c.date, c.endHM);
    if (!(Date.parse(endAt) > Date.parse(startAt))) { dropped++; return; }  // 反序/零长段一律丢
    if (!(Date.parse(endAt) > fromMs && Date.parse(startAt) < toMs)) return;
    const key = c.name + '|' + c.date + '|' + c.startHM + '|' + c.endHM;    // 同名同时段是重复行；不同名是真实冲突
    if (seen[key]) return;
    seen[key] = 1;
    const slot = { startAt: startAt, endAt: endAt, title: c.name };
    if (c.location) slot.location = c.location;
    if (c.periodLabel) slot.periodLabel = c.periodLabel;
    busySlots.push(slot);
  });
}
busySlots.sort((a, b) =>
  Date.parse(a.startAt) - Date.parse(b.startAt) ||
  String(a.title).localeCompare(String(b.title)) ||
  String(a.endAt).localeCompare(String(b.endAt)));

return [{ json: { ...d, busySlots: busySlots, dropped: dropped } }];
`;

const SCHEDULE_RESULT_JS = `// ── Build Result（主规划 §4.7 节点 6）─────────────────────────
// 派生字段在 Adapter 侧算完，不交给模型算（§4.7 约束）。
//
// ★ 仍然【不】产出 coursesInTheWindow（"范围内有几门课"）——但理由变了：
//   P07 时理由是「OQ-11 未裁决，不能绕过」；OQ-11 已于 P07.1 裁决为**实现**，
//   而裁决同时写明「**优先在本机 UniCore 内完成统计，不为这个计数向公开 DTO 增加字段**」。
//   所以统计口径（连续时段合并）只允许存在于一处：UniCore 的 handleWeekPlan。
//   在这里再给一个数，就会出现**第二个口径**——而两个口径迟早会不一致。
//
// 【硬约束】不访问网络、不读 $env / process.env、不碰教务页面。
const d = $input.first().json;
const slots = d.busySlots || [];
return [{ json: {
  success: !d.rangeError,
  intent: d.intent ?? null,
  data: {
    from: d.from ?? null,
    to: d.to ?? null,
    busySlots: slots,
    firstStart: slots.length ? slots[0].startAt : null,
    dropped: d.dropped ?? 0,
  },
  errorCode: d.rangeError ? 'E_SCHEMA' : null,
  retryable: false,
  cacheMode: 'disabled',
  llmUsed: false,
  requestId: d.requestId ?? null,
} }];
`;

// ─── 六个 Workflow ───────────────────────────────────────────────────────────

// 引用子流程时用**同一个常量**，保证"引用的 id"与"被引用工作流的 id"不可能写岔
const ROUTER_ID = WF_IDS.agent_intent_router

console.log('生成 Workflow JSON：')

// 1. agent_gateway
write('agent_gateway.json', wf('agent_gateway', [
  node('Agent Webhook', 'n8n-nodes-base.webhook', 2, {
    httpMethod: 'POST',
    path: 'v1/agent',
    responseMode: 'responseNode',
    options: {},
  }, [-220, 0], { webhookId: 'unimate-agent-gateway' }),
  code('Precheck Payload', GATEWAY_PRECHECK_JS, [0, 0]),
  // ★ P11 真实运行修的最严重一处：**预检失败必须短路，不能继续往 router 送**。
  //   原先 Precheck → Route To Router 是**无条件**连线，于是非法请求照样被路由、
  //   照样调 Tool；而 Tool 的 Build Result 会构造一个**全新的信封**，
  //   把 `_precheckErrors` 丢掉 → Shape Response 看不到预检错误 → 非法请求被当成成功。
  //   实测：`schemaVersion: '9.9'`、`userId: ['u1']`、胶囊带课程名 —— 三种都返回了 success:true。
  //   §13.6 #4 明写「userId 传数组/对象/null → 400，**不进 router**」，这条连线就是它的落实。
  node('Precheck OK?', 'n8n-nodes-base.if', 2, {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
      conditions: [{
        leftValue: '={{ $json._precheckOk }}',
        rightValue: '',
        operator: { type: 'boolean', operation: 'true' },
      }],
      combinator: 'and',
    },
    options: {},
  }, [110, 0]),
  exec('Route To Router', ROUTER_ID, [220, 0]),
  code('Shape Response', GATEWAY_SHAPE_JS, [440, 0]),
  // ── P09 新增：把观测链接进主链路（§4.11 触发 A）────────────────────────
  // ★ onError 也必须是 continueRegularOutput：它是**串接**在 Respond 前面的，
  //   一旦抛异常，Respond 就不执行 → HTTP 200 + 空响应体（P11 缺陷 #2 的症状）。
  code('Build Log Input', GATEWAY_LOG_INPUT_JS, [660, 160], { onError: 'continueRegularOutput' }),
  node('Log Request', 'n8n-nodes-base.executeWorkflow', 1.1, {
    workflowId: { __rl: true, value: WF_IDS.agent_observability, mode: 'list' },
    workflowInputs: { mode: 'passthrough' },
    options: { waitForSubWorkflow: true },
    // ★ onError 必须是 continueRegularOutput，**不能**用 exec() 默认的 continueErrorOutput。
    //   §4.11 明写"本工作流出错**不能**影响主链路：失败只记一条本地日志"。
    //   continueErrorOutput 会把失败条目送去第二个输出 —— 那个输出在这里没有可接的地方，
    //   于是失败条目被静默丢弃。**那正是 P11 缺陷 #2 的形状**（声明了错误支路却没连线）。
    //   continueRegularOutput 让失败条目原样往下走，主链路完全无感。
    //   由 Y-10 组断言 + tools/check-log-order.mjs 的真实执行数据共同锁住。
  }, [880, 160], { onError: 'continueRegularOutput' }),
  // ★ 响应体走**表达式引用**，不读 $json：`Respond` 现在排在 `Log Request` 之后，
  //   `$json` 会是**观测工作流产出的日志行**——那会把日志字段直接发给客户端。
  //   引用 `Shape Response` 才能保证响应体恒为那 8 个信封字段。
  node('Respond', 'n8n-nodes-base.respondToWebhook', 1, {
    respondWith: 'json',
    responseBody: "={{ $('Shape Response').first().json }}",
    options: { responseCode: 200 },
  }, [1100, 0]),
], {
  // ★ P11 修的：`Route To Router` 是 `onError: continueErrorOutput`，
  //   它的**第二个输出**必须接到 `Shape Response`。
  //   原先只接了 main[0]（成功支路），于是子流程一失败，条目就被静默丢弃 →
  //   后两个节点收到 0 条 → webhook 返回 **HTTP 200 + 空响应体**。
  //   §4.1 要求"任何路径都必须经过 Shape Response"，这条连线就是那句话的落实。
  //   结构性守卫见 tests/run-uni-core-tests.mjs 的 Y-8。
  'Agent Webhook': { main: [[{ node: 'Precheck Payload', type: 'main', index: 0 }]] },
  'Precheck Payload': { main: [[{ node: 'Precheck OK?', type: 'main', index: 0 }]] },
  // true → 继续路由；false → **直接去 Shape Response**，不碰 router、不碰任何 Tool
  'Precheck OK?': {
    main: [
      [{ node: 'Route To Router', type: 'main', index: 0 }],
      [{ node: 'Shape Response', type: 'main', index: 0 }],
    ],
  },
  'Route To Router': {
    main: [
      [{ node: 'Shape Response', type: 'main', index: 0 }],   // 成功
      [{ node: 'Shape Response', type: 'main', index: 0 }],   // 失败（onError 支路）
    ],
  },
  // ★ P09：`Shape Response` 之后**串接**记录链路，最后才应答。
  //
  //   Shape Response → Build Log Input → Log Request → Respond
  //
  //   ⚠️ 为什么是**串接**而不是分叉（这是实测逼出来的，不是偏好）：
  //   第一版写的是分叉——`Shape Response` 同时喂 `Build Log Input` 与 `Respond`，
  //   指望"数组里写在前面的先跑"。**隔离实例实测：不成立。**
  //   执行顺序是 `Shape Response → Respond → Build Log Input → Log Request`，
  //   即**响应先返回、日志后写**，与 §4.11 的"在响应返回前调用一次"正好相反。
  //   把数组顺序倒过来**也没有改变结果**（两次实测顺序完全相同）——
  //   同层分叉的先后在 n8n v1 下**不可靠**。
  //
  //   → 换成串接后，顺序由拓扑唯一确定，不再依赖任何未文档化的调度语义。
  //
  //   ⚠️ 串接带来一个必须堵住的洞：`Respond` 现在排在 `Log Request` 之后，
  //      若日志链路抛异常，`Respond` 就不会执行 → **HTTP 200 + 空响应体**
  //      （正是 P11 缺陷 #2/#3 的症状）。所以：
  //        ① `Build Log Input` 与 `Log Request` **都**声明 continueRegularOutput，
  //           失败条目原样往下走；
  //        ② `Respond` 的响应体走**表达式引用 `Shape Response`**，不读 `$json`——
  //           否则日志行会变成 HTTP 响应体。
  //      两条都有断言钉住（Y-10 组），并由 `tools/check-log-order.mjs` 在真实执行数据上复核。
  'Shape Response': { main: [[{ node: 'Build Log Input', type: 'main', index: 0 }]] },
  'Build Log Input': { main: [[{ node: 'Log Request', type: 'main', index: 0 }]] },
  'Log Request': { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
}))

// 2. agent_intent_router
write('agent_intent_router.json', wf('agent_intent_router', [
  trig('Input', [
    { name: 'requestId' }, { name: 'text' }, { name: 'now' },
    { name: 'timezone' }, { name: 'context' },
  ], [-220, 0]),
  code('Rule Intent', ROUTER_JS, [0, 0]),
  // ★ P11 补的：主规划 §4.2.6 的「Build Canonical Args」。
  //   原先路由只把 intent 交给 Tool，**没给日期槽位** —— 于是 schedule_query 的
  //   `Clamp Range` 每次都报"缺少 date 或 dateRange"，课表类请求永远返回 E_SCHEMA。
  //   真实运行时才看得出：单测里 Tool 是单独喂参数跑的，看不到"上游没传"这件事。
  code('Build Canonical Args', `// ── Build Canonical Args（主规划 §4.2.6 节点 11）───────────────
// 从 intent + **客户端时间戳**推导规范化的日期槽位，交给 Tool。
// 只用客户端时区（§4.2.2）——服务器时区在这条链路上不出现。
// 【硬约束】不访问网络、不读 $env / process.env。
const d = $input.first().json;
const tz = d.timezone || 'Asia/Shanghai';
const ymd = (x) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(x);
const shift = (iso, n) => { const t = new Date(iso + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const wd = (iso) => { const w = new Date(iso + 'T12:00:00Z').getUTCDay(); return w === 0 ? 7 : w; };
const parsed = new Date(d.timestamp);
const today = isNaN(parsed.getTime()) ? ymd(new Date()) : ymd(parsed);

const out = { ...d, timezone: tz, now: d.timestamp ?? null };
if (d.intent === 'schedule.week') {
  const k = wd(today);
  out.dateRange = { from: shift(today, 1 - k), to: shift(today, 7 - k) };
} else if (d.intent === 'schedule.tomorrow' || d.intent === 'weather.tomorrow') {
  out.date = shift(today, 1);
} else {
  out.date = today;
}
return [{ json: out }];
`, [110, 0]),
  node('Route By Intent', 'n8n-nodes-base.switch', 3, {
    rules: {
      values: [
        { conditions: { options: { caseSensitive: true }, conditions: [{ leftValue: '={{ $json.intent }}', rightValue: 'notes.create', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, renameOutput: true, outputKey: 'notes_create' },
        { conditions: { options: { caseSensitive: true }, conditions: [{ leftValue: '={{ $json.intent }}', rightValue: 'notes.query', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, renameOutput: true, outputKey: 'notes_query' },
        { conditions: { options: { caseSensitive: true }, conditions: [{ leftValue: '={{ $json.intent }}', rightValue: 'schedule.today', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, renameOutput: true, outputKey: 'schedule_today' },
        { conditions: { options: { caseSensitive: true }, conditions: [{ leftValue: '={{ $json.intent }}', rightValue: 'schedule.tomorrow', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, renameOutput: true, outputKey: 'schedule_tomorrow' },
        { conditions: { options: { caseSensitive: true }, conditions: [{ leftValue: '={{ $json.intent }}', rightValue: 'schedule.date', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, renameOutput: true, outputKey: 'schedule_date' },
        // schedule.week 在 P07.1 由「不支持」改为「支持」（OQ-11 裁决），
        // 所以这里必须有它自己的分支：留在 fallback 会让周统计掉进 unsupported 兜底。
        { conditions: { options: { caseSensitive: true }, conditions: [{ leftValue: '={{ $json.intent }}', rightValue: 'schedule.week', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, renameOutput: true, outputKey: 'schedule_week' },
      ],
    },
    options: { fallbackOutput: 'extra', renameFallbackOutput: 'unsupported' },
  }, [220, 0]),
  // ★ P11 真实运行修的第三处：**Switch 的每个分支都必须有落点**。
  //   原先六个分支一个都没接线 —— 子流程的"最后一个节点"是 Switch，而它的输出无处可去，
  //   `executeWorkflow` 于是拿不到任何输出，父流程的 Shape Response 收到 0 条，
  //   webhook 返回 **HTTP 200 + 空响应体**。（实测：只有一个分支碰巧返回了内容。）
  //   按 §5「Router 把请求委派给对应 Tool」，每个分支接一个 executeWorkflow。
  exec('Call notes_create', WF_IDS.notes_create, [460, -180]),
  exec('Call notes_query', WF_IDS.notes_query, [460, -60]),
  exec('Call schedule_query (today)', WF_IDS.schedule_query, [460, 60]),
  exec('Call schedule_query (tomorrow)', WF_IDS.schedule_query, [460, 180]),
  exec('Call schedule_query (date)', WF_IDS.schedule_query, [460, 300]),
  exec('Call schedule_query (week)', WF_IDS.schedule_query, [460, 420]),
  // fallback（unsupported）也要有落点，否则"不支持"的请求同样得到空响应体
  code('Mark Unsupported', `// ── Mark Unsupported ───────────────────────────────────────
// 兜底分支与各 Tool 调用**失败支路**的共同落点。
// 它存在的意义是**让落到这里的请求也有结构化输出**——
// 没有落点的兜底分支会让 §4.1「任何路径都经过 Shape Response」失效，
// 症状是 webhook 返回 HTTP 200 + 空响应体（P11 真实运行时实测到过）。
// 【硬约束】不访问网络、不读 $env / process.env。
const d = $input.first().json;
// 上游失败：n8n 会在条目上挂 error 字段，不外泄细节
if (d.error) {
  return [{ json: { ...d, success: false, errorCode: 'E_INTERNAL', retryable: true, llmUsed: false, data: {} } }];
}
return [{ json: { ...d, success: true, errorCode: 'E_UNSUPPORTED', retryable: false, llmUsed: false, data: {} } }];
`, [460, 540]),
], {
  Input: { main: [[{ node: 'Rule Intent', type: 'main', index: 0 }]] },
  'Rule Intent': { main: [[{ node: 'Build Canonical Args', type: 'main', index: 0 }]] },
  'Build Canonical Args': { main: [[{ node: 'Route By Intent', type: 'main', index: 0 }]] },
  // 分支顺序必须与上面 rules.values 的顺序**逐一对应**（索引 0..5），第 6 个是 fallback
  'Route By Intent': {
    main: [
      [{ node: 'Call notes_create', type: 'main', index: 0 }],
      [{ node: 'Call notes_query', type: 'main', index: 0 }],
      [{ node: 'Call schedule_query (today)', type: 'main', index: 0 }],
      [{ node: 'Call schedule_query (tomorrow)', type: 'main', index: 0 }],
      [{ node: 'Call schedule_query (date)', type: 'main', index: 0 }],
      [{ node: 'Call schedule_query (week)', type: 'main', index: 0 }],
      [{ node: 'Mark Unsupported', type: 'main', index: 0 }],
    ],
  },
  // 每个 Tool 调用的**失败支路**同样必须落点（Y-8 会检查）——
  // 否则一次子流程失败就等于整条链路静默失联。
  'Call notes_create': { main: [[], [{ node: 'Mark Unsupported', type: 'main', index: 0 }]] },
  'Call notes_query': { main: [[], [{ node: 'Mark Unsupported', type: 'main', index: 0 }]] },
  'Call schedule_query (today)': { main: [[], [{ node: 'Mark Unsupported', type: 'main', index: 0 }]] },
  'Call schedule_query (tomorrow)': { main: [[], [{ node: 'Mark Unsupported', type: 'main', index: 0 }]] },
  'Call schedule_query (date)': { main: [[], [{ node: 'Mark Unsupported', type: 'main', index: 0 }]] },
  'Call schedule_query (week)': { main: [[], [{ node: 'Mark Unsupported', type: 'main', index: 0 }]] },
}))

// 3-6：Tool 子工作流。比赛 MVP 的它们不做真实数据访问（Q2 未决，走 fixture adapter），
// 只把 router 传来的意图与槽位规整成统一输出信封。
const toolStub = (title, id, extraFields = []) => wf(id, [
  trig('Input', [{ name: 'requestId' }, { name: 'text' }, { name: 'timezone' }, ...extraFields.map((f) => ({ name: f }))], [-220, 0]),
  code('Build Result', `// ── ${title} ─────────────────────────────────────────────
// 比赛 MVP：Q2（账号模式下 n8n 是读服务端库还是只回指令）未定，
// 因此本工作流【不访问任何数据源】，只把路由结果规整成统一输出信封。
// 真实数据访问由未来接主工程时的 N8nAdapter 决定 —— 见 p5-assistant/NOTES.md。
const d = $input.first().json;
return [{ json: {
  success: true,
  intent: d.intent ?? null,
  data: { delegatedTo: 'local_rules' },
  errorCode: null,
  retryable: false,
  cacheMode: 'disabled',
  llmUsed: false,
  requestId: d.requestId,
} }];
`, [0, 0]),
], chain(['Input', 'Build Result']))

write('notes_query.json', toolStub('notes_query', 'notes_query'))
write('notes_create.json', toolStub('notes_create', 'notes_create'))
// 5. schedule_query —— **不是占位骨架**。主规划 §4.7 要求「学校差异全部在 Adapter 里」，
//    所以节次表映射 + 周次展开这两件学校特有的事真的写进了 Schedule Adapter 节点。
//    ⚠️ 它与 core/schedule-reader.ts 的 FixtureScheduleReader 是**同一套语义的两份实现**——
//    n8n Code 节点跑在沙箱里，不能 import 本仓库的 TS，这是不得不分开的原因。
//    防漂移靠 tests/run-schedule-adapter-tests.mjs H 组的**行为等价断言**：
//    喂同一份 fixture，节点输出必须与 FixtureScheduleReader 逐字段相同。改一边不改另一边就会红。
write('schedule_query.json', wf('schedule_query', [
  trig('Input', [
    { name: 'requestId' }, { name: 'userId' }, { name: 'date' }, { name: 'dateRange' },
    { name: 'timezone' }, { name: 'termStart' }, { name: 'periods' }, { name: 'rows' },
  ], [-440, 0]),
  code('Clamp Range', SCHEDULE_CLAMP_JS, [-220, 0]),
  code('Schedule Adapter', SCHEDULE_ADAPTER_JS, [0, 0]),
  code('Build Result', SCHEDULE_RESULT_JS, [220, 0]),
], chain(['Input', 'Clamp Range', 'Schedule Adapter', 'Build Result'])))

// 6. agent_observability：只记脱敏元数据，绝不记用户原话与课表明细
write('agent_observability.json', wf('agent_observability', [
  trig('Input', [{ name: 'requestId' }, { name: 'intent' }, { name: 'latencyMs' }, { name: 'errorCode' }], [-220, 0]),
  code('Build Log Row', `// ── Build Log Row ─────────────────────────────────────────
// 只产出【脱敏元数据】。刻意没有 message / 课程名 / 教师 / 教室 / 记事内容字段——
// 与主规划 §7.5 的 agent_log 表结构一致：那张表里【根本没有】message 列。
// 结构性约束比纪律可靠：不是"记得别写"，是"没有地方可写"。
const d = $input.first().json;
return [{ json: {
  request_id: d.requestId ?? null,
  intent: d.intent ?? null,
  latency_ms: typeof d.latencyMs === 'number' ? d.latencyMs : null,
  error_code: d.errorCode ?? null,
  success: !d.errorCode,
  env: 'local',
  // 以下字段是【长度】而不是内容
  input_length: typeof d.textLength === 'number' ? d.textLength : null,
  payload_bytes: typeof d.payloadBytes === 'number' ? d.payloadBytes : null,
} }];
`, [0, 0]),
], chain(['Input', 'Build Log Row'])))

console.log('\n完成。6 个文件已写入', OUT)
