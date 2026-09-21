// 学校档案热更新（Net.md P2 / PRD 5.14）测试：**完全不联网** —— 用内存里的"站点"喂 fetch，
// 签名用测试当场生成的临时密钥对，发布包用真实文件 + APK 里硬编码的公钥验。
//
// 这一套的重点是"**验签不过就拒收**"：这是唯一能防住"热更新被投毒成钓鱼入口"的东西。
// 断言分四层：
//   A. 真发布包自检（public/catalog/*）：签名、sha256、域名白名单、篡改必拒
//   B. 纯函数：限频、URL 白名单、清单解析（含路径穿越 / schemaVersion 更高 / 重复 id）
//   C. 服务层行为：拉清单 → 验签 → 下载 → sha256 → 结构校验（用临时密钥 + 内存站点）
//   D. store 接线：拒收、限频、安装/持久化/选择/删除，以及界面结构断言
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as nodeSign } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CATALOG_SCHEMA, catalogCheckAllowed, catalogUrl, mergeSchoolRows, parseCatalogIndex, profileProblem,
  sha256Hex, urlAllowed, verifySignature, fetchCatalog, downloadSchoolProfile
} from '../src/services/schoolCatalog.ts';
import { SCHOOL_CATALOG_PUBKEY } from '../src/catalog/schoolKey.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? ' -> ' + extra : ''));
}
const jsonText = (v: any) => JSON.stringify(v, null, 2) + '\n';
const sha256 = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

// ---------------- A. 真发布包自检 ----------------
console.log('--- 发布包自检（public/catalog） ---');
const packDir = join(root, 'public', 'catalog');
const indexText = read('public/catalog/index.json');
const sigText = read('public/catalog/index.json.sig').trim();
ok('清单与签名文件都在', !!indexText && !!sigText);
ok('签名是 base64url（没有 = 填充）', /^[A-Za-z0-9_-]+$/.test(sigText), sigText.slice(0, 12));
ok('签名是 64 字节（ECDSA P-256 的 r||s）', Buffer.from(sigText, 'base64url').length === 64, String(Buffer.from(sigText, 'base64url').length));
ok('公钥是 65 字节未压缩点（04 开头）—— 太长/太短都不是 P-256 公钥',
  (() => { const p = Buffer.from(SCHOOL_CATALOG_PUBKEY, 'base64url'); return p.length === 65 && p[0] === 4; })(),
  String(Buffer.from(SCHOOL_CATALOG_PUBKEY, 'base64url').length));
{
  const v = await verifySignature(new TextEncoder().encode(indexText), sigText, SCHOOL_CATALOG_PUBKEY);
  ok('清单用 APK 内置公钥验签通过', v === 'ok', v);
  const bad = await verifySignature(new TextEncoder().encode(indexText + ' '), sigText, SCHOOL_CATALOG_PUBKEY);
  ok('清单被改一个字节 → 验签失败（这就是防投毒的那一步）', bad === 'bad-signature', bad);
  const other = generateKeyPairSync('ed25519');
  const otherPub = Buffer.from(other.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)).toString('base64url');
  const forged = await verifySignature(new TextEncoder().encode(indexText), sigText, otherPub);
  ok('换成 Ed25519 公钥 → 长度就不对，直接拒（算法必须一致）', forged === 'bad-signature', forged);
  const otherEc = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const otherEcPub = Buffer.from(otherEc.publicKey.export({ type: 'spki', format: 'der' }).subarray(-65)).toString('base64url');
  const forged2 = await verifySignature(new TextEncoder().encode(indexText), sigText, otherEcPub);
  ok('换成别人的 P-256 公钥（别人自签的清单）→ 失败', forged2 === 'bad-signature', forged2);
  const broken = await verifySignature(new TextEncoder().encode(indexText), 'AAAA', SCHOOL_CATALOG_PUBKEY);
  ok('签名不是合法 base64url → 失败（不抛异常）', broken === 'bad-signature' || broken === 'unsupported', broken);
  const edSig = createHash('sha256').update(indexText).digest('base64url');
  ok('签名长度对不上（拿个哈希冒充签名）→ 失败', (await verifySignature(new TextEncoder().encode(indexText), edSig, SCHOOL_CATALOG_PUBKEY)) !== 'ok');
}
{
  const index = parseCatalogIndex(JSON.parse(indexText));
  ok('清单能解析', !!index && index!.schools.length >= 2, JSON.stringify(index && index.schools.map((s) => s.id)));
  ok('schemaVersion = ' + CATALOG_SCHEMA, index!.schemaVersion === CATALOG_SCHEMA);
  let hashOk = 0, urlOk = 0, liveOnly = 0, versionOk = 0;
  for (const e of index!.schools) {
    const file = join(packDir, e.file);
    ok('档案文件存在：' + e.file, existsSync(file));
    const bytes = readFileSync(file);
    if (sha256(bytes) === e.sha256) hashOk++;
    const p = JSON.parse(bytes.toString('utf8'));
    if (profileProblem(p, e.id) === '') urlOk++;
    if (e.status === 'live') liveOnly++;
    if (Number(p.profileVersion) === e.version) versionOk++;
  }
  ok('每份档案的 sha256 与清单一致', hashOk === index!.schools.length, hashOk + '/' + index!.schools.length);
  ok('每份档案都通过结构 + 域名白名单校验', urlOk === index!.schools.length, urlOk + '/' + index!.schools.length);
  ok('只下发 status=live 的档案（开发中的不出现）', liveOnly === index!.schools.length, liveOnly + '/' + index!.schools.length);
  ok('档案版本与清单版本一致（改了档案忘了 +profileVersion 会被这里抓住）', versionOk === index!.schools.length, String(versionOk));
}
ok('发布目录里没有多余文件（index + sig + 档案）',
  readdirSync(packDir).every((f) => f === 'index.json' || f === 'index.json.sig' || f.endsWith('.json')),
  readdirSync(packDir).join(','));
