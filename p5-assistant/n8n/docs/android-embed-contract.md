# Android 嵌入契约（Layer A ↔ Layer B）

版本：**1.1**（P02.1 契约小版本修订，关闭 OQ-09/OQ-10）
日期：2026-09-25
真源：主规划（**当前版本**）§1.4、§4.1 Version Check、§6.1、§6.2、§三 D3/D5。**本文件不修改 `src/`、`android/`、`cloudflare/`**；需要主工程配合的只写 `p5-assistant/NOTES.md`。

> 版本号不写死在这里：主规划会继续升版（本文成文时是 v2.3.2，P11 时已是 v2.3.7）。
> 当前版本与哈希的唯一真源是 `docs/open-questions.md` 的 **OQ-01**。

> **主工程接线状态（2026-09-26）**：第七节的本机接线事项已经由产品负责人整合完成，APK 静态出包与包内反查通过；本文件其余“本轮不做 Android”的表述是 P02.1 当时的历史范围。线上 `N8nAdapter` 与真机交互仍未验证。

---

## 一 两层结构

| | **Layer A** | **Layer B** |
| --- | --- | --- |
| 是什么 | App 内部 Interface | n8n 线上契约 |
| 真源 | 主规划 §1.4 | 主规划 §6.1 / §6.2 |
| Schema | `uni-assistant-bridge.schema.json` | `request.schema.json` / `response.schema.json`，**schemaVersion 1.1** |
| 谁认识它 | Android、`LocalRulesAdapter`、`N8nAdapter` | `agent_gateway`、n8n 全部工作流 |
| 字段风格 | 产品语义（`answer` / `source` / `cards` / `explain`） | 传输语义（`success` / `intent` / `data` / `errorCode`） |

**投影责任方：`N8nAdapter`**。两个 Layer 的字段**绝不互相泄漏**。

**版本号**：Layer B 是 **1.1**；`tool.*.schema.json` 继续独立使用各自的 **1.0**——它们与线上 envelope 是两套契约，不共用版本号。旧 1.0 线上请求被 `Version Check` 拒绝为 `E_VERSION_UNSUPPORTED`(426)。

唯一 Interface（§1.4）：

```ts
interface UniAssistant {
  ask(request: UniRequest): Promise<UniResponse>
}
```

两个真实 Adapter 才让 seam 成立：`LocalRulesAdapter`（纯 TypeScript、无原生依赖、断网可用）与 `N8nAdapter`（只收最小数据胶囊、有超时、失败立即回落）。

---

## 二 出站映射：Layer A → Layer B

| Layer A 字段 | Layer B 字段 | 规则 |
| --- | --- | --- |
| `text` | `message` | 原样。长度上界都是 500。**始终只放用户原话**——不把胶囊 JSON 塞进 message（§6.1 明令） |
| `now` | `timestamp` | 原样（ISO-8601 带偏移） |
| `timezone` | `timezone` | 原样。**不许**改写或替换成服务器时区 |
| `context` | `contextCapsule` | **不是原样复制**。按下面第四节剥离后生成；远端不需要上下文时**整个字段不发** |
| — | `schemaVersion` | 适配器填 `"1.1"` |
| — | `requestId` | 适配器生成 UUID v4 |
| — | `inputType` | 比赛 MVP 固定 `"text"`（无语音） |
| — | `clientVersion` | 适配器填 App 版本 |
| — | `userId` | **不填**。由 `agent_gateway` 从 token 解析后注入 |
| — | `idempotencyKey` | 仅写操作填，由适配器生成 UUID |
| — | `sessionId` | 适配器生成并持久化（**不是** `'default'`） |

---

## 三 入站映射：Layer B → Layer A

| Layer B | Layer A | 规则 |
| --- | --- | --- |
| `success` + `errorCode` | 决定 `answer` 是正常回答还是降级提示 | 见下方 source 推导 |
| `intent` | **`source` 的推导依据** | 见下 |
| `data.answer` | `answer` | 正常路径 |
| `data.cards` | `cards` | 逐字段同形；`operation` 与 `requiresConfirmation` 必须原样保留 |
| `data.explain` | `explain` | 逐项同形 |
| `messageForUser` | `answer`（降级路径） | 当 `success:false` 或 `errorCode` 为降级类时 |
| `retryable` | **不进 Layer A** | 适配器内部据此决定要不要退避重试；用户看不到这个概念 |
| `requestId` | `requestId` 原样透传 | — |
| — | `offlineCapable` | **由适配器判断**：本次回答若本机规则也能给出 → `true` |

