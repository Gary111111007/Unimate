// 契约用例：uni-assistant-bridge.schema.json（Layer A，主规划 v2.3.2 §1.4）
// v2.3.2 已正式冻结 BusySlot / TodoSummary / ActionCard —— 本文件用的是正式字段，不是旧推断。
// 注意：本文件只覆盖【结构】约束；三条跨字段不变量在 invariants.cases.mjs。

const T = (s) => `2026-09-30T${s}:00+08:00`;

const REQ = {
  text: '下一节什么课',
  now: T('09:30'),
  timezone: 'Asia/Shanghai',
  context: {
    schedule: [{ startAt: T('10:00'), endAt: T('11:40'), periodLabel: '第3-4节' }],
    todoSummary: [{ title: '交高数作业', dueAt: T('20:00'), done: false }],
  },
};

const RESP = {
  answer: '下一节是 10:00 的课，在教三-201。',
  source: 'local_rule',
  cards: [
    { type: 'schedule_hint', title: '下一节', time: T('10:00'), operation: 'open.schedule', requiresConfirmation: false },
  ],
  explain: ['距开课还有 30 分钟', '依据：本机课表 2026-09-30 第3-4节'],
  offlineCapable: true,
  requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
};

export const schemaFile = 'uni-assistant-bridge.schema.json';

export const valid = [
  { id: 'v-01 完整 Layer A 往返', data: { request: REQ, response: RESP } },
  {
    id: 'v-02 空上下文（断网/无数据时也要合法）',
    data: {
      request: { ...REQ, context: {} },
      response: { ...RESP, answer: '今天没有课了。', cards: [], explain: [] },
    },
  },
  {
    id: 'v-03 BusySlot 带 title/location —— Layer A 允许，投影时才剥离',
    data: {
      request: {
        ...REQ,
        context: { schedule: [{ startAt: T('10:00'), endAt: T('11:40'), title: '高等数学', location: '教三-201', periodLabel: '第3-4节' }] },
      },
      response: RESP,
    },
  },
  {
    id: 'v-04 note.create 卡片（带 noteDraft，requiresConfirmation 为 true）',
    data: {
      request: { ...REQ, text: '今晚 8 点交高数作业' },
      response: {
        ...RESP,
        answer: '要我记下「今晚 8 点交高数作业」吗？',
        source: 'n8n_rule',
        cards: [
          {
            type: 'note_draft',
            title: '交高数作业',
            time: T('20:00'),
            impact: '新增 1 条记事',
            operation: 'note.create',
            noteDraft: { title: '交高数作业', remindAt: T('20:00') },
            requiresConfirmation: true,
          },
        ],
        offlineCapable: false,
      },
    },
  },
  {
    id: 'v-05 operation 为 none 的纯展示卡片',
    data: {
      request: REQ,
      response: {
        ...RESP,
        cards: [{ type: 'brief_item', title: '今日 2 节课', operation: 'none', requiresConfirmation: false }],
      },
    },
  },
  {
    id: 'v-06 TodoSummary 只给必填（done 必填，dueAt 可省）',
    data: {
      request: { ...REQ, context: { todoSummary: [{ title: '买牙膏', done: true }] } },
      response: RESP,
    },
  },
  {
    id: 'v-07 noteDraft 带 remindAt',
    data: {
      request: REQ,
      response: {
        ...RESP,
        cards: [
          { type: 'note_draft', title: '开会', operation: 'note.create', noteDraft: { title: '开会', remindAt: T('15:00') }, requiresConfirmation: true },
        ],
      },
    },
  },
];