// 按字节稳定：git 的 autocrlf 一旦把 LF 换成 CRLF，签名清单里的 sha256 就全对不上了
ok('.gitattributes 关掉了下发文件的换行转换（-text）',
  /catalog\/\*\.json -text/.test(read('.gitattributes')) && /public\/catalog\/\* -text/.test(read('.gitattributes')), '');
ok('发布文件里没有 CRLF（按字节稳定）',
  [indexText, sigText, ...readdirSync(packDir).filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => readFileSync(join(packDir, f), 'utf8'))].every((x) => !x.includes('\r\n')), '');
ok('仓库里没有私钥（keys/ 已 gitignore）', !read('.gitignore').includes('!keys') && read('.gitignore').includes('keys/'), '');

// ---------------- B. 纯函数 ----------------
console.log('\n--- 限频：每天最多一次，失败 5 分钟退避 ---');
{
  const now = 1_000_000_000_000;
  ok('从没检查过 → 允许', catalogCheckAllowed({ lastOkAt: 0, lastTryAt: 0, now }) === true);
  ok('刚成功过 → 24 小时内不再检查', catalogCheckAllowed({ lastOkAt: now - 60_000, lastTryAt: now - 60_000, now }) === false);
  ok('成功过但已过 24 小时 → 允许', catalogCheckAllowed({ lastOkAt: now - 24 * 3600_000, lastTryAt: now - 24 * 3600_000, now }) === true);
  ok('刚失败过 → 5 分钟内不重试', catalogCheckAllowed({ lastOkAt: 0, lastTryAt: now - 60_000, now }) === false);
  ok('失败过且过了 5 分钟 → 允许重试', catalogCheckAllowed({ lastOkAt: 0, lastTryAt: now - 5 * 60_000, now }) === true);
  ok('用户手动点「检查更新」→ 无视限频', catalogCheckAllowed({ lastOkAt: now, lastTryAt: now, now, force: true }) === true);
}

