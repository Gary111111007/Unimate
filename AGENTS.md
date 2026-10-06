# Unimate 工程约定（长期有效，优先级高于临时判断）

> 这份文件是产品负责人明确要求"记住"的规则。改代码前先读它；违反任意一条都算返工。
> 详细需求看 `PRD.md`（当前 v2.9），这里只放**不可违背的约束**与**踩过的坑**。

## 一、硬规则

1. **任何删除/破坏性操作一律二次确认**（产品负责人原话：「所有的 app 里的删除都需要二次确认」）。
   统一走 `db.confirm({...})` + `src/components/ConfirmDialog.vue`，禁止再手写 mask 确认层。
   确认框必须写清：删的是什么、影响多少条、能否恢复。新增删除路径时同步补 PRD 11.21-A 的表格与 AC-40。
   唯一例外：表单草稿里未保存照片的移除（属撤销，不属删数据）。
2. **真实姓名只能出现在版权水印里**（源码注释 + vite banner/footer：果崇舜、刘佳乐、赵梓缘）。
   UI、示例数据、导出材料一律用脱敏名：学生"智小汇"、学号 2025040999、教师"教师A~S"。
   参考文件 `../个人课表查询.html` 含真实姓名，**禁止入库、禁止进材料**。
3. **产品口径**：Unimate — 高校校园学习生活一站式智能助手；北化是"首个落地高校"并置顶且随 APK 内置；
   北二外以**签名云端档案**提供，下载前显示"可下载"、下载后才可使用；其余外校只出现在选择列表并标"开发中"，
   **不得写成已支持**；助手名 Uni；包名 `com.unimate.app`。
4. **【v2.43 口径变更，产品负责人 2026-09-23 明确撤销旧版】云端现在有两种模式，用户自己选，但"数据只在本机"不再是产品的总口径。**
   - **① 账号登录（服务器托管，默认主推）**：注册/登录后，课表、记事、二课材料与照片备份到云端；
     **服务端持有落盘密钥（Worker secret `DATA_KEY`）、可以读取这些内容**；换来的是"换台手机登录就有课表"和"忘记密码找开发者重置"。
     产品负责人原话："我还是要做成账号登录的形式……我撤销数据不存在本地以及其他的相关协议。"
     **因此：旧版"数据默认全本地 / 只上传密文 / 服务器看不到你的数据"这些表述一律作废，UI 与答辩材料不得再这么写。**
     仍必须守住的：密码原文不上传（本地派生 verifier）；注销要真删（记录 + 备份对象）；注销/删除走 `db.confirm` 二次确认。
   - **② 端到端加密同步（保留为可选高级项）**：随机同步码或"账号+口令派生同步码"两种入口，服务器只存 AES-256-GCM 密文，
     口令与恢复码不上传、不落盘；代价是忘记口令且恢复码丢失即无法找回。
   - 不接第三方地图 Key；水印可自主开关（材料可信度靠 sidecar sha256 存证，不靠定位服务）。
   - 断网不得影响其它功能：两种云端模式都只是"备份/取回"，本机数据始终是完整的一份。
   - **合规提醒（必须保留这条，写材料/答辩时会用到）**：云端在 **Cloudflare（境外节点）**。账号模式存的是可读数据，
     所以严格意义上属于**数据出境**；面向真实用户运营前要么把存储换成境内（阿里云/腾讯云），要么按《个人信息保护法》与出境规定处理。
     当前定位是**学生自制演示作品 + 产品负责人本人自用**，故按已撤销的口径继续推进，但这条限制不许悄悄删掉。
5. **回复用中文**；**"已验证"和"未验证"必须分开说**。没有真机跑过的事不许声称通过。
6. **UI 文案必须与实现一致**：写了自己做不到的功能（例如"深色下自动降饱和"其实没做）算事故，宁可改文案也不糊弄验收。
7. **任何 await 原生/插件调用都必须包 `guard()` 超时**，启动路径尤其如此：宁可降级到登录页，也不许把用户永久卡在开屏。
8. **顶层声明不许与 import 重名**（v2.40 的 `guard`、v2.45 的 `accountUpload` 都在这上面栽过）：SFC/压缩会把 import 改名，
   调用点会**静默**指向本地变量 → 真机报 `$ is not a function` 这类看不懂的错。`test:order` 会扫（含 `async function`），
   改完 `src` 记得跑它；`import.meta.env` 之类**只在构建环境存在**的东西，也别在模块顶层直接读（Node 单测会崩，v2.45 踩过）。
