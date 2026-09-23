# 项目上下文交接（压缩版 · 2026-09-23，v2.43）

> 用途：一页装下"现在到哪了、下一步做什么、别踩什么坑"。配合 `AGENTS.md`（硬规则）、`PRD.md`（需求与操作日志）、`Net.md`（联网路线图）、`docs/deploy.md`（部署）一起看。

## 1. 一句话现状

Unimate（北化校园助手）已落地 **两所高校**（北化、北二外·无二课），APK 可装、演示站已上线；**分享课表**（含二维码）已重做；**天气**（默认关闭、课表页一行）已接线；**学校档案热更新（P2）已实现**：带签名下发，选校页可"可下载/可更新/已下载/删回内置"，新增高校不用再发版。v2.26 修掉了真机上"平台 WebCrypto 不可用导致热更新整机失效"的问题（改为纯 JS 验签）。

## 2. 代码与版本

| 项 | 值 |
| --- | --- |
| 仓库 | `E:\Gary\北京化工大学\北化app\Work` |
| 最新提交 | 本次 v2.43（**账号登录 + 服务器托管**：产品负责人撤销"数据只在本机/只传密文"）；`e24e2c0` v2.42（账号+口令 E2EE 找回）；`65ca9cc` v2.41（正文走 pages.dev 中转，真机上传已通过）；`7cdb954` v2.40（`$ is not a function` 真因 = 变量重名） |
> **口径变更（v2.43，最重要的一条）**：产品负责人要求"像普通 App 那样账号登录、数据存云端"，并**明确撤销**了旧口径。
> 现在主推**账号登录（服务器托管）**：备份存 R2、服务端持 `DATA_KEY` **能读**、忘记密码开发者可重置；
> 端到端加密（服务器读不懂）**降为可选高级项**。`AGENTS.md` 硬规则 5 已改写 —— 旧表述（"数据默认全本地 / 只上传密文 / 服务器看不到你的数据"）**不许再写进 UI 或答辩材料**。
| 先读哪 | 云端与 P3 的最新状态看 **`PRD.md` 开头的「当前接续摘要」** 与 **`Net.md` 的「当前云端接续摘要」**（本节只保留工程侧的通用交接） |
| 未提交（本轮） | 无 —— v2.43 一起提交 |
| 演示站 | `https://unimate3.pages.dev`（Cloudflare Pages）；**线上 = v2.39**（`assets/index-DroQga0f.js`，`catalog/` 三件套 200、`_worker.js` 生效） |
| 最新 APK | `artifacts\android\unimate-debug.apk`（v2.43，SHA `5C93310D…`；v2.42 `E8ABA42C…`、v2.41 `5FCDAC5D…`、v2.40 `B978B64F…`） |
| 提醒口径 | 地平线 7 天；只清"过期 90 秒以上 + 账本里没有的"排期（`notify/plan.json`）；**错过的提醒不补发**；排期读取走**原生直读**（`scheduled()` 在安卓上没实现） |
| 提醒兜底 | 心跳（有近期排期 10 分钟/否则 60 分钟）+ **提醒守护前台服务（v2.34 默认开）**：一条最低优先级静音常驻通知防 ROM 冻结；开机广播清场（过期/20 秒内要响的丢弃，不补发） |
| 演示站状态 | v2.41 上传包**已拖并核对**（真机上传通过）。现在需重拖 **v2.43**：`artifacts\cloudflare\unimate-cloudflare-v2.43-upload`（**拖目录本身**）——前端 bundle 与 `_worker.js` 的转发表都变了 |
| Worker | **v2.43 必须重新 deploy**（新增账号 API）：`cd cloudflare\sync-worker` → `npx wrangler secret put DATA_KEY`（建议；不设也能跑，界面会提示"未设落盘密钥"）→ `npm run deploy`。之后 `/health` 应回 `accounts:true` |
| 账号登录（主推） | 服务端：`/v1/signup`、`/v1/login`、`GET /v1/account`、`PUT|GET /v1/backup`、`DELETE /v1/account`；账号记录 `acct/<HMAC(pepper,账号)>.json`、数据 `data/<随机id>.bin`，**都在既有 R2 桶**（不新建 D1/KV）。密码原文不上传（本地 210k PBKDF2 → verifier，服务端存 `sha256(盐+verifier)`）；令牌只存 sha256、90 天过期；注销 = 删记录 + 删数据对象 + `db.confirm` 二次确认 |
| 端到端加密（可选） | v2.42 的"账号名派生同步码 + 恢复码 + 墓碑删除"全部保留，作为隐私优先选项；**不再是主推** |
| 同步正文链路 | **v2.41 起走 pages.dev 中转**：`POST /v1/put?syncId=`（代取 15 分钟短链 → 代 PUT → 回 `{ok,expiresAt}`）、`POST /v1/get?syncId=`（代 GET → 正文原样返回，`Content-Type: application/vnd.unimate.sync+json`）。客户端**中转优先、直传兜底**（`/v1/put` 返回非 JSON = 旧版站点 → 回退老路） |
| 签名私钥 | `keys\school-signing.key`（**未入库**，丢了要重新 keygen 并改公钥 + 重出包） |

