# 测试清单与执行方式

版本：1.5（P09 —— 观测链路、执行顺序断言、隔离目录防漂移）
日期：2026-09-25

---

## 一 怎么跑

```bash
cd <本工位根目录>            # 交付副本位于 p5-assistant/n8n/
node tests/run-contract-tests.mjs           # 契约（schema × fixture）      303 断言
node tests/run-uni-core-tests.mjs           # UniCore 行为 + 路由/观测一致性 405 断言
node tests/run-schedule-adapter-tests.mjs   # 课表 Adapter seam + 周统计  1,221 断言
node tests/run-security-tests.mjs           # 安全（G4 判据）+ 目录守卫   1,057 断言
UNIMATE_ISO_N8N=<一个**新的**专用目录> node tests/roundtrip-check.mjs   # 往返核对（慢，起隔离实例）
```

**真实 n8n 运行验证**（需要**先起一个隔离实例**，不属于上面四条）：

```bash
# 见 ops/p11-runtime-runbook.md
UNIMATE_P11_BASE=http://127.0.0.1:5778 \
UNIMATE_EVIDENCE_DIR=ops/p09-evidence \
  node tools/p11-runtime-check.mjs          # 16 场景 + 20 次一致性
UNIMATE_ISO_DB="<隔离目录>/.n8n/database.sqlite" node tools/check-log-order.mjs
                                            # 断言「记录先于应答」（读真实执行数据）
```

- **依赖**：零。只用 Node 内置能力（`node:fs` / `node:url` / `node:path` / `node:sqlite`）。**不需要 `npm install`**。
- **退出码**：`0` = 全通过；`1` = 有失败；`2` = **前置缺失**（`check-log-order.mjs` 没给 `UNIMATE_ISO_DB` 时故意 fail closed）。
- **Node 版本**：需要 **Node 22.6+** —— `core/*.ts` 靠**原生类型擦除**被直接 `import`。本机 Node **24.18.0**，`process.features.typescript === 'strip'`。
- ⚠️ **strip-only 模式不支持 `enum` / `namespace` / 装饰器 / parameter property**（`constructor(private readonly x)`）。`core/` 下的类必须**显式声明字段 + 在构造函数体里赋值**，否则抛 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。P07 踩过，见 `docs/size-budget.md` §2.1b。
- ⚠️ `roundtrip-check.mjs` **没有默认目标，也不会删除目录**。必须显式传入 `UNIMATE_ISO_N8N`，且目标必须是系统 Temp 下、名称以 `unimate-n8n-iso-` 开头、运行前不存在的新目录。路径守卫在任何创建动作前执行；命中保留目录、相对路径、Temp 外路径或已有目录都会 fail closed。见已关闭的 OQ-15。
- ⚠️ **建了新的隔离目录就要登记**进 `docs/open-questions.md` 的 `RESERVED-ISO-DIRS` 块——**J-1b 会检查**（P09 新增的防漂移断言，它当场抓到过 P09 自己建的两个目录）。

---

## 二 测试分组

| 组 | 名称 | 测什么 |
| --- | --- | --- |
| **A** | schema × fixture | 每个 schema 的**正例必须通过**、**反例必须失败在预期的那条约束上**（`expect` 子串匹配，不是只判"失败了"） |
| **B** | 校验器自测 | 20 类违规 + 6 类不应误报，逐条断言 `mini-schema` 确实报/不报。**这组的存在是为了让 A 组的绿可信** |
| **C** | 数据边界 | **分两层**测：Layer A 的 `context` 允许课程名/教室（本机合法）但拒绝身份与记事正文；Layer B 的 `contextCapsule` 拒绝一切内容类字段（课程名/教师/教室/记事标题正文/姓名/学号/照片/账号/凭据 十类） |
| **D** | 跨文件一致性 | intent 枚举 / errorCode 枚举的漂移；`x-error-table` 覆盖度；**F3 的运行时 vs schema 一致性**；schema 关键字覆盖；**D-6** Layer B 版本一致性；**D-7** 胶囊接线与封闭性；**D-8** DTO 正式化；**D-9 白名单精确性** |
| **E** | 跨字段不变量 | JSON Schema 表达不了的那些：`endAt > startAt`、`operation === 'note.create'` ⇒ `noteDraft` 必填且需确认、非 note.create 不得带 `noteDraft`、投影必须剥离 |

