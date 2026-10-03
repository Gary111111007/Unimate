# 执行日志

> 📍 **本机历史证据路径提示**：本文出现的 `C:\Users\...` 与 `F:\A_LIU_Astrspire\...` 均为**本机历史证据路径**——它们记录的是某一刻在这台机器上的真实位置，**不属于交付内容**，换机后自然失效。**可执行说明一律用仓库相对路径。**

按引导词 §三 的统一收尾格式，每阶段一条，最新在上。

> ⚠️ **本文件是历史记录。** 每条里的断言数、场景数是**该阶段当时**跑出来的，**不是当前值**。
> **当前值只看 docs/task-state.md 的「跑测试」一节**（现在是 303 + 405 + 1,221 + 1,052 = 2,981）。
> 历史条目里的数字**保持原样**——它们记录的是"当时是什么样"，回改会让日志失去意义。
状态口径：**已完成 / 部分完成 / 阻塞 / 未开始**。没有运行证据的内容一律写「未验证」。

---

## 四项裁决落地执行结果（2026-09-25，P09 附段）

状态：**已完成**

产品负责人就 OQ-16 / OQ-14 / OQ-05·E12 / D20④ 四项作出裁决。**本轮不改任何 Workflow 运行逻辑**，
所以按 D25 的口径**不需要**为 OQ-16 重跑完整 P11——而 P09 先前确实改过 `agent_gateway`，
那一次的复跑（17 项判定 + 20 次一致 + 执行顺序实测）**已经做过**，见下方 P09 段。

### 一句话结论

四项裁决全部落地，其中**第三项逼出一个真问题**：核对 G1 判据时发现
**`prompts/data-boundary.md` 与实现不一致**——它还停在 P02 时代，写着 `periodLabel` 与
`TodoSummary.title` **可以出网**，而 P02.1 冻结后的实现早就把它们剥掉了。

**所以 G1 没有因为"裁决到了"就被改成通过。** 先修文档、再补断言、再逐条核对。

### 已修改

| 产物 | 内容 |
| --- | --- |
| `prompts/data-boundary.md` | **重写为 v2.0**：§一 写明模型链路关闭（裁决原文）；§2.1 新增**机器可读的 REMOTE-USER-DATA 块**；§2.2 修正"禁止出网"清单（`periodLabel`/`title` 明确在列）；§2.3 补 `userId`/`idempotencyKey` 的地位；§四 如实标注**界面文案未验证**；§五 候选文案标注"未落地" |
| `tests/run-security-tests.mjs` | 新增 **K 组**（10 类断言）：机器可读块 ↔ `request.schema.json` **精确比对**；禁止字段反向扫描；模型链路关闭与"不配置 Key"必须写明；界面文案未验证必须如实标注；全 Workflow 无 LLM 节点；`credentials/` 为空 |
| `docs/open-questions.md` | **OQ-16 关闭**（D30）、**OQ-05 关闭**（D32）、**OQ-14 九目录逐个登记**并保持开放 |
| `docs/decision-log.md` | 新增 **D30 / D31 / D32 / D33** |
| `docs/task-state.md` | G1 三条判据逐条核对；门禁表 G1 行；n5「阻塞」→「比赛版不做」；E12 行；Q3；n8 行；变更记录 |
| 主规划、引导词、`docs/observability.md`、`ops/alerts.md`、`report.md`、`tests/README.md` | 同步 |

### 已验证

1. **四套测试全绿**：`303 + 405 + 1,221 + 1,052 = 2,981` 条断言、0 失败、退出码全 0。安全套件 1,053 → **1,052**：K 组加了 18 条，同时 **I 组改成稳定口径**（每文件只计固定条数，见下）净减 1 条。
2. **K 组变异验证（2 个，全被抓）**：把 `periodLabel` 加回允许清单 → 精确比对 + 反向扫描**双红**；
   从清单删掉 `message` → 精确比对报红并打印两边差异。
3. **K 组的比对不是空转**：推导出的实际字段 9 个，与文档声明**逐项相等**。
4. `git status -- src/ android/ cloudflare/` **为空**；无 n8n 实例在跑；**未创建任何新的隔离目录**（遵守"不要为整理目录制造副本"）。

### 未验证

- **界面文案**：比赛版没有界面，G1 判据第③条**不适用**；候选文案写在 `data-boundary.md` §五，**未落地**。
- **`agent_log` 表未部署** → 不得宣称生产日志持久化。
- **告警通路未接、故障注入未做、故障恢复未验证**。
- **独立 `agent_error_handler` 未建**（D30 裁决）——列为部署阶段可重新评估项。

### 门禁变化（**本轮唯一变化**）

| 门禁 | 变化 | 说明 |
| --- | --- | --- |
| **G1** | ❌ 未通过 → **✅ 比赛范围通过（附保留）** | 三条判据逐条核对后判定，不是机械改绿。**附保留**：含界面文案在比赛版不适用 |
| G0 / G2 / G3 / G4 / G5 | **不变** | G4 仍是比赛范围通过（4 PASS / 2 PARTIAL / 2 N/A）；G5 仍是比赛交付通过、完整验收未通过 |

### 下一步

无阻塞项。剩余全部是**赛后/需授权**：生产部署、Android 嵌入、真机、以及部署阶段重新评估
`agent_error_handler`。OQ-14 的 9 个目录等产品负责人需要清理时按目录二次确认。

---

## P09 执行结果

状态：**部分完成**（比赛范围内可做的部分已做完；`agent_error_handler` 因冲突未建，见 OQ-16）

### 一句话结论

P09 修的不是文档，是**一个真缺陷**：`agent_observability` 一直是**孤儿工作流**——
文件在仓库里、能导入、往返核对也过，但**没有任何节点引用它**，§4.11 的触发 A 从未发生过。

而真正值钱的还是**真实运行**：第一版接线在结构上"正确"、单测全绿，
**隔离实例一跑就现原形**——记录排在了应答之后。

### 已修改

| 产物 | 内容 |
| --- | --- |
| `tools/gen-workflows.mjs` | 网关新增 `Build Log Input` / `Log Request` 两节点，`agent_gateway` 由 6 节点变 **8 节点**；`code()` 助手补 `extra` 参数（原来只收 3 个，传 `onError` 会被静默忽略） |
| `workflows/agent_gateway.json` | 重出：`Shape Response → Build Log Input → Log Request → Respond`；`Respond` 响应体改为表达式引用 `Shape Response` |
| `tools/check-log-order.mjs` | **新增**。从隔离实例的 `execution_data` 里把**真实节点执行顺序**读出来并断言「记录先于应答」；未给 `UNIMATE_ISO_DB` 时 **fail closed**（退出码 2），不静默跳过 |
| `tools/p11-runtime-check.mjs` | 证据目录改由 `UNIMATE_EVIDENCE_DIR` 决定——**绝不能覆盖 P11 的原始证据**（那是 7 个缺陷修复前后的对比基线） |
| `docs/observability.md` | **新增**。指标 / 追踪锚点 / 观测链路设计 / 已知缺口 / 为什么没建 `agent_error_handler` |
| `ops/alerts.md` | **新增**。§9.3 八条告警**逐条标注能否落地**——结论是**零条**可在比赛环境触发 |
| `report.md` | **新增**（此前缺失）。引导词 P11 文件所有权点名的交付物，四栏分写 |
| `tests/run-uni-core-tests.mjs` | 新增 **Y-10 组**（观测链路：非孤儿 / 失败不阻断 / 串接拓扑 / 响应体不被日志污染）+ `yCheck` 助手 |
| `tests/run-security-tests.mjs` | 新增 **D-6 组**（日志输入节点对抗式泄漏测试）；**J-1b**（磁盘上的隔离目录必须都已登记）；J-1 不再硬编码条数 |
| `docs/open-questions.md` | 新增 **OQ-16**；OQ-14 保留目录 4 → **9 条**；OQ-01 版本号与哈希更新 |
| `docs/task-state.md`、`docs/execution-log.md`、`docs/decision-log.md`、`tests/README.md`、`ops/p11-runtime-runbook.md` | 同步 |

### 已验证

1. **四套测试全绿（本轮重跑，非沿用旧数）**：`303 + 405 + 1,221 + 1,034 = 2,963` 条断言，0 失败，退出码全 0。
2. **往返核对**：**48 项通过 / 0 失败**（原 45 项，网关新增的 2 节点 3 连线各占断言）。
3. **隔离实例真实运行**：n8n **2.40.5**，`…\Temp\unimate-n8n-iso-p09-20260925`，端口 **5778**，`N8N_LISTEN_ADDRESS=127.0.0.1`（**未绑 0.0.0.0**）。**17 场景全过 + 固定输入连打 20 次完全一致**。证据 `ops/p09-evidence/runtime-report.json`。
4. **执行顺序实测**（`check-log-order.mjs`，读的是 n8n 自己的执行数据）：
   `Agent Webhook → Precheck Payload → Precheck OK? → Route To Router → Shape Response → Build Log Input → Log Request → Respond` ✔
5. **响应信封未被污染**：16 条响应**逐条**恰好是那 8 个字段，且不含任何日志字段（`request_id` / `latency_ms` / `payload_bytes` …）。
6. **三个变异全被抓**：`onError` 改错（Y-8 + Y-10 双红）、删掉日志节点使观测重回孤儿（Y-10 红）、让日志节点抄 `message`（D-6 三条红）。
7. **gzip 复测仍 10,085 字节（12.3%）**——P09 没有改 `core/`，体积零增长。
8. **凭据扫描 72 个文件 / 12 条规则 / 0 命中**；`git status -- src/ android/ cloudflare/` 为空；无 n8n 实例在跑。

### 未验证

