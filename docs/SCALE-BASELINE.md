# 规模基线与 §2 假设复核（T0.9）

> 测量日期：2026-11-06。目标：选出代表性仓库，测量文件数、LOC、近 8 周 PR 量、CI 时长、现有证据产物类型；与 [DEVELOPMENT-PLAN.md](../DEVELOPMENT-PLAN.md) §2 假设对比，偏差 >2× 时记录并调整。
> 只记录聚合数字，不复制代码、不记录个人信息、不修改被测仓库。

## 1. 目标仓库

**MiniMax-Code**（`MiniMax-AI/minimax-code`，公开仓库，MIT）：

- 选择原因：本地候选中唯一位于百万行 LOC 量级、同时有公开 PR/CI 历史的仓库。
- 本地快照：`4198174c89963ca7614ae7705bb897814d11b4ee`（2026-09-25，shallow clone）。
- 远端 HEAD：`3c21163c85a9684030cb147bfef48c6284fa3c46`（2026-11-04）。
- 远端仓库地址：<https://github.com/MiniMax-AI/minimax-code>
- 不修改被测仓库；文件数来自远端 tree，LOC 来自本地快照的只读统计。

## 2. 测量结果

| 维度 | 实测 | 方法 / 口径 |
|---|---|---|
| 文件数 | 4,562 | GitHub tree（`recursive=1`，`truncated=false`）；本地快照 4,259 |
| 文本 LOC | 1,119,654 | 本地快照 `git grep -I -c '^'` 求和 |
| 代码 LOC | 938,534 | 上述结果中 `.ts/.tsx/.js/.mjs/.py/.css/.html` 等代码扩展名求和 |
| 近 8 周 PR | 192 创建 / 169 合并（约 24/周） | GitHub Search API，`created:>=2026-09-11` |
| PR 作者 | 12 个唯一账号 | 同 8 周 PR 列表聚合；仅计数，不记录账号 |
| CI 主工作流 | Source verification（`.github/workflows/ci.yml`） | GitHub Actions API，主工作流最近 10 次 completed |
| CI 时长 | 成功 8 次：中位 582.5s（约 9.7 min），区间 419–626s | 另有一次 failure 618s、一次 cancelled 117s；中位数只用成功运行 |
| CODEOWNERS | 1 个 owner | 本地 `.github/CODEOWNERS` |
| 工作流文件 | 本地 8 个；远端列出 10 个 active + 3 个 dynamic | 本地 `.github/workflows/` + GitHub API |
| 证据产物 | `verification.json`、`verification.md`、`export.json` 上传为 artifact；测试日志；**无 JUnit/SARIF/coverage/SBOM** | `ci.yml` artifact 路径 + tracked 文件扫描 |
| FireTree 注册表 | 0 个 subsystem / 0 个 interface | 无 `.firetree/subsystems`、`.firetree/interfaces` |

**CI 计算边界**：只用主工作流最近 10 次 completed run；有 1 次 failure、1 次 cancelled，不计入成功中位数。CI 时长含排队后的运行时长，不含排队等待。

## 3. 与 §2 假设对比

| §2 假设 | 实测 | 判定 | 偏差 |
|---|---|---|---|
| 单仓 1M–5M LOC | 代码 938,534；文本 1,119,654 | 文本达标；代码略低于下限 | 代码约 1.07× 低于 1M，未超 2× |
| 10k–50k 文件 | 4,562 | 低于下限 | 约 2.19× |
| 3–5 个团队 | 12 个 PR 作者；1 个 CODEOWNERS owner | 团队数不可测 | 不能验证 3–5 团队 |
| 50–500 PR/周 | 约 24/周 | 低于下限 | 约 2.08× |
| CI 10–60 分钟 | 主工作流中位 9.7 min | 接近下限 | 约 1.03×，基本落在边界 |
| 已有 JUnit/SARIF/coverage/SBOM | 只有 verification JSON/MD/export JSON | 不满足 | 四类外部证据均缺 |

## 4. 调整

1. **不据此宣称百万行规模已验证**。本基线在代码 LOC 与 CI 时长上接近假设，但文件数与 PR 量低于假设 >2×，团队数不可测。
2. **M4 目标不降低**：M4 仍须选满足文件数/团队/PR 量门槛的仓库；本仓库可作为 M1/M2 的工具链与吞吐代表，但不能替代 M4 规模验收。
3. **补证据生产者**：目标仓库当前没有 JUnit/SARIF/coverage/SBOM 产物；M1/M3 必须补解析适配器，或推动目标仓 CI 产出这些格式，否则回执证据类型不成立。
4. **CI 时长自动化**：M3 用运行开始/结束时间自动记录 P50/P90，不靠人工 API 查询。
5. **注册表从 0 开始**：目标仓库没有 `.firetree/subsystems` / `interfaces`；M1 的影响分析需要先导入注册表，不能假设已有。
6. 指标与阈值不因本基线调整；`metrics-v0` 保持冻结。

## 5. 限制与诚实边界

- 文件数来自远端 HEAD 的 tree；LOC 来自 2026-09-25 的 shallow 本地快照，远端代码量可能有小幅漂移。
- PR 数来自 GitHub Search API 的 `total_count`，不是本地 git 计数；本地 clone 只有 1 个 commit，不能用于 8 周历史。PR 数包含 bot/Dependabot 创建项，未按作者类型过滤。
- 团队数无法从公开数据可靠推断；12 个作者不等于 3–5 个团队。
- CI 中位数只覆盖主工作流最近 10 次运行，不是 8 周全量；release/performance 等其他工作流未计入。
- 未检查 artifact 内容，只检查上传路径与格式；不声称 verification 报告可被 FireTree 直接消费。

## 6. 复现

```powershell
# 本地规模（只读）
git -C "D:\minimax-code" ls-files | Measure-Object
git -C "D:\minimax-code" grep -I -c '^'
git -C "D:\minimax-code" rev-parse HEAD

# 远端文件数与 HEAD
# https://api.github.com/repos/MiniMax-AI/minimax-code/git/trees/main?recursive=1
# https://api.github.com/repos/MiniMax-AI/minimax-code/commits/main

# 近 8 周 PR
# https://api.github.com/search/issues?q=repo:MiniMax-AI/minimax-code+is:pr+created:%3E%3D2026-09-11&per_page=1

# 主工作流 CI
# https://api.github.com/repos/MiniMax-AI/minimax-code/actions/workflows/361309876/runs?per_page=10&status=completed
```

## 7. 备选（未选中）

**CulisBooks**：1,238 个 tracked 文件、535,039 文本 LOC、166,292 代码 LOC、近 8 周 622 commits / 6 merges、38 个唯一作者、1 个 workflow、无 CODEOWNERS。优点是活跃且多作者；缺点是代码 LOC 远低于 1M、无 PR 元数据、无 CODEOWNERS，不能作为规模代表。保留为后续团队/流程试点候选，不作为 T0.9 的目标仓库。