export const invalid = [
  {
    id: 'i-01 source 越界（适配器自造来源）',
    data: { request: REQ, response: { ...RESP, source: 'cloud_llm' } },
    expect: '不在枚举内',
  },
  {
    id: 'i-02 缺 offlineCapable —— §1.4 的断网能力是产品承诺，不能省',
    data: { request: REQ, response: (({ offlineCapable, ...rest }) => rest)(RESP) },
    expect: '缺少必填字段: offlineCapable',
  },
  {
    id: 'i-03 BusySlot 缺 endAt（旧推断字段 date/start 已作废）',
    data: { request: { ...REQ, context: { schedule: [{ startAt: T('10:00') }] } }, response: RESP },
    expect: '缺少必填字段: endAt',
  },
  {
    id: 'i-04 BusySlot 用了旧字段名 date/start —— v2.3.2 已改为 startAt/endAt',
    data: { request: { ...REQ, context: { schedule: [{ date: '2026-09-30', start: '10:00', end: '11:40' }] } }, response: RESP },
    expect: '缺少必填字段: startAt',
  },
  {
    id: 'i-05 BusySlot 的时间不带偏移量',
    data: { request: { ...REQ, context: { schedule: [{ startAt: '2026-09-30 10:00', endAt: '2026-09-30 11:40' }] } }, response: RESP },
    expect: '不是合法 ISO-8601 date-time',
  },
  {
    id: 'i-06 TodoSummary 缺 done（§1.4 明确『必填』）',
    data: { request: { ...REQ, context: { todoSummary: [{ title: '交作业' }] } }, response: RESP },
    expect: '缺少必填字段: done',
  },
  {
    id: 'i-07 胶囊里塞姓名（Layer A 侧也要挡）',
    data: { request: { ...REQ, context: { schedule: [{ startAt: T('10:00'), endAt: T('11:40'), studentName: '智小汇' }] } }, response: RESP },
    expect: '不允许的额外字段: studentName',
  },
  {
    id: 'i-08 胶囊里塞记事正文',
    data: { request: { ...REQ, context: { todoSummary: [{ title: '交作业', done: false, content: '老师说要写满三页' }] } }, response: RESP },
    expect: '不允许的额外字段: content',
  },
  {
    id: 'i-09 ActionCard 缺 operation —— v2.3.2 新增的必填字段',
    data: { request: REQ, response: { ...RESP, cards: [{ type: 'brief_item', title: 'x', requiresConfirmation: false }] } },
    expect: '缺少必填字段: operation',
  },
  {
    id: 'i-10 ActionCard 缺 requiresConfirmation —— 安全字段不能省',
    data: { request: REQ, response: { ...RESP, cards: [{ type: 'schedule_hint', title: 'x', operation: 'none' }] } },
    expect: '缺少必填字段: requiresConfirmation',
  },
  {
    id: 'i-11 ActionCard.operation 越界（自造 delete.all）',
    data: { request: REQ, response: { ...RESP, cards: [{ type: 'brief_item', title: 'x', operation: 'delete.all', requiresConfirmation: false }] } },
    expect: '不在枚举内',
  },
  {
    id: 'i-12 ActionCard.type 越界',
    data: { request: REQ, response: { ...RESP, cards: [{ type: 'delete_everything', title: 'x', operation: 'none', requiresConfirmation: false }] } },
    expect: '不在枚举内',
  },
  {
    id: 'i-13 noteDraft 缺 title',
    data: {
      request: REQ,
      response: { ...RESP, cards: [{ type: 'note_draft', title: 'x', operation: 'note.create', noteDraft: { remindAt: T('20:00') }, requiresConfirmation: true }] },
    },
    expect: '缺少必填字段: title',
  },
  {
    id: 'i-14 noteDraft 里塞未授权字段',
    data: {
      request: REQ,
      response: { ...RESP, cards: [{ type: 'note_draft', title: 'x', operation: 'note.create', noteDraft: { title: 'x', tags: ['a'] }, requiresConfirmation: true }] },
    },
    expect: '不允许的额外字段: tags',
  },
  {
    id: 'i-15 requestId 不是 UUID',
    data: { request: REQ, response: { ...RESP, requestId: 'req-1' } },
    expect: '不是合法 UUID',
  },
  {
    id: 'i-16 text 为空串',
    data: { request: { ...REQ, text: '' }, response: RESP },
    expect: '长度 0 < minLength 1',
  },
  {
    id: 'i-17 explain 条目超 200 字',
    data: { request: REQ, response: { ...RESP, explain: ['依'.repeat(201)] } },
    expect: '长度 201 > maxLength 200',
  },
];
