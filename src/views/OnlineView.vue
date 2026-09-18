<script setup lang="ts">
import { ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { JwWebView, isNativeWebView } from '../services/jwwebview.ts';

const db = useDb();
const status = ref('');
const p = () => db.profile!;

async function openTarget(url: string, title: string): Promise<void> {
  status.value = '正在打开…';
  if (!isNativeWebView()) { status.value = '桌面预览环境不支持内嵌 WebView；安装 APK 后可直接在 App 内打开并持久保存登录状态。'; return; }
  const r = await JwWebView.open({ url, title, allowExternal: true });
  status.value = r.ok ? '已返回。登录状态已保存在本机 WebView 配置中。' : (r.reason === 'cancelled' ? '已关闭' : '打开失败：' + (r.reason || '未知'));
}
</script>

<template>
  <div class="scroll">
    <div class="card hero">
      <div class="title">{{ p().tabs.online }}</div>
      <div class="small muted">{{ p().name }} 在线教学平台</div>
      <div class="url">{{ p().systems.onlinePlatformUrl }}</div>
    </div>

    <div class="list" style="margin-top: 10px">
      <div class="li" @click="openTarget(p().systems.onlinePlatformUrl, p().tabs.online)">
        <span class="ico">📚</span><div class="grow"><div class="bold">进入平台首页 / 个人空间</div><div class="small muted">登录状态自动保持，重启 App 无需再登</div></div><span>›</span>
      </div>
      <div class="li" @click="openTarget(p().systems.jwglxtUrl, '教务系统')">
        <span class="ico">🏛</span><div class="grow"><div class="bold">教务系统</div><div class="small muted">{{ p().systems.jwglxtUrl }}</div></div><span>›</span>
      </div>
      <div class="li" @click="openTarget(p().systems.timetableUrl, '个人课表查询')">
        <span class="ico">🗓️</span><div class="grow"><div class="bold">个人课表查询</div><div class="small muted">导入课表请回"课表"页用「一键保存并识别」</div></div><span>›</span>
      </div>
    </div>

    <div v-if="status" class="card small">{{ status }}</div>

    <div class="card" style="margin-top: 10px">
      <div class="bold small" style="margin-bottom: 6px">说明</div>
      <div class="small muted" style="line-height: 1.7">
        · 本平台由 {{ p().name }} 运营，Unimate 只做内嵌入口，不代理任何数据、不读取你的账号密码。<br />
        · 需要下载课件或播放视频时，可用"在系统浏览器打开"。<br />
        · 该 Tab 的显示名称由高校档案决定：北化为"北化在线"，其他高校接入后显示各自名称。
      </div>
    </div>
  </div>
</template>

<style scoped>
.hero { background: linear-gradient(140deg, #2E5AAC, #3E6FBF); color: #fff; }
.hero .small { color: rgba(255, 255, 255, .8); }
.url { margin-top: 8px; font-size: 12px; background: rgba(255, 255, 255, .16); display: inline-block; padding: 3px 8px; border-radius: 7px; }
.ico { font-size: 20px; }
</style>
