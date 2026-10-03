// CSS 变量定义检查（本轮真机事故的教训之一）。
// 有 31 处在用 var(--soft) / var(--field) 等，但 styles.css 里从来没定义过它们：
// 浏览器对未定义变量的处理是"这条声明作废"，于是暗色下输入框没底色、面板是透明 ——
// 构建、类型检查、单测全都看不见。这里补一道静态检查。
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { themeRevealGeometry } from '../src/services/theme.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files: string[] = [];
(function walk(d: string): void {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const f = join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.(vue|css|html)$/.test(e.name)) files.push(f);
  }
})(root);
// 顺带看 index.html，内联样式也可能定义变量
const extra = join(root, '..', 'index.html');
try { if (readFileSync(extra, 'utf8')) files.push(extra); } catch { /* 忽略 */ }

const used = new Map<string, string[]>();
const defined = new Set<string>();

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const rel = relative(root, f);
  for (const m of src.matchAll(/var\(\s*(--[\w-]+)/g)) {
    const arr = used.get(m[1]) || [];
    if (!arr.includes(rel)) arr.push(rel);
    used.set(m[1], arr);
  }
  for (const m of src.matchAll(/(^|[\s{;])(--[\w-]+)\s*:/g)) defined.add(m[2]);
}

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

const missing: string[] = [];
for (const [name, where] of used) {
  if (!defined.has(name)) missing.push(name + '  ← ' + where.slice(0, 4).join(', ') + (where.length > 4 ? ' 等' : ''));
}
console.log('用了 ' + used.size + ' 个自定义属性，定义了 ' + defined.size + ' 个');
ok('确实扫到 var() 用法', used.size >= 10, used.size + ' 个');
ok('没有未定义的 CSS 变量', missing.length === 0, missing.join('\n        '));

/*
 * 组件 scoped 样式与全局工具类的**同名冲突**扫描。
 * 真实事故（v2.14）：课表组件用 `.block` 画课程色块（position:absolute），
 * 而全局的 `.btn.block` 是"整行按钮"宽度工具类。同一个元素 class="btn block"
 * 同时命中两者 —— 按钮被变成绝对定位的 10px 色块，截图里就是错位叠字。
 * 构建、类型检查、其余单测全都看不见，只有真机/渲染才暴露。
 *
 * 判定口径刻意收窄到"改了定位相关属性且与全局值不同"，避免把
 * `.field { margin-bottom }` 这类无害的重复声明也算成事故。
 */
const globalCls = new Map<string, { position: string; display: string }>();
/**
 * 【v2.47 新增】全局工具类的字号。真实事故：选校页头顶横幅写了 `.brand { font-size: 26px }`，
 * 而列表里的「可下载」按钮是 `class="pill brand"` —— 按钮吃到 26px，真机上比「开发中」大三四倍。
 * 与 v2.40 的 `guard` 重名、v2.14 的 `.block` 定位冲突是同一类：**同名就静默覆盖**。
 */
const globalFont = new Map<string, string>();
const ruleRe = /\.([A-Za-z][\w-]*)([^{}]*)\{([^{}]*)\}/g;
const stylesSrc = readFileSync(join(root, 'styles.css'), 'utf8');
// 只取"工具类区"，不含文件末尾的 [data-theme='dark'] 覆盖区：
// 那段是**故意**去改组件自己的类（.grid/.daycol/.tabbar 等），不是全局工具类，
// 混进来会把正常写法全判成冲突。
const utilitySrc = stylesSrc.split('暗色模式')[0];
for (const m of utilitySrc.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  // 一个选择器里可能有多个类（如 .btn.block），必须全都登记，
  // 否则正是这个漏登记让本检查器第一次上线时抓不到真凶。
  const names = Array.from(m[1].matchAll(/\.([A-Za-z][\w-]*)/g)).map((x) => x[1]);
  if (!names.length) continue;
  const pos = (m[2].match(/(?:^|;)\s*position\s*:\s*([\w-]+)/) || [])[1] || '';
  const disp = (m[2].match(/(?:^|;)\s*display\s*:\s*([\w-]+)/) || [])[1] || '';
  const font = (m[2].match(/(?:^|;)\s*font-size\s*:\s*([^;]+)/) || [])[1]?.trim() || '';
  for (const cls of names) {
    const prev = globalCls.get(cls) || { position: '', display: '' };
    globalCls.set(cls, { position: pos || prev.position, display: disp || prev.display });
    if (font && !globalFont.has(cls)) globalFont.set(cls, font);
  }
}

/** 返回该 .vue 里"同名冲突且改了定位"的类名 */
function collisionsOf(file: string, raw: string): string[] {
  // 注释里会写到"全局 .btn.block 怎样怎样"，不剥掉注释就会把解释文字当成选择器
  const style = ((raw.match(/<style[^>]*scoped[^>]*>([\s\S]*?)<\/style>/) || [, ''])[1] || '').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const tpl = (raw.match(/<template>([\s\S]*)<\/template>/) || [, ''])[1];
  if (!style) return [];
  const usedInTpl = new Set<string>();
  for (const m of tpl.matchAll(/\sclass="([^"]*)"/g)) {
    for (const t of m[1].split(/\s+/)) if (/^[A-Za-z][\w-]*$/.test(t)) usedInTpl.add(t);
  }
  const bad: string[] = [];
  for (const m of style.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const pos = (m[2].match(/(?:^|;)\s*position\s*:\s*([\w-]+)/) || [])[1] || '';
    const disp = (m[2].match(/(?:^|;)\s*display\s*:\s*([\w-]+)/) || [])[1] || '';
    // 只看定位冲突：display 的同名覆盖多半是有意为之（比如给 .sheet 补 display），
    // 而 position 被悄悄改成 absolute/fixed 正是"元素跑到别处去了"这类事故。
    if (!pos) continue;
    for (const cm of m[1].matchAll(/\.([A-Za-z][\w-]*)/g)) {
      const cls = cm[1];
      const g = globalCls.get(cls);
      if (!g || !usedInTpl.has(cls)) continue;
      if (pos !== g.position) bad.push(cls + ' 的 position:' + pos + '（全局为 ' + (g.position || '未设置') + '）');
    }
  }
  /*
   * 同名字号冲突（v2.47）：**同一个元素**上既有全局工具类（带字号，如 .pill = 11px）、
   * 又有本组件的类（带另一个字号，如 .brand = 26px）—— 后者会把前者的字号悄悄盖掉。
   * 「可下载」按钮就是这样从 11px 变成 26px 的（真机截图里大出三四倍）。
   */
  const scopedFont = new Map<string, string>();
  for (const m of style.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const f = (m[2].match(/(?:^|;)\s*font-size\s*:\s*([^;]+)/) || [])[1]?.trim();
    if (!f) continue;
    for (const cm of m[1].matchAll(/\.([A-Za-z][\w-]*)/g)) if (!scopedFont.has(cm[1])) scopedFont.set(cm[1], f);
  }
  for (const m of tpl.matchAll(/\sclass="([^"]*)"/g)) {
    const list = m[1].split(/\s+/).filter((t) => /^[A-Za-z][\w-]*$/.test(t));
    for (const g of list) {
      const gf = globalFont.get(g);
      if (!gf) continue;
      for (const s of list) {
        if (s === g) continue;
        const sf = scopedFont.get(s);
        /*
         * 只在**差得明显**时报警（默认 1.4 倍以上）。
         * 理由：`class="small emptysem"` 这种「用自己专属的类微调 0.5px」是正常写法（HoursPanel 就是这样），
         * 而 26px 盖掉 11px（2.4 倍）只会出现在"两个不同语境复用了同一个类名"的时候 —— 那才是事故。
         */
        const a = parseFloat(gf); const b = sf ? parseFloat(sf) : NaN;
        if (sf && Number.isFinite(a) && Number.isFinite(b) && Math.max(a / b, b / a) >= 1.4) {
          bad.push(s + ' 的字号 ' + sf + ' 会盖掉同一元素上的全局类 .' + g + '（' + gf + '）—— 换个专属类名，别让两个语境共用一个类');
        }
      }
    }
  }
  return bad;
}

