// 演示模式数据（PRD 5.8 / AC-28）。示例学生统一为"智小汇"，教师为代号，不含真实姓名。
import type { NoteItem, SecondClassRecord, Timetable } from '../types.ts';
import { uuid, nowStamp, dateStamp } from './id.ts';
import { writeBinaryBase64, writeJson } from './io.ts';

export function buildDemoTimetable(semesterLabel: string, startMonday: string, totalWeeks: number): Timetable {
  return {
    id: uuid(), name: '北京化工大学 2026-2027-1', semesterLabel,
    semesterStartMonday: startMonday, totalWeeks, periodCount: 12,
    isActive: true, source: 'jwglxt', createdAt: nowStamp(), updatedAt: nowStamp()
  };
}

export function buildDemoNotes(): NoteItem[] {
  const mk = (title: string, content: string, minutesFromNow: number | null, alarms: number[], done = false): NoteItem => {
    const at = minutesFromNow === null ? '' : nowStamp(new Date(Date.now() + minutesFromNow * 60000));
    return { id: uuid(), sheet: 'sheet2', title, content, remindAt: at, alarms, repeat: 'none', done, doneAt: done ? nowStamp() : null, colorIndex: 3, linkedCourseId: null, createdAt: nowStamp(), updatedAt: nowStamp(), deletedAt: null };
  };
  return [
    mk('现场演示通知', '2 分钟后 Uni 会弹一条本地通知，点击可直达这条记录', 2, [0]),
    mk('高数作业：第 3 章 1-10 题', '学习委员周四晚课前收', 60 * 20, [0, 15, 60]),
    mk('第二课堂材料补交', '把上周志愿服务的照片重新填报（板块：劳）', 60 * 50, [0, 60]),
    mk('电路原理实验预习报告', '实验楼A-203，提前 10 分钟到', 60 * 26, [15]),
    mk('已办：注册本学期选课', '教务系统已完成，无欠费', null, [], true)
  ];
}

// 五板块各 1 条，照片用 Canvas 现场生成并烧录水印（离线可演示，无真实人脸信息）
export async function buildDemoRecords(baseDir: string): Promise<SecondClassRecord[]> {
  const plan: { block: any; name: string; desc: string; score: number; daysAgo: number; color: string; hours: number }[] = [
    { block: 'de', name: '学院主题团日', desc: '参与"开学第一课"主题团日，负责拍照与记录', score: 10, daysAgo: 12, color: '#2E5AAC', hours: 2 },
    { block: 'zhi', name: '学科竞赛校内选拔', desc: '全国大学生电子设计竞赛校内选拔，提交作品一份', score: 25, daysAgo: 9, color: '#8E6BC9', hours: 6 },
    { block: 'ti', name: '"奔跑在北化"打卡', desc: '本周完成 5 次打卡，累计 15 公里', score: 30, daysAgo: 5, color: '#3FA97B', hours: 5 },
    { block: 'mei', name: '美育讲座：交响乐赏析', desc: '音乐厅观看院线美育讲座，提交听后感', score: 10, daysAgo: 3, color: '#C9547E', hours: 2 },
    { block: 'lao', name: '社区志愿服务', desc: '清理楼道小广告 + 垃圾分类引导，累计 6 小时', score: 20, daysAgo: 1, color: '#E8A33D', hours: 6 }
  ];
  const out: SecondClassRecord[] = [];
  for (const item of plan) {
    const when = new Date(Date.now() - item.daysAgo * 86400000);
    const photoId = uuid();
    const rel = baseDir + '/photos/' + when.getFullYear() + '/' + photoId + '.jpg';
    const b64 = await renderDemoPhoto(item.name, nowStamp(when), item.color);
    await writeBinaryBase64(rel, b64);
    out.push({
      id: uuid(), block: item.block, stage: 'basic', activityName: item.name, description: item.desc,
      activityDate: dateStamp(when),
      photos: [{
        id: photoId, originalPath: rel, watermarkPath: rel, capturedAt: nowStamp(when),
        latitude: 40.156, longitude: 116.312, accuracyMeters: 12,
        address: '北京市朝阳区', addressSource: 'manual', source: 'camera', watermarked: true,
        originalSha256: 'demo-' + photoId.slice(0, 8), watermarkSha256: 'demo-' + photoId.slice(0, 8),
        deviceLabel: 'Unimate 演示数据', appVersion: '1.0.0'
      }],
      score: item.score, scorePreset: '手册常见档', createdAt: nowStamp(when), updatedAt: nowStamp(when), deletedAt: null
    });
  }
  return out;
}

async function renderDemoPhoto(title: string, time: string, color: string): Promise<string> {
  const c = document.createElement('canvas');
  c.width = 960; c.height = 640;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 960, 640);
  grad.addColorStop(0, color); grad.addColorStop(1, '#101826');
  g.fillStyle = grad; g.fillRect(0, 0, 960, 640);
  g.fillStyle = 'rgba(255,255,255,.10)';
  for (let i = 0; i < 26; i++) { g.beginPath(); g.arc(60 + i * 36, 120 + (i % 5) * 90, 16 + (i % 7) * 5, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 470, 960, 170);
  g.fillStyle = '#fff'; g.textBaseline = 'top';
  g.font = 'bold 40px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
  g.fillText(title, 32, 492);
  g.font = '30px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
  g.fillText(time, 32, 548);
  g.fillText('39.9586N, 116.1320E · 北京市朝阳区', 32, 588);
  g.textAlign = 'right'; g.font = 'bold 26px system-ui, sans-serif';
  g.fillText('Unimate · 北京化工大学', 928, 552);
  return c.toDataURL('image/jpeg', 0.85).split(',')[1];
}
