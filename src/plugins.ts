import { App as CapApp } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar } from '@capacitor/status-bar';
import { isNativeWebView } from './services/jwwebview.ts';
import { applyStatusBar, watchThemeForStatusBar } from './services/theme.ts';

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
}
