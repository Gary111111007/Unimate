/**
 * 「考试信息查询」演示样本生成器（离线可用）。
 *
 * 为什么要动态生成而不是放一个固定 HTML：
 *  1) 真实考试页需要校园网，评审/演示时打不开 —— 样本让"识别考试 → 写进记事本 → 提前一天/半小时提醒"
 *     这条链路在任何网络环境下都能完整跑一遍；
 *  2) 考试时间必须**在未来**，否则提醒排不进去（真机反馈过："日期已过 → 不会提醒"）。
 *     所以日期按"今天 +2 / +9 / +16 / +23 天"生成，样本永远有效、提醒永远能真的触发；
 *  3) 结构与真实 jqGrid 表格一致（表头 th id="tabGrid_<列>"、单元格 aria-describedby="tabGrid_<列>"），
 *     因此走的是**同一个解析器**，不是另写一条"演示专用"捷径。
 *
 * 数据是虚构的（课程名取样本里已有的课程，学号用脱敏值 2025040999），不含任何个人信息。
 */

function pad2(n: number): string { return String(n).padStart(2, '0'); }

function dayAfter(now: Date, days: number): string {
  const d = new Date(now.getTime() + days * 86400000);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

interface DemoExam {
  days: number; start: string; end: string; course: string; room: string; campus: string;
  seat: string; name: string; mode: string; klass: string; college: string;
}

/** 4 场：最近一场在 2 天后（"提前 1 天"的提醒会在明天就响，便于演示） */
const DEMO_EXAMS: DemoExam[] = [
  { days: 2, start: '09:00', end: '11:00', course: '高等数学A（II）', room: '一教A-205', campus: '北区', seat: '18', name: '期末考试', mode: '笔试', klass: '高等数学A（II）-0007', college: '数理学院' },
  { days: 9, start: '14:00', end: '16:00', course: '大学英语3', room: '一教B阶-202', campus: '北区', seat: '41', name: '期末考试', mode: '笔试', klass: '大学英语3-0021', college: '文法学院' },
  { days: 16, start: '08:00', end: '10:00', course: '普通物理(Ⅰ)', room: '二教D-106', campus: '北区', seat: '52', name: '期中考试', mode: '笔试', klass: '普通物理(Ⅰ)-0014', college: '数理学院' },
  { days: 23, start: '18:00', end: '20:00', course: '工程制图', room: '一教A-201', campus: '北区', seat: '22', name: '期末考试', mode: '笔试', klass: '工程制图-0003', college: '机电工程学院' }
];

/** 列顺序与真实页面一致（解析器只依赖 aria-describedby，这里保持一致是为了"样本=真页面"） */
const COLS: [string, string][] = [
  ['cb', ''], ['xnmc', '学年'], ['xqmmc', '学期'], ['kcmc', '课程名称'], ['kssj', '考试时间'],
  ['cdmc', '场地名称'], ['cdxqmc', '场地校区'], ['zwh', '座位号'], ['kch', '课程号'],
  ['cxbj', '重修标记'], ['ksmc', '考试名称'], ['ksbz', '考试备注'], ['khfs', '考核方式'],
  ['jxbmc', '教学班名称'], ['kkxy', '开课学院'], ['jxbzc', '教学班组成'], ['xqmc', '校区名称'],
  ['ksfs', '考试方式'], ['xnm', ''], ['xqm', ''], ['xh_id', ''], ['cdjc', '场地简称']
];

function cell(col: string, text: string): string {
  return '<td role="gridcell" aria-describedby="tabGrid_' + col + '" title="' + text + '">' + (text || '&nbsp;') + '</td>';
}

/** 生成一份"考试信息查询"演示页面（结构与真实 jqGrid 表格一致） */
export function buildExamSampleHtml(now: Date = new Date()): string {
  const semester = (() => {
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    return m >= 8 ? { xn: y + '-' + (y + 1), xq: '1' } : { xn: (y - 1) + '-' + y, xq: '2' };
  })();

  const rows = DEMO_EXAMS.map((e, i) => {
    const date = dayAfter(now, e.days);
    const vals: Record<string, string> = {
      cb: '', xnmc: semester.xn, xqmmc: semester.xq, kcmc: e.course,
      kssj: date + '(' + e.start + '-' + e.end + ')', cdmc: e.room, cdxqmc: e.campus,
      zwh: e.seat, kch: 'DEMO' + (100 + i), cxbj: '否', ksmc: e.name, ksbz: '',
      khfs: '考试', jxbmc: e.klass, kkxy: e.college, jxbzc: '演示样本', xqmc: e.campus,
      ksfs: e.mode, xnm: semester.xn.slice(0, 4), xqm: semester.xq, xh_id: '2025040999',
      cdjc: e.room.replace(/^[^A-Z]+/, '')
    };
    return '      <tr class="jqgrow" id="' + (i + 1) + '">' + COLS.map(([c]) => cell(c, vals[c] || '')).join('') + '</tr>';
  }).join('\n');

  return [
    '<!-- 演示样本（由 buildExamSampleHtml 生成，非真实数据；考试日期 = 今天 +2/+9/+16/+23 天）-->',
    '<div class="ui-jqgrid ui-widget ui-widget-content ui-corner-all" id="gbox_tabGrid">',
    '  <table class="ui-jqgrid-htable" role="grid"><thead><tr class="ui-jqgrid-labels">'
      + COLS.map(([c, label]) => '<th id="tabGrid_' + c + '" role="columnheader">' + (label || c) + '</th>').join('')
      + '</tr></thead></table>',
    '  <table class="ui-jqgrid-btable" role="grid"><tbody>',
    rows,
    '  </tbody></table>',
    '</div>'
  ].join('\n');
}
