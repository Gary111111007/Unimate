/**
 * 二维码（本机生成，v2.22）。
 *
 * 为什么用本地库而不是在线二维码接口：课表内容不该发给任何第三方服务，
 * 在线生成等于把"谁的课表"交给别人；`qrcode-generator` 是纯 JS、无依赖、MIT，
 * 离线就能算，和"数据不出本机"的口径一致。
 *
 * 输出 SVG（不是 canvas）：矢量、任意缩放都清晰，也不用依赖 canvas 环境（Node 测试里也能跑）。
 */
import qrcode from 'qrcode-generator';

/** 版本 40 / 纠错 L 的字节容量上限，超过就没法画成二维码了 */
export const QR_MAX_BYTES = 2900;

export function canEncodeQr(text: string): boolean {
  return new TextEncoder().encode(text).length <= QR_MAX_BYTES;
}

/**
 * 生成二维码 SVG 字符串。
 * 返回空串表示"内容太长，画不下"（调用方应降级为"只给链接"）。
 */
export function qrSvg(text: string, size = 240, margin = 4): string {
  if (!text || !canEncodeQr(text)) return '';
  let qr: any;
  try {
    qr = qrcode(0, 'L');           // 0 = 自动选版本（尽量小）
    qr.addData(text, 'Byte');      // payload 是 base64url，纯 ASCII，走 Byte 模式
    qr.make();
  } catch { return ''; }
  const count = qr.getModuleCount();
  const total = count + margin * 2;
  /*
   * 注意：这里**不要**再乘一个 scale()。
   * viewBox 用的就是"模块单位"（0..total），渲染尺寸交给 width/height ——
   * 第一版多套了一层 transform="scale(size/total)"，等于把二维码放大到框外，
   * 右边和下边被裁掉（真机反馈："二维码显示不全"）。
   * margin 是二维码规范要求的静默区（quiet zone），留 4 个模块。
   */
  const parts: string[] = [];
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (!qr.isDark(r, c)) continue;
      parts.push('M' + (c + margin) + ' ' + (r + margin) + 'h1v1h-1z');
    }
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" '
    + 'width="' + size + '" height="' + size + '" shape-rendering="crispEdges" role="img" aria-label="课表分享二维码">'
    + '<rect width="' + total + '" height="' + total + '" fill="#FFFFFF"/>'
    + '<path d="' + parts.join('') + '" fill="#000000"/>'
    + '</svg>';
}
