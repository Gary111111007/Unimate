<script setup lang="ts">
import { computed, ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { SCHOOLS, type SchoolEntry } from '../catalog/universities.ts';

const db = useDb();
const q = ref('');
const pending = ref<SchoolEntry | null>(null);
const contact = ref('');

// 分组口径：按校名拼音首字母（A–Z）分组，组内顺序即 SCHOOLS 的 order（拼音名次）。
// 北京化工大学 order=0 且 status=live，置顶在"首个落地高校"区，不参与字母分组。
const sorted = computed<SchoolEntry[]>(() => {
  const k = q.value.trim().toLowerCase();
  const list = !k
    ? SCHOOLS.slice()
    : SCHOOLS.filter((s) =>
        s.name.toLowerCase().includes(k) || s.shortName.toLowerCase().includes(k)
        || s.province.includes(k) || s.letter.toLowerCase().includes(k));
  return list.sort((a, b) => a.order - b.order);
});
const live = computed(() => sorted.value.filter((s) => s.status === 'live'));
const groups = computed(() => {
  const map = new Map<string, SchoolEntry[]>();
  for (const s of sorted.value.filter((x) => x.status !== 'live')) {
    const letter = s.letter || '#';
    if (!map.has(letter)) map.set(letter, []);
    map.get(letter)!.push(s);
  }
  return [...map.entries()];
});

async function pick(s: SchoolEntry): Promise<void> {
  if (s.status === 'live') {
    await db.selectSchool(s.schoolId);   // 已登录则直接进主界面，未登录则回到登录页
    if (!db.session) db.screen = 'login';
    return;
  }
  pending.value = s;
  contact.value = '';
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
    </div>

    <div class="scroll">
      <div v-for="s in live" :key="s.schoolId" class="school live" @click="pick(s)">
        <div class="badge" :style="{ background: '#2E5AAC' }">{{ s.shortName.slice(0, 1) }}</div>
        <div class="grow">
          <div class="bold">{{ s.name }}</div>
          <div class="small muted">{{ s.province }} · 教务课表 · 第二课堂 · 校园在线</div>
        </div>
        <span class="pill live">首个落地高校 · 已可使用</span>
      </div>

      <div v-if="!live.length" class="empty"><div class="big">🔍</div>没有匹配的高校</div>

      <template v-for="[letter, list] in groups" :key="letter">
        <div class="group">{{ letter }}</div>
        <div v-for="s in list" :key="s.schoolId" class="school" @click="pick(s)">
          <div class="badge grey">{{ s.shortName.slice(0, 1) }}</div>
          <div class="grow"><div class="bold">{{ s.name }}</div><div class="small muted">{{ s.province }}</div></div>
          <span class="pill dev">开发中</span>
        </div>
      </template>

      <div class="foot muted small">
        共 {{ SCHOOLS.length }} 所高校在列，其中 {{ live.length }} 所已落地。名单仅表达计划推进顺序，不代表已获任何高校许可。
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
.school { display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--card); border-radius: 12px; margin-bottom: 8px; box-shadow: var(--shadow); }
.school.live { border: 1.5px solid var(--brand); }
.badge { width: 40px; height: 40px; border-radius: 11px; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; flex: none; }
.badge.grey { background: #B9C1CC; }
.group { margin: 14px 2px 8px; font-size: 12px; color: var(--muted); letter-spacing: .5px; }
.foot { padding: 16px 6px 8px; line-height: 1.6; }
</style>