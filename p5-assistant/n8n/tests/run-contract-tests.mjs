#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 契约测试运行器（无外部依赖）
//
// 用法：node tests/run-contract-tests.mjs
// 退出码：0 = 全通过；1 = 有失败
//
// 四组测试：
//   A. schema × fixture：正例必须通过，反例必须【失败在预期的那条约束上】
//   B. 校验器自测：证明 mini-schema 真能抓到每类违规（防止"校验器太松 → 全是假通过"）
//   C. 数据胶囊：拒绝姓名、学号、照片、整份课表、无关记事正文
//   D. 跨文件一致性：intent 枚举 / errorCode 枚举在两处必须完全相同（§13.1 #4，防 F3 漂移）
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { validate, collectKeywords, SUPPORTED_KEYWORDS } from './lib/mini-schema.mjs';
import { checkInvariant, RULE_NAMES } from './lib/invariants.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SCHEMA_DIR = join(ROOT, 'schemas');
const CASE_DIR = join(ROOT, 'fixtures', 'contract-cases');

const failures = [];
let passed = 0;
const fail = (group, id, msg) => failures.push({ group, id, msg });
const ok = () => { passed++; };

const loadSchema = (name) => JSON.parse(readFileSync(join(SCHEMA_DIR, name), 'utf8'));

