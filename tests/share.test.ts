// 课表分享（PRD 5.12）编解码 Golden Test。
// 要点：① 往返一致；② **够小**（二维码放不下就白做了）；③ 坏数据不能崩；④ 不会混入教师姓名。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encodeTimetable, encodeTimetableV2, encodeShare, decodeTimetable, weeksToBits, bitsToWeeks, payloadFromHash, buildShareUrl, shareBase, shareHost, PUBLIC_SHARE_BASE, weeksText, type SharedTimetable } from '../src/services/share.ts';
import { canEncodeQr, qrSvg, QR_MAX_BYTES } from '../src/services/qr.ts';
import { parseJwglxtTimetable } from '../src/services/parser/jwglxtBuct.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? ' -> ' + extra : ''));
}

console.log('--- 周次位图 ---');
ok('1-16 周往返一致', bitsToWeeks(weeksToBits([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])).length === 16, '');
ok('稀疏周次（1,4,7,13）往返一致', JSON.stringify(bitsToWeeks(weeksToBits([1, 4, 7, 13]))) === '[1,4,7,13]', JSON.stringify(bitsToWeeks(weeksToBits([1, 4, 7, 13]))));
ok('空周次不炸', bitsToWeeks(weeksToBits([])).length === 0);
ok('非位图字符串不产生假周次（"!!"、空串、超长都拒掉）',
  bitsToWeeks('!!').length === 0 && bitsToWeeks('').length === 0 && bitsToWeeks('0'.repeat(20)).length === 0);
ok('位图很短（36 进制）', weeksToBits([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]).length <= 5, weeksToBits([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]));

console.log('\n--- 用真实的脱敏课表样本做往返 ---');
const html = readFileSync(join(root, 'fixtures', 'jwglxt-buct.sample.html'), 'utf8');
const parsed = parseJwglxtTimetable(html);
const real: SharedTimetable = {
  name: '北京化工大学 2026-2027-1', semesterStart: '2026-08-31', totalWeeks: 18,
  courses: parsed.courses.map((c) => ({ name: c.name, day: c.day, startPeriod: c.startPeriod, endPeriod: c.endPeriod, weeks: c.weeks, room: c.room }))
};
ok('样本解析出 25 个时段', real.courses.length === 25, String(real.courses.length));
const payload = encodeTimetable(real);
const back = decodeTimetable(payload)!;
ok('解码成功', !!back);
ok('课表名/首周/总周数一致', back.name === real.name && back.semesterStart === real.semesterStart && back.totalWeeks === real.totalWeeks, JSON.stringify(back && [back.name, back.semesterStart, back.totalWeeks]));
ok('时段数量一致', back.courses.length === real.courses.length, String(back.courses.length));
ok('逐条字段一致（课程名/教室/星期/节次/周次）', real.courses.every((c, i) => {
  const b = back.courses[i];
  return b.name === c.name && b.room === c.room && b.day === c.day && b.startPeriod === c.startPeriod && b.endPeriod === c.endPeriod && JSON.stringify(b.weeks) === JSON.stringify(c.weeks);
}), JSON.stringify(real.courses[0]) + ' vs ' + JSON.stringify(back.courses[0]));
ok('payload 是 URL 安全字符（base64url）', /^[A-Za-z0-9\-_]+$/.test(payload), payload.slice(0, 40));
{
  /* v2 二进制编码（v2.23）：更小、QR 版本更低。教室信息必须保留。 */
  const p2 = encodeShare(real);
  ok('v2 payload 比 v1 更短（压缩生效）', p2.length < payload.length, 'v2=' + p2.length + ' v1=' + payload.length);
  ok('v2 payload 是 URL 安全字符', /^[A-Za-z0-9\-_]+$/.test(p2), p2.slice(0, 40));
  const back2 = decodeTimetable(p2);
  ok('v2 解码成功', !!back2);
  if (back2) {
    ok('v2 课表名/首周/总周数一致', back2.name === real.name && back2.semesterStart === real.semesterStart && back2.totalWeeks === real.totalWeeks, JSON.stringify([back2.name, back2.semesterStart, back2.totalWeeks]));
    ok('v2 时段数量一致', back2.courses.length === real.courses.length, String(back2.courses.length));
    ok('v2 逐条字段一致（含教室）', real.courses.every((cc, i) => {
      const b = back2.courses[i];
      return b.name === cc.name && b.room === cc.room && b.day === cc.day && b.startPeriod === cc.startPeriod && b.endPeriod === cc.endPeriod && JSON.stringify(b.weeks) === JSON.stringify(cc.weeks);
    }), JSON.stringify(back2.courses[0]));
    ok('v2 教室不是空的（教室必须保留）', back2.courses.some((cc) => cc.room.length > 0), 'rooms=' + back2.courses.filter((cc) => cc.room).length);
  }
  /* v1 向后兼容：用旧格式编码的链接，新代码也要能解 */
  const back1 = decodeTimetable(payload);
  ok('v1 旧格式仍可解码（向后兼容）', !!back1 && back1.courses.length === real.courses.length, back1 ? String(back1.courses.length) : 'null');
}
{
  // 分享是"给同学看课表"，不该把教师姓名一并带出去 —— 结构上就没有字段，原文里也不该出现
  const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const raw = new TextDecoder().decode(Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (ch) => ch.charCodeAt(0)));
  const teacher = (parsed.courses[0].teacher || '').trim();
  ok('分享结构里没有教师字段', !Object.prototype.hasOwnProperty.call(back.courses[0], 'teacher'), Object.keys(back.courses[0]).join(','));
  ok('分享原文里不含教师姓名', !teacher || !raw.includes(teacher), '教师=' + teacher);
}

