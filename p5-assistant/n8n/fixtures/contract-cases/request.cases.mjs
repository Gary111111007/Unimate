// 契约用例：request.schema.json（Layer B 线上请求，主规划 v2.3.2 §6.1，**v1.1**）
// 约定：valid 全部必须通过；invalid 每个都必须【失败】，且失败信息必须包含 expect 子串。
//
// v1.1 的两处重点：
//   ① schemaVersion 由 1.0 升为 1.1 —— 旧 1.0 请求必须被拒（对应 E_VERSION_UNSUPPORTED）
//   ② 新增可选 contextCapsule —— 其白名单由 additionalProperties:false 在 schema 层强制，
//      黑名单（课程名/教师/教室/姓名/学号/照片/账号/凭据/记事标题正文）逐项有反例

const long = (n) => '啊'.repeat(n);
const ts = (s) => `2026-09-30T${s}:00+08:00`;
// 真正【删掉】键，而不是把值设成 undefined——后者键还在，
// 命中的会是 type 断言而不是 required 断言，测的就不是"缺字段"这件事了。
const omit = (o, ...ks) => Object.fromEntries(Object.entries(o).filter(([k]) => !ks.includes(k)));

// 一个干净的胶囊，供多个用例复用
const CAPSULE = {
  projectionVersion: '1',
  purpose: 'availability',
  window: { startAt: ts('13:00'), endAt: ts('18:00') },
  busySlots: [{ startAt: ts('14:00'), endAt: ts('15:40') }],
  todoStatus: { pendingCount: 2, nextDueAt: ts('20:00') },
};

const BASE = {
  schemaVersion: '1.1',
  requestId: 'b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
  inputType: 'text',
  message: '明天几点上课',
  timezone: 'Asia/Shanghai',
  timestamp: '2026-09-30T09:30:00+08:00',
  clientVersion: '1.54.0',
};

export const schemaFile = 'request.schema.json';

export const valid = [
  {
    id: 'v-01 完整请求（含 contextCapsule）',
    data: {
      ...BASE,
      idempotencyKey: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      userId: 'u_8f3a91',
      sessionId: 's_77c2e1',
      locale: 'zh-CN',
      contextCapsule: CAPSULE,
    },
  },
  {
    id: 'v-02 最小必填集（不带胶囊——胶囊是可选字段）',
    data: BASE,
  },
  {
    id: 'v-03 胶囊只给必填三件（无 busySlots / todoStatus）',
    data: {
      ...BASE,
      contextCapsule: {
        projectionVersion: '1',
        purpose: 'brief',
        window: { startAt: ts('00:00'), endAt: ts('23:59') },
      },
    },
  },
  {
    id: 'v-04 三个 purpose 取值都合法（availability）',
    data: { ...BASE, contextCapsule: { ...CAPSULE, purpose: 'availability' } },
  },
  {
    id: 'v-05 三个 purpose 取值都合法（conflict）',
    data: { ...BASE, contextCapsule: { ...CAPSULE, purpose: 'conflict' } },
  },
  {
    id: 'v-06 busySlots 恰好 20 条（上界含等号）',
    data: {
      ...BASE,
      contextCapsule: {
        ...CAPSULE,
        busySlots: Array.from({ length: 20 }, (_, i) => ({
          startAt: `2026-09-30T${String(i).padStart(2, '0')}:00:00+08:00`,
          endAt: `2026-09-30T${String(i).padStart(2, '0')}:30:00+08:00`,
        })),
      },
    },
  },
  {
    id: 'v-07 message 恰好 500 字（上界含等号）',
    data: { ...BASE, message: long(500) },
  },
  {
    id: 'v-08 无待办（pendingCount 为 0，且无 nextDueAt）',
    data: { ...BASE, contextCapsule: { ...CAPSULE, todoStatus: { pendingCount: 0 } } },
  },
];

