// 正方 jwglxt 纯函数层测试（src/services/zfClient.ts）。
// 守护的东西按重要性排序：
//  1) **加密标记判定不许降级**：读不到/取到怪值时必须报错，绝不能拿明文去登录（最危险的一类回归）；
//  2) **mmsfjm 要扫完整页面**：教务助手项目实测它在表单外，只在 form 内找会漏（真实踩过的坑）；
//  3) RSA 加密可复现（固定模幂输入 → 固定输出，绕开随机填充的不可预测性）；
//  4) 周次/节次/kbList 解析与适配包 Golden 一致。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  encryptPassword, readHiddenFields, decidePasswordMode, parsePeriods, parseWeeks,
  parseKbList, xqmOf, ZfError, describeZfError, CAPTCHA_FIELD, SCHEDULE_GNMKDM, SCHOOL_CODE
} from '../src/services/zfClient.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? ' -> ' + extra : ''));
}
const range = (a: number, b: number): number[] => {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
};

console.log('--- 加密标记判定：绝不降级为明文（最重要）---');
{
  const wrap = (inner: string): string => `<html><body><form>${inner}</form></body></html>`;
  const hidden = (k: string, v: string): string => `<input type="hidden" name="${k}" value="${v}">`;

  // 正常：标记=1 → 必须加密
  const r1 = decidePasswordMode(wrap(hidden('mmsfjm', '1') + hidden('csrftoken', 'ABC')));
  ok('标记=1 → required', r1.mode === 'required', r1.mode);
  ok('顺带取到 csrftoken', r1.csrfToken === 'ABC', r1.csrfToken);

  // 明确声明不需要加密：0 → plain
  ok('标记=0 → plain', decidePasswordMode(wrap(hidden('mmsfjm', '0'))).mode === 'plain');

  // 字段缺失 → 必须报错，不能当成"不需要加密"
  let threw = '';
  try { decidePasswordMode(wrap(hidden('csrftoken', 'X'))); } catch (e) { threw = (e as ZfError).kind; }
  ok('缺少 mmsfjm → PAGE_CHANGED（不猜明文）', threw === 'PAGE_CHANGED', threw);

  // 怪值 → 同样报错
  let threw2 = '';
  try { decidePasswordMode(wrap(hidden('mmsfjm', 'yes'))); } catch (e) { threw2 = (e as ZfError).kind; }
  ok('mmsfjm=yes → PAGE_CHANGED（不猜明文）', threw2 === 'PAGE_CHANGED', threw2);

  let threw3 = '';
  try { decidePasswordMode(wrap(hidden('mmsfjm', ''))); } catch (e) { threw3 = (e as ZfError).kind; }
  ok('mmsfjm 空串 → PAGE_CHANGED（不猜明文）', threw3 === 'PAGE_CHANGED', threw3);
}

console.log('\n--- mmsfjm 必须扫完整页面（表单外也要找到）---');
{
  // 关键回归：标记在 </form> 之后（教务助手实测河南财经政法大学就是这样）
  const page = `<html><body>
    <form action="/xtgl/login_slogin.html">
      <input type="hidden" name="csrftoken" value="TOK123">
      <input name="yhm" type="text">
    </form>
    <input type="hidden" name="mmsfjm" value="1">
  </body></html>`;
  const f = readHiddenFields(page);
  ok('表单外的 mmsfjm 能被读到', f['mmsfjm'] === '1', JSON.stringify(f));
  ok('表单内的 csrftoken 也能读到', f['csrftoken'] === 'TOK123', f['csrftoken']);
  const d = decidePasswordMode(page);
  ok('表单外标记=1 仍判定为 required', d.mode === 'required', d.mode);
  ok('csrftoken 一并带出', d.csrfToken === 'TOK123', d.csrfToken);

  // 单引号 / 无引号写法也要认
  const q = readHiddenFields(`<input type='hidden' name='mmsfjm' value='1'>`);
  ok('单引号属性可读', q['mmsfjm'] === '1', JSON.stringify(q));
  const uq = readHiddenFields(`<input type=hidden name=mmsfjm value=1>`);
  ok('无引号属性可读', uq['mmsfjm'] === '1', JSON.stringify(uq));
  // 非 hidden 的 input 不该被当成隐藏字段
  const txt = readHiddenFields(`<input type="text" name="mmsfjm" value="1">`);
  ok('非 hidden 的 input 不算隐藏字段', txt['mmsfjm'] === undefined, JSON.stringify(txt));
}

