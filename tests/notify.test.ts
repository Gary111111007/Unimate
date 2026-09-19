// 提醒时刻的"过桥契约"测试（PRD 11.19）。
// 真实教训：v2.7 误以为原生把 ISO 串按本地时区解，改成"本地拼串 + 假 Z"，
// 结果每条提醒晚 8 小时才响，用户反馈"到点不弹"。这条测试就是防它复发。
import {
  NATIVE_PARSE_TZ, NATIVE_PATTERN, WIRE_DATE_RE, fakeLocalAt, wireAt
} from '../src/services/notifyWire.ts';

let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? ' -> ' + extra : ''));
}

const tzOffsetMin = -new Date().getTimezoneOffset(); // 东八区 = 480
console.log('运行环境 UTC 偏移：' + tzOffsetMin / 60 + ' 小时');

// 1. 形状：必须是原生 SimpleDateFormat 能解析的 3 位毫秒 + Z
const cases: Date[] = [
  new Date('2026-09-19T02:00:00.000Z'),
  new Date('2026-01-01T00:00:00.000Z'),
  new Date('2026-12-31T23:59:59.999Z'),
  new Date(Date.now() + 60_000),
  new Date(Date.now() + 14 * 24 * 3600 * 1000)
];
for (const d of cases) {
  const s = wireAt(d);
  ok('过桥形状可被原生解析: ' + s, WIRE_DATE_RE.test(s), s);
}

// 2. 语义：按 UTC 解回来必须与原瞬间完全相同（原生 setTimeZone(UTC) 的等价复现）
for (const d of cases) {
  const s = wireAt(d);
  ok('按 ' + NATIVE_PARSE_TZ + ' 解回同一瞬间', new Date(s).getTime() === d.getTime(), s);
}

// 3. 逐字段核对：UTC 字段而非本地字段（防止哪天有人又"顺手"改成本地拼串）
const probe = new Date('2026-03-04T05:06:07.008Z');
const w = wireAt(probe);
ok('串里是 UTC 字段 05:06:07.008', w === '2026-03-04T05:06:07.008Z', w);
ok('模式串与插件源码一致', NATIVE_PATTERN === "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", NATIVE_PATTERN);

// 4. 反证：本地字段 + 假 Z 在非零偏移环境里必然算出别的瞬间
if (tzOffsetMin !== 0) {
  const real = new Date();
  const fake = fakeLocalAt(real);
  const driftH = (new Date(fake).getTime() - real.getTime()) / 3600000;
  ok('假 Z 拼串确实会整体偏移（所以禁止使用）', Math.abs(driftH) >= 1, '偏移 ' + driftH + ' 小时');
  ok('偏移量正好等于时区偏移', Math.abs(Math.abs(driftH) - Math.abs(tzOffsetMin / 60)) < 0.02, driftH + ' vs ' + tzOffsetMin / 60);
  ok('偏移方向：本地拼串被判晚（东八区 +N 小时）', tzOffsetMin > 0 ? driftH > 0 : driftH < 0, driftH + ' 小时');
  console.log('反证：本地拼串 "' + fake + '" 会被原生判为晚 ' + driftH.toFixed(1) + ' 小时触发');
} else {
  console.log('（UTC 环境跳过偏移反证）');
}

// 5. 秒级对齐：提醒不允许出现亚秒抖动导致同一分钟内重复排期
const r = wireAt(new Date(Date.now() + 1234));
ok('毫秒位存在（原生按毫秒解析）', /\.[0-9]{3}Z$/.test(r), r);

console.log('\n结果：' + pass + ' 通过 / ' + fails.length + ' 失败');
for (const f of fails) console.log('  ✗ ' + f);
if (fails.length) process.exit(1);