**D-9 是数据边界的最后一道防线。** 它断言胶囊与三个 DTO 的字段集合**恰好**等于预定清单——多一个少一个都报红。这条是**变异验证逼出来的**：原本把 `title` 加进胶囊忙闲段的白名单，303 条测试一度全绿（逐字段补反例是打地鼠，追不上）。

---

## 二·补 课表 Adapter seam 套件（P07 新增）

`run-schedule-adapter-tests.mjs`，八组。它测的不是 schema，是**换一个课表来源，答案会不会变**。

| 组 | 名称 | 测什么 |
| --- | --- | --- |
| **A** | seam 等价与通用契约 | **两个真实 Adapter 过同一套断言**；同一份数据的两种表示（教务节次形态 / 统一课表对象）必须产出**逐字段相同**的结果；`readerId` 钉死；第三个实现（`Null`）也能塞进 seam |
| **B** | 五个操作端到端 | 下一节 / 今日明日 / 空档 / 冲突 / 简报：**换 Adapter 不换答案**；统一走 `ActionCard`，不为每个问法新增接口；记事卡必须 `requiresConfirmation: true` |
| **C** | 跨周与节次 | 周次表达式与单双周展开、节次表映射、`termStart` 非周一回退、跨周窗口不漏不重、**与测试自带的独立 oracle 对齐** |
| **D** | 空 / 无课日 / 非法输入 | 空课表五个操作都成句；非法行一律**丢弃并计数**、不抛异常；重复行去重 vs 同时段不同课保留（那是真冲突）；相邻时段不算冲突、不产生零长度空档 |
| **E** | 时区与区间边界 | 窗口按**时刻交叠**不按日期字符串；跨时区下同一节课是同一瞬间；§4.7 用例④（23:00 问"明天"）；**漏声明课表时区会偏 12 小时的实证** |
| **F** | P-01 / P-02 默认规则 | 默认值必须出现在 `explain` 里（评委当场能核对）；未过时**不**提 P-01（避免"总是取下一个"的误读） |
| **G** | 零网络 / 拒绝路径零读取 | **计数 reader** 硬断言：不支持的意图、闲聊、记事查询一次课表都不读；`source` 恒为 `local_rule`；`core/*.ts` 源码扫描无网络/环境变量；6 个 Workflow 无 LLM/HTTP/Redis 节点 |
| **H** | n8n 侧行为等价 | 从 `schedule_query.json` 取出节点 JS，用 `new Function` 跑，输出必须与 `FixtureScheduleReader` 逐字段相同（含 `dropped`）；`Clamp Range` 的 31 天窗口校验放行周一→周日；`Build Result` **不得**产出周统计计数；**路由含 `schedule.week` 分支**且不把不支持的意图交给 Tool |
| **I** | **本周课程统计**（P07.1） | OQ-11 裁决的逐条落实：窗口 = 使用者时区本周一→周日；连续时段合并（重叠或首尾相接）计一次；不按 periodLabel 拆、不按课程名去重；重复行去重；跨周边界；使用者时区 ≠ 学校时区；不读待办；不产胶囊；空课表明确回答；**不得**用「今日安排」冒充周范围；`source` 恒为 `local_rule` + 连续 20 次一致 |

**两条必须知道的读法**：

1. **G 组的"零读取"是安全属性，不是性能优化。** 拒绝路径有副作用就等于"越拒越错"，P08 的 G4 会顺着这条继续加。
2. **H 组证明的是"两份实现语义相同"，不是"Workflow 跑通了"。** 执行环境是 Node 的 `new Function`，**不是 n8n 沙箱**（n8n 的 Code 节点另有沙箱限制，P03 的 E14 已证实 `$env` 默认抛错）。**不得**把它写成 n8n 运行验证（OQ-12）。