## 3. 下一步（按优先级）

1. **真机复验 v2.43**（当前唯一主线）：
   ① **重新部署 Worker**（不 deploy 就没有账号 API，App 会提示"账号接口还没部署"）；② 重拖 v2.43 Pages 包；
   ③ 覆盖安装 v2.43 APK（**不要卸载**）→「我的 → 加密换机同步 → 账号登录」→ 勾选同意 → 注册并上传；
   ④ **第二台设备（或先清数据）登录同一账号** → 应自动下载 → 预览 → 覆盖/合并 → 二次确认 → 课表回来。
   ①b 顺手验「注销账号并删除云端数据」：二次确认后再登录应该 401/提示账号不存在。
   ② **提醒**：设一条几分钟后的测试提醒并**锁屏等它响**（v2.35 起 `ReminderAlarmReceiver` 到点直接投递）；再点「我的 → 通知设置 → 复制自检报告」把文本发我。
   ③ 档案热更新 AC-70~74（北二外"可下载 → 下载 → 切换"）；④ 天气 AC-64~69。
2. **重拖 v2.43 Pages 上传包**（`artifacts\cloudflare\unimate-cloudflare-v2.43-upload`，拖目录本身）→ 我 curl 核对 `/health`（应含 `accounts:true`）。
2b. **下一步功能（产品负责人要的"一个登录就全好"还差这一步）**：把云账号登录搬到**开机登录页** —— 现在必须先登录本机账号，再进「我的」里登录云账号。
2b. （可选）补桶 CORS：`cd cloudflare\sync-worker` → `npx wrangler r2 bucket cors set unimate-sync --file cors.json`（直传兜底那条路才通）。
3. 本机没有 Cloudflare 凭据（`npx wrangler pages deploy` 会报缺 `CLOUDFLARE_API_TOKEN`），所以拖放由产品负责人做；命令与排查见 `docs/deploy.md`。
4. ~~北二外待核实项~~ —— 产品负责人 2026-09-21 明确「不用管了」；~~P2.5 解析适配器热更新~~ —— **v2.29 已完成**。
5. 下一步候选：**P5 AI 助手** →（可选）**P4 智能解析**（`Net.md` §2.6/§2.7）。

## 4. 硬约束（违反即返工，详见 AGENTS.md）

- 所有删除/覆盖一律 `db.confirm` 二次确认；真实姓名只允许出现在版权水印里；UI/示例数据用"智小汇/2025040999"（**例外：意向清单里的开发者联系方式 2025040140，产品负责人指定**）。
- 数据全本地；不做密码保管；不代填教务表单；`await` 原生调用必须包 `guard()`。
- 改代码必须：跑全量测试 → `scripts\build-apk.ps1` 出包 → **反向取证**（新字符串在包里查得到、旧的查不到）。
- `.ps1` 必须 UTF-8 **带 BOM**，改它用 node 按字节改；`.ts/.vue` 不带 BOM。

## 5. 常用命令

```powershell
npm run test:notify       # 单跑某个套件（共 21 个：test:login/parser/exam/school/share/weather/sync/schoolpack/adapters/toolbox/gesture/notify/boot/refs/order/css/watermark/handbook/zip/color/guard；合计 846 条断言）
node --experimental-strip-types scripts\make-school-pack.mjs   # 重新导出 + 签名学校档案下发包（见 docs/school-pack.md）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-apk.ps1   # 唯一正确出包方式（沙箱内跑不通，需在沙箱外）
npx wrangler pages deploy dist --project-name unimate3                       # 部署演示站
curl.exe -sS https://unimate3.pages.dev/ | Select-String 'index-.*\.js'      # 核对线上跑的是哪个包
```

## 6. 本轮踩过的坑（别重复）

