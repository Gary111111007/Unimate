# 演示站部署与更新（Cloudflare Pages）

> 目的：让评委/同学在**公网**上打开 Unimate（不装 APK 也能体验），并把每次改动的成果一键更新上去。
> 免备案：站点托管在 Cloudflare 的境外节点，**不需要 ICP 备案**。

## 0. 已确定的信息

| 项 | 值 |
| --- | --- |
| 演示站地址 | `https://unimate3.pages.dev` |
| 项目名（Pages） | `unimate3` |
| 本地产物目录 | `E:\Gary\北京化工大学\北化app\Work\dist`（`npm run build` 生成） |

**⚠️ 不要用 `*.workers.dev`**：实测 `example.workers.dev` 与 `unimate.2025040140.workers.dev` 在校园网/大陆网络**连接超时**，而 `www.cloudflare.com` 200、`*.pages.dev` 可连。评委多半也在大陆，所以演示地址只发 `pages.dev`（或你自己的域名）。

## 1. 首次部署（已完成，留档）

1. <https://dash.cloudflare.com> → **Workers & Pages** → **Create application**；
2. 页面最底部 *Need to use the legacy Pages workflow?* → **Continue to Pages**；
3. **Upload assets** → 项目名 `unimate3`；
4. 打开 `Work\dist`，**全选里面的三样**一起拖进去：`index.html`、`assets/`、`sample-timetable.html`；
   **检查第一层不是 `dist/`**（多一层就会 404 → 打开是空白页）；
5. **Deploy** → 得到 `https://unimate3.pages.dev`。

## 2. 每次更新的流程

```powershell
cd E:\Gary\北京化工大学\北化app\Work
npm run build
npx wrangler pages deploy dist --project-name unimate3
```

不想用命令行：回到 Cloudflare 项目页 → **Create new deployment** → 再拖一次新的 `dist` 内容。

> 出包（APK）与部署（网页）是两件事：`scripts\build-apk.ps1` 只产出 APK；网页要按上面单独部署。

## 3. 部署后必须做的验证

- [ ] 手机 **5G** 打开 → 能进；
- [ ] 手机 **校园网 Wi-Fi** 打开 → 能进；
- [ ] 电脑打开 → F12 → Network：主 JS（`assets/index-*.js`）返回 **200**，Console 无红色报错；
- [ ] 点「用演示账号登录（admin / buct）」→ 课表 / 第二课堂 / 校园服务 / 考试查询样本都能打开；
- [ ] 切到**北京第二外国语学院** → 第二栏是「活动材料」、只有志愿时长与劳育时长；
- [ ] 课表工具箱 → 「分享这张课表」→ 二维码画得出来，另一台手机扫码能打开只读课表页。

## 4. 排查表

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 打开一片空白（黑底/白底、没有一个字） | `assets/` 没上传，或上传时多套了一层 `dist/` | 重新上传，确认第一层是 `index.html` + `assets/` |
| 一直转圈打不开 | 域名在大陆被限（`workers.dev` 尤其明显） | 换 `pages.dev` 或绑自有域名 |
| 打开显示 522 | Cloudflare 连不到源（通常是项目没部署成功/被删） | 看项目页的 deployments 是否成功 |
| 改完代码线上没变化 | 忘了 `npm run build` 或忘了重新部署 | 按第 2 节重跑 |
| 扫码打不开只读页 | 网址太长被截断，或用了别的站点域名 | 用工具箱里的「复制分享链接」发链接；二维码放不下时界面会提示改用链接 |

## 5. 自定义域名（可选，仍然免备案）

1. 买域名（`.top` 十几元/年，`.com` 60~80 元/年）；
2. Cloudflare → **Domains** → 添加站点 → 按提示把域名的 NS 改到 Cloudflare；
3. Pages 项目 → **Settings → Domains & Routes → Add → Custom domain** → 选你的域名；
4. 之后用 `https://你的域名` 访问。**只要不解析到大陆服务器/CDN，就不需要备案**；哪天要接国内节点提速，则必须先备案（域名实名 + 国内云资源 + 提交 ICP，7~20 个工作日）。

## 6. 答辩材料的口径建议

- 演示站讲"**公网可访问 + 数据不采集**"：访客的数据存在自己浏览器里，站点不存任何用户数据；
- 断网/无校园网时用**内置脱敏样本**演示（课表导入、考试识别两条链路都支持）；
- 校园网相关的真实抓取用**录屏**佐证；
- 三条腿走路：**APK + 演示站 + 录屏**，不把宝押在单一入口上。