console.log('\n--- 域名白名单：只允许 https 且非 IP/localhost ---');
ok('https 正常域名可以', urlAllowed('https://jwglxt.buct.edu.cn/'));
ok('http 不行（明文可被中间人改写）', !urlAllowed('http://jwglxt.buct.edu.cn/'));
ok('javascript: 不行', !urlAllowed('javascript:alert(1)'));
ok('file: 不行', !urlAllowed('file:///etc/passwd'));
ok('IP 直连不行', !urlAllowed('https://10.0.0.8/') && !urlAllowed('https://8.8.8.8/'));
ok('localhost 不行', !urlAllowed('https://localhost:8443/'));
ok('空值 / 乱串不行', !urlAllowed('') && !urlAllowed('随便写的'));

console.log('\n--- 清单解析：写得不对就整份拒收 ---');
{
  const good = { schemaVersion: 1, updatedAt: 'x', schools: [{ id: 'testu', name: '测试大学', shortName: '测试', province: '北京', status: 'live', letter: 'C', order: 9, version: 1, file: 'testu.json', sha256: 'a'.repeat(64), size: 10 }] };
  ok('正常清单能解析', !!parseCatalogIndex(good));
  ok('schemaVersion 比 App 支持的更高 → 拒收（提示升级 App，而不是硬着头皮用）',
    parseCatalogIndex({ ...good, schemaVersion: CATALOG_SCHEMA + 1 }) === null);
  ok('重复 id → 拒收', parseCatalogIndex({ ...good, schools: [good.schools[0], good.schools[0]] }) === null);
  ok('sha256 不是 64 位十六进制 → 拒收', parseCatalogIndex({ ...good, schools: [{ ...good.schools[0], sha256: 'zz' }] }) === null);
  ok('file 里带路径穿越（../../x.json）→ 拒收', parseCatalogIndex({ ...good, schools: [{ ...good.schools[0], file: '../../x.json' }] }) === null);
  ok('status 不是 live/developing → 拒收', parseCatalogIndex({ ...good, schools: [{ ...good.schools[0], status: '支持' }] }) === null);
  ok('schools 不是数组 → 拒收', parseCatalogIndex({ ...good, schools: {} }) === null);
}

console.log('\n--- 档案校验：结构 + 域名 ---');
{
  const p = JSON.parse(read('public/catalog/buct.json'));
  ok('真实档案通过校验', profileProblem(p, 'buct') === '', profileProblem(p, 'buct'));
  ok('schoolId 对不上 → 拒', profileProblem(p, 'other') !== '');
  ok('dataDir 与 schoolId 不一致 → 拒', profileProblem({ ...p, dataDir: 'schools/xxx' }, 'buct') !== '');
  ok('节次表数量与 periodCount 不符 → 拒', profileProblem({ ...p, academic: { ...p.academic, periodCount: 99 } }, 'buct') !== '');
  ok('把某个入口改成 http → 拒', profileProblem({ ...p, campusApps: p.campusApps.map((c: any, i: number) => i === 0 ? { ...c, url: 'http://evil.example.com/' } : c) }, 'buct') !== '');
  ok('profileVersion 缺失 → 拒', profileProblem({ ...p, profileVersion: 0 }, 'buct') !== '');
  ok('不是 live 的档案 → 拒', profileProblem({ ...p, status: 'developing' }, 'buct') !== '');
}

