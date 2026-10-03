# 体积与复杂度预算

> 📍 **本机历史证据路径提示**：本文出现的 `C:\Users\...` 与 `F:\A_LIU_Astrspire\...` 均为**本机历史证据路径**——它们记录的是某一刻在这台机器上的真实位置，**不属于交付内容**，换机后自然失效。**可执行说明一律用仓库相对路径。**

版本：1.4（P08 —— 追加安全加固后的实测值；响应体积**实测过一次失败**）
日期：2026-09-25
真源：主规划 §1.4「体积与复杂度预算」。

> **口径**：只有带**实测**标记的才算已验证。APK 增量在未嵌入前一律是未验证。

---

## 一 预算与实测对照

| 项 | 目标 | 实测 | 状态 |
| --- | --- | --- | --- |
| **本机规则核心 gzip** | ≤ 80 KiB | **10,085 字节 ≈ 9.8 KiB**（3 个模块合并） | ✅ **已验证**，用掉 **12.3%** |
| **单次请求** | ≤ 16 KiB | **610 字节**（基准样例） / **1,972 字节**（最大合法胶囊：20 条忙闲 + 窗口 + 待办统计） | ✅ **已验证**，用掉 **12.0%** |
| **单次响应** | ≤ 32 KiB | **451 字节**（基准样例） / **极端输入下 2,936 字节** | ✅ **已验证**，用掉 **9.0%**（详见 §二·补） |
| **新增运行时依赖** | 0 个大型依赖 | **0 个** | ✅ **已验证**（详见 §三） |
| **n8n Workflow 数** | ≤ 6 个 | **6 个** | ✅ **已验证**（可用性另见 §四） |
| APK 新增体积 | ≤ 500 KiB | — | ❌ **未验证**（未嵌入、未出包） |
| UI | 复用现有 Vue / 图标 / 主题 / `ConfirmDialog`，不引入新框架 | — | ❌ **未验证**（未接 UI） |
| 交互深度 | ≤ 2 层 | — | ❌ **未验证**（未接 UI） |

**⚠️ 这三行"已验证"说的只是"当前形态下的实测值"**，不是"最终一定不超"。P03 之后代码还会变，超预算时按 §五 处置。

---

## 二 实测的复现方式

### 2.1 本机规则核心 gzip

```bash
# 用 n8n 自带的 tsc（路径随安装位置而变；本机历史证据路径见文末）
TC="$(npm root -g)/n8n/node_modules/typescript"
cd <本工位根目录>
node "$TC/bin/tsc" --ignoreConfig --target es2022 --module esnext --moduleResolution bundler \
  --removeComments --outDir /tmp/ucdist \
  core/uni-core.ts core/types.ts core/schedule-reader.ts core/local-rules-adapter.ts
cat /tmp/ucdist/uni-core.js /tmp/ucdist/schedule-reader.js /tmp/ucdist/local-rules-adapter.js > /tmp/ucdist/bundle.js
gzip -c /tmp/ucdist/bundle.js | wc -c        # → 10085
```

**为什么用 n8n 自带的 tsc**：本机没有全局 `tsc`/`esbuild`，但 n8n 2.40.5 自带一份 TypeScript 7.0.2。借它做**构建期**工具，不新增任何运行时依赖、不在 `n8n/` 里放 `package.json` 或 `node_modules`。

**逐模块（`--removeComments`）**：

| 模块 | 原始 | gzip | 引入阶段 |
| --- | --- | --- | --- |
| `uni-core.js` | 28,272 | **7,779** | P03 / P07.1 |
| `schedule-reader.js` | 5,644 | **1,789** | P07 |
| `local-rules-adapter.js` | 3,232 | **1,211** | P07 / P07.1 |
| 三个合并成 bundle（按依赖顺序） | — | **10,085** | ← **报这个**（P08 实测） |
| `types.js` | 11 | 40 | 不计入（见下） |

