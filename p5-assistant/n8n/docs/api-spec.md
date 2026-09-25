# API 契约说明

版本：1.1（P02.1 契约小版本修订，关闭 OQ-09/OQ-10）
日期：2026-09-25
真源：主规划（**当前版本**，见 `open-questions.md` OQ-01）§1.4、§4.1、§三、§六、§8、附录 C。**本文件不新增任何 intent、字段、错误码或 Tool**，只做归集与信任边界说明。

> **v1.1 变更**：Layer B（`request` / `response`）的 `schemaVersion` 由 1.0 升为 1.1，新增可选 `contextCapsule`。**`tool.*.schema.json` 继续独立使用 1.0**——它们与线上 envelope 是两套契约，不共用版本号。

---

## 一 Schema 清单与调用方 / 提供方

P02 步骤 1 要求的产物。**先确认没有重复真源**：每个契约只有一个文件、一个权威定义处。

| # | Schema 文件 | 覆盖什么 | 调用方（谁读它） | 提供方（谁产出/校验它） | 比赛 MVP |
| --- | --- | --- | --- | --- | --- |
| 1 | `request.schema.json` | Layer B 线上请求（§6.1），**v1.1**，含可选 `contextCapsule` | `agent_gateway` | `N8nAdapter` | ✅ |
| 2 | `response.schema.json` | Layer B 线上响应（§6.2），**v1.1** | `N8nAdapter`、Android | `agent_gateway` 的 Shape Response | ✅ |
| 3 | `error.schema.json` | 15 个错误码 + HTTP + retryable（§6.3） | 全部 | 同上 | ✅ |
| 4 | `intent.schema.json` | LLM 结构化输出（附录 C.2） | `agent_intent_router` | `Extract Intent` + 手写二次校验 | 契约冻结、链路关闭 |
| 5 | `uni-assistant-bridge.schema.json` | Layer A：`UniRequest` / `UniResponse` / `ActionCard` / `BusySlot` / `TodoSummary`（§1.4） | Android、`LocalRulesAdapter` | `UniCore` | ✅ |
| 6 | `tool.notes.create.schema.json` | 记事创建参数（§6.5 全文） | `notes_create` | `agent_intent_router` | ✅（只出行动卡，不落库） |
| 7 | `tool.notes.query.schema.json` | 记事查询参数（§4.4） | `notes_query` | 同上 | ✅ |
| 8 | `tool.notes.update.schema.json` | 记事修改参数（§4.5） | `notes_update` | 同上 | ❌ 赛后，返回 `E_UNSUPPORTED` |
| 9 | `tool.notes.delete.schema.json` | 记事删除参数（§4.6） | `notes_delete` | 同上 | ❌ 赛后，返回 `E_UNSUPPORTED` |
| 10 | `tool.schedule.query.schema.json` | 课表查询参数（§4.7） | `schedule_query` | 同上 | ✅ |
| 11 | `tool.weather.query.schema.json` | 天气查询参数（§4.8） | `weather_query` | 同上 | ❌ 天气移出 MVP |
| 12 | `tool.records.query.schema.json` | 二课查询参数（§4.12） | `records_query` | 同上 | ❌ §1.4 已移出 MVP |
| 13 | `cache.key.schema.json` | 七类缓存键格式（§7.1） | `cache_manager` | 同上 | ❌ `cacheMode: disabled` |
| 14 | `confirm-token.schema.json` | 令牌绑定记录（§6.5） | `notes_delete` | 同上 | ❌ 无删除 |

**重复真源自查结论**：无。三处可能重叠的地方都已界定——

1. **`intent` 枚举出现两次**（`intent.schema.json` 与 `response.schema.json`）——不是重复真源，是两个不同的边界各自需要断言。**一致性由测试锁定**（`tests/run-contract-tests.mjs` D-1）。
2. **`errorCode` 枚举出现两次**（`error.schema.json` 与 `response.schema.json`）——同上，由 D-2 锁定。
3. **`userId` 出现在多个 Tool schema 里**——同一份定义（`string, 1..64`），无分歧。

---

## 二 字段的来源与信任边界

P02 步骤 4 要求的核心内容。**这张表决定"谁说的算"**，实现时按这里写的取。