- `agent_error_handler` **未创建**（OQ-16：它会是第 7 个 Workflow，与「比赛 MVP 最多 6 个」冲突）。
- **rollup / 日报未实现**：需要常驻实例，本机隔离实例跑完即停。
- **告警通路未接、零条被触发过**（`ops/alerts.md`）。
- **故障注入未做**（人为制造 5xx / 上游超时 / 日志库失败需要部署）。
- `latency_ms` / `input_length` **恒为 `null`**——本机网关取不到（原因与补法见 `observability.md` §4.3）。
- `agent_log` 表**未部署**，所以"表结构无内容列"成立，**"全表扫描为空"不成立**。
- 延迟 / 命中率 / 成本数字**一律未填**——没有真实流量，填了就是伪造。

### 门禁

**G4 / G5 口径不变**：G4 比赛范围通过（附保留，4 PASS / 2 PARTIAL / 2 N/A）；G5 比赛交付通过、完整验收未通过。
P09 属**赛后路线**（主规划 §16.1 第 2 条、引导词 §一 第 23 行），本轮做的是其中**不依赖部署**的部分，
不构成任何门禁的口径变化。

### 风险与遗留

1. **OQ-16 待裁决**：`agent_error_handler` 建不建、什么时候建。**在裁决前不建。**
   > ✅ **已于 2026-09-25 裁决**：比赛版**不建**（见本文件顶部的「四项裁决落地」段）。本行保留为当时的记录。
2. **观测链路增加了响应路径的长度**：应答现在要等日志子流程返回。本机实测无感（37 次请求全部正常），
   但 §10.2 的「日志写入 200ms」预算**没有实测数据**——这是部署后要量的第一件事。
3. **`check-log-order.mjs` 依赖 n8n 的执行数据格式**（扁平化数组 + `resultData.runData`）。
   n8n 升版若改了存储格式，它会报错而不是静默通过——**这是刻意的**。
4. `report.md` 里引用的往返核对数字（48 项）与 P11 的 45 项不同，因为网关改了；两处都注明了阶段。

### 下一步

等产品负责人裁决 **OQ-16**（`agent_error_handler`）与 **OQ-14**（九个隔离目录的删除确认）。
其余赛后路线（P04 / P05 / P06 / P10）都需要授权或部署前置。

---

## P11 执行结果

状态：**已完成**

最终验收 + **真实 n8n 运行验证**（产品负责人授权在 P11 新建隔离目录）。

### 一句话结论

**P11 比赛交付验收通过；G5 完整验收未通过，保留部署与真机验证项。**

而这一阶段真正的价值不在"通过了"，而在**真实运行一次抓出 7 个只有跑起来才会暴露的缺陷**——
其中两个的症状是 **HTTP 200 + 空响应体**（整条链路静默地什么都不做）。

### 已修改

| 产物 | 内容 |
| --- | --- |
| `tools/p11-runtime-check.mjs` | **新增**。16 个场景 + 固定输入连打 20 次；用 Node 的 `http` 显式发 UTF-8（详见下） |
| `tools/gen-workflows.mjs` | **7 处修复**（见下表）；生成器加了 `WF_IDS`（稳定 id） |
| `workflows/*.json` | 全部重出：网关改为 `Webhook → Precheck → Precheck OK? →(true) Router /(false) Shape`；路由新增 `Build Canonical Args` 与 6 个 Tool 调用 + 兜底落点 |
| `tests/lib/iso-dir-guard.mjs` | **新增**（OQ-15 裁决的 10 条） |
| `tests/roundtrip-check.mjs` | **删掉危险默认目标与 `rmSync`**；改为先校验后动作 |
| `tests/run-security-tests.mjs` | 新增 **J 组（守卫）** 与 A/G 组的 webhook 形状断言 |
| `tests/run-uni-core-tests.mjs` | 新增 **Y-7/Y-8/Y-9**（id 可解析 / 错误支路连线 / 分支有落点） |
| `ops/p11-evidence/runtime-report.json` | **证据**（脱敏：只有 shape 与结果，无任何真实数据） |
| `ops/p11-runtime-runbook.md` | **新增**。复现手册 + 7 个缺陷的清单 |

### 真实运行怎么做的

| 项 | 值 |
| --- | --- |
| n8n 版本 | **2.40.5** |
| 隔离目录 | `C:\Users\Legion\AppData\Local\Temp\unimate-n8n-iso-p11-runtime2-20260925`（**运行前不存在**，守卫校验通过） |
| 端口 | **5778**（非 5678）；`N8N_LISTEN_ADDRESS=127.0.0.1`（**未绑 0.0.0.0**） |
| 数据 | **纯虚构 fixture**；无真实学生数据、无账号、无 Cookie、无密钥、无教务数据 |
| 网关路径 | 真实 HTTP：`POST http://127.0.0.1:5778/webhook/v1/agent` |
| 其余 5 个 | `n8n execute --id <unimate-*>`（n8n 自己的执行引擎，**不是** `new Function`） |

**结果：16 个场景全过；固定输入连打 20 次响应完全一致。**

> **没用的东西**：`new Function` 在那条链路上一次都没被用来"证明运行"。
> 它在 H 组里的作用只是比对**两份实现的语义是否一致**，那是另一回事。

### 【P11 的核心产出】真实运行抓到的 7 个缺陷

**三层验证（结构往返 / 规则一致 / 行为等价）当时全绿，一个都没抓到。**

| # | 缺陷 | 症状 | 修法 | 新增断言 |
| --- | --- | --- | --- | --- |
| 1 | Workflow JSON **没有稳定 id**；`Route To Router` 引用的是**名字** | n8n 导入时自分配随机 id → 引用永远对不上 → 子流程调用失败 | 生成器加 `WF_IDS`，每份 JSON 带稳定 id；引用用同一常量 | **Y-7** |
| 2 | `onError: continueErrorOutput` 却**没有第二个输出连线** | 失败条目被静默丢弃 | 错误支路接到 `Shape Response` | **Y-8** |
| 3 | Switch 的**六个分支一个都没接线** | 子流程没有终止节点 → 父流程收到 0 条 | 每分支接一个 `executeWorkflow`；兜底接 `Mark Unsupported` | **Y-9** |
| 4 | webhook 把请求体放在 `.body` 下，预检直接读 `$input.first().json` | **七个必填字段全部判为缺失**，每个请求都 E_SCHEMA | 先解包 `body`（非 webhook 调用时用原对象） | A 组 |
| 5 | 网关说 `message`、路由读 `text` | 路由永远拿不到用户原话 → 全部 unsupported | 预检产出 `text` | A 组 |
| 6 | **预检失败不短路**，照样往 router 送 | 非法请求被路由、被调 Tool；Tool 的新信封丢掉 `_precheckErrors` → **非法请求返回 success:true** | 加 `Precheck OK?` 布尔分支短路到 Shape | G 组 |
| 7 | `Shape Response` 硬编码 `success: true` | 出现"成功 + 有错误码"的自相矛盾信封（违反 §6.2） | `success` 由结果推导 | D 组 |

**第 6 条最严重**：它让**整个输入校验形同虚设**——`schemaVersion: '9.9'`、`userId: ['u1']`、
胶囊里带课程名，三种都返回了 `success: true`。§13.6 #4 明写"传数组 → 400，**不进 router**"。

**另外补了 §4.2.6 的 `Build Canonical Args`**：路由原先只传 intent、不传日期槽位，
于是每个课表类请求都被 `Clamp Range` 判为"缺少 date"，永远 E_SCHEMA。

### 已验证

| 命令 | 结果 |
| --- | --- |
| `node tests/run-contract-tests.mjs` | **303 通过 / 0 失败** |
| `node tests/run-uni-core-tests.mjs` | **395 通过 / 0 失败** |
| `node tests/run-schedule-adapter-tests.mjs` | **1,213 通过 / 0 失败** |
| `node tests/run-security-tests.mjs` | **957 通过 / 0 失败** |
| **合计** | **2,868 断言全绿** |
| `UNIMATE_ISO_N8N=…unimate-n8n-iso-p11-roundtrip-20260925 node tests/roundtrip-check.mjs` | **45 项通过 / 0 失败**（守卫校验通过后才运行） |
| `node tools/p11-runtime-check.mjs` | **16 场景全过 + 20 次一致** |
| `n8n execute --id <5 个非 webhook 工作流>` | 全部 success（网关由 HTTP 路径覆盖） |
| tsc + gzip | 合并 **10,085 字节 ≈ 9.8 KiB**（预算 80 KiB，**12.3%**） |
| 凭据形态扫描 | 63 个文件，**0 命中** |
| `git status -- src/ android/ cloudflare/` | **空** |

#### 隔离目录守卫的**对抗性实测**（不是单测，是拿真命令去撞）

| 尝试 | 结果 |
| --- | --- |
| 不传 `UNIMATE_ISO_N8N` | ✗ 拒绝（`missing`） |
| 指向保留目录 `n8n-iso` / `n8n-iso-p08` | ✗ 拒绝（`badPrefix` + `reserved`） |
| 相对路径 | ✗ 拒绝（`notAbsolute`） |
| 临时目录之外 | ✗ 拒绝（`outsideTemp`） |
| 前缀不合法 | ✗ 拒绝（`badPrefix`） |

**六个危险调用全部被拦，且没有创建/删除/修改任何东西**；四个保留目录事后仍各有 6 个条目，完好。

### 未验证（**逐条列出，不写成通过**）

- **生产部署**：没有域名、没有反代、没有 TLS、没有 `EXECUTIONS_MODE=queue`。
- **生产鉴权**：网关↔n8n 的 Header Auth **不存在**；`userId` 的权威来源（token）不存在。
- **限流与费用上限**：无实现（`N/A`，OQ-08 数值仍是待校准建议值）。
- **真实数据库 / Redis**：均未部署。n8n 侧用的是实例自带的 SQLite。
- **`agent_log` 全表敏感扫描**：表**没有部署**。
- **Android 嵌入 / APK / 真机**：未嵌入、未出包、未测。`ConfirmDialog` 的现实交互未验证。
- **Cloudflare Worker 网关那一段**：一次都没跑过。
- **跨时区真机**：所有时区验证都是构造的对照。

