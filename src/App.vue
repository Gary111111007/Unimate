<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useDb } from './stores/db.ts';
import SchoolPicker from './screens/SchoolPicker.vue';
import Login from './screens/Login.vue';
import Main from './screens/Main.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import { ensurePermission, permissionState, refreshReminderRisk } from './services/notify.ts';
import { bootTrace } from './services/guard.ts';
import { initCloudAutoSync } from './services/cloudAutoSync.ts';
import { applyTextZoom } from './services/display.ts';
import ShareView from './views/ShareView.vue';
import { decodeTimetable, payloadFromHash, type SharedTimetable } from './services/share.ts';

const db = useDb();
/**
 * 只读分享页（v2.22）：链接形如 `https://<站点>/#s=<payload>`。
 * 命中时**完全不进登录/主界面**，只渲染这张课表 —— 评委/同学点链接就该直接看到课表，
 * 而不是先被要求登录。
 */
const shared = ref<SharedTimetable | null>(null);
const shareError = ref(false);
try {
  const p = payloadFromHash(location.hash);
  if (p) {
    shared.value = decodeTimetable(p);
    if (!shared.value) shareError.value = true; // 链接有了但解不开（可能被扫码截断或版本不兼容）
  }
} catch { shared.value = null; shareError.value = true; }
const showErr = ref(false);
const splashDone = ref(false);
const quick = ref(false);
// 产品负责人要求关掉：错误详情面板不再自动弹出挡在界面上。
// 出错时仍有一条 toast 提示，点那条 toast 才展开详情 —— 诊断能力保留，但不打扰。
watch(() => db.lastError, () => { });

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

/** 后台补齐提醒所需的系统条件；不 await 回开屏流程，卡住也不挡界面。 */
async function postBootPermissions(): Promise<void> {
  // 产品负责人 2026-09-20 明确要求：自启动 / 电池优化那套不要了，这里只补通知权限。
  // （原生 powerStatus / requestIgnoreBattery 仍留在 JwWebViewPlugin 里，但不再被调用。）
  try {
    const state = await permissionState();
    if (state !== 'granted' && state !== 'unsupported') await ensurePermission();
  } catch { }
  /*
   * 提醒自检（v2.28）：只**查状态**、不主动跳系统设置。
   * 精确闹钟未授权时插件会退化成"不精确闹钟"（到点不响、等应用活跃时一起补发），
   * 电池优化没豁免时国产 ROM 会冻结后台 —— 这两项是"到点不响"的根因，
   * 查完把结论放进 reminderRisk，课表页据此显示一行提示 + 一键去修。
   */
  try { await refreshReminderRisk(); } catch { /* 查不到就算了，不打扰 */ }
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
  // 下面这行是开屏的唯一正常出口。v2.9 我用行号 splice 改权限块时把它一起删了，
  // 结果 splashDone 永远是 false：开屏关不掉、5 秒后必然弹"启动失败"，只能靠"跳过开屏"进去。
  // 教训：按行号删代码必须逐行确认边界，改完要 diff 看被删掉了什么。
  // boot 会把 settings 从磁盘读回来，字号要按落盘值再应用一次
  void applyTextZoom(db.settings.fontSize || 100);
  splashDone.value = true;
  // 需求：一启动就申请通知权限，否则提醒永远不生效。
  // 但这一步不能挡在进入界面之前 —— 以前它 await 在开屏流程里，
  // 系统权限框或设置页一旦吞掉回调，用户就永远停在开屏（真机踩过两次）。
  // 现在界面先出来，权限与电池优化在后台自己跑，卡住也不影响使用。
  void postBootPermissions();
  /*
   * v2.45：把"数据落盘 → 自动同步到云账号"接上（未登录/关了开关时它自己什么都不做）。
   * 放在界面出来之后注册：它只是登记一个回调，不参与启动时序，卡住也不影响进 App。
   */
  try { initCloudAutoSync(db); } catch { /* 自动同步起不来不影响其它功能 */ }
});
</script>

<template>
  <!-- 分享链接进来时直接看课表：不显示开屏、不进登录页 -->
  <ShareView v-if="shared" :data="shared" />
  <!-- 链接存在但解码失败：给扫码的人看清楚"为什么没显示课表"，而不是掉进登录页 -->
  <div v-else-if="shareError" class="screen" style="display:flex;align-items:center;justify-content:center;padding:24px">
    <div class="card" style="max-width:360px;text-align:center;padding:28px 24px">
      <div style="font-size:40px;margin-bottom:12px">🔗</div>
      <div class="bold" style="margin-bottom:8px">分享链接无法打开</div>
      <div class="small muted" style="line-height:1.8">
        这条链接可能不完整（二维码没扫全）或来自旧版本。
        请让分享的同学重新生成一个二维码，或直接把链接复制粘贴到浏览器地址栏。
      </div>
    </div>
  </div>

  <transition v-else name="splash">
    <div v-if="!splashDone || !db.booted" class="splash" :class="{ quick }">
      <div class="mark">U</div>
      <div class="word">Unimate</div>
      <div class="tag">高校校园学习生活一站式智能助手</div>
      <div class="bar"><i></i></div>
      <div class="foot">首个落地高校 · 北京化工大学</div>
      <div v-if="stuck && (!splashDone || !db.booted)" class="stuck">
        <div class="stt">启动没有按时完成 · 原因显示在下面</div>
        <pre v-if="db.lastError" class="ste">{{ db.lastError }}</pre>
        <div v-else class="ste">没有捕获到 JS 错误，但下面的启动步骤会指出卡在哪一步（超过 5 秒没走完就是某个系统调用没返回）。</div>
        <div v-if="bootTrace.length" class="sttr">启动步骤：{{ bootTrace.join('  ·  ') }}</div>
        <div class="stb">
          <button class="btn sm" @click="retryBoot()">重试一次</button>
          <button class="btn sm grey" @click="forceEnter()">跳过开屏，先进去看看</button>
        </div>
        <div class="sth">请把这屏文字截图发给开发者，可以直接定位问题。</div>
      </div>
    </div>
  </transition>

  <template v-if="!shared && splashDone && db.booted">
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
.sttr { font-size: 11px; line-height: 1.6; opacity: .85; margin-top: 6px; word-break: break-all; }
.stb { display: flex; gap: 8px; }
.sth { font-size: 11px; opacity: .72; margin-top: 9px; line-height: 1.5; }
.errpanel { position: fixed; left: 12px; right: 12px; bottom: 12px; z-index: 210; background: var(--card); border: 1px solid var(--danger); border-radius: 12px; padding: 10px 12px; box-shadow: 0 6px 20px rgba(0, 0, 0, .18); }
.errpanel pre { white-space: pre-wrap; word-break: break-all; font-size: 11px; max-height: 34vh; overflow: auto; margin: 8px 0 0; color: #7A1F1A; }
.toast { cursor: pointer; }
</style>
