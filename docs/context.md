# 项目上下文交接（压缩版 · 2026-09-21，v2.24）

> 用途：一页装下"现在到哪了、下一步做什么、别踩什么坑"。配合 `AGENTS.md`（硬规则）、`PRD.md`（需求与操作日志）、`Net.md`（联网路线图）、`docs/deploy.md`（部署）一起看。

## 1. 一句话现状

Unimate（北化校园助手）已落地 **两所高校**（北化、北二外·无二课），APK 可装、演示站已上线；**分享课表**（含二维码）已重做并部署过；**天气（第一个真联网功能）已接线完成**：默认关闭、打开后课表页顶部一行，30 分钟最多拉一次。

## 2. 代码与版本

| 项 | 值 |
| --- | --- |
| 仓库 | `E:\Gary\北京化工大学\北化app\Work` |
| 最新提交 | 本次 v2.24（天气接线；上一个提交 `7ecaa00` — v2.23 分享重做） |
| 上一个提交 | `45e5e32` — 实际是 v2.15~v2.19（提交信息误写 v2.14，已在 PRD §14.1 登记真实口径，历史不重写） |
| 未提交（本轮） | 无 —— 天气服务层 + UI 接线一起提交（v2.24） |
| 演示站 | `https://unimate3.pages.dev`（Cloudflare Pages，免备案） |
| 最新 APK | `artifacts\android\unimate-debug.apk`（v2.24，SHA `115DC82B…`） |

## 3. 下一步（按优先级）

1. ~~分享面板排版重做~~ —— 已完成；~~重新出包~~ —— 已完成（v2.24）。
2. **部署演示站（v2.24 还没上线）**：本机没有 Cloudflare 凭据，`npx wrangler pages deploy` 报缺少 `CLOUDFLARE_API_TOKEN`。要么 `npx wrangler login` 后再 `npx wrangler pages deploy dist --project-name unimate3`，要么在 Cloudflare 项目页拖一次新的 `dist`。
3. **真机点一遍天气**（AGENTS.md 明确要求页面级功能必须真机验证）：① 关着时课表页没有天气行、也没有任何对外请求；② 打开 → 定位授权 → 课表页出现那一行；③ 拒绝定位 → 手填城市仍能出天气；④ 飞行模式下点「立即更新」不卡、不报错、显示上次结果。
4. ~~北二外待核实项~~ —— 产品负责人 2026-09-21 明确「不用管了」。
5. 联网路线图（`Net.md`）：~~P0 天气~~（已完成）→ P2 学校档案热更新（**必须 Ed25519 签名**）→ P3 跨机同步（端到端加密）→ P5 AI 助手（Key 只在服务端）。

## 4. 硬约束（违反即返工，详见 AGENTS.md）

- 所有删除/覆盖一律 `db.confirm` 二次确认；真实姓名只允许出现在版权水印里；UI/示例数据用"智小汇/2025040999"（**例外：意向清单里的开发者联系方式 2025040140，产品负责人指定**）。
- 数据全本地；不做密码保管；不代填教务表单；`await` 原生调用必须包 `guard()`。
- 改代码必须：跑全量测试 → `scripts\build-apk.ps1` 出包 → **反向取证**（新字符串在包里查得到、旧的查不到）。
- `.ps1` 必须 UTF-8 **带 BOM**，改它用 node 按字节改；`.ts/.vue` 不带 BOM。

## 5. 常用命令

```powershell
npm run test:weather      # 单跑某个套件（共 18 个：test:login/parser/exam/school/share/weather/toolbox/gesture/notify/boot/refs/order/css/watermark/handbook/zip/color/guard；合计 491 条断言）
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
