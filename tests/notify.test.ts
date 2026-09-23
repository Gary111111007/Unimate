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
// v2.53 起 tag 是函数 channelTag()（渠道被静音时可以一键换新 tag），所以这里跟着改
ok('排期用插件真正读的 channelId', (code.match(/channelId:\s*'(class|todo)-' \+ channelTag\(\)/g) || []).length >= 4,
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
 * 心跳不依赖插件接收器：近期提醒后 30 秒兜底，平时 60 分钟巡检；
 * 只补 2 分钟以内的，更早的直接丢弃（不制造轰炸）。
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
    ok('近期排期后 30 秒兜底、否则 60 分钟巡检',
      /nearest \+ 30_000L/.test(hb) && /TICK_IDLE_MS = 60 \* 60 \* 1000L/.test(hb) && /nearest - now <= 60 \* 60 \* 1000L/.test(hb), '');
    ok('只补 2 分钟内错过的（更早的直接丢弃，避免一股脑）', /CATCHUP_MS = 2 \* 60 \* 1000L/.test(hb) && /now - t > CATCHUP_MS/.test(hb), '');
    ok('补投后取消插件那条闹钟（避免重复投递）', /cancelPluginAlarm\(context, n\.getId\(\)\)/.test(hb), '');
    ok('补投后从插件存储里删掉（避免下次重复）', /storage\.deleteNotification\(idStr\)/.test(hb), '');
    // v2.33：开机广播必须"清场"而不是"补投"——插件自己的恢复广播会把过期排期改写成 now+15s 一起放出来
    ok('开机走 dropOverdueOnBoot（清场），不是 runOnce（补投）',
      /if \(boot\) dropOverdueOnBoot\(context\);/.test(hb) && /Intent\.ACTION_BOOT_COMPLETED\.equals\(action\)/.test(hb), '');
    ok('清场会连"20 秒内就要响"的也丢掉（那正是被插件改写成 now+15s 的那批）',
      /long soon = now \+ 20_000L;/.test(hb) && /at\.getTime\(\) > soon\) continue/.test(hb), '');
    ok('清场丢掉的条数也记账（报告里能看见）', /totalDropped/.test(hb) && /lastDroppedCount/.test(hb), '');
    ok('自检报告会显示开机清场丢了多少条', /开机清场：累计丢掉/.test(notifySrc), '');
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
 * 10. 真机第四轮（v2.31）：截图暴露的两个 bug + 可复制自检报告
 *
 * 真机截图（OPPO/一加）显示：精确闹钟"未授权"、电池优化"未检测"（连「去允许后台运行」按钮都被藏了）、
 * 而机型/厂商路径却是查到的 —— 说明原生 powerStatus 返回里少了 ok 字段，前端把它当失败。
 */
