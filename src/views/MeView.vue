<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { exportBackup, inspectBackup, restoreBackup, saveEncryptedMigration } from '../services/backup.ts';
import { base64ToBytes, bytesToBase64 } from '../services/zip.ts';
import { configFromRecovery, decryptSync, deriveAccountSyncId, encryptForSync, isTombstone, normalizeAccount, parseRecoveryCode, tombstoneBytes, type EncryptedSync, type SyncConfig } from '../services/syncCrypto.ts';
import { downloadSyncCipher, uploadSyncCipher } from '../services/cloudSync.ts';
import { accountDelete, accountDownload, accountInfo, accountLogin, accountSignup, accountUpload, cloudAccountReady } from '../services/account.ts';
import { guard } from '../services/guard.ts';
import { permissionState, ensurePermission, rescheduleAll, scheduleDemoPing, scheduledCount, scheduleStats, cancelAll, scheduleTest, exactAlarmState, requestExactAlarmSetting, wireSelfCheck, powerStatus, requestIgnoreBattery, selfCheckReport, heartbeatStatus, setReminderGuard, reminderGuardStatus } from '../services/notify.ts';
import { nowStamp } from '../services/id.ts';
import { applyTheme, type ThemeMode } from '../services/theme.ts';
import { FONT_LEVELS, applyTextZoom } from '../services/display.ts';
import { SECOND_CLASS_BLOCKS, TOTAL_FULL_SCORE } from '../catalog/secondClass.ts';
import { agoText, weatherText } from '../services/weather.ts';

const db = useDb();
const panel = ref<'' | 'notify' | 'theme' | 'watermark' | 'weather' | 'backup' | 'sync' | 'about' | 'interests'>('');
const perm = ref('unknown');
const lastBackup = ref('');
const restoreB64 = ref('');
const restoreMode = ref<'overwrite' | 'merge'>('overwrite');
const restoreInfo = ref('');
const syncCode = ref('');
const syncPass = ref('');
const syncPassAgain = ref('');
const syncMsg = ref('');
const syncBusy = ref(false);
const recoveryReveal = ref('');
const recoverySaved = ref(false);
const pendingUpload = ref<EncryptedSync | null>(null);
const pendingSyncConfig = ref<SyncConfig | null>(null);
/** 账号同步（v2.42，A 方案）：账号名会被记住（它只是用来算同步码的），口令与恢复码一样从不落盘。 */
const acct = ref('');
const acctPass = ref('');
const acctPassAgain = ref('');
const pendingUploadAccount = ref('');
const pendingRestoreAccount = ref('');
/**
 * 账号登录（v2.43，服务器托管）：产品负责人明确撤销了"数据只在本机/只上传密文"这条口径，
 * 要求做成普通 App 那样 —— 注册/登录后数据存云端，换台手机登录就有课表。
 * 因此这一路**服务器可以读取备份**（界面必须如实写），换来的是"忘记密码找开发者重置"。
 */
const cloudAcct = ref('');
const cloudPass = ref('');
const cloudConsent = ref(false);
const cloudMsg = ref('');
const cloudBusy = ref(false);
const cloudReady = ref(true);
const cloudMeta = ref({ updatedAt: '', size: 0, sealed: true });
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
const syncStatusText = computed(() => {
  if (!db.settings.sync) return '未开启 · 口令不保存、不上传';
  const name = (db.settings.syncAccount || '').trim();
  return name ? '账号 ' + name + ' · 只上传密文' : '已建立同步 · 只上传密文';
});
const syncPassLabel = computed(() => syncCode.value.startsWith('UM1.') ? '设置新同步口令' : '同步口令');
const syncPrimaryText = computed(() => syncBusy.value ? '处理中…' : (db.settings.sync ? '加密并更新云端备份' : '建立同步并生成恢复码'));
const acctMatchesCurrent = computed(() => {
  const cfg = db.settings.sync;
  if (!cfg || !acct.value.trim()) return false;
  try { return cfg.syncId === deriveAccountSyncId(acct.value); } catch { return false; }
});
const acctPrimaryText = computed(() => syncBusy.value ? '处理中…' : (acctMatchesCurrent.value ? '上传/更新到我的账号' : '用账号同步（建立并上传）'));

async function open(name: typeof panel.value): Promise<void> {
  panel.value = name;
  if (name === 'notify') { await refreshNotifyState(); }
  if (name === 'weather') wxOpened.value = { enabled: db.settings.weatherEnabled, city: (db.settings.weatherCity || '').trim() };
  if (name === 'sync') {
    syncCode.value = db.settings.sync?.syncId || '';
    acct.value = db.settings.syncAccount || '';
    cloudAcct.value = db.settings.cloudAccount?.name || '';
    cloudReady.value = await cloudAccountReady();
    if (db.settings.cloudAccount) cloudMeta.value = await accountInfo(db.settings.cloudAccount).catch(() => cloudMeta.value);
  }
}

function closePanel(): void {
  if (panel.value === 'sync') {
    syncPass.value = '';
    syncPassAgain.value = '';
    acctPass.value = '';
    acctPassAgain.value = '';
    recoveryReveal.value = '';
    recoverySaved.value = false;
    pendingUpload.value = null;
    pendingUploadAccount.value = '';
  }
  panel.value = '';
}

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

function setTheme(t: ThemeMode): void {
  db.settings.theme = t;
  applyTheme(t);
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
}

function onVisible(): void {
  if (!document.hidden && panel.value === 'notify') void refreshNotifyState();
}
onMounted(() => document.addEventListener('visibilitychange', onVisible));
onUnmounted(() => document.removeEventListener('visibilitychange', onVisible));
async function doExport(): Promise<void> {
  const r = await exportBackup(db.profile!.schoolId, db.profile!.name, db.session!.username,
    'schools/' + db.profile!.schoolId + '/users/' + db.session!.accountId, db.accounts, db.session!.accountId);
  lastBackup.value = r.path + '（' + (r.size / 1024).toFixed(0) + ' KB）';
  db.notify('备份已生成：' + r.fileName);
}

function syncBase(): string {
  return 'schools/' + db.profile!.schoolId + '/users/' + db.session!.accountId;
}

