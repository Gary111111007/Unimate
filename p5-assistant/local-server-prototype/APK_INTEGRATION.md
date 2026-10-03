# 本地蒸馏模型原型接入 APK 步骤

> 状态：主工程代码接线与 APK 静态构建已完成；Android 真机和本地模型 HTTPS 公网地址仍待验证。

## 一、接入前提

1. `llama-server` 和本目录网关必须部署在手机可访问的地址上。手机里的 `127.0.0.1` 指向手机自身，不能访问开发电脑。
2. 正式 APK 应使用稳定的 HTTPS 地址。Cloudflare Quick Tunnel 只适合短时演示：地址随机、公开且当前网络下尚未验证成功。
3. 网关目前是原型服务，只有内存限频，没有生产鉴权、持久化审计或高可用能力；正式运营前必须补齐。
4. APK 内不得放模型 Key。当前本机模型没有 Key；若以后改回在线 DeepSeek，Key 仍只能放服务端 secret。
5. 默认只把用户聊天文字和 Tool 名称发给 Agent 网关，不发送课表、姓名、学号、记事正文或 Tool 返回值。若未来扩大出网字段，必须重新取得用户明确同意并更新「关于」说明。

## 二、先部署可访问的 Agent 网关

开发电脑上先启动模型：

```powershell
& 'F:\A_LIU_Astrspire\A_runtime\UnimateUL\deepseek-prototype\llama\llama-server.exe' `
  -m 'F:\A_LIU_Astrspire\A_downloads\UnimateUL\models\DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M-unsloth.gguf' `
  -c 4096 -ngl 0 --host 127.0.0.1 --port 8080
```

再启动网关：

```powershell
$env:LLAMA_CHAT_URL='http://127.0.0.1:8080/v1/chat/completions'
$env:PROTOTYPE_MODEL='deepseek-r1-distill-qwen-1.5b'
$env:PROTOTYPE_TOOL_MODE='hybrid'
$env:PROTOTYPE_HOST='0.0.0.0'
node p5-assistant\local-server-prototype\server.mjs
```

局域网联调可访问 `http://电脑局域网IP:8787`，但 Android 默认可能拦截明文 HTTP。正式 APK 不建议为了原型长期放开 cleartext；应在 8787 前面放 HTTPS 反向代理或使用稳定 HTTPS 域名。

## 三、给 Agent 使用独立地址

`src/services/aiProvider.ts` 已新增独立的 `VITE_AGENT_API_BASE`，并保留 `SYNC_API_BASE` 作为未配置时的默认 Agent 网关。不要修改 `VITE_SYNC_API_BASE` 指向临时模型服务器，否则账号与课表备份会被一并切走。

建议在 `aiProvider.ts` 或独立配置模块中按现有 Node 单测兼容写法读取环境变量：

```ts
const ENV: Record<string, string | undefined> =
  (typeof import.meta !== 'undefined' && (import.meta as any).env) || {};

export const AGENT_API_BASE =
  (ENV.VITE_AGENT_API_BASE || SYNC_API_BASE).replace(/\/+$/, '');
```

然后把 `HttpAIProvider` 的默认地址改为：

```ts
constructor(endpoint = AGENT_API_BASE + '/v1/agent/chat')
```

不要在模块顶层直接写 `import.meta.env.VITE_AGENT_API_BASE`；Node 单测环境没有 `import.meta.env`，会在导入时崩溃。

## 四、把快速规则放进 APK 本机 Planner

只修改服务端能让在线模式变快，但断网时行为会不一致。主工程已经把以下规则同步到 `src/services/uniTools.ts` 的 `LocalRulePlanner`：

1. 问候、致谢和能力询问直接返回本机 `message`，不发网络请求。
2. 识别“周五交作业”“我要复习高数”“帮我记一下实验报告”等待办表达。
3. 首轮只返回：`要把“……”加入记事本吗？回复“是”确认，回复“否”取消。`
4. 只有在上一轮确实由 Uni 发出该询问、且用户回复肯定词时，才生成 `addNote({ title })`。
5. 用户回复“不用/取消/否”时返回取消消息，不执行 Tool，数据保持不变。
6. 待确认标题只保存在当前 `AgentCore` 会话内存中，最长 120 字；退出会话后不保留。

原来的“帮我记一下……”直达 `addNote` 路径已经替换；现在本机 Planner 会先返回询问，只有下一轮明确肯定才生成 Tool Call。

## 五、保持 Tool 与数据边界

- 继续使用 `src/services/uniTools.ts` 的 `addNote` Tool，不让模型直接 import 数据库。
- `AgentCore` 仍只把用户/助手对话交给在线 Provider；课表、天气、记事查询结果不得回灌模型上下文。
- 用户回复“是”之前不得调用 `db.addNote()`。
- 本功能只新增记事，不涉及删除；任何未来删除能力仍必须走 `db.confirm({...})` 和统一 `ConfirmDialog.vue`。
- 服务端只返回白名单内的 `tool_call`；客户端继续执行参数校验，不能相信任意 Tool 名和参数。

## 六、构建 APK

若使用自建 HTTPS Agent 网关，在执行正式构建前设置独立地址：

```powershell
$env:VITE_AGENT_API_BASE='https://你的-Agent-HTTPS-域名'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-apk.ps1
```

只能使用项目规定的 `scripts\build-apk.ps1`，不要手跑 Gradle。构建脚本会执行测试、Vite、Capacitor、Gradle、签名与包内容反查。

## 七、接入后验收清单

先跑定向测试：

```powershell
npm run test:p5-prototype
npm run test:agent
npm run test:uni
npm run test:order
npm run test:css
```

再执行完整 APK 构建，并完成以下真机验证：

1. 发送“你好”，应立即得到本机回答，断网也可用。
2. 发送“周五交高数作业”，应先询问是否加入记事本；此时记事数量不变。
3. 回复“否”，记事数量仍不变。
4. 再次发起并回复“是”，只新增一条标题正确的记事。
5. 发送开放式问题，在线时走模型；关闭网关后应按现有策略降级，不能卡住 App。
6. 退出 App 后重新打开，确认登录、课表、记事及其他功能不受 Agent 网关故障影响。
7. 反向检查 APK：新增的本机询问文案应能在包内找到；被替换的“直接新增”旧路径不应再命中。

## 八、当前验证边界

已验证：原型网关的本地快速回答、待办提议、肯定确认、否定取消、`addNote` Tool Call及不调用模型；主工程本机规则优先、两轮记事确认、独立 `VITE_AGENT_API_BASE`、常见用餐本机回答；月亮入口的 Gemini 风格渐变流光和透明玻璃圈不改变 Agent 接线；26 个测试套件 1012 条断言；Vite、Capacitor、Gradle、签名、bundle 一致性和 APK 新旧字符串反查。当前 APK 为 6.70 MiB，SHA-256 `8A450E7BEE6B57FCDEB07E732F036590E160FE3FF0E7DFCD1816237E4A8FEFEA`。

未验证：本地模型的稳定 HTTPS 公网地址、Android 真机网络切换、真机回答速度、记事/提醒写入及 ASR/TTS 全链路。

如果网关部署在 Cloudflare 境外节点，面向真实用户运营前仍要按项目合规记录处理数据出境问题；不能因为这是 Agent 接口就省略该评估。
