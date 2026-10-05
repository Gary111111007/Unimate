# P4 任务书：教务「一键识别成绩 / 考试」

> **给接手的同学看**：这份文档自成一体，你不需要先读别的也能开工；但动手前请务必读  
> [`README.md`](README.md)（P4 工位约定）和 `../Net.md` 的 **§2.6**（P4 的完整评估）。  
> 本文只回答一件事：**"一键识别成绩/考试"具体怎么实现**。
>
> 编写：2026-09-30 ｜ 依据：`bakahuiii/THEIA`（MIT）的成绩/考试解析实现 + 本仓库 P4 既有约定  
> **重要前提**：下面所有"他们怎么做"的知识，来自我**阅读 THEIA 源码**（逐文件行号见文末附录），  
> **我没有运行过他们的代码**，也没有在我们的样本上验证过。所以每一条都要你自己在我们的脱敏样本上复验。

---

## 一、目标（一句话）

用户从教务系统里**把页面拿来**（粘 HTML / 从内嵌 WebView 抓 / 传文件都行），  
App 能**自动认出**里面的成绩与考试记录并结构化，**不用为每个学校手写一个解析器**。

关键词&#x662F;**"认"而不是"配"** —— 现在我们的 `src/services/parser/jwglxtExam.ts` 是"北化专用规则"，  
P4 要的是"**换一所学校、甚至学校改版后，同一套逻辑还能认出来**"。

---

## 二、直接抄这一条总纲（最重要的发现）

THEIA 的解析器**不硬编码任何教务页面 URL**。

> 原话：*"所有页面 URL 都来自解析结果（菜单 `onclick`/`href`、表单 `action`、通知链接等）。"*

它只认三个入口特征：

- 首页默认 `https://jwglxt.buct.edu.cn/jwglxt/`
- 登录页正则 `/\/xtgl\/login_slogin\.html$/i`
- **菜单链接关键词正则 `/jwglxt|cjcx|kbcx|kwgl/`**（`cjcx`=成绩查询、`kbcx`=课表查询、`kwgl`=考务管理）

也就是说：**它是"顺着页面自己给的链接走"，而不是"猜 URL"**。  
这就是为什么它不用给每所学校写适配器 —— 学校改名/改路径它都不怕。

👉 **这一条比任何字段表都重要**。我们现在的思路是"为每个学校配一份 URL + 选择器"，  
THEIA 的思路是"**从页面里发现入口**，只把字段映射做成可配的"。  
**建议 P4 采用后者**，把"配 URL"降级成"发现不到才手动兜底"。

---

## 三、要做的六件事（按依赖顺序，可逐项勾）

### T1 双通道解析：JSON 优先，HTML 表格兜底 ★核心

同一个页面，**先当 JSON 解，解不动再当表格解**：

| 通道        | 做法                                                                                | 失败后           |
| --------- | --------------------------------------------------------------------------------- | ------------- |
| ① JSON    | `JSON.parse` → 递归找"数组载荷"                                                          | 静默回退到 ②       |
| ② HTML 表格 | 表头 `thead th, tr:first-child th`；行 `tbody tr, tr`；单元格按**索引位置**把列名和值配对成 `{列名: 文本}` | 两条都不行才报"认不出来" |

**为什么要双通道**：正方有"直接返回 JSON 的接口"（`zfn_api` 风格）和"渲染成表格的页面"两种形态，  
**同一所学校不同页面就可能不一样**。只做表格，遇到 JSON 接口就白费；只做 JSON，遇到老页面就全废。

JSON 通道的两个坑（他们踩过）：

1. **数组键名各校不一**，必须按优先级列表找第一个非空数组：  
   `kblist, items, rows, data, result, list, aadata, records, recordlist, datalist, gradelist, courselist, sjklist, jxhjkclist`
2. **有的部署把 JSON 多编码了一层**（响应体本身是一个 JSON 字符串）。要**递归解包**，并且  
   **深度 > 5 或检测到环就停**（`seen` 集合），防炸栈。

### T2 字段映射用「别名表」，不要用固定列序 ★核心

**这是"一键识别"能跨校通用的真正原因。**

不要假设"第 3 列是课程名"。要给每个字段配一串**候选名**，中英文都试：