9. **组件里的类名不许和"工具类/别的语境"撞车**（v2.14 `.block`、v2.47 `.brand` 两次）：scoped 样式照样会命中全局语义的类名，
    典型症状是"某个徽标突然变得巨大"。选校页 `.brand{font-size:26px}` 撞 `class="pill brand"` 就是这么来的。
    `test:css` 现在会扫"同名 + 定位/字号明显不一致"，**新增界面必须跑它**。给组件自己的类起个专属名字，别复用全局工具类的名字。
10. **登录页 = 账号登录 / 注册账号 / 演示账号 +「账号与找回」按钮**（v2.47 起，v2.48~v2.49 定型）。
    依据（产品负责人口径）：**登录态是持久化的** —— `manifest.json` 存 session、`boot()` 会恢复，所以
    "第一次登录要联网，之后打开不用；只有**退出登录**（和换学校）才需要再联网"。因此**不再**给"本机登录"留入口（v2.47 那条兜底已删）。
    注意：`db.login()` 仍在用（云账号首次登录时用它建本机账号），只是没有手输本机用户名密码的界面了。
    「账号与找回」只在**未登录**时用得上，所以入口在登录页；它在未登录时也能做**离线换机**（选本机 `.unimate.zip` → 接管/新建本机账号 → 进主界面）。
    按钮文案（v2.49 定型）：只写「登录」/「注册」——"取回课表"是登录之后自动发生的事，**不要把结果写进按钮**。
11. **对用户说的话 ≠ 对开发说的话**（v2.49）：用户界面**不提"服务器在境外"**，只说"服务器可能有点慢"（产品负责人要求）；
    但 `PRD.md`/`AGENTS.md`/`docs/` 里**必须保留**"Cloudflare 在境外 ⇒ 账号模式构成数据出境"这条记录 —— 那是开发与合规要看的。
    改文案时别顺手把文档里这条也删了。
12. **Pages 交付只出目录、不压 ZIP**（v2.52）：`node scripts\make-pages-package.mjs <版本>` 只产出
    `artifacts/cloudflare/unimate-cloudflare-<版本>-upload/`；拖**这个目录本身**进 Pages → Production。
    （Pages 网页端不接受 ZIP，多压一份只会多一份可能过期的副本。历史 ZIP 留在 `artifacts/` 里当记录。）
13. **P4 / P5 是"工位目录"，不是主工程的一部分**（v2.52）：产物放 `p4-parser/`、`p5-assistant/`，
    **不许直接改 `src/`、`android/`、`cloudflare/`**；需要主工程配合就写进对应目录的 `NOTES.md`，由产品负责人统一整合。
    两条最硬的红线：**P4 的解析必须在本机**（不许把页面内容发到任何服务器）、
    **P5 的模型 Key 只许在服务端 secret、默认不把课表/姓名发给模型**（要发必须先让用户明确同意并在「关于」里如实写）。
14. **C 盘存储红线**：执行下载、安装、构建、解压、依赖缓存、测试实例或临时文件任务前，必须完整阅读并遵守
    [`C_DRIVE_STORAGE_POLICY.md`](C_DRIVE_STORAGE_POLICY.md)。所有可控的新写入默认放 F 盘；C 盘仅允许不可配置且已说明的最小系统写入。
    不得在 C 盘新建项目副本、下载目录、缓存目录或 n8n 隔离实例；无法改到 F 盘时先停止并请求产品负责人裁决。

## 二、构建与验证

- 唯一正确的出包方式：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-apk.ps1`（6 步，含包内容反查）。手跑 gradle 会打出旧 bundle。
- 测试（`npm run test:*` 共 **32** 个套件，逐套件条数以 `docs/context.md` 的常用命令一行为准）。脚本用 `Invoke-Npm` 检查退出码，**红一条就不许出包**；新增测试文件必须同时登记进 `package.json` 与 `scripts/build-apk.ps1`，否则等于没跑。
  **改 `build-apk.ps1` 只能用 node 按字节改**（保 UTF-8 BOM 与混合行尾）：v2.54 我用 node 插一行时把 BOM 叠成了 3 个，靠 `git diff` 才发现 —— 改完必须 `git diff -- scripts/build-apk.ps1` 看一眼，正例是**只多一行**。
- 改了代码必须做**反向取证**：新字符串要在 APK 里查得到、被删的旧字符串要查不到。只看"BUILD SUCCESSFUL"不算数。
- 怀疑包被别的工具改过时，比对 `SHA-256` 与 `PRD` 里记录的指纹 + 走一遍完整性校验。
- **沙箱内跑 `vite build` 会失败**（safe-delete 守卫拦 `emptyDir(dist)`，报 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`）。
  两个绕法：① 先 `rm -rf dist`（需 `dangerouslyDisableSandbox`）→ `mkdir -p dist` → 再 build（**空目录不触发守卫，最干净**）；
  ② 整个 `build-apk.ps1` 加 `dangerouslyDisableSandbox` 跑。脚本第 2 步就是 `npm run build`，所以在沙箱内直接跑脚本必挂。

