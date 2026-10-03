// 契约用例：confirm-token.schema.json（主规划 §6.5 全文）
// 【F5 承重】E15 证实 Redis 节点的 SET 与 EXPIRE 非原子，令牌可能根本没有 TTL。
// 所以过期判断【只】看 exp——本文件里 exp 是必填，不是可选的。
// 【比赛口径】删除不进入 MVP；本文件冻结契约，无对应 Workflow。

export const schemaFile = 'confirm-token.schema.json';

export const valid = [
  {
    id: 'v-01 完整绑定记录',
    data: { userId: 'u_8f3a91', targetId: 'n_456', impactCount: 1, exp: 1790000000000 },
  },
  {
    id: 'v-02 多条影响（impactCount = 100，取上界）',
    data: { userId: 'u_8f3a91', targetId: 'n_batch', impactCount: 100, exp: 1790000000000 },
  },
];

export const invalid = [
  {
    id: 'i-01 缺 exp —— F5 之后它是唯一的过期依据，不能省',
    data: { userId: 'u_8f3a91', targetId: 'n_456', impactCount: 1 },
    expect: '缺少必填字段: exp',
  },
  {
    id: 'i-02 impactCount 为 0（确认了一个不存在的对象）',
    data: { userId: 'u_8f3a91', targetId: 'n_456', impactCount: 0, exp: 1790000000000 },
    expect: '< minimum 1',
  },
  {
    id: 'i-03 impactCount 101（超出上界，像是在批量删）',
    data: { userId: 'u_8f3a91', targetId: 'n_batch', impactCount: 101, exp: 1790000000000 },
    expect: '> maximum 100',
  },
  {
    id: 'i-04 多出 wildcard 字段（想用一条令牌删一批）',
    data: { userId: 'u_8f3a91', targetId: 'n_456', impactCount: 1, exp: 1790000000000, wildcard: true },
    expect: '不允许的额外字段: wildcard',
  },
  {
    id: 'i-05 缺 userId —— 令牌没绑用户，可以被借用',
    data: { targetId: 'n_456', impactCount: 1, exp: 1790000000000 },
    expect: '缺少必填字段: userId',
  },
  {
    id: 'i-06 缺 targetId —— 令牌没绑对象，可以被挪用',
    data: { userId: 'u_8f3a91', impactCount: 1, exp: 1790000000000 },
    expect: '缺少必填字段: targetId',
  },
];