console.log('\n--- 能不能塞进二维码（这是关键）---');
{
  const url = buildShareUrl(encodeShare(real), 'https://unimate3.pages.dev/');
  ok('链接格式正确', /^https:\/\/unimate3\.pages\.dev\/#s=[A-Za-z0-9\-_]+$/.test(url), url.slice(0, 60));
  /*
   * 真机截图暴露的严重问题：APK 里 location.origin 是 Capacitor 的虚拟域名 https://localhost，
   * 直接拿它拼链接，发出去别人根本打不开。所以本地/虚拟域名必须回退到公网演示站。
   */
  ok('APK 里的 https://localhost 会被换成公网演示站', buildShareUrl('ABC', 'https://localhost/').startsWith(PUBLIC_SHARE_BASE + '#s='), buildShareUrl('ABC', 'https://localhost/'));
  ok('127.0.0.1 调试地址同样会换掉', shareBase('http://127.0.0.1:5178/#x') === PUBLIC_SHARE_BASE, shareBase('http://127.0.0.1:5178/#x'));
  ok('真正的公网地址原样保留', shareBase('https://unimate3.pages.dev/index.html') === 'https://unimate3.pages.dev/index.html', shareBase('https://unimate3.pages.dev/index.html'));
  ok('面板能显示分享站点域名', shareHost('https://localhost/') === 'unimate3.pages.dev', shareHost('https://localhost/'));
  ok('链接长度远小于二维码上限 ' + QR_MAX_BYTES + ' 字节', new TextEncoder().encode(url).length < QR_MAX_BYTES,
    new TextEncoder().encode(url).length + ' 字节');
  ok('本机生成的二维码可用', canEncodeQr(url) && qrSvg(url).startsWith('<svg'));
  const svg = qrSvg(url, 240);
  ok('SVG 里有模块（不是空白图）', svg.length > 2000 && svg.includes('<path'), String(svg.length));
  /*
   * 真机反馈过"二维码显示不全"：第一版在 viewBox 已是模块单位的情况下又套了一层 scale()，
   * 二维码被画到框外、右下被裁。这条断言直接量几何：所有模块坐标必须落在 viewBox 内。
   */
  {
    const vb = Number((svg.match(/viewBox="0 0 (\d+) \d+"/) || [, '0'])[1]);
    const coords = [...svg.matchAll(/M(\d+) (\d+)/g)].map((m) => Math.max(Number(m[1]), Number(m[2])));
    const maxC = coords.length ? Math.max(...coords) : -1;
    ok('二维码所有模块都落在 viewBox 内（不会被裁掉）', vb > 0 && maxC >= 0 && maxC < vb, 'viewBox=' + vb + ' maxCoord=' + maxC);
    ok('没有多余的缩放变换（缩放由 width/height 负责）', !/transform=/.test(svg), '');
    ok('留了静默区（四周各 4 个模块）', vb >= 21 + 8 - 1, String(vb));
  }
  ok('超长内容不会硬画（返回空串，由界面降级为只给链接）', qrSvg('x'.repeat(QR_MAX_BYTES + 100)) === '', '');
}

console.log('\n--- 坏数据与边界 ---');
ok('乱码 → null', decodeTimetable('这不是base64') === null);
ok('空串 → null', decodeTimetable('') === null);
ok('合法 base64 但不是课表 → null', decodeTimetable(btoa('hello world')) === null);
ok('只有版本号没有课程 → null', decodeTimetable(btoa('U1\u001fX\u001f2026-09-01\u001f18\u001f\u001f\u001f')) === null);
ok('#s= 能取出来', payloadFromHash('#s=' + payload) === payload);
ok('带别的参数也能取', payloadFromHash('#foo=1&s=' + payload) === payload);
ok('没有 s 参数时返回空', payloadFromHash('#other=1') === '');
ok('周次文案可读', weeksText([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) === '1-16周' && weeksText([1, 4, 7]) === '1,4,7周', weeksText([1, 4, 7]));

console.log('\n--- 界面接线（结构断言：光有编解码、没接上也没用）---');
{
  const app = readFileSync(join(root, 'src', 'App.vue'), 'utf8');
  ok('启动时读 #s= 并解码', app.includes('payloadFromHash(location.hash)') && app.includes('decodeTimetable(p)'), '');
  ok('命中分享链接时渲染只读页', /<ShareView v-if="shared"/.test(app), '');
  ok('分享链接进来时不进登录/主界面', /v-if="!shared && splashDone && db\.booted"/.test(app), '');
  ok('分享链接进来时不显示开屏', /<transition v-else name="splash">/.test(app), '');
}
{
  const tv = readFileSync(join(root, 'src', 'views', 'TimetableView.vue'), 'utf8');
  ok('工具箱里有"分享这张课表"', tv.includes('分享这张课表'), '');
  ok('分享面板会画二维码', tv.includes('qrSvg(') && tv.includes('v-html="shareQr"'), '');
  ok('二维码放不下时有降级文案', /二维码放不下/.test(tv), '');
  ok('分享面板明确写"不上传服务器"', /不会上传到任何服务器/.test(tv), '');
  ok('分享面板明确写"不含教师姓名"', /不含教师姓名/.test(tv), '');
  ok('分享链接可一键复制', tv.includes('copyShareLink()'), '');
}
{
  const login = readFileSync(join(root, 'src', 'screens', 'Login.vue'), 'utf8');
  ok('网页版登录页有"演示站"交代', /演示站<\/b>：数据只存在你这台设备的浏览器里/.test(login), '');
  ok('只有网页版才显示这条（APK 里不显示）', /const isWeb = !isNativeWebView\(\)/.test(login), '');
}

console.log('\n结果：' + pass + ' 通过 / ' + fails.length + ' 失败');
for (const f of fails) console.log('  ✗ ' + f);
if (fails.length) process.exit(1);
