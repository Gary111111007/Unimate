// 用法: node scripts/check-provider.mjs
// 读 ~/.codex/config.toml，报告"现在 Codex 到底连的是谁"，并用配置里的 Key 真发一次 /responses。
// 用途：用 cc-switch 切到 DeepSeek 之后，跑一遍这条命令就知道是配置没写进去、Key 不对、还是模型名不对。
// 注意：本脚本只读配置，不改任何文件；输出的 Key 一律打码。
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = process.env.CODEX_HOME || join(homedir(), '.codex');
const cfgPath = join(HOME, 'config.toml');
if (!existsSync(cfgPath)) { console.log('找不到 ' + cfgPath); process.exit(1); }
const raw = readFileSync(cfgPath, 'utf8');

const pick = (re) => { const m = raw.match(re); return m ? m[1] : ''; };
const model = pick(/^model\s*=\s*"([^"]+)"/m);
const providerName = pick(/^\s*name\s*=\s*"([^"]+)"/m);
const baseUrl = pick(/^base_url\s*=\s*"([^"]+)"/m);
const wireApi = pick(/^wire_api\s*=\s*"([^"]+)"/m);
const effort = pick(/^model_reasoning_effort\s*=\s*"([^"]+)"/m);
const token = pick(/^experimental_bearer_token\s*=\s*"([^"]+)"/m);
const catalogFile = pick(/^model_catalog_json\s*=\s*"([^"]+)"/m);
const respStorageOff = /^disable_response_storage\s*=\s*true/m.test(raw);

const mask = (s) => (s ? s.slice(0, 6) + '…' + s.slice(-4) + '（len ' + s.length + '）' : '（空）');
console.log('配置文件      : ' + cfgPath);
console.log('服务商名      : ' + (providerName || '(未读到，可能是官方登录态)'));
console.log('base_url      : ' + (baseUrl || '(空)'));
console.log('wire_api      : ' + (wireApi || '(空)'));
console.log('当前 model    : ' + (model || '(空)'));
console.log('reasoning 档位: ' + (effort || '(未设)'));
console.log('不落库历史    : ' + (respStorageOff ? 'true（第三方必须，已开）' : '未开 ← 第三方服务商要开 disable_response_storage'));
console.log('Key           : ' + mask(token));

if (catalogFile) {
  try {
    const cat = JSON.parse(readFileSync(join(HOME, catalogFile), 'utf8'));
    const ids = (cat.models || []).map((m) => m.slug || m.model);
    console.log('可选模型      : ' + ids.join(' / '));
    const cur = (cat.models || []).find((m) => (m.slug || m.model) === model);
    if (!cur) console.log('警告: model="' + model + '" 不在目录里，界面上可能选不到');
    else {
      const lv = (cur.supported_reasoning_levels || []).map((x) => x.effort);
      if (effort && lv.length && !lv.includes(effort)) console.log('警告: reasoning=' + effort + ' 不被该模型支持，支持 ' + lv.join('/'));
    }
  } catch (e) { console.log('目录读取失败: ' + e.message); }
}

