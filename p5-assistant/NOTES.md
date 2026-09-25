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
> 未验证：真实部署、生产鉴权、限流、数据库、Android 嵌入、APK 与真机。

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
Android 嵌入、APK 出包、真机行为。**全部逐条列为未验证。**

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
