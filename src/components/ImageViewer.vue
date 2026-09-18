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
const zoomed = computed(() => scale.value > 1.02);

function reset(): void { scale.value = 1; tx.value = 0; ty.value = 0; }
function zoomTo(v: number): void {
  scale.value = Math.min(5, Math.max(1, v));
  if (scale.value <= 1.02) { tx.value = 0; ty.value = 0; }
}
/** 平移范围限制：不允许把图片拖到屏幕外看不见。 */
function clampPan(): void {
  const lim = Math.max(0, (scale.value - 1) * 400);
  tx.value = Math.max(-lim, Math.min(lim, tx.value));
  ty.value = Math.max(-lim, Math.min(lim, ty.value));
}
function step(d: number): void {
  if (d > 0 && i.value < props.items.length - 1) i.value++;
  else if (d < 0 && i.value > 0) i.value--;
  reset();
}

let pinchDist = 0; let pinchScale = 1;
let lastX = 0; let lastY = 0; let dragging = false;
let startX = 0; let moved = 0;
// 手势归零判定：只有"所有手指都离开屏幕"时才评估双击，
// 否则抬起第二根手指会被误判成第二次点击，把刚放大的倍率强制 reset()。
let downAt = 0; let sawMulti = false;

function dist(t: TouchList): number {
  const dx = t[0].clientX - t[1].clientX;
  const dy = t[0].clientY - t[1].clientY;
  return Math.hypot(dx, dy);
}
function onStart(e: TouchEvent): void {
  moved = 0;
  if (e.touches.length >= 2) {
    sawMulti = true;
    pinchDist = dist(e.touches); pinchScale = scale.value;
    dragging = false;
    return;
  }
  dragging = true;
  downAt = Date.now();
  lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
  startX = lastX;
}
function onMove(e: TouchEvent): void {
  if (e.touches.length === 2 && pinchDist > 0) {
    const d = dist(e.touches);
    scale.value = Math.min(5, Math.max(1, pinchScale * (d / pinchDist)));
    // 缩回 1 倍时把平移量归零，否则"放大→拖动→缩小"会停在偏移位置（真机反馈）。
    if (scale.value <= 1.02) { tx.value = 0; ty.value = 0; }
    else clampPan();
    e.preventDefault();
    return;
  }
  if (!dragging) return;
  const x = e.touches[0].clientX; const y = e.touches[0].clientY;
  moved += Math.abs(x - startX);
  if (zoomed.value) {
    tx.value += x - lastX; ty.value += y - lastY;
    clampPan();
    e.preventDefault();
  }
  lastX = x; lastY = y;
}
function onEnd(e: TouchEvent): void {
  // 还有手指按在屏上（双指抬起其中一根）：只结束捏合，不做任何手势判定
  if (e.touches.length > 0) {
    if (e.touches.length < 2) pinchDist = 0;
    return;
  }
  pinchDist = 0;
  dragging = false;
  if (!zoomed.value) {
    const dx = lastX - startX;
    if (Math.abs(dx) > 56) { step(dx < 0 ? 1 : -1); sawMulti = false; return; }
    tx.value = 0; ty.value = 0;
  }
  // 双击放大/还原：必须是"单指、快速、几乎没移动、且本次手势没出现过多指"
  const quick = Date.now() - downAt < 260;
  if (!sawMulti && quick && moved < 14) {
    if (zoomed.value) reset(); else scale.value = 2.4;
  }
  sawMulti = false;
}
</script>

<template>
  <div class="viewer" @touchstart="onStart" @touchmove="onMove" @touchend="onEnd" @touchcancel="onEnd">
    <div class="vbar">
      <button class="vb" @click="emit('close')">✕ 关闭</button>
      <div class="vt grow">{{ cur.title }}</div>
      <div class="vb-count">{{ i + 1 }} / {{ items.length }}</div>
    </div>

    <img :src="cur.url" :style="{ transform: 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')' }" />

    <div class="zbar">
      <button class="zb" :disabled="scale <= 1.02" @click="zoomTo(scale - 0.6)">－</button>
      <div class="zval" :class="{ on: zoomed }">{{ Math.round(scale * 100) }}%{{ zoomed ? ' · 已固定' : '' }}</div>
      <button class="zb" :disabled="scale >= 5" @click="zoomTo(scale + 0.6)">＋</button>
      <button class="zb wide" :disabled="!zoomed" @click="reset">还原</button>
    </div>

    <div class="vfoot">
      <div class="small">{{ cur.sub }}</div>
      <div class="row" style="justify-content: space-between; margin-top: 8px">
        <button class="vb" :disabled="i === 0" @click="step(-1)">‹ 上一张</button>
        <span class="small hint">双指缩放后松手即保持 · 双击切换 · 放大后可拖动</span>
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
.zbar { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 6px 12px; }
.zb { min-width: 40px; height: 34px; border-radius: 10px; background: rgba(255,255,255,.14); color: #fff; font-size: 17px; line-height: 1; }
.zb.wide { font-size: 13px; padding: 0 12px; }
.zb:disabled { opacity: .32; }
.zval { min-width: 96px; text-align: center; font-size: 12.5px; color: rgba(255,255,255,.62); font-variant-numeric: tabular-nums; }
.zval.on { color: #8FD3A0; }
.vfoot { padding: 10px 12px calc(14px + var(--safe-b)); color: #fff; }
.hint { opacity: .55; }
</style>