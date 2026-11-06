# M0 状态

> 更新：2026-11-06。工作目录：`D:\FireTree-DSH`。基线提交：`1cabf4c`（导入规划文档）。
> 状态值：`DONE` / `IN_PROGRESS` / `PENDING` / `BLOCKED`。每个 DONE 必须附可复核证据。
> T0.11 的跟踪文件在 T0.1 时预建，M0 收口时补齐全部证据并完成 T0.11 本身。

| ID | 状态 | 证据路径 | 日期 |
|---|---|---|---|
| T0.1 | DONE | `docs/DECISIONS.md`；`test/m0-decisions.test.mjs`（21/21 通过） | 2026-11-06 |
| T0.2 | DONE | `docs/MIGRATION.md` §2.4（tag `v5-archive` → `00e81a89…`，工作区 clean） | 2026-11-06 |
| T0.3 | PENDING | `reference/qian/sources.json`、`reference/qian/README.md` §4 | — |
| T0.4 | PENDING | `package.json`、`cordis.patch.yml`、`index.js`、`src/` | — |
| T0.5 | PENDING | `schemas/*.schema.json`、`test/fixtures/`、schema 测试 | — |
| T0.6 | PENDING | `docs/ROADMAP.md` §三、tag `metrics-v0` | — |
| T0.7 | PENDING | `docs/DECISIONS.md` 红队记录、`docs/ROADMAP.md` §五 | — |
| T0.8 | PENDING | `docs/MIGRATION.md` 勾选与冻结删除清单 | — |
| T0.9 | PENDING | 规模基线测量记录 | — |
| T0.10 | PENDING | `docs/PARKING-LOT.md` | — |
| T0.11 | IN_PROGRESS | `plan/STATUS.md`（本文件；M0 收口时完成） | 2026-11-06 |

## 当前下一步

- T0.3：运行 `reference/qian/extract.py --root "D:\Qian" --check`，核对四卷 hash 与 20 条引文。

## M0 完成信号（滚动核对）

- [x] D1–D8 ACCEPTED（含规模含义、代价、证伪条件、复议时间）。
- [x] V5 归档 tag 与 hash 记录。
- [ ] 引文台账 `--check` 可复现。
- [ ] 仓库骨架可被 DSH 加载；7 个工具注册。
- [ ] 四个 schema 定稿（含 correctness case v0）。
- [ ] 指标冻结并打 tag `metrics-v0`。
- [ ] 风险登记册与红队意见。
- [ ] 迁移删除清单冻结。
- [ ] 规模基线已测。
- [ ] Parking Lot 确认。
- [ ] STATUS.md 可用。
