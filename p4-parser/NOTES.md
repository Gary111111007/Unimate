# P4 进展记录（接手的人从这里开始写）

## 现在的状态

- [x] 已开工
- [x] 已定路线：A 声明式规则 / 启发式识别（不做自训模型）
- [x] 已建立独立 P4 工位：`rules/`、`fixtures/`、`src/`、`tests/`、`report.md`
- [x] 已实现 JSON / HTML 双通道原型
- [x] 已跑通 20 条独立断言：`cd p4-parser; npm test`
- [x] 已写主工程整合设计：`INTEGRATION.md` + `integration/rule-pack-main.example.json`
- [x] 已有 P4 ↔ 主工程 `academic` 包装桥接：`src/mainBridge.ts`（往返转换测试通过）
- [ ] 主工程整合（不在本目录做）

## 我要做的东西（一句话）

把教务页面里的成绩与考试记录，用一套本机运行的规则/启发式逻辑识别出来；换学校或改版时优先改字段别名和规则包，不重新写学校专用解析器。

## 当前已经实现

1. 规则包 `rules/buct.json`：字段别名、菜单提示、JSON 数组键优先级。
2. JSON 通道：支持嵌套数组、常见载荷键、响应体多编码一层、深度/环保护。
3. HTML 通道：轻量提取表格表头和数据行，按表头映射为 `{列名: 文本}`。
4. 字段归一化：宽松数字、GPA 文本、内部课程 ID 过滤、标准课号优先、考试日期时间。
5. 菜单入口发现：从 `href` / `onclick` 里找 `cjcx` / `kwgl` / `kbcx` 等入口，不硬编码学校 URL。
6. 失败语义：空状态不伪造数据；提供 `keepLastSuccessful()` 保留上一次成功结果。
7. 脱敏诊断：只输出字段名、行数、失败步骤，不输出课程名、姓名、学号、教师名。

## 已验证

- `npm test`：20 条断言全部通过。
- 覆盖 JSON/HTML 两种通道，成绩/考试两种 scope；主工程现有 41 KB 脱敏 jqGrid 考试样本能识别 9 条记录。
- 列顺序颠倒、表头改名、删除可选列三种改版演练通过。
- 打桩 `fetch` 后解析调用计数为 0，证明当前解析路径不发网络请求。
- 诊断文本扫描不到样本里的课程名、教师名、学号。
- `npm run bench`：规则包 1926 B；成绩 JSON 约 0.1190 ms/次，成绩 HTML 约 0.1854 ms/次，考试 JSON 约 0.1056 ms/次，考试 HTML 约 0.1375 ms/次，主工程 41 KB 脱敏考试样本约 1.0472 ms/次（Node 24，1000 次平均，单次测量）。

## 未验证

- **没有真实教务页面样本**。当前 fixtures 是合成脱敏样本，真实页面结构、真实正方版本、真实字段差异都还没复验。
- 没有真机 WebView 注入、没有 UI 接入、没有持久化、没有提醒/记事接入。
- HTML 解析是轻量正则实现，不是完整 DOM 解析器；嵌套表格、复杂 `rowspan`、脚本动态渲染页面尚未验证。
- 没有验证“学校记录优先于本地 GPA”这条 UI 口径；当前原型不计算 GPA。
- 没有验证主工程签名下发通道；当前 `rules/buct.json` 是独立原型 schema，不能直接喂给主工程现有 `validateRulePack()`。
- 没有做独立 `tsc --noEmit`：本地未安装 TypeScript CLI，当前仅用 Node `--experimental-strip-types` 运行测试。

## 已知的坑

- 主工程现有的 `RuleKind` 只有 `timetable | exam`，没有 `grades`；P4 规则包多了 `scopes.grades`、`payloadArrayPriority`、`menuHints`、字段别名数组等结构，整合时必须扩主工程 schema，不能直接复用旧校验。
- 现有主工程规则包偏向“北化专用选择器覆盖”，P4 这里是“字段别名 + 双通道识别”，两者整合时需要明确是并行支持还是升级旧 schema。
- HTML 通道按表头文字识别；如果页面表头为空、表头在 `aria-describedby` 里或表格由 JS 动态生成，需要后续补真实样本和选择器规则。
- 诊断的 `channel` 已区分 JSON/HTML；但消息本身仍保持通用中文，避免泄露页面值。
- `TASK-成绩与考试一键识别.md` 引用的 `../docs/oss-reference.md` 在当前 `main` 不存在；本目录先放 `THIRD_PARTY_NOTICES.md`。若最终整合，建议产品负责人把 THEIA 的 MIT 声明并入主工程 `THIRD_PARTY_NOTICES.md`。