| 字段 | 来源 | 信任级别 | 规则 |
| --- | --- | --- | --- |
| **`userId`** | **服务端从 token 解析** | **权威** | 请求体里的 `userId` **只用于日志比对**，不是权威值。与 token 解析结果不一致 → **401 `E_AUTH`**，**不"以客户端为准"**（§6.1）。Tool schema 里保留 `userId` 是因为 Tool 之间传参需要它，但它由 `agent_gateway` 注入，**不由客户端提供** |
| **`requestId`** | 网关生成；若客户端已带且格式合法则透传 | 可透传、不可改写 | 全程用于端到端追踪；所有日志与子工作流调用都带它（§4.1）。**不得**由模型产出 |
| **`idempotencyKey`** | 客户端生成（写操作必填） | 客户端可控，但仅影响幂等，不影响权限 | 幂等的**权威判据在 Postgres**（`ON CONFLICT DO NOTHING`，§4.1），Redis 只是热路径。同 key 不同 body → 仍返回首次结果 + `E_IDEMPOTENT_REPLAY` 提示，**不报错** |
| **`confirmToken`** | **服务端签发**（32 字节随机，§4.6.1） | **权威，模型无法伪造** | 不透明令牌 + Redis 存在性存储。绑定 `userId + targetId + impactCount + exp`，一次性，校验通过后**先 `DEL` 再删数据**（§4.6.2） |
| **`sessionId`** | 网关传入 | 上下文，非权限 | 绑定到 memory 的 `sessionKey`。**禁止**硬编码 `'default'`，**禁止**走 `$fromAI`（附录 B） |
| **`message`** | 客户端 | **不可信输入** | 长度 ≤ 500；全角转半角、去零宽字符（§4.2.1）。**永远不进日志表**（§7.5 表结构里没有 `message` 列） |
| **`timezone`** | 客户端 | 影响正确性 | 相对时间换算**只**用它，**不用 n8n 服务器时区**（§4.2.2）。n8n 常跑在 UTC，用错会整体偏一天 |
| **`schemaVersion`** | 客户端 | 白名单 | 不在 `["1.0"]` → **426 `E_VERSION_UNSUPPORTED`** |
| **`contextCapsule`**（v1.1 新增） | **`N8nAdapter` 生成**（不是 `UniRequest.context` 的原样复制） | **受白名单约束** | **可选**。白名单只有 5 项：`projectionVersion` / `purpose` / `window` / `busySlots`(≤20) / `todoStatus`。生成前必须**剥离** `title`/`location`/`periodLabel`，并把 `todoSummary` 折叠成计数。逐字段映射见 `android-embed-contract.md` §四 |

### 信任边界一句话总结

> **身份来自 token，意图来自模型（且必须过枚举校验），参数来自已校验的 slots，动作授权来自服务端签发的令牌。** 四者没有一条是靠客户端"说自己是谁"成立的。

---

## 三 统一响应与不变量

`response.schema.json` 的 7 个字段是**硬不变量**：成功、参数错、上游挂、内部异常、n8n 自己崩——任何路径都必须返回这个形状（§6.2）。

由 `agent_gateway` 的 **Shape Response** 节点统一施加：业务节点只产出 `errorCode`，HTTP 状态码与 `retryable` 由网关查 `error.schema.json` 的 `x-error-table` 映射。**业务节点不许自己拼响应形状。**

两个反直觉但刻意的设计：

- **`E_LLM_UNAVAILABLE` 与 `E_UNSUPPORTED` 用 HTTP 200**（§6.3）。对客户端而言这不是故障，是一次**成功的、有边界说明的**回答。
- **`E_IDEMPOTENT_REPLAY` 也是 200**。用户的第二次请求在语义上已经成功了。

---

## 四 超时预算

主规划 §10.2 冻结的预算，实现时写进对应节点的设置：

```
客户端总超时        12s
 ├─ Worker          1s
 ├─ n8n 总预算      9s
 │   ├─ 缓存读      100ms
 │   ├─ 规则        50ms
 │   ├─ LLM         6s（降级阈值 4s）
 │   ├─ Tool        2s
 │   └─ 日志写入    200ms
 └─ 回程与余量      2s
```

**任何环节没有显式超时**都要在评审里被拦下（源文档三·8）。比赛 MVP 无 LLM，最坏路径是 规则 50ms + Tool 2s + 日志 200ms，远在 9s 预算内。

---

## 五 比赛 MVP 的契约取舍

§1.4 收敛后，14 个 schema 里有 6 个"冻结但本轮不用"：

