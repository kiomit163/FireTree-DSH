# M0 任务（第 0–2 周）

> 目标：**决定落盘、V5 冻结、台账可复现、规模契约定稿、骨架可加载、指标冻结。**
> 两周内完成；任何一项延期，M1 顺延并在 DECISIONS 记录原因。

---

## 任务总览

| ID | 任务 | Owner | 估时 | 依赖 | 验收 |
|---|---|---|---|---|---|
| T0.1 | 开工决策会（D1–D8） | 主持 | 0.5d | 会前必读 | `DECISIONS.md` 8 条 ACCEPTED |
| T0.2 | V5 归档 | 工程 | 0.5d | 无 | tag `v5-archive` + commit hash 记录 |
| T0.3 | 引文台账重建 | 工程 | 1d | 无 | `extract.py --check` 通过；20 条引文核验；缺口写明 |
| T0.4 | 仓库骨架 | 工程 | 1d | T0.1 | `install_bundle` 可加载；7 个工具注册；`node --check` 通过 |
| T0.5 | 规模契约 | 工程+架构 | 1.5d | T0.1 | policy/subsystems/interfaces/receipt（含 correctness_case）四个 schema 定稿 |
| T0.6 | 指标预注册 | 度量 | 0.5d | T0.1 | `ROADMAP.md` §三冻结并打 tag `metrics-v0` |
| T0.7 | 风险清单与红队意见 | 红队 | 0.5d | T0.1 | 风险登记册 + 每条决定的反驳记录 |
| T0.8 | 迁移清单确认 | 工程 | 0.5d | T0.3 | `MIGRATION.md` 勾选；删除清单冻结 |
| T0.9 | 规模假设与基线测量 | 度量 | 0.5d | T0.1 | 目标仓库文件数/LOC/PR 量/CI 时长；确认 §2 假设 |
| T0.10 | Parking Lot 与范围冻结 | 主持 | 0.2d | T0.1 | 新想法入池；README「不做清单」确认 |

合计约 7 人日，分布在两周。

---

## 详细验收

### T0.1 开工决策会

- 按 [KICKOFF.md](../KICKOFF.md) 议程执行（可拆成两次，但 D1/D2 必须第一天定）。
- 产出：`DECISIONS.md` 八条状态改为 `ACCEPTED`，含日期、代价、证伪条件、复议时间。
- 新增：**确认目标是百万行规模**，并在 D1/D2 中写入规模含义（单仓/多团队/PR 量）。
- 失败判据：任何一条只有结论、没有证伪条件 → 未完成。

### T0.2 V5 归档

```bash
# 在 D:\FireTree V5
git tag v5-archive
git rev-parse v5-archive   # 记录 hash
git status --short         # 必须干净
```

- 记录到 `docs/MIGRATION.md` §2.4。
- 归档后 V5 只读；任何新想法进本仓库，不回改 V5。

### T0.3 引文台账重建

- 运行 `reference/qian/extract.py --root "D:\Qian" --check`。
- 核对四卷 SHA-256 与 `sources.json` 一致；20 条引文全部命中。
- 记录未验证项（十八份台账缺失、AI Coding 论文缺失）到 `reference/qian/README.md` §4。

### T0.4 仓库骨架

交付：

- `package.json`（`@local/firetree-dsh`，`dsh.bundle.patch`，exports locale/icon）。
- `cordis.patch.yml`（一行 host row）。
- `index.js`：`apply()` 注册 **7 个工具**（stub）、短 prompt section、6 个技能占位。
- `src/lib/json.js`（严格 JSON）、`src/lib/tiers.js`（L0/L1/L2）。
- `src/tools/state.js`：返回空状态（可真实调用）。

验收：

- [x] `node --check` 全部通过（2026-11-06：10 个 `.js`/`.mjs` 文件）。
- [x] `plugin_manager install_bundle` → `application: applied`（2026-11-06，目标 `D:\FireTree-DSH`）。
- [x] `firetree_state` 返回 `{ok:true, ...}`（单元测试断言 `ok:true`；live 调用返回 empty projection）。
- [x] 其余 6 个工具返回「not implemented」且不崩溃（单元测试 6/6；live `firetree_assess` 返回 `NOT_IMPLEMENTED`）。

### T0.5 规模契约

四个 schema 定稿（JSON Schema，进 `schemas/`）：

