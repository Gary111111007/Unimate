<script setup lang="ts">
/**
 * 账号与找回（v2.47）。
 *
 * 产品负责人要求：这一块不要放在「我的」里，挪到主页上一个**很小**的入口；
 * 名字不要再叫"加密换机同步"，就当"账号找回"用；进来第一件事是**读取本机备份文件**。
 *
 * 所以这里按他给的顺序排：
 *   ① 从本机文件恢复（选 .unimate.zip / .umig → 预览 → 覆盖/合并 → 恢复）
 *   ② 用账号从云端取回（账号 + 密码）
 *   ③ 云端备份管理（已登录时：自动同步开关 / 上传 / 退出 / 注销）
 *   ④ 高级：端到端加密同步（服务器读不懂，默认折叠；能力没删，只是不占版面）
 */
import { computed, ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { exportBackup, inspectBackup, restoreBackup, saveEncryptedMigration } from '../services/backup.ts';
import { base64ToBytes, bytesToBase64 } from '../services/zip.ts';
import { configFromRecovery, decryptSync, deriveAccountSyncId, encryptForSync, isTombstone, normalizeAccount, parseRecoveryCode, tombstoneBytes, type EncryptedSync, type SyncConfig } from '../services/syncCrypto.ts';
import { downloadSyncCipher, uploadSyncCipher } from '../services/cloudSync.ts';
import { accountDelete, accountDownload, accountInfo, accountLogin, cloudAccountReady } from '../services/account.ts';
import { adoptBlockedReason, adoptCloudBackup, previewCloudBackup } from '../services/cloudAdopt.ts';
import { autoSyncState, syncNow } from '../services/cloudAutoSync.ts';
import { guard } from '../services/guard.ts';

const db = useDb();

const fileB64 = ref('');
const fileInfo = ref('');
const mode = ref<'overwrite' | 'merge'>('overwrite');
const msg = ref('');
const busy = ref(false);

const cloudAcct = ref('');
const cloudPass = ref('');
const cloudMsg = ref('');
const cloudMeta = ref({ updatedAt: '', size: 0, sealed: true });
const cloudReady = ref(true);
const showAdvanced = ref(false);

// 端到端加密（高级）那一套
const syncCode = ref('');
const syncPass = ref('');
const syncPassAgain = ref('');
const syncMsg = ref('');
const acct = ref('');
const acctPass = ref('');
const acctPassAgain = ref('');
const recoveryReveal = ref('');
const recoverySaved = ref(false);
const pendingUpload = ref<EncryptedSync | null>(null);
const pendingSyncConfig = ref<SyncConfig | null>(null);
const pendingUploadAccount = ref('');
const pendingRestoreAccount = ref('');

const cloudSession = computed(() => db.settings.cloudAccount || null);
const autoSyncText = computed(() => {
  const s = autoSyncState.value;
  if (!db.settings.cloudAccount) return '未登录云端账号';
  if (db.settings.cloudAutoSync === false) return '已关闭 —— 关掉后一次请求都不发';
  if (s.state === 'syncing') return '正在同步…（服务器可能有点慢）';
  if (s.state === 'error') return '同步失败：' + s.message;
  if (s.state === 'skipped') return s.message;
  if (s.state === 'ok' && s.at) return s.message;
  return '改动课表后会自动上传（15 秒内多次改动合成一次）';
});
const syncPassLabel = computed(() => syncCode.value.startsWith('UM1.') ? '设置新同步口令' : '同步口令');
const syncPrimaryText = computed(() => busy.value ? '处理中…' : (db.settings.sync ? '加密并更新云端备份' : '建立同步并生成恢复码'));
const acctMatchesCurrent = computed(() => {
  const cfg = db.settings.sync;
  if (!cfg || !acct.value.trim()) return false;
  try { return cfg.syncId === deriveAccountSyncId(acct.value); } catch { return false; }
});
const acctPrimaryText = computed(() => busy.value ? '处理中…' : (acctMatchesCurrent.value ? '上传/更新到我的账号' : '用账号同步（建立并上传）'));

const userBase = computed(() => (db.profile && db.session)
  ? 'schools/' + db.profile.schoolId + '/users/' + db.session.accountId : '');

function open(): void {
  msg.value = '';
  cloudMsg.value = '';
  cloudAcct.value = db.settings.cloudAccount?.name || '';
  void (async () => {
    cloudReady.value = await cloudAccountReady();
    if (db.settings.cloudAccount) cloudMeta.value = await accountInfo(db.settings.cloudAccount).catch(() => cloudMeta.value);
  })();
}

/* ---------------- ① 从本机文件恢复 ---------------- */

async function pickFile(e: Event): Promise<void> {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  const b64 = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(f); });
  fileB64.value = b64;
  try {
    const info = await inspectBackup(base64ToBytes(b64));
    fileInfo.value = '来自「' + info.manifest.schoolName + '」 · 用户 ' + info.manifest.username + ' · ' + info.manifest.exportedAt +
      ' · 课表 ' + info.manifest.counts.courses + ' 条 / 记事 ' + info.manifest.counts.notes + ' 条 / 二课 ' +
      info.manifest.counts.records + ' 条 / 照片 ' + info.manifest.counts.photos + ' 张';
    msg.value = '文件读取成功，确认下面这份内容后点「开始恢复」。';
  } catch (err: any) { fileInfo.value = '校验失败：' + err.message; fileB64.value = ''; }
}

