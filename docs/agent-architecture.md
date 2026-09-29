# Uni 双模式 Agent 架构与运行

## 1. 设计结论

本次是在现有 Vue + Capacitor Android、Pinia 数据层、P5 本机规则层和 Cloudflare Worker 上增量接线，没有替换课表、记事、天气、提醒或账号模块。

```text
月亮悬浮入口 / Uni 页 / Voice
              │
              ▼
          Agent Core
   上下文裁剪 · Tool 选择 · 风险门
        ┌─────┴─────┐
        │           │
 ONLINE Planner   OFFLINE Planner
        │           │
 Unimate Worker   本机规则解析
        │           │
 DeepSeek Function Calling
        └─────┬─────┘
              ▼
       同一套结构化 Tool Call
              ▼
        Android Tool Layer
              ▼
 StudentAgentPort（唯一 App 接口）
              ▼
 现有 Pinia store / 页面 / 天气 / 提醒
```

关键边界：

- DeepSeek 只理解用户主动发送的文字并选择 Tool，不连接数据库，也不执行 Tool。
- Worker 固定 Tool 白名单和 JSON Schema；Android 再按本机 Tool 定义校验参数，拒绝未知 Tool。
- Tool 结果只留在手机端对话记录，不回传给 DeepSeek；当前实现不会自动附带课表、教师、教室、记事或天气数据。
- 问候、致谢、能力询问、页面打开和明确的课表/记事指令先由 `LocalRulePlanner` 处理；只有本机规则无法处理的开放式问题才请求在线模型，减少首字等待时间。
- Offline Planner 与 DeepSeek 输出同一种 `AgentDecision`，因此 Tool Layer 不需要知道当前是否联网。
- 断网或网关失败时，当前请求自动尝试本机规则；网络恢复后的下一次请求重新尝试 Online Mode，无需重启 App。

## 2. 模块职责

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| 月亮入口 | `src/components/MoonAgentButton.vue` | 短按进入文字输入；长按 560 ms 进入语音链路 |
| Agent Core | `src/services/agentCore.ts` | 上下文、Tool 注册、结构化调用、风险确认 token、执行结果 |
| Online / Offline Planner | `src/services/aiProvider.ts` | 调自己的网关；失败降级；网络恢复重试 |
| 本机规则与 Tool | `src/services/uniTools.ts` | Offline 意图解析；课表、记事、天气、页面跳转 Tool |
| App 适配器 | `src/views/UniView.vue` | 实现 `StudentAgentPort`，把 Tool 接到现有 store/UI；Agent Core 不 import Pinia |
| Voice seam | `src/services/voiceAI.ts` | `VoiceInput` / `VoiceOutput` / `VoiceAgent`，固定 ASR → Agent → Tool → TTS |
| 自有服务端 | `cloudflare/sync-worker/src/index.js` | 调 DeepSeek Chat Completions + Function Calling；校验返回 JSON；不执行本机 Tool |
| Pages 中转 | `cloudflare/pages/_worker.js` | 将 `/v1/agent/chat` 转给现有 Worker，复用 App 已在使用的 `pages.dev` 域名 |

当前 Tool：

- `getSchedule`：下一节、今天、明天、本周、空档、冲突、简报；只读本机课表。
- `getNote`：查询本机未删除记事，可筛关键词和完成态。
- `addNote`：新增普通记事。
- `createReminder`：新增带 ISO 8601 提醒时间的记事，继续复用现有提醒排期。
- `getWeather`：读取缓存；仅在用户已有天气开关允许时按现有节流刷新。
- `openFeature`：打开课表、记事本、第二课堂、校园在线或“我的”入口。

新增记事和提醒虽然不是破坏性操作，也必须先完成一轮自然语言确认，用户明确肯定后才执行一次；这是产品交互要求，不替代高风险确认。删除、批量修改、覆盖等 Tool 必须声明 `risk: 'high'`，由 Agent Core 生成 5 分钟有效的一次性确认 token，并统一交给 `db.confirm()`；未确认、取消、过期或重放都不会执行。当前没有向 DeepSeek 暴露删除 Tool。

