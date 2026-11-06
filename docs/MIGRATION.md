# 迁移：从 FireTree V5 带走什么

> V5 不是垃圾，也不是资产包。它是一份**读得很深的方法论 + 一个不该继续维护的运行时**。
> 迁移的对象是**内容与判据**，不是代码结构。

---

## 一、基线事实

| 项 | 数值 |
|---|---|
| V5 工作区文件 | 994（含 plan/ 580、firetree/ 265、.firetree/ 140） |
| 基线插件 | 24 个技能（约 250 KB 文本）、17 个 package、3 个宿主清单、hooks 层 |
| 任务状态 | 77 行：0 DONE、67 REVIEW、3 BLOCKED、7 TODO |
| 计划 | 约 100 个任务；REMEDIATION-PLAN 约 64 KB；580 个计划文件 |
| 实测成本 | 小任务 448K tokens / 21 分钟 vs 基线 74K / 97 秒（约 6×） |

## 二、迁移清单

> **T0.8 确认（2026-11-06）**：保留/重写/删除/归档四类逐项确认；删除清单从此冻结。
> 本清单是内容迁移计划，不是 M0 完成声明；运行时实现仍在 M1/M2。

### 2.1 保留并重写（内容资产）

| V5 来源 | 去向 | 处理方式 | M0 处置（2026-11-06） |
|---|---|---|---|
| `firetree/docs/METHODOLOGY-QIAN.md` | `reference/qian/methodology.md` | 保留结构（四台阶、三道防线、三条硬判据、归属边界）；去掉与运行时耦合的字段描述；所有引文进 quotes.md 索引 | 计划重写；W8.1 执行 |
| `reference/QIAN-EVIDENCE.md` | `reference/qian/attribution.md` | 保留「归属三分」表与「不要混淆」规则；补可复现台账；删除已失效的 `D:\OhCode` 引用 | 计划重写；W8.1 执行 |
| `firetree/skills/firetree/SKILL.md` | `skills/firetree/SKILL.md` | 从 15.4KB 压到 ≤3KB：只留路由、四个机制、铁律 | 占位已建；W8.2 重写 |
| `firetree/skills/firetree-review/SKILL.md` | `skills/firetree-review/SKILL.md` | 保留七步、裁决、收敛、红线；去掉与自研 CLI 绑定的命令 | 占位已建；W8.2 重写 |
| `firetree/skills/firetree-verify/SKILL.md` | `skills/firetree-receipt/SKILL.md` | 「完成前验证」改写成「无回执不声称完成」；证据来源改为外部 | 占位已建；W8.2 重写 |
| `firetree/skills/firetree-plan/SKILL.md` | `skills/firetree/SKILL.md` 的异常处置一节 | 保留「预置异常处置」判据；不搬计划模板 | 合并进 firetree；W8.2 重写 |
| `firetree/skills/firetree-brainstorm/SKILL.md` | 暂不迁移 | superpowers/BMAD 已有等价物，避免重复 | 不迁入 6 个技能；保留来源说明 |
| `firetree/docs/PROGRAM.md` §10/§11 | `docs/THESIS.md` 与 `docs/QIAN-LANDING.md` | 保留「未做什么」的诚实清单作为反面教材 | 已反映；不再搬运全文 |
| `docs/adr/*.md` | `docs/decisions/ADR-DIGEST.md` | 只迁决策结论与理由，不迁运行时设计 | 待 W8.3 |
| 不变量 I1–I15 | `docs/ARCHITECTURE.md` §十 | 转成失败模式与对策 | 已转为失败模式；不迁运行时 |

- [x] 逐项确认 10/10（2026-11-06）：保留内容、重写去向已明确；未完成项标 W8，不提前宣称完成。

### 2.2 抽取纯函数（代码资产）

只迁**无宿主依赖、无运行时状态、可单测**的函数：

| V5 来源 | 去向 | 说明 | M0 处置（2026-11-06） |
|---|---|---|---|
| `packages/schema/index.mjs` | `src/lib/schema.js` | JSON/路径/id 校验；补严格模式 | M0 已重写最小校验底座（本地 $ref/条件/pattern）；补强在 M1 |
| `packages/policy/shell-ast.mjs` | `src/lib/shell-ast.js` | 命令解析与拒绝规则（用于证据命令白名单） | 待 M1/W5；未迁不得声称已有 |
| `packages/review/rounds.mjs` | `src/lib/rounds.js` | 轮次/收敛/差异度 | 待 M2 |
| `packages/config/index.mjs` | `src/lib/hash.js` | 内容寻址/梅克尔根（回执哈希复用） | 待 M1/W3 |
| `scripts/lib/toml.mjs` | 不迁 | 项目不用 TOML | 不迁 |
| `packages/evidence/index.mjs` | `src/lib/receipt.js` 的校验部分 | 只保留校验思路，不迁签名/存储 | 待 M2；v1 不签名 |

**迁移规则**：每个迁入函数必须带自己的单测；没有测试的函数不迁。M0 只完成 `src/lib/schema.js` 的最小底座，不把未迁项算作完成。

