# 解析规则包源目录（Net.md P2.5 / PRD 5.15）

这个目录**空着是正常的**：只有教务系统改版时才需要在这里放一份 `adapters/<adapterId>.json`。

- 改版时怎么改、怎么签、怎么回滚 → 见 [`../docs/adapters.md`](../docs/adapters.md)
- 规则键的白名单与默认值 → 见 [`../src/services/parser/rules.ts`](../src/services/parser/rules.ts)
- 下发前的校验：`npm run test:adapters`（含"把样本页改坏再下发规则"的演练）