// 轻量 Markdown 解析器（v2.70）。
//
// 这个套件存在的意义：**模型输出是不可信输入**，而它要进模板渲染。
// 所以这里既验"正常语法渲染对不对"，也验"恶意/畸形输入不会变成可点击的危险链接、不会死循环"。
// 真机截图里那些 `## 🎯 重点突破` / `**分析考纲**` 原样显示，就是这套渲染要解决的问题。
import { parseInline, parseMarkdown, hasMarkdown, toPlainText } from '../src/services/markdown.ts';

let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fails.push(name + (extra ? '  → ' + extra : '')); console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('--- 行内：加粗 / 斜体 / 删除线 / 代码 ---');
{
  const s = parseInline('先**理解概念**，再记忆 `细节`');
  ok('加粗被识别', s.some((x) => x.bold && x.text === '理解概念'), JSON.stringify(s));
  ok('行内代码被识别', s.some((x) => x.code && x.text === '细节'), JSON.stringify(s));
  ok('普通文字原样保留', s.map((x) => x.text).join('') === '先理解概念，再记忆 细节', s.map((x) => x.text).join(''));

  ok('斜体被识别', parseInline('这是*重点*内容').some((x) => x.italic && x.text === '重点'));
  ok('删除线被识别', parseInline('这个~~不对~~').some((x) => x.strike && x.text === '不对'));
  ok('下划线式加粗也认', parseInline('__重要__').some((x) => x.bold && x.text === '重要'));

  // 行内代码里的星号不能被当成加粗（顺序 bug 的回归）
  const nested = parseInline('`a**b**c`');
  ok('行内代码里的 ** 不参与加粗', nested.length === 1 && nested[0].code === true && nested[0].text === 'a**b**c', JSON.stringify(nested));

  // 单独的星号/数学乘号不该被吃掉
  ok('孤立的星号保持原样', parseInline('2 * 3 = 6').map((x) => x.text).join('') === '2 * 3 = 6');
}