1. `policy.schema.json`：tiers 触发、采样率、例外结构（到期日）、继承与覆盖规则。
2. `subsystems.schema.json`：id、paths glob、owners、interfaces、tests、dossier 引用。
3. `interfaces.schema.json`：id、kind、file、sha256、contract_test、consumers、depends_on。
4. `receipt.schema.json`：见 `docs/ARCHITECTURE.md` §五（含 sampling/policy/impact/confidence/correctness_case）。

验收：

- [x] 用 3 个真实样例（L0/L1/L2 各一）验证 schema 可表达（`fixtures/receipt-l{0,1,2}.json`，2026-11-06 全部通过）。
- [x] `firetree_receipt` 的拒绝规则与 schema 字段一一对应（`schemas/README.md` §3 映射表；语义缺口标为 M2）。
- [x] 策略继承示例：org → repo → subsystem（`fixtures/policy-{org,repo,subsystem}.json`；子层只加严，放松只走例外）。
- [x] L2 样例覆盖「空映射被拒」（`fixtures/correctness-case-l2-empty-mapping.json` + 漏映射反例；schema 与语义检查均拒绝）。

### T0.6 指标预注册

- [x] 冻结 `ROADMAP.md` §三：主要/规模指标、采集方式、阈值、停止规则（2026-11-06，metrics-v0）。
- [x] 明确样本量与统计口径（M4 ≥200 PR、≥3 团队、前后各 8 周；不足时只报方向性）。
- [x] 打 tag `metrics-v0`；pilot 前不改。

### T0.7 风险与红队

- [x] 红队对 D1–D8 各提出至少一条反对意见，记录在 `DECISIONS.md`（2026-11-06，8/8）。
- [x] 风险清单覆盖：影响分析漏报、吞吐崩溃、成本超支、团队绕过、橡皮图章、DSH API 漂移、工件泛滥、单维护者、隐私/密钥、过度拟合、证据剧场、指标游戏化（R1–R12）。
- [x] 每条反对意见都有「为何仍采纳 / 如何缓解」（`test/m0-decisions.test.mjs`；风险表由 `test/m0-risks.test.mjs` 校验）。

### T0.8 迁移清单确认

- [x] 逐项确认 `MIGRATION.md` §2.1–§2.3（2026-11-06：10 项内容资产、6 项纯函数目标、9 组删除项）。
- [x] 冻结删除清单；例外需在 DECISIONS 记录（冻结记录 §2.5；无例外）。
- [x] 每节有勾选与日期；修正 5→6 个技能、`lib/`→`src/lib/` 路径（`test/m0-migration.test.mjs`）。

### T0.9 规模假设与基线测量

- [x] 选目标仓库（或代表性仓库），测量：
  - [x] 文件数 4,562、代码 LOC 938,534、文本 LOC 1,119,654（MiniMax-Code，2026-11-06）；
  - [x] 近 8 周 PR：192 创建 / 169 合并（约 24/周）；12 个 PR 作者；
  - [x] CI 主工作流成功运行中位 582.5s（约 9.7 min）；现有证据产物为 verification JSON/MD/export JSON；
  - [x] 现有测试/扫描产物类型：无 JUnit/SARIF/coverage/SBOM；`.firetree` 注册表为 0。
- [x] 对照 `DEVELOPMENT-PLAN.md` §2 假设：文件数约 2.19×、PR 量约 2.08× 低于下限；代码 LOC 约 1.07× 低于下限；CI 约 1.03× 低于下限；团队数不可测。偏差与调整见 `docs/SCALE-BASELINE.md`。

### T0.10 Parking Lot 与范围冻结

- 确认并填充 `docs/PARKING-LOT.md`。
- 会上所有「以后做」的想法入池，标注触发条件。
- 验收：v1 范围未扩大；池中条目有触发条件。

---

## M0 完成信号

- `DECISIONS.md`：8 条 ACCEPTED（含规模含义）。
- `reference/qian`：hash 一致、引文可核、缺口写明。
- 骨架：可安装、可调用、可卸载；7 个工具注册。
- 规模契约：4 个 schema 定稿并有样例。
- 指标：冻结并打 tag；规模假设已测量。
- 范围：README「不做清单」+ Parking Lot 生效。

**以上全部满足，才允许开始 M1 写业务逻辑。**
