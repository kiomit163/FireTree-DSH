# M2 状态

> 更新：2026-11-07。M1 实现已完成、50-PR 试点仍 BLOCKED；M2 本地实现：**IN_PROGRESS**。
> 本文只记录 M2 的本地代码/契约验证；真实 10 个 L2、50 条影响标注、试点数据不作为已完成。

| ID | 状态 | 证据路径 | 日期 |
|---|---|---|---|
| W2.6 | DONE | `src/tools/review.js`、`schemas/review.schema.json`；`test/review.test.mjs`（5/5） | 2026-11-07 |
| W2.5 | IN_PROGRESS | `src/tools/synthesize.js`（待建） | 2026-11-07 |
| W9.4 | BLOCKED | 需 10 个真实 L2 与目标团队/仓库 | — |
| W6.6 | BLOCKED | 需 50 条真实影响标注集 | — |

## 当前下一步

- W2.5：`firetree_synthesize` plan/record：独立席位、数据席位命令/数值、异议逐条回应、最多 3 轮、超时未收敛阻断。

## 已知边界

- `firetree_review` 记录并校验评审工件；它不自动开会、不模拟评委会。
- L2 的两轮/七步/人签是工具拒绝规则；真实 L2 质量仍需 W9.4 数据。
- `firetree_synthesize` 尚未实现。
