# firetree-receipt（M0 占位）

> M0 占位文本；`firetree_receipt` 仍是 stub，返回 `NOT_IMPLEMENTED`。

用途：变更的唯一出口，从外部证据组装回执并按等级校验。

- 只读证据；每条证据必须有 `producer`、`sha256`、`produced_at`、可打开的 `run_ref`。
- 生产者不得是 agent；签字人不得是 agent；本地模式显式 A1，不得声称 A2。
- 证据缺失/过期、影响未遍历、L2 未收敛、空映射的 correctness case → 拒绝并列出缺口。
- 不自动补证据；失败必须 fail-closed。
- 输出写入 `.firetree/receipts/<change>.json`。

正式规则见 `docs/ARCHITECTURE.md` §三.6 与 §五。当前不要调用该工具期待真实结果。
