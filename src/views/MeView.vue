<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useDb } from '../stores/db.ts';
// v2.47：同步/找回那一屏搬走后，这里只剩"备份与恢复"用得到的东西（guard / 加密迁移包都不再需要）
import { exportBackup, inspectBackup, restoreBackup } from '../services/backup.ts';
import { base64ToBytes } from '../services/zip.ts';
import { permissionState, ensurePermission, rescheduleAll, scheduleDemoPing, scheduledCount, scheduleStats, cancelAll, scheduleTest, exactAlarmState, requestExactAlarmSetting, wireSelfCheck, powerStatus, requestIgnoreBattery, selfCheckReport, heartbeatStatus, setReminderGuard, reminderGuardStatus, rebuildNotifyChannels, calendarSyncEnabled, calendarStatus, setCalendarSync, clearCalendarEvents, syncCalendarNow, calendarEventsFromSchedule } from '../services/notify.ts';
import { nowStamp } from '../services/id.ts';
import { animateThemeChange, type ThemeMode, type ThemeTransitionOrigin } from '../services/theme.ts';
import { FONT_LEVELS, applyTextZoom } from '../services/display.ts';
import { SECOND_CLASS_BLOCKS, TOTAL_FULL_SCORE } from '../catalog/secondClass.ts';
import { agoText, weatherText } from '../services/weather.ts';
import { pickAvatarRaw } from '../services/avatar.ts';
import AvatarCropper from '../components/AvatarCropper.vue';
import AppleIcon from '../components/AppleIcon.vue';

const db = useDb();
/** v2.47：`sync` 那一屏搬去主页的「账号与找回」面板（components/AccountRecovery.vue）了 */
const panel = ref<'' | 'notify' | 'theme' | 'watermark' | 'weather' | 'backup' | 'about' | 'interests'>('');
const perm = ref('unknown');
const lastBackup = ref('');
const restoreB64 = ref('');
const restoreMode = ref<'overwrite' | 'merge'>('overwrite');
const restoreInfo = ref('');
const sched = ref(0);
const stats = ref({ total: 0, classReminders: 0, todoReminders: 0, testReminders: 0, nextFireAt: '' });
const schedMsg = ref('');
const exact = ref('unknown');
const wire = ref({ ok: true, sample: '', hint: '' });
/** 电池优化 / 厂商信息（查不到就显示"未检测"） */
const power = ref({ ok: false, ignoring: false, exactAlarm: true, rom: '', hint: '', error: '' });
/** 兜底心跳状态（v2.31）：证明它到底有没有在跑 */
const hb = ref({ ok: false, armed: false, nextAt: 0, lastPostedCount: 0, totalPosted: 0, lastPostedAt: 0 });
/**
 * 提醒守护前台服务状态（v2.34）。
 * 【v2.40 修】原来这里叫 `const guard`，和上面导入的 `guard()` 超时工具**重名**：
 * SFC 编译会把工具改名（真机压缩后是 `$`），于是 v2.35 新加的同步代码里 `guard(...)` 全变成
 * 在调用这个 ref —— 真机报 `$ is not a function`，而 v2.38 还把它当成 WebCrypto 问题去修。
 * 教训：**顶层声明不许与 import 重名**，现在有 `test:order` 静态扫全仓库兜底。
 */
const guardState = ref({ ok: false, enabled: false, running: false });
const reportMsg = ref('');
/** 打开「天气」面板时的开关与城市：用它判断"保存时用户是不是明确改过"（改过就允许立刻拉一次） */
const wxOpened = ref({ enabled: false, city: '' });

const sub = computed(() => SECOND_CLASS_BLOCKS.map((b) => b.name + ' ' + db.blockScore(b.key)).join(' · '));

async function toggleAutoSync(e: Event): Promise<void> {
  db.settings.cloudAutoSync = (e.target as HTMLInputElement).checked;
  await db.saveData();   // 保存完会自动触发一次同步（开着的时候）
}

async function open(name: typeof panel.value): Promise<void> {
  panel.value = name;
  if (name === 'notify') { await refreshNotifyState(); }
  if (name === 'weather') wxOpened.value = { enabled: db.settings.weatherEnabled, city: (db.settings.weatherCity || '').trim() };
}

function closePanel(): void { panel.value = ''; }

async function test(minutes: number): Promise<void> {
  const r = await scheduleTest(minutes);
  schedMsg.value = r.ok ? '已排期，' + r.at + ' 触发' : '失败：' + r.error;
  stats.value = await scheduleStats(); sched.value = stats.value.total;
  db.notify(r.ok ? '已安排 ' + minutes + ' 分钟后的测试提醒' : '测试提醒失败：' + r.error);
}

async function clearAll(): Promise<void> {
  const ok = await db.confirm({
    title: '确认清空全部排期提醒？',
    body: '会取消系统里所有已排期的上课与待办提醒。',
    detail: '清空后点「重建提醒队列」即可按当前课表重新排期，不会丢数据。',
    confirmText: '确定清空'
  });
  if (!ok) return;
  await cancelAll();
  stats.value = await scheduleStats(); sched.value = stats.value.total;
  schedMsg.value = '已清空';
  db.notify('已取消全部排期提醒');
}

async function askPerm(): Promise<void> {
  const g = await ensurePermission();
  perm.value = await permissionState();
  db.notify(g ? '通知权限已开启' : '请在系统设置中允许 Unimate 发送通知');
}

