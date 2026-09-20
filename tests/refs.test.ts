// 模板引用检查（防"构建全绿、真机才炸"）。
// 已经栽过两次：删代码时把还在用的 const 一起删了（wire / splashDone 那类），
// vite 只转译不做检查，运行时才 ReferenceError。这里补一道静态检查：
// 模板里用到的根标识符，必须能在 <script setup> 的声明/导入/props 里找到。
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const BT = String.fromCharCode(96);
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files: string[] = [];
(function walk(d: string): void {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const f = join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.name.endsWith('.vue')) files.push(f);
  }
})(root);

const GLOBALS = new Set([
  'true', 'false', 'null', 'undefined', 'this', 'in', 'of', 'typeof', 'instanceof', 'new', 'return',
  'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Set', 'Map', 'RegExp',
  'Promise', 'Error', 'window', 'document', 'console', 'isNaN', 'isFinite', 'parseInt', 'parseFloat',
  'encodeURIComponent', 'decodeURIComponent', 'event', 'navigator', 'location'
]);
const VUE_BUILTINS = new Set(['$slots', '$attrs', '$props', '$el', '$refs', '$event']);

function scriptOf(raw: string): string {
  const m = raw.match(/<script setup[^>]*>([\s\S]*?)<\/script>/);
  return m ? m[1] : '';
}
function templateOf(raw: string): string {
  const m = raw.match(/<template>([\s\S]*)<\/template>/);
  return m ? m[1] : '';
}

/** 去掉字符串字面量：模板里的 'school' / "volunteer" 不是标识符 */
function stripStrings(expr: string): string {
  return expr
    .replace(/'(?:[^'\\]|\\.)*'/g, '@@')
    .replace(/"(?:[^"\\]|\\.)*"/g, '@@')
    .replace(new RegExp(BT + '(?:[^' + BT + '\\\\]|\\\\.)*' + BT, 'g'), '@@');
}