async function restoreFromFile(): Promise<void> {
  if (!fileB64.value) { msg.value = '请先选择备份文件'; return; }
  const bytes = base64ToBytes(fileB64.value);
  /*
   * v2.48：在**登录页**打开这个面板时（还没进 App），这份文件就是"换机备份" ——
   * 走和云端取回完全一样的落地流程：读清单 → 接管/新建本机账号 → 绑定高校 → 恢复 → 进主界面。
   * 这样"离线换机"（用系统分享把 .unimate.zip 传过来）就成立了，不需要先登录。
   */
  if (!db.session || !db.profile) {
    busy.value = true;
    msg.value = '正在读取备份…';
    try {
      const preview = await previewCloudBackup(bytes, db);
      const blocked = adoptBlockedReason(preview.manifest, db);
      if (blocked) { msg.value = blocked; return; }
      const m = preview.manifest;
      const ok = await db.confirm({
        title: '确认用这份备份恢复并进入？',
        body: '来自「' + m.schoolName + '」的账号 ' + m.username + ' · 备份时间 ' + m.exportedAt + ' · 课表 ' + m.counts.courses +
          ' 条 / 记事 ' + m.counts.notes + ' 条 / 二课 ' + m.counts.records + ' 条 / 照片 ' + m.counts.photos + ' 张。',
        detail: preview.willOverwrite
          ? '本机这个账号已有数据，会用这份备份覆盖它。'
          : '会接管/新建本机账号并直接进主界面；本机其它账号的数据不受影响。',
        confirmText: '恢复并进入', cancelText: '取消', danger: preview.willOverwrite
      });
      if (!ok) { msg.value = '已取消'; return; }
      msg.value = '正在恢复到本机（照片多时更慢，请稍等）…';
      await adoptCloudBackup(bytes, db, null);
      db.closeRecovery();
    } catch (e: any) { msg.value = e?.message || '恢复失败'; }
    finally { busy.value = false; }
    return;
  }
  const merge = mode.value === 'merge';
  const ok = await db.confirm({
    title: merge ? '确认按 id 合并这份备份？' : '确认用这份备份覆盖当前数据？',
    body: fileInfo.value || '已选择备份文件',
    detail: merge ? '合并只按 id 保留较新的一条，现有数据不会被清空。'
      : '覆盖前会先把当前数据导出成一份留底 zip（可在「我的 → 备份与恢复」看到），万一恢复错了还能倒回来。',
    confirmText: merge ? '确定合并' : '确定覆盖并恢复', danger: !merge
  });
  if (!ok) return;
  busy.value = true;
  msg.value = '正在恢复…';
  try {
    let kept = '';
    if (!merge) {
      try {
        const r = await exportBackup(db.profile.schoolId, db.profile.name, db.session.username, userBase.value, db.accounts, db.session.accountId);
        kept = '；已留底：' + r.fileName;
      } catch { /* 留底失败不阻断恢复 */ }
    }
    await restoreBackup(bytes, userBase.value, merge);
    await db.loadUserData();
    fileB64.value = ''; fileInfo.value = '';
    msg.value = '恢复完成' + (merge ? '（合并）' : kept);
    db.notify('恢复完成');
  } catch (e: any) { msg.value = e?.message || '恢复失败'; }
  finally { busy.value = false; }
}

