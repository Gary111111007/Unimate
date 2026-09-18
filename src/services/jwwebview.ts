// 内嵌 WebView 桥（PRD 5.4.8）：原生侧用 Android WebView + evaluateJavascript 只读取
// 课表表格 HTML；桌面预览环境返回 unsupported，由调用方走"内置样本演示导入"降级。
import { registerPlugin } from '@capacitor/core';

export interface WebViewOpenResult {
  ok: boolean;
  html?: string;
  url?: string;
  reason?: string;
}

export interface JwWebViewPlugin {
  open(options: { url: string; startUrl?: string; title: string; scrapeSelector?: string; allowExternal?: boolean }): Promise<WebViewOpenResult>;
}

export const JwWebView = registerPlugin<JwWebViewPlugin>('JwWebView', {
  web: () => ({
    open: async (): Promise<WebViewOpenResult> => ({ ok: false, reason: 'web-unsupported' })
  })
});

export const isNativeWebView = (): boolean => {
  try { return (window as any).Capacitor && (window as any).Capacitor.isNativePlatform(); } catch { return false; }
};