export const invalid = [
  // ── 基础字段 ───────────────────────────────────────────────────────────────
  { id: 'i-01 缺 message', data: omit(BASE, 'message'), expect: '缺少必填字段: message' },
  { id: 'i-02 message 类型错（传了数字）', data: { ...BASE, message: 12345 }, expect: '类型应为 string' },
  { id: 'i-03 message 501 字', data: { ...BASE, message: long(501) }, expect: '长度 501 > maxLength 500' },
  { id: 'i-04 message 为空串', data: { ...BASE, message: '' }, expect: '长度 0 < minLength 1' },
  {
    id: 'i-05 多出 isAdmin —— §13.6 #4 参数污染',
    data: { ...BASE, isAdmin: true },
    expect: '不允许的额外字段: isAdmin',
  },
  {
    id: 'i-06 schemaVersion 写成 2.0',
    data: { ...BASE, schemaVersion: '2.0' },
    expect: '不在枚举内',
  },
  {
    id: 'i-07 【v1.1 关键】SchemaVersion 仍是旧的 1.0 —— 必须被拒为 E_VERSION_UNSUPPORTED',
    data: { ...BASE, schemaVersion: '1.0' },
    expect: '不在枚举内',
  },
  { id: 'i-08 inputType 越界', data: { ...BASE, inputType: 'image' }, expect: '不在枚举内' },
  { id: 'i-09 requestId 不是 UUID', data: { ...BASE, requestId: 'abc-123' }, expect: '不是合法 UUID' },
  {
    id: 'i-10 timestamp 不是 ISO-8601（缺偏移量）',
    data: { ...BASE, timestamp: '2026-09-30 09:30:00' },
    expect: '不是合法 ISO-8601 date-time',
  },

  // ── 胶囊：结构性 ───────────────────────────────────────────────────────────
  {
    id: 'i-11 胶囊缺 projectionVersion',
    data: { ...BASE, contextCapsule: { purpose: 'brief', window: { startAt: ts('00:00'), endAt: ts('23:59') } } },
    expect: '缺少必填字段: projectionVersion',
  },
  {
    id: 'i-12 胶囊 projectionVersion 写成 "2"（投影规则版本没升）',
    data: { ...BASE, contextCapsule: { ...CAPSULE, projectionVersion: '2' } },
    expect: '应恒等于 "1"',
  },
  {
    id: 'i-13 胶囊缺 window',
    data: { ...BASE, contextCapsule: { projectionVersion: '1', purpose: 'brief' } },
    expect: '缺少必填字段: window',
  },
  {
    id: 'i-14 胶囊 purpose 越界（自造 "chat"）',
    data: { ...BASE, contextCapsule: { ...CAPSULE, purpose: 'chat' } },
    expect: '不在枚举内',
  },
  {
    id: 'i-15 胶囊 busySlots 21 条（超上界 20）',
    data: {
      ...BASE,
      contextCapsule: {
        ...CAPSULE,
        busySlots: Array.from({ length: 21 }, () => ({ startAt: ts('09:00'), endAt: ts('10:00') })),
      },
    },
    expect: '元素数 21 > maxItems 20',
  },
  {
    id: 'i-16 胶囊 busySlots 的段落缺 endAt',
    data: { ...BASE, contextCapsule: { ...CAPSULE, busySlots: [{ startAt: ts('14:00') }] } },
    expect: '缺少必填字段: endAt',
  },
  {
    id: 'i-17 胶囊 window 的时间不是带偏移的 ISO-8601',
    data: {
      ...BASE,
      contextCapsule: { ...CAPSULE, window: { startAt: '2026-09-30', endAt: '2026-10-01' } },
    },
    expect: '不是合法 ISO-8601 date-time',
  },
  {
    id: 'i-18 胶囊 todoStatus 缺 pendingCount',
    data: { ...BASE, contextCapsule: { ...CAPSULE, todoStatus: { nextDueAt: ts('20:00') } } },
    expect: '缺少必填字段: pendingCount',
  },
  {
    id: 'i-19 胶囊 todoStatus.pendingCount 为负',
    data: { ...BASE, contextCapsule: { ...CAPSULE, todoStatus: { pendingCount: -1 } } },
    expect: '< minimum 0',
  },

  // ── 胶囊：黑名单逐项（§6.1「禁止进入胶囊」的九类）────────────────────────
  {
    // ★ 这条是【变异验证】逼出来的：原本把 "title" 加进胶囊忙闲段的白名单，
    //   294 条测试全绿——说明当时漏了这个最常见的字段名（课程名/记事标题都可能写成 title）。
    id: 'i-20 胶囊忙闲段里塞 title（课程名/记事标题的常见写法）',
    data: { ...BASE, contextCapsule: { ...CAPSULE, busySlots: [{ startAt: ts('14:00'), endAt: ts('15:40'), title: '高等数学' }] } },
    expect: '不允许的额外字段: title',
  },
  {
    id: 'i-21 胶囊忙闲段里塞 name',
    data: { ...BASE, contextCapsule: { ...CAPSULE, busySlots: [{ startAt: ts('14:00'), endAt: ts('15:40'), name: '高等数学' }] } },
    expect: '不允许的额外字段: name',
  },
  {
    id: 'i-23 胶囊里塞课程名',
    data: { ...BASE, contextCapsule: { ...CAPSULE, busySlots: [{ startAt: ts('14:00'), endAt: ts('15:40'), courseName: '高等数学' }] } },
    expect: '不允许的额外字段: courseName',
  },
  {
    id: 'i-24 胶囊里塞教师',
    data: { ...BASE, contextCapsule: { ...CAPSULE, busySlots: [{ startAt: ts('14:00'), endAt: ts('15:40'), teacher: '教师A' }] } },
    expect: '不允许的额外字段: teacher',
  },
  {
    id: 'i-25 胶囊里塞教室',
    data: { ...BASE, contextCapsule: { ...CAPSULE, busySlots: [{ startAt: ts('14:00'), endAt: ts('15:40'), location: '教三-201' }] } },
    expect: '不允许的额外字段: location',
  },
  {
    id: 'i-26 胶囊里塞姓名',
    data: { ...BASE, contextCapsule: { ...CAPSULE, studentName: '智小汇' } },
    expect: '不允许的额外字段: studentName',
  },
  {
    id: 'i-27 胶囊里塞学号',
    data: { ...BASE, contextCapsule: { ...CAPSULE, studentId: '2025040999' } },
    expect: '不允许的额外字段: studentId',
  },
  {
    id: 'i-28 胶囊里塞照片',
    data: { ...BASE, contextCapsule: { ...CAPSULE, photo: 'data:image/png;base64,AAAA' } },
    expect: '不允许的额外字段: photo',
  },
  {
    id: 'i-29 胶囊 todoStatus 里塞记事标题',
    data: { ...BASE, contextCapsule: { ...CAPSULE, todoStatus: { pendingCount: 2, title: '交高数作业' } } },
    expect: '不允许的额外字段: title',
  },
  {
    id: 'i-30 胶囊 todoStatus 里塞记事正文',
    data: { ...BASE, contextCapsule: { ...CAPSULE, todoStatus: { pendingCount: 2, content: '老师说要写满三页' } } },
    expect: '不允许的额外字段: content',
  },
  {
    id: 'i-31 胶囊里塞账号',
    data: { ...BASE, contextCapsule: { ...CAPSULE, account: 'u_8f3a91' } },
    expect: '不允许的额外字段: account',
  },
  {
    id: 'i-32 胶囊里塞登录凭据',
    data: { ...BASE, contextCapsule: { ...CAPSULE, token: 'eyJhbGciOiJIUzI1NiJ9' } },
    expect: '不允许的额外字段: token',
  },
  {
    id: 'i-33 把胶囊整个塞进 message（§6.1 明令禁止）——这里用超长触发上界',
    data: { ...BASE, message: `${long(400)}${JSON.stringify(CAPSULE)}`.slice(0, 501) },
    expect: '长度 501 > maxLength 500',
  },
];
