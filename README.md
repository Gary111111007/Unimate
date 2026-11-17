# Unimate

**高校校园学习生活一站式智能助手**。Unimate 将课表、记事、第二课堂和校园服务放在一起，并提供文字助手 Uni。项目的首个落地高校是北京化工大学，Android 应用包名为 `com.unimate.app`。

> 当前项目定位为学生自制演示作品及个人自用。功能、验收标准与历史记录以 [PRD.md](./PRD.md) 和 [项目上下文](./docs/context.md) 为准。

## 能做什么

- **课表与教务**：查看和编辑课表、设置提醒、分享课表；北化通过教务页面表格导入。外校正方教务系统提供独立导入链路，也可尝试识别教务地址；实际可用性取决于学校系统，其他类型尚未完成导入适配。
- **学习生活**：记录待办和提醒、管理第二课堂材料与照片，使用校园在线入口及校园工具。校园地图是离线建筑示意图，不是导航。
- **Uni 文字助手**：使用本机规则处理课表、记事等请求；开放式问题可通过在线服务处理，网络或服务不可用时尝试本机规则。在线请求会发送用户主动输入的文字，不会自动附带课表和记事等数据。
- **备份与换机**：提供账号登录云备份、可选的端到端加密同步，以及本机 ZIP 备份与恢复。
- **天气**：可选功能，默认关闭；开启后需要联网获取天气。

## 高校支持

| 高校 | 档案状态 |
| --- | --- |
| 北京化工大学 | 首个落地高校，档案随 APK 内置并在选校页置顶。 |
| 北京第二外国语学院 | 通过签名云端档案提供，下载前显示“可下载”，下载后才可使用；不含第二课堂。 |
| 其他高校 | 出现在选择列表中并标记“开发中”，不能视为已支持。教务识别入口可用于尝试导入，结果取决于实际系统。 |

学校档案通过签名和摘要校验后安装，详见 [学校档案说明](./docs/school-pack.md)。

## 数据与隐私

本机始终保留完整数据，断网不会阻断其他本机功能。云端是备份和取回方式，包含两种模式：

1. **账号登录（默认主推）**：课表、记事、第二课堂材料和照片可备份到服务器。服务器持有落盘密钥，可以读取内容；密码原文不上传，客户端会派生验证值。
2. **端到端加密同步（可选）**：服务器只存储 AES-256-GCM 密文，同步口令和恢复码不上传、不落盘。忘记口令且丢失恢复码时无法找回。

当前云端使用 Cloudflare 境外节点，账号模式中的可读数据涉及数据出境。面向真实用户运营前，应迁移至境内存储，或按个人信息保护及数据出境相关规定处理。部署和密钥配置见 [云服务说明](./cloudflare/sync-worker/README.md)。

## 本地开发

项目使用 **Vue 3、TypeScript、Vite、Pinia 和 Capacitor 6**。准备支持项目测试脚本中 `--experimental-strip-types` 的 Node.js 版本与 npm，在仓库根目录执行：

```bash
npm ci
npm run dev
```

按 Vite 输出的地址打开浏览器。登录页可直接选择“用演示账号登录”（`admin` / `buct`）。浏览器预览不能替代 Android 真机验证，原生功能可能降级或不可用。

常用检查：

```bash
npm run test:parser
npm run test:boot
npm run test:order
npm run test:css
```

全部测试命令见 [package.json](./package.json)；改动相关代码时请按 [AGENTS.md](./AGENTS.md) 执行对应检查。Windows 环境下载、安装、构建和测试前，先阅读 [C 盘存储策略](./C_DRIVE_STORAGE_POLICY.md)。

## 构建 Android APK

准备 JDK 17、Android SDK 34 和项目所需的 Node.js 环境。首次搭建可参考 `scripts/setup-android-toolchain.ps1`；请先确认下载及存储位置符合项目策略。正式出包使用项目脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-apk.ps1
```

脚本包含测试、构建和包内容校验；产物为 `artifacts/android/unimate-debug.apk`。原生 WebView、相机、通知和后台提醒等仍需在目标设备上验证，提醒效果也受系统权限和厂商后台策略影响。

## 项目结构

| 路径 | 内容 |
| --- | --- |
| [`src/`](./src/) | Vue 页面、组件、Pinia 数据层和业务服务。 |
| [`android/`](./android/) | Capacitor Android 工程与原生桥接代码。 |
| [`cloudflare/`](./cloudflare/) | 云账号、备份与在线助手相关服务。 |
| [`catalog/`](./catalog/) / [`public/catalog/`](./public/catalog/) | 学校档案及签名发布文件。 |
| [`tests/`](./tests/) / [`fixtures/`](./fixtures/) | 测试与脱敏样本。 |
| [`p4-parser/`](./p4-parser/) | 成绩与考试解析的独立工位，解析在本机进行。 |
| [`p5-assistant/`](./p5-assistant/) | AI 助手独立工位，集成由产品负责人统一处理。 |
| [`docs/`](./docs/) | 部署、架构、学校档案与项目上下文。 |

贡献或修改前请阅读 [工程约定](./AGENTS.md)、[产品需求](./PRD.md) 和 [第三方声明](./THIRD_PARTY_NOTICES.md)。
