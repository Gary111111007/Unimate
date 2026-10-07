<script setup lang="ts">
import { ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { isNativeWebView } from '../services/jwwebview.ts';
import { accountDownload, accountInfo, accountLogin, accountSignup } from '../services/account.ts';
import { adoptBlockedReason, adoptCloudBackup, previewCloudBackup } from '../services/cloudAdopt.ts';

const db = useDb();
/**
 * 公网演示站（v2.22）：浏览器里打开时给一句明确交代 ——
 * 数据默认只在这台设备的浏览器里；用户主动启用换机同步时只上传端到端加密密文。
 * 评审/同学第一次打开不用猜"这是不是真能用的版本"。
 */
const isWeb = !isNativeWebView();
/**
 * v2.46：登录页"二合一" —— 本机登录 / 创建本机账号 / 云端取回 三种入口收进同一张卡，
 * 不再上下堆两张卡（产品负责人反馈"这个界面二合一一下"）。演示账号按钮保留。
 */
/**
 * v2.48：登录页只有三样东西 —— 「账号登录」「注册账号」「用演示账号登录」，再加一行「账号与找回」。
 *
 * 为什么可以不再给"本机登录"留入口：**登录态是持久化的**（session 存在 manifest.json 里，boot 会恢复），
 * 所以正常打开 App 根本不会回到这一页 —— 只有首次使用、退出登录之后才会。
 * 产品负责人原话："第一次登录要联网，后续打开就不用了；后续也就在退出登录跟切换学校要联网。"
 */
const mode = ref<'login' | 'register'>('login');
const username = ref('');
const password = ref('');
const displayName = ref('');
/**
 * v2.44：开机登录页也能直接用 Unimate 账号取回课表 —— 产品负责人要的"一个登录就全好"。
 * 换新手机：装 APK → 这里输云账号 + 密码 → 云端备份自动取回 → 直接进主界面。
 */
const cloudUser = ref('');
const cloudPass = ref('');
const cloudPassAgain = ref('');
const cloudConsent = ref(false);
const cloudMsg = ref('');
const cloudBusy = ref(false);

async function cloudSignIn(): Promise<void> {
  if (cloudBusy.value) return;
  const name = cloudUser.value.trim();
  if (name.length < 3) { cloudMsg.value = '请输入 Unimate 账号'; return; }
  if (cloudPass.value.length < 8) { cloudMsg.value = '密码至少 8 个字符'; return; }
  cloudBusy.value = true;
  cloudMsg.value = '正在登录（服务器可能有点慢，请勿退出）…';
  try {
    const session = await accountLogin(name, cloudPass.value);
    const meta = await accountInfo(session);
    if (!meta.size) {
      // 云端还没备份 = 新账号第一次登录：在本机建一个同名账号，直接进去选学校
      cloudMsg.value = '这个账号云端还没有备份，正在为你准备本机账号…';
      await enterAsNewAccount(name, cloudPass.value, session);
      return;
    }
    cloudMsg.value = '正在从云端下载备份（数据越大越慢，请勿退出）…';
    const bytes = await accountDownload(session);
    if (!bytes) { cloudMsg.value = '这个账号云端还没有备份'; return; }
    const preview = await previewCloudBackup(bytes, db);
    const blocked = adoptBlockedReason(preview.manifest, db);
    if (blocked) { cloudMsg.value = blocked; return; }
    const m = preview.manifest;
    const ok = await db.confirm({
      title: preview.willOverwrite ? '确认用云端备份覆盖本机数据？' : '确认取回这份云端备份？',
      body: '来自「' + m.schoolName + '」的账号 ' + m.username + ' · 备份时间 ' + m.exportedAt +
        ' · 课表 ' + m.counts.courses + ' 条 / 记事 ' + m.counts.notes + ' 条 / 二课 ' + m.counts.records + ' 条 / 照片 ' + m.counts.photos + ' 张。',
      detail: preview.willOverwrite
        ? '本机这个账号已经有数据，取回会用云端那份覆盖它（原账号口令不变）。'
        : '取回后会新建/接管本机账号并直接把课表装好；本机原有其它账号的数据不受影响。',
      confirmText: '取回并进入', cancelText: '取消', danger: preview.willOverwrite
    });
    if (!ok) { cloudMsg.value = '已取消'; return; }
    cloudMsg.value = '正在恢复到本机（照片多时更慢，请稍等）…';
    await adoptCloudBackup(bytes, db, session);
    cloudMsg.value = '已取回云端课表，正在进入…';
  } catch (e: any) { cloudMsg.value = e?.message || '云端登录失败，请重试'; }
  finally { cloudBusy.value = false; }
}

/**
 * 新账号第一次登录（云端还没有备份）：在本机建一个同名账号再进去选高校。
 * 本机密码用同一个 —— 这样断网时还能从"本机已有账号"那条小路进来，不用记两套密码。
 */
async function enterAsNewAccount(name: string, password: string, session: { account: string; token: string; id: string; updatedAt: string; size: number }): Promise<void> {
  const localName = name.slice(0, 20);   // 本机账号名上限 20 字符
  if (!db.accounts.some((a) => a.username === localName)) {
    const created = await db.register(localName, password, localName);
    if (!created) { cloudMsg.value = '本机账号创建失败，请换个账号名再试'; return; }
  }
  const ok = await db.login(localName, password);
  if (!ok) { cloudMsg.value = '本机账号登录失败，请重试'; return; }
  db.settings.cloudAccount = { ...session };
  await db.saveData();
  cloudMsg.value = '已登录，接下来选择你的高校';
}

/** 注册账号：先建云账号，再按上面那条路进本机（同意项由界面上的勾选把关） */
async function cloudRegister(): Promise<void> {
  if (cloudBusy.value) return;
  const name = cloudUser.value.trim();
  if (name.length < 3) { cloudMsg.value = '账号至少 3 个字符'; return; }
  if (cloudPass.value.length < 8) { cloudMsg.value = '密码至少 8 个字符'; return; }
  if (cloudPass.value !== cloudPassAgain.value) { cloudMsg.value = '两次输入的密码不一致'; return; }
  if (!cloudConsent.value) { cloudMsg.value = '请先勾选下面的同意项'; return; }
  cloudBusy.value = true;
  cloudMsg.value = '正在注册（服务器可能有点慢，请勿退出）…';
  try {
    const session = await accountSignup(name, cloudPass.value);
    await enterAsNewAccount(name, cloudPass.value, session);
  } catch (e: any) { cloudMsg.value = e?.message || '注册失败，请重试'; }
  finally { cloudBusy.value = false; }
}

async function submit(): Promise<void> {
  const u = username.value.trim();
  await db.login(u, password.value);
}

async function useDemo(): Promise<void> {
  const demo = await db.ensureDemoAccount();
  if (!demo) { db.notify('演示账号初始化失败，请查看页面下方的错误信息'); return; }
  username.value = 'admin';
  password.value = 'buct';
  await db.login('admin', 'buct');
  /*
   * v2.47：演示账号**每次都回到选校页**。
   * 以前演示账号第一次登录会让选校，之后因为账号已绑定高校就直接进主界面 ——
   * 产品负责人报的"用演示账号登录进去之后选择学校怎么没了"就是这个。
   * 演示的用途本来就是"给人看几所学校"，所以固定让它走一遍选校。
   */
  await db.changeSchool();
}
</script>

<template>
  <div class="screen">
    <div class="top">
      <div class="schoolname">请登录/注册您的 Unimate 账号</div>
    </div>

    <div class="body">
      <div v-if="isWeb" class="demobar">
        <b>演示站</b>：数据默认只存在你这台设备的浏览器里，不采集；只有你自己开「账号登录」或「端到端加密同步」时才会联网备份。<br />
        装 APK（或点下方演示账号）可体验完整功能，含课前提醒、拍照水印等。
      </div>
      <div class="logo">U</div>
      <div class="title">登录 Unimate</div>
      <div class="muted small center">登录后选择你的高校；课表 / 待办提醒 / 第二课堂 / 校园在线，一个 App 搞定</div>

      <div class="card form">
        <div class="tabs">
          <button :class="{ on: mode === 'login' }" @click="mode = 'login'">账号登录</button>
          <button :class="{ on: mode === 'register' }" @click="mode = 'register'">注册账号</button>
        </div>

        <div class="field"><label>Unimate 账号</label><input v-model.trim="cloudUser" autocomplete="off" placeholder="输入您的账号" /></div>
        <div class="field"><label>密码</label><input v-model="cloudPass" type="password" autocomplete="off" placeholder="请输入您的密码（至少 8 个字符）" /></div>
        <div v-if="mode === 'register'" class="field"><label>再次输入密码</label><input v-model="cloudPassAgain" type="password" autocomplete="off" placeholder="两次要一致" /></div>
        <label v-if="mode === 'register'" class="row small" style="margin: 4px 0 10px">
          <input v-model="cloudConsent" type="checkbox" />
          <span>我同意把课表、记事、二课材料与照片备份到云端（服务器持有密钥、可以读取，用于换机取回）</span>
        </label>
        <!-- v2.49：按钮只写"登录/注册"——"取回课表"是登录之后自动发生的事，不该写进按钮承诺 -->
        <button v-if="mode === 'login'" class="btn block" :disabled="cloudBusy" @click="cloudSignIn">{{ cloudBusy ? '处理中，请勿退出…' : '登录' }}</button>
        <button v-else class="btn block" :disabled="cloudBusy" @click="cloudRegister">{{ cloudBusy ? '处理中，请勿退出…' : '注册' }}</button>
        <div v-if="mode === 'register'" class="slowhint">注册后先选高校、正常用；改完课表会自动备份到云端。</div>
        <div v-if="cloudMsg" class="cloudmsg">{{ cloudMsg }}</div>

        <button class="btn block ghost" style="margin-top: 10px" @click="useDemo">用演示账号登录（admin / buct）</button>

        <!-- v2.48：「账号与找回」放进登录页；v2.49：给它一个**按钮**，不再只是一行小字 -->
        <button class="btn block ghost sm" style="margin-top: 10px" @click="db.openRecovery()">账号与找回</button>

        <div class="diag" :class="{ bad: !db.storage.ok }">本机存储自检：{{ db.storage.ok ? '正常' : '异常' }} · {{ db.storage.detail }}</div>
        <div v-if="db.lastError" class="errbox">{{ db.lastError }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.top { padding: calc(12px + var(--safe-t)) 14px 12px; background: var(--card); border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 10px; }
.schoolname { font-weight: 600; }
.body { flex: 1; padding: 26px 16px; }
.demobar { background: var(--tint); color: var(--brand); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; font-size: 12px; line-height: 1.7; margin-bottom: 16px; }
.logo { width: 60px; height: 60px; margin: 0 auto 10px; border-radius: 18px; background: linear-gradient(135deg, #2C6FE0, #4E7BD6); color: #fff; font-size: 34px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.title { text-align: center; font-size: 20px; font-weight: 700; }
.form { margin-top: 22px; }
.tabs { display: flex; gap: 8px; margin-bottom: 16px; }
.tabs button { flex: 1; padding: 9px; border-radius: 10px; background: var(--soft-2); color: var(--muted); font-weight: 600; }
.tabs button.on { background: var(--brand); color: #fff; }
.diag { margin-top: 12px; font-size: 11px; color: var(--muted); background: var(--soft); border-radius: 8px; padding: 7px 9px; word-break: break-all; }
.diag.bad { background: #FDECEA; color: #7A1F1A; }
.errbox { margin-top: 12px; background: #FDECEA; color: #7A1F1A; border-radius: 10px; padding: 10px; font-size: 11px; white-space: pre-wrap; word-break: break-all; max-height: 130px; overflow: auto; }
.cloudmsg { margin-top: 10px; font-size: 11px; line-height: 1.7; color: var(--muted); background: var(--soft-2); border-radius: 8px; padding: 8px 10px; word-break: break-all; }
.slowhint { margin-top: 8px; font-size: 11px; line-height: 1.6; color: var(--muted); }
</style>
