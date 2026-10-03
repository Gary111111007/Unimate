// 契约用例：cache.key.schema.json（主规划 §7.1）
// 七类键各一个正例；反例覆盖「版本段缺失」「scope 与 intent 不匹配」「hash 长度不对」「不是键」。
// 【比赛口径】MVP 用 cacheMode: disabled，不创建 cache_manager；本文件只冻结契约。

export const schemaFile = 'cache.key.schema.json';

const H16 = '7f3a9c2b1d4e5f60';

export const valid = [
  { id: 'v-01 主缓存键（课表）', data: `cache:v1:u_8f3a91:schedule.tomorrow:schedule0:${H16}` },
  { id: 'v-02 主缓存键（记事，版本号已推进到 12）', data: `cache:v1:u_8f3a91:notes.query:notes12:${H16}` },
  { id: 'v-03 主缓存键（二课）', data: `cache:v1:u_8f3a91:records.summary:records3:${H16}` },
  { id: 'v-04 意图缓存（注意：写操作【不】失效它）', data: `intent:v1:u_8f3a91:${H16}` },
  { id: 'v-05 数据版本计数器', data: 'cachever:v1:u_8f3a91:notes' },
  { id: 'v-06 幂等热路径', data: 'idem:v1:u_8f3a91:a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' },
  { id: 'v-07 确认令牌', data: 'confirm:v1:u_8f3a91:kQ7xR2mN8pL4vB1cD6fH9jK3wS5tY0aZ1bC2dE3fG4hI5jK6' },
  { id: 'v-08 会话上下文', data: 'session:v1:u_8f3a91:s_77c2e1' },
  { id: 'v-09 限流计数（窗口时间戳单位是分钟，见 §4.1 的 Date.now()/60000）', data: 'rl:v1:user:u_8f3a91:29816666' },
];

export const invalid = [
  {
    id: 'i-01 缺版本段（v1.0 的旧格式）—— F2 就是因为这个格式有坑才改的',
    data: `cache:v1:u_8f3a91:schedule.tomorrow:${H16}`,
    expect: 'oneOf 要求恰好 1 个分支通过，实际 0 个',
  },
  {
    id: 'i-02 版本段写成 v2（格式版本没升，不许自己改）',
    data: `cache:v2:u_8f3a91:schedule.tomorrow:schedule0:${H16}`,
    expect: 'oneOf 要求恰好 1 个分支通过，实际 0 个',
  },
  {
    id: 'i-03 canonicalArgsHash 只有 15 位（截断写错）',
    data: 'cache:v1:u_8f3a91:schedule.tomorrow:schedule0:7f3a9c2b1d4e5f6',
    expect: 'oneOf 要求恰好 1 个分支通过，实际 0 个',
  },
  {
    id: 'i-04 hash 里混进非十六进制字符',
    data: 'cache:v1:u_8f3a91:schedule.tomorrow:schedule0:7f3a9c2b1d4e5fZZ',
    expect: 'oneOf 要求恰好 1 个分支通过，实际 0 个',
  },
  {
    id: 'i-05 完全不是键（把用户原话当 key 存）',
    data: '明天几点上课',
    expect: 'oneOf 要求恰好 1 个分支通过，实际 0 个',
  },
  {
    id: 'i-06 意图缓存把 userId 换成通配，导致跨用户串号',
    data: `intent:v1:*:${H16}`,
    expect: 'oneOf 要求恰好 1 个分支通过，实际 0 个',
  },
  {
    id: 'i-07 限流键时间戳写成【秒】（10 位）—— 窗口会算错 60 倍',
    data: 'rl:v1:user:u_8f3a91:1788996000',
    expect: 'oneOf 要求恰好 1 个分支通过，实际 0 个',
  },
  {
    id: 'i-08 限流键时间戳写成【毫秒】（13 位）—— 同样是单位错误',
    data: 'rl:v1:user:u_8f3a91:1788996000000',
    expect: 'oneOf 要求恰好 1 个分支通过，实际 0 个',
  },
  {
    id: 'i-09 限流键完全没有窗口时间戳 —— 键不再轮转，计数器会永不过期',
    data: 'rl:v1:user:u_8f3a91',
    expect: 'oneOf 要求恰好 1 个分支通过，实际 0 个',
  },
];