### 维护约定（P07 追加）

| 什么时候 | 要做什么 |
| --- | --- |
| **改了 `core/schedule-reader.ts` 的展开/过滤/去重逻辑** | **必须**同步改 `tools/gen-workflows.mjs` 里的 `SCHEDULE_ADAPTER_JS` 并重跑 `node tools/gen-workflows.mjs`，否则 H 组会红。这两份实现注定要分开写（n8n Code 节点不能 import 本仓库 TS），**一致性只能靠测试兜，不能靠记忆** |
| 改了 `core/schedule-reader.ts` 的对外形状 | 同步改 `docs/android-embed-contract.md` §八 与 `p5-assistant/NOTES.md` 的对接点 |
| **改了一个意图的「支持 / 不支持」状态** | **必须**同时看三处：`UNSUPPORTED_INTENTS`、`agent_intent_router` 的 Switch 分支表（由 `tools/gen-workflows.mjs` 生成）、以及测试里把它列进「拒绝路径」的那些清单。**漏掉任一处都是静默答错**——P07.1 把 `schedule.week` 改成支持时就差点漏掉分支表（Y-6 现在会拦）|
| **想给某个能力加"计数"类的派生结论** | 先确认口径**只存在一处**。周统计的计数只许在 `handleWeekPlan` 里算；Tool 输出**不得**再给一个（H-4 会红）。两个口径迟早不一致 |
| 想给 `ScheduleQuery` / `BusySlot` 加字段 | `ScheduleQuery` 是 P07 定义的 seam，可改（但**值**从构造配置来，见 OQ-13）；`BusySlot` 是 §1.4 冻结的 Layer A DTO，D-9 是精确白名单，**不许顺手扩** |
| **改了 `ask()` 的输入形状** | 记住 `scheduleTimezone` **不在** `ask()` 输入上，它在 `LocalRulesAdapterConfig`（OQ-13 裁决：学校时区属数据源配置、不属用户请求）|
| 改动 `core/` 下的类 | 别用 parameter property（见 §一 的 strip-only 约束） |
| 跑 `tsc` 量体积 | **顺手看一眼 stderr**。`tsc` 报类型错误时照样 emit，`grep -v TS5097` 会把真错误一起滤掉——P07 的 TS2741 与 P07.1 的 TS2367 都是这么差点溜过去的 |

---

## 二·补二 安全测试组（P08 新增）

`run-security-tests.mjs`，十一组。它是 **G4 门禁的可执行证据**——1,057 条断言里没有一条是"读一遍文档就算过"。
**K 组（P09 新增）同时是 G1 的判据证据**：它把 `prompts/data-boundary.md` 与 `request.schema.json`
钉在一起，让"文档与实现一致"从一句自述变成一条断言。

