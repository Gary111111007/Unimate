# 项目上下文交接（压缩版 · 2026-09-21，v2.25）

> 用途：一页装下"现在到哪了、下一步做什么、别踩什么坑"。配合 `AGENTS.md`（硬规则）、`PRD.md`（需求与操作日志）、`Net.md`（联网路线图）、`docs/deploy.md`（部署）一起看。

## 1. 一句话现状

Unimate（北化校园助手）已落地 **两所高校**（北化、北二外·无二课），APK 可装、演示站已上线；**分享课表**（含二维码）已重做；**天气**（默认关闭、课表页一行）已接线；**学校档案热更新（P2）已实现**：带签名下发，选校页可"可下载/可更新/已下载/删回内置"，新增高校不用再发版。

## 2. 代码与版本

| 项 | 值 |
| --- | --- |
| 仓库 | `E:\Gary\北京化工大学\北化app\Work` |
| 最新提交 | 本次 v2.25（学校档案热更新；上一个提交 `9ada557` — v2.24 天气接线） |
| 上一个提交 | `45e5e32` — 实际是 v2.15~v2.19（提交信息误写 v2.14，已在 PRD §14.1 登记真实口径，历史不重写） |
| 未提交（本轮） | 无 —— 档案热更新（服务层 + 生成工具 + 选校页 + 文档）一起提交（v2.25） |
| 演示站 | `https://unimate3.pages.dev`（Cloudflare Pages，免备案） |
| 最新 APK | `artifacts\android\unimate-debug.apk`（v2.25，SHA `22AA8B17…`） |
| 签名私钥 | `keys\school-signing.key`（**未入库**，丢了要重新 keygen 并改公钥 + 重出包） |

## 3. 下一步（按优先级）

1. **部署演示站（v2.24/v2.25 都还没上线）**：本机没有 Cloudflare 凭据，`npx wrangler pages deploy` 报缺少 `CLOUDFLARE_API_TOKEN`。要么 `npx wrangler login` 后再 `npx wrangler pages deploy dist --project-name unimate3`，要么在 Cloudflare 项目页拖一次新的 `dist`。**注意这次要多核对一步**：站点根下要有 `catalog/index.json` / `index.json.sig` / `<schoolId>.json`，否则 App 选校页会一直提示"站点上没有清单或签名文件"。
2. **真机点一遍（AGENTS.md 要求页面级功能必须真机验证）**：① 天气：关着时课表页没有那一行、也没有任何对外请求；打开 → 定位授权 → 出现那一行；拒绝定位 → 手填城市仍能出；飞行模式不卡不报错。② 档案热更新 AC-70~74：断网打开选校页只显示内置名单不报错；联网点「检查更新」能看到远端清单；下载后重启仍可用；用改坏的清单/档案试一次，必须被拒收。
3. ~~北二外待核实项~~ —— 产品负责人 2026-09-21 明确「不用管了」。
4. 联网路线图（`Net.md`）：~~P0 天气~~、~~P2 学校档案热更新~~（都已实现）→ P2.5 解析适配器热更新（声明式规则包）→ P3 跨机同步（端到端加密）→ P5 AI 助手（Key 只在服务端）。

## 4. 硬约束（违反即返工，详见 AGENTS.md）

- 所有删除/覆盖一律 `db.confirm` 二次确认；真实姓名只允许出现在版权水印里；UI/示例数据用"智小汇/2025040999"（**例外：意向清单里的开发者联系方式 2025040140，产品负责人指定**）。
- 数据全本地；不做密码保管；不代填教务表单；`await` 原生调用必须包 `guard()`。
- 改代码必须：跑全量测试 → `scripts\build-apk.ps1` 出包 → **反向取证**（新字符串在包里查得到、旧的查不到）。
- `.ps1` 必须 UTF-8 **带 BOM**，改它用 node 按字节改；`.ts/.vue` 不带 BOM。

## 5. 常用命令

```powershell
npm run test:schoolpack   # 单跑某个套件（共 19 个：test:login/parser/exam/school/share/weather/schoolpack/toolbox/gesture/notify/boot/refs/order/css/watermark/handbook/zip/color/guard；合计 594 条断言）
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
| 拿局域网 IP 打开调试页 → 验签永远"不支持" | **WebCrypto（`crypto.subtle`）只在安全上下文存在**：`http://localhost`、`http://foo.localhost`、https 都有，`http://192.168.x.x` 没有。调试热更新请用 `foo.localhost`（既算安全上下文，又不会被 `shareBase()` 换成公网站点） |
| 以为 Ed25519 不能用（其实是没 WebCrypto） | 实测：安全上下文里 Ed25519 与 ECDSA 都能用；但 Ed25519 要 Chrome 113+，国产 ROM 的 WebView 版本不保证 → **成品用 ECDSA P-256**（Chrome 37+） |
| `build-apk.ps1` 行尾是**混着的**（老行 `CR CR LF`，新加的行纯 LF） | 改它只能用 node 按字节插入、并**沿用相邻行的行尾**，别统一行尾 —— 否则 diff 里上百行假变更 |
| 私钥差点进了仓库 | `keys/` 已写进 `.gitignore`；出包反查里也要确认 APK 里**没有** `BEGIN PRIVATE KEY` |
