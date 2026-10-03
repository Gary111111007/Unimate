// 契约用例：tool.schedule.query.schema.json（主规划 §4.7 —— 比赛 MVP 的 6 个之一）
// 要害：date 与 dateRange 互斥（oneOf 恰好命中一个），且 timezone 必填——
//       相对时间换算只用客户端时区（§4.2.2），没有它整条规则会偏一天。

export const schemaFile = 'tool.schedule.query.schema.json';

export const valid = [
  {
    id: 'v-01 单日查询（"下一节什么课"）',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      date: '2026-09-25',
      timezone: 'Asia/Shanghai',
    },
  },
  {
    id: 'v-02 范围查询（"这周几节课"）',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      dateRange: { from: '2026-09-21', to: '2026-09-27' },
      timezone: 'Asia/Shanghai',
    },
  },
  {
    id: 'v-03 单日范围（from === to 也是合法范围）',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      dateRange: { from: '2026-09-25', to: '2026-09-25' },
      timezone: 'Asia/Shanghai',
    },
  },
];

export const invalid = [
  {
    id: 'i-01 既不给 date 也不给 dateRange —— 不知道问哪天',
    data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e', userId: 'u_8f3a91', timezone: 'Asia/Shanghai' },
    expect: 'oneOf 要求恰好 1 个分支通过，实际 0 个',
  },
  {
    id: 'i-02 date 与 dateRange 同时给 —— 语义冲突，必须拒而不是猜一个',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      date: '2026-09-25',
      dateRange: { from: '2026-09-21', to: '2026-09-27' },
      timezone: 'Asia/Shanghai',
    },
    expect: 'oneOf 要求恰好 1 个分支通过，实际 2 个',
  },
  {
    id: 'i-03 缺 timezone —— 没有它相对时间会按服务器时区算，整体偏一天',
    data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e', userId: 'u_8f3a91', date: '2026-09-25' },
    expect: '缺少必填字段: timezone',
  },
  {
    id: 'i-04 date 保留了相对说法（"明天"）',
    data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e', userId: 'u_8f3a91', date: '明天', timezone: 'Asia/Shanghai' },
    expect: '不匹配 pattern',
  },
  {
    id: 'i-05 date 写了 2026-9-5（未补零）',
    data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e', userId: 'u_8f3a91', date: '2026-9-5', timezone: 'Asia/Shanghai' },
    expect: '不匹配 pattern',
  },
  {
    id: 'i-06 dateRange 缺 from',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      dateRange: { to: '2026-09-27' },
      timezone: 'Asia/Shanghai',
    },
    expect: '缺少必填字段: from',
  },
  {
    id: 'i-07 多出 includeTeacher 字段（想把教师名带回去）',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      date: '2026-09-25',
      timezone: 'Asia/Shanghai',
      includeTeacher: true,
    },
    expect: '不允许的额外字段: includeTeacher',
  },
];