async function makeSyncBackup(): Promise<EncryptedSync | null> {
  if (syncPass.value.length < 10) { syncMsg.value = '同步口令至少 10 个字符'; return null; }
  if (syncPass.value !== syncPassAgain.value) { syncMsg.value = '两次输入的同步口令不一致'; return null; }
  const made = await guard('生成同步备份', exportBackup(db.profile!.schoolId, db.profile!.name, db.session!.username,
    syncBase(), db.accounts, db.session!.accountId), 60_000, null);
  if (!made) { syncMsg.value = '生成本地备份超时，请重试'; return null; }
  return encryptForSync(made.bytes, syncPass.value, db.settings.sync || undefined);
}

async function finishSyncUpload(pack: EncryptedSync, account = ''): Promise<void> {
  const previous = db.settings.sync;
  await uploadSyncCipher(pack.config.syncId, pack.bytes);
  const local = await guard('保存加密迁移包', saveEncryptedMigration(pack.bytes, pack.config.syncId), 15_000, null);
  db.settings.sync = pack.config;
  if (account) db.settings.syncAccount = account;
  await db.saveData();
  syncCode.value = pack.config.syncId;
  syncMsg.value = '已上传端到端加密备份' + (local ? '；本机同时保存 ' + local.fileName : '');
  syncPass.value = '';
  syncPassAgain.value = '';
  acctPass.value = '';
  acctPassAgain.value = '';
  pendingUpload.value = null;
  pendingUploadAccount.value = '';
  recoveryReveal.value = '';
  recoverySaved.value = false;
  db.notify('加密同步完成');

  // 从"随机同步码"切到"账号同步"会另起一份云端备份，旧那份留在桶里既没用又占地方。
  // 销毁旧密文是破坏性操作，按硬规则必须二次确认（用户说不要就留着）。
  if (previous && previous.syncId !== pack.config.syncId) {
    const drop = await db.confirm({
      title: '要顺手销毁旧的云端备份吗？',
      body: '这次是把同步方式换成了账号，云端多出一份旧同步码的密文（' + previous.syncId.slice(0, 6) + '…）。',
      detail: '销毁 = 用一条"已删除"标记覆盖旧对象（R2 不开版本控制，原密文即被抹掉），旧同步码/旧恢复码从此失效。' +
        '选"取消"就留着，不影响本次账号同步。',
      confirmText: '销毁旧的那份', cancelText: '留着', danger: true
    });
    if (drop) {
      try {
        await uploadSyncCipher(previous.syncId, tombstoneBytes());
        syncMsg.value += '；旧的云端备份已销毁';
      } catch (e: any) { syncMsg.value += '；旧云端备份销毁失败：' + (e?.message || '未知原因'); }
    }
  }
}

async function prepareSyncUpload(): Promise<void> {
  if (syncBusy.value) return;
  syncBusy.value = true;
  syncMsg.value = '正在本地加密…';
  try {
    const pack = await makeSyncBackup();
    if (!pack) return;
    if (pack.recoveryCode) {
      pendingUpload.value = pack;
      recoveryReveal.value = pack.recoveryCode;
      syncPass.value = '';
      syncPassAgain.value = '';
      syncMsg.value = '先把恢复码另存到安全位置；确认保存后才能上传。';
      return;
    }
    syncMsg.value = '正在上传密文…';
    await finishSyncUpload(pack);
  } catch (e: any) { syncMsg.value = e?.message || '同步失败，请重试'; }
  finally { syncBusy.value = false; }
}

async function confirmRecoveryAndUpload(): Promise<void> {
  if (!pendingUpload.value || !recoverySaved.value || syncBusy.value) return;
  syncBusy.value = true;
  syncMsg.value = '正在上传密文…';
  try { await finishSyncUpload(pendingUpload.value, pendingUploadAccount.value); }
  catch (e: any) { syncMsg.value = e?.message || '上传失败，请重试'; }
  finally { syncBusy.value = false; }
}

/**
 * 账号同步（v2.42，A 方案）：用"账号 + 口令"代替要抄的同步码。
 * 账号名在本机算出同步码，口令不出手机 —— 云端仍然只有密文。
 */
async function accountUpload(): Promise<void> {
  if (syncBusy.value) return;
  const account = normalizeAccount(acct.value);
  if (account.length < 3) { syncMsg.value = '账号至少 3 个字符（换机时要用同一个账号）'; return; }
  if (acctPass.value.length < 10) { syncMsg.value = '口令至少 10 个字符 —— 账号可猜，口令是唯一的秘密'; return; }
  if (!acctMatchesCurrent.value && acctPass.value !== acctPassAgain.value) { syncMsg.value = '两次输入的口令不一致'; return; }
  syncBusy.value = true;
  syncMsg.value = '正在本地加密…';
  try {
    const made = await guard('生成同步备份', exportBackup(db.profile!.schoolId, db.profile!.name, db.session!.username,
      syncBase(), db.accounts, db.session!.accountId), 60_000, null);
    if (!made) { syncMsg.value = '生成本地备份超时，请重试'; return; }
    const pack = await encryptForSync(made.bytes, acctPass.value, db.settings.sync || undefined, account);
    if (pack.recoveryCode) {
      pendingUpload.value = pack;
      pendingUploadAccount.value = account;
      recoveryReveal.value = pack.recoveryCode;
      acctPass.value = '';
      acctPassAgain.value = '';
      syncMsg.value = '先把恢复码另存到安全位置；确认保存后会上传密文。';
      return;
    }
    await finishSyncUpload(pack, account);
  } catch (e: any) { syncMsg.value = e?.message || '账号同步失败，请重试'; }
  finally { syncBusy.value = false; }
}

