// 契约用例：tool.notes.create.schema.json（主规划 §6.5 全文）
// 本文件最要害的一条是 i-02：请求体里塞 userId 必须被拒——这是「身份从上下文来、不从载荷来」
// 在 schema 层的落地（§6.5 的说明）。

export const schemaFile = 'tool.notes.create.schema.json';

export const valid = [
  {
    id: 'v-01 完整创建',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      idempotencyKey: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      title: '交高数作业',
      content: '今晚 8 点前交到学习通',
      remindAt: '2026-09-25T20:00:00+08:00',
      tags: ['作业', '高数'],
    },
  },
  {
    id: 'v-02 最小必填集',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      idempotencyKey: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      title: '买牙膏',
      content: '买牙膏',
    },
  },
  {
    id: 'v-03 边界：title 50 字、content 500 字、tags 5 个各 12 字',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      idempotencyKey: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      title: '标'.repeat(50),
      content: '文'.repeat(500),
      tags: Array.from({ length: 5 }, () => '签'.repeat(12)),
    },
  },
];

export const invalid = [
  {
    id: 'i-01 请求体塞 userId（身份伪造）—— §6.5 明写要拒',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      idempotencyKey: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      userId: 'u_someone_else',
      title: 'x',
      content: 'y',
    },
    expect: '不允许的额外字段: userId',
  },
  {
    id: 'i-02 缺 idempotencyKey —— 写操作没它就会重复写入',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      title: 'x',
      content: 'y',
    },
    expect: '缺少必填字段: idempotencyKey',
  },
  {
    id: 'i-03 idempotencyKey 不是 UUID',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      idempotencyKey: 'key-001',
      title: 'x',
      content: 'y',
    },
    expect: '不是合法 UUID',
  },
  {
    id: 'i-04 title 51 字',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      idempotencyKey: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      title: '标'.repeat(51),
      content: 'y',
    },
    expect: '长度 51 > maxLength 50',
  },
  {
    id: 'i-05 content 501 字',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      idempotencyKey: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      title: 'x',
      content: '文'.repeat(501),
    },
    expect: '长度 501 > maxLength 500',
  },
  {
    id: 'i-06 tags 6 个（超 maxItems 5）',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      idempotencyKey: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      title: 'x',
      content: 'y',
      tags: ['a', 'b', 'c', 'd', 'e', 'f'],
    },
    expect: '元素数 6 > maxItems 5',
  },
  {
    id: 'i-07 单个 tag 13 字',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      idempotencyKey: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      title: 'x',
      content: 'y',
      tags: ['签'.repeat(13)],
    },
    expect: '长度 13 > maxLength 12',
  },
  {
    id: 'i-08 remindAt 不是 date-time',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      idempotencyKey: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      title: 'x',
      content: 'y',
      remindAt: '2026-09-25 20:00',
    },
    expect: '不是合法 ISO-8601 date-time',
  },
  {
    id: 'i-09 content 为空',
    data: {
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      idempotencyKey: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      title: 'x',
      content: '',
    },
    expect: '长度 0 < minLength 1',
  },
];
