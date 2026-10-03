<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useDb } from '../stores/db.ts';
import type { SchoolRow } from '../services/schoolCatalog.ts';
import { identifyVendor, type JwVendor } from '../catalog/jwSystems.ts';
import ZfImportPanel from '../views/ZfImportPanel.vue';
import ImportPanel from '../views/ImportPanel.vue';
import JwIdentifyPanel from '../views/JwIdentifyPanel.vue';

const db = useDb();
const q = ref('');
const pending = ref<SchoolRow | null>(null);
const contact = ref('');
/** v2.68：正在走方正导入的外校（有档案、且档案声明用的是正方 jwglxt） */
const zfPanel = ref<{ name: string; baseUrl: string } | null>(null);
/**
 * v2.71：正在「正方识别」的学校（用户自己填教务地址）。
 * 点"教务系统待识别"的卡片、或档案里没有 jwglxtUrl 时都会进这里。
 */
const identify = ref<{ name: string; schoolId: string } | null>(null);
/** v2.72：正在走「抓页面」导入的学校（北化）。 */
const scrapePanel = ref(false);

/**
 * 识别一行对应的教务系统品牌。
 * 优先级：本机有档案（内置/已下载）→ 读档案里的 systems.timetableAdapter 精确判断；
 * 没档案 → 走内置识别表（jwSystems.ts），查不到就如实显示"待识别"。
 * 这里**不联网、不探测** —— 识别不出来宁可不标，也不猜。
 *
 * 结果按 schoolId 缓存：`profileOf` 每次都做一次深拷贝（JSON.parse(JSON.stringify())），
 * 模板 v-for 里每行要问好几次，不缓存会在长名单上白跑几十次深拷贝。
 * 档案下载/更新后 schoolId 集合会变 → 用 db.profile 与 downloadedList 长度做版本哨兵失效。
 */
const jwCache = new Map<string, JwVendor>();
let jwCacheStamp = '';
function jwOf(s: SchoolRow): JwVendor {
  const stamp = String(db.downloadedList.length) + ':' + (db.profile ? db.profile.schoolId + '@' + db.profile.profileVersion : '-');
  if (stamp !== jwCacheStamp) { jwCache.clear(); jwCacheStamp = stamp; }
  const hit = jwCache.get(s.schoolId);
  if (hit) return hit;
  const p = db.profileOf(s.schoolId);
  const v = identifyVendor(s.schoolId, p ? p.systems.timetableAdapter : undefined);
  jwCache.set(s.schoolId, v);
  return v;
}

/**
 * v2.72：这所学校该走哪条导入链路。
 *
 * 产品负责人原话（截图里是北化的正方面板）：「这个就不要正方了，原来的那样是最好的」——
 * 北化用的是**已经做过 Golden Test 的抓页面解析器**（`jwglxt-buct` + `#kbgrid_table_0`），
 * 用户自己点到课表表格再抓 DOM，这条路对北化最稳（页面结构已定型、有样本兜底）。
 *
 * 所以**同一个 `zf` 厂商，北化走抓页面、其它正校外校走 kbList 接口**：
 *  - `'scrape'` → `ImportPanel.vue`（北化：打开教务页面 → 自己点课表 → 抓 DOM）
 *  - `'api'`    → `ZfImportPanel.vue`（外校：登录会话 + 同源调 kbList JSON）
 *
 * 【为什么按 schoolId 判而不是按厂商判】厂商相同不代表页面结构相同：
 * 北化那套 `jwglxt` 的表格选择器是实测出来的，外校没这个把握，
 * 走 JSON 接口反而对外校更宽容（页面改了也不影响）。**两条链路都保留，各走各的。**
 */
function chainOf(s: SchoolRow): 'scrape' | 'api' {
  return s.schoolId === 'buct' ? 'scrape' : 'api';
}

/**
 * v2.72：卡片上的教务系统标签。
 *
 * 北化走抓页面链路（`ImportPanel`），面板里已经不出现"正方"字样，
 * 所以卡片上也不该写「正方教务」——**文案必须与实现一致**（AGENTS.md 硬规则 6）。
 * 统一写成中性的「教务系统已适配」+「可从教务系统导入」，外校正方仍标「正方教务」。
 */
