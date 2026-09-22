// 内置高校名单（PRD 5.9.5 / 附录 D）。除北京化工大学为 live 且置顶外，
// 其余一律 developing —— 界面必须显示"开发中"，不得写成"已支持"。
// 排序口径：按校名**拼音**升序（order 即拼音名次）。拼音名次在构建期用 Node 的
// zh-u-co-pinyin collation 预算并硬编码进本文件，运行时不再依赖设备 ICU，
// 避免部分国产 ROM 的 WebView 缺少完整 ICU 导致排序退化。letter 用于右侧索引分组。
import type { SchoolProfile } from '../types.ts';
import { DEFAULT_PERIOD_TIMES } from './periods.ts';

export interface SchoolEntry { schoolId: string; name: string; shortName: string; province: string; status: 'live' | 'developing'; letter: string; order: number }

const dev = (schoolId: string, name: string, shortName: string, province: string, letter: string, order: number): SchoolEntry =>
  ({ schoolId, name, shortName, province, status: 'developing', letter, order });

export const SCHOOLS: SchoolEntry[] = [
  { schoolId: 'buct', name: '北京化工大学', shortName: '北化', province: '北京', status: 'live', letter: 'B', order: 0 },
  dev('ahu', '安徽大学', '安大', '安徽', 'A', 1),
  dev('pku', '北京大学', '北大', '北京', 'B', 2),
  // 北二外档案只从签名云端包下载；APK 内只留名单占位。
  dev('bisu', '北京第二外国语学院', '北二外', '北京', 'B', 3),
  dev('bjut', '北京工业大学', '北工大', '北京', 'B', 4),
  dev('buaa', '北京航空航天大学', '北航', '北京', 'B', 5),
  dev('bjtu', '北京交通大学', '北交大', '北京', 'B', 6),
  dev('ustb', '北京科技大学', '北科大', '北京', 'B', 7),
  dev('bit', '北京理工大学', '北理工', '北京', 'B', 8),
  dev('bfu', '北京林业大学', '北林', '北京', 'B', 9),
  dev('bupt', '北京邮电大学', '北邮', '北京', 'B', 10),
  dev('cqu', '重庆大学', '重大', '重庆', 'C', 11),
  dev('dlut', '大连理工大学', '大工', '辽宁', 'D', 12),
  dev('uestc', '电子科技大学', '电子科大', '四川', 'D', 13),
  dev('seu', '东南大学', '东大', '江苏', 'D', 14),
  dev('fudan', '复旦大学', '复旦', '上海', 'F', 15),
  dev('gxu', '广西大学', '西大', '广西', 'G', 16),
  dev('gzu', '贵州大学', '贵大', '贵州', 'G', 17),
  dev('hit', '哈尔滨工业大学', '哈工大', '黑龙江', 'H', 18),
  dev('hainu', '海南大学', '海大', '海南', 'H', 19),
  dev('hfut', '合肥工业大学', '合工大', '安徽', 'H', 20),
  dev('hbu', '河北大学', '河大', '河北', 'H', 21),
  dev('hnu', '湖南大学', '湖大', '湖南', 'H', 22),
  dev('ecust', '华东理工大学', '华理', '上海', 'H', 23),
  dev('scut', '华南理工大学', '华工', '广东', 'H', 24),
  dev('hust', '华中科技大学', '华科', '湖北', 'H', 25),
  dev('jlu', '吉林大学', '吉大', '吉林', 'J', 26),
  dev('lzu', '兰州大学', '兰大', '甘肃', 'L', 27),
  dev('ncu', '南昌大学', '南大(昌)', '江西', 'N', 28),
  dev('nju', '南京大学', '南大', '江苏', 'N', 29),
  dev('nankai', '南开大学', '南开', '天津', 'N', 30),
  dev('imu', '内蒙古大学', '内大', '内蒙古', 'N', 31),
  dev('nxu', '宁夏大学', '宁大', '宁夏', 'N', 32),
  dev('qhu', '青海大学', '青大', '青海', 'Q', 33),
  dev('thu', '清华大学', '清华', '北京', 'Q', 34),
  dev('xmu', '厦门大学', '厦大', '福建', 'S', 35),
  dev('sdu', '山东大学', '山大', '山东', 'S', 36),
  dev('sjtu', '上海交通大学', '上交', '上海', 'S', 37),
  dev('shzu', '石河子大学', '石大', '新疆', 'S', 38),
  dev('scu', '四川大学', '川大', '四川', 'S', 39),
  dev('tyut', '太原理工大学', '太原理工', '山西', 'T', 40),
  dev('tju', '天津大学', '天大', '天津', 'T', 41),
  dev('tongji', '同济大学', '同济', '上海', 'T', 42),
  dev('whu', '武汉大学', '武大', '湖北', 'W', 43),
  dev('nwpu', '西北工业大学', '西工大', '陕西', 'W', 44),
  dev('xju', '新疆大学', '新大', '新疆', 'X', 45),
  dev('ysu', '燕山大学', '燕大', '河北', 'Y', 46),
  dev('ynu', '云南大学', '云大', '云南', 'Y', 47),
  dev('zju', '浙江大学', '浙大', '浙江', 'Z', 48),
  dev('zzu', '郑州大学', '郑大', '河南', 'Z', 49),
  dev('ruc', '中国人民大学', '人大', '北京', 'Z', 50),
  dev('csu', '中南大学', '中南', '湖南', 'Z', 51),
  dev('sysu', '中山大学', '中大', '广东', 'Z', 52),
];