// ---- preview 模式：不切换、不写文件，直接拿 cc-switch 里存着的某个服务商试一次 ----
// 用法: node scripts/check-provider.mjs preview            （列出 cc-switch 里所有 Codex 服务商）
//       node scripts/check-provider.mjs preview DeepSeek    （用 DeepSeek 那条的配置实测，等于"预演切换"）
if (process.argv[2] === 'preview') {
  const { DatabaseSync } = await import('node:sqlite');
  const dbPath = join(homedir(), '.cc-switch', 'cc-switch.db');
  if (!existsSync(dbPath)) { console.log('找不到 ' + dbPath); process.exit(1); }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare("select id,name,settings_config,is_current from providers where app_type='codex'").all();
  const want = (process.argv[3] || '').trim();
  if (!want) {
    console.log('cc-switch 里的 Codex 服务商（* = 当前生效）：');
    for (const r of rows) {
      if (r.name === 'default' || r.name === 'OpenAI Official') continue;
      let cfg = '';
      try { cfg = JSON.parse(r.settings_config).config || ''; } catch { /* ignore */ }
      const m = cfg.match(/model\s*=\s*"([^"]+)"/);
      const u = cfg.match(/base_url\s*=\s*"([^"]+)"/);
      console.log((r.is_current ? '  * ' : '    ') + r.name + '  model=' + (m ? m[1] : '?') + '  base_url=' + (u ? u[1] : '?'));
    }
    console.log('\n预演某一条: node scripts/check-provider.mjs preview DeepSeek');
    process.exit(0);
  }
  const hit = rows.find((r) => r.name.toLowerCase() === want.toLowerCase());
  if (!hit) { console.log('cc-switch 里没有叫 ' + want + ' 的 Codex 服务商'); process.exit(1); }
  const sc = JSON.parse(hit.settings_config);
  const key = (sc.auth && sc.auth.OPENAI_API_KEY) || '';
  const u = (sc.config.match(/base_url\s*=\s*"([^"]+)"/) || [])[1] || '';
  const m = (sc.config.match(/model\s*=\s*"([^"]+)"/) || [])[1] || '';
  console.log('预演 ' + hit.name + ' → ' + u + '/responses  model=' + m + '  Key=' + mask(key));
  try {
    const r = await fetch(u.replace(/\/+$/, '') + '/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: m, input: [{ role: 'user', content: '只回复两个字：正常' }], stream: false, store: false, reasoning: { effort: 'high' }, service_tier: 'default', parallel_tool_calls: true, tools: [{ type: 'function', name: 'shell', description: 'x', parameters: { type: 'object', properties: {} } }] })
    });
    const t = await r.text();
    console.log(r.ok ? 'HTTP ' + r.status + ' 通 ← 切过去就能用' : 'HTTP ' + r.status + ' 不通: ' + t.replace(/\s+/g, ' ').slice(0, 300));
  } catch (e) { console.log('请求失败: ' + e.message + '（网络/代理问题，不是配置问题）'); }
  db.close();
  process.exit(0);
}

if (!baseUrl || !token) { console.log('\n缺少 base_url 或 Key，跳过联网实测。'); process.exit(0); }
const url = baseUrl.replace(/\/+$/, '') + (wireApi === 'responses' ? '/responses' : '/chat/completions');
const body = wireApi === 'responses'
  ? { model, input: [{ role: 'user', content: '只回复两个字：正常' }], stream: false, store: false }
  : { model, messages: [{ role: 'user', content: '只回复两个字：正常' }], stream: false };
console.log('\n实测 ' + url);
const t0 = Date.now();
try {
  const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const txt = await r.text();
  const ms = Date.now() - t0;
  if (r.ok) {
    let said = '';
    try { const j = JSON.parse(txt); said = wireApi === 'responses' ? JSON.stringify(j.output || '').slice(0, 120) : JSON.stringify(j.choices || '').slice(0, 120); } catch { /* ignore */ }
    console.log('HTTP ' + r.status + ' · ' + ms + 'ms · 通 ← 这个服务商现在可用');
    if (said) console.log('回包片段: ' + said);
  } else {
    console.log('HTTP ' + r.status + ' · ' + ms + 'ms · 不通');
    console.log('错误: ' + txt.replace(/\s+/g, ' ').slice(0, 300));
    if (r.status === 401) console.log('→ 多半是 Key 没保存或已失效');
    if (r.status === 404) console.log('→ 多半是 base_url 路径不对，或该服务商不支持 ' + wireApi);
    if (/model|not found|invalid/i.test(txt) && r.status === 400) console.log('→ 多半是 model 名不对，换成上面"可选模型"里的一个');
  }
} catch (e) { console.log('请求失败: ' + e.message + '（网络/代理问题）'); }
