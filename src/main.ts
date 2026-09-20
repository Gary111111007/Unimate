/* ===========================================================================
 *  Unimate — 高校校园学习生活一站式智能助手
 *  版权水印（开头处）
 *  本app为果崇舜，刘佳乐，赵梓缘三人共同开发，未经允许，不得擅自使用。
 *  说明：本文件中的水印注释用于源码留痕；APK 内的水印由 vite.config.ts 的
 *  rollup output.banner / footer 注入，压缩后依然存在于打包产物中。
 * =========================================================================== */
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './styles.css';
import { registerPlugins } from './plugins.ts';
import { applyTheme, watchSystemTheme } from './services/theme.ts';
import { applyTextZoom } from './services/display.ts';
import { useDb } from './stores/db.ts';

const pinia = createPinia();
const app = createApp(App);
app.use(pinia);

// 任何未捕获异常都要让用户看见，而不是"点了没反应"
app.config.errorHandler = (err) => {
  try {
    const db = useDb();
    const msg = err instanceof Error ? (err.stack || err.message) : String(err);
    db.lastError = '界面错误：' + msg;
    db.notify('出现错误，点此查看详细信息');
  } catch { /* 兜底失败时不再抛出 */ }
  console.error(err);
};

/* ---------------------------------------------------------------------------
 *  版权水印（中间处）
 *  本app为果崇舜，刘佳乐，赵梓缘三人共同开发，未经允许，不得擅自使用。
 * ------------------------------------------------------------------------- */
try {
  window.addEventListener('unhandledrejection', (ev) => {
    const db = useDb();
    const reason = (ev && (ev as any).reason) || 'unknown';
    db.lastError = '未处理的异步错误：' + (reason instanceof Error ? (reason.stack || reason.message) : String(reason));
    db.notify('出现错误，点此查看详细信息');
  });
} catch { /* 预览环境忽略 */ }

applyTheme(useDb().settings.theme || 'system');
void applyTextZoom(useDb().settings.fontSize || 100);
watchSystemTheme(() => useDb().settings.theme || 'system');
app.mount('#app');
registerPlugins();

/*
 * ===========================================================================
 *  版权水印（结尾处）
 *  本app为果崇舜，刘佳乐，赵梓缘三人共同开发，未经允许，不得擅自使用。
 *  Unimate — 高校校园学习生活一站式智能助手 · 首个落地高校：北京化工大学
 * ===========================================================================
 */