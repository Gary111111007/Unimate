// CSS 变量定义检查（本轮真机事故的教训之一）。
// 有 31 处在用 var(--soft) / var(--field) 等，但 styles.css 里从来没定义过它们：
// 浏览器对未定义变量的处理是"这条声明作废"，于是暗色下输入框没底色、面板是透明 ——
// 构建、类型检查、单测全都看不见。这里补一道静态检查。
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files: string[] = [];
(function walk(d: string): void {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const f = join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.(vue|css|html)$/.test(e.name)) files.push(f);
  }
})(root);
// 顺带看 index.html，内联样式也可能定义变量
const extra = join(root, '..', 'index.html');
try { if (readFileSync(extra, 'utf8')) files.push(extra); } catch { /* 忽略 */ }

const used = new Map<string, string[]>();
const defined = new Set<string>();

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const rel = relative(root, f);
  for (const m of src.matchAll(/var\(\s*(--[\w-]+)/g)) {
    const arr = used.get(m[1]) || [];
    if (!arr.includes(rel)) arr.push(rel);
    used.set(m[1], arr);
  }
  for (const m of src.matchAll(/(^|[\s{;])(--[\w-]+)\s*:/g)) defined.add(m[2]);
}

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

const missing: string[] = [];
for (const [name, where] of used) {
  if (!defined.has(name)) missing.push(name + '  ← ' + where.slice(0, 4).join(', ') + (where.length > 4 ? ' 等' : ''));
}
console.log('用了 ' + used.size + ' 个自定义属性，定义了 ' + defined.size + ' 个');
ok('确实扫到 var() 用法', used.size >= 10, used.size + ' 个');
ok('没有未定义的 CSS 变量', missing.length === 0, missing.join('\n        '));

// 暗色必须覆盖的关键变量都在两套主题里定义过（少一个就会有一块白）
for (const key of ['--bg', '--card', '--text', '--muted', '--line', '--soft', '--soft-2', '--field', '--tint', '--strong']) {
  ok('暗色块里定义了 ' + key, new RegExp('\\[data-theme=.dark.\\][\\s\\S]*?' + key.replace(/-/g, '\\-') + '\\s*:').test(files.map((f) => readFileSync(f, 'utf8')).join('\n')));
}

console.log('');
console.log('CSS Test: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
