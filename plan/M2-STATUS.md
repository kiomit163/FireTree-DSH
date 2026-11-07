# M2 状态

> 更新：2026-11-07。M1 实现已完成、50-PR 试点仍 BLOCKED；M2 本地实现：**DONE**；M2 里程碑数据：**BLOCKED**。
> 本文只记录 M2 的本地代码/契约验证；真实 10 个 L2、50 条影响标注、试点数据不作为已完成。

| ID | 状态 | 证据路径 | 日期 |
|---|---|---|---|
| W2.6 | DONE | `src/tools/review.js`、`schemas/review.schema.json`；`test/review.test.mjs`（5/5） | 2026-11-07 |
| W2.5 | DONE | `src/tools/synthesize.js`、`schemas/synthesis.schema.json`；`test/synthesize.test.mjs`（3/3） | 2026-11-07 |
| W9.4 | BLOCKED | 需 10 个真实 L2 与目标团队/仓库 | — |
| W6.6 | BLOCKED | 需 50 条真实影响标注集 | — |

## 当前下一步

- M2 代码实现完成；需目标团队/仓库跑 10 个 L2、50 条影响标注与七步/多席位数据。未做前不得宣称 M2 里程碑验收通过。

## 已知边界

- `firetree_review` 记录并校验评审工件；它不自动开会、不模拟评委会。
- `firetree_synthesize` 只校验席位记录与收敛条件；它不调用模型、不生成专家意见。
- L2 的两轮/七步/人签/双模型是工具拒绝规则；真实 L2 质量仍需 W9.4 数据。
