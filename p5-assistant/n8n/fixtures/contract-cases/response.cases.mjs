// 契约用例：response.schema.json（Layer B 线上响应，主规划 v2.3.2 §6.2，**v1.1**）
// 四个 valid 用例直接来自 §6.3 的四个响应实例（成功 / 待确认 / 多条命中 / LLM 降级）。
// v1.1 变更：schemaVersion 由 1.0 升为 1.1，与请求同步。

export const schemaFile = 'response.schema.json';

export const valid = [
  {
    id: 'v-01 成功（§6.3 实例：schedule.tomorrow）',
    data: {
      schemaVersion: '1.1',
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      success: true,
      intent: 'schedule.tomorrow',
      data: {
        date: '2026-09-25',
        courses: [
          { startTime: '08:00', endTime: '09:40', courseName: '高等数学', location: '教三-201' },
          { startTime: '14:00', endTime: '15:40', courseName: '大学物理', location: '教一-105' },
        ],
        coursesInTheWindow: 2,
        firstStart: '08:00',
      },
      errorCode: null,
      retryable: false,
      messageForUser: null,
    },
  },
  {
    id: 'v-02 删除待确认（§6.3 实例：E_CONFIRM_REQUIRED）',
    data: {
      schemaVersion: '1.1',
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      success: false,
      intent: 'notes.delete',
      data: {
        confirmToken: 'kQ7xR2mN8pL4vB1cD6fH9jK3wS5tY0aZ',
        impact: { targetId: 'n_456', title: '交实验报告', impactCount: 1, recoverable: true },
        expiresInSec: 300,
      },
      errorCode: 'E_CONFIRM_REQUIRED',
      retryable: false,
      messageForUser: '确定要删除「交实验报告」吗？',
    },
  },
  {
    id: 'v-03 多条命中（§6.3 实例：E_AMBIGUOUS）',
    data: {
      schemaVersion: '1.1',
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      success: false,
      intent: 'notes.update',
      data: {
        candidates: [
          { id: 'n_101', title: '交实验报告', updatedAt: '2026-09-20T10:00:00+08:00' },
          { id: 'n_102', title: '交实验报告（物理）', updatedAt: '2026-09-21T09:00:00+08:00' },
        ],
        total: 2,
      },
      errorCode: 'E_AMBIGUOUS',
      retryable: false,
      messageForUser: '找到 2 条，你想改哪一条？',
    },
  },
  {
    id: 'v-04 LLM 降级（§6.3 实例：E_LLM_UNAVAILABLE，注意 success 为 true）',
    data: {
      schemaVersion: '1.1',
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      success: true,
      intent: 'unsupported',
      data: {
        degraded: true,
        capabilities: ['明天几点上课', '这周几节课', '二课还差多少分', '我的记事有哪些'],
      },
      errorCode: 'E_LLM_UNAVAILABLE',
      retryable: true,
      messageForUser: '我现在答不了这类问题，但课表、二课和记事我还能查。',
    },
  },
  {
    id: 'v-05 网关在进入 router 前就失败：intent 为 null',
    data: {
      schemaVersion: '1.1',
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      success: false,
      intent: null,
      data: {},
      errorCode: 'E_AUTH',
      retryable: false,
      messageForUser: '请重新登录',
    },
  },
];

export const invalid = [
  {
    id: 'i-01 缺 errorCode —— §6.2 的 7 字段不变量，少一个就不算统一响应',
    data: {
      schemaVersion: '1.1',
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      success: true,
      intent: 'schedule.tomorrow',
      data: {},
      retryable: false,
      messageForUser: null,
    },
    expect: '缺少必填字段: errorCode',
  },
  {
    id: 'i-02 多出第 8 个字段 —— 形状断言必须拒绝',
    data: {
      schemaVersion: '1.1',
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      success: true,
      intent: 'schedule.tomorrow',
      data: {},
      errorCode: null,
      retryable: false,
      messageForUser: null,
      debugStack: 'at foo.js:1',
    },
    expect: '不允许的额外字段: debugStack',
  },
  {
    id: 'i-03 errorCode 越界（自造错误码）',
    data: {
      schemaVersion: '1.1',
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      success: false,
      intent: null,
      data: {},
      errorCode: 'E_WHATEVER',
      retryable: false,
      messageForUser: null,
    },
    expect: '不在枚举内',
  },
  {
    id: 'i-04 intent 越界（模型发明了新值）',
    data: {
      schemaVersion: '1.1',
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      success: true,
      intent: 'schedule.nextweek',
      data: {},
      errorCode: null,
      retryable: false,
      messageForUser: null,
    },
    expect: '不在枚举内',
  },
  {
    id: 'i-05 messageForUser 超长（把堆栈塞进用户文案）',
    data: {
      schemaVersion: '1.1',
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      success: false,
      intent: null,
      data: {},
      errorCode: 'E_INTERNAL',
      retryable: true,
      messageForUser: 'x'.repeat(201),
    },
    expect: '长度 201 > maxLength 200',
  },
  {
    id: 'i-06 success 不是布尔（字符串 "true"）',
    data: {
      schemaVersion: '1.1',
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      success: 'true',
      intent: null,
      data: {},
      errorCode: null,
      retryable: false,
      messageForUser: null,
    },
    expect: '类型应为 boolean',
  },
  {
    id: 'i-07 【v1.1 关键】响应仍是旧的 1.0 —— 说明 n8n 侧没跟着升级，客户端必须认出它',
    data: {
      schemaVersion: '1.0',
      requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      success: true,
      intent: 'schedule.tomorrow',
      data: {},
      errorCode: null,
      retryable: false,
      messageForUser: null,
    },
    expect: '不在枚举内',
  },
];
