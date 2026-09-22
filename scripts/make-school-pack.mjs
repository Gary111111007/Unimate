/**
 * 学校档案下发包工具（Net.md P2）。
 *
 *   node --experimental-strip-types scripts/make-school-pack.mjs keygen   # 只做一次：生成签名密钥对
 *   node --experimental-strip-types scripts/make-school-pack.mjs export   # 从内置 TS 档案导出 catalog/*.json
 *   node --experimental-strip-types scripts/make-school-pack.mjs sign     # 生成并签名 public/catalog/index.json
 *   node --experimental-strip-types scripts/make-school-pack.mjs          # = export + sign（默认）
 *
 * 三条必须记住的规矩：
 *  1) 私钥 `keys/school-signing.key` **绝不入库、绝不外发**（.gitignore 已挡）。丢了就重新 keygen 一套、
 *     把新公钥写回 `src/catalog/schoolKey.ts`；但**旧 APK 会认为新签名无效** —— 真上线时按 Net.md 3.3
 *     把私钥放进 CI secrets，别只放在开发机上。
 *  2) 只下发 **status = live** 的档案：没核实过的高校绝不能出现在下发清单里（AGENTS.md 第 4 条：
 *     不得写成已支持）。
 *  3) 档案里的域名只允许 **https**：签约渠道下发的是"App 会打开的网址"，http / IP / 奇怪 scheme
 *     就是现成的钓鱼入口。
 *
 * 签名方案：**Ed25519**（Net.md 2.3 原本的写法）：签名 64 字节、公钥 32 字节。
 * 客户端**用纯 JS 验签**（@noble/ed25519），不依赖 WebCrypto —— 因为实测安卓 WebView 的实现差异
 * 会让平台密码学在部分机型上整体不可用（真机截图："当前系统的 WebCrypto 用不了 ECDSA 验签"）。
 */
import { createHash, createPublicKey, generateKeyPairSync, sign as nodeSign, verify as nodeVerify } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'catalog');            // 源档案（人写 + 从 TS 导出）
const outDir = join(root, 'public', 'catalog');  // 随 npm run build 进 dist，由静态站托管
const adapterSrcDir = join(root, 'adapters');            // 源规则包（Net.md P2.5，只在教务改版时新增/修改）
const adapterOutDir = join(root, 'public', 'adapters');  // 规则包下发产物
const keyFile = join(root, 'keys', 'school-signing.key');
const keySource = join(root, 'src', 'catalog', 'schoolKey.ts');
const SCHEMA = 1;

/** 统一写文件：UTF-8 无 BOM、LF、末尾一个换行 —— 客户端是**按字节**验签与算 sha256 的，格式必须稳定 */
function writeText(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text.replace(/\r\n/g, '\n'), 'utf8');
}
const jsonText = (v) => JSON.stringify(v, null, 2) + '\n';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** 下发域名的唯一白名单规则：https + 不能是 IP/localhost */
function urlProblem(u, where) {
  let url;
  try { url = new URL(String(u)); } catch { return where + ' 不是合法网址：' + u; }
  if (url.protocol !== 'https:') return where + ' 必须是 https（当前 ' + url.protocol + '）：' + u;
  const host = url.hostname;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':') || /^(localhost|127\.|0\.0\.0\.0)/i.test(host)) {
    return where + ' 不允许用 IP/localhost：' + host;
  }
  return '';
}

function checkProfile(p) {
  const bad = [];
  if (!p || typeof p !== 'object') return ['档案不是对象'];
  if (!/^[a-z][a-z0-9-]{1,15}$/.test(String(p.schoolId || ''))) bad.push('schoolId 只允许小写字母数字与连字符');
  if (p.dataDir !== 'schools/' + p.schoolId) bad.push('dataDir 必须是 schools/<schoolId>（当前 ' + p.dataDir + '）');
  if (typeof p.profileVersion !== 'number' || !(p.profileVersion >= 1)) bad.push('profileVersion 必须是 >=1 的整数');
  if (p.status !== 'live') bad.push('status 不是 live —— 没核实过的档案不许下发');
  if (!p.name || !p.shortName || !p.province) bad.push('缺 name/shortName/province');
  if (!p.academic || !Array.isArray(p.academic.periodTimes) || p.academic.periodTimes.length !== p.academic.periodCount) {
    bad.push('academic.periodTimes 与 periodCount 对不上');
  }
  const urls = [
    ['systems.jwglxtUrl', p.systems && p.systems.jwglxtUrl],
    ['systems.timetableUrl', p.systems && p.systems.timetableUrl],
    ['systems.onlinePlatformUrl', p.systems && p.systems.onlinePlatformUrl]
  ];
  for (const c of (p.campusApps || [])) urls.push(['campusApps[' + c.key + ']', c.url]);
  for (const pair of urls) {
    if (!pair[1]) { bad.push(pair[0] + ' 为空'); continue; }
    const prob = urlProblem(pair[1], pair[0]);
    if (prob) bad.push(prob);
  }
  if (!p.watermark || !p.watermark.schoolBadgeText) bad.push('缺 watermark.schoolBadgeText');
  return bad;
}

