# FireTree-DSH

**一个 DSH 原生的「可审计交付协议」**：用钱学森系统科学的**判据**、中国航天工程实践的**机制**、DSH 宿主原语的**执行底座**，让「做完了」这句话变成一份可验证的交付回执。

> 本仓库是重写，不是移植。FireTree V5 归档为方法论来源与基线证据；这里只保留其中真正值得留下的东西。

---

## 1. 一句话定位

> **FireTree-DSH 降低百万行项目的逃逸缺陷率，并让正确性主张可验证：不替代编译器、测试、静态分析与形式化验证，但强制这些证据存在、被检查、被签字；不宣称零缺陷。**

目标是「工程质量控制 + 正确性论证」：代码级正确性由工具链负责，插件管设计级（对象辨识、假设、接口契约）与交付级（评审、影响、证据、签字）的正确性，并把两者串成一份可拒绝的交付回执。

目标规模：单仓 10k–50k 文件 / 1M–5M LOC、3–5 个团队、50–500 PR/周。它不是代码智能（不建索引、不做静态分析），而是叠在 git / CI / 代码智能 / CODEOWNERS 之上的**交付保证层**。

它是协议 + 技能 + 薄插件 + 外部证据，不是治理操作系统。完整开发规划见 [DEVELOPMENT-PLAN.md](DEVELOPMENT-PLAN.md)。

## 2. 为什么重写（问题陈述）

FireTree 4.0/V5 的诊断结论（详见 `docs/THESIS.md`）：

- **第二系统效应**：从 24 个技能的交付方法，膨胀成 17 个 package 的保证系统。
- **内在平台效应**：在插件里重造了事件溯源、RBAC、CCB、签名、策略引擎——这些是宿主/CI/组织本来就有的能力。
- **自证困境（控制论变体）**：证据由被审计的 agent 写、由同一 agent 的闸门验。观测器与被控对象同一，反馈回路并不独立。
- **制度同构**：抄了航天流程的**形式**（基线、评审会、双五条），缺了它的**功能**（真实组织、权限、发布列车）。
- **未裁剪的质量成本**：所有变更一套 8 镜头 × 7 步 × 5 轮，实测 6× token、13× 时间。
- **计划先于实证**：100 个任务、0 个 DONE、0 次 pilot、0 组消融。

## 3. 它是什么 / 不是什么

| 是 | 不是 |
|---|---|
| DSH 原生插件（bundle + tools + skills + prompt section） | MCP server、多宿主适配层 |
| 交付回执（receipt）的生成与校验协议 | 工作流引擎 / 事件溯源运行时 |
| 风险分级（L0/L1/L2）的裁剪规则 | 对所有变更一视同仁的重流程 |
| 证据**引用**者（CI/工具产生，插件只读） | 证据**生产者**（agent 自证） |
| 对象辨识、假设台账、综合集成评审、再评估四个机制 | CCB / RBAC / 组织模拟 / 发布列车 |
| 钱学森判据 + 航天实践机制（归属分明） | 「钱学森方法的产品化」这种叙事 |

## 4. 四个机制 + 两横切 + 一测量层（v1 范围）

```
        ┌────────────── 外部证据回执（横切）──────────────┐
        │   CI / 工具产生证据 → 插件只读校验 → 拒绝自签   │
        └────────────────────────────────────────────────┘

  ① 对象辨识门        ② 假设台账        ③ 综合集成评审       ④ 再评估
  层次可还原？        经验性假设         多源证据+独立席位     解答有时效
  OCG → 禁止分解      → 检测方式         → 异议穷尽收敛       → 过期即阻断
  落到工具/自治等级   → 证据指针         → 轮次台账           → 调度触发
        │                  │                  │                  │
        └────────── 人签（横切）：决策点强制人工，agent 自签恒为 0 ──────────┘

                 测量层：受控变量（WIP/lead time/逃逸缺陷/返工）+ 周级 SPC
```

## 5. 文档地图