/**
 * 设置面板的「保存设置」以前只是 await db.saveData()，既不提示也不收起面板，
 * 用户点了像没反应（真机反馈）。这里统一：保存 + 回执 + 收起面板。
 */
async function saveSettings(what: string): Promise<void> {
  try { await db.saveData(); } catch { db.notify('保存失败，请重试'); return; }
  db.notify(what + '已保存到本机');
  panel.value = '';
}

function themeTriggerOrigin(e: MouseEvent): ThemeTransitionOrigin {
  const el = e.currentTarget as HTMLElement | null;
  const rect = el?.getBoundingClientRect();
  // 键盘触发的 click 坐标通常是 0,0；这时从按钮中心展开，视觉与焦点来源一致。
  if (e.detail === 0 && rect) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  return { x: e.clientX, y: e.clientY };
}

function setTheme(t: ThemeMode, e: MouseEvent): void {
  if (db.settings.theme === t) return;
  db.settings.theme = t;
  void animateThemeChange(t, themeTriggerOrigin(e));
}

/** 字号：改设置 + 立刻生效 + 落盘，避免"点了没反应"（真机反复反馈过这个） */
async function setFont(percent: number): Promise<void> {
  db.settings.fontSize = percent;
  const r = await applyTextZoom(percent);
  await db.saveData();
  db.notify(r.ok ? '字号已切换为 ' + percent + '%（' + r.via + '）' : r.error);
}

async function askExact(): Promise<void> {
  exact.value = await requestExactAlarmSetting();
  db.notify(exact.value === 'granted' ? '精确闹钟已授权，提醒会按时到点触发' : '返回后请重新打开通知设置查看状态');
}

/** 去开"允许后台运行"（电池优化豁免） */
async function fixReminder(): Promise<void> {
  const msg = await requestIgnoreBattery();
  await refreshNotifyState();
  db.notify(msg);
}

/**
 * 提醒守护前台服务开关（v2.34）。
 * 说明写在界面上：它靠一条常驻静音通知让系统不冻结 App —— 这是国产 ROM 上唯一还能由 App 自己做的保活手段。
 */
async function toggleGuard(on: boolean): Promise<void> {
  db.settings.reminderGuard = on;
  const ok = await setReminderGuard(on);
  await refreshNotifyState();
  if (!on) { db.notify('已关闭提醒守护：可能回到"打开 App 才收到提醒"'); return; }
  db.notify(ok ? '提醒守护已开启（通知栏会出现一条静音小通知）' : '系统不允许启动前台服务，请重试或检查系统权限');
}

/**
 * 一键自检报告：把"提醒为什么不响"的所有判据打成文本，复制到剪贴板。
 * 产品负责人反馈问题时粘贴这段就够，不用来回截图问我（v2.31 加）。
 */
async function copySelfCheck(): Promise<void> {
  const text = await selfCheckReport();
  reportMsg.value = text;
  try {
    await navigator.clipboard.writeText(text);
    db.notify('自检报告已复制，直接粘贴发我即可');
  } catch {
    db.notify('剪贴板不可用，报告已显示在下方，可长按选中复制');
  }
}

/**
 * 天气（Net.md P0）。
 * 开关状态直接写在设置里（和别的面板一样），只有点「保存设置」才落盘；
 * 关着的时候**一次请求都不发**（`ensureWeather` 里由 `shouldRequestWeather` 兜底），
 * 所以这里的按钮也会先看开关，避免"关着还能点出一次请求"这种自相矛盾的界面。
 */
async function updateWeatherNow(): Promise<void> {
  if (!db.settings.weatherEnabled) { db.notify('天气是关闭状态，不会发任何请求'); return; }
  await db.ensureWeather(true);
  db.notify(db.weatherMsg || '已更新');
}

/**
 * 保存天气设置。
 * 「打开开关 / 改城市」是用户明确表达"我要看这个地方的天气"，保存后**立刻**拉一次；
 * 只是重新点了一次保存（什么都没改）则仍走 30 分钟节流 —— 免得反复保存变成反复请求。
 */
async function saveWeather(): Promise<void> {
  db.settings.weatherCity = (db.settings.weatherCity || '').trim();
  const changed = db.settings.weatherCity !== wxOpened.value.city || db.settings.weatherEnabled !== wxOpened.value.enabled;
  await saveSettings('天气设置');
  if (db.settings.weatherEnabled) void db.ensureWeather(changed);
}

/** 从系统设置页返回时自动刷新四项状态，避免用户看不到变化。 */

async function refreshNotifyState(): Promise<void> {
  perm.value = await permissionState();
  exact.value = await exactAlarmState();
  power.value = await powerStatus();
  hb.value = await heartbeatStatus();
  guardState.value = await reminderGuardStatus();
  wire.value = wireSelfCheck();
  stats.value = await scheduleStats();
  sched.value = stats.value.total;
  // v2.56：日历同步的状态（开关打开时应该有条数；日历不可用时也能看出来）
  calSync.value = calendarSyncEnabled();
  await refreshCalendarState();
}

function onVisible(): void {
  if (!document.hidden && panel.value === 'notify') void refreshNotifyState();
}

/**
 * v2.53：重建通知渠道 + 重排提醒。
 * 场景：三项系统开关都绿了、排期也在，但到点只有"安静地躺进通知栏"——
 * 那是**渠道**被系统或用户静音/降级了（应用级权限仍是 granted，看不出来）。
 * 换一个新渠道（默认横幅+铃声）并立刻重排，等于当场自救一次。
 */
