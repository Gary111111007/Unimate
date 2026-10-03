// 契约用例：tool.notes.query.schema.json（主规划 §4.4）
// 要害：分页必须有上限（limit ≤ 50），禁止无上限返回。

export const schemaFile = 'tool.notes.query.schema.json';

export const valid = [
  {
    id: 'v-01 只给必填（默认 limit 20）',
    data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e', userId: 'u_8f3a91' },
  },
  {
    id: 'v-02 带关键词与时间范围',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      keyword: '实验报告',
      timeRange: { from: '2026-09-01T00:00:00+08:00', to: '2026-09-30T23:59:59+08:00' },
      limit: 50,
    },
  },
  {
    id: 'v-03 limit 边界 1 与游标',
    data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e', userId: 'u_8f3a91', limit: 1, cursor: 'eyJvIjoyMH0' },
  },
];

export const invalid = [
  {
    id: 'i-01 缺 userId —— 查谁的记事必须明确',
    data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e' },
    expect: '缺少必填字段: userId',
  },
  {
    id: 'i-02 limit 999（想绕过分页上限）',
    data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e', userId: 'u_8f3a91', limit: 999 },
    expect: '> maximum 50',
  },
  {
    id: 'i-03 limit 0',
    data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e', userId: 'u_8f3a91', limit: 0 },
    expect: '< minimum 1',
  },
  {
    id: 'i-04 limit 传浮点（2.5）',
    data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e', userId: 'u_8f3a91', limit: 2.5 },
    expect: '类型应为 integer',
  },
  {
    id: 'i-05 多出排序字段（未在契约内，不许悄悄加）',
    data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e', userId: 'u_8f3a91', orderBy: 'remind_at' },
    expect: '不允许的额外字段: orderBy',
  },
  {
    id: 'i-06 keyword 超 50 字',
    data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e', userId: 'u_8f3a91', keyword: '词'.repeat(51) },
    expect: '长度 51 > maxLength 50',
  },
  {
    id: 'i-07 timeRange 缺 to',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      timeRange: { from: '2026-09-01T00:00:00+08:00' },
    },
    expect: '缺少必填字段: to',
  },
];
