// 手册条款目录完整性测试（需求："不要用简化版的，把每一条都写上"）。
// 条号必须连续覆盖 5~49，且每条都要有原文、板块、节次；id 不许重复。
import { FILLABLE, HANDBOOK, chapterIntro, clauseById, clauseLabel, clauseNo, clausesOf } from '../src/catalog/handbook.ts';
import { SECOND_CLASS_BLOCKS } from '../src/catalog/secondClass.ts';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : '')); }
}

ok('条款总数 = 45（第五~第四十九条）', HANDBOOK.length === 45, HANDBOOK.length + ' 条');
ok('可填写条款 = 40（扣掉 5 条章导语）', FILLABLE.length === 40, FILLABLE.length + ' 条');

const nums = HANDBOOK.map((c) => c.no).sort((a, b) => a - b);
let gap = '';
for (let n = 5; n <= 49; n++) { if (nums.indexOf(n) < 0) { gap = String(n); break; } }
ok('条号 5~49 连续无缺', gap === '', '缺第' + gap + '条');

const ids = new Set(HANDBOOK.map((c) => c.id));
ok('id 不重复', ids.size === HANDBOOK.length, ids.size + ' 个');
ok('每条都有原文且不是占位', HANDBOOK.every((c) => (c.text || '').length >= 20));
ok('每条原文都带句读（不是半截句子）', HANDBOOK.every((c) => /[。；]$/.test(c.text.trim())));
ok('每条都有板块与节次', HANDBOOK.every((c) => !!c.block && (c.stage === 'basic' || c.stage === 'extended')));
ok('非导语条款都有短标题', FILLABLE.every((c) => (c.title || '').length >= 2));

for (const b of SECOND_CLASS_BLOCKS) {
  const list = clausesOf(b.key as any);
  ok(b.name + ' 板块有可填条款', list.length >= 4, list.length + ' 条');
  ok(b.name + ' 板块有章导语', !!chapterIntro(b.key as any));
}

// 分值预设必须落在手册给的范围内
let badOpt = '';
for (const c of FILLABLE) {
  for (const o of c.options || []) {
    // 预设可以是"多次累计"（如第七条五次封顶 50 分），所以只要求非负、不超过该条上限
    if (!(o.score >= 0)) { badOpt = c.id + ' ' + o.label + '=' + o.score; break; }
    if (typeof c.cap === 'number' && o.score > c.cap) { badOpt = c.id + ' 预设 ' + o.score + ' 超过上限 ' + c.cap; break; }
  }
  if (badOpt) break;
}
ok('预设分值都在合理范围内', badOpt === '', badOpt);

// 竞赛类条款必须展开成"奖项 × 级别"的完整预设（这三条最容易只写一句话）
for (const id of ['zhi-20', 'ti-27', 'mei-34']) {
  const c = clauseById(id);
  ok(id + ' 有完整分值表预设', !!c && (c.options || []).length >= 20, c ? (c.options || []).length + ' 项' : '缺失');
}
ok('条款文案形如"第X条 · 标题"', clauseLabel(FILLABLE[0]).startsWith('第') && clauseNo(FILLABLE[0]).endsWith('条'), clauseLabel(FILLABLE[0]));

console.log('');
console.log('Handbook Test: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