| 字段    | 依次尝试的候选名（英文/拼音/中文列名）                             |
| ----- | ------------------------------------------------ |
| 课程代码  | `kch` → `courseCode` → **`课程代码`** → `kch_id`     |
| 课程名称  | `kcmc` → **`课程名称`** → `courseName`（全空则给 `未命名课程`） |
| 学分    | `xf` → **`学分`** → `credits`（过 `parseNumber`）     |
| 成绩    | `cj` → **`成绩`** → `score`                        |
| 绩点    | `jd` → **`绩点`** → `point`（过 `parseNumber`）       |
| 教师    | `jsxm` → **`教师`** → `teacher`                    |
| 考核方式  | `ksxz` → **`考核方式`** → `assessment`               |
| 成绩状态  | `cjbs` → **`成绩状态`** → `status`                   |
| 备注    | `bzxx` → `cjbz` → `bz` → `ksbz` → `remark`       |
| 学年/学期 | `xnm`/`xn`/`year` + `xqm`/`xq`/`semester`        |

考试页：`ksmc`→**`考试名称`**、`kssj`→**`考试时间`**、`cdmc`→**`考试地点`**、`xqmc`→**`校区`**、  
`zwh`→**`座号`**、`ksfs`→**`考试方式`**、`ksbz`/`bzxx`→备注。

👉 **落地方式**：这张别名表就是 P4 的**规则包内容**。把它写成 JSON（见 T6），  
新增学校 = 加几条别名，**不用改代码**。

### T3 不合格行的过滤（别把垃圾当成绩）

两个必须做的判定：

- **整行无效就丢**：成绩行要求 `课程名 !== '未命名课程' || 有成绩`；考试行要求 `课程名 !== '未命名考试' || 有时间`。
- **不许把"内部 ID"当课程代码**（这条很实用，我们现在可能就吃这个亏）：
  - `isInternalCourseId`：`/^[0-9A-F]{16,}$/i` —— 一串 16 位以上十六进制 = 系统内部 ID，**不是课号**
  - `isStandardCourseCode`：`/^[A-Z]{2,6}[A-Z0-9]*\d[A-Z0-9]*[A-Z]$/`（形如 `ART14000G`）
  - 真课号优先取"标准格式"的那个；否则回退到"非内部 ID"的候选值

### T4 数字与日期要宽松解析

- 学分/绩点：从文本里抽数字，不要假设是纯数字（`"3.0 学分"` 也要认）。
- GPA：他们用了 `/(?:^|[^0-9])([0-4](?:\.\d{1,3})?)(?:$|[^0-9])/` 抽（限定 0~4 区间），  
  另有 `/(?:GPA|平均学分绩点|平均绩点|总平均绩点|学分绩点)\s*[:：]?\s*([0-4](?:\.\d{1,3})?)/i`  
  等几条专门正则 —— **说明"从一大段文本里找 GPA"是个高频需求**，值得单独做成一个函数 + 单测。
- 星期：同时认数字和 `周一/星期一/周日/周天`。
- 节次：他们用 `/^(?:\d{2}){2,8}$/` 认 `0102` 这种编码 → `1-2`。

### T5 失败**不许**破坏已有数据

这是产品口径，不是技术细节，**必须落实**：

- 刷新失败 → **保留上一次成功的成绩**，只提示失败原因（THEIA 原文：*"成绩详情域是单独刷新项，刷新失败不会抹掉已有成绩"*）
- 没有可计算的成绩 → **给空状态，不硬算、不伪造**（*"如果没有可计算 GPA 的成绩，页面会直接给空状态，不硬算"*；趋势图也&#x662F;*"不伪造点位"*）
- **学校记录优先于本地计算**，两个数字**分开说明、不混成一个**（*"学校记录优先，只有没有学校 GPA 时才显示本地计算值"*）

> 这三条正好对应 `../AGENTS.md` 第 6 条（已验证/未验证分开）和第 7 条（文案必须与实现一致）。  
> 我们要连**界面文案**一起定：宁可显示"这次没认出成绩，点这里看原因"，也不要显示一个编出来的数。

### T6 把上面的东西**规则包化**（这才叫 P4）

到这一步，把 T2/T3/T4 里的所有"知识"从代码里抽出来，写成 JSON：

```
p4-parser/rules/<schoolId>.json
{
  "schemaVersion": 1,
  "schoolId": "buct",
  "version": "1.0.0",
  "scopes": {
    "grades": { "aliases": { "courseCode": ["kch","courseCode","课程代码","kch_id"], ... } },
    "exams":  { "aliases": { "examTime": ["kssj","考试时间"], ... } }
  },
  "menuHints": ["jwglxt","cjcx","kbcx","kwgl"],
  "payloadArrayPriority": ["kblist","items","rows","data", ...]
}
```

