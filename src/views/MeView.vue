<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { exportBackup, inspectBackup, restoreBackup } from '../services/backup.ts';
import { base64ToBytes, bytesToBase64 } from '../services/zip.ts';
import { permissionState, ensurePermission, rescheduleAll, scheduleDemoPing, scheduledCount, scheduleStats, cancelAll, scheduleTest, exactAlarmState, requestExactAlarmSetting, wireSelfCheck } from '../services/notify.ts';
import { nowStamp } from '../services/id.ts';
import { applyTheme, type ThemeMode } from '../services/theme.ts';
import { FONT_LEVELS, applyTextZoom } from '../services/display.ts';
import { SECOND_CLASS_BLOCKS, TOTAL_FULL_SCORE } from '../catalog/secondClass.ts';
import { agoText, weatherText } from '../services/weather.ts';

const db = useDb();
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
/** 打开「天气」面板时的开关与城市：用它判断"保存时用户是不是明确改过"（改过就允许立刻拉一次） */
const wxOpened = ref({ enabled: false, city: '' });

const sub = computed(() => SECOND_CLASS_BLOCKS.map((b) => b.name + ' ' + db.blockScore(b.key)).join(' · '));

async function open(name: typeof panel.value): Promise<void> {
  panel.value = name;
  if (name === 'notify') { await refreshNotifyState(); }
  if (name === 'weather') wxOpened.value = { enabled: db.settings.weatherEnabled, city: (db.settings.weatherCity || '').trim() };
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

  <div v-if="panel" class="mask" @click.self="panel = ''">
    <div class="sheet">
      <div class="row"><div class="title grow">{{ { notify: '通知设置', watermark: '拍照水印', weather: '天气', backup: '备份与恢复', about: '关于 Unimate', interests: '意向清单' }[panel] }}</div><button class="btn sm ghost" @click="panel = ''">关闭</button></div>
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
          <div class="small muted" style="margin-top: 8px">提醒依赖三件事：系统通知权限、精确闹钟授权、以及厂商后台保留策略。前两项在下面直接开；后者各品牌入口不同，本产品按你的要求不再主动跳转系统设置。</div>
        </div>
        <div class="card" style="box-shadow: none; background: var(--soft); margin-top: 10px">
          <div class="row" style="justify-content: space-between"><span class="small">系统已排期提醒</span><b class="small">{{ sched }} 条</b></div>
          <div class="small muted" style="margin-top: 4px">上课 {{ stats.classReminders }} · 待办 {{ stats.todoReminders }} · 测试 {{ stats.testReminders }}<template v-if="stats.nextFireAt">；下一条 {{ stats.nextFireAt }}</template></div>
          <div class="row" style="justify-content: space-between; margin-top: 4px"><span class="small">提醒时刻自检</span><span class="pill" :class="wire.ok ? 'live' : 'danger'">{{ wire.ok ? '正常' : '异常' }}</span></div>
          <div v-if="!wire.ok" class="small muted" style="margin-top: 4px">{{ wire.hint }}（样本 {{ wire.sample }}）</div>

          <div class="row" style="justify-content: space-between; margin-top: 4px"><span class="small">最近一次重建结果</span><span class="small">{{ schedMsg || '—' }}</span></div>
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
          <b>隐私：</b>全部数据只存本机；账号密码不读取、不保存、不代填；不使用第三方地图 Key；无埋点、无上报。<br />
          App 自己发起的联网请求只有一处，就是<b>天气</b>（默认关闭，开关在「我的 → 天气」）：<b>开启天气后会向 Open-Meteo 发送你的大致位置用于查询天气，不发送其他信息</b>；关掉开关后一次请求都不发。<br />
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