console.log('\n--- 合并成选校页的行：内置 / 可更新 / 可下载 / 已下载 ---');
{
  const builtin = [
    { schoolId: 'buct', name: '北京化工大学', shortName: '北化', province: '北京', status: 'live', letter: 'B', order: 0 },
    { schoolId: 'pku', name: '北京大学', shortName: '北大', province: '北京', status: 'developing', letter: 'B', order: 2 }
  ];
  const versions = { buct: 1 };
  const entry = (id: string, version: number, order: number) => ({
    id, name: id + '大学', shortName: id, province: '北京', status: 'live' as const,
    letter: 'C', order, version, file: id + '.json', sha256: 'a'.repeat(64), size: 1
  });
  const remote = { schemaVersion: 1, updatedAt: 'x', schools: [entry('buct', 1, 0), entry('pku', 1, 2), entry('newu', 1, 60)] };

  const rows = mergeSchoolRows(builtin, versions, remote, {});
  const by = (id: string) => rows.find((r) => r.schoolId === id)!;
  ok('内置 live 可用、且远端版本一样 → 不显示可更新', by('buct').usable && !by('buct').updatable);
  ok('内置 developing 但远端有 live 档案 → 可下载', !by('pku').usable && by('pku').updatable && by('pku').remote);
  ok('远端独有的新高校 → 下载前不可用', !by('newu').usable && by('newu').updatable);
  ok('远端独有的新高校 → 下载后可用，且不再提示可更新', (() => {
    const r2 = mergeSchoolRows(builtin, versions, remote, { newu: 1 });
    const n = r2.find((x) => x.schoolId === 'newu')!;
    return n.usable && n.downloaded && !n.updatable;
  })());
  ok('远端版本更大 → 内置高校显示「可更新」', (() => {
    const r2 = mergeSchoolRows(builtin, versions, { ...remote, schools: [entry('buct', 2, 0)] }, {});
    const b = r2.find((x) => x.schoolId === 'buct')!;
    return b.updatable && b.usable;
  })());
  ok('已下载更高版本后不再提示可更新', (() => {
    const r2 = mergeSchoolRows(builtin, versions, { ...remote, schools: [entry('buct', 2, 0)] }, { buct: 2 });
    const b = r2.find((x) => x.schoolId === 'buct')!;
    return !b.updatable && b.downloaded && b.usable;
  })());
  ok('没有远端清单时 = 内置名单原样（断网降级）', (() => {
    const r2 = mergeSchoolRows(builtin, versions, null, {});
    return r2.length === 2 && r2.every((r) => !r.remote && !r.updatable);
  })());
  ok('行按 order 排序（新高校排在自己给的名次上）', (() => {
    const ids = mergeSchoolRows(builtin, versions, remote, {}).map((r) => r.schoolId);
    return ids[0] === 'buct' && ids[1] === 'pku' && ids[2] === 'newu';
  })(), JSON.stringify(mergeSchoolRows(builtin, versions, remote, {}).map((r) => r.schoolId)));
}

// ---------------- C. 服务层行为（临时密钥 + 内存站点） ----------------
console.log('\n--- 服务层：拉清单 → 验签 → 下载 → 校验和 → 结构 ---');
const { privateKey: testPriv, publicKey: testPub } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const testPubB64 = Buffer.from(testPub.export({ type: 'spki', format: 'der' }).subarray(-65)).toString('base64url');
const signIndex = (text: string) => Buffer.from(nodeSign('sha256', Buffer.from(text, 'utf8'), { key: testPriv, dsaEncoding: 'ieee-p1363' })).toString('base64url') + '\n';
const fixtureProfile: any = JSON.parse(read('public/catalog/buct.json'));
Object.assign(fixtureProfile, {
  schoolId: 'testu', dataDir: 'schools/testu', name: '测试大学', shortName: '测试', profileVersion: 1,
  campusApps: fixtureProfile.campusApps.map((c: any) => ({ ...c, url: 'https://testu.edu.cn/' + c.key })),
  systems: {
    jwglxtUrl: 'https://jwglxt.testu.edu.cn/', timetableUrl: 'https://jwglxt.testu.edu.cn/kb', onlinePlatformUrl: 'https://course.testu.edu.cn/',
    timetableAdapter: 'jwglxt-buct'
  }
});
const fixtureText = jsonText(fixtureProfile);
const fixtureSha = sha256(fixtureText);
const site = new Map<string, string>();
function publishFixture(tamper = false) {
  const body = tamper ? fixtureText.replace('测试大学', '测试大学X') : fixtureText;
  const entry = {
    id: 'testu', name: '测试大学', shortName: '测试', province: '北京', status: 'live', letter: 'C', order: 60,
    version: 1, file: 'testu.json', sha256: fixtureSha, size: Buffer.byteLength(body)
  };
  const index = jsonText({ schemaVersion: 1, updatedAt: '2026-09-21 19:00:00', schools: [entry] });
  site.set('index.json', index);
  site.set('index.json.sig', signIndex(index));
  site.set('testu.json', body);
  return entry;
}
const entry = publishFixture();
const BASE = 'https://pack.test/';
globalThis.fetch = (async (u: any) => {
  const url = String(u);
  if (!url.startsWith(BASE)) return { ok: false, status: 404, text: async () => '' };   // 别的站点 = 断网/404
  const file = url.split('/catalog/')[1] || '';
  if (!site.has(file)) return { ok: false, status: 404, text: async () => '' };
  return { ok: true, status: 200, text: async () => site.get(file)! };
}) as any;

