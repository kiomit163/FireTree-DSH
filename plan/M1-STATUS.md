# M1 状态

> 更新：2026-11-07。工作目录：`D:\FireTree-DSH`。M1：**IN_PROGRESS**；M0 已验收（见 [STATUS.md](STATUS.md)）。
> 状态值：`DONE` / `IN_PROGRESS` / `PENDING` / `BLOCKED`。每个 DONE 附可复核证据。
> 真实 50-PR 单团队试点依赖用户提供目标团队/仓库；本地实现与验收不等同于试点通过。

| ID | 状态 | 证据路径 | 日期 |
|---|---|---|---|
| W3.1 | DONE | `src/lib/artifacts.js`；`test/artifacts.test.mjs`（7/7） | 2026-11-07 |
| W3.2 | DONE | `src/lib/registry.js`；`test/registry.test.mjs`（4/4）；`test-support/m1-workspace.mjs` | 2026-11-07 |
| W4.4 | IN_PROGRESS | `src/lib/codeowners.js`（待建）、`src/lib/glob.js`（待建） | 2026-11-07 |
| W6.1 | PENDING | `src/lib/impact.js`、50 条标注集 | — |
| W6.2 | PENDING | unknown → L2 的拒绝测试 | — |
| W2.2 | PENDING | `src/tools/classify.js` + dossier | — |
| W2.3 | PENDING | `src/tools/assess.js` + assessment 工件 | — |
| W2.4 | PENDING | `src/tools/hypothesis.js` | — |
| W2.7 | PENDING | `src/tools/receipt.js` 最小校验 | — |
| W2.8 | PENDING | `src/tools/state.js` 真实投影 | — |
| W2.9 | PENDING | 每工具 ≥5 反例 | — |
| W9.3 | BLOCKED | 需目标团队/仓库；50 个真实 PR | — |

## 当前下一步

- W4.4：CODEOWNERS 解析与 path glob；随后 W6.1 影响分析。

## M1 完成信号（滚动）

- [ ] classify/assess/hypothesis/receipt/state 可真实调用。
- [ ] 子系统注册表 + CODEOWNERS + 影响分析可运行；未知路径强制 L2。
- [ ] L0/L1/L2 分级与最小回执校验。
- [ ] 每工具 ≥5 个反例。
- [ ] 真实 50 个 PR 试点（需用户提供团队/仓库）。
- [ ] 误拦 <5%、成本在预算内、团队愿意继续。
