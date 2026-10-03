# Uni 双模式 Agent 架构与运行

## 1. 设计结论

本次是在现有 Vue + Capacitor Android、Pinia 数据层、P5 本机规则层和 Cloudflare Worker 上增量接线，没有替换课表、记事、天气、提醒或账号模块。

```text
月亮悬浮入口 / Uni 页（文字对话）
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
 Workers AI Function Calling
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

- Workers AI 只理解用户主动发送的文字并选择 Tool，不连接数据库，也不执行 Tool。
- Worker 固定 Tool 白名单和 JSON Schema；Android 再按本机 Tool 定义校验参数，拒绝未知 Tool。
- Tool 结果只留在手机端对话记录，不回传给 Workers AI；当前实现不会自动附带课表、教师、教室、记事或天气数据。
- 问候、致谢、能力询问、页面打开和明确的课表/记事指令先由 `LocalRulePlanner` 处理；只有本机规则无法处理的开放式问题才请求在线模型，减少首字等待时间。
- Offline Planner 与 Workers AI 输出同一种 `AgentDecision`，因此 Tool Layer 不需要知道当前是否联网。
- 断网或网关失败时，当前请求自动尝试本机规则；网络恢复后的下一次请求重新尝试 Online Mode，无需重启 App。

## 2. 模块职责

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| 月亮入口 | `src/components/MoonAgentButton.vue` | 短按放大，再点进入 Uni 文字对话；可全窗口拖动（v2.67 起不再有长按语音） |
| Agent Core | `src/services/agentCore.ts` | 上下文、Tool 注册、结构化调用、风险确认 token、执行结果 |
| Online / Offline Planner | `src/services/aiProvider.ts` | 调自己的网关；失败降级；网络恢复重试 |
| 本机规则与 Tool | `src/services/uniTools.ts` | Offline 意图解析；课表、记事、天气、页面跳转 Tool |
| App 适配器 | `src/views/UniView.vue` | 实现 `StudentAgentPort`，把 Tool 接到现有 store/UI；Agent Core 不 import Pinia；含按天分组的对话与历史面板 |
| 自有服务端 | `cloudflare/sync-worker/src/index.js` | 通过 `AI` binding 调 Workers AI Function Calling；校验返回 JSON；不执行本机 Tool |
| AI Pages 中转 | `cloudflare/agent-pages/public/_worker.js` | `unimate3-ai-pages.pages.dev` 经 `UNIMATE_AI` 服务绑定调用新账号 Worker；只允许健康检查与 Agent 路由 |

当前 Tool：

- `getSchedule`：下一节、今天、明天、本周、空档、冲突、简报；只读本机课表。
- `getNote`：查询本机未删除记事，可筛关键词和完成态。
- `addNote`：新增普通记事。
- `createReminder`：新增带 ISO 8601 提醒时间的记事，继续复用现有提醒排期。
- `getWeather`：读取缓存；仅在用户已有天气开关允许时按现有节流刷新。
- `openFeature`：打开课表、记事本、第二课堂、校园在线或“我的”入口。

新增记事和提醒虽然不是破坏性操作，也必须先完成一轮自然语言确认，用户明确肯定后才执行一次；这是产品交互要求，不替代高风险确认。删除、批量修改、覆盖等 Tool 必须声明 `risk: 'high'`，由 Agent Core 生成 5 分钟有效的一次性确认 token，并统一交给 `db.confirm()`；未确认、取消、过期或重放都不会执行。当前没有向 Workers AI 暴露删除 Tool。

## 3. Online Mode 部署

APK 不放模型 Key，只请求现有 Unimate 网关。`cloudflare/sync-worker/wrangler.toml` 已配置 Workers AI binding 与默认模型：

```toml
[vars]
WORKERS_AI_MODEL = "@cf/zai-org/glm-4.7-flash"

[ai]
binding = "AI"
```

该模型由 Cloudflare 托管，支持中文与 Function Calling，不需要设置第三方模型 Secret。Workers AI Free 计划每天有免费 Neurons；免费额度用完、网络中断或网关异常时，当前请求回落到本机离线规划器。免费额度不是无限额度，若 Cloudflare 账户升级为 Paid，超额部分按当期价格计费。

部署 Worker 后更新独立 AI Pages 中转（项目已创建）：

```powershell
cd cloudflare\sync-worker
npm run deploy
cd ..\agent-pages
..\sync-worker\node_modules\.bin\wrangler.cmd pages deploy --project-name unimate3-ai-pages --branch main --commit-dirty=true
```

APK 默认 AI 地址为 `https://unimate3-ai-pages.pages.dev`，仍支持 `VITE_AGENT_API_BASE` 构建覆盖。`VITE_SYNC_API_BASE` 默认仍为 `https://unimate3.pages.dev`，账号/备份由原账号服务承载；当前 AI 账号未配置 R2 Secrets，不能替换同步上游。部署缓存和临时目录应放 F 盘，详见 `cloudflare/agent-pages/README.md`。

