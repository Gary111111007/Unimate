// 登录链路回归测试（PRD 10.8 质量红线："不得出现按钮点了没反应"）
// 运行：npm run test:login
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
const fsMod = await import('node:fs');
const fixture = fsMod.readFileSync(new URL('../fixtures/jwglxt-buct.sample.html', import.meta.url), 'utf8');
(globalThis as any).fetch = async (u: any) => ({ ok: true, text: async () => (String(u).includes('sample-timetable') ? fixture : '{}') });

const { createPinia, setActivePinia } = await import('pinia');
const store = await import('../src/stores/db.ts');

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : '')); }
};
const fresh = () => { setActivePinia(createPinia()); return store.useDb(); };

console.log('--- 先登录、再选学校 ---');
let db = fresh();
await db.ensureDemoAccount();
ok('演示账号已建立', db.accounts.some((a) => a.username === 'admin' && a.isDemo));
ok('演示账号登录返回 true', (await db.login('admin', 'buct')) === true, db.lastError);
ok('未绑定高校时先进学校选择页', db.screen === 'school', 'screen=' + db.screen);
ok('选校返回 true 且档案就绪', (await db.selectSchool('buct')) === true && db.profile?.name === '北京化工大学');
ok('选校后进入主界面', db.screen === 'app', 'screen=' + db.screen);
ok('演示课表已填充 25 条', db.courses.length === 25, 'courses=' + db.courses.length);
ok('演示记事 >= 5 条', db.notes.length >= 5, 'notes=' + db.notes.length);
ok('演示二课记录 = 5 条', db.records.length === 5, 'records=' + db.records.length);
ok('登录过程无错误', db.lastError === '', db.lastError);
db.logout();
ok('退出后回到登录页', db.screen === 'login');
await db.login('admin', 'buct');
ok('同一账号再次登录直接进主界面（高校已绑定）', db.screen === 'app', 'screen=' + db.screen);
ok('再次登录数据仍在', db.courses.length === 25, 'courses=' + db.courses.length);

console.log('--- 新建本地账号并登录 ---');
db = fresh();
await db.selectSchool('buct');
ok('创建账号返回 true', (await db.register('2025040999', 'abc123', '智小汇')) === true, db.lastError);
const r2 = await db.login('2025040999', 'abc123');
ok('新账号登录返回 true', r2 === true, db.lastError);
ok('新账号先进学校选择页', db.screen === 'school', 'screen=' + db.screen);
await db.selectSchool('buct');
ok('选校后进入主界面', db.screen === 'app', 'screen=' + db.screen);
ok('新账号数据与演示账号隔离（无课表）', db.courses.length === 0, 'courses=' + db.courses.length);

ok('全新启动落在登录页而非选校页（先登录后选校）', fresh().screen === 'login');
console.log('--- 错误口令与未注册口令 ---');
db = fresh();
await db.selectSchool('buct');
await db.ensureDemoAccount();
ok('密码错误返回 false', (await db.login('admin', 'wrong')) === false);
// 产品口径：先登录账号，再选学校。所以未登录时任何时刻都不该停在选校页。
ok('密码错误时 screen 仍为 login', db.screen === 'login');
ok('未登录时 selectSchool 不会把界面切进主界面', db.screen !== 'app');
ok('密码错误给出提示文案', db.toast.includes('用户名或密码错误'), db.toast);
ok('不存在的用户名返回 false 且提示', (await db.login('nobody', 'x12345')) === false && db.toast.includes('该用户名在本机不存在'), db.toast);

console.log('--- 关键回归：存储抛错也不能把人锁在登录页外 ---');
db = fresh();
await db.selectSchool('buct');
await db.ensureDemoAccount();
const origSet = (globalThis as any).localStorage.setItem;
let threw = false;
(globalThis as any).localStorage.setItem = (k: string, v: string) => {
  if (!threw && String(k).includes('accounts.json')) { threw = true; throw new Error('模拟磁盘写入失败'); }
  origSet(k, v);
};
const r3 = await db.login('admin', 'buct');
(globalThis as any).localStorage.setItem = origSet;
ok('写入抛错时登录不崩溃且流程可继续', r3 === true && (db.screen === 'app' || db.screen === 'school'), 'r3=' + r3 + ' screen=' + db.screen);
await db.selectSchool('buct');
ok('异常后仍能选校进入主界面', db.screen === 'app', 'screen=' + db.screen);
ok('写入抛错被记录为可见错误', db.lastError.length > 0 || db.toast.length > 0, 'lastError=' + db.lastError);
ok('模拟确实触发过异常', threw === true);

console.log('');
console.log(`Login Test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);