# P5 进展记录（接手的人从这里开始写）

## 📦 交付物在哪（2026-09-25 起）

**`p5-assistant/n8n/`** —— 完整的 n8n Agent 编排层，**已随本仓库**（不再依赖仓库外的 `t\n8n\`）。

```
p5-assistant/n8n/
├── core/        本机规则引擎（纯 TS，无构建步骤，Node 原生类型擦除直接跑）
├── schemas/     14 个 .schema.json（Layer B v1.1）
├── workflows/   6 个 n8n Workflow JSON
├── tests/       四套测试 + lib/（**不需要 npm install**）
├── tools/       生成器与真实运行/顺序断言工具
├── fixtures/    纯虚构 fixture（无任何真实学生数据）
├── docs/ ops/ prompts/   设计与运维文档
└── credentials/ **空目录**（只允许写凭据名称与用途，永远不放值）
```

**怎么自检**（在 `p5-assistant/n8n/` 下）：

```bash
node tests/run-contract-tests.mjs           # 303
node tests/run-uni-core-tests.mjs           # 405
node tests/run-schedule-adapter-tests.mjs   # 1,221
node tests/run-security-tests.mjs           # 1,057
# 合计 2,986 断言，0 失败，退出码全 0
```

**先读哪几份**：`report.md`（一页结论）→ `docs/task-state.md`（门禁与阶段）→
`docs/open-questions.md`（未决问题）→ `docs/decision-log.md`（为什么这么设计）。

> ### ⚠️ 真源约定（2026-09-25 起，请照此执行）
>
> | | 位置 | 地位 |
> | --- | --- | --- |
> | ✅ **正式交付真源** | `p5-assistant/n8n/` | **纳入 Git**，随分支提交 |
> | 📦 历史工作副本 | `F:\A_LIU_Astrspire\t\n8n\`（仓库外） | **保留**，不随分支提交 |
>
> - **后续修改只在仓库内的 `p5-assistant/n8n/` 进行。**
> - **不再要求两边持续双向同步。**
> - **不删除、不移动、不覆盖历史工作副本。**
> - 工作副本里出现的 `C:\Users\...` 与 `F:\A_LIU_Astrspire\...` 都是**本机历史证据路径**，不属于交付内容。

---

## 现在的状态

- [ ] 还没开工
- [ ] 已跟产品负责人确认：允不允许把**课表明细**发给模型？（默认不允许，只发抽象问题）

## 我要做的东西（一句话）

（例如："Uni 能回答'明天几点上课/这周几节课/二课还差多少分'三类问题"）

## 成本

| 项                 | 估算   |
| ------------------ | ------ |
| 一次问答 token     |        |
| 每千次问答约多少钱 |        |
| 免费额度能撑多少   | <br /> |

## 已知的坑

（每条写清"现象 / 原因 / 怎么绕"）

## 需要主工程配合的地方

（例如：助手入口放哪、要不要在「我的」里加开关 —— **不要自己改 `src/`**，写在这里等整合）

## 接手记录（2026-09-25，P00 总控）

- 执行状态文件在 `F:\A_LIU_Astrspire\t\n8n\docs\`：`task-state.md`（阶段/门禁/待确认项）、`open-questions.md`（未决问题与默认安全行为）、`execution-log.md`（逐阶段收尾记录）。
- **尚未开工**：0 个 Workflow、0 个 schema、0 个提示词；本工作区目前只有上述三份状态文档和空骨架目录。
- 当前门禁：G0 通过；**G1–G5 全部未通过**；LLM 分支保持关闭（E12 未逐字段确认）。
- 已有 `environment-audit.md` 是环境勘察的**主证据**，E1a–E15 已填满；其中 E1c/E2 的管理 API 实测仍为未验证。
- 需要产品负责人裁决的事项见 `open-questions.md`（其中 OQ-03 涉及一个正在运行的 n8n 实例，优先级最高）。

## 接手记录（2026-09-25，P07 / n6 课表 Adapter）

> 上面那条 P00 记录里写的「0 个 Workflow、0 个 schema」是**当时**的事实，不改。
> 现在的实际状态见 `F:\A_LIU_Astrspire\t\n8n\docs\task-state.md`。

**P07 做了什么**：建了课表 Adapter 的 seam（`ScheduleReader`），两个真实实现，五个课表操作端到端可答。
**没有做**：Android 嵌入、APK 出包、任何 `src/`/`android/`/`cloudflare/` 改动。

### 未来 Android 对接点（P07 步骤 7 的要求，写在这里等整合）

**1. 入口**
主工程侧只需要一个东西：`LocalRulesAdapter.ask(input, opts)` → `UniResponse`。
它已经是纯函数（`now` 由调用方注入），无网、无 DOM、无原生依赖，可以直接进 WebView 包。

**2. `context` 怎么构造**
- 课表：**不要**把 `db.ts` 的原始课程行直接塞进去。选一个 `ScheduleReader`：
  - 主工程已产出统一课程对象 → `new StandardCourseReader(courses)`
  - 只有「星期几 + 第几节 + 第几周」→ `new FixtureScheduleReader({ termStart, periods, rows })`，
    其中 `periods` 是**本校节次表**（作息时间），必须由主工程提供，**不要硬编码进助手**。
- 待办：投影成 `TodoSummary[]`（`title` / `dueAt?` / `done`）作为 `LocalAdapterInput.todos`。
  `title` **只在本机**用，出网时由 `buildCapsule` 折叠成计数——这一条已由测试锁住，但接线时别绕过它。
- 学校时区：`LocalAdapterInput.scheduleTimezone`（缺省 = 使用者时区）。
  ⚠️ **Layer A 的 `UniRequest` 里没有这个字段**，需要产品负责人先裁决（**OQ-13**）。

**3. 行动卡确认**
助手只**产出**卡片，不落盘。`operation === 'note.create'` 的卡片自带
`noteDraft` 且 `requiresConfirmation: true`（契约不变量，测试会红）。
落盘必须走主工程既有的 `db.confirm()` + `src/components/ConfirmDialog.vue`
（`AGENTS.md` 第 1 条：禁止再手写 mask 确认层）。**助手这一侧不做任何写入。**

**4. 超时与回落**
比赛 MVP 只有本机链路，没有远端可超时。将来接 `N8nAdapter` 时按
`t/n8n/docs/android-embed-contract.md` 第五节的表：超时 > 12s → 立即回落本机，
`source: 'local_rule'`，**不阻塞 App 其它功能**。断网时完全不调远端。

**5. 体积差值测量（P11）**
必须用**同一构建链的差值**，不许拿"某个包的大小"当增量：

```
增量 = build-apk.ps1(含 UniAssistant) − build-apk.ps1(不含 UniAssistant)
```

唯一正确的出包方式是 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-apk.ps1`。
当前本机规则核心的实测 gzip 是 **9,475 字节 ≈ 9.3 KiB**（三个模块合并，详见
`t/n8n/docs/size-budget.md`）；APK 增量**至今未验证**，P11 之前不得声称达标。

