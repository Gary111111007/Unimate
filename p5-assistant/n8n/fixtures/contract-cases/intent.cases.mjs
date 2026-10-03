// 契约用例：intent.schema.json（主规划 附录 C.2 —— LLM 结构化解析的输出契约）
// 【比赛口径】E12 未确认前 LLM 分支关闭；这里只冻结契约，不接模型。

export const schemaFile = 'intent.schema.json';

export const valid = [
  {
    id: 'v-01 规则可解的课表问句（llmUsed 应为 false，但形状要合法）',
    data: {
      intent: 'schedule.tomorrow',
      confidence: 0.98,
      slots: { date: '2026-09-26' },
    },
  },
  {
    id: 'v-02 带范围',
    data: {
      intent: 'schedule.week',
      confidence: 0.91,
      slots: { dateRange: { from: '2026-09-21', to: '2026-09-27' } },
    },
  },
  {
    id: 'v-03 记事创建（带标题正文与提醒）',
    data: {
      intent: 'notes.create',
      confidence: 0.86,
      slots: {
        title: '交高数作业',
        content: '今晚 8 点前交到学习通',
        remindAt: '2026-09-25T20:00:00+08:00',
      },
    },
  },
  {
    id: 'v-04 空 slots 的意图（smalltalk 没有槽位）',
    data: { intent: 'smalltalk', confidence: 1, slots: {} },
  },
  {
    id: 'v-05 confidence 取边界 0 与 1',
    data: { intent: 'unsupported', confidence: 0, slots: {} },
  },
];

export const invalid = [
  {
    id: 'i-01 模型发明了新 intent —— 必须被拒，不得透传（D2 禁止项）',
    data: { intent: 'schedule.nextweek', confidence: 0.9, slots: {} },
    expect: '不在枚举内',
  },
  {
    id: 'i-02 confidence 越界（1.5）',
    data: { intent: 'smalltalk', confidence: 1.5, slots: {} },
    expect: '> maximum 1',
  },
  {
    id: 'i-03 confidence 为负',
    data: { intent: 'smalltalk', confidence: -0.1, slots: {} },
    expect: '< minimum 0',
  },
  {
    id: 'i-04 槽位不在白名单（模型自己加了一个）',
    data: { intent: 'notes.create', confidence: 0.9, slots: { title: 'x', courseId: 'CS101' } },
    expect: '不允许的额外字段: courseId',
  },
  {
    id: 'i-05 date 格式不对（保留了相对说法）',
    data: { intent: 'schedule.date', confidence: 0.9, slots: { date: '明天' } },
    expect: '不匹配 pattern',
  },
  {
    id: 'i-06 顶层多出字段（模型把解释也塞进来了）',
    data: { intent: 'smalltalk', confidence: 1, slots: {}, reason: '用户在打招呼' },
    expect: '不允许的额外字段: reason',
  },
  {
    id: 'i-07 缺 confidence',
    data: { intent: 'smalltalk', slots: {} },
    expect: '缺少必填字段: confidence',
  },
  {
    id: 'i-08 title 超 50 字',
    data: { intent: 'notes.create', confidence: 0.9, slots: { title: '标'.repeat(51) } },
    expect: '长度 51 > maxLength 50',
  },
  {
    id: 'i-09 content 超 500 字',
    data: { intent: 'notes.create', confidence: 0.9, slots: { content: '文'.repeat(501) } },
    expect: '长度 501 > maxLength 500',
  },
  {
    id: 'i-10 locationScope 越界（想开精确定位）',
    data: { intent: 'weather.today', confidence: 0.9, slots: { locationScope: 'precise' } },
    expect: '不在枚举内',
  },
  {
    id: 'i-11 dateRange 缺 to',
    data: { intent: 'schedule.week', confidence: 0.9, slots: { dateRange: { from: '2026-09-21' } } },
    expect: '缺少必填字段: to',
  },
];