console.log('--- 行内：链接协议白名单（模型输出不可信）---');
{
  const good = parseInline('[课程表](https://jwglxt.buct.edu.cn/x)');
  ok('https 链接被保留', good.some((x) => x.href === 'https://jwglxt.buct.edu.cn/x' && x.text === '课程表'), JSON.stringify(good));

  /*
   * 危险协议的处理口径：**整段保持纯文本**，不解析成链接。
   * 为什么不做"留文字、去链接"：`[点我](javascript:alert(1))` 里的括号会让任何
   * 简单正则都切不干净（留一个孤零零的 `)` 当正文）。与其产出一个半截的怪东西，
   * 不如原样显示 —— 用户看到原始记法，但**绝对点不动**。这才是"看不懂就别动"。
   */
  const bad = parseInline('[点我](javascript:alert(1))');
  ok('javascript: 链接不解析（整段保持纯文本，不可点）',
    bad.length === 1 && bad[0].href === undefined && bad[0].text === '[点我](javascript:alert(1))', JSON.stringify(bad));

  const dataUri = parseInline('[图](data:text/html;base64,PHNjcmlwdD4=)');
  ok('data: 链接同样不解析', dataUri.every((x) => x.href === undefined), JSON.stringify(dataUri));

  // 关键不变量：任何输入下，解析结果里都不允许出现非 http(s) 的 href
  const evil = ['[a](javascript:alert(1))', '[b](JAVASCRIPT:alert(1))', '[c](file:///etc/passwd)', '[d](//evil.com/x)', '[e](vbscript:x)'];
  ok('任何输入都不会产出非 http(s) 的 href',
    evil.every((src) => parseInline(src).every((x) => !x.href || /^https?:\/\//i.test(x.href))), JSON.stringify(evil.map((e) => parseInline(e))));
}

console.log('--- 块级：标题 ---');
{
  const b = parseMarkdown('## 🎯 重点突破');
  ok('二级标题被识别且级别正确', b.length === 1 && b[0].type === 'heading' && b[0].level === 2, JSON.stringify(b));
  ok('标题里的 Emoji 作为文字保留', b[0].spans!.map((s) => s.text).join('') === '🎯 重点突破');
  ok('六级标题都能认', parseMarkdown('###### 小标题')[0].level === 6);
  // `#话题` 没有空格，不该变成标题
  ok('没有空格的 # 不当标题', parseMarkdown('#话题标签')[0].type === 'paragraph');
}

console.log('--- 块级：列表 ---');
{
  const ul = parseMarkdown('- **理解为主**：先理解再记\n- **做笔记**：用自己的话总结');
  ok('无序列表解析出两项', ul.length === 1 && ul[0].type === 'list' && ul[0].items!.length === 2, JSON.stringify(ul));
  ok('列表项内部的行内加粗仍然生效', ul[0].items![0].some((s) => s.bold && s.text === '理解为主'));

  const ol = parseMarkdown('3. 第三步\n4. 第四步');
  ok('有序列表起始序号被保留', ol[0].type === 'list' && ol[0].level === 3 && ol[0].items!.length === 2, JSON.stringify(ol[0]));

  // 断块：无序后面接有序，应该是两个 list，而不是一个混合列表
  const mixed = parseMarkdown('- 甲\n1. 乙');
  ok('无序与有序列表不混成一个块', mixed.length === 2 && mixed[0].type === 'list' && mixed[1].type === 'list', JSON.stringify(mixed));

  // 续行（缩进 2 空格）应接到上一项
  const cont = parseMarkdown('- 第一项\n  接着说');
  ok('缩进续行接到上一项而不是新起一项', cont[0].items!.length === 1 && cont[0].items![0].map((s) => s.text).join('').includes('接着说'), JSON.stringify(cont));
}

console.log('--- 块级：代码块 / 引用 / 段落 ---');
{
  const code = parseMarkdown('说明：\n```ts\nconst a = 1;\n```');
  ok('围栏代码块被识别且内容原样保留',
    code.length === 2 && code[1].type === 'code' && code[1].spans![0].text === 'const a = 1;', JSON.stringify(code));

  const quote = parseMarkdown('> 第一行\n> 第二行');
  ok('引用合并成一块', quote.length === 1 && quote[0].type === 'quote' && quote[0].spans!.map((s) => s.text).join('').includes('第二行'), JSON.stringify(quote));

  const para = parseMarkdown('第一行\n第二行\n\n新的一段');
  ok('连续两行合并成一个段落', para.length === 2 && para[0].type === 'paragraph' && para[0].spans!.map((s) => s.text).join('') === '第一行 第二行', JSON.stringify(para));
}

console.log('--- 健壮性：畸形输入不能崩、不能死循环 ---');
{
  // 未闭合的围栏代码块（流式输出时很常见）
  const t0 = Date.now();
  const unclosed = parseMarkdown('```ts\nconst a = 1;');
  ok('未闭合的代码围栏不会死循环', Date.now() - t0 < 1000 && unclosed.length === 1 && unclosed[0].type === 'code', JSON.stringify(unclosed));

  // 表格这类"不支持"的语法必须保持原文，不能半渲染
  const table = parseMarkdown('| 科目 | 时间 |\n| --- | --- |');
  ok('不支持的表格保持纯文本（不假装支持）', table.every((b) => b.type === 'paragraph'), JSON.stringify(table));

  ok('空串 → 空数组', parseMarkdown('').length === 0);
  ok('只有空白 → 空数组', parseMarkdown('   \n\n  ').length === 0);
  ok('null 不崩', parseMarkdown(null as unknown as string).length === 0);
}

console.log('--- hasMarkdown：纯文本走轻量分支 ---');
{
  ok('纯文本判定为无 Markdown', hasMarkdown('明天第一节课是高等数学') === false);
  ok('标题判定为有 Markdown', hasMarkdown('## 标题') === true);
  ok('加粗判定为有 Markdown', hasMarkdown('这是**重点**') === true);
  ok('列表判定为有 Markdown', hasMarkdown('- 第一项') === true);
}

console.log('--- toPlainText：摘要里不该出现 Markdown 标记 ---');
{
  const p = toPlainText('## 🎯 重点突破\n- **分析考纲**：明确范围');
  ok('去掉 ## 与 ** 记法', !p.includes('##') && !p.includes('**'), p);
  ok('保留正文文字', p.includes('重点突破') && p.includes('分析考纲'), p);
  ok('截断会加省略号', toPlainText('一二三四五六七八九十', 4).endsWith('…'));
  // 真实场景：历史面板的标题必须是一行、没有 # 和 *
  const title = toPlainText('### 我的**学习计划**');
  ok('历史标题干净可读', title === '我的学习计划', title);
}

console.log('\n结果：' + pass + ' 通过 / ' + fails.length + ' 失败');
if (fails.length) process.exit(1);