### 一条别踩的坑

`core/` 下的 TS 是**直接被 Node 导入**的（靠原生类型擦除），所以**不能用
`constructor(private readonly x)` 这类 parameter property**——strip-only 擦除器
会直接抛 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。类要显式声明字段。

### 一条口径（别写错）

**「n8n Workflow 结构核对通过，n8n 实例运行尚未验证。」**
`t/n8n/workflows/` 下的 6 个 JSON 从未在 n8n 里执行过（**OQ-12**）。
答辩、README、材料里都不能写成「n8n 跑通了」。

## 接手记录（2026-09-25，P07.1 —— OQ-11/OQ-13 裁决落地）

**做了什么**：按产品负责人裁决，把「这周有几节课」**真的做出来**（原先返回"做不了"），
并把学校时区从用户请求收口到 Adapter 的构造配置。**仍然没有做**：Android 嵌入、APK 出包。

### 三类高频问题现在都能答了

`README.md` 第一节写的那三类问题里，前两类（明天几点上课、这周有几节课）现在
**都由本机规则回答**，不需要模型、断网照常。二课仍然是"做不了"。
—— 意思是：**"本机规则问答"这条路线现在真的覆盖了 README 承诺的范围**，
可以考虑把大模型留给"开放问答"了。但**开不开模型仍由产品负责人决定**（E12/OQ-05 未关闭）。

