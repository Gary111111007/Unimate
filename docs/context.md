# 项目上下文交接（压缩版 · 2026-09-22，v2.32）

> 用途：一页装下"现在到哪了、下一步做什么、别踩什么坑"。配合 `AGENTS.md`（硬规则）、`PRD.md`（需求与操作日志）、`Net.md`（联网路线图）、`docs/deploy.md`（部署）一起看。

## 1. 一句话现状

Unimate（北化校园助手）已落地 **两所高校**（北化、北二外·无二课），APK 可装、演示站已上线；**分享课表**（含二维码）已重做；**天气**（默认关闭、课表页一行）已接线；**学校档案热更新（P2）已实现**：带签名下发，选校页可"可下载/可更新/已下载/删回内置"，新增高校不用再发版。v2.26 修掉了真机上"平台 WebCrypto 不可用导致热更新整机失效"的问题（改为纯 JS 验签）。

## 2. 代码与版本

| 项 | 值 |
| --- | --- |
| 仓库 | `E:\Gary\北京化工大学\北化app\Work` |
| 最新提交 | 本次 v2.32（修 scheduled() 在安卓空转：排期改原生直读）；前几个：ff9c7d8 v2.31 自检报告、33fdb29 v2.30 心跳、edd4678 v2.29 P2.5 |
| 前一个提交 | `95c704f` — v2.28 提醒排期口径（地平线 7 天 + 只清过期 + 错过不补发） |
| 未提交（本轮） | 无 —— v2.32 的排期读取修复一起提交 |
| 演示站 | `https://unimate3.pages.dev`（Cloudflare Pages；**线上仍是 v2.23 的包**，`catalog/` 还没上传） |
| 最新 APK | `artifacts\android\unimate-debug.apk`（v2.32，SHA `B23E2EF1…`；v2.31 `D8A7068F…`、v2.30 `15520571…`） |
| 提醒口径 | 地平线 7 天；只清"过期 90 秒以上 + 账本里没有的"排期（`notify/plan.json`）；**错过的提醒不补发**；排期读取走**原生直读**（`scheduled()` 在安卓上没实现） |
| 提醒兜底 | v2.30 起有原生心跳（**有近期排期 10 分钟、否则 60 分钟**）：补投"过期 30 分钟内"的；`heartbeatStatus` 可查"排上了没 / 下一跳 / 累计补投" |
| 演示站状态 | **仍是 v2.23 的包**（线上 `index-UMPn5m76.js`），`/catalog/` 不存在 → App 会提示"站点上还没有下发清单"，属正常降级 |
| 签名私钥 | `keys\school-signing.key`（**未入库**，丢了要重新 keygen 并改公钥 + 重出包） |

## 3. 下一步（按优先级）

1. **部署演示站（v2.24~v2.32 全都没上线）**：本机没有 Cloudflare 凭据，`npx wrangler pages deploy` 报缺少 `CLOUDFLARE_API_TOKEN`。
   要么 `npx wrangler login` 后再 `npx wrangler pages deploy dist --project-name unimate3`，要么在 Cloudflare 项目页
   （Workers & Pages → unimate3 → Create new deployment）把 `dist` 里的内容整个拖上去。**多核对一步**：站点根下要有
   `catalog/index.json` / `index.json.sig` / `adapters/`（现在为空是正常的），否则 App 选校页会提示"站点上还没有下发清单"。
2. **真机复验 v2.32**（AGENTS.md 要求页面级功能必须真机验证）：
   ① **提醒**：装上后打开「我的 → 通知设置」——"系统已排期提醒"现在应显示**真实条数**（几十条，而不是 0，v2.32 修的）；
   设一条 2 分钟测试提醒并**锁屏等它响**；再点「**复制自检报告**」把那段文本发我（报告末尾会直接写结论：缺精确闹钟 / 缺电池优化豁免）。
   ② 档案热更新 AC-70~74；③ 天气 AC-64~69。
3. ~~北二外待核实项~~ —— 产品负责人 2026-09-21 明确「不用管了」。
4. ~~P2.5 解析适配器热更新~~ —— **v2.29 已完成**（规则层 + 与档案共用签名清单 + 改版演练测试 + `docs/adapters.md`）。
5. 下一步候选：**P3 换机同步**（端到端加密，需要对象存储 + Serverless；`Net.md` 2.5 有完整设计）。

## 4. 硬约束（违反即返工，详见 AGENTS.md）

- 所有删除/覆盖一律 `db.confirm` 二次确认；真实姓名只允许出现在版权水印里；UI/示例数据用"智小汇/2025040999"（**例外：意向清单里的开发者联系方式 2025040140，产品负责人指定**）。
- 数据全本地；不做密码保管；不代填教务表单；`await` 原生调用必须包 `guard()`。
- 改代码必须：跑全量测试 → `scripts\build-apk.ps1` 出包 → **反向取证**（新字符串在包里查得到、旧的查不到）。
- `.ps1` 必须 UTF-8 **带 BOM**，改它用 node 按字节改；`.ts/.vue` 不带 BOM。

## 5. 常用命令

```powershell
npm run test:notify       # 单跑某个套件（共 20 个：test:login/parser/exam/school/share/weather/schoolpack/adapters/toolbox/gesture/notify/boot/refs/order/css/watermark/handbook/zip/color/guard；合计 699 条断言）
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
