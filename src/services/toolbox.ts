/**
 * 课表工具箱（右下角那颗 🧰）的位置几何：可拖动，但只能在"允许区域"内。
 *
 * 为什么单独抽成一个模块：这类事故已经出过两次 ——
 *   v2.13 按像素存坐标：字号变大、底栏长高之后，那个坐标落到屏幕外 / 底栏底下，按钮就此消失；
 *   v2.15 第一版又忘了 zoom：桌面（或原生 textZoom 不可用时的兜底）会把整页 CSS zoom，
 *   而 `window.innerWidth` 与 `getBoundingClientRect()` 给的是**缩放后**的视觉像素，
 *   `translate3d(x, y)` 用的却是**缩放前**的布局像素 —— 少除一次 zoom，大字号下按钮直接被推出屏幕。
 *
 * 因此这里所有函数只做纯计算、单位统一为"布局像素"，由测试逐条锁死边界。
 */

export interface ToolBox {
  minX: number; maxX: number; minY: number; maxY: number;
}

export interface ToolBoxInput {
  /** 视口宽（视觉像素，即 window.innerWidth） */
  viewW: number;
  /** 视口高（视觉像素，即 window.innerHeight） */
  viewH: number;
  /** 页面缩放系数（getComputedStyle(html).zoom；设备上用原生 textZoom 时为 1） */
  zoom: number;
  /** 底部导航栏高度（视觉像素，getBoundingClientRect().height） */
  barH: number;
  /** 按钮边长（布局像素） */
  size: number;
  /** 与屏幕边缘的最小间距（布局像素） */
  pad: number;
}

/**
 * 算出按钮允许出现的矩形（左上、右下都闭合），单位与 translate3d 一致。
 * 下边界把底部导航栏整个让出去：只留 8px 的话，字号一大底栏长高就会把按钮盖住。
 */
export function toolBox(i: ToolBoxInput): ToolBox {
  const z = i.zoom > 0 ? i.zoom : 1;
  const viewW = i.viewW / z;
  const viewH = i.viewH / z;
  const barH = (i.barH > 0 ? i.barH : 58) / z;
  const minX = i.pad;
  const minY = i.pad;
  const maxX = Math.max(minX, viewW - i.size - i.pad);
  const maxY = Math.max(minY, viewH - barH - i.pad - i.size);
  return { minX, maxX, minY, maxY };
}

function clampNum(v: number, lo: number, hi: number): number { return Math.min(Math.max(v, lo), hi); }

/** 把任意坐标夹进允许区域（拖动过程中每帧都调，保证"拖不出去"） */
export function clampToBox(x: number, y: number, b: ToolBox): { x: number; y: number } {
  return { x: clampNum(x, b.minX, b.maxX), y: clampNum(y, b.minY, b.maxY) };
}

/**
 * 像素位置 → 相对锚点（0~1）。
 * 存锚点而不是像素：换字号 / 换屏幕 / 横竖屏后按新尺寸换算，位置不可能跑到屏幕外。
 */
export function anchorFromPos(pos: { x: number; y: number }, b: ToolBox): { fx: number; fy: number } {
  const dx = b.maxX - b.minX;
  const dy = b.maxY - b.minY;
  return {
    fx: dx > 0 ? clampNum((pos.x - b.minX) / dx, 0, 1) : 1,
    fy: dy > 0 ? clampNum((pos.y - b.minY) / dy, 0, 1) : 1
  };
}

/** 相对锚点 → 当前尺寸下的像素位置 */
export function posFromAnchor(a: { fx: number; fy: number }, b: ToolBox): { x: number; y: number } {
  const fx = clampNum(a.fx, 0, 1);
  const fy = clampNum(a.fy, 0, 1);
  return {
    x: b.minX + (b.maxX - b.minX) * fx,
    y: b.minY + (b.maxY - b.minY) * fy
  };
}

/** 老备份里的像素坐标 → 先夹进当前允许区域，再换算成锚点 */
export function anchorFromLegacy(x: number, y: number, b: ToolBox): { fx: number; fy: number } {
  return anchorFromPos(clampToBox(x, y, b), b);
}
