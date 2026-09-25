# 数据边界说明

版本：**2.0**（P09 —— 按 2026-09-25 裁决重写，落实 G1 判据）
日期：2026-09-25
真源：主规划（当前版本，见 `open-questions.md` OQ-01）§1.4、§6.1、§8.3、§8.5、附录 C.3；
`AGENTS.md` 第 5/7 条；**产品负责人 2026-09-25 关于 OQ-05 / E12 的裁决**。

> **v1.0 → v2.0 改了什么（为什么必须改）**
> v1.0 写于 P02，当时 OQ-09 还没关闭。它在"允许进入远端请求的"里写着
> `BusySlot：date / start / end / periodLabel` 和 `TodoSummary：title / dueAt / done`——
> **这两条与 P02.1 冻结后的实现直接矛盾**：`periodLabel` 与 `title` 现在**都不出网**。
> 一份"与实现不一致的数据边界文档"本身就是 G1 的未满足判据，所以本次按实现重写，
> 并加了机器可读块让测试盯着它（见 §三）。

---

## 一 当前事实（**以这一节为准**）

> ### 模型链路：**关闭**。这是比赛版的**正式裁决**，不是临时状态。
>
> **不配置模型 Key，不创建模型节点与模型凭据，不向任何模型发送课表、姓名、成绩或数据胶囊。**

依据（产品负责人 2026-09-25 裁决，OQ-05 已按此关闭）：

| 项 | 状态 |
| --- | --- |
| **E12**（哪些本机数据允许进入 n8n 与模型） | **比赛范围内关闭**：不进模型，因此不需要逐字段授权模型侧数据 |
| **OQ-05** | **已关闭**（口径：比赛交付范围内 LLM 分支保持关闭） |
| LLM 分支 | **关闭**。`llmUsed` 全程 `false` |
| 比赛版助手 | **只使用本机确定性 UniCore**，不调用远端模型 |
| 未来启用 LLM | **必须作为新版本重新评审**，至少包含：用户明确同意、数据最小化、服务端 Secret、「关于」页如实披露 |

**这不是"暂时这样"的临时状态，是当前的实现事实。** 任何文档、界面文案或答辩材料**不得**声称 Uni 具备模型能力。依据 `AGENTS.md` 第 7 条：**UI 文案必须与实现一致**，写了自己做不到的功能算事故。

**结构性保证**：`tests/run-schedule-adapter-tests.mjs` 的 **G-5** 扫描全部 6 个 Workflow，
断言**不含** `@n8n/n8n-nodes-langchain` / `httpRequest` / `redis` / `postgres` 节点，且 `active === false`。
"不接模型"不是承诺，是**被断言钉住的**。

---

## 二 出网数据边界（Layer B —— 6 个 Workflow 会收到的）

模型关闭**不等于**没有数据出本机：比赛 MVP 的请求会到 n8n。边界按 §1.4 创新点 2 与 §6.1 处理。

### 2.1 机器可读的**完整**允许清单（**唯一真源**）

下面这一段是**机器可读**的：安全套件的 **K 组**会把它读出来，与
`schemas/request.schema.json` 里实际存在的字段**逐项比对**——**多一个少一个都报红**。
所以"文档与实现一致"不是一句自述，是一条断言。

```text
<!-- REMOTE-USER-DATA-BEGIN -->
message
contextCapsule.projectionVersion
contextCapsule.purpose
contextCapsule.window.startAt
contextCapsule.window.endAt
contextCapsule.busySlots[].startAt
contextCapsule.busySlots[].endAt
contextCapsule.todoStatus.pendingCount
contextCapsule.todoStatus.nextDueAt
<!-- REMOTE-USER-DATA-END -->
```

逐条解释：

| 字段 | 是什么 | 为什么允许 |
| --- | --- | --- |
| `message` | **用户原话**，≤ 500 字 | §6.1：它**只**承载用户原话，不塞胶囊 JSON |
| `contextCapsule.projectionVersion` | 投影版本号（常量 `"1"`） | 协议字段，无内容 |
| `contextCapsule.purpose` | `availability` / `conflict` / `brief` | 封闭枚举，说明这次要干什么 |
| `contextCapsule.window.startAt` / `.endAt` | 查询窗口（带偏移的绝对时刻） | 回答"周几下午"必需 |
| `contextCapsule.busySlots[].startAt` / `.endAt` | **忙闲段，只有起止时刻** | 回答空档/冲突必需；**课程名、教师、教室在 schema 层就被拒** |
| `contextCapsule.todoStatus.pendingCount` | 未完成待办**条数** | 只给数量，不给任何一条的内容 |
| `contextCapsule.todoStatus.nextDueAt` | 最近的截止时刻 | 同上，是个时刻，不是标题 |

**上界**：`busySlots` 最多 **20** 条（§6.1）。

### 2.2 ❌ 禁止出网的（与上表互为补集）