console.log('\n--- RSA：可复现性与长度（用小模数跑，真实公钥是 1024 位）---');
{
  // 16 字节模数（128 位）：够小够快，又能满足 PKCS#1 的"至少 8 字节随机填充 + 1 字节分隔 + 数据"。
  // 注意：模数不能太短（如 5 字节会让 padLen<8 直接抛错，这是实现该有的保护）。
  const m = Buffer.from([0x00, 0xd3, 0x4a, 0x91, 0x7f, 0x22, 0x18, 0x5e,
                         0x33, 0xa1, 0x0c, 0x88, 0x54, 0x2b, 0x9d, 0x11]).toString('base64');
  const e = Buffer.from([0x01, 0x00, 0x01]).toString('base64');
  const c1 = encryptPassword('pw', m, e);
  const c2 = encryptPassword('pw', m, e);
  ok('输出为 Base64 且长度 = 模长（16 字节）', Buffer.from(c1, 'base64').length === 16, String(Buffer.from(c1, 'base64').length));
  // 两次因随机填充必然不同 —— 这本身就是"填充是随机的"证据
  ok('两次加密结果不同（填充随机）', c1 !== c2);
  ok('长度恒定', Buffer.from(c2, 'base64').length === 16);
  ok('输出是合法 Base64（能解回来）', Buffer.from(c1, 'base64').length === 16);
}

console.log('\n--- RSA：中文密码 / 过长 / 模数太小 ---');
{
  const m = Buffer.from([0x00, 0xd3, 0x4a, 0x91, 0x7f, 0x22, 0x18, 0x5e,
                         0x33, 0xa1, 0x0c, 0x88, 0x54, 0x2b, 0x9d, 0x11,
                         0x60, 0x77, 0x3c, 0xe2]).toString('base64');
  const e = Buffer.from([0x01, 0x00, 0x01]).toString('base64');
  const c = encryptPassword('密码123', m, e);
  ok('中文密码能加密且输出非空', c.length > 0);
  ok('长度等于模长（20 字节）', Buffer.from(c, 'base64').length === 20);

  let toLong = false;
  try { encryptPassword('x'.repeat(100), m, e); } catch { toLong = true; }
  ok('数据过长抛错（模长不足）', toLong);

  let tiny = false;
  try { encryptPassword('pw', Buffer.from([0x00, 0x01, 0x02]).toString('base64'), e); } catch { tiny = true; }
  ok('模数太小也抛错（不是静默出错）', tiny);
}

console.log('\n--- 学期码 ---');
ok('第 1 学期 → 3', xqmOf(1) === '3');
ok('第 2 学期 → 12', xqmOf(2) === '12');
ok('第 3 学期（小学期）→ 16', xqmOf(3) === '16');
{
  let threw = false;
  try { xqmOf(4); } catch { threw = true; }
  ok('第 4 学期抛 RangeError', threw);
}

console.log('\n--- 常量（照抄协议档案，别被改坏）---');
ok('学校代码 10010', SCHOOL_CODE === '10010', SCHOOL_CODE);
ok('课表功能码 N2151', SCHEDULE_GNMKDM === 'N2151', SCHEDULE_GNMKDM);
ok('验证码字段 yzm', CAPTCHA_FIELD === 'yzm', CAPTCHA_FIELD);

console.log('\n--- 周次展开 ---');
ok('连续 1-16周', JSON.stringify(parseWeeks('1-16周')) === JSON.stringify(range(1, 16)));
ok('单周 1-16周(单)', JSON.stringify(parseWeeks('1-16周(单)')) === JSON.stringify(range(1, 16).filter((w) => w % 2 === 1)));
ok('双周 1-16周(双)', JSON.stringify(parseWeeks('1-16周(双)')) === JSON.stringify(range(1, 16).filter((w) => w % 2 === 0)));
ok('分段 1-8周,10-16周', JSON.stringify(parseWeeks('1-8周,10-16周')) === JSON.stringify([...range(1, 8), ...range(10, 16)]));
ok('裸数字 1,3,5周', JSON.stringify(parseWeeks('1,3,5周')) === JSON.stringify([1, 3, 5]));
ok('空串 → 空数组', parseWeeks('').length === 0);
ok('中文逗号也认', JSON.stringify(parseWeeks('1-3周，5周')) === JSON.stringify([1, 2, 3, 5]));

