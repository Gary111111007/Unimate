// 契约用例：error.schema.json（主规划 §6.3 的 15 行错误码表）

export const schemaFile = 'error.schema.json';

export const valid = [
  { id: 'v-01 参数错：E_SCHEMA 400 不可重试', data: { errorCode: 'E_SCHEMA', httpStatus: 400, retryable: false } },
  { id: 'v-02 限流：E_RATE_LIMITED 429 可重试', data: { errorCode: 'E_RATE_LIMITED', httpStatus: 429, retryable: true } },
  { id: 'v-03 降级：E_LLM_UNAVAILABLE 用 200 —— 刻意不是 5xx', data: { errorCode: 'E_LLM_UNAVAILABLE', httpStatus: 200, retryable: true, messageForUser: '我现在答不了这类问题' } },
  { id: 'v-04 内部错：E_INTERNAL 500 可重试', data: { errorCode: 'E_INTERNAL', httpStatus: 500, retryable: true } },
  { id: 'v-05 待确认：E_CONFIRM_REQUIRED 428', data: { errorCode: 'E_CONFIRM_REQUIRED', httpStatus: 428, retryable: false } },
];

export const invalid = [
  {
    id: 'i-01 自造错误码',
    data: { errorCode: 'E_OOPS', httpStatus: 500, retryable: true },
    expect: '不在枚举内',
  },
  {
    id: 'i-02 httpStatus 自造（用了 418）',
    data: { errorCode: 'E_INTERNAL', httpStatus: 418, retryable: true },
    expect: '不在枚举内',
  },
  {
    id: 'i-03 缺 retryable —— 客户端要拿它决定退避，不能省',
    data: { errorCode: 'E_SCHEMA', httpStatus: 400 },
    expect: '缺少必填字段: retryable',
  },
  {
    id: 'i-04 messageForUser 超长',
    data: { errorCode: 'E_INTERNAL', httpStatus: 500, retryable: true, messageForUser: 'y'.repeat(201) },
    expect: '长度 201 > maxLength 200',
  },
  {
    id: 'i-05 httpStatus 传字符串',
    data: { errorCode: 'E_SCHEMA', httpStatus: '400', retryable: false },
    expect: '类型应为 integer',
  },
  {
    id: 'i-06 多余字段（把堆栈挂上去）',
    data: { errorCode: 'E_INTERNAL', httpStatus: 500, retryable: true, stack: 'at handler.js:88' },
    expect: '不允许的额外字段: stack',
  },
];
