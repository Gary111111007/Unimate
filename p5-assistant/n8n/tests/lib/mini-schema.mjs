// ─────────────────────────────────────────────────────────────────────────────
// mini-schema.mjs —— 无外部依赖的 JSON Schema (draft-07 子集) 校验器
//
// 为什么自己写：P02 要求「无外部依赖的契约测试」，本机没有装任何 npm 包，
// 也不允许为契约测试引入依赖。所以只实现本项目 schema 实际用到的那部分关键字。
//
// 支持的子集：type / required / properties / additionalProperties /
//            enum / const / minLength / maxLength / pattern / format /
//            minimum / maximum / minItems / maxItems / minProperties /
//            items / oneOf / anyOf / $ref / definitions
//
// 两处【刻意比 draft-07 更严】的地方（为了能真抓错）：
//   1. format 按【断言】处理（draft-07 默认只是注解）。uuid 与 date-time 会被实际校验。
//   2. 不支持的 schema 关键字会被忽略，但 tests/validator-self-test 会断言
//      「我们用的每一个关键字都在上面的支持列表里」，防止 schema 里写了关键字却没人校验。
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export const SUPPORTED_KEYWORDS = new Set([
  'type', 'required', 'properties', 'additionalProperties', 'enum', 'const',
  'minLength', 'maxLength', 'pattern', 'format', 'minimum', 'maximum',
  'minItems', 'maxItems', 'minProperties', 'items', 'oneOf', 'anyOf', '$ref',
  // 纯注解，不参与断言：
  '$schema', '$id', 'title', 'description', 'default', 'definitions', 'examples',
  'x-error-table', '$comment',
]);

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'boolean') return 'boolean';
  return 'object';
}

function typeMatches(declared, v) {
  const actual = typeOf(v);
  if (declared === 'number') return actual === 'number' || actual === 'integer';
  if (declared === 'integer') return actual === 'integer';
  return declared === actual;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

function resolveRef(ref, root) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  let cur = root;
  for (const seg of ref.slice(2).split('/')) {
    const key = seg.replace(/~1/g, '/').replace(/~0/g, '~');
    if (cur === null || typeof cur !== 'object') return null;
    cur = cur[key];
  }
  return cur === undefined ? null : cur;
}

/**
 * 校验 data 是否符合 schema。
 * @returns {Array<{path:string, message:string}>} 空数组 = 通过
 */
export function validate(schema, data, root = schema, path = '$') {
  const errs = [];
  const err = (p, message) => errs.push({ path: p, message });

  if (schema === null || typeof schema !== 'object') return errs;

  // $ref 在 draft-07 中是排他的：有 $ref 就忽略兄弟关键字
  if (schema.$ref !== undefined) {
    const target = resolveRef(schema.$ref, root);
    if (target === null) { err(path, `无法解析 $ref: ${schema.$ref}`); return errs; }
    return validate(target, data, root, path);
  }

  // ── type ──────────────────────────────────────────────────────────────────
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(t => typeMatches(t, data))) {
      err(path, `类型应为 ${types.join('|')}，实际 ${typeOf(data)}`);
      return errs; // 类型不符，后续断言无意义
    }
  }

  // ── enum / const ──────────────────────────────────────────────────────────
  if (schema.enum !== undefined && !schema.enum.some(e => deepEqual(e, data))) {
    err(path, `不在枚举内: ${JSON.stringify(data)}`);
  }
  if (schema.const !== undefined && !deepEqual(schema.const, data)) {
    err(path, `应恒等于 ${JSON.stringify(schema.const)}`);
  }

  // ── string ────────────────────────────────────────────────────────────────
  if (typeof data === 'string') {
    if (schema.minLength !== undefined && data.length < schema.minLength) err(path, `长度 ${data.length} < minLength ${schema.minLength}`);
    if (schema.maxLength !== undefined && data.length > schema.maxLength) err(path, `长度 ${data.length} > maxLength ${schema.maxLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(data)) err(path, `不匹配 pattern ${schema.pattern}`);
    if (schema.format === 'uuid' && !UUID_RE.test(data)) err(path, `不是合法 UUID`);
    if (schema.format === 'date-time' && !DATETIME_RE.test(data)) err(path, `不是合法 ISO-8601 date-time`);
  }

  // ── number ────────────────────────────────────────────────────────────────
  if (typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) err(path, `${data} < minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && data > schema.maximum) err(path, `${data} > maximum ${schema.maximum}`);
  }

  // ── array ─────────────────────────────────────────────────────────────────
  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) err(path, `元素数 ${data.length} < minItems ${schema.minItems}`);
    if (schema.maxItems !== undefined && data.length > schema.maxItems) err(path, `元素数 ${data.length} > maxItems ${schema.maxItems}`);
    if (schema.items !== undefined) {
      data.forEach((item, i) => errs.push(...validate(schema.items, item, root, `${path}[${i}]`)));
    }
  }

  // ── object ────────────────────────────────────────────────────────────────
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const props = schema.properties ?? {};
    if (schema.minProperties !== undefined && Object.keys(data).length < schema.minProperties) {
      err(path, `属性数 ${Object.keys(data).length} < minProperties ${schema.minProperties}`);
    }
    for (const r of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(data, r)) err(path, `缺少必填字段: ${r}`);
    }
    for (const [k, v] of Object.entries(data)) {
      if (Object.prototype.hasOwnProperty.call(props, k)) {
        errs.push(...validate(props[k], v, root, `${path}.${k}`));
      } else if (schema.additionalProperties === false) {
        err(`${path}.${k}`, `不允许的额外字段: ${k}`);
      } else if (schema.additionalProperties !== undefined && typeof schema.additionalProperties === 'object') {
        errs.push(...validate(schema.additionalProperties, v, root, `${path}.${k}`));
      }
    }
  }

  // ── oneOf / anyOf ─────────────────────────────────────────────────────────
  if (Array.isArray(schema.oneOf)) {
    const passing = schema.oneOf.filter(s => validate(s, data, root, path).length === 0);
    if (passing.length !== 1) err(path, `oneOf 要求恰好 1 个分支通过，实际 ${passing.length} 个`);
  }
  if (Array.isArray(schema.anyOf)) {
    const passing = schema.anyOf.filter(s => validate(s, data, root, path).length === 0);
    if (passing.length === 0) err(path, `anyOf 要求至少 1 个分支通过，实际 0 个`);
  }

  return errs;
}

/** 收集 schema 里用到的所有关键字名（用于自我测试的覆盖断言） */
export function collectKeywords(schema, acc = new Set()) {
  if (schema === null || typeof schema !== 'object') return acc;
  if (Array.isArray(schema)) { schema.forEach(s => collectKeywords(s, acc)); return acc; }
  for (const [k, v] of Object.entries(schema)) {
    acc.add(k);
    if (k === 'properties') { Object.values(v).forEach(s => collectKeywords(s, acc)); }
    else if (k === 'definitions') { Object.values(v).forEach(s => collectKeywords(s, acc)); }
    else if (k === 'items' || k === 'additionalProperties') { collectKeywords(v, acc); }
    else if (k === 'oneOf' || k === 'anyOf') { v.forEach(s => collectKeywords(s, acc)); }
  }
  return acc;
}

export { typeOf, deepEqual };
