# Unimate P3 同步服务（Cloudflare Worker + R2）

Worker 有两组能力（v2.43 起）：

### Uni 在线 Agent（DeepSeek Tool Calling）

`POST /v1/agent/chat` 只接收用户主动发送的对话文本；课表、教师、教室与记事不会由客户端自动附带。Worker 让 DeepSeek 在固定 Tool 白名单中做 Function Calling，Android 再校验 JSON 参数并在本机执行。APK 只访问 Unimate Worker，不包含模型密钥。

部署前设置两个 Worker Secret（模型名独立配置，后续换模型无需重新构建 APK）：

- `npx wrangler secret put DEEPSEEK_API_KEY`
- `npx wrangler secret put DEEPSEEK_MODEL`

修改 Secret 后不需要重新构建 APK；首次增加本路由仍需重新部署 Worker 与 Pages 目录。网络不可用或网关失败时，Android 会自动退到 Offline Mode，本机课表和记事仍可用。

1. **端到端加密同步**：只为单个密文对象签发 15 分钟的 R2 `GET` / `PUT` URL。同步口令、恢复码和数据明文都不会到 Worker。
2. **账号登录（服务器托管，v2.43 新增）**：账号体系 + 备份正文直接存在 R2。
   - `POST /v1/signup` / `POST /v1/login`：账号名归一化后只以 `HMAC(SYNC_OBJECT_PEPPER, 账号)` 出现在对象名里；
     口令**原文不接收** —— 客户端发的是 210k 次 PBKDF2 派生出的 verifier，服务端存 `sha256(盐 + verifier)`；会话令牌只存 sha256、90 天过期。
   - `GET /v1/account`、`PUT|GET /v1/backup`、`DELETE /v1/account`：账号信息、备份读写、注销（删记录 + 删数据对象）。
   - **落盘加密**：设了 secret `DATA_KEY` 就用它做 AES-256-GCM（等价于"服务器持有钥匙"，可读、可帮用户重置）；没设就按原样存，
     只靠 R2 自带静态加密。`/health` 会回 `atRest: true|false`，App 会如实显示"落盘加密已开启 / 未设落盘密钥"。
   - **账号记录与数据对象都放在同一个 R2 桶**（`acct/<HMAC>.json`、`data/<随机 id>.bin`），不需要 D1/KV，也不用加 storage 绑定。

**v2.41 起正文的默认路径是 Pages 边缘中转**（`cloudflare/pages/_worker.js` 的 `/v1/put`、`/v1/get`）：
函数自己调本 Worker 拿短链、再代传代取 R2，手机全程只与 `unimate3.pages.dev` 通信。
原因：真机直传 R2 走不通 —— 桶 CORS 缺 APK 的来源 `https://localhost`，且大陆移动网络到
`*.r2.cloudflarestorage.com` 的可达性不由我们决定。客户端保留"直传兜底"（老版 Pages 没部署中转端点时按原路走）。

## 首次部署

1. 在 Cloudflare R2 创建私有 bucket：`unimate-sync`。
2. 创建只允许读写该 bucket 的 R2 API Token，取得 Access Key ID 与 Secret Access Key。
3. 在本目录执行 `npm install`，然后依次执行：

   - `npx wrangler secret put R2_ACCOUNT_ID`
   - `npx wrangler secret put R2_ACCESS_KEY_ID`
   - `npx wrangler secret put R2_SECRET_ACCESS_KEY`
   - `npx wrangler secret put SYNC_OBJECT_PEPPER`（填至少 32 字节随机串）

4. 执行 `npx wrangler r2 bucket cors set unimate-sync --file cors.json`。
   （`cors.json` 的 origins 在 v2.41 补上了 `https://localhost` —— 那是 APK 里页面的来源，
   少了它真机的直传 PUT 会被 WebView 拦掉；走 Pages 中转时用不到，但直传兜底需要。）
5. **（v2.43 新增，建议做）** `npx wrangler secret put DATA_KEY` —— 填一串随机字符（至少 32 字节）。它是账号备份的落盘密钥。
   不设也能跑（界面会提示"未设落盘密钥"），但那样云端备份就只有 R2 的静态加密兜底。
   **这条 secret 丢了 = 已上传的账号备份解不开**，跟其他 secret 一样：只在 Cloudflare 保存，别写进仓库/聊天/截图。
5b. **（v2.50 新增）** `npx wrangler secret put ADMIN_KEY` —— 管理员密钥，用来打开「忘记密码 → 管理员重置」页面。
   不设的话管理员接口一律返回 503（其它功能不受影响）。管理员页面地址：`https://unimate3.pages.dev/admin`（电脑、手机都能开）。
   **管理员能力被刻意收窄**：只列账号名单 + 重置密码，**不能下载用户数据**；重置后旧设备的会话令牌立即失效。
6. 执行 `npm run deploy`，确认地址为 `https://unimate-sync.2025040140.workers.dev`。
7. **（v2.43 起）改过 Worker 代码后必须重新 deploy**：账号 API 是新增路由，不 deploy 的话 App 会提示"服务器上的账号接口还没部署"。
8. 打开 `/health`，应返回 `{"ok":true,"service":"unimate-sync","atRest":<bool>,"accounts":true}`。
   - `atRest:true` = `DATA_KEY` 已设；`accounts:true` = 这一版已含账号 API（App 用这一位判断要不要提示"接口还没部署"）。

## 自检（真机之前先跑这个）

```powershell
# 在项目根目录执行；它会用一个临时账号把线上链路整条走一遍，结束时自动删掉账号与云端数据
npm run check:cloud
# 想换站点：$env:UNIMATE_API_BASE='https://unimate3.pages.dev'; npm run check:cloud
```

覆盖：健康检查 → 注册 → 重复注册 409 → 错口令 401 → 空备份 404 → 上传（`sealed`）→ 下载逐字节一致 → 账号信息 →
无令牌 401 → 注销 → 注销后登录 401。**13 条断言，2026-09-23 已线上跑通**（PRD 14.3）。
`*.workers.dev` 自己 curl 超时是正常的（大陆 DNS 污染）：手机与自检都走 `pages.dev` 中转。

如果实际 Worker 地址不同，请在构建 App 时设置 `VITE_SYNC_API_BASE` 后重新出包。不要把任何 R2 密钥、pepper 或 `.dev.vars` 上传到仓库、Pages 或 APK。

## 安全边界

- R2 bucket 必须保持私有；不要开启 `r2.dev` 公网访问。
- 预签名 URL 是 15 分钟 bearer token，日志中不要记录完整 URL。
- Worker 按来源和边缘 IP 做速率限制；R2 侧仍应设置费用告警。
- 对象名是 `HMAC-SHA256(pepper, syncId)`，R2 中不会出现用户的同步码。
- 客户端将明文限制为 20 MB，Worker 将密文请求限制为 30 MB。预签名 PUT 无法可靠约束浏览器实际上传体积，生产环境仍需结合 Cloudflare 费用告警与异常监控。