| 组 | 威胁 | 测什么 |
| --- | --- | --- |
| **A** | 数据胶囊越界 | 对抗式投影（往 Layer A 塞满敏感字段，胶囊里一个不许出现）；胶囊**逐层**白名单；网关预检拒绝 12 类越界胶囊 + 5 类凭据夹带 |
| **B** | 行动卡绕过确认 | 全语料跑一遍：写入卡必带确认与 `noteDraft`、非写入卡不得带；**输入深拷贝后逐字节比对**（无副作用）；静态扫描写入原语与 SQL DML |
| **C** | 提示词注入 | 11 条 payload（含 §13.6 #3 原句）；不产生删除、写入必带确认、响应无身份字段、`source` 恒为本机 |
| **D** | 日志泄漏 | 日志输出键集合**精确等于** `docs/logging-spec.md` 的白名单；18 个禁止词扫描；DDL **无内容列**；网关出口不透传用户原话 |
| **E** | 超长输入与体积 | 500/501/20 万字三档；**极端合法输入下六个问法全部 ≤ 32 KiB 且卡片 ≤ 12**；截断必须写在 `explain` 里；最大合法胶囊 ≤ 16 KiB |
| **F** | 跨用户上下文 | 交错调用 20 轮不串上下文；两个 Adapter 实例互不影响；**签名里没有身份参数**；模块级无 `let`/`var` |
| **G** | 参数污染与拒绝路径 | 13 类污染输入全部被预检拒（`userId` 数组/对象/null…）；拒绝后输入未被修改；比赛版**没有删除能力** |
| **H** | Secret 扫描 | 规则**唯一真源**在 `ops/secret-scan-report.md`，测试读出来重跑；0 命中；Workflow JSON 无凭据值；`credentials/` 为空 |
| **I** | 清单完整性 | G4 矩阵恰好 8 行、威胁矩阵恰好 6 行；`N/A` 行**也必须填证据**（填的是"确认它没被实现"）；不得声称没做过的事 |
| **J** | **隔离目录守卫**（P11 新增，P09 扩） | `iso-dir-guard` 的 7 条拒绝路径逐条对抗验证（未传参 / 相对路径 / Temp 外 / 前缀不合法 / 已存在 / 命中保留目录 / 保留目录的子路径）+ 反向用例；结构性断言：`roundtrip-check.mjs` **不许再出现 `rmSync`**、不许有 `??` 默认值、校验必须发生在动作之前。**J-1b（P09）**：Temp 里实际存在的 `unimate-n8n-iso-*` 目录**必须都已登记**在 `RESERVED-ISO-DIRS` 块里 |
| **K** | **数据边界文档 ↔ 实现**（P09 新增，**G1 判据**） | `prompts/data-boundary.md` 的 `REMOTE-USER-DATA` 机器可读块，与 `request.schema.json` 里**实际存在**的字段**精确比对**（多一个少一个都红）；反向扫描禁止字段（`periodLabel`/`title`/`location`/… 不许出现在允许清单里）；文档必须写明"模型链路关闭"与"不配置模型 Key"；文档必须**如实标注**界面文案未验证；全部 Workflow 无 LLM 节点；`credentials/` 为空 |

**四条要读准的地方**：

1. **D 组与 A 组跑的是节点 JS（`new Function`），不是 n8n**。见 `size-budget.md` §四与 OQ-12。
   （**真实 n8n 运行**另有一条独立路径：`tools/p11-runtime-check.mjs` + `ops/p11-runtime-runbook.md`。）
2. **`agent_log` 表没有部署**。能说的是"节点输出与白名单精确一致"+"表结构无内容列"，
   **不是**"全表扫描为空"。这一条在清单里写死了。
3. **H 组的规则刻意不收"通用高熵串"**，理由在 `ops/secret-scan-report.md` §4.1：
   合成 fixture 必然是这个形状，加进去只会制造**恒假阳性**，而恒假阳性会训练人忽略扫描结果。
4. **J-1b 是单向断言（磁盘 ⊆ 清单）**。目录被产品负责人批准删除后它仍然成立；
   但它**不许**反过来写（清单 ⊆ 磁盘）——那会让"清单里留着一条已删的"变成红灯，
   而那种红灯没有意义。**建了新目录就登记**，这是它的全部要求。

### 维护约定（P08 追加）

| 什么时候 | 要做什么 |
| --- | --- |
| 给响应**加一种新卡片**或新问法 | 确认它经过 `capCards`（E-2 会检查六个问法，新增的漏网就自己跑一遍） |
| 给日志**加字段** | 同步改 `docs/logging-spec.md` 的白名单块——D-1 是**精确相等**断言，不加就红 |
| 往 `core/` 或 `workflows/` 加**任何写入** | 先想清楚 B 组为什么红。比赛版没有落盘路径，加写入是设计变更 |
| 改 `ops/secret-scan-report.md` 的规则 | H 组会按新规则重跑。**放宽规则前先读 §4.1** |
| 改 `ops/security-checklist.md` 的矩阵 | I 组按列数（**恰好 5 列**）与状态枚举解析，改格式会红 |
| 想写"某某已验证" | `N/A` 的行也必须给证据。**没有命令 / fixture / 断言支撑的"通过"不许写** |