ok('catalogUrl 拼在站点根下', catalogUrl('index.json', BASE) === BASE + 'catalog/index.json', catalogUrl('index.json', BASE));
{
  const good = await fetchCatalog(testPubB64, BASE);
  ok('真清单 + 配对公钥 → 接受', good.ok === true, good.ok ? '' : (good as any).reason);
  const wrong = await fetchCatalog(SCHOOL_CATALOG_PUBKEY, BASE);
  ok('别人自签的清单（公钥不配对）→ 拒收', wrong.ok === false && /签名校验失败/.test((wrong as any).reason), JSON.stringify(wrong));
  const dl = await downloadSchoolProfile(entry, BASE);
  ok('下载档案 → 校验和一致 → 接受', dl.ok === true, dl.ok ? '' : (dl as any).reason);
  if (dl.ok) ok('拿到的是完整档案（节次表在、schoolId 对）', dl.profile.schoolId === 'testu' && dl.profile.academic.periodTimes.length === 12);

  publishFixture(true);   // 把档案改一个字符（模拟"文件被人动过"）
  const bad = await downloadSchoolProfile(entry, BASE);
  ok('档案被改过 → 校验和不一致 → 拒收', bad.ok === false && /校验和不一致/.test((bad as any).reason), JSON.stringify(bad));
  publishFixture(false);
}
ok('sha256Hex 与 node 的 sha256 一致', (await sha256Hex(fixtureText)) === fixtureSha);
ok('断网/404 时返回 ok:false 而不是抛异常', (await fetchCatalog(testPubB64, 'https://empty.test/')).ok === false);

// ---------------- D. store 接线（拒收 / 限频 / 安装 / 持久化 / 删除） ----------------
console.log('\n--- store：拒收、限频、安装、持久化、删回内置 ---');
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear()
};
const ctxStub: any = { fillRect() {}, beginPath() {}, arc() {}, fill() {}, fillText() {}, drawImage() {}, measureText: () => ({ width: 10 }), save() {}, restore() {}, createLinearGradient: () => ({ addColorStop() {} }) };
(globalThis as any).document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub, toDataURL: () => 'data:image/jpeg;base64,AAAA' }),
  addEventListener() {}, documentElement: { style: {} }
};
(globalThis as any).window = globalThis;
(globalThis as any).location = { href: 'https://localhost/', origin: 'https://localhost' };

let fetchCount = 0;
globalThis.fetch = (async (u: any) => {
  fetchCount++;
  const file = String(u).split('/catalog/')[1] || '';
  if (!site.has(file)) return { ok: false, status: 404, text: async () => '' };
  return { ok: true, status: 200, text: async () => site.get(file)! };
}) as any;

