# M1 状态

> 更新：2026-11-07。工作目录：`D:\FireTree-DSH`。M1 实现：**DONE**；50-PR 单团队试点：**BLOCKED（待用户提供团队/仓库）**。
> M0 已验收（见 [STATUS.md](STATUS.md)）。以下 DONE 是本地实现与验证，不等同于 M1 里程碑试点通过。
> 状态值：`DONE` / `IN_PROGRESS` / `PENDING` / `BLOCKED`。每个 DONE 附可复核证据。

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
| W9.3 | BLOCKED | 需目标团队/仓库；50 个真实 PR | — |

## 当前下一步

- M1 代码实现与本地验收完成。真实 50-PR 试点需用户提供目标团队/仓库；未做试点前不得宣称 M1 里程碑验收通过。

## Live 安装验证（2026-11-07）

- `plugin_manager` remove → install：`application: applied`。
- 在隔离 fixture（ignored `.tmp/`）中实际调用 5 个实现工具，均返回各自 render 文本，无 `NOT_IMPLEMENTED`：
  - `firetree_state`：empty / change / subsystem 查询均返回投影；
  - `firetree_classify`：写 `.firetree/oid/billing.json`（含 `.sha256`）；
  - `firetree_assess`：写 `.firetree/changes/chg-live/assessment.json`（含 `.sha256`；L1 / auto L1 / confidence high / signoff peer）；
  - `firetree_receipt`：build 写 `.firetree/receipts/chg-live.json`，check 返回 `ok=true; 0 gap(s)`；
  - `firetree_hypothesis`：add → 0.00 coverage，verify 外部证据 → 1.00 coverage，list 保持 1.00；写 `.firetree/changes/chg-hyp-live/hypotheses.json`（含 `.sha256`，h1 verified）。
- 说明：DSH 的模型侧工具结果以 render 文本呈现；结构化字段以写入工件与单元测试断言为准。

## 本地验收快照

- `node --test`：129/129 通过。
- `node --check`：42 个 JS/MJS 文件通过。
- `npm run check:docs`：26 个 Markdown、61 个相对链接、0 错误。
- 反例：classify 6、assess 5、hypothesis 7、receipt 6、state 5。

## 已知限制（M1）

- `firetree_receipt check` 只做最小校验；`firetree_review` 仍是 M2 工具，因此当前不检查 dissent 的逐条回应台账，只检查最后一轮 `new_findings=0` 与零异议自证字段。
- `accepted_risk` 尚未实现；未验证假设会阻断回执，而不是自动接受风险。
- 影响分析召回没有 50 条真实标注集；W6.1 只完成 v1 实现与 fixture 测试。
- 真实 50-PR 试点、误拦率、成本与团队意愿均未测。

## M1 完成信号（滚动）

- [x] classify/assess/hypothesis/receipt/state 可真实调用。
- [x] 子系统注册表 + CODEOWNERS + 影响分析可运行；未知路径强制 L2。
- [x] L0/L1/L2 分级与最小回执校验。
- [x] 每工具 ≥5 个反例。
- [ ] 真实 50 个 PR 试点（需用户提供团队/仓库）。
- [ ] 误拦 <5%、成本在预算内、团队愿意继续。
