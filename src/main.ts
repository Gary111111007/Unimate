import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './styles.css';
import { registerPlugins } from './plugins.ts';
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
try {
  window.addEventListener('unhandledrejection', (ev) => {
    const db = useDb();
    const reason = (ev && (ev as any).reason) || 'unknown';
    db.lastError = '未处理的异步错误：' + (reason instanceof Error ? (reason.stack || reason.message) : String(reason));
    db.notify('出现错误，点此查看详细信息');
  });
} catch { /* 预览环境忽略 */ }

app.mount('#app');
registerPlugins();
