# Unimate 工程约定（长期有效，优先级高于临时判断）

> 这份文件是产品负责人明确要求"记住"的规则。改代码前先读它；违反任意一条都算返工。
> 详细需求看 `PRD.md`（当前 v2.9），这里只放**不可违背的约束**与**踩过的坑**。

## 一、硬规则

1. **任何删除/破坏性操作一律二次确认**（产品负责人原话：「所有的 app 里的删除都需要二次确认」）。
   统一走 `db.confirm({...})` + `src/components/ConfirmDialog.vue`，禁止再手写 mask 确认层。
   确认框必须写清：删的是什么、影响多少条、能否恢复。新增删除路径时同步补 PRD 11.21-A 的表格与 AC-40。
   唯一例外：表单草稿里未保存照片的移除（属撤销，不属删数据）。
2. **不做密码保管**。v2.5 做过 Keystore 自动填充，v2.6 被产品负责人要求整体删除，`cookieProbe` 只允许返回"有没有/几条"，不得读取 Cookie 值或表单内容。
3. **真实姓名只能出现在版权水印里**（源码注释 + vite banner/footer：果崇舜、刘佳乐、赵梓缘）。
   UI、示例数据、导出材料一律用脱敏名：学生"智小汇"、学号 2025040999、教师"教师A~S"。
   参考文件 `../个人课表查询.html` 含真实姓名，**禁止入库、禁止进材料**。
4. **产品口径**：Unimate — 高校校园学习生活一站式智能助手；北化是"首个落地高校"并置顶，
   其余外校只出现在选择列表并标"开发中"，**不得写成已支持**；助手名 Uni；包名 `com.unimate.app`。
5. **数据全本地**，不接第三方地图 Key；水印可自主开关（材料可信度靠 sidecar sha256 存证，不靠定位服务）。
6. **回复用中文**；**"已验证"和"未验证"必须分开说**。没有真机跑过的事不许声称通过。
7. **UI 文案必须与实现一致**：写了自己做不到的功能（例如"深色下自动降饱和"其实没做）算事故，宁可改文案也不糊弄验收。
8. **任何 await 原生/插件调用都必须包 `guard()` 超时**，启动路径尤其如此：宁可降级到登录页，也不许把用户永久卡在开屏。

## 二、构建与验证

- 唯一正确的出包方式：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-apk.ps1`（6 步，含包内容反查）。手跑 gradle 会打出旧 bundle。
- 测试（共 189 条）：`test:login`(27) / `test:parser`(57) / `test:zip`(15) / `test:notify`(16) / `test:color`(15) / `test:guard`(6) / `test:order`(3) / `test:boot`(13) / `test:refs`(2) / `test:css`(12) / `test:handbook`(23)。脚本用 `Invoke-Npm` 检查退出码，**红一条就不许出包**；新增测试文件必须同时登记进 `package.json` 与 `build-apk.ps1`，否则等于没跑。
- 改了代码必须做**反向取证**：新字符串要在 APK 里查得到、被删的旧字符串要查不到。只看"BUILD SUCCESSFUL"不算数。
- 怀疑包被别的工具改过时，比对 `SHA-256` 与 `PRD` 里记录的指纹 + 走一遍完整性校验。

## 三、踩过的坑（重复出现，别再犯）

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

## 四、待办（产品负责人点头才做）

- 二课填报的条款文案若要改，改 `src/catalog/handbook.ts`（第五~四十九条全量），并同步跑 `test:handbook`。
- 换机同步（PRD 11.15，加密 `.umig` 单文件走系统分享，不自建服务器）——只有设计，没写代码。
- 天气板块（Open-Meteo，免 Key，默认关闭的可选开关）——会打破"App 不联网"表述，需确认。
- **第二课堂/暗色等页面级功能必须真机点一遍**：构建全绿 + 单测全绿也可能整页崩（v2.8 的 watch TDZ 就是例子）。
- 提醒兜底心跳：若三件套齐了仍偶发漏响，再做"每 15 分钟一次的原生心跳 + 到期扫描"，别提前上。