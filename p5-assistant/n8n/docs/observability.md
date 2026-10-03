# 可观测性设计（n8 / P09）

版本：1.0（P09）
日期：2026-09-25
真源：主规划（当前版本，见 `open-questions.md` OQ-01）§4.10、§4.11、§9.1、§9.2、§9.3、§7.5；
执行引导词 P09。

> **分工**：字段白名单与脱敏规则在 **`docs/logging-spec.md`**（不在这里重复定义）。
> 本文只写**它委托给 P09 的那部分**：字段怎么被产出、指标怎么算、日报与成本怎么估、告警怎么定。
> 两份文档的分工在 `logging-spec.md` §五 已经写明，改一处要同步看另一处。

---

## 一 范围与口径（先读这一节）

| 项 | 本轮（P09） | 赛后 |
| --- | --- | --- |
| P09 状态 | **部分完成**——只做本机与隔离实例可验证的部分 | 全量 |
| 新增 Workflow | **0 个**。仍是 **6 个**（`agent_error_handler` **没有创建**，理由见 §八） | **已裁决：不建**（OQ-16 关闭） |
| 数据库 | **不部署**。三张表（`agent_log` / `agent_idempotency` / `cache_lock`）只有 DDL | 部署 |
| 告警通路 | **不接**。只写规则与触发条件 | 接线 |
| 真实流量 | **没有**。所以本文**不填任何**命中率、延迟、成本数字 | 用实测填 |

**这条最重要**：P09 在比赛路线里被主规划与引导词都列为**赛后路线**（主规划 §16.1 第 2 条、
引导词 §一 第 23 行与执行记录 P09 行）。本轮做的是其中**不依赖部署**的那部分，
理由写在 OQ-16 里，**不是**擅自把 P09 提前结束。

---

## 二 requestId 端到端追踪

`requestId` 是这套设计里**唯一**的追踪锚点。**不靠 `message` 原文追踪**（§9.1）——
用原文追踪等于把用户内容抄进日志，那正是数据边界要防的事。

```
App（N8nAdapter 生成 UUID v4）
  └─ requestId ──► Layer B 请求
        └─ Agent Webhook
             ├─ Precheck Payload    ← 校验 schemaVersion / 长度 / 胶囊
             ├─ Route To Router ──► agent_intent_router ──► Tool
             ├─ Shape Response      ← 把 requestId 原样写进响应信封
             ├─ Build Log Input     ← 【P09 新增】取信封里的 requestId
             │     └─ Log Request ──► agent_observability
             └─ Respond             ← 响应体 = 信封那 8 个字段
```

**同一个 `requestId` 出现在三处**：请求体、响应体、日志行。任意一处拿到 id 都能反查另两处。
这是"可追踪"的全部含义，不需要更多。

### 2.1 追踪锚点在**信封**里，不在日志节点里

`Shape Response` 已经保证响应体只有 §6.2 的 8 个字段，其中就有 `requestId`。
日志节点从**信封**里取 id —— 所以**日志能记的字段，上限就是信封能给的字段**。
这是一个结构性上界：只要信封里没有课程名，日志里就不可能有课程名。

---

## 三 指标定义与采集方法（§9.2 的落实）

**下表是 §9.2 指标在本工位实际能采到什么**。这一列"本工位能否采"是本轮**实测**出来的，
不是抄 §9.2 抄出来的。

| §9.2 指标 | 依赖字段 | 本工位能否采 | 说明 |
| --- | --- | --- | --- |
| Exact / Normalized / Intent Cache 命中率 | `cache_kind` | ❌ **不能** | 比赛 MVP **没有缓存**（§十一 n4：`cacheMode: disabled`）。该字段在 DDL 里，但本工位没有生产者 |
| Weather / Schedule / Notes 命中率 | `tool` + `cache_hit` | ⚠️ 部分 | `intent` 可采；`cache_hit` 恒 `false`（无缓存） |
| **LLM Bypass Rate** | `intent_source != 'llm'` | ⚠️ 恒 100% | 比赛 MVP **LLM 分支关闭**（OQ-05 已关闭，D32）。这条恒为 100%，**采集它等于反复确认一件已知的事** |
| LLM 调用次数 | `llm_used` | ✅ 可采，恒 0 | 同上 |
| **平均 / p95 延迟** | `latency_ms` | ❌ **不能** | **见 §四**——本机网关取不到这个值 |
| n8n 执行次数 | n8n 自身执行记录 | ✅ 可采 | 不经 `agent_log`，直接看 n8n |
| **错误率（按 `error_code`）** | `error_code` | ✅ **可采** | 这是本轮**真正能采**的那一类 |
| 无 TTL 的缓存键数（F5） | Redis | ❌ 不能 | 无 Redis |
| `EXPIRED` / `NOT_FOUND` 令牌失败比（F5） | 令牌表 | ❌ 不能 | 无令牌表 |

