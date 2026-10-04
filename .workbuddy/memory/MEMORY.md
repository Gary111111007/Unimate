# Unimate 项目长期备忘

> 只放跨会话仍然有效的约定与事实。日常流水记在 `YYYY-MM-DD.md`。

## Git / GitHub

- 仓库：`https://github.com/Gary111111007/UnimateUL.git`，主分支 `main`。
- 提交身份：`Gary111111007` / `2025040140@buct.edu.cn`（与 GitHub 账号绑定的邮箱，换机需重设）。
- **远程仓库已有历史，永远不要在这个目录 `git init`**（会造出两条无关历史线，push 必被拒）。
  正确做法：`git clone` 远程 → 把 `.git` 接进本地工作区 → 提交 → push。
- `.gitignore` 必须用 `**/node_modules/`（根目录写法会漏掉 `cloudflare/sync-worker/node_modules`，180M）。
- 仓库 git 配置里**不写 `http.proxy`**：沙箱代理端口每次会话都会变，写死必挂。
  Git 自动读 `http_proxy`/`https_proxy` 环境变量，故沙箱走代理、真机直连，两边都对。
  `http.sslVerify=false` 保留（解决最初的 `CRYPT_E_NO_REVOCATION_CHECK`）。

## Windows 脚本文件编码（**三种文件三种规矩，别混**）

| 文件类型 | 编码 | 换行 |
| --- | --- | --- |
| `.bat` / `.cmd` | **GBK (cp936) + `chcp 936`** | **CRLF** |
| `.ps1` | UTF-8 **带 BOM** | — |
| `.ts` / `.vue` | UTF-8 **不带 BOM** | — |

- **`.bat` 存成 UTF-8 会坏**：cmd 按系统 ANSI 代码页（中文 Windows = 936）解析文件，
  多字节序列错位会把行撕裂、碎片被当命令执行（报 `'xxx' 不是内部或外部命令`）。
  `chcp` 只改控制台**输出**代码页，改不了**解析**用的代码页。
- **改 bat 只能用能保 CRLF 的方式**：Python `io.open(..., newline='')` 读写，
  并在写前显式 `t.replace('\r\n','\n').replace('\n','\r\n')`。
  默认 `newline=None` 读会把 `\r\n` 转成 `\n` → 落盘成 LF-only → cmd 全线崩溃。
- bat 若涉及"按行读命令输出"，用 `for /f "delims=" %%a in ('cmd') do ...`，`>` 需转义成 `^>`。

## 环境

- 桌面**不在** `C:\Users\Gary\Desktop`，实际是 `D:\Desktop`（重定向）。
  `reg.exe` 被安全策略拉黑，靠全盘搜 `desktop.ini` 定位。
- 沙箱内 `vite build` 被 safe-delete 守卫拦，绕法见 `AGENTS.md` 第二节。