规则包**走已有的签名下发通道**（`catalog/index.json` 的 `adapters` 字段 + Ed25519 验签 + 每天一次限频 +  
`validateRulePack()` 白名单校验，都已实现，见 [`../docs/adapters.md`](../docs/adapters.md)）。  
**新增一所学校 = 加一份 JSON + 签一次名，不重新发版** —— 这就是 P4 的交付价值。

### T7 脱敏诊断（出问题时能查，但不泄露隐私）

THEIA 的诊断函数注释明确：**不记录课程名、地点、教师、cookie、完整响应**，  
只输出 `recordCount` / `fieldNames` / `presence`。

👉 我们照做：解析失败时给用户一段可复制的诊断，内容是  
**"认出了几个字段名、几行、哪一步失败"**，**不含任何课程名/姓名/学号**。  
（`../AGENTS.md` 第 3 条：真实姓名只允许出现在版权水印里。）

---

## 四、建议的数据结构（先定字段，再写代码）

```ts
// 成绩
interface GradeRecord {
  courseCode: string; courseName: string; credits?: number;
  score?: string; point?: number;          // point = 绩点
  nature?: string; category?: string;       // 课程性质 / 课程类别
  teacher?: string; assessment?: string;    // 教师 / 考核方式
  status?: string; remark?: string;
  termId?: string;                          // 学年+学期归一化后的 id
}
// 考试
interface ExamRecord {
  courseCode: string; courseName: string;
  examType?: string; examTime?: string; startAt?: number;
  location?: string; campus?: string; seat?: string; mode?: string;
  remark?: string; termId?: string;
}
```

**参考规模**（THEIA 在北化的实测条数，用来判断你的解析器漏没漏）：  
成绩 40 条、考试 20 条、课表 62 条、已选课程 38 条、成绩明细 141 条。  
⚠️ 这是他们的数据，**不是我们的验收标准**；我们要用**自己的脱敏样本**定基线。

---

## 五、验收清单（自测完再交，对齐 `README.md` 第五节）

- [ ] **断网可用**：解析全程在本机，**一次网络请求都不发**（用打桩 fetch 计数证明，像 `tests/weather.test.ts` 那样）
- [ ] **换列序也认得出**：把样本表格的列**前后颠倒**，仍能正确解析（证明你用的是别名表不是列序号）
- [ ] **改版演练**：把样本页故意改坏三处——① 改掉表头文字 ② 把表格换成 JSON 响应 ③ 删掉一列——  
  看它是**降级**（少认几个字段但给出原因）还是**崩**。**崩了就是不合格**
- [ ] **JSON/HTML 双通道都有覆盖**：两个通道各至少一个样本
- [ ] **失败不抹数据**：模拟解析失败，确认上次成功的成绩还在
- [ ] **空状态不伪造**：无成绩时界面是空状态，不是一个 `0` 或编造的 GPA
- [ ] **不泄露**：诊断文本里搜不到任何课程名/姓名/学号（写个断言扫一遍）
- [ ] **体积与耗时**：规则包多大、解析一份样本多少毫秒，写进 `report.md`
- [ ] **真实姓名不入库**：样本一律用"智小汇 / 2025040999 / 教师A~S"
- [ ] `report.md` 里**逐条写明"已验证 / 未验证"**

---

## 六、红线（违反即返工，摘自 `README.md` 与 `../AGENTS.md`）

1. **解析必须在本机**。要把页面内容发到任何服务器/第三方模型前，**必须先问产品负责人**。
2. **不引入联网推理服务**。云函数调大模型属于 P5，不算 P4。
3. **真实姓名不入库**。参考文件 `../../个人课表查询.html` 含真实姓名，**禁止复制进 `p4-parser/`**。
4. **主工程不许直接改**。`src/`、`android/`、`cloudflare/` 都不能动；  
   本目录的东西**不许直接 `import` 到 `src/`**，整合由产品负责人做。  
   需要主工程配合的事写进 [`NOTES.md`](NOTES.md)。
