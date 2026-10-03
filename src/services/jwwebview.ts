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
  open(options: {
    url: string; startUrl?: string; title: string; scrapeSelector?: string; allowExternal?: boolean; actionLabel?: string;
    /**
     * 'timetable'（默认）：抓课表，圆钮只在教务域名下出现；
     * 'exam'：抓考试，按钮**常驻**并显示「识别考试」。
     * 'campus'：校园数据只读采集，按钮常驻，只读取调用方给出的结果容器。
     */
    mode?: 'timetable' | 'exam' | 'campus';
  }): Promise<WebViewOpenResult>;
  /** 只问"有没有、几条"，原生侧不返回 Cookie 内容 */
  cookieProbe(options: { url: string }): Promise<CookieProbe>;
  /** 用系统应用打开本机私有目录里的文件 */
  openFile(options: { path: string; name?: string; mime?: string }): Promise<{ ok: boolean; error: string; mime?: string }>;
  /** 调用系统语音识别；App 只接收文字，不保存录音 */
  speechToText(options: { locale?: string }): Promise<{ ok: boolean; text: string; error: string }>;
  /** 聚焦 Web 输入框后唤起系统输入法，供没有 RecognitionService 的设备使用键盘语音输入 */
  showKeyboard(): Promise<{ ok: boolean; error: string }>;
  /** 电池优化豁免 + 精确闹钟状态，以及机型指引 */
  powerStatus(): Promise<PowerStatus>;
  /** 申请加入电池优化白名单（先试系统一键弹窗，退回设置列表页） */
  requestIgnoreBattery(): Promise<{ ok: boolean; mode: string; error: string }>;
  openExactAlarmSettings(): Promise<{ ok: boolean; error: string }>;
  /** 提醒兜底心跳的运行状态（v2.31）：证明"它到底有没有在跑"就靠这几个数 */
  heartbeatStatus(): Promise<HeartbeatStatus>;
  /** v2.53：通知渠道的真实 importance / 声音 / 是否屏蔽 + Doze 状态（自检报告用） */
  notifyChannelStatus(payload: { ids: string[] }): Promise<{
    ok: boolean; enabled?: boolean; dozing?: boolean;
    channels?: Record<string, { exists?: boolean; importance?: number; sound?: boolean; vibration?: boolean; blocked?: boolean }>;
    error?: string;
  }>;
  /** v2.55：闹钟条目自检 —— "排期列表里有"不等于"AlarmManager 里还挂着闹钟" */
  alarmDiagnostics(payload: { ids: number[] }): Promise<{
    ok: boolean; exactAllowed?: boolean; useExactAlarm?: boolean; nextAlarmAt?: number;
    entries?: Record<string, boolean>; aliveCount?: number; checkedCount?: number; error?: string;
  }>;
  /* v2.56：选择性写系统日历（默认关，用户点开关才用） */
  calendarRequest(): Promise<{ granted: boolean }>;
  calendarStatus(): Promise<{ ok: boolean; permission?: string; available?: boolean; written?: number; calendar?: string; error?: string }>;
  calendarSync(payload: { events: { id: number; title: string; at: number; durationMin?: number }[] }): Promise<{ ok: boolean; written?: number; calendar?: string; error?: string }>;
  calendarClear(): Promise<{ ok: boolean; removed?: number; error?: string }>;
  /**
   * 读**真正排着**的通知（v2.32）。必须自己实现：Capacitor 的 `LocalNotifications.scheduled()`
   * 在 Android 上没实现（调用会抛 "not implemented on android"），只有原生直读插件存储才准。
   */
  pendingNotifications(): Promise<PendingNotifications>;
  /** 接管插件闹钟：后台原生投递，并丢弃严重迟到的历史提醒 */
  hardenNotifications(): Promise<{ ok: boolean; count: number; error?: string }>;
  /** 提醒守护前台服务开关（v2.34）：开=带一条常驻静音通知保活，系统就不会冻住 App */
  setReminderGuard(options: { enabled: boolean }): Promise<{ ok: boolean; enabled: boolean; running: boolean; error?: string }>;
  reminderGuardStatus(): Promise<{ ok: boolean; enabled: boolean; running: boolean; error?: string }>;
  /** 界面字号：原生用 WebView textZoom，只放大文字不动布局坐标系 */
  setTextZoom(options: { percent: number }): Promise<{ ok: boolean; applied: number; error: string }>;
}

