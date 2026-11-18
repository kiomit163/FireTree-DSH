# v0 → v1 兼容与迁移

> 更新：2026-11-18。v1 契约在 `repair/v0.1` 落地。v0 不再产生新工件；v1 工具拒绝 v0 工件并提示迁移。

## 1. 为什么断代

v0 有两个契约级缺陷，补丁会保留坏语义：

- L0 receipt 要求 `review` 对象，但 L0 构建写入 `null`，导致 L0 governed 回执不可生成；
- unknown→L2 时 `impact.subsystems` 为空，与 receipt 的 `minItems: 1` 冲突；
- review 未绑定 assessment/package，correctness case 的 evidence_refs 未连回执。

v1 一次性修正这些语义；没有生产 v0 工件，因此不采用双写。

## 2. 字段变化

| 工件 | v0 | v1 |
|---|---|---|
| receipt | `firetree.receipt/v0`；`intent`/`classification` 必填；`review` 对象 | `v1`；`intent`/`classification` 可选；`review` 可为 null；`impact.unknown/unresolved_consumers/reasons`；review 带 `mode/assessment_sha256/package_sha256`；`assurance` 允许 A3 |
| assessment | `v0` | `v1`；`revision`、`prev_assessment`、`git.tree_sha/diff_sha256` |
| review package/verdict | `v0` | `v1`；`mode`、`assessment_sha256`、`package_sha256` |
| policy | `v0` | `v1`；`version` 由 canonical digest 计算；`extends` 递归 + tighten-only |
| hypotheses | `v0` | `v1`；可选 `accepted_risks[]` |
| correctness case | `v0` | `v1`；evidence refs 必须命中 receipt evidence |
| technical evidence | `v0` | `v1`；与 v1 receipt 的 impact/evidence 对齐 |

## 3. 迁移

```powershell
# 只报告，不写
node scripts/migrate-v0-to-v1.mjs --root <repo>

# 应用安全项；有 blocked 的工件只报告
node scripts/migrate-v0-to-v1.mjs --root <repo> --apply --out migration-report.json
```

脚本只能自动处理 schema 字符串、impact 默认数组、review.mode、assessment.revision、policy digest。以下必须人工重做：

- v0 receipt 的 `review.assessment_sha256`/`package_sha256`（无法从旧工件推断）；
- 采样 L0 的人类 spot-check；
- 旧 review package/verdict 的 assessment/package 绑定；
- v0 correctness case 的 evidence refs 重新对齐。

## 4. 回退

v1 工件不会被 v0 工具读取。回退到 v0 只能使用备份；本分支不提供 v1→v0 转换（那会重新引入 L0/unknown 缺陷）。
