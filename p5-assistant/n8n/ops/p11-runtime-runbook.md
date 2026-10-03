# P11 真实 n8n 运行验证 —— 复现手册

> 📍 **本机历史证据路径提示**：本文出现的 `C:\Users\...` 与 `F:\A_LIU_Astrspire\...` 均为**本机历史证据路径**——它们记录的是某一刻在这台机器上的真实位置，**不属于交付内容**，换机后自然失效。**可执行说明一律用仓库相对路径。**

版本：1.1（P11 → **P09 补充**，2026-09-25）
授权：产品负责人授权在 **P11 新建一个隔离目录**做真实运行验证（不得动既有保留目录）。
P09 按 D25 复跑了一次（改了 Workflow 就必须重跑），用的是**另一个新目录**。

> **这份手册的用处**：P11 的那一跑抓出 **7 个只有真实运行才会暴露的缺陷**；
> P09 复跑又抓出**第 8 个**（观测链路的执行顺序）。
> 以后任何人改了 Workflow，都应该按这里跑一次——**结构核对与单测全绿不能替代它**。

---

## 〇 前置：为什么必须跑

P11 之前，三层验证**全都是绿的**：结构往返核对、路由规则一致性、节点 JS 与 `core` 的
`new Function` 行为等价。而真实运行一次抓出 7 个缺陷，其中两个的症状是
**HTTP 200 + 空响应体**（整条链路静默地什么都不做）。

**结论**：一条编排链路"能跑"，只能靠真的跑起来证明。

---

## 一 准备：选一个**全新**的隔离目录

> ⚠️ **《C 盘存储红线》§七.4 之后：隔离实例不再落在系统 `%TEMP%`。**
> Windows 上 `%TEMP%` 就在 C 盘，而该策略禁止在 C 盘新建 n8n 隔离实例。
> 守卫已扩展为**强制要求一个经过校验的 F 盘运行根**，并**关掉了 TEMP 这条路径**。

```bash
# 必须满足（tests/lib/iso-dir-guard.mjs 会校验）：
#   · UNIMATE_RUNTIME_ROOT 必须显式提供（**没有默认值**，不给就拒绝运行）
#   · 运行根自身也要过校验：绝对路径、不是盘符根、不在 C 盘、
#     不与系统 TEMP 重叠、不落在任何保留目录之内
#   · 目标必须是绝对路径，且位于运行根之内（**不允许落在系统 TEMP**）
#   · 目录名以 unimate-n8n-iso- 开头
#   · **执行前尚不存在**
#   · 不与 docs/open-questions.md 里 RESERVED-ISO-DIRS 的任何保留目录构成父子关系
export UNIMATE_RUNTIME_ROOT="F:/A_LIU_Astrspire/A_runtime/UnimateUL"
export N8N_USER_FOLDER="$UNIMATE_RUNTIME_ROOT/unimate-n8n-iso-<唯一后缀>"
```

**运行根不是随便挑的**：它由 `C_DRIVE_STORAGE_POLICY.md` §二 规定为
`F:\A_LIU_Astrspire\A_runtime\UnimateUL\`。

**保留目录（一律不许碰）**：见 `docs/open-questions.md` 的 `RESERVED-ISO-DIRS` 块——
**别在这里抄条数**，那份清单只会越来越长（P11 时 4 条，P09 时 9 条）。
**建了新目录之后必须登记进那个块**，否则安全套件的 **J-1b** 会红——它就是这么设计的。

## 二 导入并发布

```bash
cd <本工位根目录>
n8n import:workflow --separate --input workflows        # 应输出 Successfully imported 6 workflows
n8n list:workflow                                       # 6 个，id 是 unimate-* 而不是随机串
# ★ 必须发布：n8n 的 executeWorkflow **只能调用已发布的工作流**，
#   未发布的子流程会让父流程静默失败（P11 抓到的缺陷之一）
for id in unimate-agent-gateway unimate-agent-intent-router unimate-schedule-query \
          unimate-notes-query unimate-notes-create unimate-agent-observability; do
  n8n publish:workflow --id "$id"
done
```

## 三 起实例（**非 5678**，仅 loopback）

```bash
N8N_PORT=5778 N8N_LISTEN_ADDRESS=127.0.0.1 \
N8N_DIAGNOSTICS_ENABLED=false N8N_VERSION_NOTIFICATIONS_ENABLED=false \
n8n start
```

- `N8N_LISTEN_ADDRESS=127.0.0.1` 是**硬要求**：默认会绑 `0.0.0.0`，同局域网可达。
- 诊断/版本通知关掉，避免实例自己往外发请求。
- 等日志出现 `Finished building workflow dependency index` **再打请求**——
  首轮实测过：注册未完成时全部返回空响应体。

## 四 打请求

```bash
UNIMATE_P11_BASE=http://127.0.0.1:5778 \
UNIMATE_EVIDENCE_DIR=ops/p09-evidence \
  node tools/p11-runtime-check.mjs
