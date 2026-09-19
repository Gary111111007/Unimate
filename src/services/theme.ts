// 主题应用（PRD 5.12）。light / dark / system 三档；system 时用 matchMedia 换算成二值，
// 并监听系统切换实时生效。同时同步 <meta name="theme-color">，让状态栏跟着变。
export type ThemeMode = 'light' | 'dark' | 'system';

export function isDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; }
}

export function applyTheme(mode: ThemeMode): void {
  const dark = isDark(mode);
  try {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    if (meta) meta.content = dark ? '#0E131C' : '#2E5AAC';
  } catch { /* 预览环境兜底 */ }
}

/** 监听系统深色切换；仅在当前是 system 档时生效。返回取消监听的函数。 */
export function watchSystemTheme(getMode: () => ThemeMode): () => void {
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const h = () => { if (getMode() === 'system') applyTheme('system'); };
    if (mq.addEventListener) { mq.addEventListener('change', h); return () => mq.removeEventListener('change', h); }
    // 老内核只支持 addListener
    (mq as any).addListener(h);
    return () => { try { (mq as any).removeListener(h); } catch { /* noop */ } };
  } catch { return () => { /* noop */ }; }
}