## 三、踩过的坑（重复出现，别再犯）

- **【v2.76 新增 · 通用】布局问题"先量后改"，别靠读 CSS 猜。** 「历史入口定不住」被产品负责人追问了四轮
  （v2.72→v2.75 我每次都在调底色/边框/负边距），真因是个纯几何问题，一行 `getBoundingClientRect()` 就能定位。
  做法：`npm i -D playwright` + `npx playwright install chromium` → 起 dev server → 脚本里登录演示账号进页面 →
  量目标元素与参照元素的 `top/bottom` → **注入高内容后真的滚一次再量**。
  `position: sticky` 不生效按概率排序：① **祖先有 `overflow`（非 visible）即构成"约束容器"**，sticky 子元素只能在它高度内吸附；
  ② **真正在滚的可能不是你以为的那个容器**（读 `document.scrollingElement`，别猜）；③ `top` 参照物搞错。
  **这三条都不是改颜色/边框能解决的**。
- **`.screen` 是 `min-height: 100%` 而非 `height: 100%` → `.scroll{flex:1}` 拿不到确定高度**：
  `.uni-chat-page` 因此**永不滚动**（`clientHeight === scrollHeight`），被内容撑开后由 `<html>` 兜底滚动。
  `.head` 的 sticky 一直好使，正因为它与该页面**同级**、不在 `.uni-chat-page` 里。
  **推论：要 sticky 的元素必须和它的"吸附目标"处于同一层级、且中间不能隔 overflow 容器。**
- **sticky 的 `top` 别写死数字**：`.head` 高度 = `calc(12px + safe-t)` + 内容 + `10px`，`safe-t` 真机 0~60px 不等，
  课表页还多一条 `.sheetbar` → 挂载时量 `offsetHeight` 写进 CSS 变量（`--unih-head`），并监听 `resize`/`orientationchange`，
  卸载时 `removeEventListener`。
- **`test:css` 的"没有未定义的 CSS 变量"扫描器不认 `var()` 的兜底参数**：`var(--unih-head, 0px)` 仍被判"未定义"。
  运行时由 JS 注入的变量，必须在 CSS 里补一行 `--x: 默认值` 静态声明（inline style 优先级更高，不影响真机实测值）。
- **测试只断言"外观特征"会长期放过"功能没生效"**：v2.72~v2.75 的断言是"`position:sticky` 存在 + `top:0`"
  —— 在"根本没吸住"时**照样全绿**。凡"某交互/布局必须真的生效"，都要写**结构断言**
  （如"元素必须在滚动容器之外"：比较两处 `indexOf` 的先后），不能只查属性存在。
