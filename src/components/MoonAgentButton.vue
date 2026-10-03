<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useDb } from '../stores/db.ts';
import { guard } from '../services/guard.ts';
import { anchorFromPos, clampToBox, posFromAnchor, toolBox } from '../services/toolbox.ts';

const props = defineProps<{ busy?: boolean; mode?: 'online' | 'offline' }>();
// v2.67：语音输入已下线（见 docs/agent-architecture.md）。月亮只保留"短按放大 / 再点进入 Uni"。
const emit = defineEmits<{ text: [] }>();
const db = useDb();

const holding = ref(false);
const moonDragging = ref(false);
const moonExpanded = ref(false);
const moonReady = ref(false);
const moonPos = ref({ x: 0, y: 0 });
const moonAnchor = ref({ fx: 0, fy: .91 });
const MOON_SMALL_SIZE = 40;
const MOON_LARGE_SIZE = 68;
const MOON_PAD = 8;
const moonSize = computed(() => moonExpanded.value ? MOON_LARGE_SIZE : MOON_SMALL_SIZE);
const moonStyle = computed(() => ({
  transform: 'translate3d(' + moonPos.value.x + 'px, ' + moonPos.value.y + 'px, 0)'
}));
let collapseTimer = 0;
let gesture: { id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean; wasExpanded: boolean } | null = null;

function zoomFactor(): number {
  try {
    const value = parseFloat(getComputedStyle(document.documentElement).zoom);
    return Number.isFinite(value) && value > 0 ? value : 1;
  } catch { return 1; }
}

function moonBounds() {
  return toolBox({
    viewW: window.innerWidth, viewH: window.innerHeight, zoom: zoomFactor(),
    barH: 0, size: moonSize.value, pad: MOON_PAD
  });
}

function placeMoon(): void {
  moonPos.value = posFromAnchor(moonAnchor.value, moonBounds());
}

function scheduleCollapse(): void {
  clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => {
    if (!moonDragging.value && !holding.value) {
      moonExpanded.value = false;
      placeMoon();
    }
  }, 4200) as unknown as number;
}

function expandMoon(): void {
  moonExpanded.value = true;
  placeMoon();
  scheduleCollapse();
}

function collapseMoon(): void {
  clearTimeout(collapseTimer);
  moonExpanded.value = false;
  placeMoon();
}

function saveMoonPosition(): void {
  moonAnchor.value = anchorFromPos(moonPos.value, moonBounds());
  db.settings.moonFab = { fx: moonAnchor.value.fx, fy: moonAnchor.value.fy };
  void guard('保存月亮按钮位置', db.saveData().then(() => true), 8000, false);
}

function pressStart(event: PointerEvent): void {
  if (props.busy || (event.currentTarget as HTMLButtonElement).disabled) return;
  clearTimeout(collapseTimer);
  placeMoon();
  holding.value = true;
  gesture = {
    id: event.pointerId, sx: event.clientX, sy: event.clientY,
    ox: moonPos.value.x, oy: moonPos.value.y, moved: false, wasExpanded: moonExpanded.value
  };
  try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* 不支持也可短按 */ }
}

function pressMove(event: PointerEvent): void {
  const current = gesture;
  if (!current || current.id !== event.pointerId) return;
  const z = zoomFactor();
  const dx = (event.clientX - current.sx) / z;
  const dy = (event.clientY - current.sy) / z;
  if (!current.moved && Math.abs(dx) + Math.abs(dy) > 8) {
    current.moved = true;
    moonDragging.value = true;
    holding.value = false;
  }
  if (!current.moved) return;
  moonPos.value = clampToBox(current.ox + dx, current.oy + dy, moonBounds());
}

function pressEnd(event: PointerEvent): void {
  holding.value = false;
  const current = gesture;
  gesture = null;
  moonDragging.value = false;
  if (!current || current.id !== event.pointerId) return;
  if (current.moved) {
    saveMoonPosition();
    if (moonExpanded.value) scheduleCollapse();
    return;
  }
  if (!current.wasExpanded) expandMoon();
  else { emit('text'); collapseMoon(); }
}

function pressCancel(): void {
  holding.value = false;
  if (gesture?.moved) saveMoonPosition();
  gesture = null;
  moonDragging.value = false;
  if (moonExpanded.value) scheduleCollapse();
}

function restoreMoonPosition(): void {
  const stored = db.settings.moonFab;
  if (stored && typeof stored.fx === 'number' && typeof stored.fy === 'number') {
    moonAnchor.value = {
      fx: Math.min(1, Math.max(0, stored.fx)),
      fy: Math.min(1, Math.max(0, stored.fy))
    };
  }
  placeMoon();
  moonReady.value = true;
}

onMounted(() => {
  restoreMoonPosition();
  window.addEventListener('resize', placeMoon);
});
onUnmounted(() => {
  clearTimeout(collapseTimer);
  window.removeEventListener('resize', placeMoon);
});
</script>

<template>
  <button
    class="uni-moon-launcher"
    :class="{
      'uni-moon-ready': moonReady,
      'uni-moon-holding': holding,
      'uni-moon-dragging': moonDragging,
      'uni-moon-expanded': moonExpanded,
      'uni-moon-offline': mode === 'offline'
    }"
    :style="moonStyle"
    :disabled="busy"
    :aria-label="mode === 'offline' ? 'Uni 月亮助手，Offline Mode；点击放大后再点进入对话，也可在全窗口拖动' : 'Uni 月亮助手；点击放大后再点进入对话，也可在全窗口拖动'"
    @pointerdown="pressStart"
    @pointermove="pressMove"
    @pointerup="pressEnd"
    @pointercancel="pressCancel"
    @contextmenu.prevent
  >
    <span class="uni-moon-glyph">☾</span>
  </button>
