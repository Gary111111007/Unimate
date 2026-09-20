import { App as CapApp } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar } from '@capacitor/status-bar';
import { isNativeWebView } from './services/jwwebview.ts';
import { applyStatusBar, watchThemeForStatusBar } from './services/theme.ts';
import { useDb } from './stores/db.ts';

/**
 * 点通知进来要落到具体那条内容上（PRD 5.10 的"点击行为"列）。
 * 排期时把 { k:'c'|'n', id, w } 写进通知的 extra，这里读回来做路由；
 * 课程页 / 记事本页各自 watch db.focus 消费一次后清空。
 *
 * 冷启动也要能收到：Capacitor 的 BridgeActivity.onCreate 会把启动 Intent 再派发一次
 * （BridgeActivity.java 里 onCreate → onNewIntent(getIntent())），
 * 且插件用 notifyListeners(..., true) 保留了事件直到 JS 挂上监听。
 */
function routeNotification(ev: any): void {
  try {
    const db = useDb();
    const extra = ((ev && ev.notification && ev.notification.extra) || {}) as { k?: string; id?: string; w?: number };
    if (extra.k === 'c') {
      db.activeTab = 0;
      db.activeSheet = 'sheet1';
      db.focus = { kind: 'course', id: String(extra.id || ''), week: Number(extra.w) || 0 };
    } else if (extra.k === 'n') {
      db.activeTab = 0;
      db.activeSheet = 'sheet2';
      db.focus = { kind: 'note', id: String(extra.id || '') };
    } else {
      db.activeTab = 0;   // 测试 / 演示通知：只把用户带回首页
    }
  } catch { /* 路由失败不影响 App 正常打开 */ }
}

export function registerPlugins(): void {
  if (!isNativeWebView()) return;
  try {
    applyStatusBar();
    watchThemeForStatusBar(applyStatusBar);
    void SplashScreen.hide();
    void CapApp.addListener('backButton', ({ canGoBack }) => {
      if (!canGoBack && window.history.length <= 1) {
        if ((window as any).__unimateBack) (window as any).__unimateBack();
        else void CapApp.exitApp();
      } else if ((window as any).__unimateBack) {
        (window as any).__unimateBack();
      }
    });
  } catch { /* 原生插件不可用时忽略 */ }
  try {
    void LocalNotifications.addListener('localNotificationActionPerformed', routeNotification);
  } catch { /* 预览环境没有该插件 */ }
}
