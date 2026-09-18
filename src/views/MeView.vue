<script setup lang="ts">
import { computed, ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { exportBackup, inspectBackup, restoreBackup } from '../services/backup.ts';
import { base64ToBytes, bytesToBase64 } from '../services/zip.ts';
import { readBinaryBase64, remove, writeBinaryBase64 } from '../services/io.ts';
import { permissionState, ensurePermission, rescheduleAll, scheduleDemoPing, scheduledCount, scheduleStats, cancelAll, scheduleTest } from '../services/notify.ts';
import { nowStamp } from '../services/id.ts';
import { SECOND_CLASS_BLOCKS, TOTAL_FULL_SCORE } from '../catalog/secondClass.ts';

const db = useDb();
const panel = ref<'' | 'notify' | 'watermark' | 'backup' | 'about' | 'interests'>('');
const perm = ref('unknown');
const lastBackup = ref('');
const restoreB64 = ref('');
const restoreMode = ref<'overwrite' | 'merge'>('overwrite');
const restoreInfo = ref('');
const sched = ref(0);
const stats = ref({ total: 0, classReminders: 0, todoReminders: 0, testReminders: 0, nextFireAt: '' });
const schedMsg = ref('');

const sub = computed(() => SECOND_CLASS_BLOCKS.map((b) => b.name + ' ' + db.blockScore(b.key)).join(' · '));

async function open(name: typeof panel.value): Promise<void> {
  panel.value = name;
  if (name === 'notify') { perm.value = await permissionState(); stats.value = await scheduleStats(); sched.value = stats.value.total; }
}

async function test(minutes: number): Promise<void> {
  const r = await scheduleTest(minutes);
  schedMsg.value = r.ok ? '已排期，' + r.at + ' 触发' : '失败：' + r.error;
  stats.value = await scheduleStats(); sched.value = stats.value.total;
  db.notify(r.ok ? '已安排 ' + minutes + ' 分钟后的测试提醒' : '测试提醒失败：' + r.error);
}

async function clearAll(): Promise<void> {
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
  if (restoreMode.value === 'overwrite') {
    const safe = 'exports/safety-' + Date.now() + '.json';
    await writeBinaryBase64(safe, base64ToBytes(restoreB64.value));
  }
  await restoreBackup(base64ToBytes(restoreB64.value), b, restoreMode.value === 'merge');
  await db.loadUserData();
  restoreB64.value = '';
  restoreInfo.value = '';
  db.notify('恢复完成');
}

async function resetDemo(): Promise<void> {
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
      <div class="row" style="justify-content: space-between">
        <span class="small muted">第二课堂累计自评</span><span class="bold">{{ db.totalScore() }} / {{ TOTAL_FULL_SCORE }}</span>
      </div>
      <div class="small muted" style="margin-top: 4px">{{ sub }}</div>
    </div>

    <div class="list" style="margin-top: 10px">
      <div class="li" @click="open('notify')"><span class="ico">🔔</span><div class="grow"><div class="bold">通知设置</div><div class="small muted">上课提醒 / 待办提醒 / 权限状态</div></div><span>›</span></div>
      <div class="li" @click="open('watermark')"><span class="ico">💧</span><div class="grow"><div class="bold">拍照水印</div><div class="small muted">自主开关水印内容与样式</div></div><span>›</span></div>
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
      <div class="row"><div class="title grow">{{ { notify: '通知设置', watermark: '拍照水印', backup: '备份与恢复', about: '关于 Unimate', interests: '意向清单' }[panel] }}</div><button class="btn sm ghost" @click="panel = ''">关闭</button></div>
      <div class="hairline"></div>

      <template v-if="panel === 'notify'">
        <div class="li" style="padding: 10px 0"><span class="grow">总开关</span><button class="chip sm" :class="{ on: db.settings.notifyEnabled }" @click="db.settings.notifyEnabled = !db.settings.notifyEnabled; reschedule()">{{ db.settings.notifyEnabled ? '开' : '关' }}</button></div>
        <div class="li" style="padding: 10px 0"><span class="grow">上课提醒</span><button class="chip sm" :class="{ on: db.settings.classReminderEnabled }" @click="db.settings.classReminderEnabled = !db.settings.classReminderEnabled; reschedule()">{{ db.settings.classReminderEnabled ? '开' : '关' }}</button></div>
        <div class="field"><label>提前几分钟提醒上课</label>
          <div class="chips"><button v-for="m in [5, 10, 15, 20, 30]" :key="m" class="chip sm" :class="{ on: db.settings.classReminderMinutes === m }" @click="db.settings.classReminderMinutes = m; reschedule()">{{ m }} 分钟</button></div>
        </div>
        <div class="card" style="box-shadow: none; background: #F7F9FC">
          <div class="row"><span class="grow small">系统通知权限</span><span class="pill" :class="perm === 'granted' ? 'live' : 'danger'">{{ perm === 'granted' ? '已允许' : (perm === 'unsupported' ? '当前环境不支持' : '未允许') }}</span></div>
          <button v-if="perm !== 'granted'" class="btn block sm" style="margin-top: 8px" @click="askPerm">去开启</button>
          <div class="small muted" style="margin-top: 8px">部分国产 ROM 会冻结后台导致提醒延迟。小米/澎湃：设置 → 应用设置 → 应用管理 → Unimate → 省电策略选「无限制」，并在最近任务里下拉卡片锁定后台，同处打开「自启动」。</div>
        </div>
        <div class="card" style="box-shadow: none; background: #F7F9FC; margin-top: 10px">
          <div class="row" style="justify-content: space-between"><span class="small">系统已排期提醒</span><b class="small">{{ sched }} 条</b></div>
          <div class="small muted" style="margin-top: 4px">上课 {{ stats.classReminders }} · 待办 {{ stats.todoReminders }} · 测试 {{ stats.testReminders }}<template v-if="stats.nextFireAt">；下一条 {{ stats.nextFireAt }}</template></div>
          <div class="row" style="justify-content: space-between; margin-top: 4px"><span class="small">最近一次重建结果</span><span class="small">{{ schedMsg || '—' }}</span></div>
          <div class="row" style="gap: 8px; margin-top: 10px">
            <button class="btn sm grow" @click="test(1)">测试提醒（1 分钟）</button>
            <button class="btn sm grey grow" @click="test(2)">2 分钟</button>
            <button class="btn sm danger grow" @click="clearAll()">清空排期</button>
          </div>
          <div class="small muted" style="margin-top: 8px">测试提醒会在指定时间弹一条系统横幅通知。若到点没弹：先看上面「下一条」时间是否已过，再确认系统设置里 Unimate 的通知横幅已开启。</div>
        </div>
        <button class="btn block grey" style="margin-top: 10px" @click="reschedule()">重建提醒队列</button>
        <button class="btn block ghost" style="margin-top: 8px" @click="db.saveData()">保存设置</button>
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
        <button class="btn block" style="margin-top: 10px" @click="db.saveData(); db.notify('水印设置已保存')">保存设置</button>
      </template>

      <template v-else-if="panel === 'backup'">
        <button class="btn block" @click="doExport">导出备份（.unimate.zip）</button>
        <div v-if="lastBackup" class="small muted" style="margin: 8px 0; word-break: break-all">已导出：{{ lastBackup }}</div>
        <div class="hairline"></div>
        <div class="field"><label>选择备份文件恢复</label><input type="file" accept=".zip" @change="pickBackup" /></div>
        <div v-if="restoreInfo" class="card small" style="background: #F7F9FC; box-shadow: none">{{ restoreInfo }}</div>
        <div class="chips" style="margin: 10px 0">
          <button class="chip sm" :class="{ on: restoreMode === 'overwrite' }" @click="restoreMode = 'overwrite'">覆盖（先自动留底）</button>
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
        <button v-if="db.interests.length" class="btn block grey" @click="db.notify(db.interests.map((i) => i.schoolName + ' | ' + i.createdAt + ' | ' + (i.contact || '—')).join('\n'))">复制清单</button>
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
          <b>隐私：</b>全部数据只存本机；账号密码不读取、不保存、不代填；不使用第三方地图 Key；无埋点、无上报。<br /><br />
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
</style>