function jwTagOf(s: SchoolRow): string {
  return chainOf(s) === 'scrape' ? '教务系统已适配' : jwOf(s).label;
}
/** 卡片上第二行小标签（怎么导入）——北化是"打开页面自己点"，外校是"登录后自动取" */
function jwHintOf(s: SchoolRow): string {
  return chainOf(s) === 'scrape' ? '打开教务页面导入' : '可登录导入课表';
}

// 分组口径：按校名拼音首字母（A–Z）分组，组内顺序即档案里的 order（拼音名次）。
// 北京化工大学 order=0 且 status=live，置顶在"首个落地高校"区，不参与字母分组。
const sorted = computed<SchoolRow[]>(() => {
  const k = q.value.trim().toLowerCase();
  const list = !k
    ? db.schoolRows.slice()
    : db.schoolRows.filter((s) =>
        s.name.toLowerCase().includes(k) || s.shortName.toLowerCase().includes(k)
        || s.province.includes(k) || s.letter.toLowerCase().includes(k) || s.schoolId.includes(k));
  return list.sort((a, b) => a.order - b.order || a.schoolId.localeCompare(b.schoolId));
});
/** 本机有档案的（内置落地 + 已下载）都放在"可直接使用"区 */
const live = computed(() => sorted.value.filter((s) => s.usable));
const groups = computed(() => {
  const map = new Map<string, SchoolRow[]>();
  for (const s of sorted.value.filter((x) => !x.usable)) {
    const letter = s.letter || '#';
    if (!map.has(letter)) map.set(letter, []);
    map.get(letter)!.push(s);
  }
  return [...map.entries()];
});

/** 打开选校页时检查一次远端档案清单（每天最多成功一次，失败 5 分钟退避；不阻塞界面） */
onMounted(() => { void db.checkCatalog(); });

