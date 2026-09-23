/**
 * 头像（v2.47；v2.54 改成**可拖动裁剪**）。
 *
 * 流程：相册选图 → `AvatarCropper` 让用户自己拖动/缩放取景框 → 本机裁成 1:1 → 压到 256×256 → 存 data URL。
 * 为什么存 data URL 而不是文件路径：Android WebView **加载不了 `file://` 图片**（AGENTS.md 里记过这条坑），
 * 而 data URL 在网页和 APK 里都能直接显示。体积也可控（256×256 JPEG 约 10~30 KB）。
 */
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { guard } from './guard.ts';

export const AVATAR_SIZE = 256;

/** 从 (w,h) 里取最大的居中正方形（自动裁剪时用；v2.54 起默认走可拖动裁剪，这个仍留着做兜底） */
export function squareCropRect(w: number, h: number): { sx: number; sy: number; size: number } {
  const size = Math.max(1, Math.min(w || 0, h || 0));
  return { sx: Math.floor(((w || 0) - size) / 2), sy: Math.floor(((h || 0) - size) / 2), size };
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('这张图片读不出来，换一张试试'));
    img.src = dataUrl;
  });
}

/**
 * 裁剪参数（v2.54）。
 *
 * 约定：取景框是**固定**的正方形（边长 `view`），用户拖动图片、并用滑杆缩放。
 *  - `base` = 让图片**铺满**取景框的基准缩放（cover）；
 *  - `zoom` = 用户额外放大倍数（1~4）；
 *  - `dx/dy` = 图片相对取景框中心的位移（CSS 像素，已按"图片必须盖住取景框"夹取过）。
 * 返回的是**原图像素坐标**里的裁剪矩形，交给 canvas drawImage 用。
 */
export interface CropView { view: number; nw: number; nh: number; zoom: number; dx: number; dy: number }

export function cropRectFor(v: CropView): { sx: number; sy: number; size: number } {
  const view = Math.max(1, v.view);
  const nw = Math.max(1, v.nw);
  const nh = Math.max(1, v.nh);
  const base = Math.max(view / nw, view / nh);          // cover
  const scale = base * Math.max(1, Math.min(4, v.zoom || 1));
  const size = view / scale;                            // 取景框在原图里的边长
  const maxX = (nw * scale - view) / 2;
  const maxY = (nh * scale - view) / 2;
  const dx = Math.max(-maxX, Math.min(maxX, v.dx || 0));
  const dy = Math.max(-maxY, Math.min(maxY, v.dy || 0));
  // 图片中心 → 原图坐标：拖到右边（dx>0）时看到的是原图更靠左的部分
  const cx = nw / 2 - dx / scale;
  const cy = nh / 2 - dy / scale;
  const half = size / 2;
  return {
    sx: Math.max(0, Math.min(nw - size, cx - half)),
    sy: Math.max(0, Math.min(nh - size, cy - half)),
    size
  };
}

/** 按给定矩形裁剪并缩到 AVATAR_SIZE，返回 JPEG data URL */
export async function cropToAvatar(source: string, rect: { sx: number; sy: number; size: number }, size = AVATAR_SIZE): Promise<string> {
  const img = await loadImage(source);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('这台设备不支持裁剪图片');
  ctx.drawImage(img, rect.sx, rect.sy, rect.size, rect.size, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * 选头像（**只选图，不裁**）：返回原图 data URL，交给 `AvatarCropper` 让用户自己取景。
 * 用户取消返回 null（不是错误）。原生调用包了 `guard()`（AGENTS.md 硬规则 8）。
 */
export async function pickAvatarRaw(): Promise<string | null> {
  let photo: { dataUrl?: string } | null = null;
  try {
    photo = await guard('选择头像', Camera.getPhoto({
      quality: 92, resultType: CameraResultType.DataUrl, source: CameraSource.PhotosLibrary, correctOrientation: true
    }) as Promise<{ dataUrl?: string }>, 60_000, null);
  } catch { return null; }
  return photo?.dataUrl || null;
}

/** 兜底：不打开裁剪界面时，直接居中裁一张（自动化测试/异常路径用） */
export async function pickAvatar(sizes = AVATAR_SIZE): Promise<string | null> {
  const raw = await pickAvatarRaw();
  if (!raw) return null;
  const img = await loadImage(raw);
  return cropToAvatar(raw, squareCropRect(img.naturalWidth || img.width, img.naturalHeight || img.height), sizes);
}
