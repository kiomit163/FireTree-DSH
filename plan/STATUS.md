# M0 状态

> 更新：2026-11-06。工作目录：`D:\FireTree-DSH`。M0：**DONE**；M1 实现：**DONE**，50-PR 试点：**BLOCKED**（见 [M1-STATUS.md](M1-STATUS.md)）。
> 状态值：`DONE` / `IN_PROGRESS` / `PENDING` / `BLOCKED`。每个 DONE 附可复核证据。
> T0.11 的跟踪文件在 T0.1 时预建，本文件是 M0 收口证据；M0 完成后才允许进入 M1。

| ID | 状态 | 证据路径 | 日期 |
|---|---|---|---|
| T0.1 | DONE | `docs/DECISIONS.md`；`test/m0-decisions.test.mjs`（22/22） | 2026-11-06 |
| T0.2 | DONE | `docs/MIGRATION.md` §2.4（tag `v5-archive` → `00e81a89…`，工作区 clean） | 2026-11-06 |
| T0.3 | DONE | `reference/qian/README.md` §7（20/20、四卷 hash 一致、exit 0）；`reference/qian/sources.json` | 2026-11-06 |
| T0.4 | DONE | `package.json`、`cordis.patch.yml`、`index.js`、`src/`、`skills/`；`test/skeleton.test.mjs`；install/uninstall/reinstall 均 applied；`firetree_state` live | 2026-11-06 |
| T0.5 | DONE | `schemas/*.schema.json`、`schemas/README.md`、`fixtures/`；`test/schema-contracts.test.mjs`（17/17）、`test/schema-validator.test.mjs`（4/4） | 2026-11-06 |
| T0.6 | DONE | `docs/ROADMAP.md` §三（metrics-v0）；`docs/DECISIONS.md` D7 冻结记录；tag `metrics-v0` → `ada4206` | 2026-11-06 |
| T0.7 | DONE | `docs/DECISIONS.md` 红队 8/8；`DEVELOPMENT-PLAN.md` §15 R1–R12；`test/m0-risks.test.mjs` | 2026-11-06 |
| T0.8 | DONE | `docs/MIGRATION.md` §2.1–§2.5（删除清单冻结）；`test/m0-migration.test.mjs` | 2026-11-06 |
| T0.9 | DONE | `docs/SCALE-BASELINE.md`（MiniMax-Code：4,562 文件 / 938,534 代码 LOC / 24 PR·周⁻¹ / CI 9.7 min） | 2026-11-06 |
| T0.10 | DONE | `docs/PARKING-LOT.md`（M0 确认；P1–P16 全有触发条件）；`test/m0-parking.test.mjs` | 2026-11-06 |
| T0.11 | DONE | 本文件；`scripts/check-docs.mjs`；`test/docs-check.test.mjs`；最终 75/75 | 2026-11-06 |

## M0 验收记录

| 项 | 结果 | 证据 |
|---|---|---|
| 决策 | D1–D8 全部 ACCEPTED，含授权日期、规模含义、代价、证伪、复议、红队意见 | `docs/DECISIONS.md` |
| V5 归档 | tag `v5-archive` → `00e81a890e7cefc2fff89c2991a06593a827f4b8`；工作区 clean | `docs/MIGRATION.md` §2.4；V5 `git status --porcelain` 空 |
| 引文台账 | 四卷 hash 与 `sources.json` 一致；20/20 引文 OK；exit 0 | `reference/qian/README.md` §7 |
| 骨架 | 7 工具注册；6 技能占位；短 prompt section；可安装/卸载/重装 | `plugin_manager` applied；live 调用；`test/skeleton.test.mjs` |
| 规模契约 | policy/subsystems/interfaces/receipt 四 schema 定稿；含 correctness case v0 | `schemas/`；`test/schema-contracts.test.mjs` |
| 空映射 | L2 空映射被 schema 与语义检查拒绝；漏 claim 也被拒绝 | `fixtures/correctness-case-l2-empty-mapping.json`、`…unmapped-claim.json` |
| 指标 | `metrics-v0` 冻结；20%/30% 分阶段口径；样本量与统计口径 | `docs/ROADMAP.md` §三；tag `metrics-v0` |
| 风险/红队 | D1–D8 各一条反对与回应；R1–R12 有 Owner/预警/缓解/应急 | `docs/DECISIONS.md`；`DEVELOPMENT-PLAN.md` §15 |
| 迁移 | 保留/重写/删除/归档逐项确认；删除清单冻结 | `docs/MIGRATION.md` §2.1–§2.5 |
| 规模基线 | MiniMax-Code：4,562 文件、938,534 代码 LOC、192 PR/8 周、CI 中位 9.7 min | `docs/SCALE-BASELINE.md` |
| 基线偏差 | 文件约 2.19×、PR 约 2.08× 低于 §2 下限；M4 目标不降低，M0 不宣称百万行已验证 | `docs/SCALE-BASELINE.md` §3–§4 |
| Parking Lot | P1–P16 全部有触发条件；v1 范围未扩大 | `docs/PARKING-LOT.md` |
| 文档 | 24 个 Markdown，58 个相对链接，UTF-8 与链接 0 错误 | `npm run check:docs` |
| 测试 | 75/75 通过；20 个 JS/MJS 文件 `node --check` 通过 | `npm test`；`node --check` |

## 复验命令

```powershell
npm.cmd test                 # 75/75
npm.cmd run check:docs       # docs=24 links=58 errors=0
# 20 个 JS/MJS 文件逐个 node --check
& 'C:\Users\HK\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe' `
  reference/qian/extract.py --root "D:\Qian" --check
git rev-parse 'metrics-v0^{commit}'                 # ada4206…
git -C 'D:\FireTree V5' rev-parse 'v5-archive^{commit}'  # 00e81a89…
```

live 验收：`firetree_state` 返回 empty/subsystem 空投影；`firetree_assess`/`firetree_receipt` 等 6 个 stub 返回 `NOT_IMPLEMENTED`；技能目录列出 6 个 FireTree 技能。

## M0 完成信号

- [x] D1–D8 ACCEPTED（含规模含义、代价、证伪条件、复议时间）。
- [x] V5 归档 tag 与 hash 记录。
- [x] 引文台账 `--check` 可复现。
- [x] 仓库骨架可被 DSH 加载；7 个工具注册；可卸载并重装。
- [x] 四个 schema 定稿（含 correctness case v0）；L0/L1/L2 样例通过；空映射被拒。
- [x] 指标冻结并打 tag `metrics-v0`。
- [x] 风险登记册与红队意见。
- [x] 迁移删除清单冻结。
- [x] 规模基线已测（含 >2× 偏差与调整）。
- [x] Parking Lot 确认。
- [x] STATUS.md 可用。

## M0 遗留（不是 M0 失败）

1. 6 个业务工具仍是 stub；完整回执校验、影响分析、评审/综合集成在 M1/M2。
2. `firetree_receipt` 的跨字段/文件/时钟语义检查尚未实现；M0 只完成 schema 与 v0 case 检查。
3. 技能正文是占位；W8 重写。
4. 规模基线在文件数/PR 量上低于 §2 假设；M4 必须另选满足门槛的仓库。
5. 目标仓当前没有 JUnit/SARIF/coverage/SBOM；M1/M3 要补证据适配或改变产出。

**M1 未开始。** 进入 M1 前不得把 stub 当作已实现的业务能力，也不得声称 M0 已验证百万行规模。