| 文件 | 作用 |
|---|---|
| **[DEVELOPMENT-PLAN.md](DEVELOPMENT-PLAN.md)** | **主开发规划**：目标、规模约束、架构、领域模型、7 个工具、集成、WBS、M0–M5、验收、风险 |
| [docs/SCALE.md](docs/SCALE.md) | 百万行规模机制：作用域上移、影响分析、评审吞吐、成本模型、推广 |
| [docs/SCALE-BASELINE.md](docs/SCALE-BASELINE.md) | M0/T0.9 规模基线：目标仓测量、与 §2 假设的偏差和调整 |
| [docs/THESIS.md](docs/THESIS.md) | 问题诊断与设计原则（为什么是这四个机制） |
| [docs/QIAN-LANDING.md](docs/QIAN-LANDING.md) | 钱学森精髓落地矩阵：原文判据 → DSH 机制 → 可测信号 → 证伪条件 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | DSH 原生架构、7 个工具、工件、回执契约、分级、守卫 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 里程碑验收、预注册指标、准实验与消融、停止规则 |
| [docs/MIGRATION.md](docs/MIGRATION.md) | 从 V5 迁移什么、删什么、怎么归档 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | ADR 模板 + D1–D8 决策卡（会前草案，会上定稿） |
| [docs/PARKING-LOT.md](docs/PARKING-LOT.md) | 范围冻结缓冲区：暂缓想法与重新评估的触发条件 |
| [KICKOFF.md](KICKOFF.md) | 可选：90 分钟开工决策会（定 D1–D8） |
| [plan/M0-TASKS.md](plan/M0-TASKS.md) | M0（2 周）任务与验收 |
| [plan/WBS.md](plan/WBS.md) | 9 个工作流、40+ 任务、依赖与里程碑映射 |
| [reference/qian/](reference/qian/README.md) | 四卷原文的抽取脚本、SHA-256、已验证引文索引 |

## 6. 当前状态

**M0 已完成（2026-11-06）；M1 实现完成，50-PR 试点待目标团队/仓库；M2 实现完成，10 个 L2 数据待目标团队/仓库。**

技术预演：[OpenTelemetry Collector 50-PR 预演](docs/PILOT-OTEL.md)（L0 17 / L1 15 / L2 18，unknown 0；非 M1）与 [Kubernetes 50-PR 规模预演](docs/PILOT-K8S.md)（细化后 L0 11 / L1 26 / L2 13；OWNERS 适配器已对拍，594 个 OWNERS / 0 ownerless；非 M1）。

Prow OWNERS 二进制级对拍：[docs/PROW-OWNERS-PARITY.md](docs/PROW-OWNERS-PARITY.md)；autonomous 技术模式：[docs/AUTONOMOUS-MODE.md](docs/AUTONOMOUS-MODE.md)；5 个 L2 规则一致性审计：[docs/L2-ADJUDICATION.md](docs/L2-ADJUDICATION.md)；100 PR 技术证据：[docs/PILOT-EVIDENCE.md](docs/PILOT-EVIDENCE.md)（99 个 A2：49 OTel coverage + 50 K8s JUnit；1 个 A1）。

本仓库现在有：可安装/卸载的 DSH 骨架（7 个工具 + 6 个技能占位）、短 prompt section、四个 M0 schema（含 correctness case v0）加 M1/M2 dossier/assessment/hypotheses/review/synthesis schema、L0/L1/L2 样例、冻结的 `metrics-v0`、风险/红队、迁移删除清单、规模基线与 [plan/STATUS.md](plan/STATUS.md)。7 个工具均已本地实现；真实 M1 试点与 M2 的 10 个 L2 数据仍待目标团队/仓库。

主要证据：[plan/STATUS.md](plan/STATUS.md)、[plan/M1-STATUS.md](plan/M1-STATUS.md)、[plan/M2-STATUS.md](plan/M2-STATUS.md)、[schemas/README.md](schemas/README.md)、[docs/SCALE-BASELINE.md](docs/SCALE-BASELINE.md)。下一步：autonomous 技术轨道可继续（A2 上限，不签人、不声称完成）；governed M1/M2 仍需目标团队/仓库与人类签字。M0 不构成百万行规模验证：基线在文件数与 PR 量上低于 §2 假设 >2×。

## 7. 硬规则（任何阶段不得违反）

1. **一个机制，必须能改变一次工具调用、产生一个可测信号、拒绝一次不合规交付；否则只进文档，不进代码。**
2. **证据生产者不能是被审计的 agent；签字人不能是 agent。**
3. **每个机制必须有证伪条件；没有证伪条件的设计不进 v1。**
4. **钱学森原文 / 航天实践 / FireTree 扩展三者归属不得混淆。**
5. **没有 pilot 与消融数据，不得扩大机制集合。**
6. **不重造宿主已有的东西**（事件日志、权限、调度、技能注册、子代理）。

## 8. 许可与归属

- 方法论与代码：待定（建议 Apache-2.0，与 DSH 生态一致）。
- 继承来源：`bmad-code-org/BMAD-METHOD`（MIT）、`obra/superpowers`（MIT）——保留 NOTICE 与出处。
- 钱学森四卷原文**不随仓库分发**；`reference/qian/` 只保存 SHA-256、抽取方法、短引文与出处。
