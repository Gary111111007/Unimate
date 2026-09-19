// 内嵌 WebView 桥（PRD 5.4.8）：原生侧用 Android WebView + evaluateJavascript 只读取
// 课表表格 HTML；桌面预览环境返回 unsupported，由调用方走"内置样本演示导入"降级。
import { registerPlugin } from '@capacitor/core';

export interface WebViewOpenResult {
  ok: boolean;
  html?: string;
  url?: string;
  reason?: string;
}

export interface CookieProbe { present: boolean; count: number }

export interface JwWebViewPlugin {
  open(options: { url: string; startUrl?: string; title: string; scrapeSelector?: string; allowExternal?: boolean }): Promise<WebViewOpenResult>;
  /** 只问"有没有、几条"，原生侧不返回 Cookie 内容 */
  cookieProbe(options: { url: string }): Promise<CookieProbe>;
  /** 用系统应用打开本机私有目录里的文件 */
  openFile(options: { path: string; name?: string; mime?: string }): Promise<{ ok: boolean; error: string; mime?: string }>;
  /** 电池优化豁免 + 精确闹钟状态，以及机型指引 */
  powerStatus(): Promise<PowerStatus>;
  /** 申请加入电池优化白名单（先试系统一键弹窗，退回设置列表页） */
  requestIgnoreBattery(): Promise<{ ok: boolean; mode: string; error: string }>;
  openExactAlarmSettings(): Promise<{ ok: boolean; error: string }>;
}

export interface PowerStatus {
  ok: boolean;
  ignoring: boolean;
  exactAlarm: boolean;
  rom: string;
  hint: string;
  error: string;
}

export const JwWebView = registerPlugin<JwWebViewPlugin>('JwWebView', {
  web: () => ({
    open: async (): Promise<WebViewOpenResult> => ({ ok: false, reason: 'web-unsupported' }),
    cookieProbe: async (): Promise<CookieProbe> => ({ present: false, count: 0 }),
    openFile: async (): Promise<{ ok: boolean; error: string }> => ({ ok: false, error: '桌面预览环境无法调用系统应用' }),
    powerStatus: async (): Promise<PowerStatus> => ({ ok: false, ignoring: false, exactAlarm: true, rom: '', hint: '桌面预览环境无法查询电池优化状态，请在手机上查看', error: 'web-unsupported' }),
    requestIgnoreBattery: async () => ({ ok: false, mode: '', error: '桌面预览环境无法调用系统设置' }),
    openExactAlarmSettings: async () => ({ ok: false, error: '桌面预览环境无法调用系统设置' })
  })
});

export const isNativeWebView = (): boolean => {
  try { return (window as any).Capacitor && (window as any).Capacitor.isNativePlatform(); } catch { return false; }
};