```

16 个场景覆盖：下一节 / 今日 / 明日 / 本周次数 / 空档 / 冲突 / 简报 / 记事行动卡 /
不支持意图×2 / 非法参数×3 / 胶囊越界×2 / 提示词注入，外加**固定输入连打 20 次**。
（判定数 17 = 16 个场景 + 1 条确定性。）

> ⚠️ **`UNIMATE_EVIDENCE_DIR` 不要省略成默认值。** 默认是 `ops/p11-evidence/`——那是
> **P11 的原始证据**（7 个缺陷修复前后的对比基线），复跑覆盖它等于销毁基线。
> P09 起每次复跑指向一个新目录。

**这一步跑完还必须跑顺序断言**（P09 新增，见下节）。

## 四·补 断言「记录排在应答之前」

```bash
UNIMATE_ISO_DB="$N8N_USER_FOLDER/.n8n/database.sqlite" node tools/check-log-order.mjs
```

它读的是 **n8n 自己的执行数据**（`execution_data` 的扁平化 `resultData.runData`），
断言真实节点顺序是
`… → Shape Response → Build Log Input → Log Request → Respond`。

**为什么必须单独一步**：观测链路的接线方式**在结构上看不出对错**。
P09 第一版写成"`Shape Response` 分叉喂两个节点"、把记录节点写在数组前面，
结构核对、单测、甚至往返核对**全绿**，而真实执行顺序是
`Respond` 先、日志后——**与 §4.11 正好相反**。把数组顺序倒过来也没用。
详见 `docs/observability.md` §6.1、决策 **D26**。

**未提供 `UNIMATE_ISO_DB` 时它退出码 2**（fail closed）——不静默跳过。

> **不要用 curl 传中文**：Git Bash 会在传输途中把 UTF-8 弄坏（实测 message 变乱码，
> 于是路由永远判 unsupported）。脚本用 Node 的 `http` 显式发 UTF-8，绕开这件事。

## 五 逐个执行其余 Workflow（可选，补全"6 个都能跑"）

```bash
# ★ 必须先停实例：实例占着库时 `n8n execute` 不产出任何 JSON
n8n execute --id unimate-notes-query --rawOutput
```

`agent_gateway` 以 **webhook** 节点起始，`n8n execute` 驱动不了它——它由第四步的 HTTP 路径覆盖。

## 六 收尾

- **停实例**：`taskkill //PID <监听 5778 的 PID> //T //F`
- **目录保留**：这是本次验证的证据，**不自动清理**。删除需产品负责人二次确认（OQ-14）。

---

## 七 P11 抓到的 7 个缺陷（每一条都配了结构性断言）

| # | 缺陷 | 症状 | 断言 |
| --- | --- | --- | --- |
| 1 | Workflow JSON **没有稳定 id**，`executeWorkflow` 引用的是名字 | 子流程永远找不到 → 静默失败 | Y-7 |
| 2 | `onError: continueErrorOutput` 但**错误支路没连线** | 失败被吞 → HTTP 200 + 空响应体 | Y-8 |
| 3 | Switch 的**六个分支一个都没接线** | 子流程没有终止节点 → 同上 | Y-9 |
| 4 | webhook 把请求体放在 `.body` 下，预检直接读 `$input.first().json` | **七个必填字段全部判为缺失**，每个请求都 E_SCHEMA | A 组 |
| 5 | 网关说 `message`、路由读 `text` | 路由永远拿不到用户原话 | A 组 |
| 6 | 预检失败**不短路**，照样往 router 送 | 非法请求被当成功处理（§13.6 #4 明令禁止） | G 组 |
| 7 | `Shape Response` 硬编码 `success: true` | 出现"成功 + 有错误码"的自相矛盾信封 | D 组 |

外加一处**非缺陷但必须知道**：`executeWorkflow` 要求目标工作流**已发布**，
所以 `active: false` 的仓库产物在实例里**必须先 publish 才能互调**——这是部署步骤，不是 bug。

---

## 八 P09 复跑抓到的第 8 个缺陷（同类：结构绿、跑起来反）

| # | 缺陷 | 症状 | 修法 | 断言 |
| --- | --- | --- | --- | --- |
| 8 | 观测链路**分叉接线**，指望数组顺序决定先后 | 实测 `Shape Response → Respond → Build Log Input → Log Request`：**响应先返回、日志后写**，与 §4.11「响应返回前调用一次」相反。**数组顺序倒过来也无效** | 改成**串接**（拓扑确定顺序）；两个新节点加 `continueRegularOutput`；`Respond` 响应体改走表达式引用 `Shape Response` | **Y-10 组** + **`tools/check-log-order.mjs`**（读真实执行数据） |

**与 P11 那 7 个同源**：都是"结构上没问题、单测全绿、跑起来才知道"。
两次加起来说明同一件事——**改了 Workflow 就跑一次，别推理。**

---

## 九 复跑清单（改了 Workflow 之后照这个顺序走）

1. `node tools/gen-workflows.mjs`（重出 6 个 JSON）
2. 四套测试 + 往返核对（用**新**的 `UNIMATE_RUNTIME_ROOT` + `UNIMATE_ISO_N8N`）
   —— **落在 F 盘运行根，不要用系统 `%TEMP%`**（C 盘红线 §七.4）
3. 新隔离目录（**F 盘**）→ `import:workflow` → **`publish:workflow` × 6** → `n8n start`（非 5678，仅 loopback）
4. `UNIMATE_P11_BASE=… UNIMATE_EVIDENCE_DIR=… node tools/p11-runtime-check.mjs`
5. `UNIMATE_ISO_DB=… node tools/check-log-order.mjs`
6. **登记新目录**进 `docs/open-questions.md` 的 `RESERVED-ISO-DIRS` 块（否则 J-1b 红）
7. 停实例；目录**保留**（删除需产品负责人按目录二次确认，OQ-14）