### 门禁

| 门禁 | 状态 |
| --- | --- |
| G0 环境审计 | ✅ 通过 |
| G1 数据边界 | ❌ 未通过（OQ-05 未关，LLM 分支关闭） |
| G2 接口冻结 | ✅ 通过 |
| G3 比赛 MVP | ✅ 通过（**P11 消除了"n8n 运行未验证"这条保留**） |
| G4 安全 | ✅ 比赛范围通过（附保留） |
| **G5** | **比赛交付验收通过；完整验收未通过**（保留部署与真机验证项） |

**准确表述（照抄）**：
> **P11 比赛交付验收通过；G5 完整验收未通过，保留部署与真机验证项。**

**新口径（OQ-12 关闭，取代旧口径）**：
> **本机 UniCore 与隔离 n8n 实例运行均已验证。**
> 未验证：真实部署、生产鉴权、限流、数据库、Android 嵌入、APK 与真机。

### 风险与遗留

1. **7 个缺陷都是同一个来源**：把"结构对"当成了"能跑"。**这条教训已经写进 `ops/p11-runtime-runbook.md`**——
   以后改 Workflow，跑一次真实实例，不要只看单测。
2. **`success` 的语义现在由结果推导**，但 `data` 的形状仍由各 Tool 自己决定（`schedule_query` 给
   `{from,to,busySlots,firstStart,dropped}`，`notes_*` 给 `{delegatedTo:'local_rules'}`）。**没有统一**——
   客户端解析时要按 intent 分支。这是 §6.2 留下的空间，属**已知的设计选择**，不是缺陷。
3. **`Build Canonical Args` 是 P11 现补的**（§4.2.6 节点 11）。它只做"今天/明天/本周"三档，
   **不解析「下周三」「9月25日」**——那些在词汇表里有规则，但没有对应的槽位产出。
4. **我三次踩到同一个坑**：在生成器的模板字符串里写裸反引号 → 提前闭合。已在代码里就地写了警告。
5. **隔离实例目录增至 7 个**（P11 新增 3 个：破损态证据 `…-p11-runtime-…`、修复后 `…-p11-runtime2-…`、往返核对 `…-p11-roundtrip-…`），**全部保留**，
   P11 结束后统一申请二次确认删除（OQ-14）。

### 下一步

比赛最短路径（P00 → P02 → P02.1 → P03 → P07 → P08 → **P11**）**已走完**。
后续若要继续：P09（可观测性完整化）、P10（部署与演练）——**两者都属赛后路线且 P10 需部署授权**。

---

## P08 执行结果

状态：**已完成**

n7 安全加固。核心不是写文档，而是**为每一类威胁造一个可执行的拒绝用例**——并且真的亲手验证了一遍。

### 已修改

| 产物 | 内容 |
| --- | --- |
| `docs/threat-model.md` | **新增**。先画出"真的在跑"与"只有结构"的分界，再逐条写 T1–T6 六类威胁：资产 / 入口 / 攻击 / 防线 / 证据 / **残余风险**；附 §13.6 八类的适用性判定 |
| `docs/logging-spec.md` | **新增**。日志字段白名单（**机器可读**，D 组直接读它比对）+ `agent_log` DDL（**没有 message 列**）+ 18 个"明确不存在"的字段名作为扫描目标 |
| `ops/security-checklist.md` | **新增**。G4 判据矩阵（8 行）与威胁矩阵（6 行），都是机器可读的；含"P08 实际做的加固"与"明确**不**声称的"两节 |
| `ops/secret-scan-report.md` | **新增**。扫描规则**唯一真源**（H 组按它重跑）；含"为什么空是有意义的"论证 |
| `tests/run-security-tests.mjs` | **新增，852 条断言**，九组 |
| `core/uni-core.ts` | **修一个实测到的缺陷**：卡片数上限 `MAX_CARDS = 12` + `capCards()`，截断时在 `explain` 里说明 |
| `tools/gen-workflows.mjs` → `workflows/agent_gateway.json` | 预检节点**逐层**封闭胶囊 + 可选字符串字段类型校验 |
| `docs/size-budget.md`、`task-state.md`、`tests/README.md`、`open-questions.md`、`decision-log.md` | 同步 |

### 已验证

| 命令 | 结果 |
| --- | --- |
| `node tests/run-contract-tests.mjs` | **303 通过 / 0 失败** |
| `node tests/run-uni-core-tests.mjs` | **352 通过 / 0 失败** |
| `node tests/run-schedule-adapter-tests.mjs` | **1,177 通过 / 0 失败** |
| `node tests/run-security-tests.mjs` | **852 通过 / 0 失败** |
| `UNIMATE_ISO_N8N=…n8n-iso-p08 node tests/roundtrip-check.mjs` | **37 项通过 / 0 失败** |
| tsc + gzip | 合并 **10,085 字节 ≈ 9.8 KiB**（预算 80 KiB，**12.3%**） |
| tsc 类型检查 | 除既有 `TS5097` 外**无输出** |
| `git status -- src/ android/ cloudflare/` | **空** |

#### 【重要】P08 实测发现的缺陷

P08 步骤 6 要求"验证输入长度、**请求/响应体积**"。一验就出问题：

| 输入 | 修复前响应 | 预算 |
| --- | --- | --- |
| 一天 300 条课 + 200 条待办，问「今天有什么课」 | **74,370 字节** | 32,768（**2.3 倍**） |
| 同上，问「今天有冲突吗」 | **42,803 字节** | 32,768（1.3 倍） |

**根因**：卡片是响应里唯一随输入规模**线性增长**的部分，而只有 `handleDailyBrief` 做了 `slice(0,8)`，
其余四个 handler（`today_plan`/`availability`/`conflict`/`week_plan`）敞着。
`size-budget.md` §五 早就把"响应超预算 → 查 cards 是否无节制"写成处置预案，**但预案没被执行**。

**修复**：统一 `MAX_CARDS = 12` + `capCards()`，**截断的是列表不是结论**——
答案里的计数仍是真实的 300（测试 E-2 明确断言 `300 节课` 与 `12 张卡` 同时成立），
截断会在 `explain` 里说明。修后最大响应 **2,936 字节**。

> **文件所有权声明**：`core/uni-core.ts` **不在**引导词 P08 的所有权清单里。
> 选择"就地修"而非"记 Open Question 挂起"，因为它是**缺失的上界**而非契约变更——
> `ActionCard[]` 在任何 schema 里都没有长度限制，修它不动 `schemas/`、不影响 D-9。
> 此处显式声明供复核，与 P03 声明 `tools/` 同等处理。

#### 变异验证（3 个，全部被抓）

| 变异 | 结果 |
| --- | --- |
| M7 卡片上限失效（`MAX_CARDS` 改 99999） | ✅ **9 条报红**（E 组响应体积与卡片数） |
| M8 写入卡不再要求确认 | ✅ **7 条报红**（B 组语料 4 条 + C 组注入） |
| M10 预检不再查忙闲段内部字段 | ✅ **3 条报红**（A 组：课程名/教室/节次越界） |

#### 测试自己犯的错（3 处，都改了）

| # | 错法 | 教训 |
| --- | --- | --- |
| 1 | 用 `Math.floor(i/12)` 造 300 条课，i≥288 时算出 **24 点** → `Date.parse` 判 NaN 后**静默丢弃**，实际只有 288 条 | **造数据的手写公式也会骗自己**。改成"每 4 分钟一条"的推法，并断言计数 |
| 2 | 拿 Adapter 的输出与**裸 `ask()`** 的输出比"身份字段是否影响结果" | 比的其实是"adapter 比裸 ask 多了数据来源行"。**基线必须同源** |
| 3 | 拿"不得声称"的字符串做**全文**扫描，结果扫到了我自己的免责声明 | **扫描类测试最典型的自伤**。缩小到矩阵块，另加一条断言确认免责声明确实存在 |

### 未验证（**与 P07/P07.1 完全一致**）

- **n8n 实例运行**：本轮加固的 `agent_gateway` 预检节点**仍只在 Node 的 `new Function` 里跑过**，
  `agent_observability` 的日志节点同理。**没有任何 Workflow 在 n8n 里执行过**（OQ-12）。
- **`agent_log` 全表扫描**：比赛版**没有部署这张表**。能说的是：日志节点输出与字段白名单**精确一致**，
  且表结构里**没有承载内容的列**——这是"全表扫描为空"的**结构性前提**，**不是它本身**。
- **Android / 真机**：未嵌入、未出包。`ConfirmDialog` 的确认交互未验证。
- **生产部署相关**（越权鉴权、限流、幂等）：比赛版没有这些组件，已在清单里写 `N/A` + 赛后阶段。

### 门禁

**G4：比赛范围通过（附保留）**

> **本机规则、数据胶囊、行动卡确认、输入边界、日志字段及凭据扫描已验证；
> 真实鉴权、重放防护、限流、部署数据库扫描和 Android ConfirmDialog 未验证。**
> **不得写成"完整 G4 全部通过"。**

- §13.6 八类：**4 类 PASS / 2 类 PARTIAL / 2 类 N/A**（PASS = Prompt Injection / 参数污染 / Secret 扫描 / 日志脱敏；PARTIAL = 越权 / 确认绕过；N/A = 重放 / 频率攻击）。
- 逐条有命令、fixture 或无副作用断言证据，全部在 `ops/security-checklist.md` 的机器可读矩阵里。
- **N/A 的两行也有证据**——填的是"确认它确实没有被实现"的断言，不是空白。
- **不以文档评审代替测试**：852 条断言里没有一条是"读一遍文档就算过"。