function lastCheckText(): string {
  const t = db.catalog.lastOkAt;
  if (!t) return '';
  const d = new Date(t);
  return '上次检查：' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/** 一行的状态：正在检查 / 上次结果（含失败原因，重启后也还在）/ 还没检查过 */
const statusLine = computed(() => {
  if (db.catalog.busy) return '正在检查远端档案…';
  const parts = [db.catalog.msg, lastCheckText()].filter(Boolean);
  return parts.length ? parts.join(' · ') : '远端档案：尚未检查（打开这一页会自动检查，每天最多一次）';
});

/**
 * 点一行学校卡片。
 *
 * 【v2.71 关键改动】产品负责人原话：「这个界面你要做成去正方系统识别」——
 * 他指的是**点那些"教务系统待识别"的学校**时，不该只弹一句"尚未加入落地计划"，
 * 而应该像《教务助手》的「添加学校」那样，让用户**自己填教务地址 → 识别 → 试导入**。
 *
 * 判定顺序（越靠前越"用户意图明确"）：
 *  ① 正方可导入 + 档案里有地址 → 直接开导入面板（v2.70 的行为，保持不变）
 *  ② 本机已有档案、可直接用 → 切过去
 *  ③ 远端有档案 → 下载并使用（下完再点一次就会落到 ①）
 *  ④ **其余（含"教务系统待识别"）→ 开「课表识别」面板，让用户自己填地址**
 *  ⑤ 只有在识别面板都不适用时才退回"提交意向"
 *
 * 【为什么 ④ 不直接弹意向框】以前那一弹等于告诉用户"你想要的做不到"。
 * 现在至少给他一条"我自己知道教务地址，让我试"的路 —— 这也是"按校落地"的诚实做法：
 * 能试就让他试，试不成再留意向。
 */
async function pick(s: SchoolRow): Promise<void> {
  if (jwOf(s).importable) { openZfImport(s); return; }
  if (s.usable) {
    await db.selectSchool(s.schoolId);   // 已登录则直接进主界面，未登录则回到登录页
    if (!db.session) db.screen = 'login';
    return;
  }
  // 远端有档案 → 这一下是"下载并使用"；下完再点就会走 ①
  if (s.remote) { await download(s); return; }
  // v2.71：没有可用档案 → 让他自己填地址试（v2.75 起面板里不再拦"没档案"）
  pending.value = null;
  contact.value = '';
  identify.value = { name: s.name, schoolId: s.schoolId };
}

/**
 * v2.75：把「课表识别」打开。
 *
 * 【为什么要单独一个函数】产品负责人原话：「某某某学校通那边的添加那些网址，
 * 就可以让他们自己去添加了」—— 意思是**别让用户先绕去下载档案**，
 * 名单里任何一所（含"开发中"、含没有档案的）都该能直接进面板填地址。
 * 所以卡片右侧的「去识别」不再只是提示文字，而是**真的可点**，点了就开面板。
 */
function openIdentify(s: SchoolRow): void {
  pending.value = null;
  contact.value = '';
  identify.value = { name: s.name, schoolId: s.schoolId };
}

/**
 * v2.68：用正方账号导入外校课表。v2.70 起**整卡点击**也会走这里。
 *
 * 前置条件：**这所学校必须已经有本机档案**（内置的、或刚下载的）——
 * 没有档案就没有 `systems.jwglxtUrl`，我们连"登录页在哪"都不知道，更不该凭校名去猜域名。
 * 所以这里不要求先「切到该校」，而是：有档案就直接开导入面板；没档案先提示去下载。
 *
 * 【v2.71 补充】档案里**没有** `jwglxtUrl` 时不再只弹一句"无法导入"，
 * 而是直接开「正方识别」面板让用户自己填 —— 那句"无法导入"是死路，填地址是活路。
 */
function openZfImport(s: SchoolRow): void {
  const p = db.profileOf(s.schoolId);
  if (!p) {
    db.notify('请先下载《' + s.name + '》的档案，再导入课表');
    return;
  }
  const url = p.systems.jwglxtUrl;
  if (!url) {
    identify.value = { name: s.name, schoolId: s.schoolId };
    return;
  }
  /*
   * v2.72：北化走回「抓页面」老路（产品负责人要求），外校正方走 kbList 接口。
   * 两条链路的取舍与理由见 chainOf() 的注释。
   */
  if (chainOf(s) === 'scrape') { void openScrapeImport(s); return; }
  zfPanel.value = { name: s.name, baseUrl: url };
}

/**
 * v2.72：北化的抓页面导入。
 *
 * 【为什么这里比外校多一步"先切学校"】
 * `ImportPanel.vue` 不接收 props —— 它直接读 `db.profile.systems.jwglxtUrl`
 * （因为它原本只从**课表页**的「导入课表」按钮进入，那时用户必然已经切到该校）。
 * 现在选校页也能点进来，就可能出现"点了北化、但当前档案还是别的学校"的情况，
 * 那样会打开错的教务地址。所以先 `selectSchool` 把档案切过去，切成功再开面板。
 *
 * 未登录时 selectSchool 只是切了档案、停在登录页 —— 这种状态开面板没意义（没有 accountId
 * 可以写导入留档），所以只切不开，用户登录后从课表页进来是一样的。
 */
async function openScrapeImport(s: SchoolRow): Promise<void> {
  if (!db.session || db.profile?.schoolId !== s.schoolId) {
    const ok = await db.selectSchool(s.schoolId);
    if (!ok) return;
  }
  if (!db.session) return;   // 切完停在登录页，别开一个用不了的导入面板
  scrapePanel.value = true;
}

/**
 * 下载档案。校验都在服务层（验签过的清单 + sha256 + 域名白名单），这里只负责交互：
 *  - 更新**内置**高校的档案：下完就完事，不打扰；
 *  - 下载**新**高校：下完问一句要不要切过去（省得用户再找一遍）。
 */
async function download(s: SchoolRow): Promise<void> {
  const ok = await db.downloadSchool(s.schoolId);
  if (!ok) return;
  if (s.builtin) return;
  const yes = await db.confirm({
    // v2.47：原来这段话太长、确认框像一堵墙，改成一句问句 + 一句安心话
    title: '《' + s.name + '》档案已下载',
    body: '现在切到这所高校吗？',
    detail: '校验已通过，用法和内置高校一样。原来的数据还留在本机，切回来还能看到。',
    confirmText: '切过去', cancelText: '先不切', danger: false
  });
  if (yes) {
    await db.selectSchool(s.schoolId);
    if (!db.session) db.screen = 'login';
  }
}

/** 删除已下载档案 → 回到内置版本（Net.md P2 的回滚口径）。删除必须二次确认。 */
async function dropDownloaded(d: { schoolId: string; name: string; version: number; builtin: boolean }): Promise<void> {
  const ok = await db.confirm({
    title: '确认删除《' + d.name + '》的下载档案？',
    body: d.builtin
      ? '会删掉本机这份 v' + d.version + ' 的下载档案，改用 APK 内置的那一份。'
      : '这是远端下发的高校档案（内置名单里没有），删掉之后这所高校就不在本机了。',
    detail: '只影响这台手机上的档案文件；课表、记事、二课数据都不删。以后再点「可下载」能重新下回来。',
    confirmText: '确定删除'
  });
  if (!ok) return;
  await db.removeDownloaded(d.schoolId);
}

async function submitInterest(): Promise<void> {
  if (!pending.value) return;
  await db.addInterest(pending.value.schoolId, contact.value.trim());
  pending.value = null;
}
</script>

<template>
  <div class="screen">
    <div class="hero">
      <div class="hero-brand"><span class="logo">U</span><b>Unimate</b></div>
      <div class="sub">高校校园学习生活一站式智能助手</div>
      <div class="slogan">正在按校落地：先做好一所，再做一百所</div>
      <div v-if="db.session" class="who">{{ db.session.displayName }}，请选择你的高校</div>
    </div>

    <div class="head2">
      <div class="title">选择你的高校</div>
      <input v-model="q" class="search" placeholder="搜索校名 / 简称，如「北化」" />
      <!-- 远端档案状态（Net.md P2）：只在打开这一页时检查，每天最多成功一次 -->
      <div class="catline">
        <span class="small muted grow">
          {{ statusLine }}
        </span>
        <button class="btn sm ghost" :disabled="db.catalog.busy" @click="db.checkCatalog(true)">检查更新</button>
      </div>
    </div>

    <div class="scroll">
      <div
        v-for="s in live"
        :key="s.schoolId"
        class="school live"
        :class="{ 'school-zf': jwOf(s).importable }"
        role="button"
        :aria-label="jwOf(s).importable ? '导入《' + s.name + '》课表' : '使用《' + s.name + '》'"
        @click="pick(s)"
      >
        <div class="badge" :style="{ background: '#2C6FE0' }">{{ s.shortName.slice(0, 1) }}</div>
        <div class="grow">
          <div class="school-name">{{ s.name }}</div>
          <div class="school-sub">{{ s.province }} · 教务课表 · {{ s.schoolId === 'buct' ? '第二课堂' : (s.builtin ? '活动材料（无二课）' : '校园服务') }} · 校园服务</div>
          <div class="jwline">
            <span class="jwtag" :class="{ zf: jwOf(s).importable }">{{ jwTagOf(s) }}</span>
            <span v-if="jwOf(s).importable" class="jwtag hint">{{ jwHintOf(s) }}</span>
          </div>
        </div>
        <div class="rowbtns">
          <span v-if="s.downloaded" class="statepill live">已下载 · 已可使用</span>
          <span v-else class="statepill live">{{ s.order === 0 ? '首个落地高校 · 已可使用' : '已可使用' }}</span>
          <button v-if="s.updatable" class="statepill warn" @click.stop="download(s)">可更新</button>
          <span v-if="jwOf(s).importable" class="zfenter">导入课表 ›</span>
        </div>
      </div>
      <div v-if="!live.length" class="empty"><div class="big">🔍</div>没有匹配的高校</div>

      <template v-for="[letter, list] in groups" :key="letter">
        <div class="group">{{ letter }}</div>
        <div
          v-for="s in list"
          :key="s.schoolId"
          class="school"
          :class="{ 'school-zf': jwOf(s).importable, 'school-identify': !jwOf(s).importable }"
          role="button"
          :aria-label="jwOf(s).importable ? '导入《' + s.name + '》课表' : (s.remote ? '下载《' + s.name + '》档案' : '为《' + s.name + '》识别教务系统')"
          @click="pick(s)"
        >
          <div class="badge grey">{{ s.shortName.slice(0, 1) }}</div>
          <div class="grow">
            <div class="school-name">{{ s.name }}</div>
            <div class="school-sub">{{ s.province }}</div>
            <div class="jwline">
              <span class="jwtag" :class="{ zf: jwOf(s).importable }">{{ jwTagOf(s) }}</span>
              <span v-if="jwOf(s).importable" class="jwtag hint">{{ jwHintOf(s) }}</span>
            </div>
          </div>
          <div class="rowbtns">
            <!-- 外校最顺的路径：先下载档案（拿到教务地址），再进导入面板 -->
            <button v-if="s.remote" class="statepill brand" @click.stop="download(s)">可下载</button>
            <span v-if="!s.remote" class="statepill dev">开发中</span>
            <!--
              v2.71：没有可用档案的学校，给一条"我知道教务地址，让我试"的路。
              v2.75：从"提示文字"改成**真按钮** —— 产品负责人要求
              「某某某学校通那边的添加那些网址，就可以让他们自己去添加了」，
              所以任何一所都能点进来填地址，不必先绕去下载档案。
            -->
            <span v-if="jwOf(s).importable" class="zfenter">导入课表 ›</span>
            <button v-else class="zfenter identify" type="button" @click.stop="openIdentify(s)">去识别 ›</button>
          </div>
        </div>
      </template>

      <!-- 已下载档案：可一键回到内置（坏档案的退路） -->
      <template v-if="db.downloadedList.length">
        <div class="group">已下载的档案</div>
        <div v-for="d in db.downloadedList" :key="d.schoolId" class="school">
          <div class="badge grey">⬇</div>
          <div class="grow">
            <div class="school-name">{{ d.name }}</div>
            <div class="school-sub">v{{ d.version }} · {{ d.downloadedAt }}{{ d.builtin ? ' · 内置也有这一所' : ' · 仅本机有' }}</div>
          </div>
          <button class="btn sm danger" @click.stop="dropDownloaded(d)">删除</button>
        </div>
      </template>

      <div class="foot muted small">
        共 {{ db.schoolRows.length }} 所高校在列，其中 {{ db.schoolRows.filter((s) => s.usable).length }} 所可直接使用。
        名单仅表达计划推进顺序，不代表已获任何高校许可。<br />
        档案下载走的是<b>签名校验</b>：清单由开发方私钥签名，App 用内置公钥验签，校验不过一律不安装。
      </div>
    </div>

    <div v-if="pending" class="mask" @click.self="pending = null">
      <div class="intent">
        <div class="intent-head">
          <div class="intent-badge">{{ pending.shortName.slice(0, 1) }}</div>
          <div class="intent-name">
            <b>{{ pending.name }}</b>
            <span>{{ pending.province }}</span>
          </div>
        </div>
        <p class="intent-lead">《{{ pending.name }}》还没加入 Unimate 的落地计划。</p>
        <p class="intent-body">
          现在完成的是<b>北京化工大学</b>的教务课表导入、记事本提醒、第二课堂填报与校园在线内嵌。
          你可以留下意向，我们会记在本机清单里（当前版本不联网上报）。
        </p>
        <div class="intent-field">
          <label>学号 / 邮箱（选填）</label>
          <input v-model="contact" placeholder="留空也可以" />
        </div>
        <div class="intent-row">
          <button class="btn grow" @click="submitInterest">提交意向</button>
          <button class="btn ghost grow" @click="pending = null">返回</button>
        </div>
      </div>
    </div>

    <!-- v2.72：北化走回「抓页面」老路（打开教务页面 → 自己点课表 → 抓 DOM → jwglxt-buct）。
         产品负责人要求：北化不要正方面板，原来那样最好。 -->
    <ImportPanel v-if="scrapePanel" @close="scrapePanel = false" />

    <!-- v2.68：外校正方课表导入（登录会话 + kbList 接口） -->
    <ZfImportPanel
      v-if="zfPanel"
      :school-name="zfPanel.name"
      :base-url="zfPanel.baseUrl"
      @close="zfPanel = null"
    />

    <!-- v2.75：课表识别（用户自己填教务地址 → 识别 → 试导入）。
         点"教务系统待识别"的卡片、档案缺 jwglxtUrl、或点卡片上的「去识别」时打开。
         面板里**不再要求先下载档案**（产品负责人：让没有云端档案的也能用）。 -->
    <JwIdentifyPanel
      v-if="identify"
      :school-name="identify.name"
      :school-id="identify.schoolId"
      @close="identify = null"
    />
  </div>
</template>

<style scoped>
.hero { background: linear-gradient(160deg, #2C6FE0, #1B4FA8); color: #fff; padding: calc(34px + var(--safe-t)) 18px 22px; }
/*
 * 【v2.47 修】这里原来叫 `.brand`，而列表里的「可下载」按钮是 `class="pill brand"` ——
 * 于是按钮吃到了这里的 26px，真机截图上「可下载」比「开发中」大出三四倍。
 * 这就是 v2.40 `guard` 那一类**类名撞车**：scoped 样式照样会命中全局语义的类名。
 * 现在头顶这条横幅改名 `.hero-brand`，`.pill.brand` 交回给全局 styles.css 管。
 */
.hero-brand { display: flex; align-items: center; gap: 10px; font-size: 26px; }
.logo { width: 34px; height: 34px; border-radius: 10px; background: rgba(255, 255, 255, .18); display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 800; }
.sub { margin-top: 8px; font-size: 14px; opacity: .92; }
.slogan { margin-top: 3px; font-size: 12px; opacity: .7; }
.who { margin-top: 10px; font-size: 12px; background: rgba(255, 255, 255, .16); display: inline-block; padding: 4px 10px; border-radius: 999px; }
.head2 { padding: 14px; background: var(--card); border-bottom: 1px solid var(--line); }
.search { width: 100%; margin-top: 10px; padding: 11px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--soft); outline: none; }
.catline { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.catline .grow { flex: 1; min-width: 0; }
.school { display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--card); border-radius: 12px; margin-bottom: 8px; box-shadow: var(--shadow); }
.school.live { border: 1.5px solid var(--brand); }
/* 可导入正方的学校：整卡可点进导入面板，给一条左侧色条做"这里是入口"的暗示 */
.school-zf { border-left: 3px solid var(--brand); }
/* v2.71：待识别的学校也能点进「正方识别」，用一条更安静的色条区分（别抢"已可用"的视觉） */
.school-identify { border-left: 3px solid var(--line); }
.school:active { background: var(--soft); }
.badge { width: 40px; height: 40px; border-radius: 11px; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; flex: none; }
.badge.grey { background: #B9C1CC; }
/*
 * 卡片文字：school-name / school-sub。
 * 不叫 .bold / .small.muted —— 那些是全局语义的类名（AGENTS.md 硬规则 9 撞车史）。
 * min-width: 0 让长校名能正常折行而不是把右侧按钮挤出屏幕。
 */
.school-name { font-weight: 600; font-size: 15px; line-height: 1.3; }
.school-sub { margin-top: 2px; font-size: 12px; color: var(--muted); line-height: 1.45; }
.group { margin: 14px 2px 8px; font-size: 12px; color: var(--muted); letter-spacing: .5px; }
/*
 * 教务系统标识（jwSystems.ts 识别结果）。
 * 类名特意起成 jwline / jwtag —— 不叫 .pill / .tag / .brand：
 * v2.14 的 .block、v2.47 的 .brand 两次撞车都是因为复用了全局工具类的名字，
 * scoped 样式照样会命中全局语义（AGENTS.md 硬规则 9）。
 *
 * 【v2.71 修：暗色下「教务系统待识别」看不清】
 * 原来底色写死 #F0F2F5、字用 var(--muted) —— 浅色没问题，但 `scoped` 样式在暗色下
 * 拿到的是**浅灰底 + 60% 白字**，对比度只有 ~1.4:1，真机上几乎看不见（产品负责人反馈）。
 * 上面那段 `:root[data-theme='dark'] .pill/.chip/.grey` 兜不住 `.jwtag`，因为它不在那个名单里。
 * 现在改成走语义变量：底色 --soft-2、字 --muted，暗色下由变量自己切换；
 * 三个语义变体（zf / hint / dev）也各有暗色覆盖，不再靠写死的浅色。
 */
.jwline { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 5px; }
.jwtag {
  display: inline-block; padding: 1px 7px; border-radius: 6px; font-size: 11px;
  background: var(--soft-2); color: var(--muted);
}
.jwtag.zf { background: var(--tint); color: var(--brand); font-weight: 600; }
/* 「可登录导入课表」= 正向提示，用 ok 色的同族浅底（暗色下换成 ok 的透明叠加，别用浅绿） */
.jwtag.hint { background: rgba(52, 199, 89, .14); color: #1E7A38; }
:root[data-theme='dark'] .jwtag.hint { background: rgba(48, 209, 88, .18); color: #5BE07E; }
/* 「开发中」这枚也是待识别同类，跟着一起保证暗色可读 */
.statepill.dev { background: var(--soft-2); color: var(--muted); }
/*
 * 卡片右侧按钮组（v2.68）。
 * 名字用 rowbtns / statepill 而不是 .actions / .btn / .pill：
 * 全局 `.pill` 是 inline-block（宽度由内容决定），放进 flex 列里会被 stretch 拉成
 * 一条占满宽度的扁白条 —— 这正是 v2.70 真机截图里那条丑白条的成因。
 * 这里显式 align-self: flex-end + white-space: nowrap 把它钉回内容宽度。
 */
.rowbtns { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; flex: none; }
.statepill {
  align-self: flex-end; white-space: nowrap;
  display: inline-flex; align-items: center; padding: 3px 9px; border: none;
  border-radius: 999px; font-size: 11px; font-weight: 600; line-height: 1.5;
  font-family: inherit; cursor: default;
}
.statepill.live { background: var(--tint); color: var(--brand); }
.statepill.warn { background: #FFF2D8; color: #A2621A; cursor: pointer; }
.statepill.brand { background: var(--brand); color: #fff; cursor: pointer; }
.statepill:active { opacity: .82; }
/* 暗色下这两个浅底标签也必须看得清（v2.71 与 .jwtag 一起修） */
:root[data-theme='dark'] .statepill.warn { background: rgba(255, 159, 10, .18); color: #FFC46B; }
:root[data-theme='dark'] .statepill.dev { background: var(--soft-2); color: var(--muted); }
/* 整卡的入口提示：只做视觉引导，真正的点击热区是整张卡 */
.zfenter { font-size: 11px; font-weight: 600; color: var(--brand); white-space: nowrap; }
/*
 * v2.71「去识别」：语气比「导入课表」弱一档 —— 它只是"可以试试"，不是承诺。
 * v2.75 起它是个真按钮（不再是提示文字），所以要**去掉按钮的默认外观**
 * （原生 button 有边框/底色/字体），让它看起来还是一条轻量的文字入口。
 */
.zfenter.identify {
  padding: 0; border: none; background: none; font-family: inherit;
  color: var(--muted); font-weight: 500; cursor: pointer;
}
.zfenter.identify:active { opacity: .7; }
.foot { padding: 16px 6px 8px; line-height: 1.6; }
/*
 * 意向弹窗（v2.70 重做）。
 * 原来是 .sheet + .title + .hairline，正文又长又像"声明"，按钮文案还是"返回选择"。
 * 现在：头部是"校徽 + 校名/省份"，正文分「一句结论」+「一段说明」两级，按钮回到中性。
 */
.intent { width: min(92vw, 420px); background: var(--card); border-radius: 16px; padding: 18px; box-shadow: 0 18px 50px rgba(0, 0, 0, .28); }
.intent-head { display: flex; align-items: center; gap: 10px; }
.intent-badge { width: 36px; height: 36px; border-radius: 10px; flex: none; display: flex; align-items: center; justify-content: center; font-weight: 700; color: #fff; background: #B9C1CC; }
.intent-name { min-width: 0; }
.intent-name b { display: block; font-size: 16px; line-height: 1.3; }
.intent-name span { display: block; margin-top: 1px; font-size: 12px; color: var(--muted); }
.intent-lead { margin: 14px 0 0; font-size: 14px; font-weight: 600; line-height: 1.5; }
.intent-body { margin: 6px 0 0; font-size: 12.5px; line-height: 1.65; color: var(--muted); }
.intent-field { margin-top: 14px; }
.intent-field label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 6px; }
.intent-field input { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--soft); outline: none; }
.intent-row { display: flex; gap: 8px; margin-top: 16px; }
</style>