### 新增的对接点

**1. 周统计（`week_plan`）**
用户问「这周有几节课」时走 `handleWeekPlan`：窗口是**使用者时区**的本周一→周日，
按"连续上课时段"计数（重叠或首尾相接的合并成一次；有课间的分开算）。
**完全在本机，不联网、不读待办。** 你不需要为它做任何事，除非要改口径。

**2. 学校时区怎么传（OQ-13 裁决，2026-09-25）**
**不要往 `UniRequest` 里加字段。** 学校时区属于**学校数据源配置**，
接线时传给 Adapter 的**构造配置**：

```js
new LocalRulesAdapter({
  reader: /* 你选的 ScheduleReader */,
  scheduleTimezone: schoolProfile.timezone,   // 已选学校的签名档案里带的 IANA 时区
})
```

不传时按"学生与学校同时区"处理——**这是安全默认，不是正确默认**：
跨时区学生会整体偏一天（实测偏 12 小时）。所以学校档案里**应该有**这个字段。

**3. 「本周」是按使用者的周，不是按学校的周**
同一瞬间上海学生的"本周"和纽约学生的"本周"是两段不同的绝对时间。
如果产品上想要"按学校的周"，那要改裁决，不是改代码。

### 又踩到一次同样的坑（这次没造成损失）

`t/n8n/tests/roundtrip-check.mjs` 在**开头**会清空目标目录来建干净实例，
而它的**默认目标正好是产品负责人要求保留的那个** `Temp\n8n-iso`。
我在 P07.1 把 `UNIMATE_ISO_N8N` 又指回了 P07 留下的 `n8n-iso-p07` —— **会被清空**，
命令被权限层拦下才发现。**已经用新目录 `n8n-iso-p071` 跑完了。**

> 如果你（或下一个 Agent）要跑这个脚本：**必须指向一个全新的目录**。
> 三个保留目录是 `n8n-iso`、`n8n-iso-p07`、`n8n-iso-p071`，一个都别指。

### 口径（别写错）

**「本机 UniCore 纵向链路已验证；n8n Workflow 结构核对通过，n8n 实例运行尚未验证。」**
P07.1 之后这条**一字未变**——`schedule_week` 路由分支也是只做了结构核对。

## 接手记录（2026-09-25，P08 —— 安全加固，G4）

**做了什么**：给整个 n8n 工作区做安全加固，并为每一类威胁造了**可执行的**拒绝用例。
**没有做**：Android、部署、真实流量。**没有使用任何真实用户数据**（P08 停止条件：需要真数据就停下改用合成 fixture）。

### 两个你接线时会碰到的约束

**1. 日志字段是白名单，且有唯一真源**

`t/n8n/docs/logging-spec.md` 里有一段**机器可读**的字段白名单（8 个字段）。日志节点的输出
必须与之**精确相等**——多一个少一个测试都会红。**要给日志加字段，先改那份文档。**

白名单里**没有** `message`、课程名、教师、记事正文、姓名、学号、token、cookie、预签名 URL……
这不靠自觉：`agent_log` 的表结构里**根本没有承载内容的列**。**加列不是"顺手"能做的事。**

**2. 一次响应最多 12 张卡**

这是 **P08 实测倒逼出来的**：合法输入（一天 300 条课 + 200 条待办）下，`today_plan` 的响应
曾经是 **74,370 字节**，是 §1.4 的 32 KiB 预算的 **2.3 倍**——因为只有简报做了上限。
现在五个 handler 统一走 `capCards()`，最大 2,936 字节。

