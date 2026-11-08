# M2 状态

> 更新：2026-11-07。M1 实现已完成、50-PR 试点仍 BLOCKED；M2 本地实现：**DONE**；M2 里程碑数据：**BLOCKED**。
> 本文只记录 M2 的本地代码/契约验证；真实 10 个 L2、50 条影响标注、试点数据不作为已完成。

| ID | 状态 | 证据路径 | 日期 |
|---|---|---|---|
| W2.6 | DONE | `src/tools/review.js`、`schemas/review.schema.json`；`test/review.test.mjs`（6/6）；含 open blocker 拒绝 | 2026-11-07 |
| W2.5 | DONE | `src/tools/synthesize.js`、`schemas/synthesis.schema.json`；`test/synthesize.test.mjs`（3/3） | 2026-11-07 |
| W2.10 | DONE | receipt↔review/synthesis 工件联动：`src/lib/receipt.js`、`src/tools/receipt.js`；L2 synthesis 摘要；`test/receipt.test.mjs`（6/6） | 2026-11-07 |
| W2.11 | DONE | state synthesis 投影：`src/tools/state.js`；`test/state.test.mjs`（6/6） | 2026-11-07 |
| W2.12 | DONE | Kubernetes OWNERS 适配器：`src/lib/owners.js`；`test/owners.test.mjs`（3/3）、`test/owners-official.test.mjs`（1/1）；594 OWNERS / 50 PR / 0 ownerless | 2026-11-08 |
| W2.13 | DONE | testdata `*.pem` 不触发 security L2；`src/lib/impact.js`、`test/impact.test.mjs` | 2026-11-08 |
| W2.14 | DONE (本地) | Prow 二进制级对拍：`tools/prow-owners-probe/`、`fixtures/owners-prow/`、`scripts/compare-prow-owners.mjs`、`.github/workflows/prow-owners-parity.yml`；Ubuntu Docker 官方测试 PASS，8/8 parity；GitHub runner 未跑 | 2026-11-08 |
| W2.15 | DONE (autonomous) | 5 个 L2 规则一致性审计：`docs/L2-ADJUDICATION.md`；无 human signoff / 无 M1 声明 | 2026-11-08 |
| W2.16 | DONE | autonomous 技术证据模式：`src/lib/technical.js`、`schemas/technical-evidence.schema.json`、`test/autonomous.test.mjs`（4/4）；A2 上限；live L2 build/check ok；state 投影 `technical_evidence` | 2026-11-08 |
| W2.17 | DONE (mixed A1/A2) | OTel 50 + K8s 50 逐 PR autonomous 技术证据：`scripts/pilot-technical-evidence.mjs`、`docs/PILOT-EVIDENCE.md`；100/100 生成；49 OTel 已升级 A2 coverage，51 仍 A1 analysis-only | 2026-11-08 |
| W2.18 | DONE (49/50) | Codecov coverage adapter：`scripts/pilot-codecov-evidence.mjs`；49 OTel A2/ci-evidence，`#16308` 无报告保持 A1 | 2026-11-08 |
| W2.19 | DONE (50/50) | Prow JUnit adapter：`scripts/pilot-prow-junit-evidence.mjs`；50 K8s A2/ci-evidence，真实 Prow unit JUnit | 2026-11-08 |
| W9.4 | BLOCKED | 需 10 个真实 L2 与目标团队/仓库 | — |
| W6.6 | BLOCKED | 需 50 条真实影响标注集 | — |

## 当前下一步

- M2 代码实现完成；需目标团队/仓库跑 10 个 L2、50 条影响标注与七步/多席位数据。未做前不得宣称 M2 里程碑验收通过。

## 工件联动（2026-11-07）

- 回执 schema 增加 `synthesis` 摘要；L2 条件必填，保存 plan path/hash、rounds、last_round path/hash、converged。
- `checkReceiptSemantics` 读取 `.firetree/changes/<change>/verdict.json` 与 `synthesis/plan.json` + `synthesis/round-N.json`，核对：
  - review 的 tier、rounds、new_findings、dissent、decision、七步/三步、human signoff；并读取 round-N.json 复核 finding 计数、最后一轮为空、无未解决 blocker；
  - synthesis 的 plan/last-round 哈希、轮数、converged/timed_out；
  - 回执 `synthesis` 引用与实际工件一致。
- `firetree_receipt build` 从 review verdict 取 review 字段与 signoff，从 synthesis 工件取 summary；若显式传入 `review`，必须与 verdict 一致，否则返回 `review input does not match verdict artifact`。
- `firetree_state` 的 change 投影新增 `synthesis_plan` 与 `synthesis_round` 条目；L2 缺 plan/round 会计入 pending。
- 测试：`test/receipt.test.mjs` 6/6、`test/state.test.mjs` 6/6。

## 已知边界

- `firetree_review` 记录并校验评审工件；它不自动开会、不模拟评委会。
- `firetree_synthesize` 只校验席位记录与收敛条件；它不调用模型、不生成专家意见。
- L2 的两轮/七步/人签/双模型是工具拒绝规则；真实 L2 质量仍需 W9.4 数据。
- L0 回执不要求 review 工件；L1/L2 要求 review verdict；L2 额外要求 synthesis。
- 真实 50-PR、10 个 L2、50 条影响标注仍未测。

## Live 验证（2026-11-07）

在隔离 fixture 中实际调用：
- `firetree_assess` → L2（2 subsystems / 1 interface / human signoff）。
- `firetree_review` open → round 1 → round 2 → verdict（7 steps / 2 rounds / human signoff）。
- `firetree_synthesize` plan → round 1（converged=false）→ round 2（converged=true；overlap 0.1017 / diversity 0.8983）。
- `firetree_state` 报 2 pending（hypotheses、receipt；review 已存在）。
- 发现并修复：ready verdict 曾接受 round 1 的 open blocker；现在返回 `OPEN_BLOCKER`，并有回归测试。
- 修复后重新安装 bundle（`application: applied`），在 fixture 中 live 重放同一 verdict：返回 `Error: ready verdict has 1 unresolved blocker(s)`。