export const BUCT_PROFILE: SchoolProfile = {
  schoolId: 'buct',
  // 内置档案版本：远端 index.json 的 version 比它大时，选校页显示「可更新」
  profileVersion: 1,
  name: '北京化工大学',
  shortName: '北化',
  status: 'live',
  order: 0,
  province: '北京',
  letter: 'B',
  brand: { primaryColor: '#2E5AAC', accentColor: '#E8A33D', iconLetter: '化' },
  // 第三栏改名"北化通"：取"校园一卡通"式的国民认知，一眼是聚合入口而非单一平台。
  // 注意北化官网导航里自己有一个"北化在线"（继续教育平台），沿用旧名会与之撞车。
  tabs: { online: '北化通' },
  // 仅收录已核实的真实地址；企业微信不在其列（它必须走独立 App，内嵌无意义）。
  // 本校没列到的服务，用户可在页内"添加入口"自行补充，存本机。
  campusApps: [
    // 默认顺序按使用频次排：北化在线 → 教务系统 → 健康云 → 其余。用户可长按调整。
    { key: 'course', name: '北化在线', url: 'https://course.buct.edu.cn/', icon: '📚', desc: '在线课程与作业', builtin: true },
    { key: 'jwglxt', name: '教务系统', url: 'https://jwglxt.buct.edu.cn/', icon: '🏛', desc: '课表 · 成绩 · 选课', builtin: true },
    // 考试查询：不是普通外链 —— 点它会用"考试模式"打开教务系统的考试页，
    // 界面上常驻一个「识别考试」按钮，识别到的考试按时间写进课表 → 记事本，
    // 并自动带上「提前 1 天 + 提前 30 分钟」两个提醒（PRD 5.11）。
    { key: 'exam', name: '考试查询', url: 'https://jwglxt.buct.edu.cn/jwglxt/kwgl/kscx_cxXsksxxIndex.html?gnmkdm=N358105&layout=default', icon: '📝', desc: '识别考试 · 写进记事本提醒', builtin: true, action: 'exam' },
    { key: 'health', name: '健康云', url: 'https://tygl.buct.edu.cn/', icon: '🩺', desc: '体质测试与健康数据', builtin: true },
    { key: 'library', name: '图书馆', url: 'https://library.buct.edu.cn/', icon: '📖', desc: '馆藏检索 · 数据库导航', builtin: true },
    { key: 'zy', name: '电子资源', url: 'https://zy.buct.edu.cn/', icon: '🔑', desc: '统一身份认证 · 校外访问', builtin: true },
    { key: 'portal', name: '信息门户', url: 'https://portal.buct.edu.cn/', icon: '🧭', desc: '统一身份认证主入口', builtin: true },
    { key: 'home', name: '学校主页', url: 'https://www.buct.edu.cn/', icon: '🏫', desc: '通知公告 · 数字校园', builtin: true },
    { key: 'tree', name: '校园网平台', url: 'https://tree.buct.edu.cn/', icon: '🌳', desc: '网络认证 · 校园网服务', builtin: true }
  ],
  academic: {
    semesterLabel: '2026-2027学年第1学期',
    semesterStartMonday: '2026-08-31',
    totalWeeks: 18,
    periodCount: 12,
    periodTimes: DEFAULT_PERIOD_TIMES
  },
  systems: {
    jwglxtUrl: 'https://jwglxt.buct.edu.cn/',
    timetableUrl: 'https://jwglxt.buct.edu.cn/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default',
    onlinePlatformUrl: 'https://course.buct.edu.cn/',
    timetableAdapter: 'jwglxt-buct'
  },
  campuses: ['北区', '东区', '西校区'],
  secondClass: { enabled: true, label: '第二课堂', blocks: [], rulePack: 'buct-student-handbook-2025' },
  watermark: { schoolBadgeText: '北京化工大学' },
  dataDir: 'schools/buct'
};

export function findSchool(schoolId: string): SchoolEntry | undefined {
  return SCHOOLS.find((s) => s.schoolId === schoolId);
}

export function profileFor(schoolId: string): SchoolProfile | null {
  // 新高校 = 新增一份 profile + 一个 adapter（PRD 5.9.4）。
  // APK 只内置北化；其它高校即使已有适配，也必须先下载签名云端档案。
  if (schoolId === 'buct') return JSON.parse(JSON.stringify(BUCT_PROFILE));
  return null;
}

/**
 * APK 里内置档案的版本号（Net.md P2 学校档案热更新）。
 * 远端 `catalog/index.json` 里同一所学校的 `version` 比这里大 → 选校页显示「可更新」；
 * **改了内置档案的内容就要把 profileVersion +1**，否则老用户永远看不到「可更新」。
 */
export const BUILTIN_PROFILE_VERSIONS: Record<string, number> = {
  buct: BUCT_PROFILE.profileVersion
};