/** 收集 <script setup> 里对模板可见的名字 */
function declaredNames(script: string): Set<string> {
  const names = new Set<string>();
  for (const m of script.matchAll(/import\s+(?:([\w$]+)|\{([^}]*)\}|\*\s+as\s+([\w$]+))[^;]*;/g)) {
    if (m[1]) names.add(m[1]);
    if (m[2]) for (const part of m[2].split(',')) {
      const nm = (part.split(/\s+as\s+/).pop() || '').trim();
      if (nm) names.add(nm);
    }
    if (m[3]) names.add(m[3]);
  }
  for (const m of script.matchAll(/\b(?:const|let|var)\s+([\w$]+)/g)) names.add(m[1]);
  for (const m of script.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const nm = (part.split(':').pop() || '').split('=')[0]!.trim();
      if (nm) names.add(nm);
    }
  }
  for (const m of script.matchAll(/\bfunction\s+([\w$]+)/g)) names.add(m[1]);
  for (const m of script.matchAll(/\bclass\s+([\w$]+)/g)) names.add(m[1]);
  // defineProps 的三种写法：类型式、对象式、数组式（props 对模板直接可见）
  for (const m of script.matchAll(/defineProps\s*<\s*\{([\s\S]*?)\}\s*>\s*\(\)/g)) {
    for (const line of m[1].split(/[;\n]/)) {
      const nm = line.split(':')[0]!.trim().replace(/\?$/, '');
      if (/^[A-Za-z_$][\w$]*$/.test(nm)) names.add(nm);
    }
  }
  for (const m of script.matchAll(/defineProps\s*\(\s*\{([\s\S]*?)\}\s*\)/g)) {
    for (const mm of m[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)) names.add(mm[1]);
  }
  for (const m of script.matchAll(/defineProps\s*\(\s*\[([^\]]*)\]/g)) {
    for (const mm of m[1].matchAll(/['"]([\w$]+)['"]/g)) names.add(mm[1]);
  }
  return names;
}

/** 模板里出现的表达式：只取绑定属性与插值，静态 class="btn danger" 不算 */
function templateExpressions(tpl: string): string[] {
  const out: string[] = [];
  for (const m of tpl.matchAll(/\{\{([\s\S]*?)\}\}/g)) out.push(stripStrings(m[1]));
  for (const m of tpl.matchAll(/([\w@:.-]+)\s*=\s*"([^"]*)"/g)) {
    const name = m[1];
    if (!(name.startsWith('@') || name.startsWith(':') || name.startsWith('v-'))) continue;
    if (name === 'v-for') continue;
    out.push(stripStrings(m[2]));
  }
  return out;
}

/** v-for 别名与插槽作用域变量：只在模板内有效 */
function templateLocals(tpl: string): Set<string> {
  const loc = new Set<string>();
  for (const m of tpl.matchAll(/v-for\s*=\s*"\s*\(([^)]*)\)\s*(?:in|of)\s/g)) {
    for (const part of m[1].split(',')) {
      const nm = part.trim();
      if (/^[\w$]+$/.test(nm)) loc.add(nm);
    }
  }
  for (const m of tpl.matchAll(/v-for\s*=\s*"\s*([\w$]+)\s+(?:in|of)\s/g)) loc.add(m[1]);
  for (const m of tpl.matchAll(/v-slot(?::[\w-]+)?\s*=\s*"\s*\{([^}]*)\}"/g)) {
    for (const part of m[1].split(',')) {
      const nm = (part.split(':').pop() || '').split('=')[0]!.trim();
      if (/^[\w$]+$/.test(nm)) loc.add(nm);
    }
  }
  for (const m of tpl.matchAll(/#([\w-]+)="\s*\{([^}]*)\}"/g)) {
    for (const part of m[2].split(',')) {
      const nm = (part.split(':').pop() || '').split('=')[0]!.trim();
      if (/^[\w$]+$/.test(nm)) loc.add(nm);
    }
  }
  return loc;
}

/** 表达式内部的局部名：TS 的 as 断言、内联箭头函数参数 */
function exprLocals(expr: string): Set<string> {
  const loc = new Set<string>();
  // (a, b) => ... 与 a => ...
  for (const m of expr.matchAll(/\(([^()]*)\)\s*=>/g)) {
    for (const part of m[1].split(',')) {
      const nm = part.trim().split(':')[0]!.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(nm)) loc.add(nm);
    }
  }
  for (const m of expr.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) loc.add(m[1]);
  return loc;
}

/** 抹掉 as 断言里的类型名，否则 HTMLInputElement / BlockKey 会被当成标识符 */
function stripCasts(expr: string): string {
  return expr.replace(/\s+as\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\[[^\]]*\])?/g, ' ');
}

/** 取表达式里的根标识符：跳过 obj.prop 的 prop，也跳过对象字面量的键 */
function rootIdents(expr: string): string[] {
  const res: string[] = [];
  const re = /(\.)?\b([A-Za-z_$][\w$]*)\b(\s*:)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr))) {
    if (m[1]) continue;          // obj.prop 的 prop
    if (m[3]) continue;          // 紧跟冒号 => 对象字面量的键
    res.push(m[2]);
  }
  return res;
}

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

const problems: string[] = [];
let scanned = 0;
for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  const script = scriptOf(raw);
  const tpl = templateOf(raw);
  if (!script || !tpl) continue;
  scanned++;
  const declared = declaredNames(script);
  const locals = templateLocals(tpl);
  const bad = new Set<string>();
  for (const rawExpr of templateExpressions(tpl)) {
    const cleaned = stripCasts(rawExpr);
    for (const id of rootIdents(cleaned)) {
      if (GLOBALS.has(id) || VUE_BUILTINS.has(id) || locals.has(id) || declared.has(id)) continue;
      if (exprLocals(cleaned).has(id)) continue;
      bad.add(id);
    }
  }
  for (const b of bad) problems.push(relative(root, f) + '  模板用了未声明的 ' + b);
}

console.log('扫描 ' + scanned + ' 个 .vue 文件');
ok('确实扫到了文件', scanned >= 10, scanned + ' 个');
ok('模板里没有引用未声明的标识符', problems.length === 0, problems.slice(0, 15).join('\n        '));

console.log('');
console.log('Refs Test: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
