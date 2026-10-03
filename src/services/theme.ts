// 主题应用（PRD 5.12）。light / dark / system 三档；system 时用 matchMedia 换算成二值，
// 并监听系统切换实时生效。同时同步 <meta name="theme-color">，让状态栏跟着变。
export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeTransitionOrigin { x: number; y: number }
export interface ThemeRevealGeometry extends ThemeTransitionOrigin { radius: number }

/**
 * 圆形主题揭示要覆盖到视口最远角。单独导出几何计算，便于把动效边界做成可验证的不变量。
 */
export function themeRevealGeometry(origin: ThemeTransitionOrigin, width: number, height: number): ThemeRevealGeometry {
  const safeWidth = Math.max(0, Number.isFinite(width) ? width : 0);
  const safeHeight = Math.max(0, Number.isFinite(height) ? height : 0);
  const x = Math.min(safeWidth, Math.max(0, Number.isFinite(origin.x) ? origin.x : safeWidth / 2));
  const y = Math.min(safeHeight, Math.max(0, Number.isFinite(origin.y) ? origin.y : safeHeight / 2));
  return {
    x,
    y,
    radius: Math.hypot(Math.max(x, safeWidth - x), Math.max(y, safeHeight - y))
  };
}

export function isDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; }
}

export function applyTheme(mode: ThemeMode): void {
  const dark = isDark(mode);
  try {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    if (meta) meta.content = dark ? '#0E131C' : '#2E5AAC';
  } catch { /* 预览环境兜底 */ }
}

/** 监听系统深色切换；仅在当前是 system 档时生效。返回取消监听的函数。 */
export function watchSystemTheme(getMode: () => ThemeMode): () => void {
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const h = () => { if (getMode() === 'system') applyTheme('system'); };
    if (mq.addEventListener) { mq.addEventListener('change', h); return () => mq.removeEventListener('change', h); }
    // 老内核只支持 addListener
    (mq as any).addListener(h);
    return () => { try { (mq as any).removeListener(h); } catch { /* noop */ } };
  } catch { return () => { /* noop */ }; }
}

// ---------------- 状态栏配色随主题 ----------------
import { StatusBar } from '@capacitor/status-bar';
import { Preferences } from '@capacitor/preferences';

let statusWatcherOn = false;

/** 浅色主题配深色图标（Light 风格），深色主题配浅色图标（Dark 风格）。 */
export function applyStatusBar(): void {
  try {
    const dark = isDark((document.documentElement.dataset.theme as ThemeMode) || 'light');
    void StatusBar.setStyle({ style: (dark ? 'Dark' : 'Light') as any });
    void StatusBar.setBackgroundColor({ color: dark ? '#0E131C' : '#F2F4F8' }).catch(() => { /* 部分 ROM 不支持 */ });
  } catch { /* 预览环境忽略 */ }
}

/** 主题切换时同步状态栏；只在原生环境挂一次监听。 */
export function watchThemeForStatusBar(fn: () => void): void {
  if (statusWatcherOn) return;
  statusWatcherOn = true;
  const obs = new MutationObserver(() => fn());
  try { obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); } catch { /* 忽略 */ }
}

/**
 * 从触发点向最远角揭示新主题。旧 WebView、系统减少动态效果、主题视觉未变化时都即时切换。
 * View Transition 只负责截图层；真实 data-theme 仍由 applyTheme() 单点维护。
 */
export async function animateThemeChange(mode: ThemeMode, origin?: ThemeTransitionOrigin): Promise<void> {
  const nextTheme = isDark(mode) ? 'dark' : 'light';
  try {
    const currentTheme = document.documentElement.dataset.theme || 'light';
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const startViewTransition = (document as any).startViewTransition as undefined | ((update: () => void) => {
      ready: Promise<void>;
      finished: Promise<void>;
    });
    if (!origin || reduceMotion || !startViewTransition || currentTheme === nextTheme) {
      applyTheme(mode);
      return;
    }

    const geometry = themeRevealGeometry(origin, window.innerWidth, window.innerHeight);
    const transition = startViewTransition.call(document, () => applyTheme(mode));
    await transition.ready;
    const animation = document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${geometry.x}px ${geometry.y}px)`,
          `circle(${geometry.radius}px at ${geometry.x}px ${geometry.y}px)`
        ]
      },
      {
        duration: 460,
        easing: 'cubic-bezier(.2,.78,.28,1)',
        pseudoElement: '::view-transition-new(root)'
      } as any
    );
    await animation.finished.catch(() => { /* 动效被打断时，新主题仍已提交 */ });
  } catch {
    applyTheme(mode);
  }
}
