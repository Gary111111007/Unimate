// 契约用例：tool.notes.update.schema.json（主规划 §4.5）
// 要害：必须【唯一定位】目标——anyOf 保证 targetId / targetHint 至少给一个；
//       0 条与多条在运行时分别返回 E_NOT_FOUND / E_AMBIGUOUS。

export const schemaFile = 'tool.notes.update.schema.json';

export const valid = [
  {
    id: 'v-01 按 id 定位 + 改标题',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      targetId: 'n_456',
      patch: { title: '交高数作业（已改）' },
    },
  },
  {
    id: 'v-02 按提示词定位 + 乐观锁',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      targetHint: '实验报告',
      patch: { content: '改到周五交', remindAt: '2026-09-26T20:00:00+08:00' },
      expectedVersion: 3,
    },
  },
  {
    id: 'v-03 同时给 targetId 与 targetHint（都给了也合法，运行时以 id 为准）',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      targetId: 'n_456',
      targetHint: '报告',
      patch: { title: 'x' },
    },
  },
];

export const invalid = [
  {
    id: 'i-01 既不给 targetId 也不给 targetHint —— 无法唯一定位，必须拒',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      patch: { title: 'x' },
    },
    expect: 'anyOf 要求至少 1 个分支通过，实际 0 个',
  },
  {
    id: 'i-02 patch 为空对象 —— 没有任何要改的东西',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      targetId: 'n_456',
      patch: {},
    },
    expect: '属性数 0 < minProperties 1',
  },
  {
    id: 'i-03 patch 里有未授权字段（想改 user_id 之类）',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      targetId: 'n_456',
      patch: { userId: 'u_other' },
    },
    expect: '不允许的额外字段: userId',
  },
  {
    id: 'i-04 缺 patch',
    data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e', userId: 'u_8f3a91', targetId: 'n_456' },
    expect: '缺少必填字段: patch',
  },
  {
    id: 'i-05 expectedVersion 为负',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      targetId: 'n_456',
      patch: { title: 'x' },
      expectedVersion: -1,
    },
    expect: '< minimum 0',
  },
  {
    id: 'i-06 用 targetHint 模糊匹配但超 50 字',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      targetHint: '提'.repeat(51),
      patch: { title: 'x' },
    },
    expect: '长度 51 > maxLength 50',
  },
];