</template>

<style scoped>
.uni-moon-launcher {
  --moon-c1: #4f8cff;
  --moon-c2: #7868ff;
  --moon-c3: #c75cff;
  --moon-c4: #ff70ad;
  --moon-c5: #55d7ff;
  position: fixed; left: 0; top: 0; z-index: 58;
  width: 40px; height: 40px; padding: 0; border: none; border-radius: 0;
  color: #536dcc; background: transparent; box-shadow: none; appearance: none;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  opacity: 0; pointer-events: none;
  transition: width .16s ease, height .16s ease, opacity .16s ease;
}
.uni-moon-launcher::before {
  content: '';
  position: absolute; left: 50%; top: 50%; z-index: 0;
  width: 36px; height: 36px; box-sizing: border-box; border-radius: 0;
  border: 1px solid rgba(255, 255, 255, .58);
  -webkit-clip-path: polygon(50% 0%, 61% 34%, 100% 50%, 61% 66%, 50% 100%, 39% 66%, 0% 50%, 39% 34%);
  clip-path: polygon(50% 0%, 61% 34%, 100% 50%, 61% 66%, 50% 100%, 39% 66%, 0% 50%, 39% 34%);
  background:
    radial-gradient(circle at 30% 22%, rgba(255, 255, 255, .34) 0%, rgba(255, 255, 255, .08) 32%, transparent 58%),
    linear-gradient(135deg, rgba(79, 140, 255, .16), rgba(199, 92, 255, .12) 48%, rgba(255, 112, 173, .15) 72%, rgba(85, 215, 255, .12));
  background-size: 180% 180%;
  -webkit-backdrop-filter: blur(7px) saturate(145%);
  backdrop-filter: blur(7px) saturate(145%);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, .56),
    inset 0 -1px 2px rgba(105, 104, 255, .14),
    0 0 8px rgba(112, 103, 255, .2),
    0 0 14px rgba(225, 97, 255, .12);
  filter: drop-shadow(0 0 5px rgba(112, 103, 255, .24)) drop-shadow(0 0 9px rgba(225, 97, 255, .14));
  opacity: .82; pointer-events: none;
  transform: translate(-50%, -50%);
  animation: uni-moon-glass-ring 6.4s ease-in-out infinite;
  transition: width .16s ease, height .16s ease, opacity .16s ease, box-shadow .2s ease;
}
.uni-moon-ready { opacity: 1; pointer-events: auto; }
.uni-moon-launcher:disabled { opacity: .58; }
.uni-moon-expanded { width: 68px; height: 68px; }
.uni-moon-expanded::before {
  width: 62px; height: 62px;
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, .62),
    inset 0 -1px 3px rgba(105, 104, 255, .18),
    0 0 12px rgba(112, 103, 255, .28),
    0 0 20px rgba(225, 97, 255, .18);
}
.uni-moon-holding .uni-moon-glyph { opacity: .68; }
.uni-moon-holding::before { opacity: .62; }
.uni-moon-dragging { opacity: .76; }
.uni-moon-offline {
  --moon-c1: #7887a7;
  --moon-c2: #6f7893;
  --moon-c3: #9b83b1;
  --moon-c4: #a97f9b;
  --moon-c5: #779eae;
}
.uni-moon-glyph {
  position: relative; display: inline-block;
  z-index: 1; font-size: 29px; line-height: 1; color: transparent;
  background: linear-gradient(135deg, var(--moon-c1) 0%, var(--moon-c2) 25%, var(--moon-c3) 52%, var(--moon-c4) 72%, var(--moon-c5) 100%);
  background-size: 220% 220%;
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
  -webkit-text-stroke: 1px rgba(105, 85, 230, .52);
  filter: drop-shadow(0 0 3px rgba(105, 104, 255, .62)) drop-shadow(0 0 7px rgba(228, 91, 255, .3));
  transform-origin: 50% 55%;
  animation: uni-moon-aurora 4.8s ease-in-out infinite, uni-moon-breathe 2.8s ease-in-out infinite;
  transition: font-size .16s ease, opacity .16s ease, filter .2s ease;
}
.uni-moon-expanded .uni-moon-glyph {
  font-size: 49px;
  filter: drop-shadow(0 0 5px rgba(105, 104, 255, .72)) drop-shadow(0 0 11px rgba(228, 91, 255, .42));
}
.uni-moon-offline .uni-moon-glyph { filter: drop-shadow(0 0 4px rgba(112, 128, 158, .42)); }
.uni-moon-offline .uni-moon-glyph { -webkit-text-stroke-color: rgba(95, 110, 142, .48); }
.uni-moon-offline.uni-moon-expanded .uni-moon-glyph { filter: drop-shadow(0 0 8px rgba(112, 128, 158, .52)); }
.uni-moon-offline::before {
  border-color: rgba(226, 232, 242, .52);
  background:
    radial-gradient(circle at 30% 22%, rgba(255, 255, 255, .26) 0%, rgba(255, 255, 255, .06) 32%, transparent 58%),
    linear-gradient(135deg, rgba(120, 135, 167, .14), rgba(155, 131, 177, .1), rgba(119, 158, 174, .12));
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, .42), 0 0 10px rgba(112, 128, 158, .16);
}
@keyframes uni-moon-aurora {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}
@keyframes uni-moon-glass-ring {
  0%, 100% { background-position: 0% 50%; opacity: .76; }
  50% { background-position: 100% 50%; opacity: .92; }
}
@keyframes uni-moon-breathe {
  0%, 100% { transform: scale(.96); }
  50% { transform: scale(1.04); }
}
@media (prefers-reduced-motion: reduce) {
  .uni-moon-glyph, .uni-moon-launcher::before { animation: none; }
}
</style>
