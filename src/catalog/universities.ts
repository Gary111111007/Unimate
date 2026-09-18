// 内置高校名单（PRD 5.9.5 / 附录 D）。除北京化工大学为 live 且置顶外，
// 其余一律 developing —— 界面必须显示"开发中"，不得写成"已支持"。
import type { SchoolProfile } from '../types.ts';
import { DEFAULT_PERIOD_TIMES } from './periods.ts';

export interface SchoolEntry { schoolId: string; name: string; shortName: string; province: string; status: 'live' | 'developing'; order: number }

const dev = (schoolId: string, name: string, shortName: string, province: string, order: number): SchoolEntry =>
  ({ schoolId, name, shortName, province, status: 'developing', order });

export const SCHOOLS: SchoolEntry[] = [
  { schoolId: 'buct', name: '北京化工大学', shortName: '北化', province: '北京', status: 'live', order: 0 },
  dev('pku', '北京大学', '北大', '北京', 1),
  dev('thu', '清华大学', '清华', '北京', 2),
  dev('ruc', '中国人民大学', '人大', '北京', 3),
  dev('bjtu', '北京交通大学', '北交大', '北京', 4),
  dev('bjut', '北京工业大学', '北工大', '北京', 5),
  dev('buaa', '北京航空航天大学', '北航', '北京', 6),
  dev('bit', '北京理工大学', '北理工', '北京', 7),
  dev('ustb', '北京科技大学', '北科大', '北京', 8),
  dev('bupt', '北京邮电大学', '北邮', '北京', 9),
  dev('bfu', '北京林业大学', '北林', '北京', 10),
  dev('nankai', '南开大学', '南开', '天津', 11),
  dev('tju', '天津大学', '天大', '天津', 12),
  dev('hbu', '河北大学', '河大', '河北', 13),
  dev('ysu', '燕山大学', '燕大', '河北', 14),
  dev('dlut', '大连理工大学', '大工', '辽宁', 15),
  dev('jlu', '吉林大学', '吉大', '吉林', 16),
  dev('hit', '哈尔滨工业大学', '哈工大', '黑龙江', 17),
  dev('fudan', '复旦大学', '复旦', '上海', 18),
  dev('sjtu', '上海交通大学', '上交', '上海', 19),
  dev('tongji', '同济大学', '同济', '上海', 20),
  dev('ecust', '华东理工大学', '华理', '上海', 21),
  dev('nju', '南京大学', '南大', '江苏', 22),
  dev('seu', '东南大学', '东大', '江苏', 23),
  dev('zju', '浙江大学', '浙大', '浙江', 24),
  dev('ahu', '安徽大学', '安大', '安徽', 25),
  dev('hfut', '合肥工业大学', '合工大', '安徽', 26),
  dev('xmu', '厦门大学', '厦大', '福建', 27),
  dev('ncu', '南昌大学', '南大(昌)', '江西', 28),
  dev('sdu', '山东大学', '山大', '山东', 29),
  dev('zzu', '郑州大学', '郑大', '河南', 30),
  dev('whu', '武汉大学', '武大', '湖北', 31),
  dev('hust', '华中科技大学', '华科', '湖北', 32),
  dev('hnu', '湖南大学', '湖大', '湖南', 33),
  dev('csu', '中南大学', '中南', '湖南', 34),
  dev('sysu', '中山大学', '中大', '广东', 35),
  dev('scut', '华南理工大学', '华工', '广东', 36),
  dev('gxu', '广西大学', '西大', '广西', 37),
  dev('hainu', '海南大学', '海大', '海南', 38),
  dev('cqu', '重庆大学', '重大', '重庆', 39),
  dev('scu', '四川大学', '川大', '四川', 40),
  dev('uestc', '电子科技大学', '电子科大', '四川', 41),
  dev('ynu', '云南大学', '云大', '云南', 42),
  dev('gzu', '贵州大学', '贵大', '贵州', 43),
  dev('nwpu', '西北工业大学', '西工大', '陕西', 44),
  dev('lzu', '兰州大学', '兰大', '甘肃', 45),
  dev('qhu', '青海大学', '青大', '青海', 46),
  dev('nxu', '宁夏大学', '宁大', '宁夏', 47),
  dev('xju', '新疆大学', '新大', '新疆', 48),
  dev('shzu', '石河子大学', '石大', '新疆', 49),
  dev('tyut', '太原理工大学', '太原理工', '山西', 50),
  dev('imu', '内蒙古大学', '内大', '内蒙古', 51)
];

export const BUCT_PROFILE: SchoolProfile = {
  schoolId: 'buct',
  name: '北京化工大学',
  shortName: '北化',
  status: 'live',
  order: 0,
  province: '北京',
  brand: { primaryColor: '#2E5AAC', accentColor: '#E8A33D', iconLetter: '化' },
  tabs: { online: '北化在线' },
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
  // 第一版只有北化落地；新高校 = 新增一份 profile + 一个 adapter（PRD 5.9.4）
  return schoolId === 'buct' ? JSON.parse(JSON.stringify(BUCT_PROFILE)) : null;
}