/* ---------------- ② 用账号从云端取回 ---------------- */

async function fetchFromCloud(): Promise<void> {
  if (busy.value) return;
  const name = cloudAcct.value.trim();
  if (name.length < 3) { cloudMsg.value = '请输入账号'; return; }
  if (cloudPass.value.length < 8) { cloudMsg.value = '密码至少 8 个字符'; return; }
  busy.value = true;
  cloudMsg.value = '正在登录（服务器可能有点慢，请勿退出）…';
  try {
    const session = await accountLogin(name, cloudPass.value);
    const meta = await accountInfo(session);
    if (!meta.size) {
      db.settings.cloudAccount = { ...session };
      await db.saveData();
      cloudMsg.value = '这个账号云端还没有备份（已登录，进去后会自动上传当前数据）';
      return;
    }
    cloudMsg.value = '正在从云端下载（数据越大越慢，请勿退出）…';
    const bytes = await accountDownload(session);
    if (!bytes) { cloudMsg.value = '这个账号云端还没有备份'; return; }
    const preview = await previewCloudBackup(bytes, db);
    const blocked = adoptBlockedReason(preview.manifest, db);
    if (blocked) { cloudMsg.value = blocked; return; }
    const m = preview.manifest;
    const ok = await db.confirm({
      title: preview.willOverwrite ? '确认用云端备份覆盖本机数据？' : '确认取回这份云端备份？',
      body: '来自「' + m.schoolName + '」的账号 ' + m.username + ' · 备份时间 ' + m.exportedAt + ' · 课表 ' + m.counts.courses +
        ' 条 / 记事 ' + m.counts.notes + ' 条 / 二课 ' + m.counts.records + ' 条 / 照片 ' + m.counts.photos + ' 张。',
      detail: preview.willOverwrite ? '本机这个账号已有数据，取回会用云端那份覆盖它。' : '取回后会把课表直接装好；本机其它账号的数据不受影响。',
      confirmText: '取回', cancelText: '取消', danger: preview.willOverwrite
    });
    if (!ok) { cloudMsg.value = '已取消'; return; }
    cloudMsg.value = '正在恢复到本机（照片多时更慢）…';
    await adoptCloudBackup(bytes, db, session);
    db.closeRecovery();
  } catch (e: any) { cloudMsg.value = e?.message || '取回失败，请重试'; }
  finally { busy.value = false; }
}

/* ---------------- ③ 云端备份管理 ---------------- */

async function uploadNow(): Promise<void> {
  if (!cloudSession.value || busy.value) return;
  busy.value = true;
  cloudMsg.value = '正在打包并上传（服务器可能有点慢，请稍等）…';
  try {
    const result = await syncNow();
    await db.saveData();
    cloudMeta.value = { updatedAt: db.settings.cloudAccount?.updatedAt || '', size: db.settings.cloudAccount?.size || 0, sealed: cloudMeta.value.sealed };
    if (result.state === 'error') { cloudMsg.value = result.message; return; }
    cloudMsg.value = '已上传到云端（' + Math.round((db.settings.cloudAccount?.size || 0) / 1024) + ' KB）';
    db.notify('已上传到云端账号');
  } catch (e: any) { cloudMsg.value = e?.message || '上传失败，请重试'; }
  finally { busy.value = false; }
}

async function toggleAutoSync(e: Event): Promise<void> {
  db.settings.cloudAutoSync = (e.target as HTMLInputElement).checked;
  await db.saveData();
}

async function logoutCloud(): Promise<void> {
  db.settings.cloudAccount = null;
  await db.saveData();
  cloudPass.value = '';
  cloudMeta.value = { updatedAt: '', size: 0, sealed: true };
  cloudMsg.value = '已退出账号（云端那份备份还留着，下次登录还能取回）';
}

