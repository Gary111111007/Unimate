<script setup lang="ts">
// 全屏看图：双指缩放、双击放大、拖动平移、左右切换（需求：点照片可放大）
import { computed, ref } from 'vue';

export interface ViewerItem { url: string; title: string; sub: string }
const props = defineProps<{ items: ViewerItem[]; start: number }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const i = ref(Math.min(Math.max(props.start, 0), Math.max(0, props.items.length - 1)));
const scale = ref(1);
const tx = ref(0);
const ty = ref(0);
const cur = computed(() => props.items[i.value]);

function reset(): void { scale.value = 1; tx.value = 0; ty.value = 0; }
function step(d: number): void {
  if (d > 0 && i.value < props.items.length - 1) i.value++;
  else if (d < 0 && i.value > 0) i.value--;
  reset();
}

let pinchDist = 0; let pinchScale = 1;
let lastX = 0; let lastY = 0; let dragging = false;
let lastTap = 0; let startX = 0; let moved = 0;

function dist(t: TouchList): number {
  const dx = t[0].clientX - t[1].clientX;
  const dy = t[0].clientY - t[1].clientY;
  return Math.hypot(dx, dy);
}
function onStart(e: TouchEvent): void {
  moved = 0;
  if (e.touches.length === 2) {
    pinchDist = dist(e.touches); pinchScale = scale.value;
    return;
  }
  dragging = true;
  lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
  startX = lastX;
}
function onMove(e: TouchEvent): void {
  if (e.touches.length === 2 && pinchDist > 0) {
    const d = dist(e.touches);
    scale.value = Math.min(5, Math.max(1, pinchScale * (d / pinchDist)));
    e.preventDefault();
    return;
  }
  if (!dragging) return;
  const x = e.touches[0].clientX; const y = e.touches[0].clientY;
  moved += Math.abs(x - startX);
  if (scale.value > 1.02) {
    tx.value += x - lastX; ty.value += y - lastY;
    e.preventDefault();
  }
  lastX = x; lastY = y;
}
function onEnd(e: TouchEvent): void {
  if (pinchDist > 0 && e.touches.length < 2) pinchDist = 0;
  if (scale.value <= 1.02) {
    const dx = lastX - startX;
    if (Math.abs(dx) > 56) step(dx < 0 ? 1 : -1);
  }
  if (scale.value <= 1.02) { tx.value = 0; ty.value = 0; }
  dragging = false;
  const now = Date.now();
  if (now - lastTap < 300) {
    if (scale.value > 1.05) reset(); else { scale.value = 2.4; }
  }
  lastTap = now;
}
</script>

<template>
  <div class="viewer" @touchstart="onStart" @touchmove="onMove" @touchend="onEnd">
    <div class="vbar">
      <button class="vb" @click="emit('close')">✕ 关闭</button>
      <div class="vt grow">{{ cur.title }}</div>
      <div class="vb-count">{{ i + 1 }} / {{ items.length }}</div>
    </div>

    <img :src="cur.url" :style="{ transform: 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')' }" />

    <div class="vfoot">
      <div class="small">{{ cur.sub }}</div>
      <div class="row" style="justify-content: space-between; margin-top: 8px">
        <button class="vb" :disabled="i === 0" @click="step(-1)">‹ 上一张</button>
        <span class="small hint">双指缩放 · 双击放大 · 拖动平移</span>
        <button class="vb" :disabled="i >= items.length - 1" @click="step(1)">下一张 ›</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.viewer { position: fixed; inset: 0; z-index: 120; background: rgba(6, 10, 18, .96); display: flex; flex-direction: column; touch-action: none; }
.vbar { display: flex; align-items: center; gap: 10px; padding: calc(10px + var(--safe-t)) 12px 10px; color: #fff; }
.vt { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vb-count { font-size: 12px; opacity: .8; }
.vb { color: #fff; background: rgba(255, 255, 255, .12); border-radius: 9px; padding: 7px 11px; font-size: 13px; }
.vb:disabled { opacity: .35; }
img { flex: 1; width: 100%; object-fit: contain; transition: transform .08s ease-out; will-change: transform; }
.vfoot { padding: 10px 12px calc(14px + var(--safe-b)); color: #fff; }
.hint { opacity: .55; }
</style>