- [x] 逐项确认 6/6（2026-11-06）：目标路径统一到 `src/lib/`；`toml` 明确不迁；其余按里程碑标注。

### 2.3 删除（运行时与内在平台）

- [x] **删除清单冻结（2026-11-06，T0.8）**：下表全部不进入新仓库；V5 只读保留作为证据；新增/移出需在 `docs/DECISIONS.md` 记录。

| 删除项 | 原因 |
|---|---|
| `packages/workflow/*`（events/engine/invariants） | Session log + DSH agent loop 已提供 |
| `packages/identity/*`、`roles.mjs`、`coi.mjs` | DSH scope + presets + approval 承担；字段角色是仿真 |
| `packages/ccb/*` | 不自建变更控制运行时；用 PR/CI |
| `packages/org/*`、`board`、`stpa.mjs` | 组织仿真，明确不做 |
| `packages/evidence/sign.mjs`、`store.mjs` | 签名/证据库移到 CI/外部；v1 不签名 |
| `hooks/*`（hook 层、3 个宿主声明） | DSH 用 prompt section + skills，不需要每 prompt 注入 |
| `install.mjs`、`verify-zcode.mjs`、`marketplace.json` | DSH `plugin_manager` 承担 |
| `scripts/{run,accept,gate,charter,policy,ledger,review,program}.mjs` | 由工具 + CI 取代；规则迁入 `src/lib/` |
| `tools/selftest-*.mjs` | 作为行为规格参考，不迁实现 |

**冻结例外**：无。V5 归档后不再修复；任何新想法进本仓库 Parking Lot。

### 2.4 归档（不迁移，保留证据）

**归档记录（2026-11-06，T0.2 实际执行）**

| 项 | 值 |
|---|---|
| 仓库 | `D:\FireTree V5` |
| tag | `v5-archive`（lightweight，指向 commit） |
| commit | `00e81a890e7cefc2fff89c2991a06593a827f4b8` |
| commit 日期 | `2026-11-02T00:16:30+08:00` |
| commit 标题 | `docs(qa): record 48/48 mutation smoke and final CI` |
| 取证时工作区 | `git status --porcelain=v1` 为空 |
| 复验命令 | `git -C "D:\FireTree V5" rev-parse "v5-archive^{commit}"` |

- V5 仓库打 tag `v5-archive`；记录 commit hash。
- `plan/STATUS.md`、`REMEDIATION-PLAN.md`、`plan/evidence/` 作为历史证据保留在原仓库。
- 在 `docs/MIGRATION.md` 记录归档位置与 hash，便于日后引用。
- 归档后 V5 只读：除复验与读取外不再修改；任何新想法进入本仓库，不回改 V5。
- [x] 归档确认（2026-11-06）：tag 与 commit 可复验，工作区 clean。

### 2.5 冻结记录（T0.8）

- [x] §2.1 内容资产：10 项逐项确认；不复制运行时。
- [x] §2.2 纯函数：6 项目标确认；仅 `src/lib/schema.js` 有 M0 底座，其余不提前宣称迁完。
- [x] §2.3 删除清单：9 组运行时/内在平台冻结，V5 只读，新仓库不引入。
- [x] §2.4 归档：`v5-archive` → `00e81a89…`。
- 冻结日期：2026-11-06。新增/移出删除清单必须在 `docs/DECISIONS.md` 记录；不得把 V5 运行时搬入本仓库。

## 三、迁移机制

1. **先打 tag 再动文件**；迁移期间 V5 只读。
2. **内容迁移不是代码复制**：文档重写、函数重写并补测。
3. **归属标注**：从 V5 迁来的文本在文件头写「derived from FireTree V5 / <path>」；BMAD/superpowers 来源保留 MIT NOTICE。
4. **增量验收**：每迁一项，在 `plan/M0-TASKS.md` 打勾并附测试结果。

## 四、迁移风险

| 风险 | 缓解 |
|---|---|
| 误删仍被需要的运行时 | 归档 tag + 只读副本；M1 前不删除原仓库 |
| 迁入函数带入宿主假设 | 每个函数强制单测 + 无 DSH import |
| 文档越迁越像 V5 | 每篇有字数上限与「机制/信号/证伪」检查 |
| 归属丢失 | 文件头 + NOTICE + quotes.md 索引 |

## 五、迁移完成标准

- [ ] 6 个技能文本完成并 ≤ 约定字数（当前为占位；W8.2）。
- [ ] 5 个纯函数迁入且单测通过（当前只有 `src/lib/schema.js` 的 M0 底座）。
- [x] 删除清单中的运行时在 V5 仓库保持只读，不进入新仓库（2026-11-06 冻结）。
- [x] `reference/qian/` 台账可复现（T0.3，2026-11-06）。
- [x] `docs/DECISIONS.md` 记录 V5 归档 tag 与 hash（T0.2，2026-11-06）。

**M0 进度**：6 个技能占位已注册；`src/lib/schema.js` 最小校验底座已建立；其余迁移项按 M1/M2/W8 执行。完成标准未全部满足，M1 前不得声称迁移完成。
