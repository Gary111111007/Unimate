# Uni AI 专用 Pages 中转

生产入口：`https://unimate3-ai-pages.pages.dev`。

该项目属于账号 `609744642@qq.com`（Account ID `d2f509b43537db637aa7bdd04e009d85`），通过 `UNIMATE_AI` 服务绑定调用同账号 `unimate-sync` Worker。只接管 `GET /health`、`POST /v1/agent/chat` 和预检。APK 来源 `https://localhost` 已允许；正文上限 64 KiB，中转超时 28 秒，模型 Key 不进入 APK。

账号和备份继续使用 `https://unimate3.pages.dev`，由原 `cloudflare/pages/_worker.js` 中转至原账号 Worker。当前 AI 账号未配置 R2 Secrets，不能把原同步上游整体换成新 Worker。

部署（使用仓库已安装的 Wrangler；日志、TEMP/TMP 应设为 F 盘）：

```powershell
cd cloudflare/agent-pages
$env:CLOUDFLARE_ACCOUNT_ID='d2f509b43537db637aa7bdd04e009d85'
..\sync-worker\node_modules\.bin\wrangler.cmd pages deploy --project-name unimate3-ai-pages --branch main --commit-dirty=true
```

`public/` 是直接上传的目录，不压 ZIP。项目已经存在，后续无需 `--force`。Workers AI 模型/绑定配置在 `../sync-worker/wrangler.toml`；不升级付费计划。免费额度或网络不可用时，APK 自动使用本机规则；离线兜底并非本机大模型。

2026-10-01 已验证：生产健康检查 200、`agentReady:true`，APK 来源 CORS 回显正确，真实模型对话 200。真机点击和网络切换需另外验收。