// 先自证检查器真的能抓到（否则"全绿"没有意义）
const selfTest = collisionsOf('self.vue', '<template><i class="btn block"></i></template><style scoped>.block { position: absolute; }</style>');
ok('冲突检查器能抓到同名定位冲突（自证）', selfTest.length === 1, JSON.stringify(selfTest));
const selfTest2 = collisionsOf('self2.vue', '<template><i class="pill brand"></i></template><style scoped>.brand { font-size: 26px; }</style>');
ok('冲突检查器能抓到同名字号冲突（v2.47「可下载」那个 bug 的自证）', selfTest2.length === 1, JSON.stringify(selfTest2));

const clashes: string[] = [];
for (const f of files) {
  if (!f.endsWith('.vue')) continue;
  const bad = collisionsOf(f, readFileSync(f, 'utf8'));
  for (const b of bad) clashes.push(relative(root, f) + '  ' + b);
}
ok('组件 scoped 样式没有和全局工具类抢同名定位属性 / 字号', clashes.length === 0, clashes.join('\n        '));

/*
 * 课表网格的字号补偿（v2.15 真机截图驱动）。
 * 网格几何（52px 节次列 + 12 行 × 58px + 7 天分栏）是按像素定死的，
 * 而"字号"在真机上是原生 textZoom —— **只放大文字、不改几何**；
 * 于是字号一调大，课程名就被挤成一列一个字、时间竖排（"左边弄得太大、课表里的课太小"）。
 * 约定：网格内部的字号一律写成 calc(px / var(--tz, 1))，由 .grid 上绑定的 --tz 抵消。
 */