/** 换机：输账号 + 口令 → 自动定位云端那份密文 → 解密 → 预览 → 二次确认恢复 */
async function accountFetch(): Promise<void> {
  if (syncBusy.value) return;
  const account = normalizeAccount(acct.value);
  if (account.length < 3) { syncMsg.value = '请输入要找回的账号'; return; }
  if (acctPass.value.length < 10) { syncMsg.value = '口令至少 10 个字符'; return; }
  syncBusy.value = true;
  syncMsg.value = '正在下载并在本机解密…';
  try {
    const syncId = deriveAccountSyncId(account);
    const cipher = await downloadSyncCipher(syncId);
    if (isTombstone(cipher)) throw new Error('这个账号的云端备份已被删除，请重新上传一份');
    const opened = await decryptSync(cipher, syncId, acctPass.value);
    const info = await inspectBackup(opened.backup);
    pendingSyncConfig.value = { syncId, passwordWrap: opened.envelope.passwordWrap,
      recoveryWrap: opened.envelope.recoveryWrap, lastUploadedAt: opened.envelope.createdAt };
    pendingRestoreAccount.value = account;
    restoreB64.value = bytesToBase64(opened.backup);
    restoreInfo.value = '账号 ' + account + ' 的云端加密备份 · ' + info.manifest.exportedAt + ' · 课表 ' + info.manifest.counts.courses +
      ' 条 / 记事 ' + info.manifest.counts.notes + ' 条 / 二课 ' + info.manifest.counts.records + ' 条 / 照片 ' + info.manifest.counts.photos + ' 张';
    syncMsg.value = '解密与完整性校验通过。请在下方选择“覆盖”或“合并”，再点开始恢复。';
    acctPass.value = '';
    acctPassAgain.value = '';
  } catch (e: any) { syncMsg.value = e?.message || '找回失败，请重试'; }
  finally { syncBusy.value = false; }
}

/** 删除云端备份（撤回/注销）：二次确认后用墓碑覆盖，密文随之销毁 */
async function deleteCloudBackup(): Promise<void> {
  if (syncBusy.value) return;
  const cfg = db.settings.sync;
  if (!cfg) { syncMsg.value = '本机还没有同步设置'; return; }
  const ok = await db.confirm({
    title: '确认删除云端加密备份？',
    body: '云端那份备份会被一条“已删除”标记覆盖，原密文随之销毁；换机将无法再从云端找回课表。',
    detail: '本机数据不受影响，本机保存的 .umig 文件也不受影响。删除后想继续用云端同步，需要再上传一份。',
    confirmText: '确定删除云端备份', cancelText: '取消，留着', danger: true
  });
  if (!ok) return;
  syncBusy.value = true;
  syncMsg.value = '正在删除云端备份…';
  try {
    await uploadSyncCipher(cfg.syncId, tombstoneBytes());
    syncMsg.value = '云端备份已删除（本机数据与本机 .umig 未受影响）';
    db.notify('云端备份已删除');
  } catch (e: any) { syncMsg.value = e?.message || '删除失败，请重试'; }
  finally { syncBusy.value = false; }
}

async function copyRecoveryCode(): Promise<void> {
  try {
    await navigator.clipboard.writeText(recoveryReveal.value);
    db.notify('恢复码已复制，请另存到安全位置');
  } catch { syncMsg.value = '无法自动复制，请长按恢复码手动复制'; }
}

/* ---------------------------------------------------------------------------
 * 账号登录（v2.43，服务器托管）：普通 App 的做法
 * 注册/登录 → 备份正文存云端（服务器持有落盘密钥、可以读取）→ 换台手机登录就有课表。
 * 代价：忘记密码虽然可以找开发者重置，但"服务器读不到你的数据"这条就不再成立了 —— 界面如实写明。
 * ------------------------------------------------------------------------- */

function cloudSession() { return db.settings.cloudAccount || null; }

async function cloudAfterLogin(): Promise<void> {
  const session = cloudSession();
  if (!session) return;
  cloudPass.value = '';
  cloudAcct.value = session.name;
  cloudMsg.value = '已登录：' + session.name;
  try {
    const meta = await accountInfo(session);
    cloudMeta.value = meta;
    db.settings.cloudAccount = { ...session, updatedAt: meta.updatedAt, size: meta.size };
    await db.saveData();
    if (!meta.size) {
      cloudMsg.value = '已登录 ' + session.name + '。这个账号云端还没有备份，点「上传当前数据到云端」就能把课表存上去。';
      return;
    }
    await cloudRestore();
  } catch (e: any) { cloudMsg.value = (e?.message || '读取云端信息失败') + '（已登录，可稍后重试）'; }
}

async function cloudSignup(): Promise<void> {
  if (cloudBusy.value) return;
  if (!cloudConsent.value) { cloudMsg.value = '请先勾选上面的同意项（数据会存到云端服务器）'; return; }
  if (cloudAcct.value.trim().length < 3) { cloudMsg.value = '账号至少 3 个字符'; return; }
  if (cloudPass.value.length < 8) { cloudMsg.value = '密码至少 8 个字符'; return; }
  cloudBusy.value = true;
  cloudMsg.value = '正在注册…';
  try {
    const session = await accountSignup(cloudAcct.value.trim(), cloudPass.value);
    db.settings.cloudAccount = { ...session };
    await db.saveData();
    cloudMsg.value = '注册成功，正在把当前数据打包上传…';
    await cloudUpload();
  } catch (e: any) { cloudMsg.value = e?.message || '注册失败，请重试'; }
  finally { cloudBusy.value = false; }
}

async function cloudLogin(): Promise<void> {
  if (cloudBusy.value) return;
  if (!cloudConsent.value) { cloudMsg.value = '请先勾选上面的同意项（数据会存到云端服务器）'; return; }
  if (cloudAcct.value.trim().length < 3) { cloudMsg.value = '请输入账号'; return; }
  if (cloudPass.value.length < 8) { cloudMsg.value = '密码至少 8 个字符'; return; }
  cloudBusy.value = true;
  cloudMsg.value = '正在登录…';
  try {
    const session = await accountLogin(cloudAcct.value.trim(), cloudPass.value);
    db.settings.cloudAccount = { ...session };
    await db.saveData();
    await cloudAfterLogin();
  } catch (e: any) { cloudMsg.value = e?.message || '登录失败，请重试'; }
  finally { cloudBusy.value = false; }
}