服务端通过 `env.AI.run()` 采用 Workers AI 的 `tools` / `tool_choice: auto` 格式；`function.arguments` 只作为待校验 JSON，不能当作可信输入。

## 4. Offline Mode 与恢复

Offline Mode 不加载本地大模型，不新增模型文件、向量数据库或多 Agent。它使用确定性规则生成结构化 Tool Call，当前支持：

- 查询下一节、今日/明日、本周课表、空档和冲突；
- 打开或查询记事本；识别新增记事或提醒请求后先询问是否加入，只有用户明确回复“是”等肯定语时才调用 `addNote` / `createReminder`；
- 打开 App 内现有页面；
- 查询本机天气缓存（天气联网开关仍沿用原设置）。

课表和记事仍由现有本机存储维护，断网不会影响读取与写入。待办确认状态保存在本轮本机会话中；取消、无待确认时回复“是”或重复确认都不会写入。`navigator.onLine` 只用于快速判断；即使系统误报有网，只要 Agent 网关失败且该命令能离线处理，也会落回 Offline Mode。

## 5. 对话与历史记录（v2.67）

Uni 只做**文字对话**，语音输入整条链路已下线：

- 前端：不再有麦克风按钮、`listenVoice()`、监听态与键盘语音兜底提示。
- 服务层：`src/services/voiceAI.ts`（`VoiceInput` / `VoiceOutput` / `VoiceAgent`）已删除。
- WebView 桥：`jwwebview.ts` 不再暴露 `speechToText` / `showKeyboard`。
- 原生：`JwWebViewPlugin.java` 移除 `speechToText`、`showKeyboard`、`SpeechRecognizer` 后备与 `handleSpeechResult`；`AndroidManifest.xml` 不再申请 `RECORD_AUDIO`。
- 月亮入口：短按放大、再点进入对话；拖动保存位置不变。

对话区人性化（参考开源语音/聊天助手的通用做法）：

- **按天分组**：每次跨天插入一条"今天 / 昨天 / 9月21日 周一"分隔条。
- **头像 + 分组**：用户与 Uni 各有头像；连续同一方发言只显示第一个头像与气泡尾巴（`newGroup`）。
- **时间克制**：同一方连续发言不再逐条重复完整时间，只显示 `HH:mm`。
- **加载反馈**：等待回复用三点呼吸动画，而不是一行裸文字。
- **历史面板**：按天分组、当天标题吸顶；用户消息只作为"问过什么"的摘要，Uni 回复完整呈现。

历史记录仍按学校和账号保存在 `schools/<schoolId>/users/<accountId>/agent/history.json`，只恢复纯文本与时间，不恢复旧操作卡或确认 token。

## 6. 构建与验证

唯一正式出包命令：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-apk.ps1
```

本轮已验证：26 个测试套件、1029 条断言；`test:agent` 42/42（含直接调用 Worker handler 的 AI binding、白名单 Tool Call 与 `/health` 打桩）；Vite 生产构建；Capacitor 同步；Gradle `assembleDebug`；`apksigner verify`；包名/SDK/权限；APK 内 bundle 与 `dist` 一致。包内反查确认“Workers AI 在线 + 本机离线兜底”和离线能力提示存在，旧 DeepSeek 标题、配置错误、API 地址和 Key 均不存在。APK 6.71 MiB，SHA-256 `3C166782C0640EE9949601B8B6DB4A3D98E4C018B7B7008A8E7252180D923905`。

2026-10-01 补充验证：独立 AI Pages 已上线，生产 `/health` 200 且 `agentReady:true`；真实模型返回“在线测试成功”，查询明天课表返回 `getSchedule` 结构化调用，APK Origin 预检 204。Agent 测试 49/49，包含 Provider 经中转返回在线回答、CORS、路由隔离和请求体上限。本次未开启付费计划；账单计划 API 无权限，免费额度消耗未核验。

仍未验证：真机网络切换、真机月亮手势、Tool 写入和提醒的端到端点击。不能用静态构建或桌面 HTTP 结果代替真机结果。（语音输入已下线，不再列入验证范围。）