---

## 三 文件布局

```
tests/
├── README.md                          本文件
├── run-contract-tests.mjs             契约运行器
├── run-uni-core-tests.mjs             UniCore 行为 + 路由/观测链路一致性
├── run-schedule-adapter-tests.mjs     课表 Adapter seam（P07）      ← 与契约测试解耦，可单独跑
├── run-security-tests.mjs             安全（P08，G4 判据）          ← 同上，可单独跑
├── roundtrip-check.mjs                Workflow 往返核对（慢，起隔离实例；不并进上面四个）
├── lib/
│   ├── mini-schema.mjs                无依赖的 JSON Schema draft-07 子集校验器
│   └── invariants.mjs                 6 条跨字段不变量的实现（E 组用）
└── fixtures/
    └── runtime-validate-llm-output.js 主规划 §4.2.5 的运行时片段【逐字】抄本

fixtures/
├── corpus-v1.jsonl                  33 条固定语料（run-uni-core-tests 的 U 组读它）
├── schedule-fixture-a.json          学校形态课表样例（P07；**自造，不代表任何真实高校**）
└── contract-cases/
    ├── request.cases.mjs          response.cases.mjs        error.cases.mjs
    ├── intent.cases.mjs           bridge.cases.mjs
    ├── notes-create.cases.mjs     notes-query.cases.mjs     notes-update.cases.mjs
    ├── notes-delete.cases.mjs     schedule-query.cases.mjs  weather-query.cases.mjs
    ├── records-query.cases.mjs    cache-key.cases.mjs       confirm-token.cases.mjs
    └── invariants.cases.mjs       ← 例外：kind='invariants'，由 E 组处理，不走 schema 校验
```

**为什么 `schedule-adapter.cases.mjs` 没有出现在 `contract-cases/` 里**：那一层是给 **JSON Schema** 做正反例的，而 `ScheduleReader` 的输入（节次 + 周次）**没有也没有必要有 schema**。硬塞一个 `schemaFile` 进去只会让 A 组报「schemaFile 不存在」。它的测试全部住在 `run-schedule-adapter-tests.mjs` 里，**这是刻意的分类，不是漏了**。

**两套版本号不要混**：`request` / `response` 是 Layer B，**1.1**；`tool.*` 是 Tool 子契约，**1.0**。见 `docs/api-spec.md` §六。

**fixture 用 `.mjs` 而不是 `.json`**，原因有二：① 需要计算超长字符串（如"501 字的 message"）；② 反例要带 `expect` 字段注明**预期失败原因**——那是 P02 步骤 3 的硬要求，纯 JSON 里写注释会很难读。

---

## 四 fixture 的书写约定

```js
export const schemaFile = 'request.schema.json';   // 对应哪个 schema

export const valid = [
  { id: 'v-01 完整请求', data: { /* ... */ } },
];

export const invalid = [
  {
    id: 'i-01 缺 message',
    data: { /* ... */ },
    expect: '缺少必填字段: message',   // 必须出现在【失败信息】里
  },
];
```

- **`id` 前缀**：正例 `v-`、反例 `i-`。运行器会检查，写错会报错。
- **`expect` 不是"期望失败"而是"期望失败在哪条约束上"**。只写"应该失败"会漏掉"失败在别的约束上"这种假阳性。
- **`expect` 可以是规则的子串**，不必逐字。
- **删字段要用 `omit()` 真正删键**，不要写 `{ ...obj, field: undefined }` —— 键还在（值为 `undefined`），命中的会是 `type` 断言而不是 `required` 断言，**测的就不是"缺字段"这件事**。这个坑踩过两次，所以 fixture 里备了具名 helper。

### 不变量用例的格式（`invariants.cases.mjs`）