export interface PowerStatus {
  ok: boolean;
  ignoring: boolean;
  exactAlarm: boolean;
  rom: string;
  hint: string;
  error: string;
}

export interface HeartbeatStatus {
  ok: boolean;
  /** 是否已经排过至少一跳 */
  armed: boolean;
  armedAt: number;
  nextAt: number;
  /** 上一次"扫描"的时间（每次心跳都会刷新；用来判断心跳是不是真在跑） */
  lastScanAt: number;
  lastRunAt: number;
  /** 上一次真正补投的时间与条数 */
  lastPostedAt: number;
  lastPostedCount: number;
  totalPosted: number;
  /** 开机清场丢掉了多少条（被插件恢复广播改写成"15 秒后"的那批） */
  lastDroppedAt: number;
  lastDroppedCount: number;
  totalDropped: number;
  /** 下一跳是否还在未来（排上了但被系统撤掉的话这里会是 false） */
  pendingNext: boolean;
  error?: string;
}

export interface PendingNotification {
  id: number;
  at?: number;
  title: string;
  body: string;
  channelId: string;
}

export interface PendingNotifications {
  ok: boolean;
  items: PendingNotification[];
  error?: string;
}

export const JwWebView = registerPlugin<JwWebViewPlugin>('JwWebView', {
  web: () => ({
    open: async (): Promise<WebViewOpenResult> => ({ ok: false, reason: 'web-unsupported' }),
    cookieProbe: async (): Promise<CookieProbe> => ({ present: false, count: 0 }),
    openFile: async (): Promise<{ ok: boolean; error: string }> => ({ ok: false, error: '桌面预览环境无法调用系统应用' }),
    speechToText: async () => ({ ok: false, text: '', error: '桌面预览环境没有系统语音识别桥' }),
    showKeyboard: async () => ({ ok: false, error: '桌面预览环境无法调用系统输入法' }),
    powerStatus: async (): Promise<PowerStatus> => ({ ok: false, ignoring: false, exactAlarm: true, rom: '', hint: '桌面预览环境无法查询电池优化状态，请在手机上查看', error: 'web-unsupported' }),
    requestIgnoreBattery: async () => ({ ok: false, mode: '', error: '桌面预览环境无法调用系统设置' }),
    openExactAlarmSettings: async () => ({ ok: false, error: '桌面预览环境无法调用系统设置' }),
    heartbeatStatus: async (): Promise<HeartbeatStatus> => ({ ok: false, armed: false, armedAt: 0, nextAt: 0, lastScanAt: 0, lastRunAt: 0, lastPostedAt: 0, lastPostedCount: 0, totalPosted: 0, lastDroppedAt: 0, lastDroppedCount: 0, totalDropped: 0, pendingNext: false, error: 'web-unsupported' }),
    notifyChannelStatus: async () => ({ ok: false, enabled: false, dozing: false, channels: {}, error: 'web-unsupported' }),
    alarmDiagnostics: async () => ({ ok: false, exactAllowed: true, useExactAlarm: false, nextAlarmAt: 0, entries: {}, aliveCount: 0, checkedCount: 0, error: 'web-unsupported' }),
    calendarRequest: async () => ({ granted: false }),
    calendarStatus: async () => ({ ok: false, permission: 'denied', available: false, written: 0, calendar: '', error: 'web-unsupported' }),
    calendarSync: async () => ({ ok: false, written: 0, error: 'web-unsupported' }),
    calendarClear: async () => ({ ok: false, removed: 0, error: 'web-unsupported' }),
    pendingNotifications: async (): Promise<PendingNotifications> => ({ ok: false, items: [], error: 'web-unsupported' }),
    hardenNotifications: async () => ({ ok: false, count: 0, error: 'web-unsupported' }),
    setReminderGuard: async (o: { enabled: boolean }) => ({ ok: false, enabled: !!o.enabled, running: false, error: 'web-unsupported' }),
    reminderGuardStatus: async () => ({ ok: false, enabled: false, running: false, error: 'web-unsupported' }),
    setTextZoom: async (o: { percent: number }) => ({ ok: false, applied: o && o.percent ? o.percent : 100, error: 'web-unsupported' })
  })
});

export const isNativeWebView = (): boolean => {
  try { return (window as any).Capacitor && (window as any).Capacitor.isNativePlatform(); } catch { return false; }
};
