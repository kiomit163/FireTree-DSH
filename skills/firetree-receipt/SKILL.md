# firetree-receipt（M2 联动版）

用途：变更的唯一出口，从外部证据组装回执并按等级校验。

- `build` 读取 `assessment.json`、`hypotheses.json`、`verdict.json`、`synthesis/plan.json` 与 `synthesis/round-N.json`；要求显式 `intent`、`classification`、`evidence[]`、`expires_at`、`assurance`。
- review 字段与 signoff 从 review verdict 工件读取；若显式传入 `review`，必须与工件一致，否则失败。L2 另需 `correctness_case` 与 `synthesis` 摘要；signoff 必须 human。
- `check` 读取回执、review package/rounds/verdict、synthesis plan/rounds；复核哈希、轮次、最后一轮为空、无未解决 blocker、synthesis 已收敛且未超时。
- 证据 producer 不得是 agent；本地文件必须存在且 hash 一致；远程 URL 只接受显式 sha256。
- 回执过期、review 不收敛/缺步/未解决 blocker、L2 缺人签/correctness case/synthesis、假设未验证且未接受风险，都会返回 `ok:false` 与缺口清单。
- L0 不要求 review 工件；L1/L2 要求 review verdict；L2 额外要求 synthesis。

正式规则见 `docs/ARCHITECTURE.md` §三.6 与 §五。
