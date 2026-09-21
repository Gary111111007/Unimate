// 提醒时刻的"过桥契约"测试（PRD 11.19）。
// 真实教训：v2.7 误以为原生把 ISO 串按本地时区解，改成"本地拼串 + 假 Z"，
// 结果每条提醒晚 8 小时才响，用户反馈"到点不弹"。这条测试就是防它复发。
import {
  NATIVE_PARSE_TZ, NATIVE_PATTERN, WIRE_DATE_RE, fakeLocalAt, wireAt
} from '../src/services/notifyWire.ts';
import { staleIds } from '../src/services/notify.ts';

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

/*
 * 7. 排期清理口径（v2.28，真机反馈"到点不响、一打开全涌出来"）
 *
 * 三个事实决定了这段逻辑：
 *  a) 插件 setExactIfPossible()：精确闹钟没授权时退化成"不精确闹钟"→ 到点不响、等活跃时一起补发；
 *  b) 插件 LocalNotificationRestoreReceiver：开机广播把**已过期**的排期改写成"now + 15 秒"→ 一股脑补发；
 *  c) 旧实现"全清再重建"会把用户正在等的那一条（正好到点）静默吞掉。
 */
console.log('');
{
  const now = 1_800_000_000_000;      // 固定时间，避免用 Date.now() 让断言飘
  const plan = [
    { id: 101, at: now + 60_000 },     // 一分钟后
    { id: 102, at: now - 10_000 },     // 刚过点 10 秒（宽限期内）
    { id: 103, at: now - 600_000 }     // 十分钟前就该响
  ];
  const scheduled = [101, 102, 103, 104, 900, 999];   // 104 = 账本里没有的孤儿；900/999 = 测试/演示提醒
  const out = staleIds(plan, scheduled, now, 90_000);
  ok('未来的排期不动', out.indexOf(101) < 0, JSON.stringify(out));
  ok('刚过点 10 秒的也不动（用户很可能正在看这一条）', out.indexOf(102) < 0, JSON.stringify(out));
  ok('过期十分钟的才清', out.indexOf(103) >= 0, JSON.stringify(out));
  ok('账本里没有的孤儿清掉（老版本残留 / 恢复广播造的）', out.indexOf(104) >= 0, JSON.stringify(out));
  ok('测试/演示提醒不归它管', out.indexOf(900) < 0 && out.indexOf(999) < 0, JSON.stringify(out));
  ok('宽限期可调：0 宽限时刚过点的也清', staleIds(plan, scheduled, now, 0).indexOf(102) >= 0, '');
  ok('空账本 = 全清（老版本升级上来的第一次）', staleIds([], [1, 2, 3], now).length === 3, '');

  // 排期地平线：不再排太远（14 天 → 7 天），减少系统侧堆积与"过期补发"的规模
  const horizon = notifySrc.match(/const HORIZON_DAYS = (\d+)/);
  ok('排期地平线是 7 天', !!horizon && horizon[1] === '7', String(horizon && horizon[1]));
  ok('用了新账本机制（排期时写、启动时按账本清）',
    /await savePlan\(list\.slice\(0, 64\)/.test(notifySrc) && /export async function cleanupStaleOnBoot/.test(notifySrc), '');
  ok('不再"全清再重建"（旧函数已删）', !/cancelAllScheduledOnBoot/.test(notifySrc), '');
  // 排期前必须拦掉过去时间：插件对过去的 at 是直接 return（不排也不报错），
  // 我们若依赖它就会以为排上了
  ok('课表/待办排期前都挡掉过去时间', (notifySrc.match(/if \(fire < now \|\| fire > horizon\) continue;/g) || []).length >= 2, '');
}

/*
 * 9. 兜底心跳（v2.30）：系统把闹钟攒着时的最后一道保险
 *
 * 真机第三轮反馈仍然是"到点不响、一打开才提醒" —— 说明系统压根没按时投递插件的排期。
 * 心跳不依赖插件排期：每 15 分钟（近期无排期时 60 分钟）自己醒一次，扫插件持久化的排期，
 * 把"刚过期还没投递"的补投出去；只补 30 分钟以内的，更早的直接丢弃（不制造轰炸）。
 */
console.log('');
{
  const fs = fsMod;
  const hbPath = pathMod.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'unimate', 'app', 'ReminderHeartbeat.java');
  ok('兜底心跳的原生文件存在', fs.existsSync(hbPath), hbPath);
  if (fs.existsSync(hbPath)) {
    const hb = fs.readFileSync(hbPath, 'utf8');
    ok('心跳用 setAndAllowWhileIdle（Doze 里也能被放行）', /setAndAllowWhileIdle\(AlarmManager\.RTC_WAKEUP/.test(hb), '');
    ok('心跳自己重排下一跳（Android 不允许精确重复闹钟）', /static void arm\(Context context\)/.test(hb) && /arm\(context\);\s*\}\s*$|arm\(context\);/.test(hb), '');
    ok('有近期排期才 15 分钟一跳，否则 60 分钟（省电）', /TICK_IDLE_MS = 60 \* 60 \* 1000L/.test(hb) && /nearest - now <= 45 \* 60 \* 1000L/.test(hb), '');
    ok('只补 30 分钟内错过的（更早的直接丢弃，避免一股脑）', /CATCHUP_MS = 30 \* 60 \* 1000L/.test(hb) && /now - t > CATCHUP_MS/.test(hb), '');
    ok('补投后取消插件那条闹钟（避免重复投递）', /cancelPluginAlarm\(context, n\.getId\(\)\)/.test(hb), '');
    ok('补投后从插件存储里删掉（避免下次重复）', /storage\.deleteNotification\(idStr\)/.test(hb), '');
    ok('点击载荷与插件一致（能切到对应课程/记事）',
      /LocalNotificationId/.test(hb) && /LocalNotficationObject/.test(hb) && /LocalNotificationUserAction/.test(hb), '');
    ok('心跳不自己造通知文案（沿用排期里的标题/内容）', /n\.getTitle\(\)/.test(hb) && /n\.getBody\(\)/.test(hb), '');
    ok('通知不可用时直接跳过（不崩）', /areNotificationsEnabled\(\)/.test(hb), '');
  }
  const manifest = fs.readFileSync(pathMod.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  ok('manifest 注册了心跳，且 exported=false', /ReminderHeartbeat[\s\S]{0,200}android:exported="false"/.test(manifest), '');
  ok('manifest 里有自定义 tick 动作', /com\.unimate\.app\.REMINDER_TICK/.test(manifest), '');
  ok('开机广播也重排心跳（否则重启后心跳断了）', /BOOT_COMPLETED[\s\S]{0,120}QUICKBOOT_POWERON/.test(manifest), '');
  const activity = fs.readFileSync(pathMod.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'unimate', 'app', 'MainActivity.java'), 'utf8');
  ok('App 启动时就把心跳排上（否则是鸡生蛋问题）', /ReminderHeartbeat\.arm\(this\)/.test(activity), '');
  // 自检数字：missed = 账本里有计划、但系统没投递
  ok('清理结果区分"取消数"与"系统没投递数"', /missed: stale\.filter\(\(id\) => planned\.has\(id\)\)\.length/.test(notifySrc), '');
  ok('通知设置面板显示这个数字（证据要看得见）', /db\.notifyCleanup\.missed/.test(fs.readFileSync(pathMod.join(root, 'src', 'views', 'MeView.vue'), 'utf8')), '');
}