> **勘误（2026-09-25，产品负责人复核指出）**：本节原先把统计写成 **PASS 5 / PARTIAL 2 / N/A 2**，
> 加起来是 **9 类**，而矩阵只有 8 行。**我数错了**，已按矩阵逐行重算修正。
> 现已在 `run-security-tests.mjs` 的 I 组加了一条断言：**统计数字由矩阵实时算出并与文档里的数字比对**
> ——手写的统计数字不许再出现。
> （注：勘误里必须把旧数字换个写法引述，否则那条断言会把这段勘误本身当成一处错误统计。）

**G3：通过（保留不变）**。P08 的加固不改任何对外行为口径。
**G1 仍未通过**（OQ-05）；**G5 未通过**（P11 未开始）。 【历史状态；OQ-05 已于 2026-09-25 由 D32 关闭，当前状态见 task-state.md】

对外口径**照抄，不要改**：
**「本机 UniCore 纵向链路已验证；n8n Workflow 结构核对通过，n8n 实例运行尚未验证。」**

> ⚠️ **本条口径已被 P11 取代**：P11 已在隔离实例里真实运行全部 6 个 Workflow。请看本文件顶部的 P11 段。


### 风险与遗留

1. ~~卡片上限 12 是经验值，产品上要不要给"看全部"的入口是未决问题。~~
   **已裁决（产品负责人 2026-09-25）**：`MAX_CARDS = 12` 为**正式比赛决策**，四条规则见 decision-log **D20**。
   本轮**不新增**"看全部"引导卡（没有界面能消费它），已有的 `open.schedule` 路径不变。
2. **日志白名单与预检节点的一致性靠 D 组与 A 组各锁一道**，但**日志字段清单在 `docs/logging-spec.md` 里是手写的**，
   与节点代码之间没有生成器。目前靠精确相等断言兜住；若字段变多，应考虑像 `RULES` 那样生成。
3. **secret 扫描的规则刻意不收"通用高熵串"**，理由写在 `ops/secret-scan-report.md` §4.1：
   合成 fixture 必然是这个形状，加进去只会制造恒假阳性，而恒假阳性会训练人忽略扫描结果。
   代价是：**一条没有可识别格式的裸密钥不会被这条扫描抓到**——由"位置检查"（workflow JSON 无凭据值、
   日志无高熵串、`credentials/` 为空）补位。
4. **隔离实例目录增至 4 个**（新增 `n8n-iso-p08`），全部保留，P11 后统一申请删除确认（OQ-14）。
5. **`roundtrip-check.mjs` 的默认目标仍是要保留的 `n8n-iso`** —— 这个设计还会坑人，已记 **OQ-15**。

### 下一步

**P11（n9 之后的最终验收）** —— 但按引导词最短路径，P09/P10 属扩展或赛后路线，且 P10 需要部署授权。
进入 P11 前需产品负责人确认：(a) 最终验收是否只做本机可验证部分；(b) 是否要为一个真实 n8n 运行验证开一次实例。

**P08 是引导词比赛最短路径的倒数第二步。**

---

## P07.1 执行结果

状态：**已完成**

产品负责人裁决的落地阶段：关闭 OQ-11、关闭 OQ-13、维持 OQ-12/OQ-14、把两条时间边界转为正式决策、修正陈旧文档。

### 已修改

| 文件 | 改了什么 |
| --- | --- |
| `core/uni-core.ts` | `schedule.week` **移出** `UNSUPPORTED_INTENTS`；新增 **`handleWeekPlan`** 与 `fmtDate`；`detectCapability` 把 `schedule.week` 接成 `week_plan`；`capsulePurpose('week_plan') → null`；周规则补 `几次课\|几门课\|几门` 三种说法；**删掉一处 TS2367 死比较** |
| `core/types.ts` | `Capability` 新增 `week_plan` |
| `core/local-rules-adapter.ts` | **`scheduleTimezone` 从 `ask()` 输入收口到构造配置**（OQ-13 裁决）；构造函数改为 `LocalRulesAdapterConfig`；`queryWindowFor` 新增 `week_plan`（使用者时区的周一→周日） |
| `tools/gen-workflows.mjs` | 路由 Switch 新增 `schedule.week → schedule_week` 分支；`Build Result` 注释更新（不产出计数的**理由变了**：不再是"未裁决"，而是"口径只许存在一处"） |
| `fixtures/corpus-v1.jsonl` | 30 → **33 条**：**改写 c-015**（原先锁死 `E_UNSUPPORTED`）+ 新增 c-031/c-032/c-033 |
| `tests/run-uni-core-tests.mjs` | 新增 `week` 上下文（8 段→4 次的口径总用例）；**Y 组新增 6 条 Switch 分支断言** |
| `tests/run-schedule-adapter-tests.mjs` | 新增 **I 组（周统计，28 条）**；G 组把 `这周有几节课` 移出「不支持」清单（留着会变成假绿）；H 组新增路由分支断言与「口径只在本机一处」断言；全部 `new LocalRulesAdapter(reader)` 迁到配置对象 |

### 已验证

| 命令 | 结果 |
| --- | --- |
| `node tests/run-contract-tests.mjs` | **303 通过 / 0 失败**（无回归，**D-9 未放宽**，schema 一个字节未动） |
| `node tests/run-uni-core-tests.mjs` | **352 通过 / 0 失败** |
| `node tests/run-schedule-adapter-tests.mjs` | **1,177 通过 / 0 失败** |
| `UNIMATE_ISO_N8N=…n8n-iso-p071 node tests/roundtrip-check.mjs` | **37 项通过 / 0 失败** |
| tsc + gzip | 合并 **9,975 字节 ≈ 9.7 KiB**（预算 80 KiB，用掉 **12.2%**） |
| tsc 类型检查 | **除既有的 `TS5097`（`.ts` 后缀 import）外无输出** —— 类型干净 |
| `git status -- src/ android/ cloudflare/` | **空** |

#### 周统计的验收项（逐条对应裁决）

| 裁决要求 | 落实位置 | 实测 |
| --- | --- | --- |
| 窗口 = 使用者时区本周一 00:00 → 周日 23:59 | `handleWeekPlan` 用 `ctx.tz` 算 `1-wd` 与 `7-wd` | I-1/I-2/I-9 |
| 连续上课时段计一次，不按 periodLabel 拆 | 合并规则 `next.start ≤ cur.end` | I-7（3 段→**2** 次） |
| 不按课程名称去重 | key 里没有课程名 | I-6（同名两时段→**2** 次） |
| 推荐回答「本周共有 N 次课程安排。」 | `answer` 逐字，测试**精确相等**断言 | I-1 |
| explain 说明「按连续上课时段统计」 | `explain[1]` | I-2 |
| 不读待办 | 给/不给待办结论一致，explain 不提待办 | I-10 |
| 不调用网络、不调用 LLM | `source === 'local_rule'`；胶囊为 `null` | I-12 / I-13 |
| 无课时答「本周没有课程安排」 | 空课表分支 | I-4 |
| 不加第七个 Workflow，复用 `schedule_query` | 路由新增 `schedule_week` 分支，Workflow 数仍为 6 | Y-6 / H-4b |
| 不为计数向公开 DTO 加字段 | schema 未动，D-9 未放宽 | 契约测试 303 全绿 |

#### 变异验证（3 个，全部被抓）

| 变异 | 结果 |
| --- | --- |
| M4 首尾相接不再合并（`<=` 改 `<`） | ✅ **2 条报红**（I-7 及 explain 对照） |
| M5 答案改成数原始段数（跳过合并） | ✅ **2 条报红**（I-5a 去重、I-7 合并） |
| M6 删掉路由的 `schedule.week` 分支 | ✅ **2 条报红**（Y-6、H-4b） |

### 抓到的问题

| # | 现象 | 根因 | 说明 |
| --- | --- | --- | --- |
| 1 | `tsc` 报 **TS2367 死比较**（`detectCapability` 里已不可能为真的 `intent === 'schedule.week'`） | 新增了前置的早返回，却没删掉后置条件里的同名分支 | **差点漏掉**：tsc 报错**不阻止 emit**，体积数字一切正常，只有 stderr 有字。这正是 `size-budget.md` §2.1 那条警告的实例 |
| 2 | 我写的往返核对命令**指向了产品负责人要求保留的目录** | `roundtrip-check.mjs` 开头会清空目标目录，而我把 `UNIMATE_ISO_N8N` 又指回了 `n8n-iso-p07` | **被权限层拦下，未造成损失**。改用新目录 `n8n-iso-p071`，并把这条写进 OQ-14 与 `task-state.md` 的醒目位置——**默认目标本身就是要保留的那个**，这个设计迟早还会坑人 |

### 未验证（**与 P07 完全一致，一字未变**）

- **n8n 实例运行**：`schedule_week` 分支、`Schedule Adapter`、`Clamp Range`、`Build Result` 全部**只做过结构核对与 JS 行为等价**，**没有任何 Workflow 在 n8n 里执行过**。
- **Android 嵌入 / APK 增量**：仍未出包。
- **跨时区真机**：I-9 用的是构造的时区对照。
- 已使用的隔离实例目录为 `n8n-iso-p071`，**未删除**。

### 门禁

**G3 复验：通过（保留不变）。** 周统计新增 28 条断言，`source` 仍恒为 `local_rule`，连续 20 次一致仍在测。
**G4 / G5：仍未通过。** P07.1 不触碰任何安全加固或验收内容。

对外口径**照抄，不要改**：
**「本机 UniCore 纵向链路已验证；n8n Workflow 结构核对通过，n8n 实例运行尚未验证。」**

> ⚠️ **本条口径已被 P11 取代**：P11 已在隔离实例里真实运行全部 6 个 Workflow。请看本文件顶部的 P11 段。


### 风险与遗留