**结论**：本轮可采的指标是 **`error_code` 分布 + `intent` 分布 + `payload_bytes` 分布 + n8n 执行次数**。
其余要么依赖没有的组件（Redis / 缓存 / 令牌表），要么依赖取不到的字段（`latency_ms`）。
**不把"没有生产者"写成"命中率为 0"**——那是两件不同的事。

### 3.1 能跑的那条查询

```sql
-- 本工位唯一一条能在测试数据上跑出数的查询（字段全部来自 logging-spec 白名单）
SELECT
  coalesce(intent, '(none)') AS intent,
  count(*)                   AS calls,
  count(*) FILTER (WHERE error_code IS NOT NULL)          AS errors,
  round(100.0 * count(*) FILTER (WHERE success) / count(*), 1) AS ok_pct,
  max(payload_bytes)         AS max_bytes,
  round(avg(payload_bytes))  AS avg_bytes
FROM agent_log
WHERE ts >= now() - interval '1 day' AND env = 'prod'
GROUP BY coalesce(intent, '(none)')
ORDER BY calls DESC;
```

> §9.2 原文那条查询依赖 `cache_hit` / `latency_ms` / `llm_tokens_*` / `intent_source`，
> **在本工位跑不出有意义的结果**（前三个恒 0/NULL，第四个恒 `'rule'`）。
> 上面这条是它在**比赛范围内**的等价物。想在赛后用回原文那条，
> 前提是先把 §三 表里 ❌ 的依赖补上。

---

## 四 观测链路怎么接的（P09 的唯一一处代码改动）

### 4.1 P09 修的真实缺陷：`agent_observability` 曾是**孤儿工作流**

P09 开工审计发现：`agent_observability` 文件在仓库里、能导入、往返核对也过，
但 **`grep` 全部 Workflow JSON —— 没有任何节点引用它**。

> §4.11 要求"**触发 A：被 `agent_gateway` 在响应返回前调用一次（`op=log_request`）**"。
> 一个没有任何调用方的工作流，等于**一条永远不会有数据的日志链路**。
>
> 它同时说明一件事：**"6 个 Workflow 都存在"和"6 个 Workflow 都参与链路"是两个命题。**
> 前者 P03 就成立了，后者到 P09 才成立。

### 4.2 接法：`Shape Response` 分叉成两条

```
Shape Response ──┬─► Build Log Input ──► Log Request ──► agent_observability
                 └─► Respond                                  （记录）
                     （应答）
```

| 设计点 | 为什么这么做 |
| --- | --- |
| **分叉，不是串接** | `Respond` 直接从 `Shape Response` 取数。日志节点的输出**永远流不进 HTTP 响应体**——不是"记得过滤"，是拓扑上到不了 |
| **记录排在应答之前** | §4.11 要求"响应返回前"。分叉数组里的顺序是唯一的静态依据；**实际执行顺序由隔离实例运行实测**（见 §六） |
| **`onError: continueRegularOutput`** | §4.11：「本工作流出错**不能**影响主链路：失败只记一条本地日志」。**不能用** `continueErrorOutput`——那会把失败条目送去一个没有落点的输出，正是 P11 缺陷 #2 的形状；也**不能用** default——那会让主链路跟着一起失败 |
| **`Build Log Input` 是独立 Code 节点** | 让"日志能拿到什么"成为一份**可单独测试**的代码（D-6 组直接喂它一份脏输入，断言它一个内容字段都不抄） |

### 4.3 ⚠️ 已知缺口：`latency_ms` 与 `input_length` 取不到

**本机网关里这两个字段恒为 `null`。** 原因不是偷懒：

- `Shape Response` 之后，数据流里**只剩信封那 8 个字段**。请求侧的长度与起始时刻
  **已经被有意丢弃**——那本来就是数据边界的要求（§4.2 胶囊投影）。