**注意**：**截断的是列表，不是结论**。答案仍然是「2026-09-30 有 300 节课」，
只是卡片只列 12 张，而且 `explain` 里会写「卡片已截断：共 300 项，只列出前 12 项」。
接 UI 时如果想给用户「看全部」的入口，需要自己再取一次——**别把 count 当成卡片数**。

### 一条口径（**P08 之后仍然一字未改**）

**「本机 UniCore 纵向链路已验证；n8n Workflow 结构核对通过，n8n 实例运行尚未验证。」**

P08 加固的 `agent_gateway` 预检节点、`agent_observability` 日志节点，**同样只在 Node 里被 `new Function` 跑过**，
**没有在 n8n 实例里执行过**。`ops/security-checklist.md` 里有一条断言专门防止这些字样被写进矩阵。

### 一个必须知道的口径细节

**不许写「agent_log 全表扫描为空」**——比赛版**没有部署这张表**。
能说的是：日志节点输出与白名单**精确一致**，且表结构里**没有内容列**。
这两条是"扫描为空"的**结构性前提**，不是它本身。

## 接手记录（2026-09-25，P11 —— 真实 n8n 运行验证 + 最终验收）

**这一轮最重要的事**：在隔离 n8n 实例里**真的把 6 个 Workflow 跑了一遍**。
结果不是"通过了"，而是**抓出 7 个只有跑起来才会暴露的缺陷**——
在此之前，结构往返核对、路由一致性、`new Function` 行为等价**三层验证全是绿的**。

### 口径已更新（**取代之前所有版本**）

**旧**：「本机 UniCore 纵向链路已验证；n8n Workflow 结构核对通过，**n8n 实例运行尚未验证**。」

**新（照抄）**：
> **本机 UniCore 与隔离 n8n 实例运行均已验证。**
> 未验证：真实部署、生产鉴权、限流、数据库、APK 真机安装与交互。

**最终门禁**：
> **P11 比赛交付验收通过；G5 完整验收未通过，保留部署与真机验证项。**

### 你接线时要知道的三件事

**1. `active: false` 是仓库产物的状态，实例里必须先发布**

n8n 的 `executeWorkflow` **只能调用已发布的工作流**。仓库里的 JSON 刻意保持 `active:false`（未部署），
所以起实例后要先 `n8n publish:workflow --id unimate-*`（6 个都发）。**这不是 bug，是部署步骤。**

**2. 子流程引用的是**稳定 id**，不是名字**

每份 Workflow JSON 都带一个 `id`（如 `unimate-agent-intent-router`），
`Route To Router` 引用的是**同一个 id**。改名字不会破坏引用；**改 id 会**。

**3. 改完 Workflow 一定要真的跑一次**

复现手册在 `t/n8n/ops/p11-runtime-runbook.md`。**单测全绿不代表链路能跑**——
P11 的 7 个缺陷里，有两个的症状是 **HTTP 200 + 空响应体**，单测永远看不到。

### 仍未验证（**不要写成通过**）

生产部署、生产鉴权、限流、真实数据库、Cloudflare Worker 网关那一段、
Android 嵌入与 APK 静态出包已于 2026-09-26 由主工程完成；线上 n8n/LLM、生产部署与真机行为仍逐条列为未验证。

### 2026-09-26 主工程 Android 接线结果

- 新增独立底部页签 `Uni`，直接复用本目录 `core/` 的 `LocalRulesAdapter` 与 `FixtureScheduleReader`。
- 主工程只向规则层投影当前活动课表和未删除记事摘要；问答过程无 `fetch`、无模型、无 n8n 请求。
- 已接能力：下一节、今日/明日安排、本周课程统计、空档、冲突、每日简报、一句话记事草稿。
- `note.create` 仍先产草稿，落盘前走主工程统一 `db.confirm()`；`open.schedule` 只负责跳转课表。
- `test:uni` 17/17；主工程完整 24 套件 966/966；APK 6.69 MiB，SHA-256 `95348995651173C6A5A5C9D2C69466549414280EFEBE9B10D5F757F70DF2DE8D`。
- APK 内反查到 `Uni 本机助手`、`离线可用`、`这周有几节课`、`当前版本不连接大模型`。**未做真机安装与点击验证。**

