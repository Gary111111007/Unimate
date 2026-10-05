# P4 智能解析：成绩与考试一键识别（独立工位）

> 这个目录**不参与主工程构建**。`src/`、`android/`、`cloudflare/` 不改，整合由产品负责人完成。
> 当前分支：`feat/p4-grade-exam-parser`。

## 一、目标

用户在已经打开的教务页面里提供 HTML 或 JSON，Unimate 在**本机**自动认出成绩与考试记录：

- JSON 优先：适配正方等系统可能直接返回的 JSON 载荷。
- HTML 兜底：没有 JSON 时，按表头与值配对，不按固定列号。
- 字段别名：同一字段尝试英文、拼音、中文列名，换学校或改版时优先改规则包。
- 失败降级：不崩、不伪造 0 分/GPA，保留上一次成功数据，诊断文本不含课程名、姓名、学号。

## 二、快速验证

```powershell
cd p4-parser
npm test
npm run bench
```

当前独立测试结果见 [`report.md`](report.md)。

## 三、目录

```text
p4-parser/
├── TASK-成绩与考试一键识别.md   ← 任务书
├── README.md                     ← 本文件
├── NOTES.md                      ← 进展、坑、整合要求
├── THIRD_PARTY_NOTICES.md        ← THEIA / MIT 参考说明
├── INTEGRATION.md                ← 主工程整合设计
├── integration/                  ← 主工程 academic 包装示例
├── report.md                     ← 当前评测结果
├── rules/
│   └── buct.json                 ← 独立原型规则包（别名表 + 数组优先级）
├── fixtures/                     ← 脱敏 HTML / JSON 样本
├── src/
│   ├── types.ts                  ← GradeRecord / ExamRecord / 诊断 / 统计
│   ├── rules.ts                  ← 规则包 schema + 白名单校验 + 默认别名
│   ├── normalize.ts              ← 文本、数字、GPA、内部 ID、考试时间
│   ├── htmlTable.ts              ← 轻量 HTML 表格取表头/行
│   ├── parser.ts                 ← JSON 优先、HTML 兜底、菜单发现、保留 last-good
│   └── mainBridge.ts             ← P4 ↔ 主工程 academic 包装往返转换
└── tests/
    ├── run-tests.ts              ← 20 条独立验收断言
    └── bench.ts                  ← 体积与耗时基准
```

## 四、红线

1. 解析全程本机完成，不向任何服务器或第三方模型发送页面内容。
2. 不读 Cookie、不替用户发请求、不代填教务表单。
3. 真实姓名不入库。样本使用“智小汇 / 2025040999 / 教师 A~S”。
4. 不直接修改主工程；需要主工程配合的地方写进 [`NOTES.md`](NOTES.md)。

## 五、主工程整合时要注意

现有主工程的 `validateRulePack()` 只支持 `timetable` / `exam`，也没有成绩类型、JSON 载荷优先级和字段别名表。本目录的 schema 是 P4 原型 schema；整合时必须由产品负责人另开分支处理，不能把本目录直接 `import` 进 `src/`。

详细整合项见 [`NOTES.md`](NOTES.md) 的“需要主工程配合的地方”。
