// 界面字号（textZoom）。
// 为什么不用 CSS zoom/transform：课表格子、照片平移、工具箱拖动都是按像素算的，
// 整页缩放会让 clientX 与 getBoundingClientRect 的坐标系打架；
// WebView 原生 textZoom 只放大文字、不改布局，是最稳的做法。
import { JwWebView } from './jwwebview.ts';

const isNative = (): boolean => {
  try { return !!(window as any).Capacitor && (window as any).Capacitor.isNativePlatform(); } catch { return false; }
};

/** 四档，对应 textZoom 百分比 */
export const FONT_LEVELS = [
  { k: 88, t: '小' },
  { k: 100, t: '标准' },
  { k: 115, t: '大' },
  { k: 132, t: '特大' }
];

export interface ZoomResult { ok: boolean; applied: number; via: string; error: string }

export async function applyTextZoom(percent: number): Promise<ZoomResult> {
  const p = Math.min(180, Math.max(70, Math.round(percent || 100)));
  if (isNative()) {
    try {
      const r: any = await JwWebView.setTextZoom({ percent: p });
      if (r && r.ok) return { ok: true, applied: r.applied || p, via: 'textZoom', error: '' };
    } catch { /* 落回下面的兜底 */ }
  }
  // 桌面预览 / 原生不可用：退到 CSS zoom，至少开发者能看到效果
  try {
    document.documentElement.style.zoom = String(p / 100);
    return { ok: true, applied: p, via: 'zoom', error: '' };
  } catch {
    return { ok: false, applied: p, via: '', error: '当前环境不支持调整字号' };
  }
}