- **PowerShell 单引号 here-string 里 ``n` 是字面量不是换行** → 会把反引号写进 CSS/JS/模板。写 `.ps1` 时永远别用反引号转义。
- 写 JS/TS 源码内容时**不要在字符串里嵌裸反引号**，会把外层模板串提前闭合，报奇怪的解析错误；用占位符替换。
- `.Replace()` 的锚点用中文/缩进极易失配 → 优先按行号 splice，且**多处修改倒序执行**。
- Capacitor `schedule.at` **就传 Date**：插件 6.1.3 已 `setTimeZone(UTC)`，"本地拼串+假 Z"会让提醒整体晚 8 小时（v2.7 真犯过，用户表现为"到点不弹"）。
- 国产 ROM 要 **精确闹钟 + 电池优化豁免 + 厂商自启动** 三件套齐了后台才会响；`allowWhileIdle` 的通知在 Doze 下每 9 分钟只能发一条。
- 路径含中文：需要 `android.overridePathCheck=true`；`aapt` 前先把 APK 拷到 %TEMP% 的 ASCII 路径。
- `.ps1` 必须 UTF-8 **带** BOM；**PowerShell 7 的 `Set-Content -Encoding utf8` 写出来是无 BOM，会把构建脚本改坏（真踩过）—— 改 `.ps1` 一律用 node 按字节改**；`.ts/.vue` 必须 UTF-8 **不带** BOM。
- Android WebView 加载不了 `file://` 图片 → 一律转 data URL；`Plugin` 基类没有 `startActivity`，用 `getActivity().startActivity()`；`KeyStore` 是 `deleteEntry` 不是 `deleteKey`；`View.setWidth()` 是 protected。
- `export interface` 不能写在 `defineStore` 函数体里；替换代码块时别删掉仍被引用的变量声明。
- **【最严重的一例】按行号 splice 删代码时把 `splashDone.value = true;` 一起删了**，导致开屏永远关不掉，用户连续三轮"进不去"，而我前两轮都在给这个自伤做诊断。
  **规矩：任何按行号的删除/替换，改完必须 `git diff -- src` 逐行看"以 - 开头的行"，确认每行都还在该在的位置或已被有意替代；关键控制流必须有不变量测试兜着（见 `tests/boot.test.ts`）。
- **课表配色不许按行号取模**（`i % 12` 会让同一门课多时段变多色），也不许纯哈希（16 门课进 12 色必撞）—— 用 `assignCourseColors(课程名集合)`，手动色 `colorSet` 优先。
- **Vue 模板里不要嵌引号表达式**（`join(' / ')` 这种）；一律抽成辅助函数，否则不是报错就是渲染崩。
- **未定义的 CSS 变量 = 整条声明作废**，构建与单测都看不见（`--soft/--field/--tint` 曾被 31 处引用却从没定义，暗色下就是一堆透明）。新增样式必须跑 `test:css`。
- `watch(() => x.y, ...)@B@` 不能写在 `const x = ref(...)` 之前：watch 创建时会立刻跑一次 getter，直接 TDZ 崩掉整个组件 setup（第二课堂因此坏了 5 个版本）。静态检查见 `test:order`。
- **原生 WebView 的 `<input type=file>` 必须实现 `WebChromeClient.onShowFileChooser()`**，否则网页文件框点了就是没反应（北化在线交作业踩过）；取消时也必须回调 `null`，不然网页端永久卡住。
- 校验 CSS 是否入包时要考虑 scoped：编译后是 `.nextbar[data-v-xxxx]`，直接正则匹配 `.nextbar{` 会假阴性。
  **反向取证时的可靠做法**：`indexOf(类名)` 取片段打印肉眼确认，别只用正则。
- **写 `position: sticky` 前先确认"谁是滚动容器"**（v2.73 真踩，v2.71 埋的雷）：sticky 只在**它自己的滚动祖先**里钉得住。
  当时 `.uni-chat-page` 与 `.uni-chat-list` **两层都是滚动容器**，内层先滚、外层从不动 → sticky 静默失效，
  而且**构建与单测都查不出来**（断言只验了"CSS 里有 sticky"这几个字）。
  **规矩：`sticky` 的元素，其祖先链上只能有一个滚动容器，且它就是你要钉住的那个；断言要断"滚动容器是哪一层"（ref/`@scroll` 挂哪），不要只断属性存在。**
- **`display: grid` 的 `align-content` 默认 `stretch`**（v2.73）：只用 grid 做"排列"时，短内容会被行高拉开撑满容器，
  真机表现为"下面一大片空白"。**当排列容器用时记得 `align-content: start`。**
- **给 fixed 元素让位的底部 padding 只能加一次**（v2.73）：内外两层各加一次 = 272px 空白。
  加之前先 grep 祖先链上是否已有人让过位。
- **"弹窗被裁到点不到按钮" = 遮罩用 `overflow: auto` 且面板不限高**（v2.74 真踩，阻断性）。
  症状：面板比视口高时上下同时出屏幕，"添加/确定"永远点不到。**规矩：`fixed` 全屏遮罩只负责
  "居中 + 限高"（`display:flex; align-items:center; justify-content:center; overflow:hidden`），
  面板自己 `max-height: calc(100dvh - 28px - var(--safe-b))` + `display:flex; flex-direction:column`，
  内部拆**三段**：头 `flex:none` 固定、身 `flex:1; min-height:0; overflow-y:auto` **唯一滚动**、
  脚 `flex:none` 固定。`flex:1` 不配 `min-height:0` 则子项撑不缩、滚动条不出现。**
  高度优先 `dvh`（软键盘/地址栏变化时跟着缩），`vh` 只作老 WebView 回退（同属性写两行，后写的生效）。