| Schema | 本轮状态 | 依据 |
| --- | --- | --- |
| `tool.notes.update` / `tool.notes.delete` | 冻结，意图统一返回 `E_UNSUPPORTED` | §1.4「记事修改/删除全部后移」 |
| `tool.weather.query` | 冻结，不创建 Workflow | §十一 n6 比赛口径；且 AGENTS.md 列为"产品负责人点头才做" |
| `tool.records.query` | 冻结，不创建 Workflow | §1.4「二课不阻塞 MVP」 |
| `cache.key` | 冻结，MVP 用 `cacheMode: disabled` | §十一 n4 比赛口径 |
| `confirm-token` | 冻结，无删除路径 | §1.4 |

**冻结不等于可删**：这些契约是赛后路线的接口真源，提前冻结能避免赛后回头改调用方（§4.13 的变更流程）。

---

## 六 版本策略

**两套版本号，互不牵连**——这是 v1.1 引入的规则，混淆会导致误升级：

| 契约 | 当前版本 | 谁在用 | 什么时候升 |
| --- | --- | --- | --- |
| Layer B 线上 envelope（`request` / `response`） | **1.1** | `N8nAdapter` ↔ `agent_gateway` | envelope 的字段或语义变化时 |
| Tool 子契约（`tool.*.schema.json`） | **1.0** | `agent_intent_router` ↔ 各 Tool 子工作流 | 该 Tool 的参数或返回值变化时 |
| 胶囊投影（`projectionVersion`） | **"1"** | `N8nAdapter` 内部 | **投影规则**变化时（如新增一种折叠） |

三条推论：

1. **Tool 子契约不跟随 Layer B 升级。** 加一个工具不需要动 envelope 版本；改 envelope 也不强迫 12 个工具一起改。
2. **`projectionVersion` 与 `schemaVersion` 解耦。** 胶囊字段结构没变、只是投影算法变了 → 只升 `projectionVersion`。
3. **旧版本一律拒绝，不静默兼容。** `schemaVersion` 不在白名单 → `E_VERSION_UNSUPPORTED`(426)。**已作废的 1.0 请求必须被拒**——用例见 `request.cases.mjs` 的 i-07 与 `response.cases.mjs` 的 i-07。

> 版本号在**请求与响应两侧必须一致**（D-6 断言）。不一致说明部署了一半。

---

## 六·补 与课表数据源的关系（P07 新增）

本文件描述的是 **Layer B 线上契约**与 **Tool 子契约**。P07 在它们**下面**又加了一层本机侧的 seam —— `ScheduleReader`（见 `core/schedule-reader.ts` 与 `android-embed-contract.md` §八）：

```
主工程课表 ─► ScheduleReader（学校差异全在这）─► BusySlot[] ─► UniCore ─► UniResponse
                                                                         │
                                         N8nAdapter 投影 ─► contextCapsule ┘ ─► Layer B
```

**为什么记在这里**：`ScheduleReader` 的产物 `BusySlot[]` 与 Layer A 的 `BusySlot` 是**同一个类型**，而它又是胶囊投影的输入。也就是说，**学校差异最终会不会漏进线上请求，取决于 `buildCapsule` 那一层是否照旧剥离**（`title` / `location` / `periodLabel`）。

- `ScheduleReader` **不是契约**，没有 schema，不进 D-9 的字段清单——所以它也**没有**任何"新字段自动获得授权"的余地。
- 它**不允许**成为绕过数据边界的旁路：`Course.teacher` 在 `BusySlot` 里**没有对应位置**，投影时自然消失；`periodLabel` 是 Layer A 合法字段，但**没有**进胶囊白名单。
- 这两条都有测试兜：P07 A 组的泄漏扫描（教师/学校名/教务字样），加上 P02.1 的 W 组胶囊投影断言。

**P07.1 补充**：新增的「本周课程统计」（`week_plan`，OQ-11 裁决）**完全在本机完成**——
`buildCapsule({ capability: 'week_plan' })` **返回 `null`**，即这类请求不携带任何远端上下文。
所以它**没有**、也不需要新的 `purpose` 值，胶囊 schema 一个字节未改。
（断言在 `run-schedule-adapter-tests.mjs` 的 I-13。）

---

## 七 验证方式

```bash
node tests/run-contract-tests.mjs
```

四组测试：schema × fixture、校验器自测、数据胶囊、跨文件一致性。**只看文件不算验证**——所有正例必须通过、所有反例必须**失败在预期的那条约束上**（`expect` 子串匹配）。

当前结果见 `n8n/docs/execution-log.md` 的 P02 条目。