console.log('');
const timetableView = readFileSync(join(root, 'views', 'TimetableView.vue'), 'utf8');
const compensated = (timetableView.match(/calc\([^)]*\/\s*var\(--tz,\s*1\)\)/g) || []).length;
ok('网格文字用 calc(px / var(--tz, 1)) 抵消 textZoom', compensated >= 8, compensated + ' 处');
ok('.grid 上绑定了 --tz（Vue 内联自定义属性）', /'--tz':\s*gridTz/.test(timetableView), '');
ok('网格几何仍是像素常数（不随字号变化）', /const ROW_H = 58;/.test(timetableView) && /'52px repeat\('/.test(timetableView), '');
ok('补偿系数来自 display 服务，且做过范围夹取',
  timetableView.includes('textZoomFactor') && /k > 0\.5 && k <= 2/.test(timetableView), '');

// 暗色必须覆盖的关键变量都在两套主题里定义过（少一个就会有一块白）
for (const key of ['--bg', '--card', '--text', '--muted', '--line', '--soft', '--soft-2', '--field', '--tint', '--strong']) {
  ok('暗色块里定义了 ' + key, new RegExp('\\[data-theme=.dark.\\][\\s\\S]*?' + key.replace(/-/g, '\\-') + '\\s*:').test(files.map((f) => readFileSync(f, 'utf8')).join('\n')));
}

