/*
 * 轻量 Markdown → 结构化 token 解析（v2.70）。
 *
 * 【为什么要它】
 *  在线模型（Workers AI）很喜欢输出 Markdown：`## 标题`、`**加粗**`、`- 列表`。
 *  真机截图里这些符号是**原样显示**的 —— 用户看到的是 `## 🎯 重点突破` 和 `**分析考纲**`，
 *  而不是渲染后的层级。对话界面的人性化，第一件事就是把这个补上。
 *
 * 【为什么不用 marked / markdown-it + v-html】
 *  ① v-html 在 WebView 里等于把模型输出当 HTML 执行，必须配 DOMPurify 之类的清洗器，
 *     而这是离线校园 App，不该为了排版多背一个安全敏感的依赖；
 *  ② 我们的对话只需要**块级结构 + 行内强调**，不需要表格/脚注/HTML 混排；
 *  ③ 纯函数可以被单测钉死（见 tests/markdown.test.ts），v-html 只能靠人眼。
 *  所以这里输出的是**结构化 token**，由 Vue 模板渲染成真实元素，
 *  全程不产生任何 HTML 字符串 —— 模型输出永远进不了 innerHTML。
 *
 * 【支持范围（刻意收窄，所见即所支持）】
 *  块级：`#`~`######` 标题、`---` 分隔线、`- * +` 无序列表、`1.` 有序列表、``` 代码块、普通段落
 *  行内：`**粗` `*斜` `~~删除` `` `代码` `、`[文字](链接)`
 *  不支持（保持纯文本，不假装支持）：表格、脚注、数学公式、嵌套列表、HTML 标签
 */

export type MdAlign = 'left' | 'center';

export interface MdSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  /** 链接地址；**只允许 http/https**，其余（含 javascript:）会被丢弃、退化成纯文本 */
  href?: string;
}

export interface MdBlock {
  type: 'heading' | 'paragraph' | 'list' | 'quote' | 'code';
  /** heading：1~6；list：有序列表的起始序号，无序列表为 null */
  level?: number | null;
  /** heading：居中显示（模型常把 `## 🎯 重点突破` 当小标题，左对齐更整齐，居中由调用方决定） */
  align?: MdAlign;
  spans?: MdSpan[];
  /** list 的每一项；quote/code 不用 */
  items?: MdSpan[][];
}

/** 链接协议白名单。模型输出里的 javascript: / data: 一律不认，避免变成可点击的危险链接。 */
const SAFE_PROTOCOL = /^https?:\/\//i;

/**
 * 【易错点，改这个函数前先读】
 * 行内代码必须**先被替换成占位符再走扫描**，而占位符又必须能在还原时被认出来。
 *
 * 第一版我用的是 `\u0000<数字>\u0000`，结果 `String.replace` 的返回值里放 NUL 是安全的，
 * 但**测试断言用 JSON 打印时看不清**、而且数字紧跟内容时（`\u00000\u0000细节`）容易被误切。
 * 现在改用不可能出现在模型输出里的私有区字符 + 明确分隔符。
 */
const PLACEHOLDER_OPEN = '\uE000';
const PLACEHOLDER_CLOSE = '\uE001';

/**
 * 把一段文本切成"行内 token"。
 *
 * 顺序很重要：**先把行内代码抽走**，否则 `` `a**b**` `` 里的 `**` 会被当成加粗
 * （这条有单测盯着，是修过一次的真实 bug）。
 */
