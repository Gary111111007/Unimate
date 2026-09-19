<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useDb } from './stores/db.ts';
import SchoolPicker from './screens/SchoolPicker.vue';
import Login from './screens/Login.vue';
import Main from './screens/Main.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import { ensurePermission, permissionState } from './services/notify.ts';
import { JwWebView } from './services/jwwebview.ts';
const isNative = (): boolean => { try { return !!(window as any).Capacitor && (window as any).Capacitor.isNativePlatform(); } catch { return false; } };

const db = useDb();
const showErr = ref(false);
const splashDone = ref(false);
const quick = ref(false);
watch(() => db.lastError, (v) => { if (v) showErr.value = true; });

// 开屏停留时长分两档：首次使用完整展示品牌（答辩/演示需要），
// 已记住登录态的老用户只是"确认 App 还活着"，不该再被动画挡 1.2 秒。
const SPLASH_FIRST = 1250;
const SPLASH_RETURN = 420;


/**
 * 启动看门狗：以前开屏 z-index 200 压在 toast(90)/errpanel(95) 上面，
 * 启动阶段一旦出错，用户只看到"卡在开屏、什么提示都没有"（真机就吃了这个亏）。
 * 现在 5 秒还没进主界面，就把错误显示在开屏之上，并给"重试 / 跳过开屏先进去"两条活路。
 */
const stuck = ref(false);
let watchdog = 0;
function armWatchdog(): void {
  window.clearTimeout(watchdog);
  watchdog = window.setTimeout(() => { if (!splashDone.value || !db.booted) stuck.value = true; }, 5000);
}
watch([splashDone, () => db.booted], () => {
  if (splashDone.value && db.booted) { window.clearTimeout(watchdog); stuck.value = false; }
});
async function retryBoot(): Promise<void> {
  stuck.value = false;
  db.booted = false;
  splashDone.value = false;
  armWatchdog();
  try { await db.boot(); } catch (e: any) { db.lastError = `启动重试失败：` + String((e && e.message) || e); }
  splashDone.value = true;
  showErr.value = !!db.lastError;
}
function forceEnter(): void {
  // 半加载也比永远进不去强：至少让用户看到界面、看到错误，能截图反馈
  window.clearTimeout(watchdog);
  stuck.value = false;
  db.booted = true;
  splashDone.value = true;
  showErr.value = true;
}
onMounted(async () => {
  const t0 = Date.now();
  // 先跑完启动流程，才知道有没有记住的登录态，据此决定开屏还要停留多久。
  // （旧写法是 boot 与固定 1250ms 并行等待，无论谁都硬等满 1250ms。）
  armWatchdog();
  try {
    await db.boot();
  } catch (e: any) {
    db.lastError = `启动异常：` + String((e && e.stack) || (e && e.message) || e);
  }
  quick.value = !!db.session;
  const left = (quick.value ? SPLASH_RETURN : SPLASH_FIRST) - (Date.now() - t0);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
  // 需求：一启动就申请通知权限，否则提醒功能永远不生效
  try {
    const state = await permissionState();
    const granted = state === 'granted' || state === 'unsupported' ? true : await ensurePermission();
    // 通知权限拿到之后，再要求"忽略电池优化"：国产 ROM 不豁免就冻结后台闹钟，
    // 提醒会拖到下次打开 App 才一起补发。整个生命周期只弹一次，不重复打扰。
    // 注意：只在已经进入主界面（db.screen === "app"）时才跳系统设置，
    // 避免在开屏/登录阶段抢前台，把"能不能进 App"押在这个对话框上。
    if (granted && isNative() && !db.settings.powerPrompted && db.screen === 'app') {
      db.settings.powerPrompted = true;
      await db.saveData();
      const st: any = await JwWebView.powerStatus();
      if (st && st.ok !== false && !st.ignoring) {
        await new Promise((r) => setTimeout(r, 1400));
        await JwWebView.requestIgnoreBattery();
      }
    }
  } catch { /* 预览环境忽略 */ }
});
</script>