- **"负边距抵 padding"要四个方向一起对**（v2.74）：只写 `-12px -12px` 时横向仍是原宽度，
  底色条不通栏，看起来跟上一栏之间还有断层。做"贴边/通栏"就写 `margin: -12px -16px …`
  **并同时把 `width: 100%` 改成 `auto`**（`100%` 是内容盒宽度，出血会被压回去）。
- **布局类断言必须断"组合条件 + 具体数值"**（v2.73/v2.74 两次教训）：只断"CSS 里有 sticky"
  查不出"没吸住"；只断"有负边距"查不出"缝没消"。要么断三条同时成立（遮罩不滚 + 限高 + 三段式齐全），
  要么精确到 `margin: -12px -16px 10px`。
- **`x!` 是给编译器看的，运行时照样是 `undefined`**（v2.75 真踩，一次扫出 4 处）：
  `'schools/' + profile.value!.schoolId` 在 profile 为 null 时**不抛错**，而是静默拼出
  `schools/undefined/users/...` —— **比崩溃更难查**。
  **规矩：`!` 只用在"刚刚已判过非空"的地方；跨模块的全局状态一律 `?.` + 显式兜底。**
- **放开一个旧前提时，要扫全链路，而不是只改 UI 那个 `if`**（v2.75）：「课表识别」面板 v2.71 就存在，
  但数据层从没为"没有学校档案"准备过（`base()` / `newTimetable()` / `loadUserData()` / 导入留证共 4 处非空断言）。
  以前没踩到，**只因为所有入口都强制先选一所有档案的学校**。
  **规矩：改"谁能用"这类前提时，用 `grep 'profile.value!'`、`grep 'schoolId!'` 把整条数据链扫一遍。**
- **"顺手做的事"不许成为主流程的前置条件**（v2.75）：导入成功后"顺手留一份原始 JSON"却硬依赖
  `db.profile!` + `db.session!`，留证失败**把整个导入带崩** —— 恰好炸在用户最需要它的那条路上。
  **规矩：主线 / 顺手分开；顺手那步必须能失败而不影响主线（包 `guard()` + 取不到就跳过）。**
- **下拉框"能选"不等于"选了有用"**（v2.75）：「教务类型」下拉存在了四个版本，但选了之后
  **没有任何一段代码因此不同**（一律按正方走）。这是硬规则 6（文案与实现一致）的**隐性**违规 ——
  比写错文案更隐蔽。**规矩：所有"可选"都要能回答"选完之后哪段代码会变"；答不上来就做成只读或把它做掉。**
- **换 ref 挂载点 / 换滚动容器后，必须重查所有靠 DOM 相对位置取值的地方**（v2.73）：
  `messageList.lastElementChild` 在容器从"列表"换成"整页"后，会从"最后一条消息"变成"底部输入表单"。
- **暗色下不要写死浅色（第二次）**（v2.73 的 `idwarn` `#FFF7E8`，v2.71 的 `.jwtag` `#F0F2F5`）：写死浅色必进全局暗色覆盖名单，
  否则暗色下就是要么刺眼要么看不见。**优先语义变量（`--soft`/`--soft-2`/`--tint`/`--brand`/`--muted`），确需才加 `:root[data-theme='dark']` 覆盖。**
- **写测试文件时不要用泛型尖括号 / 转义斜杠**（v2.71）：`node --experimental-strip-types` 的 lexer 见 `ref<{...}>` 里的 `<` 就当 JSX 解析 →
  `ERR_INVALID_TYPESCRIPT_SYNTAX`；正则字面量里 `\\/\\/` 也是非法字符。**规避法**：改用 `str.includes('…')` 字符串断言。