async function deleteCloudAccount(): Promise<void> {
  const session = cloudSession.value;
  if (!session || busy.value) return;
  const ok = await db.confirm({
    title: '确认注销账号并删除云端数据？',
    body: '账号「' + session.name + '」与它在云端的备份会被一起删除，删掉之后没有任何办法找回。',
    detail: '本机上的课表等数据不受影响（只是不再与云端关联）。要保留云端那份就点「取消」。',
    confirmText: '确定注销并删除', cancelText: '取消，留着', danger: true
  });
  if (!ok) return;
  busy.value = true;
  cloudMsg.value = '正在注销…';
  try {
    await accountDelete(session);
    db.settings.cloudAccount = null;
    await db.saveData();
    cloudMeta.value = { updatedAt: '', size: 0, sealed: true };
    cloudMsg.value = '账号与云端数据已删除';
    db.notify('账号已注销');
  } catch (e: any) { cloudMsg.value = e?.message || '注销失败，请重试'; }
  finally { busy.value = false; }
}

/* ---------------- ④ 高级：端到端加密 ---------------- */

async function e2eeUpload(): Promise<void> {
  if (busy.value) return;
  if (!db.session || !db.profile) { syncMsg.value = '请先登录'; return; }
  const account = normalizeAccount(acct.value);
  if (account.length < 3) { syncMsg.value = '账号至少 3 个字符'; return; }
  if (acctPass.value.length < 10) { syncMsg.value = '口令至少 10 个字符'; return; }
  if (!acctMatchesCurrent.value && acctPass.value !== acctPassAgain.value) { syncMsg.value = '两次输入的口令不一致'; return; }
  busy.value = true;
  syncMsg.value = '正在本地加密…';
  try {
    const made = await guard('生成同步备份', exportBackup(db.profile.schoolId, db.profile.name, db.session.username,
      userBase.value, db.accounts, db.session.accountId), 60_000, null);
    if (!made) { syncMsg.value = '生成本地备份超时，请重试'; return; }
    const pack = await encryptForSync(made.bytes, acctPass.value, db.settings.sync || undefined, account);
    if (pack.recoveryCode) {
      pendingUpload.value = pack;
      pendingUploadAccount.value = account;
      recoveryReveal.value = pack.recoveryCode;
      acctPass.value = ''; acctPassAgain.value = '';
      syncMsg.value = '先把恢复码另存到安全位置；确认保存后会上传密文。';
      return;
    }
    await finishE2eeUpload(pack, account);
  } catch (e: any) { syncMsg.value = e?.message || '同步失败，请重试'; }
  finally { busy.value = false; }
}

async function finishE2eeUpload(pack: EncryptedSync, account = ''): Promise<void> {
  const previous = db.settings.sync;
  await uploadSyncCipher(pack.config.syncId, pack.bytes);
  const local = await guard('保存加密迁移包', saveEncryptedMigration(pack.bytes, pack.config.syncId), 15_000, null);
  db.settings.sync = pack.config;
  if (account) db.settings.syncAccount = account;
  await db.saveData();
  syncCode.value = pack.config.syncId;
  syncMsg.value = '已上传端到端加密备份' + (local ? '；本机同时保存 ' + local.fileName : '');
  acctPass.value = ''; acctPassAgain.value = '';
  pendingUpload.value = null; pendingUploadAccount.value = '';
  recoveryReveal.value = ''; recoverySaved.value = false;
  db.notify('加密同步完成');
  if (previous && previous.syncId !== pack.config.syncId) {
    const drop = await db.confirm({
      title: '要顺手销毁旧的云端备份吗？',
      body: '这次把同步方式换成了账号，云端多出一份旧同步码的密文（' + previous.syncId.slice(0, 6) + '…）。',
      detail: '销毁 = 用一条"已删除"标记覆盖旧对象（R2 不开版本控制，原密文即被抹掉），旧同步码与旧恢复码从此失效。',
      confirmText: '销毁旧的那份', cancelText: '留着', danger: true
    });
    if (drop) {
      try { await uploadSyncCipher(previous.syncId, tombstoneBytes()); syncMsg.value += '；旧的云端备份已销毁'; }
      catch (e: any) { syncMsg.value += '；旧云端备份销毁失败：' + (e?.message || '未知原因'); }
    }
  }
}

async function confirmRecoveryAndUpload(): Promise<void> {
  if (!pendingUpload.value || !recoverySaved.value || busy.value) return;
  busy.value = true;
  syncMsg.value = '正在上传密文…';
  try { await finishE2eeUpload(pendingUpload.value, pendingUploadAccount.value); }
  catch (e: any) { syncMsg.value = e?.message || '上传失败，请重试'; }
  finally { busy.value = false; }
}

