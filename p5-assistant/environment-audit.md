# P5 / n8n 环境勘察清单

勘察日期：2026-09-25  
勘察范围：当前 Windows 开发机、Unimate 仓库、已公开的 Cloudflare Pages 健康端点  
状态口径：每项只使用“已验证 / 推断 / 未验证”；“已验证”和“未验证”分开记录。

## 结论总览

| # | 待勘察项 | 结论 | 证据与说明 |
| --- | --- | --- | --- |
| E1a | n8n CLI 是否已安装 | **已验证** | `n8n --version` 返回 `2.40.5`；`npm list -g n8n --depth=0` 显示全局 npm 包 `n8n@2.40.5`。入口位于 `%APPDATA%/npm/n8n.ps1`。 |
| E1b | 本机是否已有运行中的实例 | **已验证** | 5678 端口无监听；未发现 n8n 进程。当前没有实例在跑。 |
| E1c | 实例的管理 API 是否可用 | **未验证** | 当前没有运行中的实例。现有本地库为 0 个 Workflow、0 条执行记录，不能做“发布 Workflow / 读取执行记录”的非破坏性实测。 |
| E2 | n8n 管理 API / Public API 是否可用 | **未验证** | 当前实例未启动，且本地 `user_api_keys` 记录数为 0；尚无可用于 Public API 实测的 API Key。不能把“2.40.5 包含相关代码”写成“当前 API 可用”。 |
| E3 | n8n 部署方式 | **已验证** | 当前开发机采用**全局 npm 安装**。Docker 客户端存在，但 Docker 服务为 `Stopped`；仓库中没有 n8n 的 Docker/云托管部署描述。当前不存在已运行的生产部署。 |
| E4 | n8n 数据后端 | **已验证** | 当前本机后端为 SQLite：`%USERPROFILE%/.n8n/database.sqlite`。`DB_TYPE`、Postgres/MySQL 连接环境变量均未设置；n8n 2.40.5 源码默认值也是 `sqlite`。 |
| E5 | 是否启用 queue mode 与 Redis | **已验证** | 未启用。`EXECUTIONS_MODE` 与 Redis/queue 环境变量均未设置；n8n 2.40.5 源码默认执行模式为 `regular`；6379 无监听。 |
| E6 | `N8N_ENCRYPTION_KEY` 是否已备份 | **未验证** | 已验证 `%USERPROFILE%/.n8n/config` 含 `encryptionKey` 字段，但环境变量 `N8N_ENCRYPTION_KEY` 未设置。未找到备份位置和保管人记录，不能声称已备份。勘察过程中未读取或输出密钥值。 |
| E7 | Redis 版本与可用性 | **已验证** | 当前开发机 Redis **不可用/未配置**：6379 无监听、无 Redis 服务、无 `redis-cli`，也没有 Redis 连接环境变量。因此没有版本可报告。 |
| E8 | 独立关系型数据库是否可用 | **已验证** | 当前开发机没有已配置的独立关系型数据库：5432/3306 无监听，未发现 Postgres/MySQL 服务，`psql`/`mysql` 不存在，也没有连接环境变量。库名与账号名尚未确定。 |
| E9 | 模型供应商、地区、计费、数据处理条款 | **未验证** | P5 尚未选定模型供应商；仓库中的 DeepSeek 记录是 Codex 开发工具配置，不是 Uni/P5 的产品选型，不能挪作结论。供应商、节点、计费和条款链接均待产品决策。 |
| E10 | n8n 在大陆网络的可达性 | **未验证** | 尚无 n8n HTTPS 实例、自有域名或 ICP 备案信息，无法实测 n8n。旁证：本机访问 `https://unimate3.pages.dev/health` 返回 200（约 1.2 秒），直连 `*.workers.dev` 失败；这只能证明现有 Pages 中继路径，不代表 n8n 可达。 |
| E11 | Worker / Pages 中继能否复用 `sync-worker` | **已验证** | **不能原样复用，但可以复用同一 Pages 域名与部署模式。** 当前 `_worker.js` 仅转发固定的同步/账号路径，`sync-worker` 没有 Agent/LLM 路由或模型 secret。线上 Pages `/health` 返回 `ok:true`、`atRest:true`、`accounts:true`。P5 若要接入，需由主工程新增独立 Agent 路由、模型 secret 与限流绑定；P5 工位只在 `NOTES.md` 提对接需求，不直接改 `cloudflare/`。 |
| E12 | 哪些本机数据允许进入 n8n 与模型 | **未验证** | 尚无产品负责人“逐字段”书面批准。当前强制默认值是：**任何个人数据都不进入模型**；课表明细、教师、姓名、学号、记事标题/正文、二课明细、照片、账号与登录凭据均禁止发送。只有在后续逐字段确认后，才能把允许项改为已验证。 |
| E13 | `SYNC_RATE_LIMITER` 的限频口径 | **已验证** | 仓库声明的绑定名为 `SYNC_RATE_LIMITER`，阈值为 **20 次 / 60 秒**，现有实现按 `CF-Connecting-IP` 限制。**不应直接复用到 Agent 网关**：共用会让同步和问答互相消耗额度，而且“每 IP/分钟”不等于 P5 所需的“每设备/每日 + 费用上限”。应新建独立绑定/namespace；线上绑定是否与仓库声明完全一致仍需 Cloudflare 控制台或 Wrangler 只读核对。 |
| E14 | Code 节点 / 表达式能否访问环境变量 | **已验证** | 当前 `N8N_BLOCK_ENV_ACCESS_IN_NODE` 未设置；n8n 2.40.5 源码判定为仅当值精确等于字符串 `'false'` 才放行，因此当前默认阻止。不要为了读取模型 Key 而关闭该保护。 |
| E15 | Redis 节点是否支持 `SET ... NX` | **已验证** | n8n 2.40.5 的 Redis 节点源码不支持 `NX`，并且 `SET` 与 `EXPIRE` 是两条独立命令，不具备原子性。确认令牌与击穿锁不能依赖该节点实现。 |