- **外校 ≠ 北化，两条链路必须分开（v2.71 提出，v2.72 落成分流，产品负责人两次明确要求）**：
  **北化**用 `ImportPanel.vue`（打开教务页面 → 用户自己点课表表格 → 抓 DOM → `jwglxtBuct`，选择器 `#kbgrid_table_0`）——
  这条路有 Golden Test 与内置脱敏样本兜底，**别改成走接口**；
  **正校外校**用 `ZfImportPanel.vue`（原生桥 `mode=zfimport` → 同源调 `kbList` JSON）；
  **"待识别"的外校**用 `JwIdentifyPanel.vue`（用户自己填域名/基础路径/协议 → 试导入）。
  选校页按 `chainOf(s)` 分流（`buct` → `'scrape'`，其余 → `'api'`）——**按 schoolId 判，不按厂商判**：
  厂商相同不代表页面结构相同，北化的表格选择器是实测的、外校没有这个把握。
  **注意 `ImportPanel.vue` 不接收 props、直接读 `db.profile`**：从选校页进入时必须**先 `selectSchool`**
  再开面板，否则会打开错学校的教务地址（它原本只从课表页进，那时必然已切到该校）。
- **教务地址解析一律走 `src/services/jwAddress.ts` 纯函数**，别在模板/组件里现写正则：它已覆盖端口、厂商目录截断、自建路径原样保留、协议白名单、
  以及一条不变量"**任何输入都不会产出非 http(s) 的 baseUrl**"。判厂商目录用 `isVendorDir()`，登录页推导用 `loginUrlFor()`
  （**注意它必须判末段是否已是厂商目录再拼**，否则会拼成 `/jwglxt/jwglxt/xtgl/...`——v2.71 真犯过，单测抓出）。
- **暗色下不要写死浅色**（v2.71 的 `.jwtag` `#F0F2F5`）：写死浅色必进全局暗色覆盖名单，否则暗色下就是 1.4:1 的字。
  优先用语义变量（`--soft-2` / `--tint` / `--brand` / `--muted`），只在确实需要时才加 `:root[data-theme='dark']` 覆盖。
- **`for t in …` 批量跑测试时 `$?` 不可信**（v2.71）：取到的是脚本自身退出码，会假失败。**判定测试结果一律单独跑看退出码，不要 grep 关键词。**
- **`build-apk.ps1` 报 `bundle 名称/内容一致: False` 通常不是代码问题**：`vite build` 被沙箱 safe-delete 拦（`dist/assets` 文件数暴涨超阈值）→
  `cap sync` 拿不到新 dist。**修法**：`rm -rf dist`（需放行沙箱）→ `vite build` → 单独 `npx cap sync android` → 再跑构建脚本。**别去改脚本的校验。**
- 给 `.ps1` 里的变量赋初值别依赖分支顺序（v2.71）：`$p2` 只在 foreach 内赋值、正常路径先 `continue`，导致 `-LiteralPath $null` 报
  `ParameterArgumentValidationErrorNullNotAllowed`，第一次出包直接崩。循环外先给默认值。

## 四、待办（产品负责人点头才做）

- 二课填报的条款文案若要改，改 `src/catalog/handbook.ts`（第五~四十九条全量），并同步跑 `test:handbook`。
- ~~换机同步（端到端加密）~~ **已可用**：`$ is not a function`（v2.40 真因 = `guard` 与 import 重名）、直传 R2 不通（v2.41 改 pages.dev 中转）
  都已修，**真机上传已通过**（v2.41 截图）；v2.42 起可"账号 + 口令"找回，v2.43 起默认走**账号登录（服务器托管）**。
  ~~把云账号登录搬到开机登录页~~ **v2.44 已做**：开机登录页新增「换新手机？用 Unimate 账号取回课表」
  （`src/services/cloudAdopt.ts` 负责编排；备份里的 `account/profile.json` 让换机后**本机密码也不变**）。
  真机复验仍待产品负责人执行。
- 天气板块（Open-Meteo，免 Key，默认关闭的可选开关）——会打破"App 不联网"表述，需确认。
- **第二课堂/暗色等页面级功能必须真机点一遍**：构建全绿 + 单测全绿也可能整页崩（v2.8 的 watch TDZ 就是例子）。
- ~~提醒兜底心跳~~ **已上（v2.30）**：产品负责人第四轮反馈仍是"到点不响、一打开才提醒"，按本条的触发条件做了
  "每 15 分钟一次的原生心跳 + 到期扫描"（`android/app/src/main/java/com/unimate/app/ReminderHeartbeat.java`，
  只补过期 30 分钟以内的、补投后撤掉插件那条闹钟）。边界：ROM 明确冻结/限制时闹钟同样放行不了，
  那种情况仍需三件套（App 的课表页提示条与「我的 → 通知设置」会指出缺哪一项）。
