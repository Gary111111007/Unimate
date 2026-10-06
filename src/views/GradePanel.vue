<script setup lang="ts">
// 成绩查询面板（P4）：真实抓取和内置样本都走 parseAcademicGrades，
// 结果只保存到本机 grades/grades.json，不触发云端同步。
import { computed, ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { JwWebView, isNativeWebView } from '../services/jwwebview.ts';
import { parseAcademicGrades, type GradeDraft } from '../services/parser/academic.ts';
import { buildGradeSampleHtml } from '../services/gradeDemo.ts';
import ParserRulesBar from '../components/ParserRulesBar.vue';

const props = defineProps<{ startUrl: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();
const db = useDb();

const step = ref<'intro' | 'working' | 'preview' | 'error'>('intro');
const errMsg = ref('');
const parsed = ref<GradeDraft[]>([]);
const demo = ref(false);
const mode = ref<'merge' | 'overwrite'>('merge');
const summary = ref<{ total: number; saved: number; demo: boolean; mode: string } | null>(null);
const existingCount = computed(() => db.grades.length);
const previewItems = computed(() => parsed.value.slice(0, 5));
const remainingCount = computed(() => Math.max(0, parsed.value.length - 5));

async function openJwglxt(): Promise<void> {
  if (!isNativeWebView()) {
    errMsg.value = '当前是桌面预览环境，打不开内嵌教务系统。请点下面的「用内置演示样本」走一遍完整流程。';
    step.value = 'error';
    return;
  }
  step.value = 'working';
  const r = await JwWebView.open({
    url: db.profile?.systems.jwglxtUrl || props.startUrl,
    startUrl: props.startUrl,
    title: '成绩查询',
    allowExternal: true,
    mode: 'grade',
    scrapeSelector: '#gbox_tabGrid,#tabGrid,table.ui-jqgrid-btable,table,body'
  });
  if (!r.ok) {
    const reason = r.reason || '';
    errMsg.value = reason === 'cancelled' ? '已取消：这次没有识别成绩。'
      : reason === 'no-table' ? '当前页面里没有成绩表格。请先进入「成绩查询」，选学期并点「查询」，出现成绩列表后再点「识别成绩」。'
      : '未能识别成绩：' + reason;
    step.value = 'error';
    return;
  }
  await importHtml(r.html || '', false);
}

async function useSample(): Promise<void> {
  step.value = 'working';
  await importHtml(buildGradeSampleHtml(), true);
}

async function importHtml(html: string, isDemo: boolean): Promise<void> {
  const result = parseAcademicGrades(html);
  if (!result.records.length) {
    errMsg.value = result.diagnostics[0]?.message || '没有解析到成绩记录。';
    step.value = 'error';
    return;
  }
  parsed.value = result.records;
  demo.value = isDemo;
  mode.value = 'merge';
  step.value = 'preview';
}

function gradeKey(record: Partial<GradeDraft>): string {
  return [record.courseCode || record.courseName || '', record.termId || '', record.score || ''].join('|');
}

async function saveGrades(): Promise<void> {
  if (mode.value === 'overwrite' && existingCount.value > 0) {
    const ok = await db.confirm({
      title: '确认覆盖本机成绩？',
      body: '本机现有 ' + existingCount.value + ' 条成绩，将被本次识别到的 ' + parsed.value.length + ' 条替换。',
      detail: '覆盖只影响本机成绩文件 grades/grades.json；成绩不会上传云端，也不会影响课表和记事本。',
      confirmText: '确定覆盖'
    });
    if (!ok) return;
  }

  let saved = parsed.value;
  if (mode.value === 'merge') {
    const map = new Map<string, any>();
    for (const old of db.grades) map.set(gradeKey(old), old);
    for (const item of parsed.value) {
      const key = gradeKey(item);
      const old = map.get(key);
      map.set(key, old ? { ...old, ...item, id: old.id, createdAt: old.createdAt } : item);
    }
    saved = [...map.values()];
  }

  db.replaceGrades(saved);
  await db.saveGrades();
  summary.value = { total: parsed.value.length, saved: saved.length, demo: demo.value, mode: mode.value };
  step.value = 'intro';
  db.notify('成绩已保存在本机：' + saved.length + ' 条（未上传云端）');
}
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="sheet">
      <div class="row"><div class="title grow">成绩查询</div><button class="btn sm ghost" @click="emit('close')">关闭</button></div>
      <div class="hairline"></div>

      <template v-if="step === 'intro'">
        <div class="li col" style="align-items: flex-start">
          <div class="bold">1. 打开教务系统并进入成绩查询</div>
          <div class="small muted">App 内自行登录，进入「成绩查询」，选好学期并点「查询」，出现成绩列表。</div>
        </div>
        <div class="li col" style="align-items: flex-start">
          <div class="bold">2. 点右下角常驻的「识别成绩」</div>
          <div class="small muted">只读取页面上的成绩表格，不读取、不保存账号密码，也不代填表单。</div>
        </div>
        <div class="li col" style="align-items: flex-start">
          <div class="bold">3. 只保存到本机</div>
          <div class="small muted">成绩写入本机 <b>grades/grades.json</b>，不会上传账号云端；换机备份也不会携带成绩。</div>
        </div>
        <button class="btn block" style="margin-top: 14px" @click="openJwglxt">🏛 打开教务系统（识别成绩）</button>
        <button class="btn block grey" style="margin-top: 10px" @click="useSample">用内置演示样本走一遍（离线可用）</button>
        <div class="small muted" style="margin-top: 10px">本机当前有 {{ existingCount }} 条成绩。演示样本是虚构数据，走的是与真实页面相同的解析器。</div>
        <ParserRulesBar adapter-id="academic-buct" />

        <div v-if="summary" class="card res">
          <div class="row" style="justify-content: space-between">
            <b class="small">{{ summary.demo ? '演示样本' : '教务系统' }}：识别到 {{ summary.total }} 条成绩</b>
            <span class="pill live">本机已有 {{ summary.saved }} 条</span>
          </div>
          <div class="small muted" style="margin-top: 4px">保存方式：{{ summary.mode === 'overwrite' ? '覆盖' : '合并' }}；没有上传云端。</div>
        </div>
      </template>

      <template v-else-if="step === 'preview'">
        <div class="li col" style="align-items: flex-start">
          <div class="bold">识别到 {{ parsed.length }} 条成绩</div>
          <div class="small muted">本机现有 {{ existingCount }} 条。确认后写入本机，不上云。</div>
        </div>
        <div class="row" style="gap: 10px; margin: 8px 0">
          <button class="btn grow" :class="{ grey: mode !== 'merge' }" @click="mode = 'merge'">合并</button>
          <button class="btn grow" :class="{ grey: mode !== 'overwrite' }" @click="mode = 'overwrite'">覆盖</button>
        </div>
        <div class="card res">
          <div v-for="item in previewItems" :key="gradeKey(item)" class="small" style="margin-top: 4px">
            {{ item.termId || '未识别学期' }} · {{ item.courseName }} · {{ item.score || '无成绩' }}
          </div>
          <div v-if="remainingCount > 0" class="small muted" style="margin-top: 6px">还有 {{ remainingCount }} 条未展开</div>
        </div>
        <div class="row" style="gap: 10px; margin-top: 14px">
          <button class="btn grey grow" @click="step = 'intro'">取消</button>
          <button class="btn grow" @click="saveGrades">保存到本机</button>
        </div>
      </template>

      <div v-else-if="step === 'working'" class="empty"><div class="big">⏳</div>正在识别成绩…</div>

      <div v-else>
        <div class="pill danger">没有识别到成绩</div>
        <p class="small">{{ errMsg }}</p>
        <div class="row">
          <button class="btn grow" @click="step = 'intro'">返回重试</button>
          <button class="btn grey grow" @click="useSample">改用演示样本</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.res { background: var(--soft); box-shadow: none; margin-top: 12px; }
</style>