```js
export const kind = 'invariants';   // 运行器据此把它分给 E 组，而不是 A 组

export const cases = [
  { id: 'p-01 忙闲段正序', rule: 'busySlot.order', data: { /* ... */ }, violates: false },
  { id: 'x-01 忙闲段倒序', rule: 'busySlot.order', data: { /* ... */ }, violates: true  },
];
```

- **`id` 前缀**：合规 `p-`、违规 `x-`。
- **每条规则必须同时有合规与违规用例**——E 组会检查覆盖度。只有合规用例的话，一个"永远返回合规"的空实现也能全绿。
- 规则名必须存在于 `lib/invariants.mjs` 的 `RULES` 里，否则报错。

---

## 五 维护约定

| 什么时候 | 要做什么 |
| --- | --- |
| 改了 `schemas/*.schema.json` 的枚举 | 同步改 `tests/fixtures/runtime-validate-llm-output.js`（如果改的是 intent 枚举）——否则 D-4 会红 |
| 改了主规划 §4.2.5 的手写校验代码 | **必须**把新代码重抄进 `tests/fixtures/runtime-validate-llm-output.js`。这是 D-4 能生效的前提 |
| 新增 schema | 在 `fixtures/contract-cases/` 下加对应 `.cases.mjs`，**且正反例都要有** |
| 新增一个校验器还不支持的关键字 | 先扩 `mini-schema.mjs` 并加进它的 `SUPPORTED_KEYWORDS`，否则 D-5 会红（那道红灯的意思是"这个关键字等于没校验"） |
| **有意给胶囊或某个 DTO 扩字段** | 必须**同时**改 schema 与 D-9 的期望清单，且能引用主规划的具体章节。**不要**为了让测试变绿而放宽 D-9——那是数据边界的最后一道防线 |
| 写跨字段约束 | 写在 `lib/invariants.mjs` 并在 `invariants.cases.mjs` 补**合规 + 违规**两类用例。**不要**写成 schema 关键字却没人校验（mini-schema 刻意不支持 if/then） |
| 做一次契约修订 | 按 P02.1 的做法跑一次**变异验证**：埋 2–3 个缺陷，确认测试报红、再还原。**没被抓到的变异就是测试的洞**，要补防线而不是删变异 |

---

## 六 本阶段不做的测试

以下属于后续阶段，**不在 P02**，不要误以为已经覆盖：

| 测试 | 阶段 | 为什么现在不做 |
| --- | --- | --- |
| §4.6.3 的 7 个删除拒绝用例 | P08（n7 安全） | 需要真数据；且每条要**同时**断言"返回被拒"和"数据仍在" |
| ~~规则解析与时间~~ | ~~P03~~ | **已做**：`run-uni-core-tests.mjs` 的 U/V 组 + `run-schedule-adapter-tests.mjs` 的 C/E/F 组 |

---

## 六·补 K 组：为什么"文档与实现一致"需要一条断言（P09）

G1 的判据是复合的，其中一条是「`prompts/data-boundary.md` **与实现一致**」。
P09 核对时发现这条**从来没有任何测试盯着**，而文档**已经漂了**：

| 文档（v1.0，P02 时代）说 | 实现（P02.1 冻结后）实际 |
| --- | --- |
| `BusySlot` 允许 `date / start / end / **periodLabel**` | 胶囊里只有 `startAt` / `endAt`；`periodLabel` **被剥离** |
| `TodoSummary` 允许 `title / dueAt / done` | 折叠成 `pendingCount` / `nextDueAt`；**标题一个字符都不出网** |

一份"与实现不一致的数据边界文档"，**本身就是 G1 的未满足判据**。
所以 K 组用了和 `RESERVED-ISO-DIRS` / `LOG-FIELDS` 一样的做法：
**文档里放机器可读块，测试从 schema 推导实际字段，两边精确比对。**

**变异验证（2 个，全被抓）**：把 `periodLabel` 加回允许清单 → 精确比对 + 反向扫描**双红**；
从清单删掉 `message` → 精确比对报红并打印两边差异。