console.log('');
{
  const java = fsMod.readFileSync(pathMod.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'unimate', 'app', 'JwWebViewPlugin.java'), 'utf8');
  const ps = java.slice(java.indexOf('public void powerStatus'), java.indexOf('public void heartbeatStatus'));
  ok('powerStatus 成功分支会返回 ok=true（v2.28 漏了，导致真机显示"未检测"并藏按钮）',
    /ret\.put\("ok", true\)/.test(ps), '');
  ok('powerStatus 失败分支返回 ok=false', /ret\.put\("ok", false\)/.test(ps), '');
  ok('原生暴露心跳状态查询（heartbeatStatus）', /public void heartbeatStatus\(PluginCall call\)/.test(java), '');
  const hbSrc = fsMod.readFileSync(pathMod.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'unimate', 'app', 'ReminderHeartbeat.java'), 'utf8');
  ok('心跳会记下"排上了没/下一跳/补投了几条"', /unimate_heartbeat/.test(hbSrc) && /"nextAt"/.test(hbSrc) && /"totalPosted"/.test(hbSrc), '');
  ok('心跳状态能报出"下一跳是否还在未来"（被系统撤掉能看出来）', /pendingNext/.test(hbSrc), '');
  ok('心跳每次扫描都留痕（lastScanAt），别只在补投时才更新', /lastScanAt/.test(hbSrc), '');
  /*
   * 【v2.32 修的隐藏自伤】Capacitor 的 LocalNotifications.scheduled() **在 Android 上没实现**，
   * 调用会抛 "not implemented on android"。旧代码 catch 成空数组，于是面板永远显示"0 条"、
   * 清理与投递自检全部空转。现在改成原生直读插件存储。
   */
  ok('原生暴露 pendingNotifications（直读插件存储）',
    /public void pendingNotifications\(PluginCall call\)/.test(java) && /NotificationStorage/.test(java), '');
  ok('原生返回的排期带 id/at/标题/渠道', /o\.put\("id"/.test(java) && /o\.put\("at"/.test(java) && /o\.put\("title"/.test(java), '');
  const bridge = fsMod.readFileSync(pathMod.join(root, 'src', 'services', 'jwwebview.ts'), 'utf8');
  ok('桥接层有 heartbeatStatus（含桌面预览兜底）', /heartbeatStatus\(\): Promise<HeartbeatStatus>/.test(bridge) && /heartbeatStatus: async/.test(bridge), '');
  ok('电池优化查询超时放宽到 6 秒（真机启动时 2.5 秒会误判）', /查电池优化', JwWebView\.powerStatus\(\), 6000/.test(notifySrc), '');
  // 一键自检报告
  ok('有可复制的自检报告', /export async function selfCheckReport/.test(notifySrc), '');
  ok('报告含判据：权限/排期条数与最早三条/精确闹钟/电池优化/机型/心跳',
    /系统通知权限/.test(notifySrc) && /最早三条排期/.test(notifySrc) && /精确闹钟授权/.test(notifySrc)
    && /电池优化豁免/.test(notifySrc) && /兜底心跳/.test(notifySrc), '');
  const me = fsMod.readFileSync(pathMod.join(root, 'src', 'views', 'MeView.vue'), 'utf8');
  ok('面板有「复制自检报告」按钮并显示报告', /copySelfCheck/.test(me) && /复制自检报告/.test(me), '');
  ok('面板显示心跳状态（已排/未排/未检测）', /兜底心跳/.test(me) && /hb\.armed/.test(me), '');
  // 产品负责人明确不来自启动：文案要把"精确闹钟"与"自启动"分开说清楚
  ok('文案把精确闹钟与自启动分开（不逼用户开自启动）',
    /精确闹钟不是自启动/.test(me) || /精确闹钟/.test(me), '');
  /*
   * v2.34：提醒守护前台服务
   * 三项系统开关（通知权限/精确闹钟/电池优化豁免）全绿、排期 21 条，产品负责人仍反馈"只有打开 App 才收到提醒"
   * —— ColorOS 自己的后台冻结只能靠一条前台服务化解，这是 App 侧最后一个手段。
   */
  const guardSvc = pathMod.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'unimate', 'app', 'ReminderGuardService.java');
  ok('存在提醒守护前台服务', fsMod.existsSync(guardSvc), '');
  if (fsMod.existsSync(guardSvc)) {
    const g = fsMod.readFileSync(guardSvc, 'utf8');
    ok('服务用 startForeground + 常驻通知', /startForeground\(NOTIFICATION_ID, n\)/.test(g), '');
    ok('通知是最低优先级 + 静音（不打扰）', /IMPORTANCE_MIN/.test(g) && /setSilent\(true\)/.test(g) && /PRIORITY_MIN/.test(g), '');
    ok('开关写进 SharedPreferences（重启后仍生效）', /KEY_ENABLED/.test(g) && /setEnabled\(Context context, boolean on\)/.test(g), '');
    ok('起不来时只降级、不崩（try/catch 包住）', /catch \(Throwable t\) \{\s*\/\/ 起不来就退化成普通后台/.test(g), '');
    ok('前台服务不是空壳：每 15 秒独立扫描到期提醒', /SCAN_MS = 15_000L/.test(g) && /ReminderHeartbeat\.runOnce/.test(g) && /handler\.postDelayed\(this, SCAN_MS\)/.test(g), '');
    ok('服务启动后接管插件闹钟，页面关闭也能由原生投递', /ReminderHeartbeat\.hardenAll\(this\)/.test(g), '');
  }
  const manifest2 = fsMod.readFileSync(pathMod.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  ok('manifest 注册了前台服务并声明 specialUse 类型',
    /ReminderGuardService[\s\S]{0,200}foregroundServiceType="specialUse"/.test(manifest2), '');
  ok('manifest 申请了前台服务权限（Android 14 需要）',
    /FOREGROUND_SERVICE/.test(manifest2) && /FOREGROUND_SERVICE_SPECIAL_USE/.test(manifest2), '');
  ok('manifest 注册了带迟到保护的单条提醒接收器',
    /ReminderAlarmReceiver[\s\S]{0,180}android:exported="false"/.test(manifest2), '');
  const alarmReceiver = fsMod.readFileSync(pathMod.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'unimate', 'app', 'ReminderAlarmReceiver.java'), 'utf8');
  ok('单条接收器不启动页面，直接走原生投递', /ReminderHeartbeat\.deliverById\(context, id\)/.test(alarmReceiver), '');
  ok('原生排期使用 RTC_WAKEUP + setExactAndAllowWhileIdle', /setExactAndAllowWhileIdle\(AlarmManager\.RTC_WAKEUP/.test(hbSrc), '');
  ok('投递前按原计划时刻验迟到窗口', /deliverById[\s\S]{0,900}now - at <= CATCHUP_MS/.test(hbSrc), '');
  const mainActivity = fsMod.readFileSync(pathMod.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'unimate', 'app', 'MainActivity.java'), 'utf8');
  ok('App 启动时按设置拉起守护', /ReminderGuardService\.isEnabled\(this\)[\s\S]{0,60}ReminderGuardService\.start\(this\)/.test(mainActivity), '');
  ok('开机广播也尽力拉起守护', /if \(boot && ReminderGuardService\.isEnabled\(context\)\) ReminderGuardService\.start\(context\)/.test(hbSrc), '');
  ok('桥接层有 setReminderGuard / reminderGuardStatus', /setReminderGuard\(options: \{ enabled: boolean \}\)/.test(bridge) && /reminderGuardStatus\(\): Promise/.test(bridge), '');
  ok('每次批量/测试/演示排期后都调用原生接管且包 guard 超时',
    (notifySrc.match(/guard\('接管(?:原生|测试|演示)提醒', JwWebView\.hardenNotifications\(\), 6000/g) || []).length === 3, '');
  ok('设置项 reminderGuard 默认开（决定"关掉 App 还能不能准时收到"）',
    /reminderGuard: true/.test(fsMod.readFileSync(pathMod.join(root, 'src', 'stores', 'db.ts'), 'utf8')), '');
  ok('载入用户数据后把设置同步给原生', /setReminderGuard\(settings\.value\.reminderGuard !== false\)/.test(fsMod.readFileSync(pathMod.join(root, 'src', 'stores', 'db.ts'), 'utf8')), '');
  ok('面板有开关与状态显示，并写明了代价（常驻静音通知）', /提醒守护（前台服务）/.test(me) && /静音小通知/.test(me), '');
  ok('自检报告含"提醒守护"一行', /提醒守护（前台服务）：/.test(notifySrc), '');
  // 排期读取必须走原生（scheduled() 在安卓上是空的）
  ok('排期读取走 pendingList()（原生直读）', /export async function pendingList/.test(notifySrc) && /JwWebView\.pendingNotifications\(\)/.test(notifySrc), '');
  {
    // 注释里会解释这段历史，数之前先把注释剥掉
    const code = notifySrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    const hits = (code.match(/LocalNotifications\.scheduled\(\)/g) || []).length;
    ok('排期统计不再直接调 LocalNotifications.scheduled()（只允许 web 兜底那一处）', hits === 1, String(hits));
  }
  ok('清理与统计都用 pendingList/safeScheduled', /async function safeScheduled[\s\S]{0,120}pendingList\(\)/.test(notifySrc), '');
  ok('自检报告也走原生读取', /最早三条排期[\s\S]{0,200}pendingList\(\)/.test(notifySrc) || /const all = await pendingList\(\);[\s\S]{0,200}最早三条排期/.test(notifySrc), '');
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

/*
 * v2.53：渠道被静音/降级是"到点不响"最容易被漏掉的一种成因 ——
 * 应用级通知权限 granted 也照样会发生，界面上看不出来。所以：自检报告要读渠道真实状态，并给一键重建。
 */
console.log('\n--- v2.53：通知渠道自检 + 一键重建 ---');
{
  const fsMod = await import('node:fs');
  const pathMod = await import('node:path');
  const notify = fsMod.readFileSync(pathMod.join(root, 'src', 'services', 'notify.ts'), 'utf8');
  const jw = fsMod.readFileSync(pathMod.join(root, 'src', 'services', 'jwwebview.ts'), 'utf8');
  const java = fsMod.readFileSync(pathMod.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'unimate', 'app', 'JwWebViewPlugin.java'), 'utf8');
  const me = fsMod.readFileSync(pathMod.join(root, 'src', 'views', 'MeView.vue'), 'utf8');

  ok('原生插件能读渠道真实状态（importance/声音/是否屏蔽 + Doze）',
    /public void notifyChannelStatus\(PluginCall call\)/.test(java)
    && /getNotificationChannel\(id\)/.test(java) && /isDeviceIdleMode\(\)/.test(java), '');
  ok('前端包装了 notifyChannelStatus，并写进自检报告',
    /notifyChannelStatus/.test(jw) && /notifyChannelState\(\)/.test(notify)
    && /通知渠道：/.test(notify), '');
  ok('报告里会写"渠道不存在 / 无声 / 不是 HIGH"这类能直接定位的结论',
    /HIGH\(横幅\)/.test(notify) && /无声/.test(notify) && /渠道不存在/.test(notify), '');
  ok('提供一键重建渠道（换新 tag，避开 Android 8+ 渠道不可改的限制）',
    /export async function rebuildNotifyChannels/.test(notify)
    && /localStorage\.setItem\(CHANNEL_TAG_KEY/.test(notify)
    && /rebuildNotifyChannels\(\)/.test(me), '');

  /*
   * v2.55：按业界做法修"到点不响"的三件事，逐条钉死：
   *  ① USE_EXACT_ALARM（装上自动授予，不用用户去系统设置开）——这是官方文档 + flutter_local_notifications README 都指的路；
   *  ② 优先 setAlarmClock（走"下一个闹钟"通道，不参与 Doze 攒队）；
   *  ③ 闹钟条目自检（排期列表里有 ≠ AlarmManager 里挂着）；
   *  ④ 用户划掉 App 时（onTaskRemoved）重新硬化排期。
   */
  const manifest = fsMod.readFileSync(pathMod.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  const heartbeat = fsMod.readFileSync(pathMod.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'unimate', 'app', 'ReminderHeartbeat.java'), 'utf8');
  const guardSvc = fsMod.readFileSync(pathMod.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'unimate', 'app', 'ReminderGuardService.java'), 'utf8');
  ok('清单里声明了 USE_EXACT_ALARM（Android 13+ 装上即授予，无需用户手动开）',
    /android\.permission\.USE_EXACT_ALARM/.test(manifest), '');
  ok('仍然保留 SCHEDULE_EXACT_ALARM 与降级分支（上架时改回去也能跑）',
    /android\.permission\.SCHEDULE_EXACT_ALARM/.test(manifest) && /setAndAllowWhileIdle/.test(heartbeat), '');
  ok('排期优先走 setAlarmClock（下一个闹钟通道），失败再落回 setExactAndAllowWhileIdle',
    /am\.setAlarmClock\(new AlarmManager\.AlarmClockInfo\(at, showPi\), pi\)/.test(heartbeat)
    && /setExactAndAllowWhileIdle\(AlarmManager\.RTC_WAKEUP, at, pi\)/.test(heartbeat), '');
  ok('只把 24 小时内的排期塞进"下一个闹钟"位子（不然远期排期会挤掉它）',
    /24L \* 60 \* 60 \* 1000/.test(heartbeat), '');
  ok('闹钟条目自检：原生用 FLAG_NO_CREATE 判断闹钟还在不在',
    /public void alarmDiagnostics\(PluginCall call\)/.test(java)
    && /PendingIntent\.FLAG_NO_CREATE/.test(java) && /canScheduleExactAlarms\(\)/.test(java), '');
  ok('自检报告里写"几条真的挂在系统里"，并在一条都没有时直接点明原因',
    /闹钟条目：/.test(notify) && /系统里一条闹钟都没有/.test(notify), '');
  ok('用户划掉 App 时重新硬化排期并重启守护服务（onTaskRemoved）',
    /public void onTaskRemoved\(Intent rootIntent\)/.test(guardSvc)
    && /ReminderHeartbeat\.hardenAll\(this\)/.test(guardSvc), '');
  ok('渠道 tag 改成可配置（否则被静音后只能等发新版）',
    /function channelTag\(\)/.test(notify) && /CHANNEL_TAG_KEY/.test(notify)
    && !/const CHANNEL_TAG = 'v[0-9]+'/.test(notify), '');
  /*
   * 【v2.54 真机事故】把 `const CHANNEL_TAG` 改成 `channelTag()` 时，4 处调用点漏改 ——
   * 真机上点「测试提醒」直接报 `CHANNEL_TAG is not defined`（vite 不做类型检查，单测也没扫到）。
   * 这里给"高风险模块里的全大写标识符"加一道自查：用到了就必须在本文件里声明或 import 过。
   */
  {
    const declared = new Set<string>();
    for (const m of notify.matchAll(/(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
    for (const m of notify.matchAll(/import\s+\{([^}]*)\}/g)) {
      for (const part of m[1].split(',')) declared.add((part.split(/\s+as\s+/).pop() || '').trim());
    }
    // 注释与字符串里出现的名字不算使用（文档里会写 ROM、HIGH、AGENTS 这些词）
    const codeOnly = notify
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/'[^'\n]*'/g, ' ')
      .replace(/"[^"\n]*"/g, ' ');
    const allowed = new Set(['JSON', 'NaN', 'URL']);
    const used = new Set<string>();
    for (const m of codeOnly.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) used.add(m[1]);
    const undefinedNames = [...used].filter((n) => !declared.has(n) && !allowed.has(n));
    ok('notify.ts 里没有"用了但没声明"的全大写标识符（v2.54 的 CHANNEL_TAG 事故）',
      undefinedNames.length === 0, undefinedNames.join(','));
  }
}

console.log('\n结果：' + pass + ' 通过 / ' + fails.length + ' 失败');
for (const f of fails) console.log('  ✗ ' + f);
if (fails.length) process.exit(1);