> **P08 未单独记录逐模块 gzip**：本阶段的改动只有 `uni-core.ts` 多了一个 `capCards` 与常量，
> 逐模块数字的变化在噪声量级。**合并后的 10,085 才是要报的数**，也是唯一与预算比较的数。

**P07.1 的增量**：本周课程统计（`handleWeekPlan` + 窗口 + 卡片）让 `uni-core` 涨了约 **370 字节 gzip**，Adapter 收口 `scheduleTimezone` 后涨了约 **77 字节**。合计约 +500 字节。**P08 的 `capCards` 约 +110 字节。**

**P09 的增量：0 字节。** P09 只改了 `tools/` 与 `workflows/`（把 `agent_observability` 接进网关），
**`core/` 一个字节没动**——所以合并 gzip **仍是 10,085**。
这条不是推测：P09 结束时按 §2.1 的命令**重新跑了一遍**，数字逐字节相同。
（量体积的量的是**本机规则核心**；n8n 侧 Workflow JSON 的体积另算，见 §三。）

**`types.js` 不计入**：它擦除后只剩 `export {}`（11 字节），**没有任何模块引用它**（`import type` 编译期即消失）。类型层零运行时开销。

**`tsc` 会报 `TS5097`（`.ts` 后缀的 import 路径）**，但**仍然正常 emit**。这是本项目刻意选择"无构建步骤、靠 Node 24 原生类型擦除直接跑"的副产品：`allowImportingTsExtensions` 只能配 `--noEmit` 用，和"要产物来量体积"冲突。

> ### ⚠️ 量体积时**必须看一眼 stderr**
>
> **`tsc` 报类型错误时照样 emit**。所以"产物生成了、体积数字正常"**不等于**"类型没问题"——
> 真错误只出现在 stderr 里，而且被上面那句 `| grep -v TS5097` 一过滤就彻底消失了。
>
> 已经栽过**两次**，两次都是同一个机制：
>
> | 阶段 | 错误 | 症状 |
> | --- | --- | --- |
> | P07 | **TS2741** `ResolvedTime` 少一个必填字段 `basis` | 体积一切正常 |
> | P07.1 | **TS2367** `detectCapability` 里一条**永远为假**的死比较（新增早返回后忘了删后置条件里的同名分支） | 体积一切正常，功能也正常——只是一段死代码躺在那里 |
>
> **规矩**：量体积的命令跑完要单独看一眼有没有 `TS5097` 之外的输出。数字好看不代表类型干净。

### 2.1b 类型擦除的运行期硬约束

`node core/xxx.ts` 直接可跑，靠的是 Node 24 的 **strip-only** 类型擦除（`process.features.typescript === 'strip'`）。它**只擦类型，不生成代码**，因此以下 TS 特性在 `core/` 下**一律不能用**：

