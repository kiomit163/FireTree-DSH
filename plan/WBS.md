# 工作分解（WBS）

> 对应 [DEVELOPMENT-PLAN.md](../DEVELOPMENT-PLAN.md) §11。每个任务有：ID、交付、依赖、完成定义（DoD）。
> 任务粒度为「可在 1–3 天内演示」；跨任务的集成验收在里程碑（[ROADMAP.md](../docs/ROADMAP.md)）。

---

## W1 协议与数据模型（M0）

| ID | 任务 | 交付 | 依赖 | DoD |
|---|---|---|---|---|
| W1.1 | 分级与采样规则 | `policy.schema.json` + 规则文档 | 无 | 三个真实样例（L0/L1/L2）可表达 |
| W1.2 | 子系统/接口注册表 | `subsystems.schema.json`、`interfaces.schema.json` | W1.1 | 10 个真实子系统 + 接口可导入 |
| W1.3 | 回执契约 | `receipt.schema.json`（含 correctness_case）+ 校验规则清单 | W1.1 | 9 条拒绝规则各有测试 |
| W1.4 | 例外模型 | 例外结构（理由/批准人/到期） | W1.1 | 过期自动失效 |
| W1.5 | 策略继承 | org→repo→subsystem 覆盖规则 | W1.1 | 子层不能放松，只能加严 |

## W2 DSH 工具（M1–M2）

| ID | 任务 | 交付 | 依赖 | DoD |
|---|---|---|---|---|
| W2.1 | 工具骨架 | 7 个工具注册 + 严格 JSON + output.schema | W1 | `install_bundle` 可加载 |
| W2.2 | `firetree_classify` | set/show + 拒绝规则 | W2.1 | OCG 误声明被拒 |
| W2.3 | `firetree_assess` | 分级 + 影响 + 要求 | W2.1、W6.1 | 未知路径强制 L2 |
| W2.4 | `firetree_hypothesis` | add/verify/list | W2.1 | 缺检测方式被拒；agent 证据被拒 |
| W2.5 | `firetree_synthesize` | plan/record + 差异度/收敛 | W2.1 | 单模型冒充多席位被拒 |
| W2.6 | `firetree_review` | open/round/verdict | W2.1 | 七步缺步被拒 |
| W2.7 | `firetree_receipt` | build/check（含 correctness case 校验） | W1.3 | 缺证据/过期/自签/空映射被拒；≤2s |
| W2.8 | `firetree_state` | 只读汇总 | W2.1 | 空状态/单 change 查询 |
| W2.9 | 拒绝规则测试集 | 每个工具 ≥5 个反例 | W2.2–W2.8 | 全部测试通过 |

## W3 工件与状态（M1）

| ID | 任务 | 交付 | 依赖 | DoD |
|---|---|---|---|---|
| W3.1 | 原子写与哈希 | `lib/artifacts.js` | 无 | 崩溃不产生半文件 |
| W3.2 | 注册表加载 | 子系统/接口/CODEOWNERS 读取 | W1.2 | 10k 文件下 ≤1s |
| W3.3 | 变更工作区 | `.firetree/changes/<id>/` 生命周期 | W3.1 | 创建/读取/清理 |
| W3.4 | 投影缓存 | 活动 change/subsystem 状态 | W3.3 | 重启后可恢复 |
| W3.5 | 外置引用 | receipt 的 `uri + sha256` | W3.1 | 制品库不可达时降级 A1 |

## W4 集成（M1–M3）

| ID | 任务 | 交付 | 依赖 | DoD |
|---|---|---|---|---|
| W4.1 | git 变更集 | diff/commit/merge-base | 无 | 重命名/删除/二进制正确处理 |
| W4.2 | CI 证据 bundle | JUnit/JSON/SARIF/coverage/SBOM 解析 | 无 | 5 类产物可解析并哈希 |
| W4.3 | 接口注册表导入 | IDL/proto/OpenAPI/TS 导出 | W1.2 | 至少 2 种格式 |
| W4.4 | CODEOWNERS 解析 | 路径→owner | 无 | 与 GitHub 行为一致（抽样） |
| W4.5 | 身份映射 | CI OIDC → signoff identity | W4.2 | 伪造身份被拒 |
| W4.6 | 制品库（可选） | 回执外置 | W3.5 | 引用可达/不可达两态 |

## W5 强制执行（M3）