### `source` 的推导规则

```
source =
  ├─ 本机 LocalRulesAdapter 直接回答            → 'local_rule'
  ├─ 走了 n8n 且 errorCode ∈ {E_UNSUPPORTED,
  │   E_LLM_UNAVAILABLE}（远端也答不了，
  │   最终靠本机规则兜住）                       → 'local_rule'
  ├─ 走了 n8n 且 success === true               → 'n8n_rule'
  └─ 走了模型（E12 确认后才可能存在）            → 'llm_fallback'
```

**比赛 MVP 不可能出现 `llm_fallback`**：E12 未逐字段确认前 LLM 分支保持关闭。这个枚举值存在，但当前是死分支——**文案不得宣称模型能力**（`AGENTS.md` 第 7 条）。

---

## 四 胶囊投影规则（OQ-09 的落实）

**这条是 P02.1 的核心。** `UniRequest.context` 与线上的 `contextCapsule` **不是同一个东西**——中间必须经过一次**剥离**。

### 4.1 逐字段映射

| Layer A（本机） | Layer B（线上） | 动作 |
| --- | --- | --- |
| `context.schedule[].startAt` | `busySlots[].startAt` | **保留** |
| `context.schedule[].endAt` | `busySlots[].endAt` | **保留** |
| `context.schedule[].title` | — | **剥离**（课程名不上网） |
| `context.schedule[].location` | — | **剥离**（教室不上网） |
| `context.schedule[].periodLabel` | — | **剥离**（节次标签不上网） |
| `context.todoSummary[]` | `todoStatus` | **折叠**成统计：`pendingCount` = `done === false` 的条数；`nextDueAt` = 未完成项里最早的 `dueAt` |
| `context.todoSummary[].title` | — | **剥离**（记事标题不上网） |
| — | `projectionVersion` | 适配器填 `"1"` |
| — | `purpose` | 由本次请求的能力决定：空档查询 `availability` / 冲突检测 `conflict` / 每日简报 `brief` |
| — | `window` | 由查询意图得出（如"周三下午"→ 13:00–18:00），**不是**整份课表的跨度 |

### 4.2 两条硬规则

1. **`title` / `location` / `periodLabel` 只在本机使用。** 它们存在的意义是让本机回答"下一节什么课、在哪"（§1.4）；一旦出网就违反创新点 2。
2. **`TodoSummary` 不整条上网，只折叠成计数。** §1.4 明写：E12 未确认时，线上胶囊不得携带标题或正文，**只能携带数量与最近截止时间**。

### 4.3 三道防线（不靠自觉）

| 防线 | 实现 | 位置 |
| --- | --- | --- |
| 投影函数剥离 | `capsule.projectionStripped` 不变量 | `tests/lib/invariants.mjs`，用例 `x-09` / `x-10` |
| schema 封闭 | `additionalProperties: false` 逐层 | `request.schema.json` 的 `contextCapsule` / `CapsuleBusySlot` / `todoStatus` |
| **白名单精确性** | 断言 capsule 的字段集合**恰好**是那 5 个 | `tests/run-contract-tests.mjs` 的 D-9 |

第三道是**变异验证逼出来的**：原本把 `title` 加进胶囊忙闲段的白名单，303 条测试一度全绿。逐字段补反例是打地鼠；**精确集合断言**才是数据边界该有的最后一道防线。

---

## 五 超时与回落语义

