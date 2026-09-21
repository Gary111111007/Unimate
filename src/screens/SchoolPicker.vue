<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useDb } from '../stores/db.ts';
import type { SchoolRow } from '../services/schoolCatalog.ts';

const db = useDb();
const q = ref('');
const pending = ref<SchoolRow | null>(null);
const contact = ref('');

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

async function pick(s: SchoolRow): Promise<void> {
  if (s.usable) {
    await db.selectSchool(s.schoolId);   // 已登录则直接进主界面，未登录则回到登录页
    if (!db.session) db.screen = 'login';
    return;
  }
  // 远端有档案 → 这一下是"下载并使用"；没有才走"提交意向"
  if (s.remote) { await download(s); return; }
  pending.value = s;
  contact.value = '';
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
    title: '已下载《' + s.name + '》档案',
    body: '签名与校验和都通过，用法和内置高校一样：课表导入、记事本、提醒都能用。',
    detail: '要不要现在就切过去？原来的课表数据仍留在这台手机里，切回来还能看到。',
    confirmText: '现在就切过去', cancelText: '先不切', danger: false
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
      <div class="brand"><span class="logo">U</span><b>Unimate</b></div>
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
      <div v-for="s in live" :key="s.schoolId" class="school live" @click="pick(s)">
        <div class="badge" :style="{ background: '#2E5AAC' }">{{ s.shortName.slice(0, 1) }}</div>
        <div class="grow">
          <div class="bold">{{ s.name }}</div>
          <div class="small muted">{{ s.province }} · 教务课表 · {{ s.schoolId === 'buct' ? '第二课堂' : (s.builtin ? '活动材料（无二课）' : '校园服务') }} · 校园服务</div>
        </div>
        <span v-if="s.downloaded" class="pill live">已下载 · 已可使用</span>
        <span v-else class="pill live">{{ s.order === 0 ? '首个落地高校 · 已可使用' : '已可使用' }}</span>
        <button v-if="s.updatable" class="pill warn" @click.stop="download(s)">可更新</button>
      </div>

      <div v-if="!live.length" class="empty"><div class="big">🔍</div>没有匹配的高校</div>

      <template v-for="[letter, list] in groups" :key="letter">
        <div class="group">{{ letter }}</div>
        <div v-for="s in list" :key="s.schoolId" class="school" @click="pick(s)">
          <div class="badge grey">{{ s.shortName.slice(0, 1) }}</div>
          <div class="grow"><div class="bold">{{ s.name }}</div><div class="small muted">{{ s.province }}</div></div>
          <button v-if="s.remote" class="pill brand" @click.stop="download(s)">可下载</button>
          <span v-else class="pill dev">开发中</span>
        </div>
      </template>

      <!-- 已下载档案：可一键回到内置（坏档案的退路） -->
      <template v-if="db.downloadedList.length">
        <div class="group">已下载的档案</div>
        <div v-for="d in db.downloadedList" :key="d.schoolId" class="school">
          <div class="badge grey">⬇</div>
          <div class="grow">
            <div class="bold">{{ d.name }}</div>
            <div class="small muted">v{{ d.version }} · {{ d.downloadedAt }}{{ d.builtin ? ' · 内置也有这一所' : ' · 仅本机有' }}</div>
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
      <div class="sheet">
        <div class="title">{{ pending.name }}</div>
        <div class="hairline"></div>
        <p>《{{ pending.name }}》尚未加入 Unimate 落地计划。</p>
        <p class="muted">当前版本只完成<b>北京化工大学</b>的教务课表导入、记事本提醒、第二课堂填报与校园在线内嵌。
        你可以提交意向，我们会记录在本机清单里（第一版不联网上报）。</p>
        <div class="field"><label>选填：学号 / 邮箱，便于落地时通知你</label><input v-model="contact" placeholder="留空也可以" /></div>
        <div class="row">
          <button class="btn grow" @click="submitInterest">提交意向</button>
          <button class="btn ghost grow" @click="pending = null">返回选择</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hero { background: linear-gradient(160deg, #2E5AAC, #1B3B77); color: #fff; padding: calc(34px + var(--safe-t)) 18px 22px; }
.brand { display: flex; align-items: center; gap: 10px; font-size: 26px; }
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
.badge { width: 40px; height: 40px; border-radius: 11px; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; flex: none; }
.badge.grey { background: #B9C1CC; }
.group { margin: 14px 2px 8px; font-size: 12px; color: var(--muted); letter-spacing: .5px; }
.foot { padding: 16px 6px 8px; line-height: 1.6; }
</style>
