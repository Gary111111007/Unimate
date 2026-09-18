import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * 版权水印。源码里的普通注释会被 esbuild 压缩掉，APK 里一个字都看不到；
 * 因此用 rollup 的 output.banner / output.footer —— 它们是在产物压缩**之后**
 * 直接拼接到每个 chunk 首尾的，能真正随 assets 打进 APK，反编译即可见。
 */
const MARK = '本app为果崇舜，刘佳乐，赵梓缘三人共同开发，未经允许，不得擅自使用。';
const BANNER = '/*! Unimate | (c) 果崇舜 刘佳乐 赵梓缘 | ' + MARK + ' */';
const FOOTER = '/*! Unimate end-of-file notice | ' + MARK + ' */';

export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'es2020',
    rollupOptions: { output: { banner: BANNER, footer: FOOTER } }
  },
  server: { host: '0.0.0.0', port: 5173 }
});