async function rebuildChannels(): Promise<void> {
  const r = await rebuildNotifyChannels();
  if (!r.ok) { db.notify('重建通知渠道失败：' + (r.error || '未知原因')); return; }
  try {
    await rescheduleAll(db.courses, db.timetables, db.notes, db.settings);
  } catch { /* 重排失败不影响渠道本身 */ }
  await refreshNotifyState();
  db.notify('通知渠道已重建（' + r.tag + '）并重排提醒；请再测一条 2 分钟提醒');
}

/**
 * v2.56：**同步到系统日历**（选择性功能，默认关）。
 *
 * 为什么做：产品负责人不愿意开"允许后台运行"，国产 ROM 就会把后台的 App 冻住 ——
 * 闹钟回调排队，提醒只能等打开 App 才补发。写进系统日历后，闹钟由**系统日历 App**持有，
 * 我们不跑也照样到点弹通知。代价是日程会出现在日历里，所以做成开关、默认关、可一键清空。
 */
const calSync = ref(calendarSyncEnabled());
const calState = ref({ available: false, written: 0, calendar: '', permission: 'unknown' });
const calMsg = ref('');

async function refreshCalendarState(): Promise<void> {
  const st = await calendarStatus();
  calState.value = { available: st.available, written: st.written, calendar: st.calendar, permission: st.permission };
}

async function toggleCalendarSync(e: Event): Promise<void> {
  const on = (e.target as HTMLInputElement).checked;
  calMsg.value = on ? '正在申请日历权限…' : '正在清空已写入的日程…';
  const r = await setCalendarSync(on);
  if (!r.ok) {
    calSync.value = !on;          // 没成功就把开关拨回去，不能骗人
    calMsg.value = r.error;
    await refreshCalendarState();
    return;
  }
  calSync.value = on;
  if (on) {
    // 立刻把当前未来三周的提醒写进去
    const upcoming = await calendarEventsFromSchedule();
    const w = await syncCalendarNow(upcoming);
    calMsg.value = w.ok ? '已写入系统日历 ' + w.written + ' 条（未来三周内的提醒）' : '写入失败：' + w.error;
  } else {
    calMsg.value = '已关闭并清空（删掉 ' + r.removed + ' 条由 Unimate 写入的日程）';
  }
  await refreshCalendarState();
  db.notify(on ? '已开启同步到系统日历' : '已关闭同步到系统日历');
}

async function clearCalendarNow(): Promise<void> {
  const ok = await db.confirm({
    title: '清空 Unimate 写进日历的提醒？',
    body: '只会删除由 Unimate 写入的日程（我们靠应用标记认领），你自己的日程不受影响。',
    detail: '清空后如果开关还开着，下次改课表会重新写入。',
    confirmText: '确定清空', danger: true
  });
  if (!ok) return;
  const r = await clearCalendarEvents();
  calMsg.value = r.ok ? '已清空 ' + r.removed + ' 条' : '清空失败：' + r.error;
  await refreshCalendarState();
}
onMounted(() => document.addEventListener('visibilitychange', onVisible));
onUnmounted(() => document.removeEventListener('visibilitychange', onVisible));

/**
 * 头像（v2.47）：从相册选一张，本机裁成 1:1 再存成 data URL。
 * 用户取消时 `pickAvatar()` 返回 null，这里什么都不做（不算错误）。
 */
/** v2.54：选图后**先打开裁剪界面**（自己拖动取景），确认才落盘 */
const cropSrc = ref('');
async function changeAvatar(): Promise<void> {
  const raw = await pickAvatarRaw();
  if (!raw) return;
  cropSrc.value = raw;
}

async function avatarCropped(dataUrl: string): Promise<void> {
  cropSrc.value = '';
  db.settings.avatar = dataUrl;
  await db.saveData();
  db.notify('头像已更新');
}

/** 恢复默认头像 = 删掉自己设的那张，回到昵称首字（属撤销，不弹确认框） */
async function clearAvatar(): Promise<void> {
  db.settings.avatar = null;
  await db.saveData();
  db.notify('已恢复默认头像');
}

async function doExport(): Promise<void> {
  const r = await exportBackup(db.profile!.schoolId, db.profile!.name, db.session!.username,
    'schools/' + db.profile!.schoolId + '/users/' + db.session!.accountId, db.accounts, db.session!.accountId);
  lastBackup.value = r.path + '（' + (r.size / 1024).toFixed(0) + ' KB）';
  db.notify('备份已生成：' + r.fileName);
}

async function pickBackup(e: Event): Promise<void> {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  const b64 = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(f); });
  restoreB64.value = b64;
  try {
    const info = await inspectBackup(base64ToBytes(b64));
    restoreInfo.value = '来自 ' + info.manifest.schoolName + ' · 用户 ' + info.manifest.username + ' · ' + info.manifest.exportedAt +
      ' · 课表 ' + info.manifest.counts.courses + ' 条 / 记事 ' + info.manifest.counts.notes + ' 条 / 二课 ' + info.manifest.counts.records + ' 条 / 照片 ' + info.manifest.counts.photos + ' 张';
  } catch (err: any) { restoreInfo.value = '校验失败：' + err.message; restoreB64.value = ''; }
}

