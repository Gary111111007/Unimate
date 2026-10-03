<script setup lang="ts">
/*
 * 外校正方 jwglxt 课表导入面板（v2.68）。
 *
 * 【与 ImportPanel.vue 的区别】（v2.72 起**两条链路各归各的学校**）
 *  ImportPanel 走的是「打开教务页面 → 用户自己点到课表表格 → 抓 DOM → jwglxtBuct 解析器」，
 *  那是**北化**的路径（内置档案 jwglxt-buct，页面结构已定型、有 Golden Test 压着）。
 *  这一份走「打开正方登录页 → 用户登录 → 点「导入课表」→ 原生用会话调 kbList 接口 → zfClient 解析」，
 *  是**外校正方**的路径，不要求用户自己找菜单，页面结构改了也不影响（走 JSON 而不是 DOM）。
 *
 *  【v2.72 分家原因】产品负责人明确要求「北化的就不要正方了，原来的那样是最好的」——
 *  北化早就有一套实测过的抓页面解析器，比走接口更稳。
 *  所以选校页按 `chainOf()` 分流：`buct` → ImportPanel，其它正方外校 → 这里。
 *  **这份面板不再给北化用**，别再把北化接回来。
 *
 * 【为什么不合并不是偷懒】预览 / 覆盖-合并 交互两边一模一样，抄过来保持一致；
 *  解析来源与错误话术各自独立，正好对应 AGENTS.md 硬规则 6（UI 文案必须与实现一致）。
 */