/** 从 src/catalog/universities.ts 导出 APK 内置档案；云端独有档案直接维护在 catalog/*.json。 */
async function exportBuiltin() {
  const mod = await import('../src/catalog/universities.ts');
  const names = [];
  for (const id of ['buct']) {
    const p = mod.profileFor(id);
    if (!p) continue;
    writeText(join(srcDir, id + '.json'), jsonText(p));
    names.push(id);
  }
  console.log('已从内置 TS 档案导出：' + names.join(', '));
  return names;
}

function loadSources() {
  const files = readdirSync(srcDir).filter((f) => f.endsWith('.json') && f !== 'index.json');
  const out = [];
  for (const f of files) {
    const raw = readFileSync(join(srcDir, f), 'utf8');
    let p;
    try { p = JSON.parse(raw); } catch (e) { throw new Error(f + ' 不是合法 JSON：' + e.message); }
    const bad = checkProfile(p);
    if (bad.length) throw new Error(f + ' 不合格：\n  - ' + bad.join('\n  - '));
    if (f !== p.schoolId + '.json') throw new Error(f + ' 的文件名必须是 <schoolId>.json');
    out.push({ file: f, profile: p });
  }
  // 排序先按内置名单里的名次，未收录的（新高校）按 id 稳定排序
  const order = { buct: 0, bisu: 3 };
  out.sort((a, b) => {
    const oa = Object.prototype.hasOwnProperty.call(order, a.profile.schoolId) ? order[a.profile.schoolId] : 900;
    const ob = Object.prototype.hasOwnProperty.call(order, b.profile.schoolId) ? order[b.profile.schoolId] : 900;
    return oa - ob || a.profile.schoolId.localeCompare(b.profile.schoolId);
  });
  return out;
}

/**
 * 规则包源文件（Net.md P2.5）：`adapters/<adapterId>.json`。
 * 目录可以不存在/为空 —— 那就只下发学校档案（这是常态：教务没改版就不需要规则包）。
 * 校验口径与客户端 `validateRulePack()` 一致：键白名单 + 正则可编译 + 取值范围。
 */
function loadAdapters() {
  if (!existsSync(adapterSrcDir)) return [];
  const files = readdirSync(adapterSrcDir).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    let p;
    try { p = JSON.parse(readFileSync(join(adapterSrcDir, f), 'utf8')); } catch (e) { throw new Error(f + ' 不是合法 JSON：' + e.message); }
    const bad = checkAdapterPack(p);
    if (bad.length) throw new Error(f + ' 不合格：\n  - ' + bad.join('\n  - '));
    if (f !== p.adapterId + '.json') throw new Error(f + ' 的文件名必须是 <adapterId>.json');
    out.push({ file: f, pack: p });
  }
  out.sort((a, b) => a.pack.adapterId.localeCompare(b.pack.adapterId));
  return out;
}

/** 规则包自检（与客户端 rules.ts 的白名单保持一致的**最小**子集；客户端还会再查一遍） */
function checkAdapterPack(p) {
  const bad = [];
  if (!p || typeof p !== 'object') return ['不是对象'];
  if (p.kind !== 'timetable' && p.kind !== 'exam') bad.push('kind 必须是 timetable 或 exam');
  if (!/^[a-z][a-z0-9-]{2,31}$/.test(String(p.adapterId || ''))) bad.push('adapterId 不合法');
  if (!(Number(p.version) >= 1)) bad.push('version 必须是 >=1 的整数');
  if (!(Number(p.schemaVersion) >= 1) || Number(p.schemaVersion) > 1) bad.push('schemaVersion 必须是 1');
  if (!p.rules || typeof p.rules !== 'object' || Array.isArray(p.rules)) bad.push('缺 rules 对象');
  // 规则包里**不允许**出现任何像代码的东西（这是 Net.md 2.4 的红线，脚本这边先挡一道）
  const raw = JSON.stringify(p.rules || {});
  if (/\b(eval|Function|import|require|setTimeout|setInterval)\b/.test(raw)) bad.push('规则里出现了可执行代码的字样（本机制只允许声明式规则）');
  return bad;
}

function readPubKey() {
  try {
    const m = readFileSync(keySource, 'utf8').match(/'([A-Za-z0-9_-]{40,})'/);
    return m ? m[1] : '';
  } catch { return ''; }
}

