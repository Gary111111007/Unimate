export interface CampusLandmark {
  key: string;
  name: string;
  shortName: string;
  x: number;
  y: number;
  kind: 'teaching' | 'dorm' | 'dining' | 'service' | 'sports';
}

/**
 * 昌平校区示意坐标。坐标根据 THEIA 的建筑标注归一化为百分比；这里不打包
 * THEIA 的地图图片，只绘制离线示意图，避免图片来源与再分发许可不明确。
 */
export const BUCT_CAMPUS_LANDMARKS: CampusLandmark[] = [
  { key: 'zz1', name: '紫竹苑 1', shortName: '紫竹1', x: 31, y: 53, kind: 'dorm' },
  { key: 'zz2', name: '紫竹苑 2', shortName: '紫竹2', x: 38, y: 53, kind: 'dorm' },
  { key: 'zz3', name: '紫竹苑 3', shortName: '紫竹3', x: 31, y: 47, kind: 'dorm' },
  { key: 'zz4', name: '紫竹苑 4', shortName: '紫竹4', x: 38, y: 44, kind: 'dorm' },
  { key: 'yh1', name: '樱花苑 1', shortName: '樱花1', x: 30, y: 70, kind: 'dorm' },
  { key: 'yh3', name: '樱花苑 3', shortName: '樱花3', x: 36, y: 64, kind: 'dorm' },
  { key: 'yh6', name: '樱花苑 6', shortName: '樱花6', x: 46, y: 64, kind: 'dorm' },
  { key: 'zhu-canteen', name: '紫竹食堂', shortName: '紫竹食堂', x: 38, y: 58, kind: 'dining' },
  { key: 'yulan', name: '玉兰餐厅', shortName: '玉兰餐厅', x: 48, y: 46, kind: 'dining' },
  { key: 'student-center', name: '大学生活动中心', shortName: '学活', x: 50, y: 52, kind: 'service' },
  { key: 'museum', name: '校史博物馆', shortName: '校史馆', x: 49, y: 57, kind: 'service' },
  { key: 'first', name: '第一教学楼', shortName: '一教', x: 57, y: 45, kind: 'teaching' },
  { key: 'second', name: '第二教学楼', shortName: '二教', x: 65, y: 49, kind: 'teaching' },
  { key: 'labA', name: '实验楼 A', shortName: '实验A', x: 72, y: 54, kind: 'teaching' },
  { key: 'labB', name: '实验楼 B', shortName: '实验B', x: 76, y: 57, kind: 'teaching' },
  { key: 'labF', name: '实验楼 F', shortName: '实验F', x: 79, y: 61, kind: 'teaching' },
  { key: 'library', name: '图书馆', shortName: '图书馆', x: 73, y: 56, kind: 'service' },
  { key: 'arts', name: '文理楼', shortName: '文理楼', x: 87, y: 60, kind: 'teaching' },
  { key: 'gym', name: '体育馆', shortName: '体育馆', x: 57, y: 91, kind: 'sports' }
];

const NO_LOCATION = /未排地点|网络课程|线上|^\s*$|^无$/u;

export function resolveCampusLandmark(room: string | null | undefined): CampusLandmark | null {
  const text = String(room || '').normalize('NFKC').replace(/\s+/gu, '');
  if (!text || NO_LOCATION.test(text)) return null;
  const rules: Array<[RegExp, string]> = [
    [/一教|第一教学楼/u, 'first'],
    [/二教|第二教学楼/u, 'second'],
    [/实验楼?\s*A/iu, 'labA'],
    [/实验楼?\s*B/iu, 'labB'],
    [/实验楼?\s*F/iu, 'labF'],
    [/图书/u, 'library'],
    [/文理/u, 'arts'],
    [/体育馆/u, 'gym'],
    [/紫竹食堂/u, 'zhu-canteen'],
    [/玉兰/u, 'yulan'],
    [/大学生活动中心|学活/u, 'student-center'],
    [/校史/u, 'museum']
  ];
  const key = rules.find(([pattern]) => pattern.test(text))?.[1];
  return key ? BUCT_CAMPUS_LANDMARKS.find((item) => item.key === key) || null : null;
}

export function searchCampusLandmarks(keyword: string): CampusLandmark[] {
  const q = keyword.trim().toLowerCase();
  if (!q) return BUCT_CAMPUS_LANDMARKS;
  const direct = resolveCampusLandmark(q);
  return BUCT_CAMPUS_LANDMARKS.filter((item) =>
    item.name.toLowerCase().includes(q) || item.shortName.toLowerCase().includes(q) || item.key === direct?.key);
}
