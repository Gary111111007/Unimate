// 第二课堂五板块与分值上限（PRD 5.6.1 / 附录 B，来源：学生手册·学生事务管理制度）
import type { BlockKey, SecondClassBlockDef } from '../types.ts';

export const SECOND_CLASS_BLOCKS: SecondClassBlockDef[] = [
  { key: 'de', name: '德', fullName: '道德与思想素质', fullScore: 180, basicCap: 144, extendedCap: 36 },
  { key: 'zhi', name: '智', fullName: '学术与科技创新', fullScore: 120, basicCap: 96, extendedCap: 24 },
  { key: 'ti', name: '体', fullName: '体育与身心健康', fullScore: 100, basicCap: 80, extendedCap: 20 },
  { key: 'mei', name: '美', fullName: '美学与人文素养', fullScore: 100, basicCap: 80, extendedCap: 20 },
  { key: 'lao', name: '劳', fullName: '劳动与社会实践', fullScore: 100, basicCap: 80, extendedCap: 20 }
];

export const TOTAL_FULL_SCORE = SECOND_CLASS_BLOCKS.reduce((a, b) => a + b.fullScore, 0); // 600

export function blockDef(key: BlockKey): SecondClassBlockDef {
  return SECOND_CLASS_BLOCKS.find((b) => b.key === key) || SECOND_CLASS_BLOCKS[0];
}

// 手册常见条款 -> 分数选择器的快捷档（第一版不做自动算分，见 PRD O6）
export const SCORE_PRESETS: { score: number; label: string }[] = [
  { score: 2, label: '观众参与一次' },
  { score: 4, label: '参观美育展馆实践一次' },
  { score: 5, label: '美育观众/讲座一次(部分)' },
  { score: 6, label: '学术专题讲座一次' },
  { score: 10, label: '参加活动一次（德智体美通用）' },
  { score: 15, label: '学术科技类活动一次 / 社会实践' },
  { score: 20, label: '劳动或志愿满10学时(小时) / 体测合格' },
  { score: 25, label: '参与竞赛或大创项目并提交作品' },
  { score: 30, label: '奔跑在北化打卡完成 / 德育荣誉国家级' }
];

export const QUICK_SCORES = [2, 4, 5, 6, 10, 15, 20, 25, 30];

export const BLOCK_HINTS: Record<BlockKey, string[]> = {
  de: ['校/院/班级德育活动 一次10分（上限50）', '青年大学习 满35分（缺一次扣3）', '德育类荣誉 30/24/20/16/5', '发表德育类文章 10分'],
  zhi: ['竞赛/大创项目并提交作品 25分', '学术科技类活动 一次15分（上限30）', '专题讲座 一次6分（上限24）', '竞赛获奖见学科竞赛分值表'],
  ti: ['体育竞赛参与者 一次10分（上限20）', '"奔跑在北化"打卡完成 30分', '体测合格或免测 20分，不合格 0分', '竞赛获奖见体育类竞赛分值表'],
  mei: ['美育活动 演员/参赛者10分、观众5分（上限30）', '美育讲座 一次10分（上限30）', '慕课艺术类 每学时5分（上限30）', '个人展览/公演 20分'],
  lao: ['劳动实践 每学期满10学时 20分', '志愿服务 每学期满10小时 20分', '寒暑假社会实践 15分', '宿舍卫生 优20/良16/中12/合格10']
};
