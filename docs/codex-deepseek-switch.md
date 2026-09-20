# 用 cc-switch 把 Codex 切到 DeepSeek（2026-09-20 实测记录）

## 结论：不用改任何文件，直接切就能用

- cc-switch 里已存在 **Codex → DeepSeek** 这条服务商（id `2b88d5eb-38de-4a00-bcfa-21f124f8e485`，Key 已填，尾号 09b8）。
- 它的配置是：

```toml
model_provider = "custom"
model = "deepseek-flash"
model_catalog_json = "cc-switch-model-catalog.json"

[model_providers.custom]
name = "deepseek"
base_url = "https://api.deepseek.com"
wire_api = "responses"
requires_openai_auth = false
```

- cc-switch 的"本地路由代理"（127.0.0.1:15721）现在是**关**的，实测**不需要开**，保持关即可。

## 已验证（本机真发请求，不是看文档猜的）

| 项目 | 结果 |
| --- | --- |
| `GET https://api.deepseek.com/models` | 200，返回 `deepseek-flash`、`deepseek-v4-pro` |
| `POST https://api.deepseek.com/responses`（非流式） | 200 |
| 同上 + 流式 + function tools | 200，正常吐 `response.function_call` 事件 |
| + `reasoning.effort=high` | 200 |
| + `service_tier=default` | 200 |
| + `parallel_tool_calls=true` | 200 |
| + `web_search` / `file_search` / `code_interpreter` / `custom(apply_patch)` / `local_shell` 工具声明 | 全部 200（未知工具类型不报错） |
| Key 有效性 | 有效（上述请求都成功计费返回） |
| 当前会话实际在用的千问通道 | 200（同一脚本实测） |

## 未验证

- 切换动作本身（会改掉当前正在跑的 Codex 的配置，我没有替你点）。
- DeepSeek 在 Codex 里跑长任务（几十轮工具调用、长上下文）的实际稳定性与速度 —— 只能你切过去用一段时间才知道。

## 你要做的三步

1. 打开 cc-switch → 顶部切到 **Codex** → 点 **DeepSeek** 那一行的"切换"。
2. **完全退出 Codex 桌面版**（托盘图标也要退）再重开——`config.toml` 只在启动时读一次。
3. **新开一个对话**继续干活。模型选 `deepseek-flash`（对话里可切 `deepseek-v4-pro`）。

## 四个坑，提前知道省得误判

1. **历史会话可能"消失"**：cc-switch 按服务商给会话分桶，切到 DeepSeek 后列表里看不到千问时代的对话属正常；切回"千问AI平台"就回来了。所以**重要收尾别在切换中途做**。
2. **半截工具调用会 400**：实测 DeepSeek 严格校验历史，回包 `No tool output found for tool call xxx`。表现是"某条对话突然一直报错"。原因是上一轮工具调用被中断（你点了停止/App 崩了），历史里留了个没配对的调用。解法是**新开对话**，不是服务商坏了。
3. **档位差异**：DeepSeek 目录支持 `low / high / max`，你的共用配置写的是 `high` ✅；而当前千问只支持 `low / medium / xhigh`，`high` 属于越界值（会被降级处理）。
4. **别手改 `~/.codex/config.toml`**：cc-switch 切换时会重写 `model_provider / model / base_url / wire_api` 这几行，手改的下次切换就没了。要加"跟服务商无关"的配置（比如 `[windows] sandbox`、`disable_response_storage`），加到 cc-switch 的 Codex **共用配置**里。

## 随时自检（只读，不改任何东西，Key 打码）

```
npm run check:provider                      # 报告现在连的是谁 + 真发一次请求
npm run check:provider preview              # 列出 cc-switch 里所有 Codex 服务商
npm run check:provider preview DeepSeek     # 不切换，用 DeepSeek 那条配置预演一次
```

脚本位置：`scripts/check-provider.mjs`。