| ID | 任务 | 交付 | 依赖 | DoD |
|---|---|---|---|---|
| W5.1 | 守卫 | OCG 无签字拒绝定稿；L2 自签拒绝 | W2.7 | 两条 guard 有测试 |
| W5.2 | CI 检查脚本 | `firetree-receipt check` 作为 required check | W2.7、W4.2 | 缺证据 PR 失败 |
| W5.3 | PR 模板与分支保护 | 模板 + 必需检查清单 | W5.2 | 文档可执行 |
| W5.4 | 例外流程 | 热修补回执（24h）+ 到期 | W1.4 | 例外率可统计 |

## W6 规模机制（M1–M4）

| ID | 任务 | 交付 | 依赖 | DoD |
|---|---|---|---|---|
| W6.1 | 影响分析 v1 | 路径→子系统/接口/owner/tests | W3.2 | 50 条标注集召回 ≥90% |
| W6.2 | 置信度与未知策略 | `low` → L2 | W6.1 | 未知路径不可降级 |
| W6.3 | 采样 | L0 10% 抽检 + 记录 | W1.1 | 回执含抽样记录 |
| W6.4 | 吞吐指标 | WIP/队列/时延 | W7.1 | 周报可算 |
| W6.5 | 成本预算与缓存 | 分层预算、影响集缓存 | W2 | L0/L1/L2 成本达标 |
| W6.6 | 影响分析评估集 | 50 个真实变更 + 标注 | W6.1 | 召回/精确率报告 |

## W7 度量与评估（M3–M4）

| ID | 任务 | 交付 | 依赖 | DoD |
|---|---|---|---|---|
| W7.1 | 事件 schema | `metrics/events.jsonl` 字段与隐私规则 | 无 | 无代码内容/密钥 |
| W7.2 | 聚合脚本 | 周级指标 | W7.1 | 与原始数据可对账 |
| W7.3 | 看板 | 逃逸/时延/L2/误拦/成本 | W7.2 | 只读、可导出 |
| W7.4 | 消融分析脚本 | A/B/C/D + 匹配子系统 | W7.2 | 输出效应量与置信区间 |
| W7.5 | 试点复盘 | 报告 + go/no-go 建议 | W7.4 | 数据与结论可复核 |

## W8 迁移与文档（M0–M2）

| ID | 任务 | 交付 | 依赖 | DoD |
|---|---|---|---|---|
| W8.1 | 方法论迁移 | `reference/qian/methodology.md` | T0.3 | 引文与归属标注 |
| W8.2 | 技能重写 | 6 个 SKILL.md（≤ 约定字数） | W8.1 | catalog 可加载 |
| W8.3 | ADR 摘要 | `docs/decisions/ADR-DIGEST.md` | 无 | 只留决策与理由 |
| W8.4 | 培训与 playbook | 安装/分级/例外/评审指南 | W5 | 新人 30 分钟可上手 |

## W9 试点与推广（M1–M5）

| ID | 任务 | 交付 | 依赖 | DoD |
|---|---|---|---|---|
| W9.1 | 子系统选择 | 试点子系统 + owner | 无 | 有 CODEOWNERS、有 CI |
| W9.2 | 基线测量 | 8 周指标基线 | W7.1 | 指标与口径冻结 |
| W9.3 | M1 试点 | 1 团队 50 PR | W2、W3、W5.1 | 误拦<5%、团队愿继续 |
| W9.4 | M2 L2 试点 | 10 个 L2 | W2.5、W2.6、W2.7、W6.1 | 影响召回≥90%、correctness case 映射完整、人签 |
| W9.5 | M4 规模试点 | 3 团队 200+ PR | W5、W6、W7 | 成本/时延/逃逸达标 |
| W9.6 | M5 推广 | playbook/模板/培训 | W8.4、W9.5 | 采纳≥80%、例外<5% |

---

## 依赖与里程碑映射

| 里程碑 | 主要工作流 |
|---|---|
| M0 | W1、W2.1、W8.1、W7.1（schema） |
| M1 | W2（除 synthesize）、W3、W4.1、W4.4、W6.1、W9.3 |
| M2 | W2.5、W2.6、W4.3、W6.2、W9.4 |
| M3 | W4.2、W4.5、W5、W7.2–W7.3 |
| M4 | W6.3–W6.6、W7.4、W9.5 |
| M5 | W5.4、W8.4、W9.6 |

## 任务规则

1. 一个任务一个 PR；PR 描述写「拒绝了什么」。
2. 每个任务必须带测试；没有测试不算完成。
3. 跨工作流的接口先在 W1 定 schema，再实现。
4. 任何新增范围进 Parking Lot，不进 WBS。
