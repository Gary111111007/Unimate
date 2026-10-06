# P4 主工程整合设计（不改主工程）

日期：2026-10-02  
对照主工程：`f1d5d99`（v2.57）  
性质：**设计文档**。本文件只给产品负责人整合时使用，不代表 `src/` 已经改过。

## 一、结论

P4 独立原型已经能识别 JSON/HTML 里的成绩与考试，但主工程现有规则包只支持 `timetable` 和 `exam` 两种“北化专用选择器规则”。

建议不要直接把现有 `rules.ts` 改造成一个大杂烩，而是新增第三种规则类型：

```ts
export type RuleKind = 'timetable' | 'exam' | 'academic';
```

`academic` 规则包同时包含 `grades` 和 `exams` 两个 scope，内容就是 P4 原型里的：

- `menuHints`：从页面链接发现入口，不硬编码学校 URL；
- `payloadArrayPriority`：JSON 载荷数组键优先级；
- `scopes.grades.aliases` / `scopes.exams.aliases`：字段别名表；
- 后续可扩展选择器，但第一版先不引入任何可执行代码。

这样现有 `timetable` / `exam` 规则完全不动；`academic` 是新增能力。原有北化考试解析器继续作为高置信路径，P4 通用识别作为降级/跨校路径。

## 二、主工程现状（已核对）

| 位置 | 现状 | 对 P4 的影响 |
| --- | --- | --- |
| `src/services/parser/rules.ts` | `RuleKind = 'timetable' \| 'exam'`；`RulePack.rules` 是 `Record<string, any>`；`validateRulePack()` 对两种 kind 使用不同白名单 | 必须增加 `academic` 分支，不能把 P4 包直接喂给旧校验 |
| `src/services/schoolCatalog.ts` | `AdapterEntry.kind` 只允许 `timetable \| exam`；`parseAdapterEntry()` 会直接拒绝其他 kind | 签名清单也要接受 `academic` |
| `src/stores/db.ts` | 已有读/写 `adapters/downloaded.json`、`setActiveRulePacks()`、下载/删除规则包逻辑 | 不需要新网络通道；只需让新 kind 通过校验并生效 |
| `src/views/ExamPanel.vue` | 目前直接调用 `parseJwglxtExams(html)`，只识别北化考试表 | 需要一个“现有解析器优先 → P4 通用解析器兜底”的编排点 |
| `src/views/ImportPanel.vue` | 直接调用 `parseJwglxtTimetable(html)` | 课表不在本次 P4 范围；先不动，避免扩大风险 |
| `src/views/OnlineView.vue` | 只处理 `a.action === 'exam'` | 成绩面板需要新增 action 路由，例如 `grade` |
| `src/types.ts` | 有 `Course` / `NoteItem` / `ParseResult`，没有 `GradeItem` | 成绩的持久化模型和云同步口径必须先拍板 |
| `catalog/buct.json` | “教务系统”条目描述包含成绩，但没有 `action: 'grade'` | 新增成绩入口时要保留现有“打开教务系统”行为 |
| `src/services/parser/jwglxtExam.ts` | 现有考试解析器和 Golden Test 是主工程高置信路径 | 不能被 P4 直接替换；只能做 fallback |

## 三、目标架构

```text
页面 HTML / JSON
      │
      ├─ 现有北化高置信解析器（考试）
      │      └─ 有记录 → 直接使用，保持现有行为
      │
      └─ P4 academic recognizer
             ├─ JSON 优先：找载荷数组
             ├─ HTML 兜底：表头 + 值配对
             ├─ 别名表归一化
             ├─ 行过滤 / 内部 ID 过滤
             └─ 生成 GradeItem / ExamItem + 脱敏诊断
```

### 3.1 规则包形态

主工程新增 kind 后，规则包外层沿用现有 `RulePack`：

```json
{
  "schemaVersion": 1,
  "adapterId": "academic-buct",
  "kind": "academic",
  "version": 2,
  "note": "P4 成绩/考试通用识别",
  "rules": {
    "schoolId": "buct",
    "menuHints": ["jwglxt", "cjcx", "kbcx", "kwgl"],
    "payloadArrayPriority": ["items", "rows", "data", "result", "list", "records"],
    "scopes": {
      "grades": { "aliases": { "courseName": ["kcmc", "课程名称", "course"] } },
      "exams": { "aliases": { "examTime": ["kssj", "考试时间"] } }
    }
  }
}
```

完整示例见 [`integration/rule-pack-main.example.json`](integration/rule-pack-main.example.json)。它把 P4 独立 prototype 的 `schoolId` 放进 `rules.schoolId`，外层换成主工程需要的 `adapterId + kind + rules`。P4 原型里的 [`src/mainBridge.ts`](src/mainBridge.ts) 已提供双向转换和测试。

### 3.2 解析服务边界

建议新增：

```text
src/services/parser/academic.ts
```

职责：

- 只接受“已经由用户打开并回传的 HTML/JSON”；
- 不调用 `fetch`、不读 Cookie、不代填表单；
- 输入：`input: string, scope: 'grades' | 'exams', rules: AcademicRules`；
- 输出：`AcademicParseResult`，包含 records、channel、diagnostics、stats；
- 解析失败只能返回结构化诊断，不能抛出未捕获异常。