### 2026-09-26 v2.61 主工程双模式 Agent 接线结果

- 主工程在 v2.60 本机规则外新增 `AgentCore`、`AgentPlanner`、独立 Tool Layer、`StudentAgentPort` 和 Voice seam，没有复制或替换本目录的规则核心。
- Online：Android → 现有 Cloudflare Worker → DeepSeek Function Calling → Android Tool；模型不访问数据库，Key 只放 Worker secret。
- Offline：断网或网关失败时由 `LocalRulePlanner` 生成同一种结构化 Tool Call；网络恢复后的下一次请求重试在线。
- 当前 Tool：课表、记事查询/新增、提醒、天气缓存、页面跳转；高风险框架统一接 `db.confirm()`，当前不暴露删除 Tool。
- `test:agent` 23/23、`test:uni` 19/19；主工程完整 25 套件 991/991；Vite、Capacitor、Gradle、签名与 bundle 一致性已验证。
- **仍未验证**：Worker/Pages 重新部署、真实 DeepSeek 请求、Android 真机网络切换、月亮短按/长按、ASR/TTS 和 Tool 写入端到端交互。

### 2026-09-26 DeepSeek 蒸馏小模型临时服务器原型

- 新增 [`local-server-prototype/`](local-server-prototype/README.md)，明确标记 `PROTOTYPE ONLY`，不属于生产服务。
- 网关只用 Node 内置模块，无新增依赖、无持久化、无数据库访问；兼容主工程 `/v1/agent/chat` 的 `message` / `tool_call` 契约。
- 已用内置 mock 模式验证：`/health`、普通聊天、结构化 `getSchedule`、APK 来源 CORS、非白名单来源 403；运行进程已停止。
- 已取得产品负责人对约 1.12 GB 模型和官方 llama.cpp 运行包的明确下载同意；所有可控写入均在 F 盘。
- 已下载并校验 `unsloth` 对 DeepSeek 官方 `DeepSeek-R1-Distill-Qwen-1.5B` 的 Q4_K_M GGUF：`1,117,321,312` 字节，SHA-256 `f3bdf9cf31dee4b57ae4e455a1cb0d01b5c2c1b50d72d3112141c195506c2840`，与 ModelScope `X-Linked-ETag` 一致。它是第三方量化，不能写成 DeepSeek 官方 GGUF。
- 已下载并解压 ggml-org 官方 llama.cpp v0.5.0 配套构建 `b11146` Windows x64 CPU 包；ZIP `18,560,055` 字节，SHA-256 `14cf1303ca9ac3abd94816850532f9f9a69ac66fbaca3776fc6f9061c2fac1d1`。
- 真实 CPU 推理已验证：模型约 1.6 秒加载；普通聊天约 6.1 秒，三轮上下文约 8.8 秒，日志约 27–39 token/s。
- 纯 1.5B LLM Tool Calling **不通过**：出现 tomorrow→today、addNote→openFeature、`arguments` 字符串化、未授权名称等错误；白名单/参数校验均能拒绝危险结果，未为追求通过而放宽校验。
- 默认调整为诚实可用的 `hybrid`：明确的课表/记事/天气/页面命令由服务器轻量规则生成结构化 Tool Call，其他内容由蒸馏模型聊天。最终四个虚构 Tool 场景的结果均正确，规则路径约 1 ms；不提供 Tool 白名单时不会返回 Tool Call。细节见 [`local-server-prototype/RESULTS.md`](local-server-prototype/RESULTS.md)。
- `cloudflared 2026.9.3` 已从官方 GitHub Release 下载到 F 盘并校验；Quick Tunnel 创建接口连续两次超时，未取得公网 URL。已增加不持久化的局域网聊天页并验证本机/LAN 地址 HTTP 200 与同源 Tool Call；Android 真机、手机实际访问、语音与真实 Tool 端到端仍未验证。
- 当时的主工程配合项（2026-09-26 尚未完成）：新增独立 `VITE_AGENT_API_BASE` 给 `HttpAIProvider`，不要把临时模型地址写进 `VITE_SYNC_API_BASE`，否则会同时破坏账号与备份 API。依照 P5 工位红线，当轮未直接修改 `src/`。
- 模型和运行时保留在 `F:\A_LIU_Astrspire\A_downloads\UnimateUL\` 与 `F:\A_LIU_Astrspire\A_runtime\UnimateUL\`，没有擅自清理；任何删除仍需二次确认。

### 隔离目录

现在有 **9 个**，**全部保留**（`unimate-n8n-iso-p11-runtime-20260925` 是**破损态证据**，别删）：
`n8n-iso`、`-p07`、`-p071`、`-p08`、`unimate-n8n-iso-p11-runtime-20260925`、
`unimate-n8n-iso-p11-runtime2-20260925`、`unimate-n8n-iso-p11-roundtrip-20260925`、
**`unimate-n8n-iso-p09-20260925`**、**`unimate-n8n-iso-p09-roundtrip-20260925`**（后两个是 P09 复跑）。
准确清单以 `n8n/docs/open-questions.md` 的 `RESERVED-ISO-DIRS` 块为准（守卫直接读它）。
`tests/roundtrip-check.mjs` 有路径守卫（不许删、不许复用、不许指向保留目录），
**删除任何目录都需要产品负责人二次确认**。

---

## 接手记录（2026-09-25，P09 —— 可观测性，比赛范围内的部分）

### 你接线时会碰到的一件事：网关多了两个节点

`agent_gateway` 从 6 节点变成 **8 节点**，链路是：

```
Agent Webhook → Precheck Payload → Precheck OK? ─┬─(true)→ Route To Router → Shape Response
                                                 └─(false)──────────────────↗
