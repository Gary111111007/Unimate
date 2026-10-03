// 教务系统识别测试（src/catalog/jwSystems.ts）。
// 这个模块负责在选校页回答"这所学校用的是什么教务系统"。
// 守三件事：
//  1) **只标确定的**：没查证过的学校必须落到 unknown，不许猜（AGENTS.md 硬规则 6）；
//  2) **可导入 = 真做过适配的**：目前只有正方一个 importable，别的厂商一律 false；
//  3) **判定优先级**：档案声明的适配器 > 内置映射表（下载了新档案就该以档案为准）。
import { identifyVendor, vendorFromAdapter, vendorInfo, isImportable } from '../src/catalog/jwSystems.ts';
import { SCHOOLS } from '../src/catalog/universities.ts';

let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? ' -> ' + extra : ''));
}

console.log('--- 适配器 ID → 厂商 ---');
ok('jwglxt-buct → 正方', vendorFromAdapter('jwglxt-buct') === 'zf');
ok('裸 jwglxt → 正方', vendorFromAdapter('jwglxt') === 'zf');
ok('jwweb-xxx → 正方老版', vendorFromAdapter('jwweb-xxx') === 'zf-old');
ok('qz-xxx → 强智', vendorFromAdapter('qz-xxx') === 'qz');
ok('urp-xxx → URP', vendorFromAdapter('urp-xxx') === 'urp');
ok('空串认不出来', vendorFromAdapter('') === null);
ok('不认识的适配器返回 null（不猜）', vendorFromAdapter('some-random-adapter') === null);
ok('大小写不敏感', vendorFromAdapter('JWGLXT-BUCT') === 'zf');

console.log('\n--- 识别：档案声明优先 ---');
// 北化：内置表与档案都指向正方，结果一致
ok('北化 → 正方', identifyVendor('buct').id === 'zf');
ok('北化带档案声明也是正方', identifyVendor('buct', 'jwglxt-buct').id === 'zf');
// 关键：某校内置表没有、但档案声明了适配器 → 以档案为准
ok('未登记的学校，档案说是正方 → 正方', identifyVendor('pku', 'jwglxt-pku').id === 'zf');
ok('未登记的学校，档案说是强智 → 强智', identifyVendor('pku', 'qz-pku').id === 'qz');
// 档案声明一个认不出的适配器 → 回落到内置表/unknown，而不是乱标
ok('档案声明不认识 → 未登记学校回落到待识别', identifyVendor('pku', 'weird-thing').id === 'unknown');

console.log('\n--- 识别：不做猜测 ---');
ok('未登记的学校 → 待识别', identifyVendor('thu').id === 'unknown');
ok('空 schoolId → 待识别', identifyVendor('').id === 'unknown');
ok('未知 id 取详情回落 unknown', vendorInfo('nope' as never).id === 'unknown');

console.log('\n--- 可导入能力 ---');
ok('只有正方可导入', isImportable('zf') === true && isImportable('zf-old') === false
  && isImportable('qz') === false && isImportable('urp') === false && isImportable('unknown') === false);
ok('正方老版明确不可导入（页面结构不同）', vendorInfo('zf-old').importable === false);
ok('每个厂商都有 label 与 desc', (['zf', 'zf-old', 'qz', 'urp', 'unknown'] as const)
  .every((id) => vendorInfo(id).label.length > 0 && vendorInfo(id).desc.length > 0));

console.log('\n--- 名单一致性（防止"表里标了但名单没有"）---');
const ids = new Set(SCHOOLS.map((s) => s.schoolId));
ok('识别表覆盖的学校都在名单里', identifyVendor('buct').id === 'zf' && ids.has('buct'));
ok('名单里除北化外一律不是"可导入"（诚实：除北化外都还没真机跑通）',
  SCHOOLS.filter((s) => s.schoolId !== 'buct').every((s) => identifyVendor(s.schoolId).id === 'unknown'));

console.log('\n--- 文案不越界 ---');
ok('待识别文案明说"不做猜测"', /不做猜测|尚未确认/.test(vendorInfo('unknown').desc));
ok('强智文案明说"暂未适配"', /暂未适配/.test(vendorInfo('qz').desc));
ok('正方文案明说"已做好适配"', /已做好/.test(vendorInfo('zf').desc));

if (fails.length) {
  console.log('\nFAILED:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('\nJwSystems Test: ' + pass + ' passed, 0 failed');