## 3. Online Mode 部署

APK 不放 DeepSeek Key，只请求现有 Unimate 网关。部署服务端前，在 `cloudflare/sync-worker` 设置：

```powershell
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put DEEPSEEK_MODEL
npm run deploy
```

`DEEPSEEK_MODEL` 可填当前账号可用且支持 Function Calling 的模型，例如 `deepseek-chat`。随后重新生成 Pages 拖放目录，使 `_worker.js` 转发 Agent 路由：

```powershell
node scripts\make-pages-package.mjs v2.61
```

把 `artifacts/cloudflare/unimate-cloudflare-v2.61-upload/` 目录本身拖到 Cloudflare Pages Production。若 Agent 网关地址不是项目默认地址，构建 APK 前设置独立的 `VITE_AGENT_API_BASE`，再运行正式构建脚本。`VITE_SYNC_API_BASE` 继续只负责账号与备份接口，不得改成临时模型地址。

服务端采用 DeepSeek 官方 Chat Completions 的 `tools` / `tool_choice: auto` 格式；`function.arguments` 只作为待校验 JSON，不能当作可信输入。

## 4. Offline Mode 与恢复

Offline Mode 不加载本地大模型，不新增模型文件、向量数据库或多 Agent。它使用确定性规则生成结构化 Tool Call，当前支持：

- 查询下一节、今日/明日、本周课表、空档和冲突；
- 打开或查询记事本；识别新增记事或提醒请求后先询问是否加入，只有用户明确回复“是”等肯定语时才调用 `addNote` / `createReminder`；
- 打开 App 内现有页面；
- 查询本机天气缓存（天气联网开关仍沿用原设置）。

课表和记事仍由现有本机存储维护，断网不会影响读取与写入。待办确认状态保存在本轮本机会话中；取消、无待确认时回复“是”或重复确认都不会写入。`navigator.onLine` 只用于快速判断；即使系统误报有网，只要 Agent 网关失败且该命令能离线处理，也会落回 Offline Mode。

## 5. Voice 接口

`VoiceAgent` 的固定流水线是：

```text
VoiceInput.transcribe() → AgentCore.ask() → Tool → VoiceOutput.speak()
```

默认适配器只尝试 WebView 提供的 Web Speech API，不增加原生 SDK、模型体积或模型 Key。当前 APK 没有新增录音权限，因此长按入口、超时保护、ASR/TTS 接口和降级提示已接好，但 Android 真机语音识别不能标记为已可用。后续接小智 AI、Whisper.cpp、Sherpa-ONNX 或服务端 ASR/TTS 时，只需替换 `VoiceInput` / `VoiceOutput`，不用改 DeepSeek Provider、Agent Core 或 Tool。

## 6. 构建与验证

唯一正式出包命令：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-apk.ps1
```

本轮已验证：26 个测试套件、1012 条断言；Vite 生产构建；Capacitor 同步；Gradle `assembleDebug`；`apksigner verify`；包名/SDK/权限；APK 内 bundle 与 `dist` 一致；新增询问/确认/快速问候、常见用餐本机回答及悬浮入口缩放类名存在；月亮标签不存在，按钮本体透明、无边框、无按钮阴影，月牙渐变流光、柔光、呼吸动画、透明玻璃圈及减少动态效果降级均在包内；旧“当前版本不连接大模型”文案不存在。APK 6.70 MiB，SHA-256 `8A450E7BEE6B57FCDEB07E732F036590E160FE3FF0E7DFCD1816237E4A8FEFEA`。

本轮未验证：Worker/Pages 实际重新部署、真实 DeepSeek 在线请求与计费、真机网络切换、真机月亮手势、ASR/TTS、Tool 写入和提醒的端到端点击。上线前必须按这些项目逐项复验，不能用静态构建结果代替。
