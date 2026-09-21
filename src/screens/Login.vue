<script setup lang="ts">
import { ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { isNativeWebView } from '../services/jwwebview.ts';

const db = useDb();
/**
 * 公网演示站（v2.22）：浏览器里打开时给一句明确交代 ——
 * 数据只在这台设备的浏览器里、不上传；想要通知/相机等完整能力请装 APK。
 * 评审/同学第一次打开不用猜"这是不是真能用的版本"。
 */
const isWeb = !isNativeWebView();
const mode = ref<'login' | 'register'>('login');
const username = ref('');
const password = ref('');
const displayName = ref('');

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
        <b>演示站</b>：数据只存在你这台设备的浏览器里，不上传、不采集。<br />
        装 APK（或点下方演示账号）可体验完整功能，含课前提醒、拍照水印等。
      </div>
      <div class="logo">U</div>
      <div class="title">登录 Unimate</div>
      <div class="muted small center">登录后选择你的高校；课表 / 待办提醒 / 第二课堂 / 校园在线，一个 App 搞定</div>

      <div class="card form">
        <div class="tabs">
          <button :class="{ on: mode === 'login' }" @click="mode = 'login'">登录</button>
          <button :class="{ on: mode === 'register' }" @click="mode = 'register'">创建本地账号</button>
        </div>
        <div class="field"><label>用户名（学号或自定义）</label><input v-model="username" placeholder="2~20 个字符" /></div>
        <div class="field"><label>密码</label><input v-model="password" type="password" placeholder="至少 6 位" /></div>
        <div v-if="mode === 'register'" class="field"><label>昵称（选填）</label><input v-model="displayName" placeholder="显示在课表页顶部" /></div>
        <button class="btn block" @click="submit">{{ mode === 'login' ? '登录' : '创建并登录' }}</button>
        <button class="btn block ghost" style="margin-top: 10px" @click="useDemo">用演示账号登录（admin / buct）</button>
        <div class="diag" :class="{ bad: !db.storage.ok }">本机存储自检：{{ db.storage.ok ? '正常' : '异常' }} · {{ db.storage.detail }}</div>
        <div v-if="db.lastError" class="errbox">{{ db.lastError }}</div>
        <div class="note muted small">
          账号与全部数据只保存在本机、不上传。App 自己不会上传任何数据：会联网的只有你主动打开的网页（教务系统等）
          和<b>默认关闭</b>的天气（见「我的 → 天气」）。密码只存不可逆哈希、没有"找回"入口，忘了密码就重新建号，
          旧数据可用「我的 → 备份与恢复」导入新账号。
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
</style>