<template>
  <transition name="splash">
    <div v-if="!splashDone || !db.booted" class="splash" :class="{ quick }">
      <div class="mark">U</div>
      <div class="word">Unimate</div>
      <div class="tag">高校校园学习生活一站式智能助手</div>
      <div class="bar"><i></i></div>
      <div class="foot">首个落地高校 · 北京化工大学</div>
      <div v-if="stuck" class="stuck">
        <div class="stt">启动没有按时完成 · 原因显示在下面</div>
        <pre v-if="db.lastError" class="ste">{{ db.lastError }}</pre>
        <div v-else class="ste">没有捕获到 JS 错误 —— 更可能是系统或某个原生权限对话框把启动挂起了。</div>
        <div class="stb">
          <button class="btn sm" @click="retryBoot()">重试一次</button>
          <button class="btn sm grey" @click="forceEnter()">跳过开屏，先进去看看</button>
        </div>
        <div class="sth">请把这屏文字截图发给开发者，可以直接定位问题。</div>
      </div>
    </div>
  </transition>

  <template v-if="splashDone && db.booted">
    <SchoolPicker v-if="db.screen === 'school'" />
    <Login v-else-if="db.screen === 'login'" />
    <Main v-else />
  </template>

  <ConfirmDialog />

  <div class="toasts">
    <div v-if="db.toast" class="toast" @click="showErr = !showErr">{{ db.toast }}</div>
  </div>
  <div v-if="showErr && db.lastError" class="errpanel">
    <div class="row"><b class="grow">最近一次错误</b><button class="btn sm ghost" @click="showErr = false">收起</button></div>
    <pre>{{ db.lastError }}</pre>
  </div>
</template>

<style scoped>
.splash { position: fixed; inset: 0; z-index: 200; background: linear-gradient(160deg, #2E5AAC, #14284C 70%); color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; }
.mark { width: 84px; height: 84px; border-radius: 26px; background: rgba(255, 255, 255, .16); border: 1px solid rgba(255, 255, 255, .25); display: flex; align-items: center; justify-content: center; font-size: 46px; font-weight: 800; animation: pop .62s cubic-bezier(.18, .89, .32, 1.28) both; }
.word { font-size: 27px; font-weight: 800; letter-spacing: 1.5px; animation: rise .5s .18s ease-out both; }
.tag { font-size: 12.5px; opacity: .82; animation: rise .5s .3s ease-out both; }
.bar { width: 96px; height: 3px; border-radius: 2px; background: rgba(255, 255, 255, .22); overflow: hidden; margin-top: 18px; animation: rise .4s .42s ease-out both; }
.bar i { display: block; height: 100%; width: 40%; border-radius: 2px; background: var(--card); animation: run 1.1s .45s ease-in-out infinite; }
.foot { position: absolute; bottom: calc(34px + var(--safe-b)); font-size: 11px; opacity: .6; animation: rise .5s .5s ease-out both; }
@keyframes pop { from { transform: scale(.5); opacity: 0 } to { transform: scale(1); opacity: 1 } }
@keyframes rise { from { transform: translateY(10px); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes run { 0% { transform: translateX(-110%) } 100% { transform: translateX(260%) } }
.splash-leave-active { transition: opacity .3s ease, transform .3s ease; }
/* 老用户的快速档：只留 logo 与字标，去掉副标题、进度条与底注，动画整体收紧 */
.splash.quick .tag, .splash.quick .bar, .splash.quick .foot { display: none; }
.splash.quick .mark { animation-duration: .3s; }
.splash.quick .word { animation: rise .26s .07s ease-out both; }
.splash.quick.splash-leave-active { transition-duration: .18s; }
.splash-leave-to { opacity: 0; transform: scale(1.04); }
.stuck { position: absolute; left: 14px; right: 14px; bottom: calc(70px + var(--safe-b)); max-height: 48vh; overflow: auto; text-align: left; background: rgba(255, 255, 255, .10); border: 1px solid rgba(255, 255, 255, .22); border-radius: 14px; padding: 12px 13px; backdrop-filter: blur(6px); }
.stt { font-size: 13.5px; font-weight: 700; }
.ste { white-space: pre-wrap; word-break: break-all; font-size: 11px; line-height: 1.5; opacity: .92; margin: 8px 0; max-height: 19vh; overflow: auto; }
.stb { display: flex; gap: 8px; }
.sth { font-size: 11px; opacity: .72; margin-top: 9px; line-height: 1.5; }
.errpanel { position: fixed; left: 12px; right: 12px; bottom: 12px; z-index: 210; background: var(--card); border: 1px solid var(--danger); border-radius: 12px; padding: 10px 12px; box-shadow: 0 6px 20px rgba(0, 0, 0, .18); }
.errpanel pre { white-space: pre-wrap; word-break: break-all; font-size: 11px; max-height: 34vh; overflow: auto; margin: 8px 0 0; color: #7A1F1A; }
.toast { cursor: pointer; }
</style>