import { computed, ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { courseColorIndex } from '../catalog/periods.ts';
import { guard } from '../services/guard.ts';
import { uuid, nowStamp } from '../services/id.ts';
import { importFromZf, describeOutcome } from '../services/zfImport.ts';
import { writeText } from '../services/io.ts';
import type { Course, ParseResult } from '../types.ts';

const props = defineProps<{ schoolName: string; baseUrl: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const db = useDb();
const step = ref<'intro' | 'working' | 'preview' | 'error'>('intro');
const result = ref<ParseResult | null>(null);
const errMsg = ref('');
const mode = ref<'overwrite' | 'merge'>('merge');
/** 学期序号（1=秋 2=春 3=小学期），默认 1；学年由服务层按当前日期推算 */
const semester = ref(1);

const targetName = computed(() => (db.activeTimetable ? db.activeTimetable.name : '新建一份课表'));
const existingCount = computed(() => {
  const id = db.activeTimetable && db.activeTimetable.id;
  return id ? db.courses.filter((c) => c.timetableId === id).length : 0;
});
function overwriteLabel(): string {
  return existingCount.value ? '覆盖本课表（替换 ' + existingCount.value + ' 条）' : '覆盖本课表';
}
const SEMESTERS = [
  { v: 1, label: '第一学期（秋）' },
  { v: 2, label: '第二学期（春）' },
  { v: 3, label: '短学期（小学期）' }
];

async function start(): Promise<void> {
  step.value = 'working';
  try {
    /*
     * guard() 超时必须包着（AGENTS.md 硬规则 7）：WebView 是人机交互界面，
     * 超时给得很宽（10 分钟），但绝不能没有 —— 否则用户点了按钮没反应会以为 App 死了。
     */
    const r = await guard('正方课表导入', importFromZf({
      baseUrl: props.baseUrl, semester: semester.value
    }), 10 * 60 * 1000, { ok: false, errorKind: 'NETWORK_RETRYABLE' as const });

    if (!r.ok || !r.result) {
      errMsg.value = describeOutcome(r);
      // 用户自己返回 → 不算错误页，退回起始界面更自然
      step.value = r.errorKind === 'CANCELLED' ? 'intro' : 'error';
      return;
    }
    result.value = r.result;
    /*
     * 【v2.75 修：没有学校档案时会崩】
     * 这里原来直接 `db.profile!.schoolId`。以前进得来这个面板的学校**必定有档案**
     * （选校页只在 `profileOf()` 有值时才开），所以 `!` 一直没出事。
     * v2.75 起「课表识别」允许**没有云端档案**的学校直接试导入 ——
     * 那种情况下 `db.profile` 是 null，`!` 只是类型断言、运行时照样读到 undefined，
     * 路径会拼成 `schools/undefined/users/...`，**在用户最需要它的那条路上炸掉**。
     *
     * 原始课表留证只是"顺手存一份"，**不该成为导入的前置条件**：
     * 取不到学校档案标识就跳过留证，导入照常走（课表本来就存在本人数据区）。
     */
    if (r.raw) {
      const sid = db.profile?.schoolId;
      const uid = db.session?.accountId;
      if (sid && uid) {
        const b = 'schools/' + sid + '/users/' + uid;
        await guard('留存原始课表', writeText(b + '/timetable/imports/zf-' + Date.now() + '.json', r.raw), 10000);
      }
    }
    step.value = 'preview';
  } catch (e) {
    errMsg.value = '导入过程出错了：' + (e instanceof Error ? e.message : String(e));
    step.value = 'error';
  }
}

async function confirmImport(): Promise<void> {
  const r = result.value!;
  const tt = db.activeTimetable || db.newTimetable(r.semesterLabel || '我的课表');
  // 产品硬性要求（v2.15）：导入不直接覆盖已有课表，覆盖必须再过一次二次确认
  if (mode.value === 'overwrite' && existingCount.value > 0) {
    const ok = await db.confirm({
      title: '确认覆盖「' + tt.name + '」？',
      body: '这份课表现有 ' + existingCount.value + ' 条上课安排，将被本次抓取到的 ' + r.courses.length + ' 条替换。',
      detail: '覆盖后，你手动改过的教室、颜色、周次会被重置回教务系统的原始值（课程资料按课程名保留，不受影响）。'
        + '只想补上新抓到的安排请点「取消」，然后改选"合并"。',
      confirmText: '确定覆盖'
    });
    if (!ok) return;
  }
  tt.semesterLabel = r.semesterLabel || tt.semesterLabel;
  tt.source = 'jwglxt';
  tt.updatedAt = nowStamp();
  const mapped: Course[] = r.courses.map((c) => ({
    ...c, id: uuid(), timetableId: tt.id, colorIndex: courseColorIndex(c.name),
    editedFields: [], source: 'jwglxt'
  }));
  if (mode.value === 'overwrite') {
    db.courses = db.courses.filter((c) => c.timetableId !== tt.id).concat(mapped);
  } else {
    db.courses = db.courses.filter((c) => !(c.timetableId === tt.id && mapped.some((m) => m.name === c.name && m.day === c.day && m.startPeriod === c.startPeriod))).concat(mapped);
  }
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
      <div class="row"><div class="title grow">从正方教务导入课表</div><button class="btn sm ghost" @click="emit('close')">关闭</button></div>
      <div class="hairline"></div>

      <template v-if="step === 'intro'">
        <div class="li col" style="align-items: flex-start">
          <div class="bold">1. 在 App 内登录 {{ schoolName }} 的教务系统</div>
          <div class="small muted">Unimate 会打开正方 jwglxt 登录页，你自己输入学号、密码与验证码 —— App 不读取、不保存你的账号密码，也不代填表单。</div>
        </div>
        <div class="li col" style="align-items: flex-start">
          <div class="bold">2. 登录后点右下角「导入课表」</div>
          <div class="small muted">不用自己找「信息查询 → 课表查询」菜单：App 会用你的登录会话直接调正方课表接口取数据。</div>
        </div>
        <div class="field" style="margin-top: 12px"><label>要导入哪个学期</label>
          <div class="chips">
            <button v-for="s in SEMESTERS" :key="s.v" class="chip" :class="{ on: semester === s.v }" @click="semester = s.v">{{ s.label }}</button>
          </div>
        </div>
        <button class="btn block" style="margin-top: 14px" @click="start">🔐 打开正方教务并导入</button>
        <div class="small muted" style="margin-top: 10px">导入只读取课表数据；你的登录状态由系统浏览器内核保存，Unimate 看不到 Cookie 内容。</div>
      </template>

      <div v-else-if="step === 'working'" class="empty"><div class="big">⏳</div>正在等你在教务页面完成登录并点「导入课表」…</div>

      <div v-else-if="step === 'error'">
        <div class="pill danger">导入未完成</div>
        <p>{{ errMsg }}</p>
        <div class="row">
          <button class="btn grow" @click="step = 'intro'">返回重试</button>
        </div>
      </div>

      <template v-else-if="step === 'preview' && result">
        <div class="kv"><span>学期</span><b>{{ result.semesterLabel || '—' }}</b></div>
        <div class="kv"><span>识别结果</span><b>{{ result.distinctCourseNames }} 门课程 / {{ result.courses.length }} 条上课安排</b></div>
        <div class="kv"><span>导入到</span><b>{{ targetName }}<template v-if="existingCount">（现有 {{ existingCount }} 条）</template></b></div>
        <div class="kv"><span>需处理</span><b>{{ warns().length }} 项</b></div>
        <div v-if="warns().length" class="warns">
          <div v-for="(d, i) in warns()" :key="i" class="warn">{{ d.message }}</div>
        </div>
        <div class="field" style="margin-top: 14px"><label>重复导入策略（默认合并，不会动已有数据）</label>
          <div class="chips">
            <button class="chip" :class="{ on: mode === 'merge' }" @click="mode = 'merge'">合并（保留手动修正）</button>
            <button class="chip" :class="{ on: mode === 'overwrite' }" @click="mode = 'overwrite'">{{ overwriteLabel() }}</button>
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