1. **合并语义是本阶段唯一"我定的"口径**：首尾相接（零课间）算一次，有 10 分钟课间**不**算。裁决原文只说"连续上课时段"，没说零课间算不算连续——**已按字面（连续）实现并双向钉死测试**，若要改成"零课间也算两次"，改一处 + 两条断言。
2. **窗口的时间点语义**：窗口按**时刻交叠**取段（与 `slotsIn` 一致），因此使用者时区为纽约时，当地周日晚上会包含上海周一上午的课（I-9 的 5 次就是这么来的）。这是既定架构（D11）的必然结果，不是 bug。
3. **跨时区的"本周"仍是按使用者的周**。裁决明确"使用者时区"，所以纽约学生的"本周"和上海学生的"本周"是两段不同的绝对时间。**如果产品上希望"按学校的周"**，那要改裁决，不是改代码。
4. 隔离实例目录增至 **3 个**，全部保留，P11 后统一申请删除确认（OQ-14）。

### 下一步

**P08（n7 安全加固与 G4）**。前置已满足：拒绝路径零读取已有测试、路由分支表有一致性断言、OQ-11/OQ-13 已关闭，OQ-12/OQ-14 不阻塞。

---

## P07 执行结果

状态：**已完成**

### 已修改

**新增（全部在 `F:\A_LIU_Astrspire\t\n8n\` 下，未触碰主工程）**

| 产物 | 内容 |
| --- | --- |
| `core\schedule-reader.ts` | **学校差异的唯一落点**。`ScheduleReader` Interface + **两个真实 Adapter**（`FixtureScheduleReader` 吃「节次 + 周次」的教务形态、`StandardCourseReader` 吃统一 `Course`）+ `NullScheduleReader`（显式空实现）。gzip **1,789 字节** |
| `core\local-rules-adapter.ts` | 把「读课表」与「答问题」接起来：先判意图（**不读数据**）→ 按能力算最小窗口 → 只读该窗口 → 交给 UniCore → 追加「数据来源」行。gzip **1,134 字节** |
| `fixtures\schedule-fixture-a.json` | 学校形态课表样例：节次表 10 节 + 5 行课程（含单双周、周次区间）。**明确标注为自造样例，不代表任何真实高校** |
| `tests\run-schedule-adapter-tests.mjs` | **1,149 断言**，八组（seam 等价 / 五个操作 / 跨周节次 / 空与非法 / 时区边界 / P-01 P-02 / 零网络 / n8n 行为等价） |

**修改**

| 文件 | 改了什么 | 为什么 |
| --- | --- | --- |
| `core\uni-core.ts` | ① `ResolvedTime` 新增 `basis`，四类日期敏感回答的 `explain` 加「日期依据」行；② 修 `resolveTime` 的范围覆盖条件；③ 修 `handleDailyBrief` 的日期；④ `todayIn`/`offsetOf`/`fmtTime` 加 Invalid Date 防护 | ①②③ 是测试抓到的真 bug（见下）；④ 是把「不抛异常」这条口头契约变成真的 |
| `tools\gen-workflows.mjs` | `schedule_query` 从占位骨架改成真 Adapter：`Input → Clamp Range → Schedule Adapter → Build Result` 四个节点 | §4.7 要求「学校差异**全部**在 Adapter 里」，节点 5 就是那个落点 |
| `workflows\schedule_query.json` | 由生成器重出（2 节点 → 4 节点） | 同上 |
| `fixtures\corpus-v1.jsonl` | 28 条 → **30 条**（c-029/c-030 锁住本轮两个真 bug） | 防止回归 |
| `tests\roundtrip-check.mjs` | 修注释：原写「目录留着不删」，实际开头就会**清空重建** | 这条注释与行为不符，正好会踩到「不许删 `Temp\n8n-iso`」的约束 |
| `docs\size-budget.md` | 补 P07 实测值与「哪些已验证只到结构层」 | — |
| `docs\android-embed-contract.md` | 新增 §五 ScheduleReader seam 与 Android 对接点 | — |
| `p5-assistant\NOTES.md` | 追加 P07 的未来 Android 对接点 | 引导词 P07 步骤 7 |

### 已验证

| 命令 | 结果 |
| --- | --- |
| `node tests/run-contract-tests.mjs` | **303 通过 / 0 失败**（无回归） |
| `node tests/run-uni-core-tests.mjs` | **317 通过 / 0 失败**（303 + 新增语料 14） |
| `node tests/run-schedule-adapter-tests.mjs` | **1,149 通过 / 0 失败** |
| `UNIMATE_ISO_N8N=…n8n-iso-p07 node tests/roundtrip-check.mjs` | **37 项通过 / 0 失败**（+2，`schedule_query` 多了两个 Code 节点） |
| tsc 构建 + gzip | `uni-core.js` **7,310** + `schedule-reader.js` **1,789** + `local-rules-adapter.js` **1,134**；按依赖顺序合并后 **9,475 字节 ≈ 9.3 KiB**（目标 81,920，用掉 **11.6%**） |
| `git status -- src/ android/ cloudflare/` | **空** → 主工程未越界 |
| 隔离实例目录 | 用 `UNIMATE_ISO_N8N` 另起 `Temp\n8n-iso-p07`，**P03 的 `Temp\n8n-iso` 原样未动** |

#### 变异验证（3 个，全部被抓）

| 变异 | 埋在哪 | 结果 |
| --- | --- | --- |
| M1 周次展开整体偏移一周（`(w-1)*7` → `w*7`） | `core/schedule-reader.ts` | ✅ **16 条报红**（A/C/D 组） |
| M2 撤掉 `resolveTime` 的范围覆盖保护 | `core/uni-core.ts` | ✅ **4 条报红**（F 组 P-01 全部） |
| M3 workflow 侧忽略课表时区（`atLocal(schedTz,…)` → `atLocal(tz,…)`） | `tools/gen-workflows.mjs` | ✅ **1 条报红**（H 组跨时区等价） |

#### 测试抓到的 bug（全部是我写的）

| # | 现象 | 根因 | 严重度 |
| --- | --- | --- | --- |
| 1 | **「本周三下午有空吗」→ 答了今天而不是周三** | `resolveTime` 末尾的「本周 = 整周范围」规则会**覆盖**前面已解析出的单日结果；「本**周三**」里也含「本周」，于是 `date` 被清成 `null`，所有日级能力退回今天 | **高**。§1.4 九十秒演示第 3 句就是「周三下午有空吗」，换个说法就错 |
| 2 | **「给我明天的简报」→ 报的是今天** | `handleDailyBrief` 固定用 `todayIn()`，`resolveTime` 算出的日期没用上；且 `upcoming` 以 `now` 为界，未来那天的课会被判成"已过" | **高**。同一类错：日期算了但下游没用 |
| 3 | **非法日期让 `atLocal` 抛 `RangeError`** | `Intl.DateTimeFormat.format()` 拿到 Invalid Date 直接抛；而本模块的契约是「不抛异常」——那条契约原先只是"打算这么写" | **高**。`ask()` 里 `new Date(req.now)` 若是坏值，同样会抛 |
| 4 | `constructor(private readonly x)` 无法加载 | Node 24 的原生类型擦除是 **strip-only** 模式，parameter property 是**真代码**不是类型，直接抛 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` | 中。这是一条**新的硬约束**：`core/` 下所有类都要显式声明字段 |
| 5 | 跨时区时「明天」会答错一天 | 课表时刻锚在**学校时区**、查询窗口锚在**使用者时区**，原先二者混用同一个 `timezone`，按日期字符串过滤必然偏一天 | 中。见下「设计决定」 |

另有 **2 个是测试自己写错**（把 reader 当结果用、把「闲聊/记事查询」和「不支持」混成一类），已修。

### 设计决定（本阶段新增，需产品负责人知悉）

**`ScheduleQuery` 拆出 `scheduleTimezone`**（可选，缺省 = `timezone`），窗口判定从「日期字符串落在区间里」改为「**时刻交叠**」。

- 理由：课表上的「周三 10:00」是**学校当地时间**；用户问的「明天」是**他自己所在地的明天**。两者不同时，按日期过滤会整体偏一天。
- 实证已写进测试（E 组）：漏声明课表时区时，同一节课的瞬间**偏 12 小时**。
- **没有动任何已冻结的 schema**——这是 P07 新定义的 seam 接口，不是 Layer B 契约。
- 由此产生的**新缺口记入 OQ-13**：Layer A 的 `UniRequest` 里**没有承载"学校时区"的字段**，P11 接 Android 时需要。

### 未验证

- **n8n 实例运行**：`schedule_query` 的四个节点从未在 n8n 里执行过。H 组证明的是「节点 JS 与 core 实现**语义等价**」（用 `new Function` 在 Node 里跑同一段 JS），**不是**「Workflow 在 n8n 里跑通了」。OQ-12 的口径不变。
- **Android 嵌入**：本轮不出 APK、不改 `src/`，APK 增量仍为未验证。
- **真实高校课表**：`schedule-fixture-a.json` 是**自造样例**。没有任何一份真实教务数据被导入、解析或外发；`FixtureScheduleReader` 吃的是**已结构化的行**，不含选择器、不解析 HTML。
- **天气 / 二课**：仍为 `E_UNSUPPORTED`，网络调用次数为 **0**（源码扫描 + 计数 reader 双重断言）。

### 门禁

**G3 复验：通过（保留不变）**
- 新增证据：五个操作在**两个不同 Adapter** 下答案一致；`llmUsed === false` 等价断言（`source` 恒为 `local_rule`）覆盖全部用例；确定性断言扩展到 reader 层。
- **保留项一字未动**：n8n 侧仍只有结构验证，**G3 的「n8n 运行未验证」保留继续成立**。
- 对外口径（照抄，不要改）：**「本机 UniCore 纵向链路已验证；n8n Workflow 结构核对通过，n8n 实例运行尚未验证。」**

> ⚠️ **本条口径已被 P11 取代**：P11 已在隔离实例里真实运行全部 6 个 Workflow。请看本文件顶部的 P11 段。


> ⚠️ **本条口径已被 P11 取代**：P11 已在隔离实例里真实运行全部 6 个 Workflow。请看本文件顶部的 P11 段。


**G4 / G5：仍未通过**（P08 / P11 未开始）。**P07 完成不消除 G3 的保留，也不提前点亮任何门禁。**