/*
 * 8. 让用户看得见根因（真机上"到点不响"就是这两项没就绪）
 */
{
  const tt = fsMod.readFileSync(pathMod.join(root, 'src', 'views', 'TimetableView.vue'), 'utf8');
  const me = fsMod.readFileSync(pathMod.join(root, 'src', 'views', 'MeView.vue'), 'utf8');
  const app = fsMod.readFileSync(pathMod.join(root, 'src', 'App.vue'), 'utf8');
  ok('课表页有提醒可用性提示条（含一键去修）', /riskbar/.test(tt) && /fixReminderSetting/.test(tt), '');
  ok('提示条只在真的没就绪时出现（canFix 非空）', /v-if="risk && risk\.canFix/.test(tt), '');
  ok('不主动跳系统设置：只有用户点了才跳', /@click="fixRisk\(\)"/.test(tt) && !/onMounted\(\(\) => \{ void fixReminderSetting/.test(tt), '');
  ok('启动时只查状态（refreshReminderRisk）', /refreshReminderRisk/.test(app), '');
  ok('通知设置面板显示电池优化与机型路径', /电池优化豁免/.test(me) && /power\.rom/.test(me) && /requestIgnoreBattery/.test(me), '');
}

console.log('\n结果：' + pass + ' 通过 / ' + fails.length + ' 失败');
for (const f of fails) console.log('  ✗ ' + f);
if (fails.length) process.exit(1);
