# Unimate P3 同步服务（Cloudflare Worker + R2）

Worker 只为单个密文对象签发 15 分钟的 R2 `GET` / `PUT` URL，备份正文由 App 直接传输到 R2。同步口令、恢复码和数据明文都不会到 Worker。

## 首次部署

1. 在 Cloudflare R2 创建私有 bucket：`unimate-sync`。
2. 创建只允许读写该 bucket 的 R2 API Token，取得 Access Key ID 与 Secret Access Key。
3. 在本目录执行 `npm install`，然后依次执行：

   - `npx wrangler secret put R2_ACCOUNT_ID`
   - `npx wrangler secret put R2_ACCESS_KEY_ID`
   - `npx wrangler secret put R2_SECRET_ACCESS_KEY`
   - `npx wrangler secret put SYNC_OBJECT_PEPPER`（填至少 32 字节随机串）

4. 执行 `npx wrangler r2 bucket cors set unimate-sync --file cors.json`。
5. 执行 `npm run deploy`，确认地址为 `https://unimate-sync.2025040140.workers.dev`。
6. 打开 `/health`，应返回 `{"ok":true,"service":"unimate-sync"}`。

如果实际 Worker 地址不同，请在构建 App 时设置 `VITE_SYNC_API_BASE` 后重新出包。不要把任何 R2 密钥、pepper 或 `.dev.vars` 上传到仓库、Pages 或 APK。

## 安全边界

- R2 bucket 必须保持私有；不要开启 `r2.dev` 公网访问。
- 预签名 URL 是 15 分钟 bearer token，日志中不要记录完整 URL。
- Worker 按来源和边缘 IP 做速率限制；R2 侧仍应设置费用告警。
- 对象名是 `HMAC-SHA256(pepper, syncId)`，R2 中不会出现用户的同步码。
- 客户端将明文限制为 20 MB，Worker 将密文请求限制为 30 MB。预签名 PUT 无法可靠约束浏览器实际上传体积，生产环境仍需结合 Cloudflare 费用告警与异常监控。