---

## 七 P09 新增的断言（观测链路）

`run-uni-core-tests.mjs` 的 **Y-10 组**（静态）与 `tools/check-log-order.mjs`（真实执行数据）。

| 断言 | 防的是什么 |
| --- | --- |
| `agent_observability` 被调用（不是孤儿） | P09 之前它是仓库里**唯一一个没有任何引用的 Workflow**——文件在、能导入、往返核对也过，但**没有一条请求会写日志**。"文件存在"≠"参与链路" |
| 观测调用失败不影响主链路（`continueRegularOutput`） | 用 `continueErrorOutput` 会送去一个没接线的输出（P11 缺陷 #2 的形状）；用 default 会让主链路跟着失败。**只有 continueRegularOutput 对** |
| 串接拓扑逐条：`Shape Response → Build Log Input → Log Request → Respond` | 分叉接线的先后**在结构上看不出对错**——第一版就是分叉，结构全绿、实跑反了（`observability.md` §6.1） |
| 两个新节点都 `continueRegularOutput` | 它们串在 `Respond` **前面**，抛异常 = 不返回响应体（HTTP 200 + 空响应体） |
| `Respond` 响应体引用 `Shape Response`、**不读 `$json`** | `Respond` 排在日志链路之后，`$json` 是**日志行**——读它等于把日志字段发给客户端 |
| **`check-log-order.mjs`**：真实执行顺序 | 上面全是**静态影子**。真实顺序只存在于 n8n 的执行数据里，所以用一个独立工具读它、断言它。**没给 `UNIMATE_ISO_DB` 就退出码 2**，不静默跳过 |

**变异验证（P09 实测，三条全被抓）**：`onError` 改错 → Y-8 + Y-10 双红；
删掉日志节点让观测重回孤儿 → Y-10 红；让日志节点抄 `message` → D-6 三条红。
| ~~课表 Adapter~~ | ~~P07~~ | **已做**：`run-schedule-adapter-tests.mjs` 八组 + P07.1 的 I 组 |
| ~~安全（§13.6）~~ | ~~P08~~ | **已做**：`run-security-tests.mjs` 九组；§13.6 八类判定见 `ops/security-checklist.md`（2 类 N/A 已给"确认它没被实现"的断言） |
| 幂等与并发（§13.3） | P04（n3，赛后） | 需要真实数据库与唯一约束 |
| 缓存（§13.4） | P05（赛后） | MVP 用 `cacheMode: disabled` |
| 端到端与真机 | P11 | **真机没跑就是未验证**，不得预填 |

---

## 八 一条交付前的坑：**测试判据不许依赖检出设置**（2026-09-25）

交付复检时发现：本仓库 `core.autocrlf=true`，**新克隆出来是 CRLF**，
而 `run-security-tests.mjs` 的 `stripComments` 原先长这样——

```js
const stripComments = (src) => src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
```

**它在 CRLF 文件上完全不工作**：JS 里 `\r` 是**行终止符**，`.` 不匹配它，
于是 `.*` 停在 `\r` 之前、`$`（无 `m` 标志）只匹配输入末尾，两者对不上 →
**整条注释没被剥掉**。后果是 `roundtrip-check.mjs` 里那句
"本文件里没有任何 rmSync" 的说明被当成真的 `rmSync`，**J 组误报红灯**。

**修法**：先 `replace(/\r\n?/g, '\n')` 归一化行尾，再剥注释。

**由此得出一条更通用的规矩**：

> 任何"读源码文本再判断"的断言，都要先问一句：**它在 CRLF 下还成立吗？**
> 红灯的原因如果是注释或行尾，那说明**判据写错了**，不是代码错了。
> **交付前把副本转成 CRLF 跑一遍**，是这条规矩最省事的落实方式。

**"契约测试全绿"只说明契约自洽，不说明任何功能可用。** 报告时这两件事必须分开写。