export function parseInline(raw: string): MdSpan[] {
  const codes: string[] = [];
  // 行内代码 → 占位符，避免其内部内容参与后续的星号/链接解析
  const text = String(raw ?? '').replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(code);
    return PLACEHOLDER_OPEN + (codes.length - 1) + PLACEHOLDER_CLOSE;
  });

  /*
   * 一次扫描走完：链接 > 加粗 > 斜体 > 删除线。
   * 逐条说明为什么这么写：
   *  - 链接的 href 用 `[^()\s]*`：**必须把 `(` 也排除掉**。
   *    第一版写 `[^)\s]*`，遇到 `[点我](javascript:alert(1))` 时，
   *    正则的 href 部分会在内层 `)` 处停下，留下一个孤零零的 `)` 当正文 ——
   *    测试当场抓到 `[{"text":"点我"},{"text":")"}]`。排除 `(` 后整段才被完整吃掉。
   *  - 加粗/斜体都不跨行（`[^*\n]`），避免把两个独立段落的星号配成一对。
   *  - 斜体用前后断言挡住 `**` 与英文单词里的下划线（`snake_case` 不该变斜体）。
   */
  const re = /\[([^\]\n]+)\]\(([^()\s]*)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|(?<![*\w])\*([^*\n]+)\*(?![*])|(?<![_\w])_([^_\n]+)_(?![_])|~~([^~\n]+)~~/g;
  const spans: MdSpan[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index) });
    const [, linkText, linkHref, boldStar, boldUnderscore, italicStar, italicUnderscore, strike] = m;
    if (linkText !== undefined) {
      const clean = String(linkHref || '').trim();
      // 不安全/空的协议 → 丢弃链接、只留文字（绝不静默生成一个能点的危险 href）
      if (SAFE_PROTOCOL.test(clean)) spans.push({ text: linkText, href: clean });
      else spans.push({ text: linkText });
    } else if (boldStar !== undefined) spans.push({ text: boldStar, bold: true });
    else if (boldUnderscore !== undefined) spans.push({ text: boldUnderscore, bold: true });
    else if (italicStar !== undefined) spans.push({ text: italicStar, italic: true });
    else if (italicUnderscore !== undefined) spans.push({ text: italicUnderscore, italic: true });
    else if (strike !== undefined) spans.push({ text: strike, strike: true });
    last = re.lastIndex;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });

  /*
   * 还原占位符。
   * 注意：占位符可能与普通文字同处一个 span（`先` + `占位符` 合并成 `先<ph>细节`），
   * 所以要把每个 span 的文本按占位符边界**重新切开**，让代码片段拿到自己的 code 标记 ——
   * 第一版只是把整段 span 标成 code，于是"先理解概念，再记忆 细节"整句都被渲染成代码样式。
   */
  const out: MdSpan[] = [];
  const splitRe = new RegExp(PLACEHOLDER_OPEN + '(\\d+)' + PLACEHOLDER_CLOSE, 'g');
  for (const s of spans) {
    if (!s.text.includes(PLACEHOLDER_OPEN)) { out.push(s); continue; }
    let cursor = 0;
    let mm: RegExpExecArray | null;
    splitRe.lastIndex = 0;
    while ((mm = splitRe.exec(s.text))) {
      if (mm.index > cursor) out.push({ ...s, text: s.text.slice(cursor, mm.index) });
      out.push({ text: codes[Number(mm[1])] ?? '', code: true });
      cursor = mm.index + mm[0].length;
    }
    if (cursor < s.text.length) out.push({ ...s, text: s.text.slice(cursor) });
  }
  return out.filter((s) => s.text !== '');
}

/**
 * Markdown → 块级 token。
 *
 * 解析原则：**看不懂的语法当普通文本**，绝不半渲染（宁可显示 `| a | b |` 的表格原文，
 * 也不要渲染出一个残缺的表）。这样"界面看起来对"就等价于"内容真的对"。
 */
