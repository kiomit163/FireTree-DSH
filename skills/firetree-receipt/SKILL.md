# firetree-receipt（M1 初版）

用途：变更的唯一出口，从外部证据组装回执并按等级校验。

- `build` 读取 `assessment.json` 与 `hypotheses.json`，要求显式 `intent`、`classification`、`evidence[]`、`review`、`expires_at`、`assurance`；L2 还要求 `correctness_case` 路径与 `signoff.by=human`。
- `check` 只读 `.firetree/receipts/<change>.json` 与 `.sha256`，不自动补证据。
- 证据 producer 不得是 agent；本地文件必须存在且 hash 一致；远程 URL 只接受显式 sha256。
- 回执过期、评审最后一轮未归零、L2 缺人签/ correctness case、假设未验证且未接受风险，都会返回 `ok:false` 与缺口清单。
- 当前是 M1 最小校验；完整 correctness case 映射、外部证据可打开性与 ≤2s 性能目标在 M2 完成。

正式规则见 `docs/ARCHITECTURE.md` §三.6 与 §五。
