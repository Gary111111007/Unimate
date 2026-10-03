# v2.66 在线 AI APK 交付（2026-10-01）

## 交付

- APK：`artifacts/android/unimate-v2.66-online-ai.apk`（同内容的常规输出为 `unimate-debug.apk`）。
- 大小：7,041,125 字节（6.71 MiB）。
- SHA-256：`BD3CBE8DA3F9763AEFE8E04697E4949C3B74E04E488F11DD1451D7EF21958C22`。
- 包名：`com.unimate.app`。APK 内 Android versionName/versionCode 仍为 `1.0`/`1`；v2.66 是交付版本标记。
- bundle：`index-BEWZtrJs.js`。
- 签名证书与构建前 APK 相同，可覆盖更新，禁止为解决安装问题擅自卸载清除数据。

## 接入与验证

APK → `https://unimate3-ai-pages.pages.dev/v1/agent/chat` → `UNIMATE_AI` 服务绑定 → 当前账号 `unimate-sync` → Cloudflare Workers AI。

账号：`609744642@qq.com`；Account ID：`d2f509b43537db637aa7bdd04e009d85`。
Pages 生产部署：`https://ab783e72.unimate3-ai-pages.pages.dev`；稳定地址为上面的无版本子域名。
Worker 版本：`967f7829-57bf-492d-a36d-f4695a486eff`；模型：`@cf/zai-org/glm-4.7-flash`。

已验证：

- 生产健康检查 HTTP 200、`agentReady:true`。
- 真实模型回答 HTTP 200，内容“在线测试成功”。
- 真实工具选择 HTTP 200，`getSchedule`，参数 `{"query":"tomorrow"}`。
- APK 的 Origin `https://localhost` 回显正确，OPTIONS 204。
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-apk.ps1` 六步完成，退出码 0。
- 26 套件、1036 条通过；Agent 49 条包括中转行为、CORS、路由隔离与 64 KiB 上限。
- `apksigner verify` 通过，原签名一致，包内 bundle 与 dist 一致。
- 包内包含新 AI 地址、原同步地址和离线提示；不包含 `workers.dev`、旧 DeepSeek API、模型 Key 或 R2 Secret 名。
- 未升级或购买付费计划；账单计划查询返回 403，无法独立确认当前账户计划及额度剩余。

未验证：真机安装、点击 AI 对话、网络切换、语音及提醒端到端。桌面 HTTP 验证不能代替真机。

## 数据边界

AI 只接收主动输入的文字，Tool 在本机执行。原账号/备份仍走 `https://unimate3.pages.dev`；原 `cloudflare/pages/_worker.js` 上游恢复为原账号 Worker，避免未来把账号流量导入缺失 R2 Secrets 的 AI Worker。本次没有迁移账号或备份数据。

Cloudflare 位于境外，账号模式服务端可读数据构成数据出境，既有 PRD/AGENTS 合规限制继续保留。

## 文件与存储记录

本轮源码变动：`src/services/aiProvider.ts` 的默认地址；新增 `cloudflare/agent-pages/`（中转、Pages 配置和说明）；在既有 `tests/agent.test.ts` 增补行为验收；`.gitignore` 忽略 Pages 缓存；更新 PRD、context、架构及 Worker 说明。之前 Workers AI 源码改动与用户的 `tempCodeRunnerFile.*` 均保留。

- 构建日志/旧包备份/验证临时文件：`F:\A_LIU_Astrspire\A_runtime\UnimateUL\apk-ai-20261001`，验收时 16,225,000 字节。保留 `unimate-before-ai.apk` 与构建日志。
- Cloudflare 日志：`F:\A_LIU_Astrspire\A_runtime\UnimateUL\cloudflare-deploy`，验收时目录共 340,752 字节（含前轮日志）。
- F 盘项目 `dist/` 共 807,747 字节；`android/app/build/` 共 45,107,200 字节；AI Pages 源目录验收时共 4,862 字节。
- APK 文件位于 F 盘项目 `artifacts/android/`，两份新输出各 7,041,125 字节。
- npm/Gradle 缓存复用 F 盘 `A_cache/UnimateUL`，没有安装或下载新依赖；API/部署响应流量未逐字节计量。构建中间产物全盘增量未逐字节计量，上述大小为验收时目录总量。
- C 盘仅复用既有 SDK/JDK、签名和 OAuth 凭据。检查 `.android`、`.gradle/daemon`、Wrangler 配置目录，未发现本轮起始后新增写入；未做 C 盘全盘审计。既有 OAuth 文件 `C:\Users\Legion\AppData\Roaming\xdg.config\.wrangler\config\default.toml` 为 811 字节，最后修改 2026-10-01 10:51:16，早于本轮；没有展示或另存 Token。
- 构建签名沿用既有 keystore，临时副本仅留 F 盘运行目录，不入 Git；无新增测试数据库或长期运行服务。前轮产生的 `unimate3-ai` Worker 未删除。
