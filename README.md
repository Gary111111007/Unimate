# Unimate — 高校校园学习生活一站式智能助手

首个落地高校：**北京化工大学**。产品定义与验收标准见 [PRD.md](./PRD.md)。

## 一条命令出 APK

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-apk.ps1

产物：`artifacts/android/unimate-debug.apk`，安装：`adb install -r artifacts\android\unimate-debug.apk`

首次搭建环境（JDK 17 + Android SDK 34，无需管理员权限）：

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-android-toolchain.ps1

## 技术栈

Capacitor 6 + Vue 3 + Vite + TypeScript，包名 `com.unimate.app`。全部数据存本机，不联网、不上报、不内置任何第三方 Key。

## 目录

| 路径 | 说明 |
| --- | --- |
| `src/catalog/universities.ts` | 内置高校名单（北化 `live` 置顶，其余 `developing`） |
| `src/services/parser/jwglxtBuct.ts` | 教务"个人课表查询"解析器（北化适配器） |
| `src/services/zip.ts` | 备份容器（标准 ZIP，store 模式，无第三方依赖） |
| `src/services/watermark.ts` | 拍照水印（自主开关，本地 Canvas 烧录） |
| `src/stores/db.ts` | 账号 / 学校分区 / 数据读写 / 通知排期 |
| `android/app/src/main/java/com/unimate/app/` | 内嵌 WebView 原生插件（只读课表表格 HTML） |
| `fixtures/jwglxt-buct.sample.html` | **脱敏**教务页面样本（教师为代号、学生为"智小汇"），Golden Test 用 |
| `tests/` | `npm run test:parser`（57 断言）、`npm run test:zip`（9 断言） |

## 演示账号

`admin` / `buct` —— 登录后自动填充示例课表（25 条上课安排）、记事与第二课堂记录，可在"我的"里一键重置。

## 已知限制

- 工程路径含中文，AGP 需 `android.overridePathCheck=true`（已配置），且 `aapt` 需先把 APK 复制到 ASCII 路径再校验（构建脚本已处理）。
- 内嵌教务 WebView 与相机/定位/通知需真机验证；桌面预览会自动降级为"内置脱敏样本演示导入"。
