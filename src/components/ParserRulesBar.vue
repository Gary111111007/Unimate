<script setup lang="ts">
// 解析规则来源提示条（Net.md P2.5 / PRD 5.15）。
//
// 放在"导入课表""考试识别"面板里：用户看得见"现在是内置规则还是下发的规则包"，
// 出问题时能一键回到内置。规则包**不含任何可执行代码**（只有选择器/正则/字段下标），
// 所以这里不存在"要不要信任远端代码"的问题，只是"读得更多还是更少"。
import { computed } from 'vue';
import { useDb } from '../stores/db.ts';

const props = defineProps<{ adapterId: string }>();
const db = useDb();

const row = computed(() => db.adapterRows.find((r) => r.adapterId === props.adapterId) || null);
const source = computed(() => db.adapterSourceText(props.adapterId));
/** 远端清单里有没有"比现在更新"的规则包（教务改版时运营会先发一份，用户在这里一键拿） */
const remote = computed(() => {
  const idx = db.catalog.index;
  if (!idx) return null;
  const e = idx.adapters.find((a) => a.id === props.adapterId);
  if (!e) return null;
  const local = row.value ? row.value.version : 0;
  return e.version > local ? e : null;
});
const busy = computed(() => db.catalog.busy);

async function downloadRemote(): Promise<void> {
  if (!remote.value) return;
  await db.downloadAdapter(props.adapterId);
}

async function backToBuiltin(): Promise<void> {
  if (!row.value) return;
  const ok = await db.confirm({
    title: '确认回到内置解析规则？',
    body: '会删掉本机这份「' + props.adapterId + '」规则包（v' + row.value.version + '），改用 APK 内置的 v' + row.value.builtinVersion + '。',
    detail: '只影响解析教务页面的规则，不影响已经导入的课表/记事数据。以后还能再下回来。',
    confirmText: '确定回到内置'
  });
  if (ok) await db.removeAdapter(props.adapterId);
}
</script>

<template>
  <div class="rulesbar">
    <span class="small muted grow">解析规则：{{ source }}</span>
    <button v-if="remote" class="btn sm" :disabled="busy" @click="downloadRemote()">下载规则 v{{ remote.version }}</button>
    <button v-if="row" class="btn sm ghost" @click="backToBuiltin()">回到内置</button>
  </div>
</template>

<style scoped>
.rulesbar { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px dashed var(--line); margin-top: 8px; }
.rulesbar .grow { flex: 1; min-width: 0; }
</style>