async function e2eeFetch(): Promise<void> {
  if (busy.value) return;
  const account = normalizeAccount(acct.value);
  if (account.length < 3) { syncMsg.value = '请输入账号'; return; }
  if (acctPass.value.length < 10) { syncMsg.value = '口令至少 10 个字符'; return; }
  busy.value = true;
  syncMsg.value = '正在下载并在本机解密…';
  try {
    const syncId = deriveAccountSyncId(account);
    const cipher = await downloadSyncCipher(syncId);
    if (isTombstone(cipher)) throw new Error('这个账号的云端备份已被删除，请重新上传一份');
    const opened = await decryptSync(cipher, syncId, acctPass.value);
    const info = await inspectBackup(opened.backup);
    pendingSyncConfig.value = { syncId, passwordWrap: opened.envelope.passwordWrap, recoveryWrap: opened.envelope.recoveryWrap, lastUploadedAt: opened.envelope.createdAt };
    pendingRestoreAccount.value = account;
    fileB64.value = bytesToBase64(opened.backup);
    fileInfo.value = '账号 ' + account + ' 的加密备份 · ' + info.manifest.exportedAt + ' · 课表 ' + info.manifest.counts.courses + ' 条';
    syncMsg.value = '解密校验通过。请用上面（① 从本机文件恢复）的「开始恢复」。';
    acctPass.value = ''; acctPassAgain.value = '';
  } catch (e: any) { syncMsg.value = e?.message || '找回失败，请重试'; }
  finally { busy.value = false; }
}

async function fetchBySyncCode(): Promise<void> {
  if (busy.value) return;
  const entered = syncCode.value.trim();
  if (!entered) { syncMsg.value = '请输入同步码或完整恢复码'; return; }
  const usingRecovery = entered.startsWith('UM1.');
  if (syncPass.value.length < 10) { syncMsg.value = usingRecovery ? '请设置一个至少 10 个字符的新口令' : '口令至少 10 个字符'; return; }
  busy.value = true;
  syncMsg.value = '正在下载并在本机解密…';
  try {
    const syncId = usingRecovery ? parseRecoveryCode(entered).syncId : entered;
    const cipher = await downloadSyncCipher(syncId);
    const opened = await decryptSync(cipher, entered, syncPass.value);
    const info = await inspectBackup(opened.backup);
    pendingSyncConfig.value = usingRecovery
      ? await configFromRecovery(cipher, entered, syncPass.value)
      : { syncId, passwordWrap: opened.envelope.passwordWrap, recoveryWrap: opened.envelope.recoveryWrap, lastUploadedAt: opened.envelope.createdAt };
    fileB64.value = bytesToBase64(opened.backup);
    fileInfo.value = '云端加密备份 · ' + info.manifest.exportedAt + ' · 课表 ' + info.manifest.counts.courses + ' 条';
    syncMsg.value = '解密校验通过。请用上面①的「开始恢复」。';
    syncPass.value = ''; syncPassAgain.value = '';
  } catch (e: any) { syncMsg.value = e?.message || '下载恢复失败'; }
  finally { busy.value = false; }
}

async function deleteCloudBackup(): Promise<void> {
  const cfg = db.settings.sync;
  if (!cfg || busy.value) return;
  const ok = await db.confirm({
    title: '确认删除云端加密备份？',
    body: '云端那份备份会被一条"已删除"标记覆盖，原密文随之销毁；换机将无法再从云端找回。',
    detail: '本机数据不受影响。删除后想继续用，需要再上传一份。',
    confirmText: '确定删除', cancelText: '取消，留着', danger: true
  });
  if (!ok) return;
  busy.value = true;
  syncMsg.value = '正在删除…';
  try {
    await uploadSyncCipher(cfg.syncId, tombstoneBytes());
    syncMsg.value = '云端备份已删除';
    db.notify('云端备份已删除');
  } catch (e: any) { syncMsg.value = e?.message || '删除失败，请重试'; }
  finally { busy.value = false; }
}

async function copyRecoveryCode(): Promise<void> {
  try { await navigator.clipboard.writeText(recoveryReveal.value); db.notify('恢复码已复制'); }
  catch { syncMsg.value = '无法自动复制，请长按恢复码手动复制'; }
}

