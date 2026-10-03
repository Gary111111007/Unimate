// 契约用例：tool.records.query.schema.json（主规划 §4.12）
// 【比赛口径】§1.4 已把二课移出 MVP，本 schema 冻结契约但【不创建】对应 Workflow。
// 主规划 §4.12 与 §15.1-Q9 的措辞尚未同步，见 open-questions.md OQ-04。

export const schemaFile = 'tool.records.query.schema.json';

export const valid = [
  { id: 'v-01 只给必填（查总进度）', data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e', userId: 'u_8f3a91' } },
  {
    id: 'v-02 指定类别',
    data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e', userId: 'u_8f3a91', category: '志愿服务' },
  },
];

export const invalid = [
  {
    id: 'i-01 缺 userId',
    data: { requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e' },
    expect: '缺少必填字段: userId',
  },
  {
    id: 'i-02 多出 rawRecords 字段（想直接把二课明细拉走）',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      rawRecords: true,
    },
    expect: '不允许的额外字段: rawRecords',
  },
  {
    id: 'i-03 category 超 32 字',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      userId: 'u_8f3a91',
      category: '类'.repeat(33),
    },
    expect: '长度 33 > maxLength 32',
  },
];
