import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { actionTimeToNoteStamp, askUniLocal, buildUniScheduleFixture, buildUniTodos } from '../src/services/uniAssistant.ts';
import type { Course, NoteItem, Timetable } from '../src/types.ts';

let pass = 0; let fail = 0;
function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); }
}

const tt: Timetable = {
  id: 'tt-1', name: '测试课表', semesterLabel: '测试学期', semesterStartMonday: '2026-09-21',
  totalWeeks: 18, periodCount: 12, isActive: true, source: 'manual', createdAt: '', updatedAt: ''
};
const course = (part: Partial<Course>): Course => ({
  id: 'c-1', timetableId: 'tt-1', name: '高等数学', lessonType: 'lecture', teacher: '教师A',
  campus: '东校区', room: '教学楼A101', day: 1, startPeriod: 3, endPeriod: 4,
  weeksRaw: '1-16', weeks: [1, 2], credit: null, weeklyHours: null, totalHours: null,
  examMode: '', courseCode: '', classNames: '', hoursDetail: '', colorIndex: 0,
  source: 'manual', pendingFilter: false, editedFields: [], remark: '', ...part
});
const note = (part: Partial<NoteItem>): NoteItem => ({
  id: 'n-1', sheet: 'sheet2', title: '实验报告', content: '', remindAt: '2026-09-21 22:00:00',
  alarms: [15], repeat: 'none', done: false, doneAt: null, colorIndex: 2, linkedCourseId: null,
  createdAt: '', updatedAt: '', deletedAt: null, ...part
});
const snapshot = {
  activeTimetable: tt,
  courses: [course({}), course({ id: 'foreign', timetableId: 'tt-2', name: '不应读取' })],
  notes: [note({}), note({ id: 'deleted', title: '已删除', deletedAt: '2026-09-20 10:00:00' })],
  periodTimes: [
    { period: 3, start: '10:00', end: '10:45' },
    { period: 4, start: '10:55', end: '11:40' }
  ],
  scheduleTimezone: 'Asia/Shanghai'
};

console.log('── Uni Android 接线测试 ─────────────────────────────');
const fixture = buildUniScheduleFixture(snapshot);
ok('只投影活动课表课程', fixture.rows.length === 1, String(fixture.rows.length));
ok('节次范围完整映射', fixture.rows[0]?.periods.join(',') === '3,4', fixture.rows[0]?.periods.join(','));
ok('周次数组映射为表达式', fixture.rows[0]?.weeks === '1,2', fixture.rows[0]?.weeks);
ok('教师与教室只进入本机 fixture', fixture.rows[0]?.teacherName === '教师A' && fixture.rows[0]?.room === '教学楼A101');

const todos = buildUniTodos(snapshot.notes);
ok('软删除记事不进入 Uni', todos.length === 1, String(todos.length));
ok('待办标题与完成态正确', todos[0]?.title === '实验报告' && todos[0]?.done === false);

const fixed = new Date('2026-09-21T00:00:00.000Z'); // Asia/Shanghai 08:00
const next = askUniLocal(snapshot, '下一节什么课', fixed, 'Asia/Shanghai').response;
ok('下一节课由本机规则回答', next.source === 'local_rule' && next.answer.includes('高等数学'), next.answer);
ok('回答明确离线可用', next.offlineCapable === true);
ok('课表行动卡只负责打开课表', next.cards.some((c) => c.operation === 'open.schedule'));

const week = askUniLocal(snapshot, '这周有几节课', fixed, 'Asia/Shanghai').response;
ok('本周统计可回答', week.answer.includes('1'), week.answer);

const draftAnswer = askUniLocal(snapshot, '今晚 8 点交高数作业', fixed, 'Asia/Shanghai');
const draft = draftAnswer.response.cards.find((c) => c.operation === 'note.create');
ok('记事只产草稿不直接写入', !!draft && draft.requiresConfirmation === true);
ok('记事标题已剥离时间表达', draft?.noteDraft?.title === '交高数作业', draft?.noteDraft?.title);
ok('提醒时刻转换成本地墙钟时间', !!draft && actionTimeToNoteStamp(draft, draftAnswer.timezone) === '2026-09-21 20:00:00', draft ? actionTimeToNoteStamp(draft, draftAnswer.timezone) : '');

const service = readFileSync(join(process.cwd(), 'src/services/uniAssistant.ts'), 'utf8');
const view = readFileSync(join(process.cwd(), 'src/views/UniView.vue'), 'utf8');
const main = readFileSync(join(process.cwd(), 'src/screens/Main.vue'), 'utf8');
ok('本机桥接没有网络调用', !/\bfetch\s*\(|XMLHttpRequest|axios\b/.test(service));
ok('界面不再显示 Online 与 Offline 状态说明', !view.includes('Online Mode') && !view.includes('Offline Mode'));
ok('界面不再显示模型数据边界说明卡', !view.includes('课表、记事和天气数据由手机本机 Tool') && !view.includes('不会自动发给模型'));
ok('界面包含消息列表、加载和错误状态', view.includes('uni-chat-list') && view.includes('uni-chat-dots') && view.includes('role="alert"'));
ok('界面显示并持久化本机历史记录', view.includes('历史记录') && view.includes('persistHistory') && view.includes('loadHistory'));
ok('历史记录具有可点击入口与独立查看面板', view.includes('aria-haspopup="dialog"') && view.includes('aria-label="Uni 历史记录"') && view.includes('showHistory'));
// v2.67：语音输入已整条下线，Uni 只做文字对话。
ok('界面不再提供语音输入按钮', !view.includes('aria-label="语音输入"') && !view.includes('listenVoice') && !view.includes('name="microphone"'));
ok('界面不再保留系统键盘语音兜底', !view.includes('JwWebView.showKeyboard()') && !view.includes('请点击键盘上的麦克风'));
ok('仍保留纯文字输入框与发送按钮', view.includes('ref="composerInput"') && view.includes('enterkeyhint="send"') && view.includes('和 Uni 说点什么'));
ok('Uni 已成为独立底部页签并使用单星图标', main.includes("{ label: 'Uni', icon: 'star' }") && main.includes('<UniView v-else-if="db.activeTab === 2"'));
ok('高风险操作使用统一确认框', view.includes('await db.confirm({') && view.includes('confirmation.confirmText'));

console.log(`\nUni Assistant Test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