### 风险与遗留

1. **两份实现**（`core/schedule-reader.ts` 与 `workflows/schedule_query.json` 里的 `Schedule Adapter`）——n8n Code 节点跑在沙箱里，不能 import 本仓库的 TS，所以只能分开。防漂移靠 H 组的**行为等价断言**，M3 变异已验证它有效。这是**结构性的**，不会因为"写得更小心"而消失。
2. **`clamp` 的 31 天上限口径**：实现为「含端点最多 31 个自然日」（`to - from ≤ 30`）。主规划 §4.7 只写"上限 31 天"，未说含不含端点——**已按含端点实现并在测试里钉死**，若口径不同需改一处 + 一条断言。
3. **`next_class` 的窗口是「今天起 7 天」**。一周内没有后续课程会如实说"没有找到后续课程"，而不是继续往后找。这个截断是刻意的（避免无限放大读取范围），但**产品负责人应当知道这条边界**。
4. **临时实例目录现在有两个**：P03 的 `Temp\n8n-iso` 与 P07 的 `Temp\n8n-iso-p07`。两者都**未删除**，删除前需二次确认。
5. **跨时区的真机行为未验证**：E 组用的是构造出来的时区对照，没有任何一台设备在非 `Asia/Shanghai` 下真实跑过。

### 下一步

按引导词比赛最短路径（P00 → P02 → P02.1 → P03 → **P07** → **P08** → P11），下一阶段是 **P08（n7 安全加固与 G4）**。

前置已满足：G3 通过（保留不变）、seam 有两个实现、拒绝路径零读取已有测试。OQ-11 / OQ-12 / OQ-13 均不阻塞 P08。

---

## P03 执行结果

状态：**已完成**

### 已修改