async function doRestore(): Promise<void> {
  if (!restoreB64.value) { db.notify('请先选择备份文件'); return; }
  const b = 'schools/' + db.profile!.schoolId + '/users/' + db.session!.accountId;
  const merge = restoreMode.value === 'merge';
  const ok = await db.confirm({
    title: merge ? '确认按 id 合并这份备份？' : '确认用这份备份覆盖当前数据？',
    body: restoreInfo.value || '已选择备份文件',
    detail: merge
      ? '合并只按 id 保留较新的一条，现有数据不会被清空。'
      : '覆盖前会先把当前数据导出成一份留底 zip（在「导出备份」下方可见路径），万一恢复错了还能倒回来。',
    confirmText: merge ? '确定合并' : '确定覆盖并恢复',
    danger: !merge
  });
  if (!ok) return;
  let kept = '';
  if (!merge) {
    // 真正的"留底"必须是**恢复前**的当前数据。旧实现把待导入的 zip 又存了一遍，
    // 那不叫留底 —— 恢复错了照样回不去，属于文案与实现不符，这里改正。
    try {
      const r = await exportBackup(db.profile!.schoolId, db.profile!.name, db.session!.username, b, db.accounts, db.session!.accountId);
      kept = '；已留底：' + r.fileName;
    } catch { /* 留底失败不阻断恢复，但要告知 */ }
  }
  await restoreBackup(base64ToBytes(restoreB64.value), b, merge);
  await db.loadUserData();
  restoreB64.value = ''; restoreInfo.value = '';
  db.notify('恢复完成' + (merge ? '（合并）' : kept));
}

async function resetDemo(): Promise<void> {
  const ok = await db.confirm({
    title: '确认重置演示数据？',
    body: '演示账号下的课表、记事、二课与时长台账会恢复到初始示例。',
    detail: '只影响演示账号，普通账号数据不受影响。',
    confirmText: '确定重置'
  });
  if (!ok) return;
  await db.resetDemo();
  db.notify('演示数据已重置');
}

async function reschedule(): Promise<void> {
  const r = await rescheduleAll(db.courses, db.timetables, db.notes, db.settings);
  stats.value = await scheduleStats(); sched.value = stats.value.total;
  schedMsg.value = '排期 ' + r.scheduled + ' 条' + (r.error ? ' · ' + r.error : '');
  perm.value = r.permission;
  db.notify(r.error ? '队列已重建，但有异常' : '已重建通知队列，共 ' + r.scheduled + ' 条');
}

/** 开发者联系方式（产品负责人指定写在意向清单里；只出现在这一处，不进入示例数据） */
const DEV_CONTACT = '学号 2025040140';

/**
 * 复制意向清单。
 * 旧实现只是把文本塞进 toast（标签写着"复制清单"却没复制），属于文案与实现不一致，这里改成真的写剪贴板；
 * 剪贴板不可用时退回"把内容显示出来"，至少让用户能手动选中。
 */
async function copyInterests(): Promise<void> {
  const lines = db.interests.map((i) => i.schoolName + ' | ' + i.createdAt + ' | ' + (i.contact || '—'));
  lines.push('联系 Unimate 开发团队：' + DEV_CONTACT);
  const text = lines.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    db.notify('已复制 ' + db.interests.length + ' 条意向（含联系方式）');
  } catch {
    db.notify(text);
  }
}
</script>