// 把 $ref 解开再检查——直接读 items.additionalProperties 会读到 undefined，
// 因为封闭性写在被引用的 definition 里，不在 items 上。断言就会假红（或假绿）。
function resolveRef(root, schema) {
  let s = schema;
  let guard = 0;
  while (s && typeof s === 'object' && typeof s.$ref === 'string' && guard++ < 10) {
    let cur = root;
    for (const seg of s.$ref.replace(/^#\//, '').split('/')) cur = cur?.[seg];
    s = cur;
  }
  return s;
}

// ─── A. schema × fixture ─────────────────────────────────────────────────────
async function testSchemaCases() {
  const caseFiles = readdirSync(CASE_DIR).filter((f) => f.endsWith('.cases.mjs')).sort();
  if (caseFiles.length === 0) fail('A', '(discovery)', 'fixtures/contract-cases 下没有找到任何 *.cases.mjs');

  for (const file of caseFiles) {
    const mod = await import(new URL(`../fixtures/contract-cases/${file}`, import.meta.url));
    if (mod.kind === 'invariants') continue; // 不变量用例由 E 组处理
    const { schemaFile, valid = [], invalid = [] } = mod;
    if (!schemaFile || !existsSync(join(SCHEMA_DIR, schemaFile))) {
      fail('A', file, `schemaFile 未指定或不存在: ${schemaFile}`);
      continue;
    }
    const schema = loadSchema(schemaFile);

    for (const c of valid) {
      const errs = validate(schema, c.data);
      if (errs.length === 0) ok();
      else fail('A', `${file} :: ${c.id}`, `正例被误判为非法 → ${errs.map((e) => `${e.path} ${e.message}`).join('; ')}`);
    }
    for (const c of invalid) {
      const errs = validate(schema, c.data);
      if (errs.length === 0) {
        fail('A', `${file} :: ${c.id}`, `反例竟然通过了，未失败在预期约束「${c.expect}」上`);
      } else if (!errs.some((e) => e.message.includes(c.expect))) {
        fail('A', `${file} :: ${c.id}`, `失败在别的约束上。预期含「${c.expect}」，实际：${errs.map((e) => e.message).join('; ')}`);
      } else if (!/^i-/.test(c.id)) {
        fail('A', `${file} :: ${c.id}`, '反例 id 应以 i- 开头，正例以 v- 开头');
      } else ok();
    }
  }
}

// ─── B. 校验器自测 ───────────────────────────────────────────────────────────
function testValidatorSelfTest() {
  // 每类违规造一个最小 schema，断言校验器【确实】报错。
  // 如果这里通过而 A 组全绿，说明 A 组的绿是真的。
  const cases = [
    ['type 不符',       { type: 'string' }, 42, '类型应为 string'],
    ['required 缺失',   { type: 'object', required: ['a'] }, {}, '缺少必填字段: a'],
    ['enum 越界',       { type: 'string', enum: ['x'] }, 'y', '不在枚举内'],
    ['const 不符',      { const: 1 }, 2, '应恒等于 1'],
    ['minLength',       { type: 'string', minLength: 3 }, 'ab', 'minLength 3'],
    ['maxLength',       { type: 'string', maxLength: 2 }, 'abc', 'maxLength 2'],
    ['pattern',         { type: 'string', pattern: '^a$' }, 'b', '不匹配 pattern'],
    ['format uuid',     { type: 'string', format: 'uuid' }, 'nope', '不是合法 UUID'],
    ['format date-time',{ type: 'string', format: 'date-time' }, '2026-01-01', '不是合法 ISO-8601'],
    ['minimum',         { type: 'integer', minimum: 1 }, 0, 'minimum 1'],
    ['maximum',         { type: 'number', maximum: 1 }, 2, 'maximum 1'],
    ['minItems',        { type: 'array', minItems: 2 }, [1], 'minItems 2'],
    ['maxItems',        { type: 'array', maxItems: 1 }, [1, 2], 'maxItems 1'],
    ['minProperties',   { type: 'object', minProperties: 1 }, {}, 'minProperties 1'],
    ['additionalProperties:false', { type: 'object', properties: { a: {} }, additionalProperties: false }, { a: 1, b: 2 }, '不允许的额外字段: b'],
    ['items',           { type: 'array', items: { type: 'integer' } }, ['x'], '类型应为 integer'],
    ['oneOf 两个都过',  { oneOf: [{ type: 'number' }, { type: 'integer' }] }, 1, 'oneOf 要求恰好 1 个分支通过，实际 2 个'],
    ['oneOf 一个都不过',{ oneOf: [{ type: 'string' }, { type: 'boolean' }] }, 1, 'oneOf 要求恰好 1 个分支通过，实际 0 个'],
    ['anyOf 全不过',    { anyOf: [{ type: 'string' }, { type: 'boolean' }] }, 1, 'anyOf 要求至少 1 个分支通过，实际 0 个'],
    ['$ref 解析',       { definitions: { S: { type: 'string' } }, type: 'object', properties: { a: { $ref: '#/definitions/S' } } }, { a: 1 }, '类型应为 string'],
    ['$ref 坏引用',     { type: 'object', properties: { a: { $ref: '#/definitions/NOPE' } } }, { a: 1 }, '无法解析 $ref'],
  ];
  for (const [name, schema, data, expect] of cases) {
    const errs = validate(schema, data);
    if (errs.length === 0) fail('B', name, '校验器没有报错——太松，A 组的绿不可信');
    else if (!errs.some((e) => e.message.includes(expect))) fail('B', name, `报错信息不含「${expect}」，实际：${errs.map((e) => e.message).join('; ')}`);
    else ok();
  }

  // 反向：合法数据不能被误报
  const shouldPass = [
    ['整数满足 number', { type: 'number' }, 1],
    ['null 满足 type:["string","null"]', { type: ['string', 'null'] }, null],
    ['空 required 数组', { type: 'object', required: [] }, {}],
    ['oneOf 恰好一个', { oneOf: [{ type: 'string' }, { type: 'boolean' }] }, 'x'],
    ['anyOf 一个足矣', { anyOf: [{ type: 'string' }, { type: 'boolean' }] }, true],
    ['500 字恰好等于上界', { type: 'string', maxLength: 500 }, 'a'.repeat(500)],
  ];
  for (const [name, schema, data] of shouldPass) {
    const errs = validate(schema, data);
    if (errs.length === 0) ok();
    else fail('B', `(不应报错) ${name}`, `被误报：${errs.map((e) => e.message).join('; ')}`);
  }
}

// ─── C. 数据边界（§1.4 创新点 2；P02 步骤 10 与 P02.1 步骤 3） ───────────────
//
// v2.3.2 之后这里要分【两层】看，混在一起是错的：
//   · Layer A 的 context —— BusySlot 的 title/location/periodLabel 是【合法】的，
//     本机要用它们回答"下一节什么课、在哪"。Layer A 只拒绝身份与记事正文。
//   · Layer B 的 contextCapsule —— 内容类字段一律拒绝，因为胶囊是出网的。
//   "剥离"这件事发生在【投影】那一步，由 E 组的 capsule.projectionStripped 断言。
async function testDataCapsule() {
  const T = (s) => `2026-09-30T${s}:00+08:00`;

  // ── C-1 Layer A：context 允许内容，拒绝身份 ──────────────────────────────
  const bridge = loadSchema('uni-assistant-bridge.schema.json');
  const ctxSchema = bridge.definitions.UniRequest.properties.context;
  const goodCtx = {
    schedule: [{ startAt: T('10:00'), endAt: T('11:40'), title: '高等数学', location: '教三-201', periodLabel: '第3-4节' }],
    todoSummary: [{ title: '交高数作业', dueAt: T('20:00'), done: false }],
  };
  ok0(validate(ctxSchema, goodCtx, bridge).length === 0, 'C', 'Layer A 正常上下文（含课程名与教室——本机合法）', ctxSchema, bridge, goodCtx);

  const layerAForbidden = [
    ['姓名', { schedule: [{ startAt: T('10:00'), endAt: T('11:40'), studentName: '智小汇' }] }, '不允许的额外字段: studentName'],
    ['学号', { todoSummary: [{ title: '交作业', done: false, studentId: '2025040999' }] }, '不允许的额外字段: studentId'],
    ['照片', { schedule: [{ startAt: T('10:00'), endAt: T('11:40'), photo: 'data:image/png;base64,AAAA' }] }, '不允许的额外字段: photo'],
    ['记事正文', { todoSummary: [{ title: '交作业', done: false, content: '老师说要写满三页' }] }, '不允许的额外字段: content'],
  ];
  for (const [label, bad, expect] of layerAForbidden) {
    const errs = validate(ctxSchema, bad, bridge);
    if (errs.length === 0) fail('C', `Layer A 拒绝${label}`, '没有拒绝——白名单失效');
    else if (!errs.some((e) => e.message.includes(expect))) fail('C', `Layer A 拒绝${label}`, `拒绝原因不是「${expect}」，实际：${errs.map((e) => e.message).join('; ')}`);
    else ok();
  }

  // ── C-2 Layer B：contextCapsule 拒绝一切内容类字段 ───────────────────────
  const reqSchema = loadSchema('request.schema.json');
  const capSchema = reqSchema.properties.contextCapsule;
  const goodCap = {
    projectionVersion: '1',
    purpose: 'availability',
    window: { startAt: T('13:00'), endAt: T('18:00') },
    busySlots: [{ startAt: T('14:00'), endAt: T('15:40') }],
    todoStatus: { pendingCount: 2, nextDueAt: T('20:00') },
  };
  ok0(validate(capSchema, goodCap, reqSchema).length === 0, 'C', 'Layer B 正常胶囊（只有时间与计数）', capSchema, reqSchema, goodCap);

  const layerBForbidden = [
    ['课程名', { ...goodCap, busySlots: [{ startAt: T('14:00'), endAt: T('15:40'), courseName: '高等数学' }] }, '不允许的额外字段: courseName'],
    ['教师', { ...goodCap, busySlots: [{ startAt: T('14:00'), endAt: T('15:40'), teacher: '教师A' }] }, '不允许的额外字段: teacher'],
    ['教室', { ...goodCap, busySlots: [{ startAt: T('14:00'), endAt: T('15:40'), location: '教三-201' }] }, '不允许的额外字段: location'],
    ['记事标题', { ...goodCap, todoStatus: { pendingCount: 2, title: '交高数作业' } }, '不允许的额外字段: title'],
    ['记事正文', { ...goodCap, todoStatus: { pendingCount: 2, content: '老师说要写满三页' } }, '不允许的额外字段: content'],
    ['姓名', { ...goodCap, studentName: '智小汇' }, '不允许的额外字段: studentName'],
    ['学号', { ...goodCap, studentId: '2025040999' }, '不允许的额外字段: studentId'],
    ['照片', { ...goodCap, photo: 'data:image/png;base64,AAAA' }, '不允许的额外字段: photo'],
    ['账号', { ...goodCap, account: 'u_8f3a91' }, '不允许的额外字段: account'],
    ['凭据', { ...goodCap, token: 'eyJhbGciOiJIUzI1NiJ9' }, '不允许的额外字段: token'],
  ];
  for (const [label, bad, expect] of layerBForbidden) {
    const errs = validate(capSchema, bad, reqSchema);
    if (errs.length === 0) fail('C', `Layer B 拒绝${label}`, '没有拒绝——胶囊白名单失效');
    else if (!errs.some((e) => e.message.includes(expect))) fail('C', `Layer B 拒绝${label}`, `拒绝原因不是「${expect}」，实际：${errs.map((e) => e.message).join('; ')}`);
    else ok();
  }
}

function ok0(pass, group, id, schema, root, data) {
  if (pass) { ok(); return; }
  fail(group, id, `被误报：${validate(schema, data, root).map((e) => e.message).join('; ')}`);
}

// ─── E. 跨字段不变量（JSON Schema 表达不了的那些） ───────────────────────────
async function testInvariants() {
  const file = 'invariants.cases.mjs';
  if (!existsSync(join(CASE_DIR, file))) {
    fail('E', '(discovery)', `缺少 ${file}——跨字段不变量就没有可执行测试了`);
    return;
  }
  const mod = await import(new URL(`../fixtures/contract-cases/${file}`, import.meta.url));
  const cases = mod.cases ?? [];
  const seen = new Map(); // rule -> { pass, violate }

  for (const c of cases) {
    const errs = checkInvariant(c.rule, c.data);
    const violated = errs.length > 0;
    const rec = seen.get(c.rule) ?? { pass: 0, violate: 0 };
    rec[violated ? 'violate' : 'pass']++;
    seen.set(c.rule, rec);

    if (violated !== c.violates) {
      fail('E', `${file} :: ${c.id}`,
        c.violates
          ? `期望违规但检查通过——不变量【漏了】这种情况`
          : `期望合规但被判违规：${errs.join('; ')}`);
    } else ok();
  }

  // 覆盖度：每条规则都必须同时有【合规】与【违规】用例。
  // 只有合规用例的话，一个"永远返回合规"的空实现也能全绿。
  for (const rule of RULE_NAMES) {
    const rec = seen.get(rule);
    if (!rec) { fail('E', `覆盖度 ${rule}`, '该规则没有任何用例——等于没测'); continue; }
    if (rec.pass === 0) fail('E', `覆盖度 ${rule}`, '只有违规用例，没有合规用例');
    else if (rec.violate === 0) fail('E', `覆盖度 ${rule}`, '只有合规用例，没有违规用例——空实现也能全绿');
    else ok();
  }
  // 反向：用例里不许出现实现中不存在的规则名
  for (const rule of seen.keys()) {
    if (!RULE_NAMES.includes(rule)) fail('E', `未知规则 ${rule}`, '用例引用了 lib/invariants.mjs 里没有的规则名');
    else ok();
  }
}

// ─── D. 跨文件一致性（§13.1 #4，防 F3 漂移） ─────────────────────────────────
function testCrossFileConsistency() {
  const intent = loadSchema('intent.schema.json');
  const response = loadSchema('response.schema.json');
  const error = loadSchema('error.schema.json');

  // D-1: intent.schema 的 enum  vs  response.schema 的 intent enum（去掉 null）
  const a = new Set(intent.properties.intent.enum);
  const b = new Set(response.properties.intent.enum.filter((x) => x !== null));
  const diffAB = [...a].filter((x) => !b.has(x)).concat([...b].filter((x) => !a.has(x)));
  if (diffAB.length) fail('D', 'intent 枚举', `intent.schema 与 response.schema 不一致：${diffAB.join(', ')}`);
  else ok();

  // D-2: error.schema 的 code enum  vs  response.schema 的 errorCode enum（去掉 null）
  const c = new Set(error.definitions.code.enum);
  const d = new Set(response.properties.errorCode.enum.filter((x) => x !== null));
  const diffCD = [...c].filter((x) => !d.has(x)).concat([...d].filter((x) => !c.has(x)));
  if (diffCD.length) fail('D', 'errorCode 枚举', `error.schema 与 response.schema 不一致：${diffCD.join(', ')}`);
  else ok();

  // D-3: error.schema 的 x-error-table 覆盖全部 errorCode
  const table = Object.keys(error['x-error-table'] || {}).filter((k) => !k.startsWith('$'));
  const missing = [...c].filter((x) => !table.includes(x));
  if (missing.length) fail('D', 'error 表覆盖', `x-error-table 缺：${missing.join(', ')}`);
  else ok();

  // D-4【F3 核心】运行时手写校验代码的 INTENTS 集合 vs intent.schema 的 enum
  const runtimePath = join(HERE, 'fixtures', 'runtime-validate-llm-output.js');
  if (!existsSync(runtimePath)) {
    fail('D', 'F3 一致性', '缺少 tests/fixtures/runtime-validate-llm-output.js——无法做运行时 vs schema 的漂移断言');
  } else {
    const src = readFileSync(runtimePath, 'utf8');
    const m = src.match(/const INTENTS = new Set\(\[([\s\S]*?)\]\)/);
    if (!m) {
      fail('D', 'F3 一致性', '没能从运行时片段里提取出 INTENTS 集合（片段结构变了？）');
    } else {
      const runtimeIntents = new Set(
        m[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/^['"]|['"]$/g, ''))
      );
      const onlySchema = [...a].filter((x) => !runtimeIntents.has(x));
      const onlyRuntime = [...runtimeIntents].filter((x) => !a.has(x));
      if (onlySchema.length || onlyRuntime.length) {
        fail('D', 'F3 一致性', `运行时 INTENTS 与 intent.schema 漂移。仅 schema 有：${onlySchema.join(', ') || '无'}；仅运行时 有：${onlyRuntime.join(', ') || '无'}`);
      } else ok();
      if (runtimeIntents.size !== 14) fail('D', 'F3 一致性', `运行时 INTENTS 数量为 ${runtimeIntents.size}，预期 14`);
      else ok();
    }
  }

  // D-5: 所有 schema 只使用 mini-schema 支持的关键字（防止写了关键字却没人校验）
  for (const f of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.schema.json'))) {
    const used = collectKeywords(loadSchema(f));
    const unsupported = [...used].filter((k) => !SUPPORTED_KEYWORDS.has(k));
    if (unsupported.length) fail('D', `关键字覆盖 ${f}`, `使用了校验器不支持的关键字（等于没校验）：${unsupported.join(', ')}`);
    else ok();
  }

  // D-6: Layer B 版本号在请求与响应两侧必须一致，且都是 1.1（v2.3.2）
  const reqVer = loadSchema('request.schema.json').properties.schemaVersion.enum;
  const resVer = loadSchema('response.schema.json').properties.schemaVersion.enum;
  const EXPECT_VER = '1.1';
  if (JSON.stringify(reqVer) !== JSON.stringify([EXPECT_VER])) {
    fail('D', 'Layer B 版本', `request.schemaVersion 的 enum 是 ${JSON.stringify(reqVer)}，预期 ["${EXPECT_VER}"]`);
  } else ok();
  if (JSON.stringify(resVer) !== JSON.stringify([EXPECT_VER])) {
    fail('D', 'Layer B 版本', `response.schemaVersion 的 enum 是 ${JSON.stringify(resVer)}，预期 ["${EXPECT_VER}"]`);
  } else ok();
  if (JSON.stringify(reqVer) !== JSON.stringify(resVer)) {
    fail('D', 'Layer B 版本', `请求(${JSON.stringify(reqVer)}) 与响应(${JSON.stringify(resVer)}) 版本号不一致`);
  } else ok();

  // D-7: v1.1 的 contextCapsule 必须真的接在请求上，且白名单是封闭的
  const reqSchemaForD7 = loadSchema('request.schema.json');
  const capsule = reqSchemaForD7.properties.contextCapsule;
  if (!capsule) {
    fail('D', 'contextCapsule', 'request.schema.json 里没有 contextCapsule——v1.1 的关键新增丢了');
  } else {
    ok();
    if (capsule.additionalProperties !== false) fail('D', 'contextCapsule', 'additionalProperties 不是 false——黑名单会漏');
    else ok();
    const need = ['projectionVersion', 'purpose', 'window'];
    const missing = need.filter((k) => !(capsule.required ?? []).includes(k));
    if (missing.length) fail('D', 'contextCapsule', `缺少必填字段声明：${missing.join(', ')}`);
    else ok();
    const slots = capsule.properties?.busySlots;
    if (!slots || slots.maxItems !== 20) fail('D', 'contextCapsule', `busySlots 的 maxItems 应为 20，实际 ${slots?.maxItems}`);
    else ok();
    if (resolveRef(reqSchemaForD7, slots?.items)?.additionalProperties !== false) {
      fail('D', 'contextCapsule', 'busySlots.items 未封闭——课程名/教师/教室能混进来');
    } else ok();
  }

  // D-8: 桥接的正式 DTO 必须已去掉旧【推断】字段
  const defs = loadSchema('uni-assistant-bridge.schema.json').definitions;
  const staleFields = [['BusySlot', 'date'], ['BusySlot', 'start'], ['BusySlot', 'end']];
  for (const [dto, field] of staleFields) {
    if (Object.prototype.hasOwnProperty.call(defs?.[dto]?.properties ?? {}, field)) {
      fail('D', 'DTO 正式化', `${dto} 仍带着旧推断字段 ${field}——v2.3.2 已改为 startAt/endAt`);
    } else ok();
  }
  const ac = defs?.ActionCard;
  if (!ac?.properties?.operation) fail('D', 'DTO 正式化', 'ActionCard 缺 operation —— v2.3.2 新增的必填字段');
  else ok();
  if (!ac?.properties?.noteDraft) fail('D', 'DTO 正式化', 'ActionCard 缺 noteDraft');
  else ok();
  if (!(ac?.required ?? []).includes('operation')) fail('D', 'DTO 正式化', 'operation 未列入 ActionCard.required');
  else ok();

  // ── D-9: 白名单必须【恰好】是这些字段 ────────────────────────────────────
  //
  // 为什么要有这一组：变异验证发现了一个洞——把 CapsuleBusySlot 的 properties
  // 加上一个 `title`，294 条测试全绿。逐字段补反例是打地鼠，永远追不上。
  // 这里改成【精确集合断言】：多一个字段、少一个字段都报红。
  // 数据边界的最后一道防线必须是这个，不能靠"我想到的泄漏字段都写了用例"。
  const exact = (label, props, expected) => {
    const actual = Object.keys(props ?? {}).sort();
    const want = [...expected].sort();
    if (JSON.stringify(actual) !== JSON.stringify(want)) {
      fail('D', `白名单精确性 ${label}`, `实际 [${actual.join(', ')}] ≠ 期望 [${want.join(', ')}]`);
    } else ok();
  };

  exact('capsule（Layer B）', capsule?.properties,
    ['projectionVersion', 'purpose', 'window', 'busySlots', 'todoStatus']);
  exact('capsule.busySlots.items', resolveRef(reqSchemaForD7, capsule?.properties?.busySlots?.items)?.properties,
    ['startAt', 'endAt']);
  exact('capsule.todoStatus', capsule?.properties?.todoStatus?.properties,
    ['pendingCount', 'nextDueAt']);

  // Layer A 的 DTO 白名单也照 §1.4 逐字锁死
  exact('BusySlot（Layer A）', defs?.BusySlot?.properties,
    ['startAt', 'endAt', 'title', 'location', 'periodLabel']);
  exact('TodoSummary（Layer A）', defs?.TodoSummary?.properties,
    ['title', 'dueAt', 'done']);
  exact('ActionCard（Layer A）', ac?.properties,
    ['type', 'title', 'time', 'impact', 'operation', 'noteDraft', 'requiresConfirmation']);
  exact('ActionCard.noteDraft', ac?.properties?.noteDraft?.properties,
    ['title', 'remindAt']);
}

// ─── 主流程 ─────────────────────────────────────────────────────────────────
console.log('── Unimate n8n 契约测试 ────────────────────────────────');
await testSchemaCases();
testValidatorSelfTest();
await testDataCapsule();
await testInvariants();
testCrossFileConsistency();

console.log(`通过 ${passed} 条，失败 ${failures.length} 条`);
if (failures.length) {
  console.log('\n失败明细：');
  for (const f of failures) console.log(`  [${f.group}] ${f.id}\n      ${f.msg}`);
  process.exit(1);
}
console.log('全部通过 ✓');
