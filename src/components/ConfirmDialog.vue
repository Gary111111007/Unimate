<script setup lang="ts">
// 全局二次确认弹层。App 内所有删除都走它，保证措辞与交互一致。
import { useDb } from '../stores/db.ts';
const db = useDb();
</script>

<template>
  <div v-if="db.confirmReq" class="mask" @click.self="db.answerConfirm(false)">
    <div class="dlg">
      <div class="t">{{ db.confirmReq.title }}</div>
      <div class="hairline"></div>
      <div class="b">{{ db.confirmReq.body }}</div>
      <div v-if="db.confirmReq.detail" class="d">{{ db.confirmReq.detail }}</div>
      <div class="row">
        <button class="btn grey grow" @click="db.answerConfirm(false)">{{ db.confirmReq.cancelText }}</button>
        <button :class="['btn', 'grow', db.confirmReq.danger ? 'danger' : '']" @click="db.answerConfirm(true)">
          {{ db.confirmReq.confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* v2.47：确认框统一排版 —— 标题别太大、正文一行行读得下去、按钮不要顶到边上 */
.mask { position: fixed; inset: 0; z-index: 210; background: rgba(6, 10, 18, .62); display: flex; align-items: center; justify-content: center; padding: 22px; }
.dlg { width: 100%; max-width: 320px; background: var(--card); border-radius: 18px; padding: 18px 16px 14px; box-shadow: 0 18px 44px rgba(0, 0, 0, .34); }
.t { font-size: 15.5px; font-weight: 700; line-height: 1.45; color: var(--text); }
.hairline { height: 1px; background: var(--line); margin: 12px 0; }
.b { font-size: 13.5px; line-height: 1.65; color: var(--text); word-break: break-all; }
.d { margin-top: 8px; font-size: 12px; line-height: 1.65; color: var(--muted); }
.row { display: flex; gap: 10px; margin-top: 18px; }
.row :deep(.btn) { min-height: 42px; font-size: 14px; }
</style>