| 场景 | Layer A 的表现 |
| --- | --- |
| `N8nAdapter` 超时（> 12s 客户端总预算，§10.2） | **立即回落 `LocalRulesAdapter`**，`source: 'local_rule'`，`offlineCapable: true`。**不阻塞 App 其它功能** |
| n8n 返回 `E_LLM_UNAVAILABLE` | 同上回落，`answer` 用 `messageForUser` |
| n8n 返回 `E_UNSUPPORTED` | 回落本机规则；本机也答不了 → 如实说答不了 |
| n8n 返回 `E_VERSION_UNSUPPORTED` | 说明线上已升版而 App 未升级 → 提示用户升级，**不静默降级** |
| 断网 | **完全不调 `N8nAdapter`**，直接走本机规则 |
| n8n 返回非 JSON（默认错误页） | 按 `E_INTERNAL` 处理并回落；同时属于 §4.1 节点 9 没兜住，应报 bug |

**核心承诺**：断网时"下一节 / 今日安排 / 空档 / 简报"仍可答（§1.4 MVP 验收）。**永不允许白屏或永久加载**。

---

## 六 本轮不做什么

- **不改 `src/`、`android/`、`cloudflare/`**（`AGENTS.md` 第 14 条）。
- **不做 Android 嵌入、不出 APK**（§1.4：本轮只冻结 Interface、DTO、错误码和体积预算测试方法）。
- **不实现 UI**。写入确认由主工程既有 `db.confirm` + `ConfirmDialog.vue` 承担（`AGENTS.md` 第 1 条）。
- **不声称真机已验证**。真机项一律写未验证。

---

## 七 需要主工程配合的事项（写进 `p5-assistant/NOTES.md`，不在这里实现）

1. **`UniAssistant` 的挂载点与入口位置** —— 由产品负责人决定。
2. **`context` 的组装与投影** —— 从 `src/stores/db.ts` 的 `timetables/courses` 与 `notes` 投影出 `BusySlot` / `TodoSummary`；**投影到线上时要按第四节剥离**。组装函数住在本机侧，不归 n8n。
3. **写入确认的落盘动作** —— 比赛 MVP 里 `notes.create` 只产出行动卡（`operation: 'note.create'` + `noteDraft` + `requiresConfirmation: true`）；真正落盘要等主工程接入层用统一 `ConfirmDialog` 决定（§十一 n3）。
4. **把主工程的课表喂进 seam**（P07 新增）—— 需要一个 `ScheduleReader` 实现（见第八节）。主工程自带的解析器若已产出统一 `Course`，直接用 `StandardCourseReader`；若产出的是「星期几 + 第几节 + 第几周」，用 `FixtureScheduleReader` 并传入本校**节次表**。
5. **学校时区从哪里来**（P07 新增，**OQ-13 已于 P07.1 裁决关闭**）—— **不扩 Layer A**。学校时区**属于学校数据源配置**，由**已选学校的签名档案 / Adapter 配置**提供 IANA timezone，接线时传给 `LocalRulesAdapter` 的**构造配置**（`LocalRulesAdapterConfig.scheduleTimezone`），**不要**塞进 `UniRequest`。未取得时按「假定学生与学校同时区」的安全默认走。

---

## 八 `ScheduleReader`：学校差异的落点（P07）

§1.4 创新点 4 要求「学校差异留在 Adapter，换学校不改助手核心」。P07 把这个 seam 落成了代码。

```
主工程课表来源 ──► ScheduleReader 实现 ──► BusySlot[] ──► UniCore ──► UniResponse
   （学校形态）       （学校差异全在这）      （统一）      （学校无关）
```

### 8.1 接口（`core/schedule-reader.ts`）

```ts
interface ScheduleReader {
  readonly id: string
  read(q: ScheduleQuery): ScheduleReadResult      // 不抛异常；非法输入丢弃并计数
}
interface ScheduleQuery {
  timezone: string              // 使用者时区；from/to 是这个时区的日期
  scheduleTimezone?: string     // 课表用哪个时区表达（学校当地）。缺省 = timezone
  from: string                  // YYYY-MM-DD，含
  to: string
}
interface ScheduleReadResult { readerId: string; busySlots: BusySlot[]; dropped: number }
```

**这个接口里没有、也不可能有**：学校名、教务字段、选择器、Cookie、密码、HTML。学校特有的东西全部在实现里，而实现只吃**已结构化**的输入。

### 8.2 两个真实实现（"两个才算 seam"）

