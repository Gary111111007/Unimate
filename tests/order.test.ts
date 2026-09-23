// 声明顺序地雷扫描（真机事故驱动）。
// Vue 的 watch() 在创建时会【立刻执行一次 getter】来收集依赖，
// 所以 `watch(() => form.value.x, ...)` 写在 `const form = ref(...)` 上面，
// 就会抛 ReferenceError: Cannot access 'x' before initialization，
// 直接把整个组件 setup 崩掉。v2.8 的 HoursPanel 就是这么把第二课堂弄坏的，
// 而且构建、类型检查全都不报错 —— 只有真机会炸。这里补一道静态检查。
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files: string[] = [];
(function walk(d: string): void {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const f = join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.(vue|ts)$/.test(e.name)) files.push(f);
  }
})(root);

/** 取 <script setup> 内容；纯 .ts 用全文 */
function scriptOf(f: string, raw: string): string {
  if (f.endsWith('.vue')) {
    const m = raw.match(/<script setup[^>]*>([\s\S]*?)<\/script>/);
    return m ? m[1] : '';
  }
  return raw;
}

/**
 * 顶层声明。**必须覆盖 `async function`** —— v2.45 就踩到过：MeView.vue 里既
 * `import { accountUpload }` 又写了 `async function accountUpload()`，旧正则漏掉 async，
 * 于是这道"重名扫描"没报，靠人眼看才发现（和 v2.40 的 `guard` 是同一类事故）。
 */
const DECL = /^\s*(?:export\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/;
const DESTRUCT = /^\s*(?:const|let|var)\s+\{([^}]+)\}\s*=/;
/** 会在创建时立即求值 getter 的调用 */
const EAGER = /(^|[^.\w])(watch|watchEffect)\s*\(/;

let checked = 0;
const problems: string[] = [];
/**
 * 【v2.40 新增】顶层声明与 import 重名扫描。
 *
 * 真实事故：v2.34 我在 MeView.vue 里写了 `const guard = ref(...)`（提醒守护状态），
 * 而同一个文件第 8 行早就 `import { guard } from '../services/guard.ts'`（超时工具）。
 * SFC 编译时把**工具**改名成 `guard2`（真机压缩后是 `$`），于是 v2.35 新加的同步代码里
 * 所有 `guard(...)` 都在调用那个 ref → 真机报 `$ is not a function`。
 * 更糟的是它被误判成 WebCrypto 兼容问题，v2.38 整整修错了一轮。
 * 这类重名构建/单测都不报错，只有真机炸 —— 必须静态扫。
 */
const collisions: string[] = [];

for (const f of files) {
  const code = scriptOf(f, readFileSync(f, 'utf8'));
  if (!code.trim()) continue;
  const lines = code.split('\n');

  // 0) 收集 import 引入的本地名字
  const importedAt = new Map<string, number>();
  lines.forEach((l, i) => {
    const m = l.match(/^\s*import\s+([\s\S]*?)\s+from\s+['"]/);
    if (!m) return;
    const clause = m[1];
    const braces = clause.match(/\{([^}]*)\}/);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const nm = (part.split(/\s+as\s+/).pop() || '').trim();
        if (/^[A-Za-z_$][\w$]*$/.test(nm) && !importedAt.has(nm)) importedAt.set(nm, i);
      }
    }
    const dflt = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim().split(/\s+/)[0];
    if (dflt && /^[A-Za-z_$][\w$]*$/.test(dflt) && !importedAt.has(dflt)) importedAt.set(dflt, i);
    const ns = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (ns && !importedAt.has(ns[1])) importedAt.set(ns[1], i);
  });

  // 1) 记录每个顶层名字的声明行
  const declaredAt = new Map<string, number>();
  lines.forEach((l, i) => {
    const one = l.match(DECL);
    if (one && !declaredAt.has(one[1])) {
      declaredAt.set(one[1], i);
      if (importedAt.has(one[1])) {
        collisions.push(relative(root, f) + ':' + (i + 1) + ' 顶层声明 ' + one[1]
          + ' 与第 ' + (importedAt.get(one[1])! + 1) + ' 行的 import 重名（编译后会把 import 改名，调用点会静默指向本地变量）');
      }
    }
    const two = l.match(DESTRUCT);
    if (two) {
      for (const part of two[1].split(',')) {
        const nm = (part.split(':').pop() || '').split('=')[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(nm) && !declaredAt.has(nm)) declaredAt.set(nm, i);
      }
    }
  });

  // 2) 每个 watch/watchEffect 语句按括号配平取完整范围（可跨行）
  for (let i = 0; i < lines.length; i++) {
    if (!EAGER.test(lines[i])) continue;
    let depth = 0;
    let stmt = '';
    for (let j = i; j < lines.length; j++) {
      stmt += ' ' + lines[j];
      for (const ch of lines[j]) { if (ch === '(') depth++; else if (ch === ')') depth--; }
      if (depth <= 0) break;
    }
    checked++;
    // 3) 语句里引用到的标识符，若声明在该语句之后 => TDZ 地雷
    // 回调自己的参数名要先排除：watch(activeTimetable, (tt) => ...) 里的 tt
    // 是形参，和后面某个函数里的局部 const tt 重名，不算引用后声明的变量。
    const locals = new Set<string>();
    for (const m of stmt.matchAll(/\(\s*([^()]*)\)\s*=>/g)) {
      for (const part of m[1].split(',')) {
        const nm = part.trim().split(':').pop()!.split('=')[0]!.trim();
        if (/^[A-Za-z_$][\w$]*$/.test(nm)) locals.add(nm);
      }
    }
    for (const m of stmt.matchAll(/(?:^|[(,\s])([A-Za-z_$][\w$]*)\s*=>/g)) locals.add(m[1]);

    const ids = new Set<string>();
    for (const m of stmt.matchAll(/[A-Za-z_$][\w$]*/g)) ids.add(m[0]);
    for (const id of ids) {
      if (locals.has(id)) continue;
      const at = declaredAt.get(id);
      if (at !== undefined && at > i) {
        problems.push(relative(root, f) + ':' + (i + 1) + '  watch 引用了第 ' + (at + 1) + ' 行才声明的 ' + id);
      }
    }
  }
}

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : '')); }
}

console.log('扫描 ' + files.length + ' 个源文件，命中 ' + checked + ' 处 watch/watchEffect');
ok('确实扫到了 watch 语句（不是空跑）', checked >= 5, checked + ' 处');
ok('没有 watch 引用后声明变量的 TDZ 地雷', problems.length === 0, '\n        ' + problems.join('\n        '));
ok('HoursPanel 不再受影响', !problems.some((x) => x.includes('HoursPanel')), problems.join(' | '));
ok('顶层声明没有与 import 重名（v2.40 的 `$ is not a function` 事故）',
  collisions.length === 0, '\n        ' + collisions.join('\n        '));

console.log('');
console.log('Order Test: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