Shape Response → Build Log Input → Log Request → Respond
```

**对 Android 侧是零影响**：请求体、响应体（仍是 §6.2 那 8 个字段）、错误码**一个都没变**。
变化的只是 n8n 内部多写了一条脱敏日志。

### 一条你可能会踩的口径（写出来免得再踩一次）

**`Respond` 的响应体不能读 `$json`。** 它排在 `Log Request` 之后，那时的 `$json` 是
**观测工作流产出的日志行**——读它等于把日志字段发给客户端。现在是
`={{ $('Shape Response').first().json }}`。**改这个节点前先看 `t/n8n/docs/observability.md` §4。**

### 这条链路是**实测**出来的，不是设计出来的

第一版写成"`Shape Response` 分叉喂两个节点"，**结构核对、单测、往返核对全绿**，
隔离实例一跑才发现执行顺序是 `Respond` 先、日志后——与 §4.11「响应返回前记录」相反。
**把分叉数组顺序倒过来也没用**。最后改成串接才确定下来。
所以：**改了 Workflow 就跑一次真实实例**（`t/n8n/ops/p11-runtime-runbook.md`），别推理。

### 新增的两个可执行工具（都在 `t/n8n/tools/`）

| 工具 | 作用 | 什么时候跑 |
| --- | --- | --- |
| `p11-runtime-check.mjs` | 隔离实例上打 16 个场景 + 20 次一致性 | 改了 Workflow 之后 |
| `check-log-order.mjs` | 从 **n8n 执行数据**里断言「记录先于应答」 | 同上，紧跟在前一个之后 |

## 接手记录（2026-09-25，四项裁决落地）

### 你只要记住这四条口径

| # | 裁决 | 对你的影响 |
| --- | --- | --- |
| 1 | **比赛版不单设第七个 Workflow** | 错误处理继续用现有 6 个 Workflow 内的**统一 Error Envelope**。独立 `agent_error_handler` 列为**部署阶段可重新评估项**。**不得宣称生产日志持久化 / 告警 / 故障恢复已验证** |
| 2 | **9 个隔离目录全部保留** | 本次无删除授权。**也不要为了"整理目录"再跑往返核对造新副本** |
| 3 | **比赛交付范围内正式关闭 LLM** | **不配置模型 Key**，不向模型发送课表/姓名/成绩/胶囊。**未来启用必须作为新版本重新评审**（用户明确同意 + 数据最小化 + 服务端 Secret + 「关于」页如实披露） |
| 4 | **截断时暂不生成"查看全部"卡** | `MAX_CARDS = 12` 不变，`open.schedule` 路径不变。**当前不得宣称"查看全部交互已实现"**——没有界面能消费它 |

### 顺带修到的一样东西（你接线时会用到）

G1 门禁判据里有一条是「`prompts/data-boundary.md` 与实现一致」。核对时发现**这条从来没人盯**，
而**文档已经漂了**——它还写着 `periodLabel`（"第3-4节"）和记事标题**可以出网**，
而实现早在 P02.1 就把它们剥掉了。

已重写为 **v2.0**，并新增 **K 组**断言：文档里的机器可读块与 `request.schema.json`
**逐字段精确比对**，多一个少一个都报红。**所以你接线时以 `data-boundary.md` §2.1 那张表为准**——
那是有断言钉着的。

### P09 新增但**未验证**的（别写成通过）

- **`agent_error_handler` 没建**：它会是第 7 个 Workflow，与"比赛版最多 6 个"冲突（见 `t/n8n/docs/open-questions.md` **OQ-16**）。
- **告警一条都没接**：`t/n8n/ops/alerts.md` 把 §9.3 八条逐条标注了"能否落地"，结论是**零条**可在比赛环境触发。
- rollup / 日报未实现；`agent_log` 表未部署；故障注入未做。
- `latency_ms` / `input_length` 在本机网关**取不到，恒为 `null`**（不是 bug，是数据边界的结果；补法记账在 `observability.md` §4.3）。
- **延迟 / 命中率 / 成本一个数字都没有**——没有真实流量，不填。

## 接手记录（2026-09-27，本地模型快速路由 + 记事确认）

- `local-server-prototype/server.mjs` 已把问候、致谢、能力询问和待办确认前移到 `hybrid` 本地规则；这些路径不调用模型。
- 待办流程改为两轮：先问“是否加入记事本”，用户肯定后才返回 `addNote` Tool Call，否定则取消；原型服务仍不直接写数据库。
- 本机 8787 实测：问候 36.4 ms、待办询问 3.6 ms、确认 Tool Call 5.5 ms。开放式模型回答仍受 CPU 推理限制，约 6～13 秒。
- `--reasoning off --reasoning-budget 0` 对当前蒸馏模型无有效提速；现有 CPU 包 `--list-devices` 为 `(none)`，未下载或冒充 GPU 后端。
- 主工程已把同一确认状态机移植到 `src/services/uniTools.ts` 的 `LocalRulePlanner`：“帮我记一下”和带时间的待办先询问，明确肯定后才生成 `addNote` / `createReminder` Tool Call；取消、重复确认均不写入。
- 主工程已新增独立 `VITE_AGENT_API_BASE`，且 `VITE_SYNC_API_BASE` 继续只用于账号与备份；`UniView` 把本机 Planner 作为快速优先路径交给 `AgentCore`。
- 完整接入步骤：`local-server-prototype/APK_INTEGRATION.md`。
- 已验证：原型网关逻辑和本机 HTTP、主工程移植、`test:agent` 31/31、完整 26 套件 1002/1002、Vite/Capacitor/Gradle/签名/bundle 一致性与 APK 字符串反查；产物 6.70 MiB，SHA-256 `842DCFB6355B2872BC0EF394B8E8DE4D53F251EA2A2681EA6972F90C8190B1A4`。未验证：HTTPS 公网地址与 Android 真机交互。