| 实现 | `id` | 输入端 | 它证明了什么 |
| --- | --- | --- | --- |
| `StandardCourseReader` | `standard-course` | 统一 `Course[]`（主工程已解析好的） | seam 接受统一对象，没有第二套字段 |
| `FixtureScheduleReader` | `fixture-period` | 学校形态：节次表 + 「星期几 / 第几节 / 第几周 / 单双周」的行 | 学校差异**真的需要不同的代码**，不是空想出来的抽象 |
| `NullScheduleReader` | `null` | 无 | 显式空实现；也用来证明"想做也读不了教务网页" |

两个真实实现**必须过同一套断言**（P07 A 组），且同一份数据的两种表示要产出**逐字段相同**的结果。`readerId` 被测试钉死——改名会立刻红。

### 8.3 一条容易写错、P07 专门钉住的语义

**课表时刻锚在学校时区，查询窗口锚在使用者时区。** 二者不同时，按"日期字符串落在区间里"过滤会整体偏一天（实证：漏声明 `scheduleTimezone` 时同一节课的瞬间偏 **12 小时**）。所以：

- 窗口判定改用**时刻交叠**（`endAt > 窗口起 && startAt < 窗口止`），与 UniCore 内部 `slotsIn` 的边界规则完全一致——三处边界规则必须一样，否则会在接缝处漏掉或重复课程；
- 窗口非法（`from > to` 或不可解析）→ **返回空结果，不抛异常**。
- 缺省 `scheduleTimezone = timezone`：这是绝大多数情况，也是**未经裁决前的安全默认**（OQ-13）。

### 8.4 与 n8n 侧的关系

`workflows/schedule_query.json` 的 `Schedule Adapter` 节点是这套语义在 n8n 侧的**镜像实现**（Code 节点跑在沙箱里，不能 import 本仓库 TS，只能分开写）。两者的一致性由 P07 **H 组的行为等价断言**锁住：喂同一份 fixture，节点 JS（在 `new Function` 里跑）必须与 `FixtureScheduleReader` 逐字段相同，`dropped` 计数也要相同。

⚠️ **H 组本身不是“Workflow 在 n8n 里跑通了”的证据。** 它的执行环境是 Node 的 `new Function`。P11 已通过另一条独立路径在隔离 n8n 2.40.5 中真实运行全部 6 个 Workflow；证据见 `ops/p11-evidence/runtime-report.json`，OQ-12 已关闭。

### 8.5 学校时区住在构造配置里（OQ-13 裁决）

```ts
new LocalRulesAdapter({
  reader: new StandardCourseReader(courses),
  scheduleTimezone: schoolProfile.timezone,   // ← 学校档案给的 IANA 时区
})
```

**它不在 `ask()` 的输入上。** 理由（裁决原文）：学校时区属于**学校数据源配置**，不属于用户请求。

- 放在请求上，会让"同一份课表在不同请求里被解释成不同时区"成为可能——那是**数据源**的属性，不是这一次提问的属性。
- 冻结的 Layer A `UniRequest` 也没有这个字段；放在请求上等于**偷偷绕过契约**。
- `UniRequest.timezone` 继续只表示一件事：**使用者查询窗口的时区**（"用户问的是哪一天"）。
- `ScheduleQuery.scheduleTimezone` 保持**内部 seam 字段**，只由 Adapter 从自己的配置填充，**不出网**，胶囊里也**没有**它。
- 缺省（不传）= 使用者时区，这是**安全默认**；同时**保留**这条限制说明：跨时区学生会整体偏一天（E 组实证偏 12 小时）。

### 8.6 「本周课程统计」（P07.1，OQ-11 裁决）

`week_plan` 在 seam 之上再走一步，但**完全在本机**：

- 窗口 = **使用者时区**本周一 00:00 → 周日 23:59（由 `queryWindowFor('week_plan')` 算，只读该窗口）；
- 统计 = 重叠**或首尾相接**的忙闲段合并后计数（`handleWeekPlan`）；
- **不产胶囊、不读待办、不联网、不调模型**；**没有**向任何 DTO 加字段。

⚠️ 「本周」是按**使用者**的周算的，不是按学校的周——同一瞬间上海学生的"本周"和纽约学生的"本周"是两段不同的绝对时间（I-9 实测：4 次 vs 5 次）。这是 D19，**要改得改裁决，不是改代码**。
