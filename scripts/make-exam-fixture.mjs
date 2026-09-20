/**
 * 从真实保存的"考试信息查询"页面里，抽出考试表格，生成脱敏测试样本
 * fixtures/jwglxt-exam.sample.html。
 *
 * 为什么要有这个脚本：
 *  1) 真实页面（E:\Gary\...\考试信息查询.html）含**学号**等个人信息，按项目规则禁止入库；
 *  2) 样本必须可复现 —— 结构（jqGrid 的 aria-describedby 列标记）要跟真机一致，
 *     否则解析器的 Golden Test 就是对着空气写；
 *  3) 只抽表格、不整页入库，样本从 78KB 降到十几 KB，测试读取更快。
 *
 * 用法：node scripts/make-exam-fixture.mjs [真实页面路径]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] || 'E:/Gary/北京化工大学/北化app/考试信息查询.html';
const OUT = join(root, 'fixtures', 'jwglxt-exam.sample.html');

/** 真实学号 → 脱敏学号（规则：UI、示例数据、导出材料一律用脱敏名） */
const REAL_IDS = ['2025040140'];
const FAKE_ID = '2025040999';

const html = readFileSync(SRC, 'utf8');

function slice(startMarker, endMarker, from = 0) {
  const i = html.indexOf(startMarker, from);
  if (i < 0) throw new Error('找不到起始标记：' + startMarker);
  const j = html.indexOf(endMarker, i);
  if (j < 0) throw new Error('找不到结束标记：' + endMarker);
  return html.slice(i, j + endMarker.length);
}

// 表头表（jqGrid 用 th id="tabGrid_xxx" 声明列）+ 数据表（单元格带 aria-describedby="tabGrid_xxx"）
const header = slice('<table class="ui-jqgrid-htable"', '</table>');
const dataAnchor = html.indexOf('ui-jqgrid-btable');
const dataStart = html.lastIndexOf('<table', dataAnchor);
const dataEnd = html.indexOf('</table>', dataAnchor);
const data = html.slice(dataStart, dataEnd + '</table>'.length);

let out = [
  '<!--',
  '  教务系统「考试信息查询」脱敏样本（Golden Test 用）。',
  '  来源：真实页面 https://jwglxt.buct.edu.cn/jwglxt/kwgl/kscx_cxXsksxxIndex.html?gnmkdm=N358105&layout=default 的 jqGrid 表格区域。',
  '  脱敏处理：学号 ' + REAL_IDS.join('/') + ' → ' + FAKE_ID + '（真实页面不入库，见 scripts/make-exam-fixture.mjs）。',
  '  结构保持不变：表头用 th id="tabGrid_<列>" 声明，数据行每个 td 带 aria-describedby="tabGrid_<列>"。',
  '-->',
  '<div class="ui-jqgrid ui-widget ui-widget-content ui-corner-all" id="gbox_tabGrid">',
  header,
  data,
  '</div>',
  ''
].join('\n');

for (const id of REAL_IDS) out = out.split(id).join(FAKE_ID);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out, 'utf8');

const rows = (out.match(/aria-describedby="tabGrid_/g) || []).length / 22;
console.log('已生成 ' + OUT);
console.log('  大小 ' + (Buffer.byteLength(out) / 1024).toFixed(1) + ' KB，数据行 ' + Math.round(rows) + ' 行（每行 22 个单元格）');
console.log('  残留真实学号：' + REAL_IDS.filter((id) => out.includes(id)).length + '（必须为 0）');
