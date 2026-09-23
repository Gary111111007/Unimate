<script setup lang="ts">
/**
 * 头像裁剪（v2.54）：产品负责人要求"可以自己拖动裁剪框来获得头像"。
 *
 * 做法：取景框固定为正方形（好理解、也不会裁歪），用户**拖动图片**取景、用滑杆放大，
 * 确认时按取景框在原图里的位置裁剪并缩到 256×256。
 * 数学部分在 `services/avatar.ts` 的 `cropRectFor()`（纯函数，有单测），这里只管手势与渲染。
 */
import { computed, ref, onMounted } from 'vue';
import { cropRectFor, cropToAvatar, AVATAR_SIZE } from '../services/avatar.ts';

const props = defineProps<{ src: string }>();
const emit = defineEmits<{ (e: 'done', dataUrl: string): void; (e: 'cancel'): void }>();

const VIEW = 260;          // 取景框边长（CSS 像素）
const box = ref<HTMLElement | null>(null);
const natural = ref({ w: 0, h: 0 });
const dx = ref(0);
const dy = ref(0);
const zoom = ref(1);
const busy = ref(false);
const err = ref('');
let dragging = false;
let last = { x: 0, y: 0 };

/** 预览用：图片铺满取景框的基准缩放 × 用户缩放 */
const scale = computed(() => {
  const n = natural.value;
  if (!n.w || !n.h) return 1;
  const base = Math.max(VIEW / n.w, VIEW / n.h);
  return base * zoom.value;
});
const imgStyle = computed(() => ({
  width: (natural.value.w * scale.value) + 'px',
  height: (natural.value.h * scale.value) + 'px',
  transform: 'translate(' + dx.value + 'px,' + dy.value + 'px)'
}));

function clampOffsets(): void {
  const n = natural.value;
  const maxX = Math.max(0, (n.w * scale.value - VIEW) / 2);
  const maxY = Math.max(0, (n.h * scale.value - VIEW) / 2);
  dx.value = Math.max(-maxX, Math.min(maxX, dx.value));
  dy.value = Math.max(-maxY, Math.min(maxY, dy.value));
}

function down(e: PointerEvent): void {
  dragging = true;
  last = { x: e.clientX, y: e.clientY };
  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
}
function move(e: PointerEvent): void {
  if (!dragging) return;
  dx.value += e.clientX - last.x;
  dy.value += e.clientY - last.y;
  last = { x: e.clientX, y: e.clientY };
  clampOffsets();
}
function up(): void { dragging = false; }

function onZoom(): void { clampOffsets(); }

async function confirm(): Promise<void> {
  busy.value = true;
  err.value = '';
  try {
    const rect = cropRectFor({ view: VIEW, nw: natural.value.w, nh: natural.value.h, zoom: zoom.value, dx: dx.value, dy: dy.value });
    const out = await cropToAvatar(props.src, rect, AVATAR_SIZE);
    emit('done', out);
  } catch (e: any) { err.value = e?.message || '裁剪失败，请重试'; }
  finally { busy.value = false; }
}

onMounted(() => {
  const img = new Image();
  img.onload = () => { natural.value = { w: img.naturalWidth || 1, h: img.naturalHeight || 1 }; clampOffsets(); };
  img.onerror = () => { err.value = '这张图片读不出来，换一张试试'; };
  img.src = props.src;
});
</script>

<template>
  <div class="cropmask">
    <div class="croptop">拖动图片取景 · 用滑杆放大</div>
    <div ref="box" class="cropview" :style="{ width: VIEW + 'px', height: VIEW + 'px' }"
         @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up">
      <img :src="src" :style="imgStyle" alt="待裁剪的头像" draggable="false" />
    </div>
    <input class="cropzoom" type="range" min="1" max="4" step="0.01" v-model.number="zoom" @input="onZoom" />
    <div v-if="err" class="croperr">{{ err }}</div>
    <div class="croprow">
      <button class="btn grey grow" @click="emit('cancel')">取消</button>
      <button class="btn grow" :disabled="busy || !!err" @click="confirm">{{ busy ? '处理中…' : '就这张' }}</button>
    </div>
  </div>
</template>

<style scoped>
.cropmask { position: fixed; inset: 0; z-index: 220; background: rgba(6, 10, 18, .92); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 18px; }
.croptop { color: #fff; font-size: 13px; opacity: .85; margin-bottom: 12px; }
.cropview { position: relative; overflow: hidden; border-radius: 14px; background: #000; touch-action: none; }
/* 取景框：四角亮线 + 中间细网格，让人一眼看出"这一块会被裁下来" */
.cropview::after { content: ''; position: absolute; inset: 0; border: 2px solid rgba(255, 255, 255, .9); border-radius: 14px; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .35); pointer-events: none; }
.cropview img { position: absolute; left: 50%; top: 50%; margin-left: 0; margin-top: 0; transform-origin: center; user-select: none; -webkit-user-drag: none; will-change: transform; translate: -50% -50%; }
.cropzoom { width: 260px; margin-top: 16px; }
.croprow { display: flex; gap: 10px; margin-top: 18px; width: 260px; }
.croperr { color: #FFB4A8; font-size: 12px; margin-top: 10px; }
</style>