| 类别 | 具体 | 结构性保证 |
| --- | --- | --- |
| **课程名 / 教师 / 教室** | `BusySlot.title` / `.location` | 在本机使用；**投影时剥离**，且胶囊 schema `additionalProperties: false` |
| **节次标签** | `periodLabel`（"第3-4节"） | **同样剥离**。远端只需要知道"这段时间被占了" |
| **记事标题与正文** | `TodoSummary.title`、任何 `content` | `todoSummary` **折叠成计数**，标题一个字符都不出网 |
| **身份** | 姓名、学号、账号、登录凭据 | `AGENTS.md` 第 3 条 |
| **二课明细** | `records` 逐条内容 | §1.4 已移出 MVP |
| **成绩 / GPA** | — | 产品口径：**默认不得发送给 n8n 或模型**（PRD v2.59） |
| **照片** | 任何形式（含 data URL） | §1.4：照片永不进入 Agent 请求 |

### 2.3 `userId` 与 `idempotencyKey` 的地位

- **`userId`：客户端不填。** 它由 `agent_gateway` 从 token 解析后注入；比赛 MVP 没有鉴权链路，
  所以它**不出现在实际请求里**。传数组/对象/null 会被预检拒（§13.6 #4，G 组 13 类污染用例覆盖）。
- **`idempotencyKey`：仅写操作填。** 比赛 MVP 没有真实落库，写操作只产行动卡。

### 2.4 三道防线（不靠自觉）

| 防线 | 实现 | 位置 |
| --- | --- | --- |
| **投影函数剥离** | `capsule.projectionStripped` 不变量 | `tests/lib/invariants.mjs`，用例 `x-09` / `x-10` |
| **schema 封闭** | `additionalProperties: false` **逐层** | `request.schema.json` 的 `contextCapsule` / `CapsuleBusySlot` / `todoStatus` |
| **白名单精确性** | 断言胶囊字段集合**恰好**是那 5 项 | `run-contract-tests.mjs` 的 **D-9** |
| **本文档与 schema 一致**（P09 新增） | K 组把 §2.1 的块与 schema 逐项比对 | `run-security-tests.mjs` 的 **K 组** |

第三道是**变异验证逼出来的**：原本把 `title` 加进胶囊忙闲段的白名单，303 条测试一度全绿。
逐字段补反例是打地鼠；**精确集合断言**才是数据边界该有的最后一道防线。
第四道是 P09 补的——因为这次发现**文档自己会漂移**。

---

## 三 日志边界

**绝对不写日志**：密码、token、cookie、完整记事正文、课表明细、姓名、学号、照片路径、模型原始响应全文。

**可以写**：`request_id`、`intent`、`latency_ms`、`error_code`、`success`、`env`、`input_length`、`payload_bytes`
（**长度可以，内容不行**）。

字段白名单的**唯一真源**是 `docs/logging-spec.md`，不在这里重复定义。
**结构性保证**：`agent_log` 表**刻意没有 `message` 列**（§7.5）。表结构比纪律可靠。

---

## 四 未决与未验证（**不要写成通过**）

| # | 事项 | 状态 |
| --- | --- | --- |
| **界面文案** | G1 判据里的"含界面文案"。**本工位没有 UI** —— Android 未嵌入，`src/` 不归本工位改 | ⚠️ **未验证**：`§五` 那段候选文案的实际落地属主工程，本工位无法验证 |
| **`agent_log` 表** | 未部署 | ❌ 未验证：能说的是"表结构无内容列"，**不是**"全表扫描为空" |
| **生产日志持久化 / 告警 / 故障恢复** | 未部署、未接 | ❌ **均未验证**，不得宣称 |
| **E9 模型选型** | 未验证 | 比赛版不需要；启用 LLM 时是前置 |
| **学校档案下发时区**（OQ-13 遗留） | 未验证 | Android 接线的事 |

---

## 五 候选界面文案（**给主工程用，本工位没有 UI**）

> **Uni 现在不连大模型。** 比赛版全程由本机的确定性规则回答——下一节课、今日安排、本周课程次数、
> 空档、冲突、每日简报，都不用联网，也不用模型。
>
> **向 Uni Agent 发起云端请求时**，只发送你的问题和完成本次回答所需的**最小时间摘要**。
> 课程名、教师、教室、节次标签、记事标题和正文、姓名与学号**不会进入 Agent 请求**。
> **账号备份与同步是独立功能**，按你选择的云端模式处理。

**⚠️ 三条必须一并保留的限定**（少一条这段文案就会变成虚假能力）：

1. **这是候选文案**，本工位**没有 UI**——它还没有出现在任何界面上。
2. **尚未完成 Android 真机验证**，也尚未经 `AGENTS.md` 第 7 条要求的"文案 ↔ 实现"核对（那要在主工程落地后做）。
3. **不得用这段话否定账号托管模式的数据上传事实。**
   第二段的主语是**"向 Uni Agent 发起云端请求时"**，作用域**仅限 Agent 链路**。
   账号登录模式下课表、记事与二课材料会备份到云端且**服务端可读**（`AGENTS.md` 第 5 条）——
   那是另一条链路，**不受本段约束，也不被本段否认**。

**为什么原来那句是错的（留作记录）**：v2.0 初稿写的是"**出这台手机的只有**你的原话和结构摘要"——
那是一个**全局承诺**，会把账号云同步也一起说成"不出网"，与主产品口径直接冲突。
数据边界的承诺**必须带作用域**，否则它保护不了任何人，只会误导用户。

**这段话必须与实现一致。改了实现就要改这段文案，改了文案也要回头改实现——两边任何一边单独改动都算事故**（`AGENTS.md` 第 7 条）。