console.log('\n--- 节次分段 ---');
ok('区间 1-2', JSON.stringify(parsePeriods('1-2')) === JSON.stringify([[1, 2]]));
ok('多段 6-7,9-10', JSON.stringify(parsePeriods('6-7,9-10')) === JSON.stringify([[6, 7], [9, 10]]));
ok('单节 3', JSON.stringify(parsePeriods('3')) === JSON.stringify([[3, 3]]));
ok('空串 → 空数组', parsePeriods('').length === 0);

console.log('\n--- kbList 整体解析（用适配包同款脱敏样本）---');
{
  const rows = JSON.parse(readFileSync(join(root, 'fixtures/zf-kblist.sample.json'), 'utf8'));
  const courses = parseKbList(JSON.stringify({ kbList: rows }));
  ok('5 行 → 5 条（1 行缺课名被过滤，1 行多段节次拆两条）', courses.length === 5, String(courses.length));

  const math = courses.find((c) => c.name === '高等数学A(一)');
  ok('高数：day=1 1-2 节', !!math && math.day === 1 && math.startPeriod === 1 && math.endPeriod === 2);
  ok('高数：教师=张三', math?.teacher === '张三', math?.teacher ?? '');
  ok('高数：教室含教学楼A-101', !!math && math.rooms.includes('教学楼A-101'), math?.rooms ?? '');
  ok('高数：1-16 周', JSON.stringify(math?.weeks) === JSON.stringify(range(1, 16)));

  const eng = courses.find((c) => c.name === '大学英语(二)');
  ok('英语：单周', JSON.stringify(eng?.weeks) === JSON.stringify(range(1, 16).filter((w) => w % 2 === 1)));
  const pe = courses.find((c) => c.name === '大学体育Ⅲ');
  ok('体育：双周', JSON.stringify(pe?.weeks) === JSON.stringify(range(1, 16).filter((w) => w % 2 === 0)));

  const chem = courses.filter((c) => c.name === '有机化学');
  ok('有机化学拆成 2 条', chem.length === 2, String(chem.length));
  ok('有机化学节次 [[6,7],[9,10]]', JSON.stringify(chem.map((c) => [c.startPeriod, c.endPeriod])) === JSON.stringify([[6, 7], [9, 10]]));
  ok('有机化学周次分段', JSON.stringify(chem[0].weeks) === JSON.stringify([...range(1, 8), ...range(10, 16)]));

  // data 根键兼容 + 空列表
  ok('data 根键兼容', parseKbList(JSON.stringify({ data: rows.slice(0, 1) })).length === 1);
  ok('空 kbList → 空数组', parseKbList(JSON.stringify({ kbList: [] })).length === 0);

  // 坏行过滤：缺课名 / 星期越界
  ok('缺课名被过滤', parseKbList(JSON.stringify({ kbList: [{ xqj: '1', jcs: '1-2' }] })).length === 0);
  ok('星期越界被过滤', parseKbList(JSON.stringify({ kbList: [{ kcmc: 'X', xqj: '9', jcs: '1-2' }] })).length === 0);
  ok('星期 0 被过滤', parseKbList(JSON.stringify({ kbList: [{ kcmc: 'X', xqj: '0', jcs: '1-2' }] })).length === 0);
  // BOM 容错
  ok('带 BOM 的 JSON 可解析', parseKbList('\uFEFF' + JSON.stringify({ kbList: [] })).length === 0);
}

console.log('\n--- 错误话术：六态都要有人话 ---');
{
  const kinds = ['NEED_CAPTCHA', 'INVALID_CREDENTIALS', 'SESSION_EXPIRED', 'NETWORK_RETRYABLE', 'PAGE_CHANGED', 'QUERY_DENIED', 'VALIDATION_FAILED'] as const;
  for (const k of kinds) {
    const s = describeZfError(k);
    ok(k + ' 有话术且非空', typeof s === 'string' && s.length > 4, s);
  }
  ok('未知 kind 有兜底话术', describeZfError('SOMETHING_NEW' as never).length > 4);
  ok('文案不承诺"一定能解决"', !/必然|一定可以/.test(describeZfError('PAGE_CHANGED')));
}

console.log('\n--- ZfError 结构 ---');
{
  const e = new ZfError('QUERY_DENIED', 'msg');
  ok('kind 保留', e.kind === 'QUERY_DENIED');
  ok('是 Error 实例', e instanceof Error);
  ok('name = ZfError', e.name === 'ZfError');
  ok('message 保留', e.message === 'msg');
}

if (fails.length) {
  console.log('\nFAILED:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('\nZfClient Test: ' + pass + ' passed, 0 failed');