- 拿不到就写 `null`。这是 `logging-spec.md` 的明文规则：**"非数字一律写成 `null`，不臆造"**。

**要变成真值需要什么**（本轮**未实现**）：
一条贯穿 `agent_intent_router` 的 `_meta` 旁路——由 `Precheck Payload` 打上起始时刻与
请求长度，由 router **原样回传**，由 `Shape Response` 在构造信封时**丢弃**（保证响应体仍是 8 字段）、
只交给 `Build Log Input`。

**为什么本轮不做**：那要动 router 的输出契约，而 router 是 P11 刚修过 7 个缺陷的地方，
**为两个指标去动主链路不划算**。这是一条记账，不是一条遗漏。

**另一个真值**：`payload_bytes` 是**实测的**（`Build Log Input` 手算 UTF-8 字节数）。
它与 P08 实测出 74,370 字节那次超预算的口径一致，方便日后继续盯体积。
D-6 组有一条断言专门证明它**不是** `string.length`（中文必须体现出多字节）。

---

## 五 观测自身故障不影响主链路

§4.11 的约束："本工作流出错**不能**影响主链路。"

| 故障 | 会怎样 | 证据 |
| --- | --- | --- |
| `agent_observability` 抛异常 | `Log Request` 是 `continueRegularOutput` → 失败条目原样继续 → `Respond` 照常返回信封 | **Y-10 组**（结构断言：`onError` 必须是 `continueRegularOutput`）；**变异 M1 已证明它会被抓到** |
| 日志链路整条挂掉 | 主链路根本不依赖它的输出（分叉拓扑）→ 无影响 | **Y-10 组**（可达性断言：日志输出**到不了** `Respond`） |
| `Build Log Input` 收到残缺输入 | 所有字段写 `null`，**不抛异常** | **D-6 组**（喂空对象 `{}`，断言不崩且给 `null`） |

**没有真去注入一次故障**：比赛 MVP 没有可注入的数据库与告警通路，
"人为制造 5xx / 上游超时 / 日志库失败"需要**部署**才能做（引导词 P09 步骤 6）。
本轮能证明的是**拓扑与配置层面的独立性**，这一点已由断言锁住；
**注入实验本身列为未验证**。

---

## 六 本轮验证过什么（与没验证什么）

| 项 | 状态 |
| --- | --- |
| 观测链路已被接入（非孤儿） | ✅ **已验证**（Y-10 组；变异 M2 把它改回孤儿会被抓到） |
| 日志输出**到不了** HTTP 响应体 | ✅ **已验证**（Y-10 组可达性断言） |
| 观测失败不影响主链路 | ✅ **已验证**（配置层 + 拓扑层） |
| 日志节点不抄任何内容字段 | ✅ **已验证**（D-6 组，喂脏输入对抗式验证） |
| 记录确实排在应答之前（**实际执行顺序**） | ✅ **已验证**（隔离实例执行数据实测，见下） |
| `agent_log` 表真的落盘 | ❌ **未验证**——表未部署 |
| 告警真的能触达 | ❌ **未验证**——通路未接，见 `ops/alerts.md` |
| 延迟 / 命中率 / 成本数字 | ❌ **未验证，且本轮不填**——没有真实流量，填了就是伪造 |

### 6.1 执行顺序：一次真实的返工（记在这里，因为它只能记在这里）

第一版的写法是**分叉**：`Shape Response` 同时喂 `Build Log Input` 与 `Respond`，
把记录节点写在**连接数组的前面**，指望它先执行。

**隔离实例实测（n8n 2.40.5）**：

```
第一版（分叉，数组 [Build Log Input, Respond]）
  Shape Response → Respond → Build Log Input → Log Request      ← 响应先返回，日志后写 ✗

第二版（把数组倒过来 [Respond, Build Log Input]）
  Shape Response → Respond → Build Log Input → Log Request      ← 一模一样 ✗
```

**数组顺序根本没有影响执行先后。** 同层分叉的调度顺序在 `executionOrder: 'v1'` 下不可靠——
这一点在 n8n 的文档里找不到明确承诺，**只能跑出来**。

**第三版（串接，D26）**：

```
Shape Response → Build Log Input → Log Request → Respond        ← ✔ 与 §4.11 一致
```

顺序由**拓扑**唯一确定，不再依赖任何未文档化的调度语义。

### 6.2 这条属性是被**测试**盯着的，不是被注释盯着的

