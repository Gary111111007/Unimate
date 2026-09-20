// Codex 会话历史里"半截工具调用"检查/修复工具（只动 ~/.codex/sessions 下的 rollout jsonl）
//
// 为什么要它：DeepSeek 严格校验历史，只要有一个 function_call 没有配对的 function_call_output，
// 就回 400 "No tool output found for tool call xxx"（实测；切换模型时打断正在跑的工具调用就会留下这种半截调用）。
// 修法：给每个半截调用补一条输出，内容是"该工具调用被中断，未执行"。
//
// 用法：
//   node scripts/fix-codex-history.mjs                 只扫描并报告（不写任何东西）
//   node scripts/fix-codex-history.mjs --all           扫描最近 3 天的全部会话
//   node scripts/fix-codex-history.mjs --file <路径>   指定单个 rollout
//   node scripts/fix-codex-history.mjs --write         真正修复（自动备份 .bak-时间戳）
//
// 安全：默认拒绝修改 60 秒内还在被写入的文件（说明那条会话正活着，改了也会被内存版覆盖）。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const argv = process.argv.slice(2);
const has = (k) => argv.includes(k);
const val = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };
const write = has('--write');
const root = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');

function listFiles() {
  const one = val('--file');
  if (one) return [path.resolve(one)];
  const days = has('--all') ? 3 : 1;
  const out = [];
  const now = Date.now();
  for (const d of fs.readdirSync(root)) {
    const dir = path.join(root, d);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const sub of fs.readdirSync(dir)) {
      const f = path.join(dir, sub);
      const st = fs.statSync(f);
      if (!sub.endsWith('.jsonl')) continue;
      if (!has('--all') && now - st.mtimeMs > days * 86400000) continue;
      out.push(f);
    }
  }
  return out.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs).slice(0, has('--all') ? 200 : 20);
}

function scan(f) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  const trailingBlank = lines[lines.length - 1] === '';
  const body = lines.filter((l) => l.trim() !== '');
  const outs = new Set();
  const parsed = body.map((l, i) => {
    let o = null;
    try { o = JSON.parse(l); } catch { return { i, o: null, raw: l }; }
    const p = o && o.payload ? o.payload : o;
    if (p && (p.type === 'function_call_output' || p.type === 'custom_tool_call_output')) outs.add(p.call_id);
    return { i, o, p };
  });
  const dangling = [];
  for (const x of parsed) {
    const p = x.p;
    if (!p) continue;
    if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      if (p.call_id && !outs.has(p.call_id)) dangling.push({ line: x.i, id: p.call_id, name: p.name || p.type });
    }
  }
  return { parsed, dangling, body, trailingBlank };
}

let touched = 0, total = 0;
for (const f of listFiles()) {
  const st = fs.statSync(f);
  const r = scan(f);
  total += r.dangling.length;
  if (!r.dangling.length) continue;
  touched++;
  const fresh = Date.now() - st.mtimeMs < 60000;
  console.log((fresh ? '[活跃,跳过] ' : '[半截调用] ') + path.basename(f));
  for (const d of r.dangling) console.log('    line ' + (d.line + 1) + '  ' + d.name + '  ' + d.id);
  if (!write) continue;
  if (fresh && !has('--force')) { console.log('    这条会话 60 秒内还在写；先完全退出 Codex 桌面版再修（或加 --force）'); continue; }
  const outLines = r.body.map((l) => l);
  for (const d of r.dangling.slice().reverse()) {
    const call = JSON.parse(outLines[d.line]);
    const patched = {
      timestamp: call.timestamp,
      type: 'response_item',
      payload: { type: 'function_call_output', call_id: d.id, output: '该工具调用在切换模型/中断时被打断，未执行，不要重试它。' }
    };
    outLines.splice(d.line + 1, 0, JSON.stringify(patched));
  }
  const bak = f + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(f, bak);
  const tmp = f + '.fixing';
  fs.writeFileSync(tmp, outLines.join('\n') + '\n');
  fs.renameSync(tmp, f);
  console.log('    已补 ' + r.dangling.length + ' 条配对输出，原件备份为 ' + path.basename(bak));
}
console.log('\n扫描完成：' + (total ? '共 ' + total + ' 个半截工具调用（涉及 ' + touched + ' 条会话）' : '没有发现半截工具调用')
  + (write ? '' : '；当前是只读扫描，加 --write 才会修改'));