export function parseMarkdown(raw: string): MdBlock[] {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行：跳过
    if (!line.trim()) { i += 1; continue; }

    // 围栏代码块：``` 或 ```ts
    const fence = line.match(/^\s*```/);
    if (fence) {
      i += 1;
      const body: string[] = [];
      while (i < lines.length && !/^\s*```/.test(lines[i])) { body.push(lines[i]); i += 1; }
      i += 1; // 吃掉收尾的 ```
      blocks.push({ type: 'code', spans: [{ text: body.join('\n') }] });
      continue;
    }

    // 分隔线：--- *** ___
    // 注意：必须放在列表之前判断 —— 否则 `---` 会先被 `^(\s*)([-*+])\s+` 之外的
    // 无序列表分支盯上（`-` 后面没空格时不算列表项），这里显式提前拦掉。
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      // 分隔线用一条细线表示，不再当正文（否则会渲染出 `——` 这种奇怪的东西）
      blocks.push({ type: 'quote', spans: [{ text: '\u2014\u2014' }] });
      i += 1;
      continue;
    }

    // 标题：# ~ ######（要求 # 后有空格，`#话题` 这种不当标题）
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, spans: parseInline(heading[2].trim()) });
      i += 1;
      continue;
    }

    // 引用：> 开头，连续行合并
    if (/^\s*>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', spans: parseInline(body.join('\n').trim()) });
      continue;
    }

    // 无序列表：-, *, + 后跟空格
    const bullet = line.match(/^(\s*)([-*+])\s+(.*)$/);
    // 有序列表：1. / 1) 后跟空格
    const numbered = line.match(/^(\s*)(\d{1,3})[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = !bullet;
      const start = ordered ? Number(numbered![2]) : null;
      const items: MdSpan[][] = [];
      // 【必须置 true 才继续，且每轮至少 i += 1】
      // 第一版写成 `while (i < lines.length)` 并在分支里 `continue` 前忘了 `i += 1`，
      // 匹配到空行时四个分支全不命中 → 死循环，node 跑到 4GB 内存被 OOM 杀掉。
      // 现在每轮都保证推进，且遇到空行立刻断块。
      while (i < lines.length && lines[i].trim()) {
        const b = lines[i].match(/^(\s*)([-*+])\s+(.*)$/);
        const n = lines[i].match(/^(\s*)(\d{1,3})[.)]\s+(.*)$/);
        if (ordered && n) items.push(parseInline(n[3].trim()));
        else if (!ordered && b) items.push(parseInline(b[3].trim()));
        else if (/^\s{2,}\S/.test(lines[i]) && items.length) {
          // 续行：缩进 2 空格以上，接到上一项尾巴上（嵌套列表不支持，按续行处理）
          const tail = items[items.length - 1];
          const extra = parseInline(lines[i].trim());
          items[items.length - 1] = tail.length && extra.length
            ? [...tail.slice(0, -1), { ...tail[tail.length - 1], text: tail[tail.length - 1].text + ' ' + extra[0].text }, ...extra.slice(1)]
            : [...tail, ...extra];
        } else break; // 换类型 / 非缩进的普通行 → 断块
        i += 1;
      }
      blocks.push({ type: 'list', level: start, items });
      continue;
    }

    // 普通段落：连续非空行合并成一段（Markdown 软换行按空格接续）
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(?:#{1,6}\s|>|```)/.test(lines[i])
      && !/^(\s*)([-*+])\s+/.test(lines[i]) && !/^(\s*)(\d{1,3})[.)]\s+/.test(lines[i])) {
      para.push(lines[i].trim());
      i += 1;
    }
    if (para.length) blocks.push({ type: 'paragraph', spans: parseInline(para.join(' ')) });
    // 兜底：理论上上面所有分支都会消费掉这一行；万一有谁也认不出的行，
    // 这里必须强行推进一格，否则就是死循环（上面那个 OOM 的又一道保险）。
    if (!para.length) { blocks.push({ type: 'paragraph', spans: parseInline(line.trim()) }); i += 1; }
  }

  return blocks;
}

/** 有无可渲染的结构（纯文本就没有，调用方可以走轻量分支）。 */
export function hasMarkdown(raw: string): boolean {
  return /(^|\n)\s*(?:#{1,6}\s|[-*+]\s|\d{1,3}[.)]\s|>|```|[-*_]{3,}\s*$)|(\*\*|__|~~|`|\[[^\]]+\]\([^)]+\))/.test(String(raw ?? ''));
}

/**
 * 历史记录/摘要用的纯文本化：把 Markdown 记法去掉，只留字。
 * 用于"一句话预览"这类场景 —— 在摘要里显示 `##` 和 `**` 是噪音。
 */
export function toPlainText(raw: string, limit = 0): string {
  let s = String(raw ?? '');
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/`([^`]*)`/g, '$1');
  s = s.replace(/^\s*#{1,6}\s+/gm, '');
  s = s.replace(/^\s*>\s?/gm, '');
  s = s.replace(/^\s*[-*+]\s+/gm, '');
  s = s.replace(/^\s*\d{1,3}[.)]\s+/gm, '');
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/__([^_]+)__/g, '$1');
  s = s.replace(/~~([^~]+)~~/g, '$1');
  s = s.replace(/(?<![*\w])\*([^*\n]+)\*(?![*])/g, '$1');
  s = s.replace(/\s+/g, ' ').trim();
  if (limit > 0 && s.length > limit) s = s.slice(0, limit).trimEnd() + '…';
  return s;
}
