// 契约用例：tool.notes.delete.schema.json（主规划 §4.6 —— 危险 Tool，G4 测试重点）
// 注意本文件只覆盖【参数形状】。§4.6.3 的 7 个拒绝用例属于 P08（n7 安全加固），
// 且每条都必须【同时】断言「返回被拒」和「数据仍在」——那需要真数据，不在契约层做。

export const schemaFile = 'tool.notes.delete.schema.json';

export const valid = [
  {
    id: 'v-01 首次调用：不带令牌（期望运行时回 E_CONFIRM_REQUIRED + impact）',
    data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e', userId: 'u_8f3a91', targetId: 'n_456' },
  },
  {
    id: 'v-02 确认后重放：带一次性令牌',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      targetId: 'n_456',
      confirmToken: 'kQ7xR2mN8pL4vB1cD6fH9jK3wS5tY0aZ1bC2dE3fG4hI5jK6',
    },
  },
  {
    id: 'v-03 用提示词定位',
    data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e', userId: 'u_8f3a91', targetHint: '实验报告' },
  },
];

export const invalid = [
  {
    id: 'i-01 既不给 targetId 也不给 targetHint',
    data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e', userId: 'u_8f3a91' },
    expect: 'anyOf 要求至少 1 个分支通过，实际 0 个',
  },
  {
    id: 'i-02 令牌太短（不可能是 32 字节的 base64url）',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      targetId: 'n_456',
      confirmToken: 'abc',
    },
    expect: '长度 3 < minLength 32',
  },
  {
    id: 'i-03 缺 userId',
    data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e', targetId: 'n_456' },
    expect: '缺少必填字段: userId',
  },
  {
    id: 'i-04 多出 force 字段（想跳过确认）',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      targetId: 'n_456',
      force: true,
    },
    expect: '不允许的额外字段: force',
  },
  {
    id: 'i-05 多出 skipConfirm 字段（换个名字再试一次）',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      targetId: 'n_456',
      skipConfirm: true,
    },
    expect: '不允许的额外字段: skipConfirm',
  },
];
