// 拍照水印（PRD 5.6.4）：本地 Canvas 烧录，零第三方 Key，用户可自主开关与逐行选择。
import type { Settings } from '../types.ts';

export interface WatermarkInput {
  base64: string;            // 原图（不含 data: 前缀）
  title: string;
  capturedAt: string;
  latitude: number | null;
  longitude: number | null;
  address: string;
  schoolBadge: string;
  lines: Settings['watermarkLines'];
  customText: string;
  opacity: number;
}

function loadImage(b64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = 'data:image/jpeg;base64,' + b64;
  });
}

function pickFont(w: number): string {
  const size = Math.max(16, Math.round(w / 26));
  return size + 'px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
}

export async function applyWatermark(input: WatermarkInput): Promise<{ base64: string; width: number; height: number }> {
  const img = await loadImage(input.base64);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.drawImage(img, 0, 0, w, h);

  const rows: string[] = [];
  if (input.lines.custom && input.customText) rows.push(input.customText);
  if (input.lines.time) rows.push(input.capturedAt);
  if (input.lines.coordinate) {
    rows.push(input.latitude !== null && input.longitude !== null
      ? input.latitude.toFixed(4) + 'N, ' + input.longitude.toFixed(4) + 'E'
      : '未获取定位');
  }
  if (input.lines.address && input.address) rows.push(input.address);
  if (!rows.length && !input.lines.badge) return { base64: input.base64, width: w, height: h };

  const font = pickFont(w);
  g.font = font;
  const lh = Math.round(parseInt(font, 10) * 1.5);
  const pad = Math.round(w * 0.022);
  const blockH = rows.length * lh + pad * 2;

  if (rows.length) {
    const grad = g.createLinearGradient(0, h - blockH, 0, h);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.35, 'rgba(0,0,0,' + Math.min(0.85, input.opacity + 0.25) + ')');
    grad.addColorStop(1, 'rgba(0,0,0,' + Math.min(0.9, input.opacity + 0.35) + ')');
    g.fillStyle = grad;
    g.fillRect(0, h - blockH, w, blockH);
    g.fillStyle = '#ffffff';
    g.textBaseline = 'top';
    g.shadowColor = 'rgba(0,0,0,.8)';
    g.shadowBlur = 4;
    rows.forEach((r, i) => g.fillText(r, pad, h - blockH + pad + i * lh));
    g.shadowBlur = 0;
  }
  if (input.lines.badge) {
    g.textAlign = 'right';
    g.font = 'bold ' + Math.round(parseInt(font, 10) * 0.8) + 'px system-ui, sans-serif';
    g.fillStyle = 'rgba(255,255,255,.92)';
    g.fillText('Unimate · ' + input.schoolBadge, w - pad, pad);
    g.textAlign = 'left';
  }
  return { base64: canvas.toDataURL('image/jpeg', 0.85).split(',')[1], width: w, height: h };
}
