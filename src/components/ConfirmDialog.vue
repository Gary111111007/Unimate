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
.mask { position: fixed; inset: 0; z-index: 210; background: rgba(6, 10, 18, .58); display: flex; align-items: center; justify-content: center; padding: 22px; }
.dlg { width: 100%; max-width: 340px; background: var(--card); border-radius: 16px; padding: 16px; box-shadow: 0 16px 40px rgba(0, 0, 0, .32); }
.t { font-size: 16px; font-weight: 700; color: var(--text); }
.hairline { height: 1px; background: var(--line); margin: 12px 0; }
.b { font-size: 13px; line-height: 1.7; color: var(--text); word-break: break-all; }
.d { margin-top: 10px; font-size: 11.5px; line-height: 1.7; color: var(--muted); }
.row { display: flex; gap: 8px; margin-top: 16px; }
</style>