主工程不要直接 `import` `p4-parser/src/`。整合时由产品负责人在另一个分支把经过测试的逻辑落到 `src/services/parser/academic.ts`。

### 3.3 编排与回退

考试路径建议改成：

1. `parseJwglxtExams(html)`；
2. 如果 `exams.length > 0`，使用旧路径，行为完全不变；
3. 如果旧路径为空，调用 `academic.ts` 的通用考试识别；
4. 如果两条都为空，返回 P4 诊断，不覆盖原有数据。

成绩路径没有旧解析器，直接调用通用成绩识别。

### 3.4 UI 建议

- 新增 `GradePanel.vue`，不要把成绩塞进 `ExamPanel.vue`。
- 在 `catalog/buct.json` 给“教务系统”增加 `action: 'grade'`，但保留“打开教务系统”原有行为。
- 在 `OnlineView.vue` 增加 `a.action === 'grade'` 路由。
- 面板必须显示：
  - 识别到几条；
  - 走的是内置高置信路径还是 P4 通用路径；
  - 哪些字段没识别到；
  - 是本次新结果，还是保留了上一次成功结果。
- 不显示编造的 GPA。没有可计算成绩就显示空状态。
- “回到内置规则”沿用现有 `ParserRulesBar` 的二次确认。

## 四、建议整合顺序

1. **冻结数据契约**
   - 定 `GradeItem` / `ExamItem` 字段；
   - 定 `academic` 规则包 JSON schema；
   - 先把本文和示例给产品负责人拍板。

2. **扩展规则类型**
   - `rules.ts`：`RuleKind` 加 `academic`，增加 `AcademicRules` 接口和白名单校验；
   - `schoolCatalog.ts`：`AdapterEntry.kind` 加 `academic`，`parseAdapterEntry()` 放行；
   - `BUILTIN_ADAPTER_VERSIONS` 增加 `academic-buct: 1` 或按实际 id 命名。

3. **落地通用解析服务**
   - 新增 `src/services/parser/academic.ts`；
   - 用 P4 的 `fixtures/grades.sample.*`、`fixtures/exams.sample.*` 和主工程 41 KB 脱敏考试样本做 Golden Test；
   - 先不接 UI，先让服务层稳定。

4. **接考试面板 fallback**
   - 修改 `ExamPanel.vue` 的 `importHtml()`；
   - 旧解析器优先；旧解析器为空再走通用解析器；
   - 保持现有写入记事本和提醒逻辑不变。

5. **接成绩面板**
   - 新增 `GradePanel.vue`；
   - 增加 `grade` action 路由；
   - 先做只读展示与诊断，不自动写入任何云端数据。

6. **决定成绩持久化**
   - 当前产品口径只明确课表、记事、二课材料/照片进账号同步；
   - 成绩是否落盘、是否上云、是否参与换机同步必须单独拍板；
   - 未拍板前，成绩只做本机当前会话展示，避免悄悄扩大数据出境范围。

7. **回归与出包**
   - 新测试文件必须同时登记进 `package.json` 与 `scripts/build-apk.ps1`；
   - 跑全部现有测试套件；
   - 出包只走 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-apk.ps1`；
   - 真机验证：考试旧路径、P4 fallback、成绩空状态、断网、失败保留上次结果。

## 五、验收测试矩阵

| 场景 | 预期 |
| --- | --- |
| 现有北化考试页 | 旧解析器命中，P4 不介入，输出与 v2.57 一致 |
| 旧解析器认不出、P4 能认出的考试 HTML | P4 fallback 命中，写入记事本 |
| P4 JSON 接口响应 | JSON 通道命中 |
| 成绩 HTML | 成绩面板显示，不写云端 |
| 空成绩表 | 空状态，不生成 0 分或 GPA |
| 改坏表头 | 能降级并显示缺失字段 |
| 断网 | 解析仍可用，网络请求计数为 0 |
| 下载规则包 | Ed25519 + sha256 + `academic` 白名单通过后才生效 |
| 规则包被改 | 整份拒收，继续用内置规则 |
| 解析失败 | 旧成功记录仍在，诊断不含课程名/姓名/学号 |

## 六、建议默认决策

- **接受 `kind: academic`**：不改旧 `timetable` / `exam`，新增一种通用识别规则。
- **成绩第一阶段只显示，不持久化、不上云**：先验证识别准确率和错误降级；等结构稳定后再决定是否保存。
- **考试继续保留旧解析器优先**：旧解析器命中时完全不启用 P4，避免破坏 v2.57 行为。

## 七、待产品负责人拍板

1. 是否接受新增 `kind: 'academic'`，而不是把 `grade` 硬塞进现有 `exam` kind。
2. 成绩是否要持久化；如果不持久化，是否只做当次预览/导出。
3. 成绩如果上云，是否纳入账号同步、是否接受与课表同等级别的数据出境事实。
4. 第二所高校的真实脱敏样本从哪里来；没有它，P4 只能证明“北化结构 + 合成变体”，不能证明跨校。
5. THEIA MIT 声明放在 `p4-parser/THIRD_PARTY_NOTICES.md` 还是整合时并入主工程 `THIRD_PARTY_NOTICES.md`。