| 层 | 谁在盯 |
| --- | --- |
| 静态结构 | `tests/run-uni-core-tests.mjs` **Y-10 组**：串接拓扑逐条断言；两个新节点必须 `continueRegularOutput`；`Respond` 响应体必须引用 `Shape Response` 而**不是** `$json` |
| **真实执行** | **`tools/check-log-order.mjs`**：从隔离实例的 `execution_data` 里把**真实节点顺序**读出来，断言「记录先于应答」且「应答是最后一个」。**未给 `UNIMATE_ISO_DB` 时直接退出码 2**——不静默跳过 |
| 端到端 | `tools/p11-runtime-check.mjs` 的 17 个场景 + 20 次一致性 |

**为什么值得专门写一个工具**：这是本项目第二次栽在"结构上看是对的、跑起来是反的"上
（第一次是 D25 的 7 个缺陷）。注释会过期，断言不会。

---

## 七 日报与成本估算（**只写方法，不填数字**）

§9.2 要求日报与成本估算。**比赛 MVP 没有 LLM、没有费用**，所以：

| 项 | 本轮 |
| --- | --- |
| rollup（每小时） | **不实现**：`scheduleTrigger` 需要部署实例常驻；本机隔离实例只跑一次就停 |
| 日报（每日） | **不实现**，同上 |
| 成本估算 | **无成本**。比赛 MVP `llmUsed` 恒 `false`（OQ-05 已关闭、LLM 分支关闭），**没有可估的费用** |
| 数据保留 | DDL 里的 `DELETE ... interval '30 days'` 属于部署侧任务，本轮**只有语句，没有执行** |

> ⚠️ **一条边界**：不得因为"成本是 0"就写"成本已验证"。
> 准确说法是：**比赛范围内不存在成本项**；赛后接上模型后，成本估算与费用硬上限**都还没有做**。

---

## 八 为什么没有创建 `agent_error_handler`

引导词 P09 的文件所有权里列了 `n8n/workflows/agent_error_handler.json`（§4.10）。
**本轮没有创建它**，理由是一条**冲突**：

| 依据 | 说法 |
| --- | --- |
| 引导词 §一 第 24 行 | 「比赛 MVP **最多 6 个 Workflow**」 |
| 引导词 §一 第 19 行 | 比赛最短路径是 P00 → P02 → P02.1 → P03 → P07 → P08 → **P11**（**不含 P09**） |
| 引导词 P09 文件所有权 | 列了 `agent_error_handler.json` → 那会是**第 7 个** |
| 主规划 §16.1 第 2 条 | 「P04/P05/P06/**P09**/P10 不阻塞比赛 MVP」 |
| 引导词执行记录 P09 行 | 状态 = **赛后** |

**"第 7 个 Workflow"与"最多 6 个"直接冲突**，而 P11 的验收结论
（"6 个 Workflow 全部在隔离实例里真实运行通过"）**建立在 6 这个数字上**。
擅自加第 7 个，会让 P11 的验收陈述当场失效。

已登记为 **OQ-16**。

> ### ✅ 裁决（产品负责人，2026-09-25）：**比赛版不单设第七个 Workflow**
>
> 理由：① 比赛版本继续保持 6 个 Workflow；② 当前**错误信封、拒绝路径和结构化日志**
> 能力可以在现有 Workflow 内完成；③ 独立错误 Workflow 会**扩大交付面**，并要求重述、重跑 P11；
> ④ `agent_log` **尚未生产部署**，现阶段不能把独立错误处理器描述成生产可观测性。
>
> **去向**：列为**部署阶段可重新评估项**，**不进入当前比赛基线**。
> 前置是：`agent_log` 真的部署、告警通路真的接上、Error Workflow 的 Web UI 绑定有人做过。

**已做到的**（不新增 Workflow 也能做的部分——这就是裁决第②条说的那些）：
`Route To Router` 与 `Log Request` 都声明了 `onError`，失败条目**不会断链**；
`Shape Response` 把上游失败映射成稳定的 `E_INTERNAL` + 脱敏的 `messageForUser`（P11 已修）；
拒绝路径**零副作用**（§13.6 #4，G 组 13 类污染用例覆盖）。

> ⚠️ **不得宣称**：**生产日志持久化**、**告警**、**故障恢复**已经验证。
> 这三项一条都没做——`agent_log` 未部署、告警通路未接、故障注入未执行。
> 裁决第④条专门点了这一点。
