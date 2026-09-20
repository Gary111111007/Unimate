/**
 * 生成通知提示音 android/app/src/main/res/raw/unimate_notify.wav
 *
 * 为什么要自己生成：Capacitor 的本地通知插件只支持用 **raw 资源名** 给通知渠道设声音
 * （android.resource://<包名>/raw/<名字>），不能用系统默认铃声的 URI。
 * 而 Android 8+ 的渠道如果不设声音就是**静音渠道**，提醒到点只会静静躺进下拉栏。
 *
 * 用脚本生成而不是塞一个来路不明的音频文件：可复现、可审阅、体积小（约 27KB）。
 * 音色：两声短提示（D6 → A5），快起音 + 指数衰减，听感接近系统"叮咚"，
 * 不刺耳、不循环，适合课前提醒。
 *
 * 用法：node scripts/make-notify-sound.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 22050;          // 采样率：通知音不需要 CD 级，22.05kHz 足够且体积减半
const DUR = 0.62;          // 总时长（秒）
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'android', 'app', 'src', 'main', 'res', 'raw', 'unimate_notify.wav');

const n = Math.round(SR * DUR);
const buf = new Float64Array(n);

/** 往缓冲里叠加一个"钟音"：基频 + 一个非整数倍分音，快起音、指数衰减 */
function addTone(start, freq, dur, gain) {
  const i0 = Math.max(0, Math.round(start * SR));
  const i1 = Math.min(n, Math.round((start + dur) * SR));
  for (let i = i0; i < i1; i++) {
    const t = (i - i0) / SR;
    const env = Math.exp(-6.2 * t) * (1 - Math.exp(-260 * t));
    buf[i] += gain * env * (Math.sin(2 * Math.PI * freq * t) + 0.28 * Math.sin(2 * Math.PI * freq * 2.76 * t));
  }
}
addTone(0.0, 1174.7, 0.5, 0.55);   // 叮 D6
addTone(0.13, 880.0, 0.49, 0.5);   // 咚 A5

// 归一化到 -1.4dB，避免不同机型上的削波失真
let peak = 0;
for (const v of buf) peak = Math.max(peak, Math.abs(v));
const k = peak > 0 ? (0.85 / peak) : 0;

const pcm = Buffer.alloc(n * 2);
for (let i = 0; i < n; i++) {
  const v = Math.max(-1, Math.min(1, buf[i] * k));
  pcm.writeInt16LE(Math.round(v * 32767), i * 2);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);       // fmt 块长度
header.writeUInt16LE(1, 20);        // PCM
header.writeUInt16LE(1, 22);        // 单声道
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 2, 28);   // 字节率
header.writeUInt16LE(2, 32);        // 块对齐
header.writeUInt16LE(16, 34);       // 位深
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.concat([header, pcm]));
console.log('已生成 ' + OUT + '（' + ((44 + pcm.length) / 1024).toFixed(1) + ' KB，' + SR + 'Hz 单声道 16bit，' + DUR + 's）');
