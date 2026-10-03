# PROTOTYPE ONLY：DeepSeek 蒸馏小模型临时服务器

这个目录只回答一个问题：**在购买正式服务器前，`DeepSeek-R1-Distill-Qwen-1.5B` 的聊天质量和响应速度是否值得继续投入？**

它不是生产服务，不保存聊天、不接数据库、不接账号系统，也不应长期暴露在公网。验证完成后由产品负责人决定是否把结论整合进主工程。

## 架构

```text
Android Uni
  → 临时 HTTPS 地址（可选 Cloudflare Quick Tunnel）
  → 本目录 server.mjs :8787
  → llama-server :8080
  → DeepSeek-R1-Distill-Qwen-1.5B GGUF
```

`server.mjs` 与主工程现有 `/v1/agent/chat` 返回格式一致：普通聊天返回 `message`，需要 App 数据时返回结构化 `tool_call`。它只允许六个现有 Tool 名称，并在本机内存中限频。

实测表明 1.5B 蒸馏模型能聊天，但不能稳定、正确地独立选择 Tool。因此默认采用 `hybrid`：明确的课表、记事、天气、页面跳转命令由无数据库权限的轻量规则路由，其他内容交给模型聊天。可设置 `$env:PROTOTYPE_TOOL_MODE='llm'` 复现纯模型 Tool 选择，但它只用于对照，不建议接真实数据。

## 先跑零下载模拟模式

在项目根目录执行：

```powershell
$env:UNIMATE_PROTOTYPE_MOCK='1'
node p5-assistant\local-server-prototype\server.mjs
```

另开终端检查：

```powershell
curl.exe http://127.0.0.1:8787/health
curl.exe -X POST http://127.0.0.1:8787/v1/agent/chat -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"你好"}],"toolNames":["getSchedule"]}'
```

模拟模式只检查 Android ↔ 网关的协议，不代表模型质量。

## 真实模型运行

测试对象：DeepSeek 官方发布的 `DeepSeek-R1-Distill-Qwen-1.5B`。为了用 `llama.cpp` 低成本运行，本次采用 `unsloth` 发布的 `Q4_K_M` GGUF；它是对官方 checkpoint 的第三方量化，不是 DeepSeek 官方直接发布的 GGUF。最初计划的 Hugging Face `bartowski` 文件在本机网络被重置，因此没有使用或冒充该文件。

项目存储规则要求所有下载和运行文件放在 F 盘：

```text
模型：F:\A_LIU_Astrspire\A_downloads\UnimateUL\models\DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M-unsloth.gguf
llama.cpp：F:\A_LIU_Astrspire\A_runtime\UnimateUL\deepseek-prototype\llama\
cloudflared：F:\A_LIU_Astrspire\A_runtime\UnimateUL\deepseek-prototype\cloudflared\
日志/临时：F:\A_LIU_Astrspire\A_runtime\UnimateUL\deepseek-prototype\logs\
```

当前已下载并核验：

- 模型：`1,117,321,312` 字节，SHA-256 `f3bdf9cf31dee4b57ae4e455a1cb0d01b5c2c1b50d72d3112141c195506c2840`，与 ModelScope `X-Linked-ETag` 一致；
- llama.cpp：官方 v0.5.0 配套构建 `b11146` 的 Windows x64 CPU ZIP，`18,560,055` 字节，SHA-256 `14cf1303ca9ac3abd94816850532f9f9a69ac66fbaca3776fc6f9061c2fac1d1`；
- `cloudflared 2026.9.3` 已从 Cloudflare 官方 GitHub Release 下载到 F 盘：`55,366,080` 字节，SHA-256 `f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2`；Quick Tunnel 创建接口连续两次超时，公网地址尚未建立。

准备好 `llama-server.exe` 和模型后，先启动推理服务：

