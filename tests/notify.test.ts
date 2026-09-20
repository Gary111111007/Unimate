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

/*
 * 6. 静态契约：通知渠道与点击路由（v2.14 真机反馈"提醒还是不响"）。
 * 这一段不跑插件，只守住 4 个曾经写错、且错了也"构建全绿"的字段。
 */
const fsMod = await import('node:fs');
const pathMod = await import('node:path');
const urlMod = await import('node:url');
const root = pathMod.join(pathMod.dirname(urlMod.fileURLToPath(import.meta.url)), '..');
const notifySrc = fsMod.readFileSync(pathMod.join(root, 'src', 'services', 'notify.ts'), 'utf8');
const cfgSrc = fsMod.readFileSync(pathMod.join(root, 'capacitor.config.ts'), 'utf8');
/**
 * 注释里提旧字段名不算"还在用"（这几条断言本来就是靠注释解释踩坑历史的），
 * 所以先剥掉注释再查字段。`[^:]` 前缀是为了不误伤 https:// 里的双斜杠。
 */
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const code = stripComments(notifySrc);

// 6.1 渠道键名：插件只认 channelId（NotificationChannelManager / buildNotification），
//     写 notificationChannelId 会被静默忽略，通知全部落到 importance=3 的默认渠道：
//     没有横幅、没有声音 —— 用户看到的就是"到点了什么都没弹"。
ok('不再使用插件不认的 notificationChannelId', !code.includes('notificationChannelId'), 'notify.ts 里仍有该字段');
ok('排期用插件真正读的 channelId', (code.match(/channelId:\s*'(class|todo)-' \+ CHANNEL_TAG/g) || []).length >= 4,
  String((code.match(/channelId:/g) || []).length) + ' 处 channelId');

// 6.2 渠道必须有声音。Android 8+ 渠道不设 sound 就是静音渠道，
//     而插件只支持 raw 资源名 —— 所以必须真的存在这个文件。
const soundMatch = notifySrc.match(/CHANNEL_SOUND = '([\w.-]+)'/);
ok('渠道声明了提示音资源', !!soundMatch, String(soundMatch));
const soundFile = soundMatch ? pathMod.join(root, 'android', 'app', 'src', 'main', 'res', 'raw', soundMatch[1] + '.wav') : '';
ok('提示音文件真实存在（插件只认 res/raw 下的资源）', !!soundFile && fsMod.existsSync(soundFile), soundFile);
if (soundFile && fsMod.existsSync(soundFile)) {
  const head = fsMod.readFileSync(soundFile).subarray(0, 12).toString('latin1');
  ok('提示音是合法的 RIFF/WAVE 头', head.startsWith('RIFF') && head.includes('WAVE'), head);
}
ok('渠道不再用被忽略的 audioAttributes 冒充声音', !code.includes('audioAttributes'), '');
ok('锁屏可见性用插件真读的 visibility', code.includes('visibility: 1') && !code.includes('lockScreenVisibility'), '');
ok('渠道 importance 保持 5（4 以下不会有横幅）', /name: '(上课|待办)提醒'[^}]*importance: 5/.test(notifySrc), '');
// 换渠道 id 必须顺手删旧渠道，否则手机的系统设置里会并列两套同名"上课提醒/待办提醒"
ok('建完新渠道会清理旧版本渠道', code.includes('deleteChannel') && code.includes("'class-v2', 'todo-v2'"), '');

// 6.3 通知小图标必须真实存在，否则插件回退成系统"信息"灰图标
const iconName = (cfgSrc.match(/smallIcon:\s*'([\w-]+)'/) || [])[1] || '';
ok('配置里声明了通知小图标', !!iconName, cfgSrc.match(/LocalNotifications[\s\S]*?\}/)?.[0] || '');
ok('小图标资源真实存在', !!iconName && fsMod.existsSync(pathMod.join(root, 'android', 'app', 'src', 'main', 'res', 'drawable', iconName + '.xml')), iconName);

// 6.4 点击通知要能定位：排期时写入 extra，plugins.ts 里读回来路由
ok('排期把定位信息写进通知 extra', notifySrc.includes("extra: { k: 'c'") && notifySrc.includes("extra: { k: 'n'"), '');
const pluginsSrc = fsMod.readFileSync(pathMod.join(root, 'src', 'plugins.ts'), 'utf8');
ok('注册了通知点击监听', pluginsSrc.includes('localNotificationActionPerformed'), '');
ok('点击监听会切到对应页面并落 focus', pluginsSrc.includes("db.focus = { kind: 'course'") && pluginsSrc.includes("db.focus = { kind: 'note'"), '');

console.log('\n结果：' + pass + ' 通过 / ' + fails.length + ' 失败');
for (const f of fails) console.log('  ✗ ' + f);
if (fails.length) process.exit(1);