| 坑 | 教训 |
| --- | --- |
| 两个 agent 同时改同一批文件 | 调用方改了、被调函数没补 → 提交里带着跑不起来的中间状态（`225226b` 就是）；**改前先 `git status`，别自动 `git add -A` 扫别人的半成品** |
| `share.ts` 里 `encodeShare` 重复声明 | 动手前先 `rg 'export function encodeShare'` 看有没有 |
| APK 里 `location.origin` = `https://localhost` | 分享链接必须用 `PUBLIC_SHARE_BASE`（`https://unimate3.pages.dev/`），换域名要同步改 |
| 二维码被裁 | svg `viewBox` 已是模块单位就别再套 `transform: scale()`（已有几何断言兜底） |
| `*.workers.dev` 在大陆连接超时 | 演示站只发 `pages.dev` 或自有域名 |
| Pages 把 `xxx.html` 301/308 成 `xxx` | 我们的 `fetch('sample-timetable.html')` 会自动跟随，不影响 |
| 定位并发用了 `Promise.race` | 第一路失败会把整个 race 判死（第二路明明成功也拿不到）→ 用 `firstFulfilled()`（weather 服务里，带单测） |
| 天气的 30 分钟节流只记"成功时间" | 断网时会退化成"每切一次课表 tab 就重试一次"→ `weatherTriedAt` 在**发起前**就写，成功失败都算 |
| `.btn` 从来没有 `:disabled` 样式 | 禁用按钮和可点按钮长得一样（"点了没反应"的观感）→ 已补 `.btn:disabled{opacity:.45}` |
| 登录页写着"不联网、不上传" | 有了天气就不成立；文档与界面口径要跟着实现走（AGENTS.md 第 7 条） |
| **真机报"WebCrypto 用不了验签"**（v2.25 的坑，v2.26 修） | 安卓 WebView 的平台密码学实现差异会让整个热更新在部分机型上不可用 → **改用纯 JS 验签**（`@noble/ed25519` + `@noble/hashes`），算法回到规范写的 Ed25519，从此不依赖 WebCrypto |
| **把"还没部署"报成"签名不对"**（v2.26 的坑，v2.27 修） | 静态托管对未知路径会回落成首页（200 + text/html），App 拿 HTML 去验签必然失败 → `fetchCatalog()` 现在同时看 HTTP 状态与 content-type，四种情况分别给文案；**只有"两个文件都在但验不过"才是可能被投毒的告警** |
| 插件 `setExactIfPossible()` 在"闹钟和提醒"未授权时退化成**不精确闹钟**（v2.28 修） | Android 12+ 默认不给该权限 → 到点不响、等手机/应用活跃时批量补发。现在课表页会提示并给一键入口（只查状态、不自动跳设置） |
| 插件的开机恢复广播把**已过期**排期改写成"now+15 秒"（v2.28 修） | 这是"一打开全一股脑"的来源之一 → 我们用 `notify/plan.json` 记账，只清"过期 90 秒以上 + 账本里没有的"，未来的排期不动 |
| 冷启动"全清再重建"会吞掉正好到点的那一条（v2.28 修） | 用户常常就在提醒时刻前后打开 App 看有没有课 → 改成按账本精确清理；顺序仍是"先清后建"（boot 测试锁死） |
| 顺带的发现：明文 http 下 `crypto.subtle` 根本不存在（仅安全上下文才有） | 用局域网 IP（`http://192.168.x.x`）调试时，浏览器里连 SHA-256 都算不了 —— 这也是"别把关键能力押在平台 API 上"的又一例证 |
| `build-apk.ps1` 行尾是**混着的**（老行 `CR CR LF`，新加的行纯 LF） | 改它只能用 node 按字节插入、并**沿用相邻行的行尾**，别统一行尾 —— 否则 diff 里上百行假变更 |
| 私钥差点进了仓库 | `keys/` 已写进 `.gitignore`；出包反查里也要确认 APK 里**没有** `BEGIN PRIVATE KEY` |
| **`*.workers.dev` 在大陆被 DNS 污染**（v2.39 踩到） | 实测 `unimate-sync.…workers.dev` 解析到 `69.171.228.74`（Meta 段）且 443 超时，而 `pages.dev` 200/1.3s → **要给手机用的接口必须挂在 pages.dev 上**（Pages Advanced Mode `_worker.js` 同域提供，再边缘转发给 Worker） |
| **APK 里页面源是 `https://localhost`**，不是 `http://localhost`（v2.39 踩到） | Capacitor `androidScheme: https` → 接口的 CORS 白名单必须写 **https**，否则真机 403「来源不允许」（桌面调试却是通的，最容易漏） |
| Gradle 守护进程占住输出管道，构建脚本"看起来卡住"（v2.31 / v2.39 各一次） | APK 其实已经产出：看 `artifacts\android\unimate-debug.apk` 的时间戳与指纹，再把 java 进程停掉即可；别当构建失败重跑 |
| Pages 上传包以前是**手工拷**的（v2.36~v2.38） | 谁都不知道 `_worker.js` 该不该放、放哪儿 → 现在用 `node scripts/make-pages-package.mjs v2.40` 可复现产出（含根部 `_worker.js`） |
| **顶层变量与 import 重名**（v2.40 定案，最贵的一个） | `MeView.vue` 里 `const guard = ref(...)` 撞上 `import { guard }`：SFC 编译把 import 的那个改名（dev 里是 `guard2`，真机压缩后是 `$`）→ 调用点静默指向本地 ref → 真机报 **`$ is not a function`**。**构建不报错、单测不报错、只有真机炸**，还被误判成 WebCrypto 兼容问题白改了一整轮（v2.38）。现在 `test:order` 会扫全仓库的"顶层声明 vs import 名"；**换个变量名比换一套密码学实现便宜得多** |
| 原生报错文案会随构建变化 | 真机是 `$ is not a function`（压缩后），**dev 里同样的 bug 是 `guard2 is not a function`** → 遇到"压缩名报错"先在 `npm run dev` 里复现一遍，能直接读出被改名的原名 |
| **同一个"缺 `https://localhost`"的坑，出现在第三张表上**（v2.41 踩到） | ① v2.39：Worker 的 `APP_ORIGINS` 只有 `http://localhost` → 预签名 403（已修）；② v2.40：Pages `_worker.js` 白名单只写不带端口的本机来源 → 网页调试预检 403（已修）；③ v2.41：**R2 桶的 `cors.json` 只有 `http://localhost`** → 真机直传 R2 被 WebView 拦掉，报"上传加密备份失败"。**凡是要跟浏览器/WebView 跨域的资源（API、对象存储、CDN），白名单都要写 `https://localhost`**；现在的做法是干脆不让手机直连外部域名（正文也走 pages.dev 中转） |
| 真机报错文案要能"一步定位" | 「上传加密备份失败，请检查网络后重试」是客户端 `fetchTimed('上传加密备份', …)` 的兜底文案 → 它天然把范围缩到"预签名之后那一次 fetch"（那一步就是直传 R2）。**改错误文案时保留这种"哪一步失败"的信息**，比只写一句"网络错误"有用得多 |
| 上传成功后**顺手发现文案已经过时** | v2.41 把正文改走 pages.dev 中转后，面板上"再直传 Cloudflare R2"就与实现不符了（AGENTS.md 第 7 条）→ 现在写"经 unimate3.pages.dev 中转上传"。**改了链路一定要回头搜一遍旧链路的名字**（本次用 `rg '直传' src`） |
| 账号模式不能只改同步码，**恢复码里的那一截也要跟着改** | 恢复码格式是 `UM1.<同步码>.<秘密>`：账号模式下如果只把同步码换成派生值、恢复码里还留着随机同步码，用户拿恢复码去别的手机就会去查一个不存在的对象（有断言盯着：`parseRecoveryCode(code).syncId === deriveAccountSyncId(account)`） |
| `crypto.subtle.encrypt` 的第一个参数是 `CryptoKey`，不是裸字节（v2.43 被单测抓到） | 想用 `sha256(secret)` 当 AES 密钥，必须先 `importKey('raw', digest, {name:'AES-GCM'}, false, ['encrypt'])` 再传；直接传 `Uint8Array` 会抛 `2nd argument is not of type CryptoKey`（Node 里报，Workers 里同样） |
| 跨域请求头/方法也要写进预检白名单（v2.39 / v2.41 / v2.43 连着踩） | 账号 API 用 `Authorization` 头 + `PUT/DELETE`：`Access-Control-Allow-Headers` 少了 Authorization、`Allow-Methods` 少了 PUT/DELETE，浏览器会在预检直接拦掉，服务端连日志都不会有 |
| Gradle 守护进程占住输出管道（v2.31 / v2.39 / v2.40 / **v2.43**） | APK 其实已产出：看 `artifacts\android\unimate-debug.apk` 的时间戳与指纹，再把 java 进程停掉；第 6 步的校验（bundle 一致 / catalog 未入包 / 反查字符串 / `apksigner verify`）可以手工复核 |
| CORS 白名单只写不带端口的 `http://localhost`（v2.39 的漏格，v2.40 补） | 网页调试的来源是 `http://localhost:5204` 这类**带端口**的写法 → 预检 403，而手机（`https://localhost`，无端口）是通的 → 表现为"只有真机能测"。现在按 `LOCAL_ORIGIN` 正则放行 `localhost`/`127.0.0.1` 任意端口 |
