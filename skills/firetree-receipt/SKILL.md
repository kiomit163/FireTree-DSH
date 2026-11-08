# firetree-receipt（M2 + autonomous）

用途：变更出口。默认 `governed`：组装交付回执并要求人类签字；`autonomous`：产出 A2 技术证据，不签字、不声称完成。

- `governed`：读取 assessment/hypotheses/verdict/synthesis；要求人类 signoff、L2 correctness case、synthesis；写 `.firetree/receipts/<change>.json`。
- `autonomous`：读取 assessment/hypotheses 与外部证据；不要求 review/synthesis/correctness case，不产生 human signoff，写入 `.firetree/evidence/<change>.json`；`human_signoff=false`、`completion_claim=false`、`milestone_claim=false`。
- `autonomous` 只能 A1/A2，禁止 A3；证据 producer 不得是 agent。
- `check` 按 mode 读取 receipt 或 technical evidence；永不自动补证据。
- 技术证据不是交付回执，不能据此声称 M1/M2 通过。

正式规则见 `docs/ARCHITECTURE.md` §三.6、`docs/AUTONOMOUS-MODE.md`。
