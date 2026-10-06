/**
 * 成绩识别面板的内置演示样本（虚构数据，离线可用）。
 * 只需要表格结构；解析、本机持久化和展示走真实同一条链路。
 */
export function buildGradeSampleHtml(): string {
  return '<!doctype html>\n' +
    '<html lang="zh-CN"><head><meta charset="utf-8"><title>成绩查询（演示样本）</title></head>\n' +
    '<body><table id="gradeTable"><thead><tr>' +
    '<th>课程代码</th><th>课程名称</th><th>学分</th><th>成绩</th><th>绩点</th>' +
    '<th>教师</th><th>考核方式</th><th>成绩状态</th><th>学年</th><th>学期</th><th>备注</th>' +
    '</tr></thead><tbody>' +
    '<tr><td>ART14000G</td><td>艺术导论</td><td>3.5 学分</td><td>优秀</td><td>绩点 3.8</td><td>教师A</td><td>考查</td><td>已通过</td><td>2025-2026</td><td>第一学期</td><td></td></tr>' +
    '<tr><td>MATH1001A</td><td>高等数学</td><td>5</td><td>92</td><td>3.92</td><td>教师B</td><td>考试</td><td>已通过</td><td>2025-2026</td><td>1</td><td></td></tr>' +
    '<tr><td>CS10100B</td><td>程序设计</td><td>2</td><td>85</td><td>3.2</td><td>教师C</td><td>考试</td><td>已通过</td><td>2025-2026</td><td>1</td><td></td></tr>' +
    '<tr><td>PHY11600T</td><td>普通物理</td><td>4</td><td>88</td><td>3.5</td><td>教师D</td><td>考试</td><td>已通过</td><td>2025-2026</td><td>1</td><td></td></tr>' +
    '</tbody></table></body></html>';
}
