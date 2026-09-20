/**
 * 手势去重。
 *
 * 起因（真机反馈）：记事本里"用按钮切月正常，用手指滑一下会跳两个月"。
 * 根因不是动画，而是**同一次滑动被两个处理器都收到了**：
 * 日历卡片 `.cal` 与它外层的页面容器 `.scroll` 各绑了一套 touchstart/touchend，
 * touch 事件会冒泡，于是 `shiftMonth()` 被调用两次 —— 一划两个月。
 *
 * 这里做一层"同一次手势只生效一次"的节流：gapMs 内的重复调用直接丢掉。
 * 第一个收到手势的处理器（内层）生效，冒泡上来的那次被忽略。
 *
 * 注意：只包**手势**路径，不要包按钮点击 —— 否则用户快速连点"下个月"会被吃掉。
 */
export function dedupeGesture<T extends (...args: any[]) => void>(
  fn: T,
  gapMs = 350,
  clock: () => number = Date.now
): T {
  let last = Number.NEGATIVE_INFINITY;
  return function (this: unknown, ...args: any[]): void {
    const t = clock();
    if (t - last < gapMs) return;   // 同一次滑动里的第二次调用：丢弃
    last = t;
    fn.apply(this, args);
  } as T;
}