5. **不代持凭据**。不许读 Cookie 值、不许替用户发请求、不许代填教务表单（`../AGENTS.md` 第 2 条）。  
   ⚠️ 特别提醒：THEIA 的做法是"认证后把教务会话 Cookie 交给原生 HTTP 去拉数据"——  
   **那条路我们不能走**。我们只能在用户已经打开的页面里**读 HTML/JSON**。

---

## 七、交付物（放 `p4-parser/`）

```
p4-parser/
├── TASK-成绩与考试一键识别.md   ← 本文件
├── NOTES.md                      ← 你的进展 / 方案 / 坑（给整合的人看）
├── rules/buct.json               ← 规则包（含字段别名表）
├── fixtures/                     ← 脱敏样本（HTML 与 JSON 各至少一份）
└── report.md                     ← 评测：抽了多少样本、准确率、失败样例、耗时
```

---

## 八、明确**不要**做的事

- ❌ 不要为了"识别成绩"去动 `src/services/parser/jwglxtExam.ts`（那是主工程，整合由产品负责人做）。
- ❌ 不要照抄 THEIA 的**学业进度表固定列索引**（`cells[3]/cells[5]/cells[8]/cells[11]`）。  
  那是他们**不得已**的写法（那页没有可靠表头），**是反面教材**：能靠列名就别靠索引。
- ❌ 不要试图复刻它的 GPA 趋势图 / 选课 / 抢课 —— 那些超出了本次任务范围。

---

## 附录 A：本次读的 THEIA 源文件（想深挖按这个路径回原仓库看）

| 文件                                               | 看什么                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `core/parsers/jwglxt.mjs`                        | **主要依据**：`parseJwGrades` / `parseJwExams` / `tableRecords` / `findPayloadArray` / `isInternalCourseId` |
| `core/gpa.mjs`                                   | `computeGpa` / `computeEarnedCredits` / `isGpaEligible`                                                |
| `docs/features/grades.md`                        | 成绩页的口径与边界（学校记录优先、空状态不硬算）                                                                               |
| `docs/features/exams.md`                         | 考试页口径                                                                                                  |
| `docs/archive/review/THEIA-*-测试报告-2026-08-1*.md` | 实测条数与抓取链路                                                                                              |

**许可证**：THEIA 是 **MIT**（可以借鉴，保留版权与许可声明）。  
⚠️ 但**另一个参考项目 `znjhahaha/zhengfang-apk` 是 GPL v3，绝对不能抄代码进 Unimate**（会传染）。  
更完整的许可证对照与协议细节见 [`../docs/oss-reference.md`](../docs/oss-reference.md)。

## 附录 B：怎么读那个仓库（省时间）

不要 clone（它几百 MB），直接读原文：

```
https://raw.githubusercontent.com/bakahuiii/THEIA/main/core/parsers/jwglxt.mjs
https://raw.githubusercontent.com/bakahuiii/THEIA/main/docs/features/grades.md
```

看目录树（筛路径用）：

```
https://api.github.com/repos/bakahuiii/THEIA/git/trees/main?recursive=1
```

---

## 附录 C：从 THEIA 抄来的现成常量（直接用，不用自己试）

```js
// 成绩页/考试页/课表页的入口识别（顺着页面链接找，不猜 URL）
const MENU_HINT = /jwglxt|cjcx|kbcx|kwgl/;          // cjcx=成绩查询 kbcx=课表查询 kwgl=考务管理
const NAV_HINT  = /(?:kbcx|cjcx|kwgl|xtgl\/index)/i;
const LOGIN_PATH = /\/xtgl\/login_slogin\.html$/i;

// 表头 / 行选择器
const TH = 'thead th, tr:first-child th';
const TR = 'tbody tr, tr';

// JSON 载荷数组键（按优先级取第一个非空数组）
const PAYLOAD_ARRAY_PRIORITY = [
  'kblist','items','rows','data','result','list','aadata','records',
  'recordlist','datalist','gradelist','courselist','sjklist','jxhjkclist'
];

// 课程代码校验
const isInternalCourseId    = (s) => /^[0-9A-F]{16,}$/i.test(s);
const isStandardCourseCode  = (s) => /^[A-Z]{2,6}[A-Z0-9]*\d[A-Z0-9]*[A-Z]$/.test(s);

// 星期 / 节次
const WEEKDAY_CN = /(?:周|星期)\s*([一二三四五六日天])/u;
const SESSION_ENC = /^(?:\d{2}){2,8}$/u;             // '0102' -> 1-2 节
```