async function cloudUpload(): Promise<void> {
  const session = cloudSession();
  if (!session || cloudBusy.value) return;
  cloudBusy.value = true;
  cloudMsg.value = '正在打包并上传…';
  try {
    const made = await guard('生成同步备份', exportBackup(db.profile!.schoolId, db.profile!.name, db.session!.username,
      syncBase(), db.accounts, db.session!.accountId), 60_000, null);
    if (!made) { cloudMsg.value = '打包超时，请重试'; return; }
    const meta = await accountUpload(session, made.bytes);
    cloudMeta.value = meta;
    db.settings.cloudAccount = { ...session, updatedAt: meta.updatedAt, size: meta.size };
    await db.saveData();
    cloudMsg.value = '已上传到云端（' + Math.round(meta.size / 1024) + ' KB）· ' +
      (meta.sealed ? '服务端落盘加密已开启' : '注意：服务端未设落盘密钥，靠 R2 自带静态加密');
    db.notify('已上传到云端账号');
  } catch (e: any) { cloudMsg.value = e?.message || '上传失败，请重试'; }
  finally { cloudBusy.value = false; }
}

/** 云端 → 本机：下载后仍走"预览 → 覆盖/合并 → 二次确认"，不因为自动就跳过确认 */
async function cloudRestore(): Promise<void> {
  const session = cloudSession();
  if (!session || cloudBusy.value) return;
  cloudBusy.value = true;
  cloudMsg.value = '正在从云端下载…';
  try {
    const bytes = await accountDownload(session);
    if (!bytes) { cloudMsg.value = '这个账号云端还没有备份'; return; }
    const info = await inspectBackup(bytes);
    restoreB64.value = bytesToBase64(bytes);
    restoreInfo.value = '账号 ' + session.name + ' 的云端备份 · ' + info.manifest.exportedAt + ' · 课表 ' +
      info.manifest.counts.courses + ' 条 / 记事 ' + info.manifest.counts.notes + ' 条 / 二课 ' +
      info.manifest.counts.records + ' 条 / 照片 ' + info.manifest.counts.photos + ' 张';
    cloudMsg.value = '云端备份已下载并校验通过。请在下方选择「覆盖」或「合并」，再点开始恢复。';
  } catch (e: any) { cloudMsg.value = e?.message || '下载失败，请重试'; }
  finally { cloudBusy.value = false; }
}

async function cloudLogout(): Promise<void> {
  db.settings.cloudAccount = null;
  await db.saveData();
  cloudPass.value = '';
  cloudMeta.value = { updatedAt: '', size: 0, sealed: true };
  cloudMsg.value = '已退出登录（云端那份备份还留着，下次登录还能取回）';
}

async function cloudDeleteAccount(): Promise<void> {
  const session = cloudSession();
  if (!session || cloudBusy.value) return;
  const ok = await db.confirm({
    title: '确认注销账号并删除云端数据？',
    body: '账号「' + session.name + '」与它在云端的备份会被一起删除，删掉之后没有任何办法找回。',
    detail: '本机上的课表等数据不受影响（只是不再与云端关联）。如果要保留云端那份，请点「取消」。',
    confirmText: '确定注销并删除', cancelText: '取消，留着', danger: true
  });
  if (!ok) return;
  cloudBusy.value = true;
  cloudMsg.value = '正在注销…';
  try {
    await accountDelete(session);
    db.settings.cloudAccount = null;
    await db.saveData();
    cloudMeta.value = { updatedAt: '', size: 0, sealed: true };
    cloudMsg.value = '账号与云端数据已删除';
    db.notify('账号已注销');
  } catch (e: any) { cloudMsg.value = e?.message || '注销失败，请重试'; }
  finally { cloudBusy.value = false; }
}