async function doFileRestoreWithPending(): Promise<void> {
  await restoreFromFile();
  if (db.settings.sync && pendingSyncConfig.value) {
    db.settings.sync = pendingSyncConfig.value;
    if (pendingRestoreAccount.value) db.settings.syncAccount = pendingRestoreAccount.value;
    await db.saveData();
    pendingSyncConfig.value = null;
    pendingRestoreAccount.value = '';
  }
}
</script>

<template>
  <div v-if="db.recoveryOpen" class="mask" @click.self="db.closeRecovery()">
    <div class="sheet">
      <div class="row"><div class="title grow">账号与找回</div><button class="btn sm ghost" @click="db.closeRecovery()">关闭</button></div>

      <div class="small muted" style="margin-top: 6px; line-height: 1.7">
        换手机时：<b>读备份文件</b>，或者<b>用账号从云端取回</b>。服务器可能有点慢，请勿中途退出。
      </div>

      <!-- ① 从本机文件恢复（产品负责人指定放第一位）：在登录页打开时它同时是"离线换机"入口 -->
      <div class="card" style="margin-top: 12px; box-shadow: none">
        <div class="bold">① 从本机文件恢复</div>
        <div class="small muted" style="margin-top: 4px">
          选之前导出的 <b>.unimate.zip</b>（或第②步取回的备份）→ 预览 → 恢复。
          还没登录也能用：选完会问你要不要接管成新的本机账号，直接进主界面。
        </div>
        <div class="field" style="margin-top: 10px"><label>备份文件</label><input type="file" accept=".zip,.umig" @change="pickFile" /></div>
        <div v-if="fileInfo" class="card small" style="background: var(--soft); box-shadow: none">{{ fileInfo }}</div>
        <div class="chips" style="margin: 10px 0">
          <button class="chip sm" :class="{ on: mode === 'overwrite' }" @click="mode = 'overwrite'">覆盖（自动留底）</button>
          <button class="chip sm" :class="{ on: mode === 'merge' }" @click="mode = 'merge'">合并（按 id）</button>
        </div>
        <button class="btn block" :disabled="!fileB64 || busy" @click="doFileRestoreWithPending">开始恢复</button>
        <div v-if="msg" class="small muted" style="margin-top: 8px">{{ msg }}</div>
      </div>

      <!-- ② 用账号从云端取回 -->
      <div class="card" style="margin-top: 10px; box-shadow: none">
        <div class="bold">② 用账号从云端取回</div>
        <div class="small muted" style="margin-top: 4px; line-height: 1.7">
          账号模式下<b>服务端存的是可读取的备份</b>（服务器持有密钥），所以换机能取回、忘了密码还能找开发者重置。
        </div>
        <div class="field" style="margin-top: 10px"><label>账号</label><input v-model.trim="cloudAcct" autocomplete="off" placeholder="3~64 个字符" /></div>
        <div class="field"><label>密码</label><input v-model="cloudPass" type="password" autocomplete="off" placeholder="至少 8 个字符，App 不会保存" /></div>
        <button class="btn block" :disabled="busy" @click="fetchFromCloud">{{ busy ? '取回中，请勿退出…' : '取回云端课表' }}</button>
        <div class="small muted" style="margin-top: 8px">服务器可能有点慢，通常十几秒到一分钟（照片越多越慢）。</div>
        <div v-if="cloudMsg" class="small muted" style="margin-top: 8px">{{ cloudMsg }}</div>
      </div>

      <!-- ③ 云端备份管理 -->
      <div class="card" style="margin-top: 10px; box-shadow: none">
        <div class="bold small">③ 我账号的云端备份</div>
        <template v-if="cloudSession">
          <div class="small muted" style="margin-top: 6px; line-height: 1.7">
            已登录：<b>{{ cloudSession.name }}</b>
            <template v-if="cloudMeta.updatedAt"><br />云端备份：{{ cloudMeta.updatedAt }} · {{ Math.round(cloudMeta.size / 1024) }} KB ·
              {{ cloudMeta.sealed ? '落盘加密已开启' : '未设落盘密钥' }}</template>
          </div>
          <label class="row small" style="margin-top: 10px">
            <input type="checkbox" :checked="db.settings.cloudAutoSync !== false" @change="toggleAutoSync" />
            <span>改完课表自动同步（关掉后一次请求都不发）</span>
          </label>
          <div class="small muted" style="margin-top: 6px">自动同步：{{ autoSyncText }}</div>
          <button class="btn block ghost" style="margin-top: 8px" :disabled="busy" @click="uploadNow">立即上传当前数据</button>
          <button class="btn block grey sm" style="margin-top: 8px" :disabled="busy" @click="logoutCloud">退出账号</button>
          <button class="btn block grey sm" style="margin-top: 8px" :disabled="busy" @click="deleteCloudAccount">注销账号并删除云端数据</button>
        </template>
        <template v-else>
          <div class="small muted" style="margin-top: 6px">还没登录账号。用上面的②登录后，这里会显示云端备份并支持自动同步。</div>
          <div v-if="!cloudReady" class="small muted" style="margin-top: 6px">提示：服务器上的账号接口还没部署。</div>
        </template>
      </div>

      <!-- ④ 高级：端到端加密 -->
      <button class="btn block grey sm" style="margin-top: 10px" @click="showAdvanced = !showAdvanced">
        {{ showAdvanced ? '收起高级选项' : '高级：端到端加密同步（服务器读不懂）' }}
      </button>
      <template v-if="showAdvanced">
        <div class="card" style="margin-top: 10px; box-shadow: none">
          <div class="small muted" style="line-height: 1.7">
            不发密码给服务器：用"账号 + 口令"在本机算出同步码，云端只有密文。<b>忘记口令且恢复码丢失就没人能救。</b>
          </div>
          <div class="field" style="margin-top: 10px"><label>账号</label><input v-model.trim="acct" autocomplete="off" placeholder="3~64 个字符" /></div>
          <div class="field"><label>口令</label><input v-model="acctPass" type="password" autocomplete="off" placeholder="至少 10 个字符" /></div>
          <div v-if="!acctMatchesCurrent" class="field"><label>再次输入口令</label><input v-model="acctPassAgain" type="password" autocomplete="off" placeholder="两次要一致" /></div>
          <button class="btn block" :disabled="busy" @click="e2eeUpload">{{ acctPrimaryText }}</button>
          <button class="btn block ghost" style="margin-top: 8px" :disabled="busy" @click="e2eeFetch">用账号找回（换机）</button>
        </div>
        <div class="card" style="margin-top: 10px; box-shadow: none; background: var(--soft)">
          <div class="bold small">恢复码 / 同步码</div>
          <div class="field" style="margin-top: 10px"><label>同步码或完整恢复码</label><input v-model.trim="syncCode" autocomplete="off" placeholder="UM1.… 或 22 位同步码" /></div>
          <div class="field"><label>{{ syncPassLabel }}</label><input v-model="syncPass" type="password" autocomplete="off" placeholder="至少 10 个字符" /></div>
          <div class="field"><label>再次输入口令</label><input v-model="syncPassAgain" type="password" autocomplete="off" placeholder="上传时需一致" /></div>
          <button class="btn block ghost" :disabled="busy" @click="fetchBySyncCode">{{ syncPrimaryText }}</button>
        </div>
        <div v-if="recoveryReveal" class="card" style="margin-top: 10px; box-shadow: none; background: var(--soft)">
          <div class="bold small">恢复码（只在本机本次显示）</div>
          <div class="small" style="margin-top: 6px; word-break: break-all; user-select: text">{{ recoveryReveal }}</div>
          <button class="btn block ghost sm" style="margin-top: 8px" @click="copyRecoveryCode">复制恢复码</button>
          <label class="row small" style="margin-top: 10px"><input v-model="recoverySaved" type="checkbox" /> <span>我已把恢复码另存到安全位置</span></label>
          <button class="btn block" style="margin-top: 8px" :disabled="!recoverySaved || busy" @click="confirmRecoveryAndUpload">确认并上传密文</button>
        </div>
        <div v-if="syncMsg" class="small muted" style="margin-top: 8px">{{ syncMsg }}</div>
        <div v-if="db.settings.sync" style="margin-top: 10px">
          <button class="btn block grey sm" :disabled="busy" @click="deleteCloudBackup">删除云端加密备份（撤回）</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.mask { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); display: flex; align-items: flex-end; z-index: 120; }
.sheet { width: 100%; max-height: 88vh; overflow: auto; background: var(--card); border-radius: 16px 16px 0 0; padding: 14px 14px calc(18px + var(--safe-b)); }
.title { font-size: 16px; font-weight: 700; }
</style>