const { createPinia, setActivePinia } = await import('pinia');
const dbMod = await import('../src/stores/db.ts');
const fresh = () => { setActivePinia(createPinia()); return dbMod.useDb(); };
{
  const db = fresh();
  ok('默认没有已下载档案', Object.keys(db.downloadedSchools).length === 0);
  ok('默认没有远端清单（只有内置 53 所）', db.catalog.index === null && db.schoolRows.length === 53, String(db.schoolRows.length));
  const before = fetchCount;
  await db.checkCatalog();                 // 站点里是"别人自签"的清单（内置公钥验不过）
  ok('确实发了请求（不是在空跑）', fetchCount > before, String(fetchCount - before));
  ok('验签不过 → 不写进清单（拒收）', db.catalog.index === null);
  ok('拒收有可见文案（不静默）', /签名校验失败/.test(db.catalog.msg), db.catalog.msg);
  const n = fetchCount;
  await db.checkCatalog();
  ok('失败后 5 分钟内不重复请求（限频）', fetchCount === n, String(fetchCount - n));
  await db.checkCatalog(true);
  ok('用户点「检查更新」可以强制重试', fetchCount > n, String(fetchCount - n));
  ok('远端没有这所学校时下载直接被拒', (await db.downloadSchool('nope')) === false);
  ok('没有档案的高校进不去（不能凭空 selectSchool）', (await db.selectSchool('nope', true)) === false);
}
{
  // 模拟"下载成功"之后的安装链路：把一份合格档案塞进 store（下载本身已在上面的服务层测过）
  const db = fresh();
  const profile = JSON.parse(fixtureText);
  db.downloadedSchools['testu'] = { profile, version: 1, sha256: fixtureSha, downloadedAt: '2026-09-21 19:00:00' };
  ok('profileOf 优先用已下载档案', db.profileOf('testu')?.name === '测试大学');
  ok('行里出现"已下载 · 已可使用"的状态', (() => {
    const row = db.schoolRows.find((r) => r.schoolId === 'testu');
    return !!row && row.usable && row.downloaded;
  })());
  ok('下载的高校能被选中并进入主界面', (await db.selectSchool('testu', true)) === true && db.profile?.schoolId === 'testu');
  ok('档案里的节次表生效（不是空档案）', db.settings.periodTimes.length === 12 && db.settings.periodTimes[0].start === '08:00');
  ok('已下载列表里能看到它', db.downloadedList.some((d) => d.schoolId === 'testu' && !d.builtin));
  // 正用着这所高校（内置名单里又没有它）→ 不许直接删：那等于把脚下那份档案抽走
  ok('正在使用的高校（远端独有）不许直接删', (await db.removeDownloaded('testu')) === false && db.profileOf('testu')?.name === '测试大学');
  await db.selectSchool('buct', true);                       // 切回内置高校
  ok('切走之后可以删除', (await db.removeDownloaded('testu')) === true && db.profileOf('testu') === null);
  ok('删除后行里也不再出现（除非远端清单里还有它）', !db.schoolRows.some((r) => r.schoolId === 'testu'));
  ok('删掉的是下载档案，内置档案照常可用', db.profileOf('buct')?.name === '北京化工大学');
}
{
  // 持久化：新 store 走一次 boot()，应从本机文件里读回已下载档案
  const db = fresh();
  const profile = JSON.parse(fixtureText);
  db.downloadedSchools['testu'] = { profile, version: 1, sha256: fixtureSha, downloadedAt: '2026-09-21 19:00:00' };
  await db.selectSchool('testu', true);
  await db.saveDownloaded();                  // 下载成功时 store 就是这么落盘的
  await db.checkCatalog(true);                // 顺带触发清单缓存写盘（真实调用路径）
}
{
  const saved = mem.get('catalog/downloaded-schools.json') || mem.get('CapacitorStorage.catalog/downloaded-schools.json') || '';
  const keys = [...mem.keys()].filter((k) => k.includes('downloaded-schools'));
  ok('已下载档案真的落盘了（能找到那条记录）', keys.length > 0 && (mem.get(keys[0]) || '').includes('testu'), keys.join(','));
  const cacheKeys = [...mem.keys()].filter((k) => k.includes('catalog-cache'));
  ok('清单缓存也落盘了（含 lastTryAt，重启后不会反复请求）', cacheKeys.length > 0, cacheKeys.join(',')); 
}
{
  const db = fresh();
  await db.boot();
  ok('重启后仍认得已下载的高校（不会被丢回选校页）', db.profileOf('testu')?.name === '测试大学', JSON.stringify(Object.keys(db.downloadedSchools)));
  ok('重启后限频状态也在（今天不会再拉一次）', db.catalog.lastTryAt > 0, String(db.catalog.lastTryAt));
}
if (existsSync(join(root, 'keys', 'school-signing.key'))) {
  console.log('\n--- 本机有签名私钥：把"真发布包"也走一遍完整下载链路 ---');
  const realIndexText = read('public/catalog/index.json');
  const realIndex = parseCatalogIndex(JSON.parse(realIndexText))!;
  const realSite = new Map<string, string>();
  realSite.set('index.json', realIndexText);
  realSite.set('index.json.sig', read('public/catalog/index.json.sig'));
  for (const e of realIndex.schools) realSite.set(e.file, read('public/catalog/' + e.file));
  globalThis.fetch = (async (u: any) => {
    const f = String(u).split('/catalog/')[1] || '';
    return realSite.has(f) ? { ok: true, text: async () => realSite.get(f)! } : { ok: false, text: async () => '' };
  }) as any;
  const got = await fetchCatalog(SCHOOL_CATALOG_PUBKEY, BASE);
  ok('真发布包用内置公钥能过（keygen → sign → 贴公钥 这条链是通的）', got.ok === true, got.ok ? '' : (got as any).reason);
  const dl = await downloadSchoolProfile(realIndex.schools[0], BASE);
  ok('真发布包里的档案能下载并通过全部校验', dl.ok === true, dl.ok ? '' : (dl as any).reason);
} else {
  console.log('\n（本机没有 keys/school-signing.key，跳过"真发布包下载链路"这一组；发布包自检在上面已跑过）');
}