## 已验证

- 本机 n8n 版本、安装方式、运行状态、端口状态。
- 本机 SQLite 数据后端；库内仅核对聚合数量：1 个本地用户、0 个 Workflow、0 条执行记录、0 个 Public API Key。未读取账号、凭据或密钥值。
- 本机未配置 queue mode、Redis、Postgres 或 MySQL。
- 当前 n8n 环境变量访问保护处于默认阻止状态。
- 当前 Redis 节点不支持原子 `SET ... NX EX`。
- 仓库中的 Pages → Worker 中继结构、同步限流声明，以及 2026-09-25 的 Pages `/health` 在线响应。

## 未验证与阻塞项

1. **E6 密钥备份**：需要产品负责人给出备份位置与保管人；不得把密钥值写进仓库、聊天或截图。
2. **E9 模型选型**：需要确定供应商、具体模型、服务地区、计费上限与数据处理条款后再做实时核验。
3. **E10 n8n 公网入口**：需要部署位置、自有 HTTPS 域名和备案结论。
4. **E12 数据边界**：需要产品负责人逐字段书面确认；在此之前模型链路必须保持关闭，规则链路只能处理本机数据。
5. **E1c/E2 API 实测**：需要先有可运行的 n8n 实例和专用测试凭据；实测时使用空测试项目，不创建或激活业务 Workflow。
6. **E13 线上绑定一致性**：需要 Cloudflare 控制台或已登录的 Wrangler 只读检查；本次只验证了仓库声明和线上健康端点，没有声称线上阈值已实测。

## 开工门禁

当前可以继续做不接触模型的本机规则原型和契约评审；**不能开始 LLM 链路上线**。进入 LLM 实现前至少关闭 E9、E12，并确定独立的 Agent 限频/费用上限。若采用 n8n 托管，还需关闭 E1c/E2、E6、E8、E10。

## 本次使用的只读证据

```text
n8n --version
npm list -g n8n --depth=0
Get-NetTCPConnection（5678 / 6379 / 5432 / 3306）
Get-Service / Get-CimInstance Win32_Process
环境变量“是否设置”检查（未输出值）
SQLite mode=ro 聚合计数
n8n 2.40.5 本地安装包源码
cloudflare/sync-worker/wrangler.toml
cloudflare/sync-worker/src/index.js
cloudflare/pages/_worker.js
https://unimate3.pages.dev/health
```

