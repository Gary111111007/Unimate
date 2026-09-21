# 学校档案热更新（Net.md P2 / PRD 5.14）

一句话：**新增或修改一所高校的档案，不用重新发 APK。** 桌面端把档案签好名丢到站点上，
App 打开「选择高校」页时（每天最多一次）拉清单、验签、下载、校验，通过后就能像内置高校一样用。

---

## 1. 文件都在哪

| 位置 | 是什么 | 要不要入库 |
| --- | --- | --- |
| `catalog/<schoolId>.json` | **源档案**。内置的两所由 TS 导出，新高校直接手写/照抄一份 | 要 |
| `public/catalog/index.json` | 清单（校名/版本/sha256/大小），**被签名保护** | 要（随 `npm run build` 进 `dist`） |
| `public/catalog/index.json.sig` | 清单签名（base64url） | 要 |
| `public/catalog/<schoolId>.json` | 下发给客户端的档案（与源文件同字节） | 要 |
| `keys/school-signing.key` | **私钥** | **绝不入库**（`.gitignore` 已挡，也不要外发） |
| `src/catalog/schoolKey.ts` | 公钥（硬编码进 APK） | 要 |

## 2. 一次性：生成密钥

```powershell
node --experimental-strip-types scripts\make-school-pack.mjs keygen
```

它会把私钥写到 `keys/school-signing.key`，并打印一行公钥 —— 把公钥贴进 `src/catalog/schoolKey.ts` 的
`SCHOOL_CATALOG_PUBKEY`。

> ⚠️ 换密钥 = 重新出包。**旧 APK 只认旧公钥**：换了私钥而不发新包，老用户的 App 会把新清单判为"签名无效"并拒收
> （这是防投毒该有的行为，不是 bug）。真上线时按 Net.md 3.3 把私钥放进 CI secrets。

## 3. 日常：改档案 / 加一所高校

```powershell
# 1) 内置的两所（北化/北二外）：改 src/catalog/universities.ts，然后把 profileVersion +1
# 2) 新高校：在 catalog/ 下新建 <schoolId>.json（可以照抄 catalog/buct.json 改）
node --experimental-strip-types scripts\make-school-pack.mjs        # = export + sign
npm run build                                                       # public/catalog/* 会进 dist
# 3) 把 dist 传到静态站（见 docs/deploy.md）
```

硬性要求（脚本会拦住不合格的档案）：

- `status` 必须是 `live`：**没核实过的高校不许下发**（AGENTS.md 第 4 条）；
- 所有网址只允许 **https**，不许 IP / localhost / `javascript:`；
- `dataDir` 必须是 `schools/<schoolId>`；`academic.periodTimes` 长度要与 `periodCount` 一致；
- 改了内容就要把 `profileVersion` +1，否则 App 不会提示「可更新」；
- 新高校要自己写 `letter`（拼音首字母）与 `order`（名次）—— App 不猜拼音。

## 4. 客户端怎么把关的

1. 打开「选择高校」页 → 检查清单，**每天最多成功一次**（失败后 5 分钟退避）；
2. 清单必须能通过 **ECDSA P-256 / SHA-256** 验签（公钥在 APK 里），否则整份丢掉并提示；
3. 下载档案后先算 **sha256**，必须与签名过的清单一致；再做结构与域名校验；
4. 通过后写本机 `catalog/downloaded-schools.json`，重启仍在；选校页底部可「删除 → 回到内置」；
5. 拉不到 / 验签失败 / 不支持验签 → 一律退回 APK 内置的 53 所名单，功能照常。

> **必须跑在安全上下文**：WebCrypto（`crypto.subtle`）只在 https 或 localhost 下存在。
> APK 里页面地址是 `https://localhost`（安全）✓。若哪天改成明文 http 域名打开，验签会直接降级为"不支持"并拒收 —— 这是刻意的。

## 5. 怎么验证（每次改完都跑）

```powershell
npm run test:schoolpack     # 103 条：发布包自检（验签/sha256/白名单/篡改必拒/按字节稳定）+ 限频 + 合并 + store 安装/持久化/删除
```

发布包自检是**用真文件 + APK 里那把公钥**验的，所以"改了档案忘了重新签名"这类事一定会被它抓住。

## 6. 排查表

| 现象 | 原因 | 怎么办 |
| --- | --- | --- |
| 选校页写着"签名校验失败，已拒收" | 站点上的 `index.json` 与 `index.json.sig` 不配对（改了清单没重签，或上传了旧的 sig） | 重跑 `make-school-pack.mjs`，把 `public/catalog` 一起传上去 |
| 写着"当前系统的 WebCrypto 用不了 ECDSA 验签" | 页面不在安全上下文（明文 http 打开），或 WebView 太旧 | APK 内是 `https://localhost`，正常不会出现；浏览器里用 `https`/`localhost` 调试 |
| 写着"站点上没有清单或签名文件" | 只传了档案没传清单，或路径不是 `/catalog/` | 站点根目录下要有 `catalog/index.json`、`index.json.sig`、`<id>.json` |
| 明明改过档案，App 里还是"已可使用"没有「可更新」 | `profileVersion` 没 +1（或等于内置版本） | 把 `profileVersion` +1 再签一次 |
| 脚本报"公钥与私钥不配对，别上传" | `schoolKey.ts` 里是另一把钥匙的公钥 | 重新 `keygen` 并把新公钥贴进去（或找回对应的私钥） |
| 脚本报"status 不是 live" | 档案还是 developing | 核实完域名/节次表再改成 live；没核实就不要下发 |