// 主题切换从触发点覆盖到最远角；不能只按短边算，否则横屏/角落会露出旧主题。
const revealCorner = themeRevealGeometry({ x: 0, y: 0 }, 360, 800);
ok('圆形主题切换覆盖最远视口角', Math.abs(revealCorner.radius - Math.hypot(360, 800)) < 0.001, String(revealCorner.radius));
const revealClamped = themeRevealGeometry({ x: -20, y: 900 }, 360, 800);
ok('主题动效触发点会夹取在视口内', revealClamped.x === 0 && revealClamped.y === 800, JSON.stringify(revealClamped));
const meView = readFileSync(join(root, 'views', 'MeView.vue'), 'utf8');
ok('三个主题按钮都暴露 aria-pressed', (meView.match(/:aria-pressed="db\.settings\.theme/g) || []).length === 3);
ok('主题按钮把真实触发位置交给圆形揭示', (meView.match(/setTheme\('[^']+', \$event\)/g) || []).length === 3);
ok('主题动效对 reduced-motion 有即时降级', /prefers-reduced-motion:\s*reduce/.test(readFileSync(join(root, 'services', 'theme.ts'), 'utf8')));

// Apple 风格回归：底栏保持等宽、安静，只用系统蓝和轻微反馈表达选中态。
const mainView = readFileSync(join(root, 'screens', 'Main.vue'), 'utf8');
const mainScopedStyle = (mainView.match(/<style scoped>([\s\S]*?)<\/style>/) || [, ''])[1];
const activeTabRule = (mainScopedStyle.match(/\.tab\.on\s*\{([^}]*)\}/) || [, ''])[1];
const baseTabRule = (mainScopedStyle.match(/\.tab\s*\{([^}]*)\}/) || [, ''])[1];
ok('底栏保持等宽且不再使用展开胶囊', !/flex-grow\s*:\s*1\.28/.test(mainScopedStyle) && !/background\s*:/.test(activeTabRule), activeTabRule.trim());
ok('底栏状态变化有过渡且尊重 reduced-motion', /transition\s*:/.test(baseTabRule) && /prefers-reduced-motion:\s*reduce/.test(mainScopedStyle), baseTabRule.trim());

// Inset Grouped 与线性图标是本轮视觉语言的可执行契约，防止又退回彩色 Emoji + 重阴影。
const globalStyles = readFileSync(join(root, 'styles.css'), 'utf8');
/*
 * v2.70：主色从系统蓝 #007AFF 降一档到 #2C6FE0（真机截图反馈"整块蓝太吵"）。
 * 这里不再写死原色值，而是断言"**仍然只有一个主色变量** +
 * 色相落在蓝色区间 + 饱和度/亮度都在克制的范围内" —— 这样既守住 Apple 观感，
 * 又不会因为一次调色就把断言写死成新的魔法值。
 */
const brandMatch = globalStyles.match(/--brand:\s*#([0-9A-Fa-f]{6})/);
const brandHex = brandMatch ? brandMatch[1] : '';
const rgb = [0, 2, 4].map((i) => parseInt(brandHex.slice(i, i + 2), 16));
const maxC = Math.max(...rgb);
const minC = Math.min(...rgb);
const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;
ok('浅色主色仍是蓝色相且降过饱和（不再是满饱和系统蓝）',
  rgb[2] > rgb[0] && rgb[2] > rgb[1] && sat <= 0.88 && maxC <= 0xF0,
  '--brand=#' + brandHex + ' sat=' + sat.toFixed(2));
ok('浅色主题使用 Apple 系统灰背景', /--bg:\s*#F2F2F7/i.test(globalStyles));
ok('深色主题使用纯黑背景与深灰卡片', /\[data-theme=.dark.\][\s\S]*--bg:\s*#000000/i.test(globalStyles) && /--card:\s*#1C1C1E/i.test(globalStyles));
ok('功能列表达到 52px 触控高度并使用内缩分隔线', /\.li\s*\{[^}]*min-height:\s*52px/.test(globalStyles) && /\.li:not\(:last-child\)::after\s*\{[^}]*left:\s*52px/.test(globalStyles));
ok('我的页入口使用统一 SVG 线性图标且不含彩色 Emoji', meView.includes('<AppleIcon') && !/[🔔🌗💧🌤💾🏫ℹ]/u.test(meView));
ok('主导航使用统一 SVG 线性图标', mainView.includes('<AppleIcon') && !/[🗓🏅📌📚👤]/u.test(mainView));

const timetableUi = readFileSync(join(root, 'views', 'TimetableView.vue'), 'utf8');
const onlineUi = readFileSync(join(root, 'views', 'OnlineView.vue'), 'utf8');
const secondClassUi = readFileSync(join(root, 'views', 'SecondClassView.vue'), 'utf8');
ok('提醒风险条使用线性图标而不是彩色闹钟', timetableUi.includes('name="alarm"') && !timetableUi.includes('<span class="rkico">⏰</span>'));
ok('周次切换卡片位于课表内容之后', timetableUi.indexOf('class="card weeknav"') > timetableUi.indexOf('</transition>'));
ok('下一节课卡片位于课表内容之后且在周次切换之前', timetableUi.indexOf('class="nextbar"') > timetableUi.indexOf('</transition>') && timetableUi.indexOf('class="nextbar"') < timetableUi.indexOf('class="card weeknav"'));
ok('校园服务宫格使用统一线性图标', onlineUi.includes(':name="campusIconName(a)"') && !onlineUi.includes('<span v-else class="ico">{{ a.icon }}</span>'));
ok('校园服务卡片与操作按钮使用紧凑尺寸', /\.app\s*\{[^}]*min-height:\s*108px/.test(onlineUi) && /:size="24"/.test(onlineUi) && /\.secrow \.btn\.sm\s*\{[^}]*min-height:\s*30px/.test(onlineUi));
ok('二课分类使用线性图标与 aria-pressed', secondClassUi.includes('<AppleIcon') && (secondClassUi.match(/:aria-pressed="sheet ===/g) || []).length === 3 && !secondClassUi.includes('>🏅 二课填报') && !secondClassUi.includes('>🤝 志愿时长') && !secondClassUi.includes('>🧹 劳育时长'));

/*
 * v2.71：暗色下选校页那几个标签「看不清」。
 *
 * 真机反馈原话是"深色模式下'教务系统待识别'这几个字有问题"。根因：
 * `.jwtag` 的底色写死 #F0F2F5、字用 var(--muted)，在暗色下 = 浅灰底 + 60% 白字，
 * 对比度约 1.4:1，几乎看不见；而 styles.css 里那段 `:root[data-theme='dark'] .pill/.chip/.grey`
 * **兜不住 `.jwtag`**（它不在名单里）。
 *
 * 这里守两件事：
 *  ① `.jwtag` 系列不再有写死的浅色底（必须走 --soft-2 / --tint / 透明叠加）；
 *  ② hint 与 warn 这类"正向/警示"标签必须有**自己的暗色覆盖**，不能只靠变量自动翻。
 */
const schoolPickerUi = readFileSync(join(root, 'screens', 'SchoolPicker.vue'), 'utf8');
const jwtagBase = /\.jwtag \{[^}]*\}/.exec(schoolPickerUi)?.[0] || '';
ok('教务系统标签底色不再写死浅色（走语义变量）',
  jwtagBase.includes('var(--soft-2)') && !/#F0F2F5/i.test(jwtagBase), jwtagBase.slice(0, 90));
const jwtagHint = /\.jwtag\.hint \{[^}]*\}/.exec(schoolPickerUi)?.[0] || '';
ok('「可登录导入课表」标签不再写死浅绿底', !/#E6F6EC/i.test(jwtagHint), jwtagHint.slice(0, 90));
ok('正向/警示标签有独立的暗色覆盖（不指望变量自己翻）',
  /:root\[data-theme='dark'\] \.jwtag\.hint/.test(schoolPickerUi) && /:root\[data-theme='dark'\] \.statepill\.warn/.test(schoolPickerUi));
ok('「开发中」标签在暗色下也走 --soft-2（与待识别同类处理）',
  /:root\[data-theme='dark'\] \.statepill\.dev \{ background: var\(--soft-2\)/.test(schoolPickerUi));

console.log('');
console.log('CSS Test: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