function keygen() {
  if (existsSync(keyFile)) {
    console.error('已经存在 ' + keyFile + '，不覆盖（要换密钥就先把旧文件挪走）。');
    process.exit(1);
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  writeText(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  // SPKI 末尾 32 字节 = Ed25519 原始公钥（客户端就是拿这 32 字节验签）
  const rawPub = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const pubB64 = Buffer.from(rawPub).toString('base64url');
  console.log('私钥已写入：' + keyFile + '（已 gitignore，别外发）');
  console.log('公钥（base64url，贴进 ' + keySource + '）：');
  console.log('  ' + pubB64);
}

function signPack() {
  if (!existsSync(keyFile)) {
    console.error('缺少私钥 ' + keyFile + '：先跑 `keygen`（或把 CI secrets 里的私钥放回这个路径）。');
    process.exit(1);
  }
  const sources = loadSources();
  const adapters = loadAdapters();
  const entries = [];
  const outFiles = new Map();
  for (const item of sources) {
    const text = jsonText(item.profile);
    const bytes = Buffer.from(text, 'utf8');
    outFiles.set(item.file, text);
    entries.push({
      id: item.profile.schoolId,
      name: item.profile.name,
      shortName: item.profile.shortName,
      province: item.profile.province,
      status: item.profile.status,
      letter: item.profile.letter || item.profile.name.slice(0, 1),
      order: typeof item.profile.order === 'number' ? item.profile.order : 900,
      version: item.profile.profileVersion,
      file: item.file,
      sha256: sha256(bytes),
      size: bytes.length
    });
  }
  const index = {
    schemaVersion: SCHEMA,
    updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    schools: entries,
    // 解析规则包与学校档案共用这一份签名清单：客户端只需验一次签、也只受同一套每天一次的限频
    adapters: adapters.map((a) => {
      const text = jsonText(a.pack);
      const bytes = Buffer.from(text, 'utf8');
      outFiles.set('adapters/' + a.file, { dir: adapterOutDir, text });
      return {
        id: a.pack.adapterId, kind: a.pack.kind, version: Number(a.pack.version),
        file: a.file, sha256: sha256(bytes), size: bytes.length, note: String(a.pack.note || '')
      };
    })
  };
  const indexText = jsonText(index);
  // Ed25519 是"无摘要"签名算法（内部自带哈希），Node 侧直接传 null 作为 digest
  const sig = nodeSign(null, Buffer.from(indexText, 'utf8'), readFileSync(keyFile, 'utf8'));
  const sigText = Buffer.from(sig).toString('base64url') + '\n';

  for (const pair of outFiles) {
    const v = pair[1];
    if (v && typeof v === 'object' && v.dir) writeText(join(v.dir, pair[0].replace(/^adapters\//, '')), v.text);
    else writeText(join(outDir, pair[0]), v);
  }
  writeText(join(outDir, 'index.json'), indexText);
  writeText(join(outDir, 'index.json.sig'), sigText);

  // 自检：① 私钥推导出的公钥必须与 schoolKey.ts 里那串一致；② 签出来的签名必须能验过
  const pub = readPubKey();
  if (!pub) {
    console.log('提示：' + keySource + ' 里还没写公钥，先 keygen 再贴进去。');
  } else {
    const derived = Buffer.from(createPublicKey(readFileSync(keyFile, 'utf8')).export({ type: 'spki', format: 'der' }).subarray(-32)).toString('base64url');
    if (derived !== pub) {
      console.error('*** 自检失败：' + keySource + ' 里的公钥不是这把私钥对应的那个，别上传！ ***');
      process.exit(1);
    }
    const ok = nodeVerify(null, Buffer.from(indexText, 'utf8'), readFileSync(keyFile, 'utf8'), Buffer.from(sigText.trim(), 'base64url'));
    console.log('自检（公钥配对 + 签名可验）：' + (ok ? '通过' : '*** 失败，别上传！ ***'));
    if (!ok) process.exit(1);
  }
  console.log('已生成 ' + outDir + '：index.json + index.json.sig + ' + entries.length + ' 份档案');
  for (const e of entries) console.log('  ' + e.file + '  v' + e.version + '  ' + e.sha256.slice(0, 12) + '…  ' + e.size + ' B');
  console.log('规则包：' + (index.adapters.length ? '' : '（无 —— 教务没改版时这是正常的）'));
  for (const a of index.adapters) console.log('  adapters/' + a.file + '  ' + a.kind + ' v' + a.version + '  ' + a.sha256.slice(0, 12) + '…  ' + a.size + ' B');
}

const cmd = process.argv[2] || 'pack';
if (cmd === 'keygen') keygen();
else if (cmd === 'export') { await exportBuiltin(); }
else if (cmd === 'sign') { signPack(); }
else if (cmd === 'pack') { await exportBuiltin(); signPack(); }
else { console.error('用法：keygen | export | sign | pack（默认 pack）'); process.exit(1); }