## 主工程整合进度（feat/p4-main-integration）

- `src/services/parser/rules.ts`：新增 `kind: academic`、`ACADEMIC_DEFAULTS`、`academicRules()` 和白名单校验。
- `src/services/schoolCatalog.ts` + `scripts/make-school-pack.mjs`：签名清单/打包工具接受 `academic` kind。
- `src/services/parser/academic.ts`：新增主工程版 JSON / HTML 双通道解析。
- `src/types.ts` + `src/stores/db.ts`：新增 `GradeItem` 和 `grades/grades.json` 本机持久化；`saveGrades()` 不触发云端自动同步，`STUDY_TEXT_FILES` / `FULL_TEXT_FILES` 都不包含成绩。
- `tests/academic.test.ts`：21 条断言，含规则校验、双通道解析、本机读写和不上云边界；已登记进 `package.json` 与 `scripts/build-apk.ps1`。
- 尚未接 UI：没有成绩面板、没有原生 `grade` 模式、没有成绩查询入口路由。
## 成绩 UI 进度（feat/p4-main-integration）

- 新增 src/views/GradePanel.vue：真实抓取 / 演示样本 → parseAcademicGrades → 预览 → 合并或覆盖（覆盖走二次确认）→ db.saveGrades()。
- 新增 src/services/gradeDemo.ts：离线演示样本。
- src/catalog/universities.ts 和 catalog/buct.json 增加“成绩查询”入口，action: 'grade'。
- src/views/OnlineView.vue 增加成绩面板路由。
- src/services/jwwebview.ts + JwWebViewActivity.java 增加 grade 模式，原生常驻按钮显示“识别成绩”。
- tests/academic.test.ts 32 条断言，包含 UI 接线、原生 mode、自动分页、考试 fallback、规则校验、双通道解析、本机读写和不上云边界。
- 最新版 main + P4 合并后的 APK 已生成：artifacts/android/unimate-debug.apk，6.74 MB，SHA-256 EB53CCA6501E3C5AF892037644C0FB68C928A8431B295D1FB9E4FB699EAD4BAF；全部 32 个测试套件、apksigner 和完整性校验通过。
- 成绩模式已实现原生自动分页：最多 20 页，找到下一页按钮后等待 AJAX 换页，累积每页表格 HTML 一次回传。
- 考试面板已接入通用 academic fallback：旧 jwglxt 解析器无结果时，改用 parseAcademicExams。
- 最新版 APK 已覆盖安装到 vivo V2134A；真实两页成绩已做真机自动分页验证。考试 fallback 已完成代码接线与单测，但仍缺一个“旧解析器失败、通用解析器成功”的真实页面。

## 真机验证记录（2026-10-03，vivo V2134A）

- APK 安装成功；演示账号和北化档案可用。
- 演示样本识别 4 条成绩，写入本机 grades.json；强制停止并重启 App 后仍显示 4 条。
- 真实教务 WebView 登录后进入学生成绩查询页，原生右下角显示“识别成绩”。
- 真实成绩表当前页识别 15 条，选择合并后本机文件共 19 条（4 条演示 + 15 条真实），没有上传云端。
- 2026-10-05 自动分页真机复验：真实成绩表共 2 页，连续识别到 16 条（旧版只识别第 1 页 15 条）；合并保存后本机共 20 条（4 条演示 + 16 条真实），说明第 2 页的 1 条已自动合并且重复数据被去重。
- 考试 fallback 已由测试验证：通用考试样本旧解析器返回 0 条，academic 解析器返回 3 条；还没有找到真实页面复验这条 fallback。

## 需要主工程配合的地方

- `src/services/parser/rules.ts`：增加 `grades` 类型、字段别名表、`payloadArrayPriority`、`menuHints`，并扩展白名单校验。
- `src/services/parser/`：整合 JSON 优先 / HTML 兜底入口；不要直接 import 本目录文件。
- `src/stores/db.ts`：把 P4 解析结果接入本机数据保存，失败时保留上一次成功记录（可以复用 `keepLastSuccessful` 的语义）。
- UI：成绩页/考试页显示“识别到多少条、哪些字段没识别、这次是否保留上次结果”；不得显示伪造 GPA。
- `catalog/index.json` / `adapters`：确认 P4 规则包的签名下发格式。当前原型 schema 与主工程签名清单格式不同，需要产品负责人拍板后再改。
- 测试：整合时新增测试文件必须同时登记进 `package.json` 与 `scripts/build-apk.ps1`；P4 独立测试目前只在 `p4-parser/package.json` 下运行。
