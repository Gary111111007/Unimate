import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  base: './',
  build: { outDir: 'dist', assetsDir: 'assets', target: 'es2020' },
  server: { host: '0.0.0.0', port: 5173 }
});