**新增（全部在 `F:\A_LIU_Astrspire\t\n8n\` 下，未触碰主工程）**

| 产物 | 内容 |
| --- | --- |
| `core\types.ts` | Layer A DTO 逐字转写 §1.4。**只出类型**，擦除后是 11 字节空壳 |
| `core\uni-core.ts` | 规则引擎：意图规则表、文本/时间归一化、**六项能力**、胶囊投影。gzip **6,917 字节** |
| `workflows\` × 6 | `agent_gateway` / `agent_intent_router` / `notes_query` / `notes_create` / `schedule_query` / `agent_observability` |
| `tools\gen-workflows.mjs` | **从 UniCore 的 RULES 生成 Workflow**——规则只有一处真源，避免两套手写漂移 |
| `fixtures\corpus-v1.jsonl` | 28 条固定语料 |
| `tests\run-uni-core-tests.mjs` | 303 断言（语料 / 确定性 / 胶囊投影 / 安全 / 路由一致性） |
| `tests\roundtrip-check.mjs` | 往返核对：隔离实例导入→导出→35 项结构比对 |
| `docs\size-budget.md` | 目标 → **实测**（首次有真数字） |

**`tools/` 不在引导词 P03 的文件所有权清单里**——它是为满足「UniCore 与 n8n 路由输出一致」这条完成标准而加的开发工具，在此显式声明。

### 已验证

| 命令 | 结果 |
| --- | --- |
| `node tests/run-contract-tests.mjs` | **303 通过 / 0 失败** |
| `node tests/run-uni-core-tests.mjs` | **303 通过 / 0 失败** |
| `node tests/roundtrip-check.mjs` | **35 项通过 / 0 失败**（隔离实例，`~/.n8n` 未被触碰） |
| tsc 构建 + gzip | `uni-core.js` 24,241 字节原始 → **6,917 字节 gzip**（目标 81,920，用掉 8.4%） |
| 请求 / 响应体积 | 请求 **610 字节**（目标 16,384）/ 响应 **451 字节**（目标 32,768） |
| 运行时依赖 | `grep "^import" core/uni-core.ts` → **只有一条 `import type`**，0 个新增运行时依赖 |
| `git status -- src/ android/ cloudflare/` | **空** → 主工程未越界 |

#### 测试抓到的 6 个真 bug（全部是我写的）

这一轮的价值几乎全在这里。**没有一个是"设计如此"**：

| # | 现象 | 根因 | 严重度 |
| --- | --- | --- | --- |
| 1 | 「下一节什么课」→ unsupported | 规则表只按「时间词 + 课表词」匹配，这句**没有任何时间词** | 高（这是 §1.4 演示第 1 句） |
| 2 | 「我今天还有什么」→ unsupported | 规则里只有「什么课」，没有「还有什么」 | 中 |
| 3 | **「今晚 8 点交高数作业」→ unsupported** | 规则只匹配「记一下」这类显式指令词，**不认裸任务陈述** | **最高**——这是九十秒答辩第 2 句的原句，最该演示的一句反而失灵 |
| 4 | 「今晚 8 点」算出 **08:00** | `resolveClock` 只认「晚上」，不认「**今**晚」。**差一个字的用词，提醒就会在早上八点响** | 高 |
| 5 | 「三点」完全解析不出 | 只认阿拉伯数字，不认中文数词。中文口语里「三点」比「3点」更常见 | 高 |
| 6 | 「我的待办有哪些」→ unsupported | `notes.query` 规则枚举了「有什么待办」但没覆盖语序变体 | 中 |

**还有 2 个是我测试代码自己的错**：

- `c-028` 的时区用例**原本不具决定性**——两种时区算出来都是"没课"，测不出东西。改成"课只排了纽约的 10/01"之后才真的能区分。**并做了一次变异验证**：把 `ask()` 的时区硬编码成服务器时区 → c-028 变红 ✓
- `roundtrip-check.mjs` 用 `execFileSync('n8n', ...)` 在 Windows 上调不动 `.cmd` 外壳 → 加 `shell: true`，并**把真实错误打出来**（原先只吞成一句"导入失败"，排查时等于没信息）

#### 变异验证（延续 P02.1 的做法）

| 变异 | 结果 |
| --- | --- |
| 时区硬编码成服务器时区 | ✅ 抓到（c-028 红） |
| 手改路由 JSON 里一条规则的 `prio`（绕过生成器直接改文件） | ✅ 抓到（Y 组「规则漂移」红） |
| 还原后复跑 | 303 / 0 |

### 未验证

- **n8n 侧只有结构验证，没有运行验证。** 6 个 Workflow 从没真的执行过——比赛 MVP 不部署 n8n，实际执行路径是 UniCore 在本机跑（已由 303 条断言覆盖）。**这一条必须与"结构核对通过"分开写**，见 OQ-12。
- **APK 增量、UI 交互深度** —— 未嵌入、未接 UI，保持未验证。
- **`schedule.week`（这周几节课）不实现** —— README 的旧验收项，不在 §1.4 的能力清单里。返回 `E_UNSUPPORTED` 而不是糊弄，见 OQ-11。
- **真机** —— 未跑。

### 门禁

- **G3 比赛 MVP：通过（附保留）**
  - 判据（§十二）：「高频问题端到端可答」→ ✅ UniCore 端到端可答（28 条语料覆盖六项能力 + 空数据 + 冲突 + 歧义 + 注入 + 时区）
  - 「`llmUsed === false`」→ ✅ X 组硬断言 `source` 恒为 `local_rule`，永不为 `llm_fallback`
  - 「连续跑 20 次结果一致」→ ✅ V 组 5 个用例各跑 20 次逐字节比对
  - **保留**：判据里的"端到端"若指**经 n8n 的纵向链路**，则未运行验证（OQ-12）
- G1 仍未通过（OQ-05 保持未关闭，LLM 仍禁用）；G4/G5 未通过。 【历史状态；OQ-05 已于 2026-09-25 由 D32 关闭，当前状态见 task-state.md】

### 风险与遗留

1. **OQ-11**（这周几节课）：README 的三类验收项现在只有一类被覆盖。责任人：产品负责人。
2. **OQ-12**（n8n 无运行验证）：答辩不能声称"n8n 跑通了"。责任人：产品负责人。
3. **`tools/gen-workflows.mjs` 是新增的工作流** —— **绝不能手改 `workflows/*.json`**，改了要么重跑生成器、要么 Y 组会红。这条已写进 `tests/README.md` 的维护约定。
4. **隔离实例目录 `C:\Users\Legion\AppData\Local\Temp\n8n-iso` 还在**（几百 KB，含一个 SQLite）。按 P01 停止条件，**删除前需确认**——待产品负责人发话。

### 下一步

按引导词比赛最短路径（P00 → P02 → P02.1 → **P03** → P07 → P08 → P11），下一阶段是 **P07（n6 —— 比赛版课表 Adapter）**。

前置已满足：G3 通过、UniCore 可跑、语料与测试齐备。

---

## P02.1 执行结果

状态：**已完成**

### 已修改

**契约（主规划 v2.3.2 §1.4 / §6.1 / §6.2）**

- `schemas\request.schema.json`：`schemaVersion` 升 **1.1**；新增可选 `contextCapsule`（白名单 5 项：`projectionVersion` / `purpose` / `window` / `busySlots`≤20 / `todoStatus`），逐层 `additionalProperties: false`
- `schemas\response.schema.json`：`schemaVersion` 升 **1.1**
- `schemas\uni-assistant-bridge.schema.json`：`BusySlot`／`TodoSummary`／`ActionCard` 换成 **§1.4 正式字段**，**移除全部【推断】标注**
- **`tool.*.schema.json` 未动**（继续 1.0）——这是刻意的版本策略，见 `api-spec.md` §六

**fixtures**

- `request.cases.mjs`：8 正例 + **27 反例**（其中 14 条专打胶囊黑名单）
- `response.cases.mjs`：升 1.1，新增 i-07（旧 1.0 响应被拒）
- `bridge.cases.mjs`：重写为正式 DTO，含 i-04（旧 `date/start/end` 字段名必须被拒）
- **`invariants.cases.mjs`（新增）**：8 条合规 + 10 条违规，覆盖 6 条不变量规则

**tests**

- `lib\invariants.mjs`（新增）：6 条跨字段不变量的实现
- `run-contract-tests.mjs`：新增 **E 组**（不变量 + 规则覆盖度）、**D-6**（Layer B 版本一致性）、**D-7**（胶囊接线与封闭性）、**D-8**（DTO 正式化）、**D-9**（白名单精确性）

**docs**

- `android-embed-contract.md`：新增 §四「胶囊投影规则」逐字段映射表 + 三道防线
- `api-spec.md`：升 1.1；新增 §六「版本策略」（两套版本号互不牵连）
- `open-questions.md`：OQ-09／OQ-10 改为**已裁决并落实**，保留决策历史
- `task-state.md`：G2 恢复为**通过**

### 已验证

| 命令 / 操作 | 结果 |
| --- | --- |
| `node tests/run-contract-tests.mjs` | **303 通过 / 0 失败**，退出码 0 |
| 用例构成 | 61 正例 + 129 反例 + 18 不变量 + 95 结构性断言 |
| `grep` 查用例 id 重复（文件内） | 无 |
| `ls workflows/` | **0** → 未创建 Workflow |
| `ls n8n/core/` | 不存在 → **UniCore 未创建**（P03 的事） |
| `git status -- src/ android/ cloudflare/` | **空** → 主工程未越界 |

#### 变异验证（P02.1 步骤 9）

故意埋三个缺陷，看测试能否抓到；每项测完即还原。

| 变异 | 内容 | 结果 |
| --- | --- | --- |
| **M1** | 把 `title` 加进胶囊忙闲段的白名单（`CapsuleBusySlot.properties.title`） | ❌ **第一次没抓到**——303 条全绿。**这是本次最有价值的发现**，见下 |
| **M2** | 把 `noteCreateRequiresDraftAndConfirm` 不变量实现成空函数 | ✅ 抓到，3 条红（x-06 / x-07 等） |
| **M3** | 把旧版本 `"1.0"` 放回 `schemaVersion` 白名单 | ✅ 抓到，3 条红（request i-07、response i-07 等） |
| 还原后复跑 | — | 回到 303 / 0 |

**M1 的洞是真的，已补两道防线并重验：**

1. **具体反例**：`request.cases.mjs` 新增 i-20（忙闲段里塞 `title`）与 i-21（塞 `name`）——`title` 正是课程名/记事标题最常见的写法，原用例集里恰好没有。
2. **结构性断言 D-9（更彻底）**：断言 `capsule`、`capsule.busySlots.items`、`capsule.todoStatus`、`BusySlot`、`TodoSummary`、`ActionCard`、`ActionCard.noteDraft` 这七处的字段集合**恰好**等于预定清单——**多一个少一个都报红**。逐字段补反例是打地鼠，永远追不上；精确集合断言才是数据边界该有的最后一道防线。

重验 M1：现在被**两道独立防线同时抓住**（A 组 i-20 + D 组 D-9），已还原。

**过程中另外修掉的两个自身错误**：

- `request.cases.mjs` 的 i-01 用了 `{ ...BASE, message: undefined }`——键还在，命中的是 `type` 断言而非 `required` 断言，测的不是"缺字段"。改用 `omit()` 真正删键。（**同一个坑我在 P02 已经踩过一次**——所以这次把它写成了具名 helper，不再用 `undefined` 顶替。）
- D-7 直接读 `items.additionalProperties`，但封闭性写在被 `$ref` 引用的 definition 里 → 断言读到 `undefined`，**假红**。新增 `resolveRef()` 先解引用。

### 未验证

- **`UniCore` 仍未实现**（P03）：§13.2 的 27 条规则与时间用例、§13.5 的端到端降级用例**都还没跑**。
- **`size-budget.md` 的所有数值仍是目标**，不是实测。
- **真机项**未跑。
- **`capsule.projectionStripped` 只测了不变量本身**，真正的投影函数要到 P03 写 `N8nAdapter` 时才有实现可测。

### 门禁

- **G2 接口冻结：通过**（P02.1 复验后恢复，P02 的保留已解除）
  - 「`schemas/` 全套存在」→ ✅ 14 个
  - 「每个 schema 有正例与反例且测试通过」→ ✅ 303 断言全绿
  - 「错误码表覆盖全部 `errorCode`」→ ✅ D-3
  - 「§13.1 的形状断言函数通过」→ ✅ response i-01/i-02 双向锁死 7 字段
  - **v2.3.2 新增判据**：胶囊与三个 DTO 的白名单由 **D-9 精确集合断言**锁死（这正是 M1 逼出来的）
- G1 仍**未通过**（E12 未确认，OQ-05 保持未关闭，LLM 仍禁用）；G3–G5 **未通过**。 【历史状态；OQ-05 已于 2026-09-25 由 D32 关闭，当前状态见 task-state.md】

### 风险与遗留

1. **`operation` 是 v2.3.2 新引入的字段**，P03 的 `UniCore` 必须产出它；三条不变量已有测试兜着，但**实现还没有**。
2. **D-9 的精确集合断言会在每次"有意扩字段"时报红** —— 这是设计意图，不是噪音。扩字段时应当**同时**改 schema 与 D-9 的期望清单，且必须能引用主规划的具体章节。**不要**为了让测试变绿而放宽断言。
3. **两套版本号（Layer B 1.1 / Tool 1.0）容易混** —— 已经在 `api-spec.md` §六 单列一节。P03 写 Tool 子工作流时，Tool 的 `schemaVersion` 仍写 `1.0`。
4. **OQ-01（两份主规划漂移）仍未关闭** —— `t\` 那份还是 v2.1.1。本轮一律以 `chatgpt produce\` 的 **v2.3.2** 为真源。

### 下一步

**P03（n2 —— 无 LLM 的 MVP 纵向切片）。** P02.1 的前置已全部满足：Layer B 升 1.1、`contextCapsule` schema 与正反例落地、三个 DTO 去掉【推断】并落实跨字段不变量、Android 映射表同步、全量 0 失败、变异验证可抓回归且已还原、**G2 恢复通过**。

OQ-05（E12）**保持关闭 LLM，不阻塞 P03** —— P03 全流程不接模型。

---

## P02 执行结果

状态：**已完成**

### 已修改

**新增（全部在 `F:\A_LIU_Astrspire\t\n8n\` 下，未触碰主工程）**

- `schemas\` 14 个：`request` / `response` / `error` / `intent` / `uni-assistant-bridge` / `tool.notes.{create,query,update,delete}` / `tool.{schedule,weather,records}.query` / `cache.key` / `confirm-token`
- `fixtures\contract-cases\` 14 个 `.cases.mjs`，共 **151 条用例（53 正例 + 98 反例）**，每条反例都带 `expect` 注明**预期失败在哪个约束上**
- `tests\`：`run-contract-tests.mjs`（运行器）、`lib\mini-schema.mjs`（无依赖 JSON Schema 子集校验器）、`fixtures\runtime-validate-llm-output.js`（主规划 §4.2.5 的逐字抄本）、`README.md`
- `prompts\data-boundary.md`
- `docs\` 新增 5 份：`api-spec.md` / `android-embed-contract.md` / `decision-log.md` / `size-budget.md`（+ 更新 task-state / open-questions / 本文件）

**未新增**：`workflows\` 仍为 **0 个文件**（P02 不创建 Workflow）。

### 已验证

| 命令 | 结果 |
| --- | --- |
| `node tests/run-contract-tests.mjs` | **204 通过 / 0 失败**，退出码 0 |
| 反向对照：故意删掉 `response.schema.json` 的 `required: ["errorCode"]` 后重跑 | **测试报红**，精确指出 `response.cases.mjs :: i-01` 未失败在预期约束上 → 证明测试真能抓回归；已还原 |
| `grep` 检查 tests 的 import | 除本地 `./lib/mini-schema.mjs` 外**只用 `node:` 内置模块** → 无外部依赖成立 |
| `grep` 统计用例 | 正例 53、反例 98 |
| `ls workflows/` | 0 → 未创建 Workflow |
| `git status -- src/ android/ cloudflare/` | **空** → 主工程未越界 |

**测试内容**（四组，见 `tests/README.md`）：A schema×fixture、B 校验器自测（20 类违规 + 6 类不误报）、C 数据胶囊（姓名/学号/照片/整份课表/记事正文五类必须被拒）、D 跨文件一致性（intent 枚举、errorCode 枚举、`x-error-table` 覆盖、**F3 运行时 vs schema 一致性**、schema 关键字全覆盖）。

**过程中测试抓到的真问题 2 个**（都已修，不是"设计如此"）：

1. **限流键时间戳单位写错**：我把 `rl:v1:...:{windowTs}` 的位数区间写成 `{10,13}`（秒/毫秒），但主规划 §4.1 的实际代码是 `Math.floor(Date.now()/60000)` —— **单位是分钟**。已改为 `{8,9}` 并把秒值、毫秒值都加成反例。
2. **一条反例写得无效**：`{ ...RESP, offlineCapable: undefined }` 里键仍在（值为 `undefined`），命中的会是 `type` 断言而不是 `required` 断言，测的就不是"缺字段"这件事。已改用解构真正删键。

### 未验证

- **`UniCore` 还没实现**（P03 的事），所以 §13.2 的 27 条规则与时间用例、§13.5 的端到端降级用例**都还没跑**。
- **`size-budget.md` 里的所有数值都是目标**，不是实测；唯一"已验证"的一项是"当前没有引入任何新依赖"这个**事实**。
- **真机项**未跑。
- **OQ-09 未决** → `N8nAdapter` 的出站投影不完整，依赖远端上下文的空档/冲突能力目前只能走本机。

### 门禁

- **G2 接口冻结：通过（附保留）**
  - 判据逐条（主规划 §十二）：
    - 「`schemas/` 全套存在」→ ✅ 14 个文件，覆盖 §6.5 清单 + §1.4 的 bridge
    - 「每个 schema 有正例与反例且测试通过」→ ✅ 14/14 都有 `.cases.mjs`，204 断言全绿
    - 「错误码表覆盖全部 `errorCode`」→ ✅ D-3 断言 `x-error-table` 覆盖 `error.schema.json` 的全部 15 个码
    - 「§13.1 的形状断言函数通过」→ ✅ `response.cases.mjs` 的 i-01（缺字段）与 i-02（多字段）双向锁住"恰好 7 字段"
  - **保留**：OQ-09 使"调用方只依赖稳定接口"这条在**远端上下文能力**上暂不成立。保留不等于未通过——Layer B 契约本身是完整冻结且测过的。
- G1 仍**未通过**（E12 未确认）；G3–G5 **未通过**。 【历史状态；OQ-05 已于 2026-09-25 由 D32 关闭，当前状态见 task-state.md】

### 风险与遗留

1. **OQ-09（数据胶囊无字段位置）** —— 责任人：产品负责人。**它阻塞 P03 里依赖远端上下文的空档/冲突能力**。默认安全行为已定：不发上下文，本机兜住。
2. **OQ-10（三个类型定义是推断）** —— 责任人：产品负责人。**现在确认的成本远低于 P03 之后**（只改一个 schema 文件；调用方尚未实现）。
3. **自写校验器的固有风险** —— `mini-schema.mjs` 是我写的，可能"太松"导致假通过。已用 B 组自测 + 一次反向对照对冲，但**它不等价于一个成熟的 draft-07 实现**。已用 D-5 兜住"写了关键字却没人校验"这一具体情形。
4. **`cache.key.schema.json` 的位数区间是个约定，不是标准** —— 用 `{8,9}` 区分分钟/秒/毫秒是**我们定的**，不是 JSON Schema 能表达的单位语义。改动时要连带改测试。

### 下一步

**P03（n2 —— 无 LLM 的 MVP 纵向切片）。** G2 已通过，P03 的前置满足。

进入 P03 前需要产品负责人回答的**最小问题集合**（都可以先按默认值开工，但越早确认越省）：

1. **OQ-09**：数据胶囊走哪条路？默认 = **不发上下文，远端只收 `message`**。
2. **OQ-10**：`BusySlot` / `TodoSummary` / `ActionCard` 的字段定义是否认可？默认 = 按 `uni-assistant-bridge.schema.json` 的推断执行。
3. **OQ-05（E12）**：仍然关闭 LLM —— P03 **不需要它**，不阻塞。

---

## P00 执行结果

状态：**已完成**

> 收尾更新（2026-09-25）：原为「部分完成」，唯一未满足的判据是「没有启动或部署服务」。产品负责人已裁决 OQ-03 为「立即停止」，该实例与其 task runner 子进程已终止，`5678` / `5679` 释放，本地库未受影响。**全部判据现已满足。**

### 已修改

- `F:\A_LIU_Astrspire\t\n8n\docs\task-state.md`：新建。n0–n9 阶段状态表、G0–G5 门禁判据追溯、Q1–Q9 与 P-01/P-02 状态、当前事实声明、比赛范围声明、目录与主仓库现状。
- `F:\A_LIU_Astrspire\t\n8n\docs\open-questions.md`：新建。收录 8 个会改变实现或阻塞门禁的问题（4 个冲突/不一致 + 4 个待决策），每题含责任人、影响、**默认安全行为**。
- `F:\A_LIU_Astrspire\t\n8n\docs\execution-log.md`：新建（本文件）。
- `F:\A_LIU_Astrspire\t\n8n\{docs,prompts,schemas,workflows,fixtures/contract-cases,tests,credentials,ops}\`：新建空骨架目录。**未生成任何业务 Workflow、schema 或提示词文件。**
- `F:\A_LIU_Astrspire\A_competition\UnimateUL\p5-assistant\NOTES.md`：仅追加一条接手记录，指向上述状态文件。未改动其他内容，保留了他人已有的表格排版改动。

### 已验证

- `sha256sum` 两份主规划 → `t\` = `9eddde447ce5bae4…`（v2.1.1，2290 行）／`chatgpt produce\` = `04f2aaea0d2bfa09…`（v2.3，2438 行）。**两份漂移，见 OQ-01**
- `find n8n -type d` → 8 个骨架目录已建
- `find n8n -type f` → **0 个文件**（符合"不生成业务 Workflow"）
- `git status --short`（主仓库，只读）→ `M p5-assistant/NOTES.md`、`?? .vscode/`、`?? p5-assistant/environment-audit.md`
- `git diff -- p5-assistant/NOTES.md` → 仅表格排版变化（Markdown 表格对齐 + `<br />`），**无内容改动**
- `git log --oneline -3` → HEAD = `10640b5`
- `netstat -ano | grep 5678` → `0.0.0.0:5678` 与 `[::]:5678` **LISTENING（PID 11908）**
- 读取 `p5-assistant/environment-audit.md` → E1a–E15 已填满，无空缺（G0 判据成立）
- **OQ-03 收尾（停止实例）**：
  - `Get-CimInstance Win32_Process` 确认 PID 11908 = `node … n8n/bin/n8n start`，PID 19568 = `@n8n/task-runner/dist/start.js`（均为本会话早前启动）
  - `taskkill //PID 11908 //T //F` → 终止 19568 与 11908（含子进程 30564）
  - `netstat -ano | grep -E "5678|5679"` → **无输出，端口已释放**
  - `Get-CimInstance … | Where CommandLine -like '*n8n*'` → **无匹配，无残留 n8n 进程**
  - `n8n list:workflow` → 退出码 0，仍为 0 个 Workflow（**本地库未损坏**）
  - `ls -la ~/.n8n/` → `database.sqlite` mtime 仍为 09-23、WAL 仍为 13:40 → **那次实例运行未写入任何业务数据**

### 未验证

- **E1c 管理 API 可用性**：缺一次隔离实例下的健康/版本/空列表/鉴权边界核验。
- **E2 Public API 可用性**：缺专用测试 API Key；没有时保持未验证，不绕过鉴权。
- **E6 `N8N_ENCRYPTION_KEY` 备份**：缺备份位置与保管人记录。
- **E9 模型选型 / E10 n8n 公网可达性 / E12 数据边界**：均缺产品负责人决策。
- **P00 判据「没有启动或部署服务」**：见下方「风险与遗留」第 1 条——该判据当前不成立。

### 门禁

- **G0：通过**
  - 判据（主规划 §十二）：§二 E1–E15 无空缺；每条结论有证据文件或明确的"未验证"。
  - 对应：`p5-assistant/environment-audit.md` 结论总览表 E1a–E15 全部有状态与证据；其中 6 项标"未验证"并逐条说明了缺什么。**判据成立**。
- **G1：未通过**
  - 判据：E12 有产品负责人书面答复，且 `prompts/data-boundary.md` 与实现一致。
  - 对应：E12 =「未验证」；`data-boundary.md` 尚未创建（属 P02）。**未通过**。
- **G2：未通过** —— 判据要求 `schemas/` 全套存在且有正反例测试；当前 `n8n/schemas/` 为空。
- **G3：未通过** —— 判据要求高频问题端到端可答且 `llmUsed === false`；6 个 Workflow 当前创建 0 个。
- **G4：未通过** —— 判据要求 §13.6 七类安全测试全过；P08 未开始。
- **G5：未通过** —— 判据要求 §十三 全部用例通过且演练七项通过；P11 未开始。

### 风险与遗留

1. ~~**【最高优先】有一个 n8n 实例在运行，且绑定 `0.0.0.0`**~~ **已解决（OQ-03，裁决为立即停止）**。
   - 已终止，端口释放，本地库未受影响。`environment-audit.md` 的 E1b「无实例在跑」结论**重新成立**，无需修订。
   - 遗留注意：**日后起实例不要用 `n8n start` 的默认绑定**（它绑 `0.0.0.0`，同局域网可达）。要按 P01 的隔离做法：`N8N_USER_FOLDER` 指向临时目录 + 非 5678 端口。
2. **主规划两份漂移**（OQ-01）：`t\` 是 v2.1.1，`chatgpt produce\` 是 v2.3。已冻结真源为 v2.3，但 `t\` 那份仍是误解来源。责任人：产品负责人。
3. **两份契约形状不同**（OQ-02）：§1.4 的 `UniRequest/UniResponse` 与 §6.1/§6.2 的线上契约没有映射规则，**直接阻塞 P02**。责任人：产品负责人 + 主工程。
4. **Q9 状态不一致**（OQ-04）：§1.4 已把二课移出 MVP，但 §15.1-Q9 与 §4.12 仍写"必须选一个"。已按 §1.4 冻结默认行为（二课不进 MVP）。责任人：产品负责人。

### 下一步

**P00 已完成。** 按引导词「比赛最短路径」（P00 → P02 → P03 → P07 → P08 → P11），下一阶段是 **P02（n1 契约冻结）**。

**但 P02 被 OQ-02 阻塞。** 需要产品负责人回答的**最小问题集合**只有一个：

> **§1.4 的 `UniRequest`/`UniResponse` 与 §6.1/§6.2 的线上契约，是"两层 + 显式投影"还是"合并成一条"？**
>
> 默认安全行为（未答复前 Claude Code 按此走）：视为**两层**——§1.4 是 App 内部 Interface（`UniAssistant.ask`），§6.2 是 n8n 线上契约，`N8nAdapter` 负责双向投影。P02 会先把投影规则写成 `docs/android-embed-contract.md` 的显式映射表，**在映射表评审通过前不落任何 schema 文件**。

**P01（n0 收口）当前不阻塞比赛路径**：E1c/E2 只在需要管理 API 时才成为前置，而 P02/P03 都不需要起实例。若日后要关掉 E1c/E2，按隔离做法另起临时实例即可（见本文件「风险与遗留」第 1 条的遗留注意）。
