/**
 * 头像（v2.47）：从相册选一张 → 本机裁成 1:1 → 压到 256×256 → 存 data URL。
 *
 * 为什么存 data URL 而不是文件路径：Android WebView **加载不了 `file://` 图片**（AGENTS.md 里记过这条坑），
 * 而 data URL 在网页和 APK 里都能直接显示。体积也可控（256×256 JPEG 约 10~30 KB）。
 */
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { guard } from './guard.ts';

export const AVATAR_SIZE = 256;

/** 从 (w,h) 里取最大的居中正方形（1:1 裁剪的数学部分，单独拎出来是为了能单测） */
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

/** 把任意图片裁成 1:1 并缩到 AVATAR_SIZE，返回 JPEG data URL */
export async function squareDataUrl(source: string, size = AVATAR_SIZE): Promise<string> {
  const img = await loadImage(source);
  const rect = squareCropRect(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('这台设备不支持裁剪图片');
  ctx.drawImage(img, rect.sx, rect.sy, rect.size, rect.size, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * 选头像：相册选图 → 裁 1:1 → 返回 data URL。
 * 用户取消返回 null（不是错误）。原生调用包了 `guard()`（AGENTS.md 硬规则 8）。
 */
export async function pickAvatar(): Promise<string | null> {
  let photo: { dataUrl?: string } | null = null;
  try {
    photo = await guard('选择头像', Camera.getPhoto({
      quality: 92, resultType: CameraResultType.DataUrl, source: CameraSource.PhotosLibrary, correctOrientation: true
    }) as Promise<{ dataUrl?: string }>, 60_000, null);
  } catch { return null; }
  if (!photo?.dataUrl) return null;
  return squareDataUrl(photo.dataUrl);
}
