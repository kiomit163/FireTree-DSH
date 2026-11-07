# M1 状态

> 更新：2026-11-07。工作目录：`D:\FireTree-DSH`。M1：**IN_PROGRESS**；M0 已验收（见 [STATUS.md](STATUS.md)）。
> 状态值：`DONE` / `IN_PROGRESS` / `PENDING` / `BLOCKED`。每个 DONE 附可复核证据。
> 真实 50-PR 单团队试点依赖用户提供目标团队/仓库；本地实现与验收不等同于试点通过。

| ID | 状态 | 证据路径 | 日期 |
|---|---|---|---|
| W3.1 | DONE | `src/lib/artifacts.js`；`test/artifacts.test.mjs`（7/7） | 2026-11-07 |
| W3.2 | DONE | `src/lib/registry.js`；`test/registry.test.mjs`（4/4）；`test-support/m1-workspace.mjs` | 2026-11-07 |
| W4.4 | DONE | `src/lib/codeowners.js`、`src/lib/glob.js`；`test/glob-codeowners.test.mjs`（5/5） | 2026-11-07 |
| W6.1 | DONE (v1) | `src/lib/impact.js`；`test/impact.test.mjs`（7/7）；50 条标注集召回待 W6.6/M2，未宣称达标 | 2026-11-07 |
| W6.2 | DONE | `test/impact.test.mjs` 的 unknown/cross/interface/dependency/security → L2 用例 | 2026-11-07 |
| W2.2 | DONE | `src/tools/classify.js`、`schemas/dossier.schema.json`；`test/classify.test.mjs`（7/7） | 2026-11-07 |
| W2.3 | DONE | `src/tools/assess.js`、`schemas/assessment.schema.json`；`test/assess.test.mjs`（7/7）；`src/lib/tool-schema.js` 将内部 schema 投影到 Host 子集（`test/tool-schema.test.mjs` 3/3） | 2026-11-07 |
| W2.4 | DONE | `src/tools/hypothesis.js`、`schemas/hypotheses.schema.json`；`test/hypothesis.test.mjs`（5/5） | 2026-11-07 |
| W2.7 | DONE | `src/tools/receipt.js`、`src/lib/receipt.js`；`test/receipt.test.mjs`（5/5） | 2026-11-07 |
| W2.9 | DONE | 反例覆盖：classify 6、assess 5、hypothesis 7、receipt 6、state 5；全量测试见下 | 2026-11-07 |
| W2.8 | DONE | `src/tools/state.js` 真实投影；`test/state.test.mjs`（5/5） | 2026-11-07 |
| W2.9 | PENDING | 每工具 ≥5 反例 | — |
| W9.3 | BLOCKED | 需目标团队/仓库；50 个真实 PR | — |

## 当前下一步

- 全量测试、重新安装 bundle，并在隔离 fixture 中 live 验证 hypothesis/receipt；之后只差真实 50-PR 试点。

## Live 安装验证（2026-11-07）

- `plugin_manager` remove → install 结果：`application: applied`。
- 在隔离 fixture（ignored `.tmp/`）中实际调用 `firetree_state`、`firetree_classify`、`firetree_assess`：均返回各自 render 文本，无 `NOT_IMPLEMENTED`。
- 写入并核验：`.firetree/oid/billing.json`（含 `.sha256`）与 `.firetree/changes/chg-live/assessment.json`（含 `.sha256`）。assessment 实际为 L1 / auto L1 / confidence high / signoff peer / sampling selected true。
- 说明：DSH 的模型侧工具结果以 render 文本呈现；结构化字段以写入工件与单元测试断言为准。

## M1 完成信号（滚动）

- [x] classify/assess/hypothesis/receipt/state 可真实调用。
- [x] 子系统注册表 + CODEOWNERS + 影响分析可运行；未知路径强制 L2。
- [x] L0/L1/L2 分级与最小回执校验。
- [x] 每工具 ≥5 个反例。
- [ ] 真实 50 个 PR 试点（需用户提供团队/仓库）。
- [ ] 误拦 <5%、成本在预算内、团队愿意继续。
