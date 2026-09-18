<script setup lang="ts">
import { ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { JwWebView, isNativeWebView } from '../services/jwwebview.ts';
import { parseJwglxtTimetable } from '../services/parser/jwglxtBuct.ts';
import { uuid, nowStamp } from '../services/id.ts';
import { writeText } from '../services/io.ts';
import type { Course, ParseResult } from '../types.ts';

const emit = defineEmits<{ (e: 'close'): void }>();
const db = useDb();
const step = ref<'intro' | 'working' | 'preview' | 'error'>('intro');
const result = ref<ParseResult | null>(null);
const errMsg = ref('');
const mode = ref<'overwrite' | 'merge'>('merge');

async function openJwglxt(): Promise<void> {
  const p = db.profile!;
  step.value = 'working';
  if (!isNativeWebView()) {
    errMsg.value = '当前是桌面预览环境，无法内嵌教务系统 WebView。请用下方"内置脱敏样本"演示导入，或在手机上安装 APK 后使用真实导入。';
    step.value = 'error';
    return;
  }
  const r = await JwWebView.open({
    url: p.systems.jwglxtUrl, startUrl: p.systems.jwglxtUrl,
    title: '教务系统', scrapeSelector: '#kbgrid_table_0'
  });
  if (!r.ok) {
    errMsg.value = r.reason === 'web-unsupported' ? 'WebView 不可用' : (r.reason || '已取消导入');
    step.value = r.reason === 'cancelled' ? 'intro' : 'error';
    return;
  }
  await run(r.html || '', r.url || '');
}

async function useSample(): Promise<void> {
  step.value = 'working';
  const html = await fetch('sample-timetable.html').then((x) => x.text());
  await run(html, 'sample');
}

async function run(html: string, url: string): Promise<void> {
  const parsed = parseJwglxtTimetable(html);
  if (!parsed.courses.length) {
    errMsg.value = parsed.diagnostics[0]?.message || '没有解析到课程。请在教务系统里进入「信息查询 → 课表查询 → 个人课表查询」并点查询，出现课表表格后再点「一键保存并识别」。';
    step.value = 'error';
    return;
  }
  if (url !== 'sample') {
    const b = 'schools/' + db.profile!.schoolId + '/users/' + db.session!.accountId;
    await writeText(b + '/timetable/imports/raw-' + Date.now() + '.html', html);
  }
  result.value = parsed;
  step.value = 'preview';
}

async function confirmImport(): Promise<void> {
  const r = result.value!;
  const tt = db.activeTimetable || db.newTimetable(r.semesterLabel || '我的课表');
  tt.semesterLabel = r.semesterLabel || tt.semesterLabel;
  tt.source = 'jwglxt';
  tt.updatedAt = nowStamp();
  const mapped: Course[] = r.courses.map((c, i) => ({
    ...c, id: uuid(), timetableId: tt.id, colorIndex: i % 12,
    editedFields: [], source: 'jwglxt'
  }));
  if (mode.value === 'overwrite') db.courses = db.courses.filter((c) => c.timetableId !== tt.id).concat(mapped);
  else db.courses = db.courses.filter((c) => !(c.timetableId === tt.id && mapped.some((m) => m.name === c.name && m.day === c.day && m.startPeriod === c.startPeriod))).concat(mapped);
  db.settings.lastActiveTimetableId = tt.id;
  await db.saveData();
  db.notify('导入完成：' + mapped.length + ' 条上课安排');
  emit('close');
}

const warns = () => (result.value?.diagnostics || []).filter((d) => d.kind !== 'ok');
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="sheet">
      <div class="row"><div class="title grow">从教务系统导入课表</div><button class="btn sm ghost" @click="emit('close')">关闭</button></div>
      <div class="hairline"></div>

      <template v-if="step === 'intro'">
        <div class="li col" style="align-items: flex-start">
          <div class="bold">1. 登录并打开课表页</div>
          <div class="small muted">App 内直接打开 jwglxt.buct.edu.cn，自行输入学号、密码与验证码，然后进入「信息查询 → 课表查询 → 个人课表查询」，选好学期点查询。</div>
        </div>
        <div class="li col" style="align-items: flex-start">
          <div class="bold">2. 点工具条上的「一键保存并识别」</div>
          <div class="small muted">Unimate 只读取页面上的课表表格内容，不读取、不保存你的账号密码，也不会代填表单。</div>
        </div>
        <button class="btn block" style="margin-top: 14px" @click="openJwglxt">🏛 打开教务系统</button>
        <button class="btn block grey" style="margin-top: 10px" @click="useSample">用内置脱敏样本演示导入（离线可用）</button>
        <div class="small muted" style="margin-top: 10px">样本为已脱敏的真实教务页面，可完整演示"抓取 → 解析 → 预览 → 入库"链路。</div>
      </template>

      <div v-else-if="step === 'working'" class="empty"><div class="big">⏳</div>正在抓取并解析课表…</div>

      <div v-else-if="step === 'error'">
        <div class="pill danger">导入未完成</div>
        <p>{{ errMsg }}</p>
        <div class="row">
          <button class="btn grow" @click="step = 'intro'">返回重试</button>
          <button class="btn grey grow" @click="useSample">改用样本演示</button>
        </div>
      </div>

      <template v-else-if="step === 'preview' && result">
        <div class="kv"><span>学期</span><b>{{ result.semesterLabel || '—' }}</b></div>
        <div class="kv"><span>学生</span><b>{{ result.studentName || '—' }} · {{ result.studentId || '—' }}</b></div>
        <div class="kv"><span>识别结果</span><b>{{ result.distinctCourseNames }} 门课程（{{ result.blockCount }} 个标题）/ {{ result.courses.length }} 条上课安排</b></div>
        <div class="kv"><span>需处理</span><b>{{ warns().length }} 项</b></div>
        <div v-if="warns().length" class="warns">
          <div v-for="(d, i) in warns()" :key="i" class="warn">{{ d.message }}</div>
        </div>
        <div class="field" style="margin-top: 14px"><label>重复导入策略</label>
          <div class="chips">
            <button class="chip" :class="{ on: mode === 'merge' }" @click="mode = 'merge'">合并（保留手动修正）</button>
            <button class="chip" :class="{ on: mode === 'overwrite' }" @click="mode = 'overwrite'">覆盖本课表</button>
          </div>
        </div>
        <div class="row">
          <button class="btn grow" @click="confirmImport">确认导入</button>
          <button class="btn ghost grow" @click="step = 'intro'">取消</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.kv { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px dashed var(--line); }
.kv span { color: var(--muted); }
.warns { margin-top: 10px; max-height: 160px; overflow: auto; }
.warn { background: #FFF7E8; color: #8A5A00; border-radius: 8px; padding: 8px 10px; font-size: 12px; margin-bottom: 6px; }
</style>