```powershell
& 'F:\A_LIU_Astrspire\A_runtime\UnimateUL\deepseek-prototype\llama\llama-server.exe' `
  -m 'F:\A_LIU_Astrspire\A_downloads\UnimateUL\models\DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M-unsloth.gguf' `
  -c 4096 -ngl 0 --host 127.0.0.1 --port 8080
```

`-ngl 0` 是兼容性优先的 CPU 配置；确认显卡与对应 `llama.cpp` 后端可用后再提高 GPU offload。

再启动本目录网关：

```powershell
$env:LLAMA_CHAT_URL='http://127.0.0.1:8080/v1/chat/completions'
$env:PROTOTYPE_MODEL='deepseek-r1-distill-qwen-1.5b'
$env:PROTOTYPE_TOOL_MODE='hybrid'
node p5-assistant\local-server-prototype\server.mjs
```

如果需要让手机从公网访问，可用 Cloudflare Quick Tunnel 临时映射 `http://127.0.0.1:8787`。Quick Tunnel 地址随机且公开，只有基础内存限频，测试完立即停止进程，不要把地址公开或长期运行。

若 Quick Tunnel 不可用，可让网关设置 `$env:PROTOTYPE_HOST='0.0.0.0'` 后启动，再由同一局域网内的手机打开 `http://电脑局域网IP:8787/`。根路径提供不保存记录的临时聊天页；页面里的 Tool Call 只展示 JSON，不直接执行 App 数据修改。

## 与主工程连接

当前 App 的 Agent 与账号同步共用 `VITE_SYNC_API_BASE`。为了不让临时模型地址破坏账号与备份，**不要**把该变量直接指向本原型。

正式整合只需要主工程新增独立的 `VITE_AGENT_API_BASE`，让 `HttpAIProvider` 单独读取它；按 `AGENTS.md` 的 P5 工位规则，本目录不直接修改 `src/`。需要主工程配合的这一点已记录在 `p5-assistant/NOTES.md`。

完整接线、构建和真机验收步骤见 [`APK_INTEGRATION.md`](APK_INTEGRATION.md)。

## 2026-09-27：快速回答与记事确认优化

CPU 版 1.5B 模型的开放式回答仍需约 6～13 秒；实测 `--reasoning off` / `--reasoning-budget 0` 对这个蒸馏模型无有效加速，直接压低 token 还会重新出现空正文，因此没有采用。

本轮把适合确定性处理的高频输入前移到 `hybrid` 本地路由：

- 问候、致谢、能力询问不调用模型；
- “周五交高数作业”“我要复习高数”等待办表达先询问是否加入记事本；
- 用户回复“是”后才返回 `addNote` Tool Call，回复“否/不用/取消”则不执行；
- “帮我记一下……”也不再直接写入，而是先走同一确认流程；
- 上述状态只存在于当前对话上下文，不新增数据库或持久化。

本机 HTTP 实测：问候 `36.4 ms`、待办询问 `3.6 ms`、确认后 Tool Call `5.5 ms`。这些数字只代表当前开发机单次本地请求，不代表 APK 真机或公网性能。

## 本机验收结果

2026-09-26 的 CPU 实测结果详见 [`RESULTS.md`](RESULTS.md)：

- 模型加载成功，约 1.6 秒；
- 普通中文聊天成功，完整回答约 6.1 秒；
- 三轮上下文能记住“自动化专业”，约 8.8 秒；
- 混合规则的课表、记事询问/确认、打开页面、上下文记事均返回正确结果；高频规则路径为毫秒级；
- 纯 LLM Tool 模式存在错意图、错枚举、字符串冒充参数对象等问题，不能接真实 Tool 执行；
- 未提供 Tool 白名单时不会返回 Tool Call。

结论：1.5B 适合免费临时聊天和基础混合 Agent，不足以替代在线 DeepSeek 的自然语言 Tool Calling。是否购买服务器，应以“是否需要更自由的指令理解与稳定 Tool 规划”为判断点，而不是以基础聊天能否运行作为判断点。