| 特性 | 后果 |
| --- | --- |
| `constructor(private readonly x: T)` （parameter property） | 抛 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`——它是要生成赋值代码的，不是纯类型 |
| `enum` / `namespace` | 同上 |
| 装饰器 | 同上 |

**规矩**：`core/` 下的类一律**显式声明字段 + 在构造函数体里赋值**。P07 建 `ScheduleReader` 时踩到，是运行时当场报错（不是静默出错，这点还好）。

> **小文件 gzip 会变大**：`types.js` 11 字节原始、gzip 后 40 字节——gzip 头部固定开销约 18–20 字节。单看小文件时别被这个数字误导。

### 2.2 请求 / 响应体积

```bash
node -e "... Buffer.byteLength(JSON.stringify(obj), 'utf8') ..."
```

口径是 **UTF-8 字节**，不是字符数（中文一字三字节）。样例取 §1.4 九十秒演示的「今天下午有空吗」+ 基准课表上下文。

**分解**：

| 组成 | 字节 | 占请求比 |
| --- | --- | --- |
| 完整线上请求（含胶囊） | **610** | 100% |
| 其中 `contextCapsule` | 373 | 61% |
| 不含胶囊的同一条请求 | 219 | 36% |

胶囊是请求的主体——这正说明它值得被单独设计成白名单。373 字节里只有一个 window、一段忙闲、一个待办统计；**没有课程名、教室、记事标题**。

### 2.2b 响应体积：**P08 实测到一次失败**

上面 §一 的"451 字节"是**基准样例**下的数字。它**掩盖了一个真实的缺陷**：
卡片是响应里唯一随输入规模**线性增长**的部分，而基准样例只有一两张卡。

P08 按引导词要求真的去验了一次（构造"一天 300 条课 + 200 条待办"的合法输入）：

| 问法 | 修复前 | 修复后 |
| --- | --- | --- |
| 今天有什么课 | **74,370 字节**（预算的 **2.3 倍**） | 2,345 |
| 今天有冲突吗 | **42,803 字节**（1.3 倍） | 2,936 |
| 今天下午有空吗 | 10,042 | 2,354 |
| 给我今天的简报 | 1,662（**唯一做了上限的**） | 2,393 |
| 这周有几节课 | 2,264 | 2,353 |

**根因**：只有 `handleDailyBrief` 有 `slice(0, 8)`，另外四个 handler 敞着。
§五 早就把"响应超预算 → 查 cards 是否无节制"写成处置预案，**预案存在不等于被执行**。

**修复**：统一 `MAX_CARDS = 12` + `capCards()`。三条设计约束：

1. **截断的是列表，不是结论。** 答案是 `2026-09-30 有 300 节课`，卡片只有 12 张——
   测试 E-2 明确同时断言这两个数字。截断列表却把计数也改掉，就是在骗人。
2. **截断必须写在 `explain` 里。** 可解释性是 §1.4 的创新点之一；静默截断会毁掉它。
3. **一个常量，五个调用点。** 不给每个 handler 各写一个上限——那种写法迟早会漂移。

**这条的教训要保留**：`451 字节`这种"基准样例实测值"**永远不会暴露规模问题**。
量体积时至少要有一个"合法但极端"的输入。

---

## 三 依赖核查（0 个新增运行时依赖）

```
$ grep -n "^import" core/*.ts
core/uni-core.ts:14:            import type { ... } from './types.ts'      ← 唯一的 type-only
core/schedule-reader.ts:            import type { BusySlot } from './types.ts'
                                    import { atLocal, shiftDate, weekdayOf } from './uni-core.ts'
core/local-rules-adapter.ts:        import type { ... } from './types.ts'
                                    import type { ... } from './schedule-reader.ts'
                                    import { ... } from './uni-core.ts'
```

- **全部 import 都指向本仓库自己的文件或 `import type`**：没有 npm 包、没有 `node:` 内置模块、没有网络 SDK。
- **没有 `package.json`、没有 `node_modules`**（`n8n/` 目录下都没有）。
- 运行靠 Node 24 的**原生类型擦除**（`node core/uni-core.ts` 直接可跑），不需要任何构建步骤。
- 测试脚本只用 `node:` 内置模块。

`agent_gateway` / `agent_intent_router` / 三个 Tool / `agent_observability` 六个 Workflow 只用了 `webhook`、`code`、`switch`、`executeWorkflow`、`executeWorkflowTrigger`、`respondToWebhook` 六种**内置**节点——无 LangChain、无 HTTP、无 Redis 节点。这条由测试 Y 组硬断言。

`schedule_query` 在 P07 变成 4 节点，新加的三个都是 `code`，**没有引入任何新节点类型**（G 组与 H 组各有一条白名单断言）。

---

## 四 哪些"已验证"其实只到结构层

`n8n/workflows/` 的 6 个 JSON 通过了**往返核对**（`node tests/roundtrip-check.mjs`，37 项：节点集合 / 类型 / 连接 / `onError` / `jsCode` / `webhook path` / `active:false`）。

**但"导入导出结构没丢"不等于"运行语义正确"**：

| 层次 | 证据 | 状态 |
| --- | --- | --- |
| 结构可导入可导出 | `roundtrip-check.mjs` **45 项** | ✅ 已验证 |
| 路由规则与 UniCore 一致 | 测试 Y 组逐条比对 intent/prio/正则 | ✅ 已验证 |
| 路由分支表与「支持/不支持」名单一致 | Y 组：不得把不支持的意图路由给 Tool；分支名唯一；判据必须按 intent | ✅ 已验证 |
| 每个 Workflow 有**稳定 id**，子流程引用可解析 | Y-7 | ✅ 已验证（P11 新增） |
| `onError` 的**错误支路**必须连线 | Y-8 | ✅ 已验证（P11 新增） |
| 分支节点的**每个输出**必须有落点 | Y-9 | ✅ 已验证（P11 新增） |
| `schedule_query` 的节点 JS 与 `core` 实现**语义等价** | H 组：喂同一份 fixture，`new Function` 跑节点 JS 后与 `FixtureScheduleReader` 逐字段相同 | ✅ 已验证 |
| 周统计口径只存在于本机一处 | H 组（剥掉注释后比对） | ✅ 已验证 |
| **Workflow 在 n8n 里真的跑出正确结果** | **P11：隔离实例 16 场景 + 连打 20 次一致**（`tools/p11-runtime-check.mjs`） | ✅ **已验证（P11）** |

> **P11 的教训（留给以后）**：上面前六行**全都是绿的**，而真实运行仍然一次抓出 **7 个缺陷**——
> 包括两个"整条链路静默什么都不做、HTTP 200 + 空响应体"的。**结构核对与 `new Function`
> 行为等价都不足以证明一条编排链路能跑。** 能跑，只能靠真的跑起来。

**第三行要读准**：它证明的是「两段代码逻辑一致」，执行环境是 **Node 的 `new Function`**，**不是 n8n 的沙箱**。n8n 的 Code 节点有额外的沙箱限制（P03 的 E14 已证实 `$env` 访问默认抛错），所以"等价"不能升级成"能跑"。OQ-12 的口径不变。

比赛 MVP 的实际执行路径是 **UniCore 在本机跑**（`ask()` 已由 317 条断言覆盖，Adapter 链路另有 1,149 条）；n8n 侧是留给扩展的编排骨架，本轮不部署也不执行。这条落差必须写清楚，不能拿结构核对或等价断言冒充运行验证。

---

## 五 超预算时的处置

按 §1.4 原文：**先删除依赖和重复实现，不扩大预算。**

具体到手头这份：

1. **gzip 超 80 KiB** → 先查是不是有人把规则表复制成了第二份（本设计明令只有一处真源）；再查是否引入了格式化库、日期库（`Intl` 已够用，日期运算是手写 6 行）。
2. **请求超 16 KiB** → 查 `busySlots` 是否突破了 20 条上限；查是否把 `title/location/periodLabel` 漏进了胶囊（那是投影 bug，不是预算问题）。
3. **响应超 32 KiB** → 查 `cards` 是否无节制。

> **第 3 条已经在 P08 真的触发过一次**（见 §2.2b）。当时的预案写的是"简报已 `slice(0, 8)`"——
> **那句"已"是错的**：只有简报做了，另外四个 handler 都没做。
> **教训**：处置预案里写"某某已处理"时，要么当天就把它变成一条断言，要么就别写"已"。
> 现在这条由 `run-security-tests.mjs` 的 **E-2** 硬断言（六个问法全部 ≤ 32 KiB 且卡片 ≤ 12）。

---

## 六 APK 增量（本轮做不到）

只有真嵌入后才能测，且**必须用同一构建链的差值**：

```
增量 = build-apk.ps1(含 UniAssistant) − build-apk.ps1(不含 UniAssistant)
```

- **不能**拿"某个包的大小"当增量；**不能**用第三方工具估算。
- 唯一正确的出包方式是 `scripts\build-apk.ps1`（`AGENTS.md` 二·构建与验证）；手跑 gradle 会打出旧 bundle。
- **本轮不改 `build-apk.ps1`**（它只能按字节改，且新增测试文件必须同时登记进 `package.json` 与它——那是 P11 交接后的事）。
