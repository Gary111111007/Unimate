# 日志字段规范（比赛 MVP，n7 / P08）

> 📍 **本机历史证据路径提示**：本文出现的 `C:\Users\...` 与 `F:\A_LIU_Astrspire\...` 均为**本机历史证据路径**——它们记录的是某一刻在这台机器上的真实位置，**不属于交付内容**，换机后自然失效。**可执行说明一律用仓库相对路径。**

版本：1.0（P08）
日期：2026-09-25
真源：主规划 §7.5（DDL）、§8.3（脱敏规则）、§9.1（字段）、§13.6 #8；引导词 P08 步骤 4/5。

> **设计原则**：**结构性约束比纪律可靠。**
> 不是"记得别把用户原话写进去"，而是**表结构里根本没有那一列、日志节点里没有那个字段**。
> 靠自觉的脱敏规范会在第 200 次改动时失效；没有地方可写则永远有效。

---

## 一 允许字段白名单（**唯一真源**）

下面这一段是**机器可读**的：`tests/run-security-tests.mjs` 的 D 组会把它读出来，
与 `agent_observability` 节点**实际输出的键集合**逐项比对——**多一个少一个都报红**。
所以改这里就等于改测试的期望，两边不可能漂移。

```text
<!-- LOG-FIELDS-BEGIN -->
request_id
intent
latency_ms
error_code
success
env
input_length
payload_bytes
<!-- LOG-FIELDS-END -->
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `request_id` | string | 端到端追踪的唯一锚点。**追踪不靠 message 原文**（§9.1） |
| `intent` | string \| null | 封闭枚举里的值，或 `null` |
| `latency_ms` | int \| null | 非数字一律写成 `null`，不臆造 |
| `error_code` | string \| null | §6.3 的错误码 |
| `success` | bool | `!error_code` 推导而来，不由调用方传 |
| `env` | string | `dev` / `staging` / `prod`（A 类配置注入） |
| `input_length` | int \| null | **长度**。要的是"用户说得多长"，不是"说了什么" |
| `payload_bytes` | int \| null | **字节数**。同上 |

### 明确**不存在**的字段（列出来，因为"没有"也要能被验证）

`message`、`text`、`content`、`body`、`answer`、`course_name`、`teacher`、`location`、
`note_title`、`note_body`、`user_id`（明文）、`name`、`student_id`、`photo_path`、
`password`、`token`、`cookie`、`authorization`、`presigned_url`、`llm_raw_response`。

> 这 18 个词在 D 组里是**扫描目标**：日志节点输出里出现任何一个即报红。

---

## 二 `agent_log` 表结构（DDL）

**这张表里没有 `message` 列**——这是 §13.6 #8 后半句的判据，也是本设计的立足点。

```sql
CREATE TABLE agent_log (
  id             BIGSERIAL PRIMARY KEY,
  request_id     TEXT        NOT NULL,
  user_id_hash   TEXT,                          -- 盐在 Worker，n8n 不接触（§8.2）
  intent         TEXT,
  tool           TEXT,
  cache_hit      BOOLEAN     NOT NULL DEFAULT FALSE,
  llm_used       BOOLEAN     NOT NULL DEFAULT FALSE,
  llm_capped     BOOLEAN     NOT NULL DEFAULT FALSE,
  latency_ms     INTEGER,
  success        BOOLEAN     NOT NULL,
  error_code     TEXT,
  workflow_exec_id TEXT,
  schema_version TEXT,
  input_length   INTEGER,                       -- 长度，不是内容
  payload_bytes  INTEGER,                       -- 字节数，不是内容
  env            TEXT        NOT NULL DEFAULT 'dev',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 没有任何 TEXT 列用于承载用户内容。加列要过 §8.3 与本节，
-- 且必须先改「一」的白名单与 D 组的扫描目标——**加列不是"顺手"能做的事**。
```

**比赛版说明**：这张表在比赛 MVP 里**没有部署**（无数据库）。上述 DDL 是**赛后路线**的契约，
本轮的作用是：把"日志里不许有内容"从一句口号变成**表结构层面的事实**，
并让 D 组的断言有可对照的对象。

---

## 三 脱敏规则（§8.3 的落实）

### 绝对不写

密码、token、cookie、完整记事正文、课表明细、姓名、学号、照片路径、模型原始响应全文。

### 可以写

`requestId`、`userIdHash`、`intent`、`tool`、`cacheHit`、`llmUsed`、`latencyMs`、`success`、
`errorCode`、`workflowExecId`、`schemaVersion`、`inputLength`（**长度可以，内容不行**）。

### 唯一例外与它的代价

debug 环境可以更详细，但**必须在进生产前有一个可执行的验证**：
跑一次"全表扫描找敏感模式"的脚本，结果必须为空。本轮的对应物是
`run-security-tests.mjs` 的 **D-2/D-3**（喂敏感 payload，断言输出里一个都不出现）
与 **H 组**（全仓库 secret 扫描）。

---

## 四 敏感模式扫描规则（P08 步骤 5 要求"规则和结果作为证据保存"）

规则集**唯一真源**在 `ops/secret-scan-report.md`；`run-security-tests.mjs` 的 H 组把它读出来，
用**同一套规则**重跑一遍扫描。所以：

- 报告里写了什么规则，测试就按什么规则扫；
- 想放宽规则，必须改报告 → 报告在 diff 里可见 → 有机会被 review 拦住。

**扫描范围**：**本工位根目录**下的全部文本文件
（`core/`、`schemas/`、`fixtures/`、`tests/`、`tools/`、`workflows/`、`docs/`、`ops/`、`prompts/`）。

**不扫**：`C:\Users\Legion\.n8n\`（本机既有实例的数据库，不属本工作区）、
隔离实例目录（每次重建的临时实例）。

---

## 五 与可观测性的分工

| 关注点 | 本文件 | `docs/observability.md`（P09） |
| --- | --- | --- |
| 字段白名单与脱敏 | ✅ 这里 | 引用这里，不重复定义 |
| rollup / 日报 / 成本估算 | — | ✅ P09 |
| 告警规则与通路 | — | ✅ P09 |

**P08 不做 P09 的事**：本轮不写 rollup、不写告警、不填任何成本数字——
比赛版没有真实流量，**编造命中率或延迟数字等于伪造证据**。