async function fetchSyncBackup(): Promise<void> {
  if (syncBusy.value) return;
  const entered = syncCode.value.trim();
  if (!entered) { syncMsg.value = '请输入同步码或完整恢复码'; return; }
  const usingRecovery = entered.startsWith('UM1.');
  if (syncPass.value.length < 10) {
    syncMsg.value = usingRecovery ? '请设置一个至少 10 个字符的新同步口令' : '同步口令至少 10 个字符';
    return;
  }
  syncBusy.value = true;
  syncMsg.value = '正在下载并在本机解密…';
  try {
    const syncId = usingRecovery ? parseRecoveryCode(entered).syncId : entered;
    const cipher = await downloadSyncCipher(syncId);
    const opened = await decryptSync(cipher, entered, syncPass.value);
    const info = await inspectBackup(opened.backup);
    pendingSyncConfig.value = usingRecovery
      ? await configFromRecovery(cipher, entered, syncPass.value)
      : { syncId, passwordWrap: opened.envelope.passwordWrap, recoveryWrap: opened.envelope.recoveryWrap,
          lastUploadedAt: opened.envelope.createdAt };
    restoreB64.value = bytesToBase64(opened.backup);
    restoreInfo.value = '云端加密备份 · ' + info.manifest.exportedAt + ' · 课表 ' + info.manifest.counts.courses +
      ' 条 / 记事 ' + info.manifest.counts.notes + ' 条 / 二课 ' + info.manifest.counts.records + ' 条 / 照片 ' + info.manifest.counts.photos + ' 张';
    syncMsg.value = '解密与完整性校验通过。请在下方选择“覆盖”或“合并”，再点开始恢复。';
    syncPass.value = '';
    syncPassAgain.value = '';
  } catch (e: any) { syncMsg.value = e?.message || '下载恢复失败'; }
  finally { syncBusy.value = false; }
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
  if (pendingSyncConfig.value) {
    db.settings.sync = pendingSyncConfig.value;
    // 用账号找回的，把账号名也记住 —— 它只是"在本机算同步码"的参数，不是秘密
    if (pendingRestoreAccount.value) db.settings.syncAccount = pendingRestoreAccount.value;
    await db.saveData();
    syncCode.value = pendingSyncConfig.value.syncId;
    pendingSyncConfig.value = null;
    pendingRestoreAccount.value = '';
  }
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
      <div class="avatar">{{ (db.session?.displayName || 'U').slice(0, 1) }}</div>
      <div class="grow">
        <div class="title">{{ db.session?.displayName }}</div>
        <div class="small muted">{{ db.session?.username }} · {{ db.profile?.name }}</div>
      </div>
      <span v-if="db.session?.isDemo" class="pill warn">演示模式</span>
    </div>

    <div class="card" style="margin-top: 10px">
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

    <div class="list" style="margin-top: 10px">
      <div class="li" @click="open('notify')"><span class="ico">🔔</span><div class="grow"><div class="bold">通知设置</div><div class="small muted">上课提醒 / 待办提醒 / 权限状态</div></div><span>›</span></div>
      <div class="li" @click="open('theme')"><span class="ico">🌗</span><div class="grow"><div class="bold">外观与主题</div><div class="small muted">跟随系统深色 / 常浅 / 常深 · 字号（小 / 标准 / 大 / 特大）</div></div><span class="chev">›</span></div>
<div class="li" @click="open('watermark')"><span class="ico">💧</span><div class="grow"><div class="bold">拍照水印</div><div class="small muted">自主开关水印内容与样式</div></div><span>›</span></div>
      <div class="li" @click="open('weather')"><span class="ico">🌤️</span><div class="grow"><div class="bold">天气</div><div class="small muted">{{ db.settings.weatherEnabled ? '已开启 · 课表页顶部一行天气' : '默认关闭 · 打开后课表页顶部显示一行天气' }}</div></div><span>›</span></div>
      <div class="li" @click="open('backup')"><span class="ico">💾</span><div class="grow"><div class="bold">备份与恢复</div><div class="small muted">导出 / 导入 .unimate.zip</div></div><span>›</span></div>
      <div class="li" @click="open('sync')"><span class="ico">🔐</span><div class="grow"><div class="bold">加密换机同步</div><div class="small muted">{{ syncStatusText }}</div></div><span>›</span></div>
      <div class="li" @click="open('interests')"><span class="ico">🏫</span><div class="grow"><div class="bold">意向清单</div><div class="small muted">已提交意向的高校（本机 {{ db.interests.length }} 条）</div></div><span>›</span></div>
      <div class="li" @click="open('about')"><span class="ico">ℹ️</span><div class="grow"><div class="bold">关于 Unimate</div><div class="small muted">版本、定位与隐私说明</div></div><span>›</span></div>
    </div>

    <div class="card" style="margin-top: 10px">
      <div v-if="db.session?.isDemo" class="row" style="margin-bottom: 10px">
        <button class="btn grow grey" @click="resetDemo">重置演示数据</button>
        <button class="btn grow ghost" @click="scheduleDemoPing(); db.notify('已排期：2 分钟后弹通知')">演示一条通知</button>

      </div>
      <button class="btn block ghost" @click="db.logout()">退出登录</button>
      <button class="btn block ghost" style="margin-top: 8px" @click="db.changeSchool()">切换学校</button>
    </div>
  </div>

  <div v-if="panel" class="mask" @click.self="closePanel">
    <div class="sheet">
      <div class="row"><div class="title grow">{{ { notify: '通知设置', watermark: '拍照水印', weather: '天气', backup: '备份与恢复', sync: '加密换机同步', about: '关于 Unimate', interests: '意向清单' }[panel] }}</div><button class="btn sm ghost" @click="closePanel">关闭</button></div>
      <div class="hairline"></div>

      <template v-if="panel === 'notify'">
        <div class="li" style="padding: 10px 0"><span class="grow">总开关</span><button class="chip sm" :class="{ on: db.settings.notifyEnabled }" @click="db.settings.notifyEnabled = !db.settings.notifyEnabled; reschedule()">{{ db.settings.notifyEnabled ? '开' : '关' }}</button></div>
        <div class="li" style="padding: 10px 0"><span class="grow">上课提醒</span><button class="chip sm" :class="{ on: db.settings.classReminderEnabled }" @click="db.settings.classReminderEnabled = !db.settings.classReminderEnabled; reschedule()">{{ db.settings.classReminderEnabled ? '开' : '关' }}</button></div>
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
          <div v-if="power.rom" class="small muted" style="margin-top: 6px">机型：{{ power.rom }}{{ power.hint ? ' · ' + power.hint : '' }}</div>
          <div class="small muted" style="margin-top: 8px">
            <b>精确闹钟不是自启动</b>：它只是允许 App 设"准点闹钟"的系统开关，不占后台、不影响耗电与隐私，建议开（上面那个按钮就是）。
            电池优化豁免（允许后台运行）是第二项。<br />
            厂商的"自启动 / 后台保留"是第三项，<b>不想开也可以</b>——代价是提醒可能晚几分钟到十几分钟，
            App 侧的 15 分钟兜底心跳会尽量补投（下面能看到它有没有在跑）。
          </div>
        </div>
        <div class="card" style="box-shadow: none; background: var(--soft); margin-top: 10px">
          <div class="row" style="justify-content: space-between"><span class="small">系统已排期提醒</span><b class="small">{{ sched }} 条</b></div>
          <div class="small muted" style="margin-top: 4px">上课 {{ stats.classReminders }} · 待办 {{ stats.todoReminders }} · 测试 {{ stats.testReminders }}<template v-if="stats.nextFireAt">；下一条 {{ stats.nextFireAt }}</template></div>
          <div class="row" style="justify-content: space-between; margin-top: 4px"><span class="small">提醒时刻自检</span><span class="pill" :class="wire.ok ? 'live' : 'danger'">{{ wire.ok ? '正常' : '异常' }}</span></div>
          <div v-if="!wire.ok" class="small muted" style="margin-top: 4px">{{ wire.hint }}（样本 {{ wire.sample }}）</div>

          <div class="row" style="justify-content: space-between; margin-top: 4px"><span class="small">最近一次重建结果</span><span class="small">{{ schedMsg || '—' }}</span></div>
          <!-- 冷启动清理结果（v2.30）：missed 就是"系统把闹钟攒着没投递"的硬证据 -->
          <div v-if="db.notifyCleanup.at" class="small muted" style="margin-top: 6px">
            上次启动清理：取消 {{ db.notifyCleanup.cancelled }} 条过期排期<template v-if="db.notifyCleanup.missed">，其中 <b>{{ db.notifyCleanup.missed }} 条本该响过、但系统一直没投递</b>（这就是"到点不响、一打开才补发"的直接证据）</template>。
            <template v-if="db.notifyCleanup.missed">建议按上面的「精确闹钟授权」「电池优化豁免」两项去开；App 侧另有 15 分钟兜底心跳会自动补投（最多晚 15 分钟）。</template>
          </div>
          <!-- 兜底心跳状态（v2.31）：光有代码不算数，真机上要看得到它在跑 -->
          <div class="row" style="justify-content: space-between; margin-top: 6px"><span class="small">兜底心跳</span>
            <span class="pill" :class="hb.ok ? (hb.armed ? 'live' : 'danger') : 'dev'">{{ hb.ok ? (hb.armed ? '已排' : '未排') : '未检测' }}</span>
          </div>
          <div v-if="hb.ok" class="small muted" style="margin-top: 4px">
            下一跳 {{ hb.nextAt ? new Date(hb.nextAt).toTimeString().slice(0, 5) : '—' }} · 累计补投 {{ hb.totalPosted }} 条<template v-if="hb.lastPostedCount">（上次 {{ hb.lastPostedCount }} 条）</template>
          </div>
          <!-- 提醒守护前台服务（v2.34）：三项系统开关全开仍"只有打开 App 才收到提醒"时的最后一道保活 -->
          <div class="row" style="justify-content: space-between; margin-top: 8px">
            <span class="grow small">提醒守护（前台服务）</span>
            <button class="chip sm" :class="{ on: db.settings.reminderGuard }" @click="toggleGuard(!db.settings.reminderGuard)">{{ db.settings.reminderGuard ? '开' : '关' }}</button>
          </div>
          <div class="small muted" style="margin-top: 4px; line-height: 1.6">
            开启后通知栏会常驻一条<b>静音小通知</b>（"Unimate 提醒运行中"），让系统不把 App 冻住 ——
            这是国产 ROM 上唯一还能由 App 自己做到的保活手段。状态：{{ guardState.ok ? (guardState.running ? '正在运行' : (guardState.enabled ? '已开但没跑起来' : '已关闭')) : '未检测' }}。<br />
            关掉也能用，只是提醒可能晚到，或等你打开 App 时才补发。
          </div>
          <button class="btn block sm grey" style="margin-top: 10px" @click="copySelfCheck()">复制自检报告（发我即可）</button>
          <div v-if="reportMsg" class="card small" style="margin-top: 8px; background: var(--soft); box-shadow: none; white-space: pre-wrap; word-break: break-all; user-select: text">{{ reportMsg }}</div>
          <div class="row" style="gap: 8px; margin-top: 10px">
            <button class="btn sm grow" @click="test(1)">测试提醒（1 分钟）</button>
            <button class="btn sm grey grow" @click="test(2)">2 分钟</button>
            <button class="btn sm danger grow" @click="clearAll()">清空排期</button>
          </div>
          <div class="small muted" style="margin-top: 8px">测试提醒会在指定时间弹一条系统横幅通知。若到点没弹：先看上面「下一条」时间是否已过，再确认系统设置里 Unimate 的通知横幅已开启。</div>
        </div>
        <button class="btn block grey" style="margin-top: 10px" @click="reschedule()">重建提醒队列</button>
        <button class="btn block ghost" style="margin-top: 8px" @click="saveSettings('通知设置')">保存设置</button>
      </template>

      
      <template v-else-if="panel === 'theme'">
        <div class="field"><label>外观</label>
          <div class="chips">
            <button class="chip" :class="{ on: db.settings.theme === 'system' }" @click="setTheme('system')">跟随系统</button>
            <button class="chip" :class="{ on: db.settings.theme === 'light' }" @click="setTheme('light')">始终浅色</button>
            <button class="chip" :class="{ on: db.settings.theme === 'dark' }" @click="setTheme('dark')">始终深色</button>
          </div>
        </div>
        <div class="field" style="margin-top: 10px"><label>字号</label>
          <div class="chips">
            <button v-for="f in FONT_LEVELS" :key="f.k" class="chip" :class="{ on: (db.settings.fontSize || 100) === f.k }" @click="setFont(f.k)">{{ f.t }}</button>
          </div>
        </div>
        <div class="small muted" style="margin-top: 4px; line-height: 1.7">
          选「跟随系统」时，手机开深色模式 App 会立刻跟着变，不用重启。<br />
          深色下页面底色、卡片、输入框与文字会整体换一套；课表色块保持原色（白字对比度已够），不做额外降饱和。<br />
          字号用系统 WebView 的 textZoom，只放大文字、不改布局，所以课表格子不会被挤歪；切换后立即生效，无需重启。
        </div>
        <button class="btn block grey" style="margin-top: 12px" @click="saveSettings('外观与主题')">保存设置</button>
      </template>
      <template v-else-if="panel === 'watermark'">
        <div class="li" style="padding: 10px 0"><span class="grow small">默认给新照片加水印</span><button class="chip sm" :class="{ on: db.settings.watermarkEnabledDefault }" @click="db.settings.watermarkEnabledDefault = !db.settings.watermarkEnabledDefault">{{ db.settings.watermarkEnabledDefault ? '开' : '关' }}</button></div>
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
        <div class="small muted">不使用任何第三方地图服务与 Key，因此离线也能加水印；每条记录仍可单独关掉水印。</div>
        <button class="btn block" style="margin-top: 10px" @click="saveSettings('拍照水印')">保存设置</button>
      </template>

      <template v-else-if="panel === 'weather'">
        <div class="li" style="padding: 10px 0">
          <span class="grow">天气（课表页顶部一行）</span>
          <button class="chip sm" :class="{ on: db.settings.weatherEnabled }" @click="db.settings.weatherEnabled = !db.settings.weatherEnabled">{{ db.settings.weatherEnabled ? '开' : '关' }}</button>
        </div>
        <div class="small muted" style="line-height: 1.7; margin-bottom: 10px">
          <b>默认关闭</b>，打开后课表页顶部才出现一行天气。<br />
          关着的时候 App <b>一次请求都不发</b>；打开后 <b>30 分钟最多更新一次</b>（失败也算一次，不会在没网时反复试）。<br />
          打开开关或改城市后保存，会<b>立刻</b>拉一次；其它时候点「保存设置」不会重复请求。
        </div>

        <div class="field">
          <label>查询位置（留空 = 用系统定位）</label>
          <input v-model="db.settings.weatherCity" maxlength="20" placeholder="如：北京（拒绝定位授权时在这里手填）" />
        </div>
        <div class="small muted" style="margin-bottom: 10px">
          留空时用系统定位（会申请定位权限）；填了城市名就只按你填的查，<b>不再申请定位权限</b>。
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
          <div class="small muted" style="margin-top: 6px">
            课表页那张卡点一下也会更新，同样受 30 分钟限制；要立刻重拉就点这里的「立即更新」。
          </div>
        </div>

        <button class="btn block" style="margin-top: 10px" :disabled="db.weatherBusy || !db.settings.weatherEnabled" @click="updateWeatherNow()">{{ db.weatherBusy ? '更新中…' : '立即更新' }}</button>
        <div v-if="!db.settings.weatherEnabled" class="small muted" style="margin-top: 6px">天气现在是关闭状态，点它也不会发请求 —— 先打开上面的开关。</div>
        <div class="small muted" style="margin-top: 10px; line-height: 1.7">
          数据来自 Open-Meteo（免费、免注册、不用 Key）。只把<b>大致坐标</b>（或你手填的城市名）发过去查天气，
          不带账号、课表、设备号；断网或接口失败时显示上次结果 + "x 分钟前更新"，不影响其它功能。
        </div>
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

      <template v-else-if="panel === 'sync'">
        <div class="card small" style="background: var(--soft); box-shadow: none; line-height: 1.7">
          两种云端备份，自己选（都不需要教务系统密码；本机数据始终是完整的一份，断网照常用）：<br />
          <b>① 账号登录（云端备份）</b>：换机输账号密码就能取回课表，忘记密码可以找开发者重置 ——
          代价是<b>服务器持有密钥、能读到备份内容</b>。<br />
          <b>② 端到端加密同步</b>：服务器只拿到读不懂的密文，口令不离开手机 ——
          代价是<b>忘记口令且恢复码丢失就找不回来</b>。
        </div>

        <div class="card" style="margin-top: 10px; box-shadow: none">
          <div class="bold">账号登录（云端备份）</div>
          <div class="small muted" style="margin-top: 4px; line-height: 1.7">
            像普通 App 一样：注册 / 登录后，课表等数据保存在云端服务器，<b>换台手机登录就能取回课表</b>；
            忘记密码可以找开发者重置。<br />
            代价要说明白：<b>服务端存的是可读取的备份</b>（落盘加密由服务端密钥完成），不再是"服务器读不懂"。
          </div>
          <div class="field" style="margin-top: 10px"><label>账号</label><input v-model.trim="cloudAcct" autocomplete="off" placeholder="3~64 个字符" /></div>
          <div class="field"><label>密码</label><input v-model="cloudPass" type="password" autocomplete="off" placeholder="至少 8 个字符，App 不会保存" /></div>
          <label class="row small" style="margin-top: 4px">
            <input v-model="cloudConsent" type="checkbox" />
            <span>我同意把课表、记事、二课材料与照片上传到云端备份（服务器持有密钥、可以读取，用于换机与找回）</span>
          </label>
          <button class="btn block" style="margin-top: 10px" :disabled="cloudBusy || !cloudConsent" @click="cloudLogin">登录</button>
          <button class="btn block ghost" style="margin-top: 8px" :disabled="cloudBusy || !cloudConsent" @click="cloudSignup">注册并上传当前数据</button>
          <div v-if="!cloudReady" class="small muted" style="margin-top: 8px">
            提示：服务器上的账号接口还没部署（需要重新部署 Worker + 拖一次 Pages 包）。
          </div>
          <template v-if="db.settings.cloudAccount">
            <div class="hairline" style="margin: 12px 0"></div>
            <div class="small muted" style="line-height: 1.7">
              已登录：<b>{{ db.settings.cloudAccount.name }}</b>
              <template v-if="cloudMeta.updatedAt"><br />云端备份：{{ cloudMeta.updatedAt }} · {{ Math.round(cloudMeta.size / 1024) }} KB ·
                {{ cloudMeta.sealed ? '落盘加密已开启' : '未设落盘密钥' }}</template>
            </div>
            <button class="btn block" style="margin-top: 8px" :disabled="cloudBusy" @click="cloudUpload">上传当前数据到云端</button>
            <button class="btn block ghost" style="margin-top: 8px" :disabled="cloudBusy" @click="cloudRestore">从云端恢复到本机</button>
            <button class="btn block grey sm" style="margin-top: 8px" :disabled="cloudBusy" @click="cloudLogout">退出登录</button>
            <button class="btn block grey sm" style="margin-top: 8px" :disabled="cloudBusy" @click="cloudDeleteAccount">注销账号并删除云端数据</button>
          </template>
          <div v-if="cloudMsg" class="card small" style="margin-top: 10px; box-shadow: none; background: var(--soft)">{{ cloudMsg }}</div>
        </div>

        <div class="card" style="margin-top: 10px; box-shadow: none">
          <div class="bold">端到端加密同步（服务器读不懂）</div>
          <div class="small muted" style="margin-top: 4px; line-height: 1.7">
            另一条路：不发密码给服务器，用"账号 + 口令"在本机算出同步码。云端只有密文，
            <b>但忘记口令且恢复码丢失就没人能救</b>。隐私优先就选这条。
          </div>
          <div class="field" style="margin-top: 10px"><label>账号</label><input v-model.trim="acct" autocomplete="off" placeholder="3~64 个字符，随便起（别用学号当口令）" /></div>
          <div class="field"><label>口令</label><input v-model="acctPass" type="password" autocomplete="off" placeholder="至少 10 个字符，App 不会保存" /></div>
          <div v-if="!acctMatchesCurrent" class="field"><label>再次输入口令</label><input v-model="acctPassAgain" type="password" autocomplete="off" placeholder="两次要一致" /></div>
          <button class="btn block" :disabled="syncBusy" @click="accountUpload">{{ acctPrimaryText }}</button>
          <button class="btn block ghost" style="margin-top: 8px" :disabled="syncBusy" @click="accountFetch">用账号找回课表（换机）</button>
          <div v-if="db.settings.syncAccount" class="small muted" style="margin-top: 8px">
            当前账号：<b>{{ db.settings.syncAccount }}</b> · 只上传密文，云端读不懂
          </div>
        </div>

        <div class="card" style="margin-top: 10px; box-shadow: none; background: var(--soft)">
          <div class="bold small">恢复码 / 同步码（兜底手段）</div>
          <div class="small muted" style="margin-top: 4px; line-height: 1.7">
            忘了账号或口令时，用当初保存的恢复码照样能把课表拿回来。
          </div>
          <div class="field" style="margin-top: 10px"><label>同步码或完整恢复码</label><input v-model.trim="syncCode" autocomplete="off" placeholder="粘贴恢复码（UM1.…）或同步码" /></div>
          <div class="field"><label>{{ syncPassLabel }}</label><input v-model="syncPass" type="password" autocomplete="off" placeholder="至少 10 个字符，App 不会保存" /></div>
          <div class="field"><label>再次输入口令</label><input v-model="syncPassAgain" type="password" autocomplete="off" placeholder="上传时需一致" /></div>
          <button class="btn block ghost" :disabled="syncBusy" @click="prepareSyncUpload">{{ syncPrimaryText }}</button>
          <button class="btn block ghost" style="margin-top: 8px" :disabled="syncBusy || !syncCode" @click="fetchSyncBackup">用同步码下载、解密并预览</button>
        </div>

        <div v-if="recoveryReveal" class="card" style="margin-top: 10px; box-shadow: none; background: var(--soft)">
          <div class="bold small">恢复码（只在本机本次显示）</div>
          <div class="small" style="margin-top: 6px; word-break: break-all; user-select: text">{{ recoveryReveal }}</div>
          <button class="btn block ghost sm" style="margin-top: 8px" @click="copyRecoveryCode">复制恢复码</button>
          <label class="row small" style="margin-top: 10px"><input v-model="recoverySaved" type="checkbox" /> <span>我已把恢复码另存到安全位置</span></label>
          <button class="btn block" style="margin-top: 8px" :disabled="!recoverySaved || syncBusy" @click="confirmRecoveryAndUpload">确认并上传密文</button>
        </div>
        <div v-if="syncMsg" class="card small" style="margin-top: 10px; box-shadow: none; background: var(--soft)">{{ syncMsg }}</div>

        <template v-if="restoreB64">
          <div class="hairline"></div>
          <div class="card small" style="background: var(--soft); box-shadow: none">{{ restoreInfo }}</div>
          <div class="chips" style="margin: 10px 0">
            <button class="chip sm" :class="{ on: restoreMode === 'overwrite' }" @click="restoreMode = 'overwrite'">覆盖（自动留底）</button>
            <button class="chip sm" :class="{ on: restoreMode === 'merge' }" @click="restoreMode = 'merge'">合并（按 id）</button>
          </div>
          <button class="btn block" @click="doRestore">开始恢复</button>
        </template>
        <div v-if="db.settings.sync" style="margin-top: 10px">
          <button class="btn block grey sm" :disabled="syncBusy" @click="deleteCloudBackup">删除云端备份（撤回）</button>
        </div>
        <div class="small muted" style="margin-top: 10px; line-height: 1.7">每次上传都会同时在本机生成一份加密 .umig 文件；断网时仍可通过系统文件分享完成换机。</div>
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
        <div class="small" style="line-height: 1.8">
          <b>我们想做的事：</b>把大学里高频却分散的"课表、待办、第二课堂材料、在线教学平台、教务系统"收进一个 App，并做成<b>可复制到不同高校的框架</b>——每所学校的差异收敛到一份高校档案与一个数据适配器，先做好北化，再按校推进。<br /><br />
          <b>隐私：</b>本机数据默认不对外发送；<b>教务系统的账号密码不读取、不保存、不代填</b>；不使用第三方地图 Key；无埋点、无上报。<br />
          App 自己的联网功能有三类：<b>天气</b>（默认关闭，开关在「我的 → 天气」）：<b>开启天气后会向 Open-Meteo 发送你的大致位置用于查询天气，不发送其他信息</b>，关掉开关后一次请求都不发；<br />
          <b>高校档案更新</b>：在「选择高校」页每天最多检查一次，只从本项目自己的站点下载<b>公开的学校档案</b>（校名、官网地址、节次表），<b>不上传任何信息</b>；下载内容带 Ed25519 签名，验签不过一律不安装。<br />
          <b>账号登录（可选，普通 App 模式）</b>：注册并登录后，课表、记事、二课材料与照片会备份到云端服务器（Cloudflare，境外节点），
          <b>服务端持有落盘密钥、可以读取这些内容</b>，用于换机取回与找回；你的<b>密码原文不上传</b>（本地派生校验值）。
          不想要这一项就别开它。<br />
          <b>端到端加密同步（可选）</b>：仅在你点上传或下载时联网；密文经 <b>unimate3.pages.dev</b> 中转后保存在 Cloudflare R2。服务器只保存 AES-256-GCM 密文，
          <b>同步账号、口令和恢复码不上传、不保存</b>（账号名只在本机用于推算备份位置）。口令与恢复码遗失后无法找回 —— 因为服务端没有钥匙。<br />
          （你在「北化通」里打开的教务/教学系统网页属于你主动访问，不由 App 上传数据。）<br /><br />
          <b>声明：</b>本项目为学生自制演示作品，与学校官方无关；第二课堂分数为自评记录，非学校认定结果。
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.me { display: flex; gap: 12px; align-items: center; }
.avatar { width: 46px; height: 46px; border-radius: 14px; background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 21px; font-weight: 700; }
.ico { font-size: 19px; }
.logo { width: 54px; height: 54px; margin: 4px auto 8px; border-radius: 16px; background: linear-gradient(135deg, #2E5AAC, #4E7BD6); color: #fff; font-size: 30px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.periods { max-height: 240px; overflow: auto; }
.prow { display: grid; grid-template-columns: 62px 1fr 12px 1fr; gap: 6px; align-items: center; margin-bottom: 6px; }
.pn { font-size: 12px; color: var(--muted); }
.prow input { padding: 7px; border: 1px solid var(--line); border-radius: 8px; }
.contact { background: var(--soft); box-shadow: none; margin-top: 12px; padding: 12px; }
</style>
