# 解析适配器热更新（Net.md P2.5 / PRD 5.15）

一句话：**教务系统改版（换了表格 id、改了列名、改了节次写法）时，不用重发 APK** —— 下发一份
**声明式规则包**即可。

## 1. 为什么是"声明式"，不是"下发脚本"

Net.md 2.4 划的红线：*下发并执行 JS 等于把 App 交给远端控制*。
所以规则包里**只有**：选择器片段、正则、字段下标、周次分隔符、课标符号表 —— 全是字符串与数字，
没有一行可执行代码。最坏情况也只是"读得更多/更少"，不会获得任何新能力。
`rules.ts` 里用**显式白名单**逐键校验，遇到不认识的键、编译不过的正则、越界的下标一律整份拒收。

## 2. 文件与目录

| 位置 | 是什么 |
| --- | --- |
| `adapters/<adapterId>.json` | **源规则包**（只有教务改版时才新增/修改） |
| `public/adapters/<adapterId>.json` | 下发产物（随 `npm run build` 进 dist） |
| `catalog/index.json` 里的 `adapters: [...]` | 规则包清单：**与学校档案共用同一份签名**，客户端只验一次签、也只受同一套"每天一次"限频 |

规则包不发布时 `adapters/` 目录为空 —— 这是**常态**（教务没改版就不需要规则包）。

## 3. 改版时怎么做（以课表为例）

1. 照 `src/services/parser/rules.ts` 里的 `TIMETABLE_DEFAULTS` 写一份 `adapters/jwglxt-buct.json`，
   **只写要覆盖的键**（例如教务把表格 id 改了）：

```json
{
  "schemaVersion": 1,
  "adapterId": "jwglxt-buct",
  "kind": "timetable",
  "version": 2,
  "note": "2027 春季改版：表格 id 与课程块 class 都变了",
  "rules": {
    "tableMarkers": ["id=\"kbgrid_table_v2027\""],
    "blockSplitMarker": "class=\"timetable_block"
  }
}
```

2. `node --experimental-strip-types scripts/make-school-pack.mjs`（导出 + 校验 + 签名 + 自检）
3. `npm run build` → 部署 `dist`（见 `docs/deploy.md`）
4. App 里打开「导入课表 / 考试识别」面板 → 底部会显示"解析规则：内置规则 v1"和「下载规则 v2」→ 点一下即生效

版本口径与学校档案一致：**只有 `version > 内置版本` 的包会被激活**，所以下发一份与内置相同的包不会有任何副作用。

## 4. 客户端怎么把关

1. 规则包走与学校档案**同一条信任链**：签名清单 → 档案 sha256 → 结构校验（`validateRulePack`）；
2. 校验不过 → 整份拒收，继续用内置规则；
3. 面板里能看到"当前用的是内置还是规则包"，并可**一键回到内置**（走二次确认）；
4. 解析器只从规则层取选择器/正则/字段映射 —— 所以规则包改完**立刻生效**，不需要重启。

## 5. 能改哪些东西（白名单）

| 类别 | 键（课表 / 考试） |
| --- | --- |
| 页面归属 | `matchUrl`；`tableMarkers` / `htmlMarker` |
| 表格与单元格 | `tableEndTag`、`cellPattern`、`blockSplitMarker` / `rowPattern`、`cellPattern` |
| 表头 | `headerClass`、`headerLeftClass`、`headerRightClass`、`studentIdPrefix`、`studentNameSuffix` |
| 课程块 | `titlePattern`、`pendingPatterns`、`paraPattern`、`sectionPattern`、`groupSize`、`fieldMap` |
| 周次与课型 | `weekSeparators`、`weekRange`、`weekParity`、`weekSuffix`、`weekAllWord`、`lessonSymbols` |
| 考试列 | `colAttr`、`colNameSeparator`、`timePattern`、`columns.*` |

## 6. 怎么验证

```powershell
npm run test:adapters     # 51 条：规则包校验 + 生效口径 + **改版演练**（改坏样本 → 内置解析不出 → 下发规则 → 解析成功）
npm run test:parser       # 57 条 Golden Test：内置规则没被改坏
npm run test:exam         # 45 条 Golden Test：同上
```

`test:adapters` 里的"改版演练"就是 Net.md 给的验收：样本页被改了三处（表格 id、课程块 class、节次行格式），
内置解析器解析不出来，装上规则包后 25 条上课安排全部解析正确。