// ---------------- E. 结构断言 ----------------
console.log('\n--- 结构：界面只走 store，验签没有后门 ---');
{
  const picker = read('src/screens/SchoolPicker.vue');
  const svc = read('src/services/schoolCatalog.ts');
  const dbSrc = read('src/stores/db.ts');
  ok('打开选校页会检查一次（不是 force，受每天一次限制）', /onMounted\(\(\) => \{ void db\.checkCatalog\(\); \}\)/.test(picker), '');
  ok('「检查更新」按钮走 force', /db\.checkCatalog\(true\)/.test(picker), '');
  ok('删除已下载档案前走 db.confirm', /async function dropDownloaded[\s\S]{0,400}db\.confirm\(/.test(picker), '');
  ok('选校页显示三种徽标（已下载 / 可更新 / 可下载）', /已下载 · 已可使用/.test(picker) && /可更新/.test(picker) && /可下载/.test(picker), '');
  ok('结构断言保持：只有 order=0 写"首个落地高校"', /s\.order === 0 \? '首个落地高校 · 已可使用' : '已可使用'/.test(picker), '');
  ok('服务层没有"跳过验签"的分支', !/skipVerify|noVerify|insecure/i.test(svc), '');
  ok('验签不在 ok 状态就返回失败（不往下走）', /if \(v !== 'ok'\) return \{ ok: false/.test(svc), '');
  ok('取档案统一走 profileOf（界面不直接调 profileFor）', !/profileFor\(/.test(picker) && /function profileOf/.test(dbSrc), '');
  ok('所有界面文件都没有直接调 fetchCatalog/downloadSchoolProfile', (() => {
    const files: string[] = [];
    for (const d of ['src/views', 'src/components', 'src/screens']) {
      for (const f of readdirSync(join(root, d))) if (f.endsWith('.vue')) files.push(d + '/' + f);
    }
    return files.every((f) => !/fetchCatalog\(|downloadSchoolProfile\(/.test(read(f)));
  })(), '');
  ok('私钥文件名只出现在脚本与文档里（不进前端源码）', !/school-signing\.key/.test(read('src/stores/db.ts')), '');
  // 新增联网行为 → 「关于/隐私」与登录页必须同步（Net.md 安全清单里那条"文案一致"）
  const mev = read('src/views/MeView.vue');
  const loginVue = read('src/screens/Login.vue');
  ok('关于页写明了档案检查的范围与"不上传"', /高校档案更新/.test(mev) && /不上传任何信息/.test(mev) && /每天最多检查一次/.test(mev), '');
  ok('关于页写明了下发内容要验签、验签不过不安装', /Ed25519/.test(mev) && /验签不过一律不安装/.test(mev), '');
  ok('登录页也提到了档案检查（不能只写"唯一的联网是天气"）', /高校档案检查/.test(loginVue), '');
  ok('不再声称"App 不联网"这类与实现不符的话', !/不联网、不上传/.test(loginVue), '');
}

console.log('\n结果：' + pass + ' 通过 / ' + fails.length + ' 失败');
for (const f of fails) console.log('  ✗ ' + f);
if (fails.length) process.exit(1);
