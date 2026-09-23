<script setup lang="ts">
import { ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { isNativeWebView } from '../services/jwwebview.ts';
import { accountDownload, accountInfo, accountLogin } from '../services/account.ts';
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
const mode = ref<'login' | 'register' | 'cloud'>('login');
const username = ref('');
const password = ref('');
const displayName = ref('');
/**
 * v2.44：开机登录页也能直接用 Unimate 账号取回课表 —— 产品负责人要的"一个登录就全好"。
 * 换新手机：装 APK → 这里输云账号 + 密码 → 云端备份自动取回 → 直接进主界面。
 */
const cloudUser = ref('');
const cloudPass = ref('');
const cloudMsg = ref('');
const cloudBusy = ref(false);

async function cloudSignIn(): Promise<void> {
  if (cloudBusy.value) return;
  const name = cloudUser.value.trim();
  if (name.length < 3) { cloudMsg.value = '请输入 Unimate 账号'; return; }
  if (cloudPass.value.length < 8) { cloudMsg.value = '密码至少 8 个字符'; return; }
  cloudBusy.value = true;
  cloudMsg.value = '正在登录云账号（服务器在境外，可能要十几秒，请勿退出）…';
  try {
    const session = await accountLogin(name, cloudPass.value);
    const meta = await accountInfo(session);
    if (!meta.size) {
      cloudMsg.value = '已登录「' + session.account + '」，但这个账号云端还没有备份。请先在旧设备上「我的 → 加密换机同步 → 上传当前数据到云端」，再回来取回。';
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

async function submit(): Promise<void> {
  const u = username.value.trim();
  if (mode.value === 'register') {
    const created = await db.register(u, password.value, displayName.value.trim());
    if (!created) return;
  }
  await db.login(u, password.value);
}

async function useDemo(): Promise<void> {
  const demo = await db.ensureDemoAccount();
  if (!demo) { db.notify('演示账号初始化失败，请查看页面下方的错误信息'); return; }
  username.value = 'admin';
  password.value = 'buct';
  displayName.value = '';
  mode.value = 'login';
  await db.login('admin', 'buct');
}
</script>

<template>
  <div class="screen">
    <div class="top">
      <div class="schoolname">Unimate · 本地账号</div>
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
          <button :class="{ on: mode === 'login' }" @click="mode = 'login'">本机登录</button>
          <button :class="{ on: mode === 'register' }" @click="mode = 'register'">创建账号</button>
          <button :class="{ on: mode === 'cloud' }" @click="mode = 'cloud'">换机取回</button>
        </div>

        <template v-if="mode === 'cloud'">
          <div class="muted small" style="margin-bottom: 10px; line-height: 1.7">
            换新手机：输「Unimate 账号 + 密码」→ 自动取回课表、记事、二课与照片，直接进主界面（不用先在本机建号）。
          </div>
          <div class="field"><label>Unimate 账号</label><input v-model.trim="cloudUser" autocomplete="off" placeholder="在旧设备的「加密换机同步」里注册的账号" /></div>
          <div class="field"><label>密码</label><input v-model="cloudPass" type="password" autocomplete="off" placeholder="至少 8 个字符" /></div>
          <button class="btn block" :disabled="cloudBusy" @click="cloudSignIn">{{ cloudBusy ? '取回中，请勿退出…' : '取回云端课表' }}</button>
          <div class="slowhint">服务器在境外，取回通常需要十几秒到一分钟（照片越多越慢），期间请勿退出 App。</div>
          <div v-if="cloudMsg" class="cloudmsg">{{ cloudMsg }}</div>
        </template>

        <template v-else>
          <div class="field"><label>用户名（学号或自定义）</label><input v-model="username" placeholder="2~20 个字符" /></div>
          <div class="field"><label>密码</label><input v-model="password" type="password" placeholder="至少 6 位" /></div>
          <div v-if="mode === 'register'" class="field"><label>昵称（选填）</label><input v-model="displayName" placeholder="显示在课表页顶部" /></div>
          <button class="btn block" @click="submit">{{ mode === 'login' ? '登录' : '创建并登录' }}</button>
        </template>

        <button class="btn block ghost" style="margin-top: 10px" @click="useDemo">用演示账号登录（admin / buct）</button>

        <div class="diag" :class="{ bad: !db.storage.ok }">本机存储自检：{{ db.storage.ok ? '正常' : '异常' }} · {{ db.storage.detail }}</div>
        <div v-if="db.lastError" class="errbox">{{ db.lastError }}</div>
        <div class="note muted small">
          本机账号与数据默认只保存在本机。会联网的功能包括你主动打开的网页（教务系统等）、<b>默认关闭</b>的天气、
          "选择高校"页每天最多一次的高校档案检查（只下载公开档案），以及两条<b>可选</b>的云端备份路径：
          <b>① 账号登录</b>（备份存云端服务器、服务端持密钥可读，换机输账号密码即可取回）；
          <b>② 端到端加密同步</b>（服务器只存密文，口令与恢复码不上传、不保存）。
          本机登录密码只存不可逆哈希、没有"找回"入口；忘了它可以用「取回云端课表」重来，或重新建号后用备份恢复。
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.top { padding: calc(12px + var(--safe-t)) 14px 12px; background: var(--card); border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 10px; }
.schoolname { font-weight: 600; }
.body { flex: 1; padding: 26px 16px; }
.demobar { background: var(--tint); color: var(--brand); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; font-size: 12px; line-height: 1.7; margin-bottom: 16px; }
.logo { width: 60px; height: 60px; margin: 0 auto 10px; border-radius: 18px; background: linear-gradient(135deg, #2E5AAC, #4E7BD6); color: #fff; font-size: 34px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.title { text-align: center; font-size: 20px; font-weight: 700; }
.form { margin-top: 22px; }
.tabs { display: flex; gap: 8px; margin-bottom: 16px; }
.tabs button { flex: 1; padding: 9px; border-radius: 10px; background: var(--soft-2); color: var(--muted); font-weight: 600; }
.tabs button.on { background: var(--brand); color: #fff; }
.diag { margin-top: 12px; font-size: 11px; color: var(--muted); background: var(--soft); border-radius: 8px; padding: 7px 9px; word-break: break-all; }
.diag.bad { background: #FDECEA; color: #7A1F1A; }
.errbox { margin-top: 12px; background: #FDECEA; color: #7A1F1A; border-radius: 10px; padding: 10px; font-size: 11px; white-space: pre-wrap; word-break: break-all; max-height: 130px; overflow: auto; }
.note { margin-top: 14px; line-height: 1.6; }
.cloudmsg { margin-top: 10px; font-size: 11px; line-height: 1.7; color: var(--muted); background: var(--soft-2); border-radius: 8px; padding: 8px 10px; word-break: break-all; }
.slowhint { margin-top: 8px; font-size: 11px; line-height: 1.6; color: var(--muted); }
</style>