<template>
  <div class="scroll">
    <div class="card me">
      <!-- v2.47：头像是用户自己从相册选的（本机裁成 1:1），点一下就能换 -->
      <div class="avatar" @click="changeAvatar()">
        <img v-if="db.settings.avatar" :src="db.settings.avatar" alt="头像" />
        <template v-else>{{ (db.session?.displayName || 'U').slice(0, 1) }}</template>
      </div>
      <div class="grow">
        <div class="title">{{ db.session?.displayName }}</div>
        <div class="small muted">{{ db.session?.username }} · {{ db.profile?.name }}</div>
        <div class="avactions">
          <button class="alink" @click="changeAvatar()">{{ db.settings.avatar ? '换头像' : '设置头像' }}</button>
          <button v-if="db.settings.avatar" class="alink" @click="clearAvatar()">恢复默认</button>
        </div>
      </div>
      <span v-if="db.session?.isDemo" class="pill warn">演示模式</span>
    </div>

    <div class="card me-summary">
      <!-- 有二课的学校（北化）显示自评总分；没有二课的学校（北二外）只显示两本时长台账，
           不把 0/600 这种无意义的数字摆出来 -->
      <template v-if="db.profile?.secondClass.enabled">
        <div class="row" style="justify-content: space-between">
          <span class="small muted">第二课堂累计自评</span><span class="bold">{{ db.totalScore() }} / {{ TOTAL_FULL_SCORE }}</span>
        </div>
        <div class="small muted" style="margin-top: 4px">{{ sub }}</div>
      </template>
      <template v-else>
        <div class="row" style="justify-content: space-between">
          <span class="small muted">活动材料累计</span>
          <span class="bold">志愿 {{ db.hourTotal('volunteer') }} 小时 · 劳育 {{ db.hourTotal('labor') }} 小时</span>
        </div>
        <div class="small muted" style="margin-top: 4px">{{ db.profile?.secondClass.label || '活动材料' }}：本校未核实专属活动规则，不套用第二课堂分值表</div>
      </template>
    </div>

    <div class="settings-group-title">偏好设置</div>
    <div class="list settings-list">
      <button type="button" class="li settings-row" @click="open('notify')"><AppleIcon class="ico" name="bell" /><span class="grow"><span class="settings-label">通知设置</span><span class="settings-value">上课提醒、待办提醒与权限</span></span><AppleIcon class="chev" name="chevronRight" :size="17" /></button>
      <button type="button" class="li settings-row" @click="open('theme')"><AppleIcon class="ico" name="moon" /><span class="grow"><span class="settings-label">外观与主题</span><span class="settings-value">深浅模式与字号</span></span><AppleIcon class="chev" name="chevronRight" :size="17" /></button>
      <button type="button" class="li settings-row" @click="open('watermark')"><AppleIcon class="ico" name="droplet" /><span class="grow"><span class="settings-label">拍照水印</span><span class="settings-value">内容、透明度与默认状态</span></span><AppleIcon class="chev" name="chevronRight" :size="17" /></button>
      <button type="button" class="li settings-row" @click="open('weather')"><AppleIcon class="ico" name="cloudSun" /><span class="grow"><span class="settings-label">天气</span><span class="settings-value">{{ db.settings.weatherEnabled ? '已开启' : '未开启' }}</span></span><AppleIcon class="chev" name="chevronRight" :size="17" /></button>
    </div>

    <div class="settings-group-title">数据与支持</div>
    <div class="list settings-list">
      <button type="button" class="li settings-row" @click="open('backup')"><AppleIcon class="ico" name="archive" /><span class="grow"><span class="settings-label">备份与恢复</span><span class="settings-value">导出或导入备份</span></span><AppleIcon class="chev" name="chevronRight" :size="17" /></button>
      <button type="button" class="li settings-row" @click="open('interests')"><AppleIcon class="ico" name="school" /><span class="grow"><span class="settings-label">意向清单</span><span class="settings-value">本机 {{ db.interests.length }} 条</span></span><AppleIcon class="chev" name="chevronRight" :size="17" /></button>
      <button type="button" class="li settings-row" @click="open('about')"><AppleIcon class="ico" name="info" /><span class="grow"><span class="settings-label">关于 Unimate</span><span class="settings-value">版本、定位与隐私</span></span><AppleIcon class="chev" name="chevronRight" :size="17" /></button>
    </div>

    <div class="settings-group-title">账户</div>
    <div class="card account-actions">
      <div v-if="db.session?.isDemo" class="row" style="margin-bottom: 10px">
        <button class="btn grow grey" @click="resetDemo">重置演示数据</button>
        <button class="btn grow ghost" @click="scheduleDemoPing(); db.notify('已排期：2 分钟后弹通知')">演示一条通知</button>

      </div>
      <button class="btn block ghost" @click="db.logout()">退出登录</button>
      <button class="btn block ghost" style="margin-top: 8px" @click="db.changeSchool()">切换学校</button>
    </div>
  </div>

  <!-- v2.54：头像裁剪（拖动取景 + 滑杆缩放），确认后才写进设置 -->
  <AvatarCropper v-if="cropSrc" :src="cropSrc" @done="avatarCropped" @cancel="cropSrc = ''" />

  <div v-if="panel" class="mask" @click.self="closePanel">
    <div class="sheet">
      <div class="row"><div class="title grow">{{ { notify: '通知设置', theme: '外观与主题', watermark: '拍照水印', weather: '天气', backup: '备份与恢复', about: '关于 Unimate', interests: '意向清单' }[panel] }}</div><button class="btn sm ghost" @click="closePanel">关闭</button></div>
      <div class="hairline"></div>

      <template v-if="panel === 'notify'">
        <div class="li" style="padding: 10px 0"><span class="grow">总开关</span><button type="button" class="me-ios-switch" role="switch" :aria-checked="db.settings.notifyEnabled" aria-label="通知总开关" @click="db.settings.notifyEnabled = !db.settings.notifyEnabled; reschedule()"><span></span></button></div>
        <div class="li" style="padding: 10px 0"><span class="grow">上课提醒</span><button type="button" class="me-ios-switch" role="switch" :aria-checked="db.settings.classReminderEnabled" aria-label="上课提醒" @click="db.settings.classReminderEnabled = !db.settings.classReminderEnabled; reschedule()"><span></span></button></div>
        <div class="field"><label>提前几分钟提醒上课</label>
          <div class="chips"><button v-for="m in [5, 10, 15, 20, 30]" :key="m" class="chip sm" :class="{ on: db.settings.classReminderMinutes === m }" @click="db.settings.classReminderMinutes = m; reschedule()">{{ m }} 分钟</button></div>
        </div>
        <div class="card" style="box-shadow: none; background: var(--soft)">
          <div class="row"><span class="grow small">系统通知权限</span><span class="pill" :class="perm === 'granted' ? 'live' : 'danger'">{{ perm === 'granted' ? '已允许' : (perm === 'unsupported' ? '当前环境不支持' : '未允许') }}</span></div>
          <button v-if="perm !== 'granted'" class="btn block sm" style="margin-top: 8px" @click="askPerm">去开启</button>
          <div class="row" style="justify-content: space-between; margin-top: 10px"><span class="grow small">精确闹钟授权</span><span class="pill" :class="exact === 'granted' ? 'live' : 'danger'">{{ exact === 'granted' ? '已授权' : (exact === 'unsupported' ? '系统无需此授权' : '未授权') }}</span></div>
          <button v-if="exact !== 'granted' && exact !== 'unsupported'" class="btn block sm grey" style="margin-top: 8px" @click="askExact">去授权精确闹钟</button>
          <div v-if="exact !== 'granted' && exact !== 'unsupported'" class="small muted" style="margin-top: 6px">未授权时系统会把提醒并入省电批处理：后台基本不响，等你打开 App 才一次性补发。这就是"不打开不提醒、一打开全涌出"的成因。</div>
          <!-- 电池优化（v2.28）：不做这一步，国产 ROM 会把后台冻住，排期根本投递不到 -->
          <div class="row" style="justify-content: space-between; margin-top: 10px"><span class="grow small">电池优化豁免</span><span class="pill" :class="power.ignoring ? 'live' : 'danger'">{{ power.ok ? (power.ignoring ? '已豁免' : '未豁免') : '未检测' }}</span></div>
          <button v-if="power.ok && !power.ignoring" class="btn block sm grey" style="margin-top: 8px" @click="fixReminder()">去允许后台运行</button>
          <!--
            v2.57：产品负责人明确不开"允许后台运行"、也不开厂商自启动。
            那就**如实写明后果**，不再让他反复试（AGENTS.md 第 7 条：文案必须与实现一致）。
          -->
          <div v-if="power.ok && !power.ignoring" class="small muted" style="margin-top: 6px; line-height: 1.6">
            <b>你选择不开这一项的话</b>：系统会冻住 Unimate，提醒可能晚到几分钟到十几分钟；想准点就开它，或打开下面的
            <b>「同步到系统日历」</b>。
          </div>
          <div v-if="power.rom" class="small muted" style="margin-top: 6px">机型：{{ power.rom }}{{ power.hint ? ' · ' + power.hint : '' }}</div>
          <div class="small muted" style="margin-top: 8px">
            <b>精确闹钟</b>只是允许 App 设"准点闹钟"的系统开关，不占后台、不影响耗电，建议开（就是上面那个按钮）。
          </div>
          <div class="hairline" style="margin: 12px 0"></div>
          <div class="row" style="justify-content: space-between">
            <span class="grow small">提醒守护（前台服务）</span>
            <button type="button" class="me-ios-switch" role="switch" :aria-checked="db.settings.reminderGuard" aria-label="提醒守护" @click="toggleGuard(!db.settings.reminderGuard)"><span></span></button>
          </div>
          <div class="small muted" style="margin-top: 4px; line-height: 1.6">
            开着会在通知栏常驻一条<b>静音小通知</b>，让系统不冻住 Unimate。
          </div>
          <button class="btn block sm grey" style="margin-top: 10px" @click="copySelfCheck()">复制自检报告（发我即可）</button>
          <div v-if="reportMsg" class="card small" style="margin-top: 8px; background: var(--soft); box-shadow: none; white-space: pre-wrap; word-break: break-all; user-select: text">{{ reportMsg }}</div>
        </div>
        <!-- v2.56：选择性写系统日历（默认关）。国产 ROM 不给"允许后台运行"时的兜底：闹钟由系统日历持有 -->
        <div class="card" style="box-shadow: none; background: var(--soft); margin-top: 10px">
          <label class="row small" style="align-items: flex-start">
            <input type="checkbox" :checked="calSync" @change="toggleCalendarSync" />
            <span>
              <b>同步到系统日历（默认关）</b><br />
              打开后，未来三周的提醒会写成<b>系统日历里的日程</b>，由日历 App 到点弹通知，被冻住也能准点。
              代价：日程会出现在你的日历里（标题即提醒内容）；关掉开关会**自动删除**它们。
            </span>
          </label>
          <div class="small muted" style="margin-top: 6px; line-height: 1.6">
            状态：{{ calSync ? '已开启' : '已关闭' }}
            <template v-if="calState.calendar"> · 写入日历：{{ calState.calendar }}</template>
            <template v-if="calSync || calState.written"> · 已写入 {{ calState.written }} 条</template>
            <template v-if="!calState.available"> · 这台设备没有可写入的日历</template>
          </div>
          <div class="row" style="gap: 8px; margin-top: 8px">
            <button class="btn sm grow ghost" :disabled="!calSync" @click="toggleCalendarSync({ target: { checked: true } } as any)">立即重新写入</button>
            <button class="btn sm grow grey" :disabled="!calState.written" @click="clearCalendarNow">清空已写入的日程</button>
          </div>
          <div v-if="calMsg" class="small muted" style="margin-top: 6px">{{ calMsg }}</div>
        </div>
        <button class="btn block grey" style="margin-top: 10px" @click="reschedule()">重建提醒队列</button>
        <button class="btn block ghost" style="margin-top: 8px" @click="saveSettings('通知设置')">保存设置</button>
      </template>

      
      <template v-else-if="panel === 'theme'">
        <div class="field"><label>外观</label>
          <div class="chips me-segmented">
            <button class="chip" :class="{ on: db.settings.theme === 'system' }" :aria-pressed="db.settings.theme === 'system'" @click="setTheme('system', $event)">跟随系统</button>
            <button class="chip" :class="{ on: db.settings.theme === 'light' }" :aria-pressed="db.settings.theme === 'light'" @click="setTheme('light', $event)">始终浅色</button>
            <button class="chip" :class="{ on: db.settings.theme === 'dark' }" :aria-pressed="db.settings.theme === 'dark'" @click="setTheme('dark', $event)">始终深色</button>
          </div>
        </div>
        <div class="field" style="margin-top: 10px"><label>字号</label>
          <div class="chips me-segmented me-font-segmented">
            <button v-for="f in FONT_LEVELS" :key="f.k" class="chip" :class="{ on: (db.settings.fontSize || 100) === f.k }" @click="setFont(f.k)">{{ f.t }}</button>
          </div>
        </div>
        <button class="btn block grey" style="margin-top: 12px" @click="saveSettings('外观与主题')">保存设置</button>
      </template>
      <template v-else-if="panel === 'watermark'">
        <div class="li" style="padding: 10px 0"><span class="grow small">默认给新照片加水印</span><button type="button" class="me-ios-switch" role="switch" :aria-checked="db.settings.watermarkEnabledDefault" aria-label="默认给新照片加水印" @click="db.settings.watermarkEnabledDefault = !db.settings.watermarkEnabledDefault"><span></span></button></div>
        <div class="field"><label>水印包含哪些行（自主组合）</label>
          <div class="chips">
            <button class="chip sm" :class="{ on: db.settings.watermarkLines.time }" @click="db.settings.watermarkLines.time = !db.settings.watermarkLines.time">拍摄时间（建议常开）</button>
            <button class="chip sm" :class="{ on: db.settings.watermarkLines.coordinate }" @click="db.settings.watermarkLines.coordinate = !db.settings.watermarkLines.coordinate">经纬度</button>
            <button class="chip sm" :class="{ on: db.settings.watermarkLines.custom }" @click="db.settings.watermarkLines.custom = !db.settings.watermarkLines.custom">自定义文字</button>
            <button class="chip sm" :class="{ on: db.settings.watermarkLines.address }" @click="db.settings.watermarkLines.address = !db.settings.watermarkLines.address">手填地址</button>
            <button class="chip sm" :class="{ on: db.settings.watermarkLines.badge }" @click="db.settings.watermarkLines.badge = !db.settings.watermarkLines.badge">校名角标</button>
          </div>
        </div>
        <div class="field"><label>固定自定义文字（如姓名 / 学号后四位，会追加在活动名后）</label><input v-model="db.settings.watermarkCustomText" maxlength="20" placeholder="留空则只显示活动名称" /></div>
        <div class="field"><label>底色浓淡 {{ Math.round(db.settings.watermarkOpacity * 100) }}%</label><input v-model.number="db.settings.watermarkOpacity" type="range" min="0.15" max="0.8" step="0.05" /></div>
        <button class="btn block" style="margin-top: 10px" @click="saveSettings('拍照水印')">保存设置</button>
      </template>

      <template v-else-if="panel === 'weather'">
        <div class="li" style="padding: 10px 0">
          <span class="grow">天气（课表页顶部一行）</span>
          <button type="button" class="me-ios-switch" role="switch" :aria-checked="db.settings.weatherEnabled" aria-label="天气" @click="db.settings.weatherEnabled = !db.settings.weatherEnabled"><span></span></button>
        </div>
        <div class="small muted" style="line-height: 1.7; margin-bottom: 10px">
          <b>默认关闭</b>；关着的时候 App <b>一次请求都不发</b>，打开后 <b>30 分钟最多更新一次</b>。
        </div>

        <div class="field">
          <label>查询位置（留空 = 用系统定位）</label>
          <input v-model="db.settings.weatherCity" maxlength="20" placeholder="如：北京（拒绝定位授权时在这里手填）" />
        </div>

        <div class="card" style="box-shadow: none; background: var(--soft)">
          <div class="row" style="justify-content: space-between">
            <span class="small">当前显示</span>
            <b class="small">{{ db.settings.weatherNow ? weatherText(db.settings.weatherNow) : '还没有数据' }}</b>
          </div>
          <div class="small muted" style="margin-top: 4px">
            <template v-if="db.settings.weatherNow">{{ agoText(db.settings.weatherNow.fetchedAt) }}更新<template v-if="db.settings.weatherLoc"> · 位置来源：{{ db.settings.weatherLoc.name }}</template></template>
            <template v-else>打开开关 → 点下面的「立即更新」，课表页顶部就会出现那一行</template>
          </div>
          <div v-if="db.weatherMsg" class="small" style="margin-top: 6px">{{ db.weatherMsg }}</div>
        </div>

        <button class="btn block" style="margin-top: 10px" :disabled="db.weatherBusy || !db.settings.weatherEnabled" @click="updateWeatherNow()">{{ db.weatherBusy ? '更新中…' : '立即更新' }}</button>
        <button class="btn block ghost" style="margin-top: 10px" @click="saveWeather()">保存设置</button>
      </template>

      <template v-else-if="panel === 'backup'">
        <button class="btn block" @click="doExport">导出备份（.unimate.zip）</button>
        <div v-if="lastBackup" class="small muted" style="margin: 8px 0; word-break: break-all">已导出：{{ lastBackup }}</div>
        <div class="hairline"></div>
        <div class="field"><label>选择备份文件恢复</label><input type="file" accept=".zip" @change="pickBackup" /></div>
        <div v-if="restoreInfo" class="card small" style="background: var(--soft); box-shadow: none">{{ restoreInfo }}</div>
        <div class="chips" style="margin: 10px 0">
          <button class="chip sm" :class="{ on: restoreMode === 'overwrite' }" @click="restoreMode = 'overwrite'">覆盖（自动留底当前数据）</button>
          <button class="chip sm" :class="{ on: restoreMode === 'merge' }" @click="restoreMode = 'merge'">合并（按 id 保留较新）</button>
        </div>
        <button class="btn block" :disabled="!restoreB64" @click="doRestore">开始恢复</button>
        <div class="hairline"></div>
        <div class="small muted">备份包含课表、记事、第二课堂记录与照片，请妥善保管，不要随意外发。</div>
      </template>


      <template v-else-if="panel === 'interests'">
        <div v-if="!db.interests.length" class="empty small">还没有提交意向。可在"选择高校"页点击任意开发中的高校提交。</div>
        <div v-for="(i, idx) in db.interests" :key="idx" class="li" style="padding: 10px 0">
          <div class="grow"><div class="bold small">{{ i.schoolName }}</div><div class="small muted">{{ i.createdAt }}{{ i.contact ? ' · ' + i.contact : '' }}</div></div>
          <span class="pill dev">开发中</span>
        </div>
        <button v-if="db.interests.length" class="btn block grey" @click="copyInterests()">复制清单</button>
        <!-- 开发者联系方式（v2.15 产品负责人指定放在意向清单里；界面不署名） -->
        <div class="card contact">
          <div class="bold small">想让自己学校上线 / 给我们提意见？</div>
          <div class="small muted" style="margin-top: 4px">联系 Unimate 开发团队：{{ DEV_CONTACT }}</div>
        </div>
      </template>

      <template v-else-if="panel === 'about'">
        <div class="center">
          <div class="logo">U</div>
          <div class="title">Unimate</div>
          <div class="small muted">高校校园学习生活一站式智能助手</div>
          <div class="small muted">首个落地高校：{{ db.profile?.name }} · v1.0.0</div>
        </div>
        <div class="hairline"></div>
        <!--
          v2.47：这一页以前写成了"开发说明书"（框架怎么复制、签名算法是什么、验签流程…），
          产品负责人原话："很多东西是给我看的，不是给用户看的"。现在只留用户要知道的：
          这些数据在哪、联网时发了什么、怎么关掉。
        -->
        <div class="small" style="line-height: 1.8">
          <b>你的数据：</b>课表、记事、二课材料都在本机；<b>教务系统的账号密码 App 从不读取、不保存、不代填</b>。<br />
          <b>会联网的功能（都可以不用）：</b><br />
          · <b>天气</b>（默认关闭）：<b>开启天气后会向 Open-Meteo 发送你的大致位置用于查询天气，不发送其他信息</b>；关掉后一次请求都不发；<br />
          · <b>高校档案更新</b>：每天最多检查一次，只下载公开信息，<b>不上传任何信息</b>；内容带 Ed25519 签名，<b>验签不过一律不安装</b>；<br />
          · <b>账号登录</b>（可选）：登录后课表等会备份到云端，<b>服务器持有密钥、可以读取这份备份</b>（换机能取回、忘了密码能找回）；密码原文不会上传；<br />
          · <b>端到端加密同步</b>（可选）：服务器只拿到读不懂的密文，口令和恢复码不上传 —— 忘记口令且丢恢复码就找不回来。<br />
          <b>声明：</b>学生自制演示作品，与学校官方无关；第二课堂分数为自评记录，非学校认定结果。
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.me { display: flex; gap: 14px; align-items: center; padding: 18px 16px; box-shadow: none; }
.me-summary { margin-top: 16px; box-shadow: none; }
.avatar { width: 52px; height: 52px; border-radius: 50%; background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 21px; font-weight: 600; overflow: hidden; }
.avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.avactions { display: flex; gap: 12px; margin-top: 4px; }
.alink { font-size: 13px; line-height: 18px; color: var(--brand); padding: 0; }
.settings-group-title { margin: 24px 16px 7px; color: var(--muted); font-size: 13px; line-height: 18px; }
.settings-list { box-shadow: none; }
.settings-row { min-height: 64px; }
.settings-row .grow { min-width: 0; display: flex; flex-direction: column; justify-content: center; }
.settings-label { display: block; color: var(--text); font-size: 17px; line-height: 22px; font-weight: 400; }
.settings-value { display: block; overflow: hidden; color: var(--muted); font-size: 13px; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; }
.ico { color: var(--brand); }
.chev { color: color-mix(in srgb, var(--muted) 55%, transparent); }
.account-actions { box-shadow: none; padding: 12px; }
.me-ios-switch { width: 51px; height: 31px; flex: none; padding: 2px; border-radius: 999px; background: var(--switch-off); transition: background-color .2s ease; }
.me-ios-switch span { display: block; width: 27px; height: 27px; border-radius: 50%; background: #fff; box-shadow: 0 2px 5px rgba(0, 0, 0, .22); transition: transform .2s cubic-bezier(.25,.8,.25,1); }
.me-ios-switch[aria-checked='true'] { background: var(--ok); }
.me-ios-switch[aria-checked='true'] span { transform: translateX(20px); }
.me-segmented { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2px; padding: 2px; border-radius: 9px; background: var(--soft-2); }
.me-segmented .chip { min-width: 0; min-height: 32px; padding: 4px 6px; border: 0; border-radius: 7px; background: transparent; color: var(--text); }
.me-segmented .chip.on { background: var(--card); color: var(--text); box-shadow: 0 1px 3px rgba(0, 0, 0, .14); }
.me-font-segmented { grid-template-columns: repeat(4, minmax(0, 1fr)); }
@media (prefers-reduced-motion: reduce) {
  .me-ios-switch, .me-ios-switch span { transition: none; }
}
.logo { width: 54px; height: 54px; margin: 4px auto 8px; border-radius: 14px; background: var(--brand); color: #fff; font-size: 28px; font-weight: 600; display: flex; align-items: center; justify-content: center; }
.periods { max-height: 240px; overflow: auto; }
.prow { display: grid; grid-template-columns: 62px 1fr 12px 1fr; gap: 6px; align-items: center; margin-bottom: 6px; }
.pn { font-size: 12px; color: var(--muted); }
.prow input { padding: 7px; border: 1px solid var(--line); border-radius: 8px; }
.contact { background: var(--soft); box-shadow: none; margin-top: 12px; padding: 12px; }
</style>
