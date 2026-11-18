# FireTree-DSH 修复与真实部署计划（2026-11-18）

> **基线**：`8550599`（工作区 clean）；前置审计见 [AUDIT-2026-11-18.md](AUDIT-2026-11-18.md)。
> **目标**：让项目从“可演示的协议原型”变成“能安装、能运行、能被外部验证、能在真实仓库上持续工作”的 v0.1.0。
> **周期**：12 周（可并行压缩到 10 周，但不建议再短）。
> **原则**：先让主张为真，再让覆盖变全；先修信任根，再扩机制；先 shadow，再 enforce。
> **本文件性质**：计划，不是实现；不修改任何代码。所有施工项必须来自 §3 诊断卡，诊断卡未完成“三问”的不进入 §5。

---

## 0. 一页摘要

### 0.1 诊断回顾

审计结论：**约 5.0/10，高级原型 / M2 功能面完成，但审计语义未完成。** 三个 P0：

1. L0 governed 回执在契约层不可生成；
2. 人签、证据生产者、A2 等级都是自述标签；
3. 变更文件集自述，且同一 change 可重评估降级。

十一个 P1 的核心是：unknown 契约矛盾、policy 装饰化、分级启发式误判、正确性论证未连证据、评审未绑定 diff、证据语义未强制、state/测量层缺失、L1 人签未强制、文档漂移、工程化/发布缺口。

### 0.2 修复论点

> **不要加第八个工具。先把已有七个工具的主张变成真的。**

三个转变：

| 从 | 到 |
|---|---|
| 自述标签（`human`/`ci:`/`A2`） | 外部信任根（CI OIDC + 签名/声明 + 人签审批 + 不可变证据库） |
| 可变工件（同一 change 覆盖） | 不可变 change revision + diff/tree hash + 事件链 |
| 字段即机制（policy/intent/dossier/registry 死字段） | 决策点（PDP/PEP）+ 证据解析 + 状态/指标投影 |

### 0.3 不做什么（范围冻结）

- 不新增工具；保持 7 个工具。
- 不做多宿主、不做 UI、不做组织仿真、不做自研工作流/调度器。
- 不把 `classify`/`synthesize` 升级为门禁；v0.1 中它们是**记录型/咨询型**，除非数据证明它们改变决定。
- 不追求“零缺陷”或“数学证明”；只追求**可验证的交付声明**。
- 不在没有 OIDC 的环境里声称 A2/A3；本地只能是 A0/A1。
- 不为了达到 L2 ≤15% 而把 L2 误降级；先调触发器，再调配额，最后才谈目标。

### 0.4 交付目标（v0.1.0）

| 交付 | 验收 |
|---|---|
| DSH bundle 可安装 | `install_bundle` → applied；7 工具、6 技能在 live profile 可见；smoke 7/7 |
| 契约自洽 | L0/L1/L2 全部有端到端测试；unknown-only 可生成回执；重评估降级被拒 |
| 可信根 | A2 必须有 CI OIDC 声明；A3 必须有人类审批 + artifact attestation；0 个未验证 A2 被接受 |
| 不可变 | 每个 receipt 绑定 assessment/diff/tree/evidence digest；事件链可复验 |
| 证据真实 | JUnit/SARIF/SBOM/coverage 用标准解析与策略检查；0 个空 SBOM/伪造 tests 通过 |
| 可运维 | 每周 metrics 报告；state 过期/阻塞真实；runbook/回滚/密钥轮换齐备 |
| 真试点 | 本仓 + 1 个外部代码仓、1 个外部团队、≥100 PR、4 周；误拦 <2%；L2 经校准后 ≤15% 或有书面例外 |
| 可审计 | 外部验证者用 `firetree-check --bundle` 离线复验，不依赖 agent 的本地文件 |

### 0.5 已决策的 9 个决策（2026-11-18）

最终决策记录见 [REPAIR-DECISIONS-2026-11-18.md](REPAIR-DECISIONS-2026-11-18.md)。要点：GitHub Actions OIDC + PR review 为参考信任根（DSH approval 因当前 policy=never 仅可选）；外部不可变证据库为权威；自研 JSON policy 编译器；L0 默认无评审、10% 人类抽检；本仓 + 1 个外部代码仓试点；隔离引入维护良好的 XML 解析器；干净 v1 + 迁移；12 周 2.5–3 FTE；**classify/synthesize 在 v0.1 降级为 advisory（不作为 L2 门禁）**。

---

## 1. 上帝视角：系统、参与者、约束

### 1.1 信任域

| 域 | 谁能写 | 信任级别 | 典型内容 | 验证方式 |
|---|---|---|---|---|
| A 工作区 | agent / 开发者 | **不可信** | 源码、`.firetree` 草案、本地证据副本 | 只能作为输入；不作为证明 |
| B CI 执行 | CI 平台 | **可信执行** | git diff、测试/扫描、OIDC token、证据生成 | OIDC claims + 产物 digest |
| C 验证器 | 平台/安全团队 | **可信** | `firetree-check`、policy、verifier | 受保护分支上的固定版本 |
| D 证据库 | CI/制品库 | **不可变** | 证据 bundle、attestation、receipt | 内容寻址 + 保留锁 + 可选透明日志 |
| E 人工审批 | 人 | **可信但会犯错** | GitHub review（主）/ DSH approval（仅当 policy=ask） | 身份 claims + 审批记录 |
| F 策略仓 | 平台/架构 | **受保护** | policy、CODEOWNERS、分支保护 | 代码评审 + 签名/保护规则 |

**关键**：A 区的一切都可以被 agent 重写；因此**任何只存在于 A 区的“证明”都不成立**。插件在 A 区只做“草案/投影”；证明必须来自 B/D/E。

### 1.2 参与者与激励

| 参与者 | 想要 | 可能的行为 | 设计对策 |
|---|---|---|---|
| Agent | 尽快“完成” | 自述 human、抄 CI 日志、把代码放进 test/docs 目录 | 身份/证据外部化；路径启发式收窄；事件审计 |
| 作者 | 快速合并 | 拆小 PR、绕过 L2、找例外 | 低误拦、清晰分级、例外可见 |
| 评审人 | 少加班 | 橡皮图章、只看摘要 | L2 稀疏、风险抽样、等待时长指标 |
| 平台 | 控制与稳定 | 加字段/加检查 | 字段审计、决策点、SLO |
| 安全/审计 | 可验证 | 要求签名/留痕 | A2/A3、证据库、离线 bundle |
| 组织 | 吞吐与质量 | 用 LOC/发现数考核 | 预注册指标、禁止指标、SPC |
| DSH 宿主 | 稳定 API | 版本漂移 | 锁版本、适配层、契约测试 |
| CI/SCM | 可信执行/身份 | 配置漂移 | OIDC、受保护 workflow、分支保护 |

### 1.3 系统原型（Senge）

| 原型 | 在本项目中的表现 | 如果不处理 |
|---|---|---|
| **Fixes that Fail** | 加字段/加评审步骤，暂时安抚审计，但不改变证据来源 | 保证系统膨胀，重演 V5 |
| **Shifting the Burden** | 用插件替代测试/评审文化 | 工具越重，工程越弱 |
| **Limits to Growth** | L2 评审容量是瓶颈，L2 占比 26–36% | 队列爆炸、团队绕过 |
| **Eroding Goals** | 为达 ≤15% 把 L2 误降级 | 风险上升，指标失真 |
| **Escalation** | agent 找绕过，平台加检查 | 军备竞赛，成本上升 |
| **Success to the Successful** | 试点团队获得全部支持 | 推广失败，数据过拟合 |

### 1.4 约束与不变量

- **I1**：agent 不能是证据生产者或签字人——由**身份**保证，不由字符串保证。
- **I2**：任何接受/拒绝都必须绑定不可变 change digest（tree/diff/assessment）。
- **I3**：证据必须能从一个离线 bundle 复验，不依赖 agent 的本地文件。
- **I4**：不允许静默降级；每次 tier 变化必须有 reason code 和事件。
- **I5**：policy 决策可由 `policy_digest + inputs` 复现。
- **I6**：未知即 fail-closed，但“未知”必须是一等公民，不能导致契约死锁。
- **I7**：工件不含代码内容、密钥、PII；只存 id/路径/hash/结论。
- **I8**：核心零外部依赖；网络只出现在 CI/证据适配器。
- **I9**：v0.1 只支持 DSH；核心可移植。
- **I10**：每条对外主张都有 `status: implemented|partial|planned` 与验证命令。

### 1.5 目标架构

```
┌────────────────────────────────────────────────────────────────────┐
│ F 策略/治理：policy.json (digest) · CODEOWNERS · branch protection │
├────────────────────────────────────────────────────────────────────┤
│ E 人工审批：GitHub review（主）/ DSH approval（可选）/ 签字记录      │
├────────────────────────────────────────────────────────────────────┤
│ D 证据库：content-addressed bundle · 保留锁 · 可选 Rekor/透明日志   │
├────────────────────────────────────────────────────────────────────┤
│ C 验证器：firetree-check（受保护分支固定版本）                       │
│    - 验 OIDC claims / attestation / digest / policy / evidence     │
│    - 派生 assurance A0–A3；输出机器可读 decision                   │
├────────────────────────────────────────────────────────────────────┤
│ B CI：git diff → assess → tests/scans → evidence → receipt → sign  │
│    - OIDC id-token；受保护 workflow；artifact upload                │
├────────────────────────────────────────────────────────────────────┤
│ A DSH 插件：7 工具 + 技能 + prompt；只写草案/投影，不写“证明”      │
└────────────────────────────────────────────────────────────────────┘
          ▲ 事件/指标：events.jsonl（hash chain）→ 周聚合 → SPC/告警
          ▲ 再评估：schedule / CI cron → state → 阻断/提醒
```

### 1.6 保证等级（派生，不是输入）

| 等级 | 定义 | 必需外部锚 | 可用场景 |
|---|---|---|---|
| **A0** | 自述，无验证 | 无 | 本地草稿；不得声称交付 |
| **A1** | 本地确定性证据 + hash/解析 | 本地工具/文件 | 本地开发、离线演示 |
| **A2** | CI OIDC 验证 + CI 产生证据 + git diff | OIDC claims + CI run + artifact digest | 常规 CI gate |
| **A3** | A2 + 验证过的人类审批 + 签名 receipt | OIDC + approval + Sigstore/签名 | L2、对外审计 |

`assurance` 由 verifier 计算并写入 receipt；**不再接受调用方输入**。本地模式最多 A1；L2 governed 需要 A3。

### 1.7 “真实运行”的定义

- **D1 可安装**：profile 安装后 7 工具/6 技能可见，smoke 通过，重启后仍可用。
- **D2 可运行**：至少 1 个真实仓库的 CI 以 `shadow → warn → enforce` 跑满 4 周；每个 PR 有 assessment，L1/L2 有 receipt/technical evidence；每周有 metrics。
- **D3 可审计**：外部验证者在没有 agent 本地文件的情况下，用 `firetree-check --bundle` + OIDC/签名复验 receipt；抽样 20 个变更 100% 通过。

---

## 2. 强制追问法（施工前的门）

对 §3 的每个问题，先按固定格式回答；**没有回答完的，不允许进入 §5 代码施工**。

> **强制追问（原文）**
> 1. **这属于什么经典问题或变体？** 命名它，给出定义，指出本项目的具体表现。
> 2. **有什么优秀的解决方案？** 至少两个业界方案，写清代价/前提。
> 3. **本项目选哪个？为什么？** 写清取舍、验证方式、回滚方式。

规则：

- 每个问题至少两个候选方案；只写一个方案视为未完成。
- 每个选择必须有一个**可执行验收**；没有验收的选择不落盘。
- 每个选择必须写**不做什么**，防止范围膨胀。
- 每个选择必须有**失效条件**（什么数据会让我们反悔）。
- 诊断卡编号（P-01…）与工作包（WP0…）双向可追溯。

---

## 3. 问题诊断卡

> 说明：每张卡先回答“经典问题/优秀方案”，再给“本项目落盘”。卡内引用文件均为当前仓库路径。

### A. 契约与状态机

#### P-01 L0 governed 回执不可生成

- **现象/证据**：`schemas/receipt.schema.json:18,97–100` 要求 `review` 为对象；`src/tools/receipt.js:469,471` 对 L0 写 `review: null`；`src/tools/review.js:281` 拒绝 L0；`src/tools/assess.js:17` 却要求 `light_review`。实测 `schema $.review: must be object, got null`。
- **强制追问：这属于什么经典问题/变体？**
  - 不可达状态（unreachable state）/ 契约死锁；
  - 规格与实现独立演化（spec-code divergence）；
  - 空值语义缺失（no null in a closed-world schema）。
- **优秀方案**：
  1. 显式状态机 + 决策表（tier × mode × review requirement），由一张表生成 schema 条件与工具分支；
  2. schema 与代码同源/代码生成（JSON Schema → validator/types），避免手写两套；
  3. 模型检查（TLA+/Alloy）或属性测试枚举 `(tier, review, sampling, assurance)` 组合，证明无不可达/无矛盾；
  4. 合同测试：每个 tier 一组 build/check fixture，CI 必跑。
- **本项目选择**：状态机表 + schema 条件 + 合同矩阵。L0 的 `review` 允许 `null`；L1/L2 强制对象；L0 被采样（`sampling.selected`）时要求**人类 spot-check**（GitHub review；DSH approval 仅当 policy=ask），由 `firetree_review` 记录 `light` 模式，但**必须由人类触发/确认，不允许 agent 自写“轻评审”**。没有人类时，L0 只能产出 A1/A2 技术证据，不能声称 governed 完成。删除 `REQUIRED_ARTIFACTS.L0.light_review` 的无条件要求，改成条件。
- **落盘**：
  - `schemas/receipt.schema.json`：`review` → `oneOf [null, object]`；L1/L2 的 allOf 强制 object；L0 + sampled 强制 `review.mode=light` 且带 `human_spot_check`；`review.mode` 枚举 `light|standard|full`。
  - `src/tools/review.js`：`assessmentFor` 允许 L0；`open` 增加 `light: true`；`round` 上限 1；`verdict` 允许 3 步、无 signoff；要求调用方提供人类审批引用；`tier` 输出支持 L0。
  - `src/tools/receipt.js`：L0 分支根据 `assessment.sampling.selected` 读取/不读取人类 spot-check；不再把 null 写进强制对象。
  - `src/tools/assess.js`：`required_artifacts` 按 tier + sampling 动态生成。
  - 测试：新增 `test/tier-matrix.test.mjs`，枚举 L0/L1/L2 × sampled/not × review null/light/standard/full，断言 schema 与 build/check 一致；agent 伪造 light review 必须红。
- **验收**：L0 未采样 build/check 绿；L0 采样缺人类 spot-check 红；L0 采样有人类 spot-check 绿；agent 自写 light review 红；L1/L2 缺 review 红；所有 fixture 通过。
- **不做什么**：不把 L0 也强制人签；不给 L0 增加七步。

#### P-02 unknown→L2 与回执契约冲突

- **现象/证据**：`src/lib/impact.js` 对未匹配路径写 `unknown`，`subsystems` 可为空；`schemas/receipt.schema.json:158–174` 要求 `subsystems`/`owners` ≥1；receipt 的 `impact` 不含 `unknown`。实测 schema 报 `must have at least 1 items`。
- **强制追问：这属于什么经典问题/变体？**
  - 开放世界 vs 封闭世界（open-world assumption）；
  - 表示缺口（representational gap）：契约无法表达“不知道”；
  - 空集语义（empty set semantics）与 total function。
- **优秀方案**：
  1. 把 unknown 做成一等公民（显式数组/原因码），允许相关集合为空；
  2. 用 sum type/optional 表达“已分类/未分类”，而不是用空字符串伪装；
  3. 属性测试：对任意文件集，assessment 与 receipt 都能表达（total）；
  4. 契约测试：unknown-only、mixed、known-only 三组 fixture。
- **本项目选择**：receipt 的 `impact` 增加 `unknown[]`、`unresolved_consumers[]`、`reasons[]`；L2 允许 `subsystems`/`owners` 为空，但要求 `unknown` 非空或 `traversed=false`；L0/L1 仍要求 subsystems/owners 非空。回执必须能解释“为什么 L2”。
- **落盘**：schema、`analyzeImpact` 输出、receipt 组装、state 投影、`schemas/README` 说明；测试 unknown-only/mixed。
- **验收**：unknown-only L2 build/check 绿；known L2 仍绿；L0/L1 空 subsystems 红；回执可读地列出 unknown。
- **不做什么**：不引入“unclassified 伪子系统”（会掩盖未知）。

#### P-03 policy 装饰化

- **现象/证据**：`src/lib/registry.js:40–53` 只读单文件；`triggers/extends/exceptions/inheritance/token_budget/review_rounds/correctness_case` 无消费者；fixtures 的 `version` 与实际 SHA-256 不匹配。
- **强制追问：这属于什么经典问题/变体？**
  - 策略决策点（PDP）与执行点（PEP）未分离；
  - 死配置/配置漂移（dead configuration）；
  - “策略即代码”缺少编译/求值/日志；
  - 字段即机制（speculative generality）。
- **优秀方案**：
  1. OPA/Rego、Cedar 等成熟 PDP：策略语言、决策日志、测试框架、增量；
  2. 自研 JSON 规则编译器：领域小、零依赖、可嵌入 DSH；需要自己写测试/日志；
  3. GitOps + policy digest + 变更评审；配置 lint 防死字段。
- **本项目选择**：自研 JSON policy 编译器（零依赖），保留 OPA 适配器接口作为可选；实现 `resolve(extends, tighten-only)`、`evaluate(triggers, exceptions, context)`、`digest`、`decision_log`。**未被实现的字段删除**，不再留在 schema 里当装饰。
- **落盘**：
  - `src/lib/policy.js`：`loadPolicy` 递归父策略、合并、计算 `digest`；`evaluatePolicy(context) -> {tier, reasons, artifacts, signoff, sampling, review_rounds, correctness_case, policy_digest}`。
  - `schemas/policy.schema.json`：triggers 结构化（`id/when/tier/reason`）；exceptions 带 scope/expiry/approver；version 改为 `digest`（派生；写入时校验）。
  - `src/tools/assess.js`：删除硬编码 `REQUIRED_ARTIFACTS`，改用 policy 决策；tier 由 impact + triggers 共同决定。
  - `src/lib/registry.js`：policy 继承链加载；错误信息含路径。
  - `src/tools/state.js` / `review.js`：从 policy 读 review_rounds/correctness_case。
  - 测试：继承 tighten-only、放松必须 exception、例外过期不生效、triggers 改变 tier、policy digest 稳定。
- **验收**：同一 change 在两个 policy 下 tier 不同且理由可读；fixtures version = 实际 digest；未使用字段为 0（schema lint）。
- **不做什么**：不引入 OPA 作为硬依赖；不实现完整策略语言。

#### P-04 schema 校验器静默忽略未知关键字

- **现象/证据**：`src/lib/schema.js` 只处理已知关键字；`patternProperties/propertyNames/contains/dependentRequired/exclusiveMinimum/multipleOf/format:uri` 会被忽略；没有 schema lint。
- **强制追问：这属于什么经典问题/变体？**
  - fail-open 配置（silent misconfiguration）；
  - schema 一致性/元校验（metaschema validation）；
  - 解析器差异（parser differential）。
- **优秀方案**：
  1. 用完整 JSON Schema 校验器（Ajv）并开启 strict；
  2. 自研 linter：遍历 schema，拒绝不在支持列表的关键字；
  3. JSON Schema metaschema 校验 + CI 门禁；
  4. 代码生成 types/validator，减少手写。
- **本项目选择**：保持零依赖校验器，但加 `scripts/lint-schemas.mjs`：白名单关键字、检查 `$ref` 可解析、`required` 字段在 `properties` 中存在、`enum`/`const` 类型一致、`if/then` 结构合法；CI 必跑。未来可选 Ajv 作为测试期 devDependency。
- **落盘**：`scripts/lint-schemas.mjs`、`npm run lint:schemas`、CI step、`test/schema-lint.test.mjs`。
- **验收**：故意加入 `patternProperties` 的 schema 必须失败；现有 11 个 schema 全绿。
- **不做什么**：不在生产校验器里实现全部 JSON Schema。

#### P-05 schema/工件版本与迁移

- **现象/证据**：所有工件 `schema` 为 v0；没有迁移/兼容矩阵；`CONTRIBUTING`/release 流程缺失。
- **强制追问：这属于什么经典问题/变体？**
  - schema 演化（schema evolution）；
  - 破坏性变更/向后兼容；
  - 数据迁移（expand-contract / dual-write）；
  - 语义化版本与审计证据的长期可读性。
- **优秀方案**：
  1. schema registry + 兼容性检查（BACKWARD/FORWARD）；
  2. expand-contract：先加字段、双读、再删；
  3. 版本化事件与迁移脚本；
  4. v0→v1 一次性迁移 + 保留 v0 fixtures 作为回归。
- **本项目选择**：由于尚未生产使用，采用**干净 v1 断代 + 迁移脚本**：`schemas/` 全部 bump 到 v1；`scripts/migrate-v0-to-v1.mjs` 转换旧 receipts/assessments；保留 v0 fixtures 作为“旧工件可读/可拒绝”测试；`docs/COMPATIBILITY.md` 列矩阵。
- **落盘**：schema 字符串、migration 脚本、`docs/COMPATIBILITY.md`、release checklist。
- **验收**：v0 fixture 能被迁移脚本转换；v1 工具拒绝 v0 工件并给出迁移提示；迁移幂等。
- **不做什么**：不做双写；v0 不再产生新工件。

### B. 信任根与身份

#### P-06 自证困境：人签、producer、A2 都是标签

- **现象/证据**：`signoff.by` 枚举、`producer` 负向前瞻、`assurance` 自由选择；无 OIDC/审批；autonomous A2 + local 通过。
- **强制追问：这属于什么经典问题/变体？**
  - 自证/自我声明（self-attestation）；
  - 观测器与被控对象同一（cybernetics）；
  - 身份冒充（identity spoofing）/ 中间人；
  - 远程证明架构（RATS）中 Attester/Verifier/Relying Party 未分离；
  - 不可否认性（non-repudiation）。
- **优秀方案**：
  1. OIDC workload identity（GitHub Actions/GitLab CI/企业 IdP）：CI 签发可验证 claims；
  2. Sigstore keyless + in-toto/DSSE + SLSA provenance：签名/来源可离线验证；
  3. DSH approval / 企业审批：人类动作由宿主记录；
  4. 分离职责 + 透明日志（Rekor）：签字/证据可审计。
- **本项目选择**：A 阶梯。v0.1 先做 **GitHub Actions OIDC + CI 生成 evidence + verifier 派生 A2**；A3 加**GitHub PR review 审批记录 + artifact attestation**（`actions/attest-build-provenance` 的 Sigstore 签名，或 cosign；verifier 验签）。**本地只允许 A0/A1**；`assurance` 从输入改为输出。
- **落盘**：
  - `src/lib/identity.js`：OIDC claims schema/校验（iss/aud/repository/workflow_ref/ref/sha/actor/event）；mock 测试。
  - `src/lib/assurance.js`：`deriveAssurance({claims, evidence, signoff, bundle})`。
  - `src/tools/receipt.js`：拒绝显式 `assurance` 输入；build 生成 draft；verify 时写 `assurance`。
  - `bin/firetree-check.mjs`：`--claims <json> --bundle <dir> --require A2|A3`；无 claims → A1 并拒绝 governed 定稿。
  - CI 模板：`id-token: write`；把 claims 写文件；签名可选。
  - 测试：伪造 claims/过期/错 repo/错 workflow/缺 claims/A2+local/A3 无审批。
- **验收**：A2 必须有 claims；A3 必须有人类审批 + 签名；本地 A1 不能生成 L2 receipt；`producer` 由 claims 派生，不由调用方填。
- **不做什么**：不自研 CA/PKI；不把 GitHub token 写进工件。

#### P-07 文件集自述 + 重评估降级

- **现象/证据**：`assess` 信任 `files[]`；同一 change 用子集重评估 L2→L0；磁盘覆盖。
- **强制追问：这属于什么经典问题/变体？**
  - TOCTOU（检查时与使用时不一致）；
  - 不可信输入/缺少 provenance；
  - 审计记录可变（audit trail mutability）；
  - 否认（repudiation）/版本漂移。
- **优秀方案**：
  1. git 作为单一事实源：`git diff --name-status -z` + tree hash；
  2. CI 计算 diff，agent 只消费；
  3. 不可变 revision + 内容寻址；
  4. 哈希链/透明日志（Rekor）防篡改。
- **本项目选择**：`assess` 增加 `verify_git: true`；CI 从 git 计算 files/diff/tree；assessment 按 `(change, base, head, diff_sha256)` 不可变；同一 change 不同 diff 生成 revision，不允许覆盖；receipt 绑定 assessment digest + diff/tree。
- **落盘**：
  - `src/lib/git.js`：`rev-parse`、`diff-tree/diff --name-status -z`、`cat-file`、`ls-tree`；处理 rename/delete/binary；大小上限。
  - `src/tools/assess.js`：`verify_git`；记录 `tree_sha`、`diff_sha256`；写 `revisions/<n>/assessment.json`；`latest` 指针；重复同 diff 幂等。
  - `schemas/assessment.schema.json`：新增 `git`、`revision`、`prev`。
  - `src/lib/receipt.js`：校验 receipt 的 assessment digest/diff/tree。
  - `test/git-assess.test.mjs`：临时 git 仓，rename/delete/二进制/子集重评估/并发。
- **验收**：子集重评估必须红；同 diff 幂等；rename/delete 正确；base/head 非 hex 在 governed 模式红。
- **不做什么**：不实现完整 git 对象库；不跨仓 diff（v2）。

#### P-08 评审包未绑定被审变更

- **现象/证据**：review.open 接受任意 diff/spec hash；receipt 不比较。
- **强制追问：这属于什么经典问题/变体？**
  - TOCTOU/artifact substitution；
  - 评审对象与交付对象不一致（version skew）；
  - 四人眼原则（four-eyes）失效。
- **优秀方案**：
  1. 评审绑定不可变 digest（git tree/diff + assessment）；
  2. merge queue/required check 在合并时复验；
  3. 签名 manifest / 透明日志；
  4. 评审包与变更一起归档。
- **本项目选择**：`review.open` 必填 `assessment_sha256` 与 `diff_sha256`，工具从 assessment 读取并比对；`package_sha256` 写入 package；verdict/signoff 绑定 `package_sha256`；receipt 校验三者一致。
- **落盘**：review schema/tool、receipt 校验、测试（评审后改文件必须红）。
- **验收**：diff 不匹配红；package 被改红；receipt 引用旧 package 红；正常链路绿。
- **不做什么**：不做自动 merge queue（CI 模板给建议）。

#### P-09 人签标签 + L1 不强制

- **现象/证据**：`signoff.by` 自由；L2 只查枚举；L1 可 null；policy signoff 不生效。
- **强制追问：这属于什么经典问题/变体？**
  - 认证 vs 授权；
  - 不可否认性；
  - 分离职责（SoD）；
  - 审批疲劳/橡皮图章（approval fatigue）。
- **优秀方案**：
  1. OIDC/WebAuthn/GitHub review 身份；
  2. 审批服务（DSH approval、ServiceNow、Jira）；
  3. 风险抽样 + 等待时长 + 挑战问题；
  4. 双人控制（dual control）用于高风险。
- **本项目选择**：人类签字必须来自：GitHub PR review（actor login）+ DSH approval 记录（approval id）二者之一/两者，按 policy；signoff 绑定 package/diff；L1 按 policy `peer` 强制；L2 必须 human + approval；记录 `at`、`waiting_seconds`、`scope`。
- **落盘**：`src/lib/approval.js`（DSH approval 适配器）、`identity` 中的 actor 校验；review/receipt schema；state/metrics 记录等待时长；测试。
- **验收**：L1 无 peer 红；L2 无 approval 红；approval 身份与 claims 不一致红；等待时长入 metrics。
- **不做什么**：不自研 IdP；不把“human”字符串当签字。

#### P-10 assurance 通胀

- **现象/证据**：`assurance` 输入可填；technical A2 无约束。
- **强制追问：这属于什么经典问题/变体？**
  - 信任等级混淆；
  - 等级通胀（grade inflation）；
  - 安全标签自证（security label spoofing）。
- **优秀方案**：SLSA 分级；RATS 的 Attestation Results；verifier 派生等级；每级清单。
- **本项目选择**：A0–A3 派生；`assurance` 从 schema 的输入字段改为 verifier 输出；每个等级有证据清单；不符合即降级/拒绝。
- **落盘**：schema、verifier、测试。
- **验收**：A2 缺 claims 红；A3 缺审批/签名红；A1 声称 A2 红；verifier 输出可复现。
- **不做什么**：不引入 A4/A5。

#### P-11 远程证据不打开

- **现象/证据**：`http(s)` run_ref 直接返回 null。
- **强制追问：这属于什么经典问题/变体？**
  - 未验证引用（unverified reference）；
  - 链接腐化（link rot）；
  - SSRF/网络信任边界；
  - 内容寻址 vs 位置寻址。
- **优秀方案**：
  1. 内容寻址证据库/OCI artifact；
  2. 签名 attestation，而不是 URL；
  3. 离线 bundle + digest；
  4. 若必须 fetch：allowlist、禁私网、禁重定向、超时、大小上限。
- **本项目选择**：v0.1 **不在验证时 fetch URL**；要求 `--bundle` 内的证据文件 + digest；远程 URL 只作为元数据，必须附 CI attestation。可选 `firetree-fetch` 只在 CI 内、allowlist、写 bundle。
- **落盘**：receipt/technical 的 evidence 校验改为 bundle index；新增 `src/lib/bundle.js`；测试 SSRF/重定向/大小。
- **验收**：无 bundle 的 URL 证据红；bundle digest 不一致红；离线可复验。
- **不做什么**：不做通用网络抓取器。

### C. 证据与正确性

#### P-12 证据语义/解析器弱

- **现象/证据**：JUnit 正则接受伪造 counts/标签不匹配；SARIF 不查 results；SBOM 空 components 通过；governed 不校验格式。
- **强制追问：这属于什么经典问题/变体？**
  - 解析器差异（parser differential）；
  - 弱验证/证据剧场（evidence theater）；
  - 古德哈特定律（指标成为目标）；
  - 模式演化（JUnit/SARIF/SBOM 版本）。
- **优秀方案**：
  1. 标准解析器（XML/YAML/JSON Schema）+ 版本校验；
  2. SARIF/SPDX/CycloneDX 官方 schema 校验；
  3. 策略阈值（0 failures、coverage ≥X、SARIF 无 error、SBOM 非空）；
  4. Fuzz/负例库；证据签名。
- **本项目选择**：引入一个维护良好的 XML 解析器（隔离在 `src/lib/evidence/xml.js`，可选依赖）或实现严格子集解析器；为 JUnit/SARIF/SBOM/coverage 建 adapter + policy check；governed/technical 共用；证据必须带 `subject`（commit/diff）。
- **落盘**：`src/lib/evidence/{junit,sarif,sbom,coverage}.js`；依赖决策见 §10；`test/evidence-*.test.mjs`；fixtures 增加失败样例。
- **验收**：伪造 counts 红；标签不匹配红；SBOM 空红；SARIF error 红；真实 50 JUnit 仍绿。
- **不做什么**：不做完整 SBOM 质量分析；不做漏洞扫描。

#### P-13 correctness case 证据链断裂

- **现象/证据**：`evidence_refs` 不比对 receipt evidence；假路径/假 dossier hash 通过。
- **强制追问：这属于什么经典问题/变体？**
  - 保证案例（Assurance Case）/ GSN 的 claim-argument-evidence 断裂；
  - 可追溯性（traceability）缺失；
  - 监管链（chain of custody）断裂。
- **优秀方案**：
  1. GSN/CAE 结构：goal → strategy → solution/evidence，每个 evidence 节点必须指向 digest；
  2. 需求追溯矩阵（RTM）；
  3. in-toto link/attestation 绑定 subject；
  4. 证据图校验器。
- **本项目选择**：correctness case 的 `evidence_refs` 改为 `{evidence_id, path_or_url, sha256}`；`validateCorrectnessCase` 接受 evidence index，逐条匹配；`invariant.evidence_ref` 同样；claim.owner 必须 `human:`/CODEOWNERS；residual 必须引用 claim。
- **落盘**：schema、correctness 校验、receipt、fixtures。
- **验收**：假 refs 红；dossier hash 不匹配红；正常 L2 绿。
- **不做什么**：不做形式化证明；不引入完整 GSN 编辑器。

#### P-14 accepted_risk 无入口

- **现象/证据**：receipt 写死 0；ledger 无结构；untested 永久阻断。
- **强制追问：这属于什么经典问题/变体？**
  - 风险接受/例外管理（ISO 31000）；
  - 无界阻断（unbounded blocking）；
  - 状态机缺少 transition（accept risk）。
- **优秀方案**：风险登记册 + waiver + 到期 + 人签 + 审计；policy exception；four-eyes。
- **本项目选择**：ledger 增加 `accepted_risks[]`：`{hypothesis_id, reason, accepted_by: human, approval_id, expires_at}`；receipt 校验未验证数 ≤ accepted 且未过期；state 显示即将过期；metrics 记录。
- **落盘**：schema、hypothesis 工具 `accept` 动作（或随 verify）、receipt、state、测试。
- **验收**：untested 无接受红；有 human+未过期绿；过期红；agent 接受红。
- **不做什么**：不允许批量接受；不允许永久接受。

#### P-15 interface registry 死字段

- **现象/证据**：`sha256/contract_test/depends_on` 未使用；接口基线未控。
- **强制追问：这属于什么经典问题/变体？**
  - 消费驱动契约（consumer-driven contracts）；
  - 模式注册表/基线控制；
  - 死字段/规格过度（speculative generality）。
- **优秀方案**：Pact/契约测试；schema registry；semver；接口 hash 校验；反向依赖遍历。
- **本项目选择**：v0.1 先实现 **接口 hash 校验 + contract_test 执行入口 + depends_on 反向遍历**；若数据证明无用，再删除字段。接口变更仍 L2。
- **落盘**：`src/lib/interface.js`、assess/impact、CI template；测试。
- **验收**：接口文件 hash 不匹配红；contract test 失败红；depends_on 循环处理。
- **不做什么**：不实现 Pact broker；不自动生成接口。

### D. 运维、并发与工程化

#### P-16 state/测量层缺失

- **现象/证据**：expiring/blocked 恒 0；无 events/metrics；无 re-eval。
- **强制追问：这属于什么经典问题/变体？**
  - CQRS/事件溯源投影未实现；
  - 可观测性缺口（observability gap）；
  - 控制回路缺失（no feedback）。
- **优秀方案**：append-only events + projections；OpenTelemetry；SPC/error budget；schedule/cron。
- **本项目选择**：`.firetree/events.jsonl` 哈希链；`firetree_state` 从事件投影；`scripts/metrics.mjs` 周聚合；DSH `schedule`/CI cron 做 re-eval；SLO 告警。
- **落盘**：`src/lib/events.js`、state、metrics 脚本、schedule 模板、测试。
- **验收**：expiring/blocked 非 0；事件链可复验；周报生成；过期提醒。
- **不做什么**：不自研调度器；不做实时大屏。

#### P-17 并发丢更新

- **现象/证据**：ledger/rounds 读改写；无锁。
- **强制追问：这属于什么经典问题/变体？**
  - lost update/read-modify-write race；
  - 乐观并发控制缺失；
  - 非原子事务。
- **优秀方案**：文件锁/`open wx`；CAS/version；append-only 事件；SQLite WAL；outbox。
- **本项目选择**：v0.1 用 per-change 锁文件 + append-only events；读模型从事件重建；工具写事件而非覆盖状态；失败重试。
- **落盘**：`src/lib/lock.js`、events、hypothesis/review/synthesize 写路径；并发测试。
- **验收**：两进程并发 add/round 不丢；锁超时红；崩溃后恢复。
- **不做什么**：不引入数据库（v0.1）。

#### P-18 OWNERS/CODEOWNERS 解析与性能

- **现象/证据**：inline list 不支持；全树遍历；raw regex；字符类缺失。
- **强制追问：这属于什么经典问题/变体？**
  - 解析器差异/子集实现；
  - ReDoS；
  - O(N) I/O per request / 缺少缓存；
  - 缓存失效。
- **优秀方案**：标准 YAML parser；safe-regex/timeout；索引/缓存；增量扫描；CODEOWNERS 优先。
- **本项目选择**：支持 inline list/引号/#；正则超时；按 mtime 缓存；优先 CODEOWNERS；对 K8s 级别全树 walk 提供 `--owners-index` 预生成。
- **落盘**：owners/codeowners、cache、tests。
- **验收**：inline list 正确；ReDoS 不挂；10k 文件 <1s？给出测量；594 OWNERS 仍 8/8。
- **不做什么**：不实现完整 Kubernetes OWNERS 规范。

#### P-19 文档漂移

- **现象/证据**：ARCHITECTURE 树/guard/metrics 不存在；状态计数过期；AUTONOMOUS/PILOT 结论过期。
- **强制追问：这属于什么经典问题/变体？**
  - 文档腐化（documentation rot）；
  - 单一事实源缺失；
  - 声称与证据不一致（claims-evidence mismatch）。
- **优秀方案**：docs-as-code；生成表；claims matrix + 测试；ADR 状态；发布检查。
- **本项目选择**：新增 `docs/CLAIMS.md`（每条主张 + status + test/command）；测试解析并拒绝 `implemented` 无测试；重写 ARCHITECTURE；把 aspirational 标 `planned`；状态文件统一日期。
- **落盘**：docs、test、check-docs 扩展。
- **验收**：CLAIMS 无悬空 implemented；docs check 全绿；审计报告中的漂移项消除。
- **不做什么**：不追求文档全覆盖；只保证“主张可追溯”。

#### P-20 发布/CI/许可证

- **现象/证据**：唯一 workflow 是 Prow parity；无 LICENSE/NOTICE；0.0.0；files 缺 README/docs；未安装。
- **强制追问：这属于什么经典问题/变体？**
  - 发布工程/供应链（release engineering）；
  - 合规（license/NOTICE）；
  - 总线因子（bus factor）。
- **优秀方案**：CI 矩阵；SLSA/npm provenance；REUSE/SPDX；semver；release checklist；CODEOWNERS。
- **本项目选择**：加 `ci.yml`（Ubuntu+Windows：test/docs/syntax/schema-lint）；Apache-2.0 LICENSE + NOTICE；version 0.1.0；engines >=20；files 修正；发布 checklist；install smoke。
- **落盘**：workflow、LICENSE/NOTICE、package.json、docs、release script。
- **验收**：CI 全绿；`npm pack` 内容正确；安装 smoke 通过。
- **不做什么**：不做多包 monorepo。

#### P-21 DSH 生命周期/API 漂移

- **现象/证据**：apply 无 cleanup；当前 profile 未安装；DSH 0.2.2-rc.3；参数描述少。
- **强制追问：这属于什么经典问题/变体？**
  - 宿主契约漂移（host contract drift）；
  - 资源生命周期泄漏；
  - 适配器模式/feature detection。
- **优秀方案**：锁版本；契约测试；`ctx.effect`；Config schema；install smoke；兼容矩阵。
- **本项目选择**：pin DSH 0.2.2-rc.3；apply 用 `ctx.effect` 注册/清理；加 `Config`（可选）；`files`/locale detail；CI 用 fake ctx + 真 profile smoke；DSH 升级 checklist。
- **落盘**：index.js、package.json、test、docs。
- **验收**：禁用/重载无残留；7 工具可见；技能可见；升级测试。
- **不做什么**：不做多宿主适配层。

### E. 经济、分级与采用

#### P-22 L2 容量与 ≤15% 目标

- **现象/证据**：试点 L2 26–36%；目标 ≤15%；无 WIP/例外/配额。
- **强制追问：这属于什么经典问题/变体？**
  - 瓶颈/排队论（Little's law）；
  - 容量规划；
  - Goodhart/目标侵蚀。
- **优秀方案**：WIP 限制；风险分级校准；采样；例外；队列；SLO；容量模型。
- **本项目选择**：先用 shadow 数据校准 triggers；把 dependency/config 从“一律 L2”调整为“按影响”；L2 配额/WIP；例外带到期；不为了指标降级；季度复盘。
- **落盘**：policy triggers、metrics、runbook、pilot。
- **验收**：L2 比例与目标差距有解释；排队时延可见；例外率 <5%。
- **不做什么**：不把 L2 改 L1 来达标。

#### P-23 橡皮图章

- **现象/证据**：签字无等待时长/质量指标。
- **强制追问：这属于什么经典问题/变体？**
  - 审批疲劳/仪式化；
  - Goodhart；
  - 双人控制失效。
- **优秀方案**：风险抽样；等待时长/挑战问题；抽查；双人控制；审批质量指标。
- **本项目选择**：记录 `waiting_seconds`、approval scope、challenge；抽样 10% 人工审计；<10s 且 100% 批准告警；L2 高-risk 双人。
- **落盘**：approval/events/metrics；测试。
- **验收**：橡皮图章率可见；抽样报告；告警触发。
- **不做什么**：不做“点击即签”的假审批。

#### P-24 分级误判（L0 过宽）

- **现象/证据**：config/.env/docs 下代码/test 目录代码 L0。
- **强制追问：这属于什么经典问题/变体？**
  - 假阴性/误分类；
  - 纯路径启发式；
  - 威胁建模缺失。
- **优秀方案**：内容感知 diff；敏感配置清单；风险矩阵；历史事故校准；CODEOWNERS。
- **本项目选择**：L0 收窄到纯文档/纯测试/非运行配置；`.env`/CI/服务配置/任何代码至少 L1；用 git diff 行数；对“代码在 test/docs”告警；policy 可加严。
- **落盘**：impact/policy、fixtures、tests。
- **验收**：四个已知误判全部 ≥L1；正常 docs 仍 L0；L0 误拦 <2%。
- **不做什么**：不做 ML 分类。

#### P-25 采用/自用

- **现象/证据**：仓库无 `.firetree` 自用；本仓 + 外部仓试点未开始。
- **强制追问：这属于什么经典问题/变体？**
  - 创新扩散/鸡生蛋；
  - 不吃自己的狗粮（dogfooding）；
  - 委托-代理/激励错配。
- **优秀方案**：golden path；champion；内部试点；bootstrap；价值度量。
- **本项目选择**：先在本仓 dogfood（docs-only/L0 也要 receipt）；再 2 个试点仓；golden path 模板；培训；例外。
- **落盘**：bootstrap 脚本、templates、docs、pilot。
- **验收**：本仓 20 PR 走协议；试点 100 PR；≥80% 采纳。
- **不做什么**：不强制全组织。

#### P-26 无测量/消融

- **现象/证据**：无 events；无 A/B/C/D；指标不可计算。
- **强制追问：这属于什么经典问题/变体？**
  - 实验设计/混杂；
  - 预注册/多重比较；
  - 统计功效不足。
- **优秀方案**：预注册；匹配对；中断时间序列；bootstrap CI；SPC；A/B/C/D。
- **本项目选择**：events + baseline；shadow 2 周；enforce 2 周；匹配子系统；只报方向性；不做强因果。
- **落盘**：events/metrics、pilot 报告模板。
- **验收**：周报；效应量/CI；停止规则。
- **不做什么**：不把 pilot 当 RCT。

### F. 部署与运营

#### P-27 上线方式

- **现象/证据**：当前未安装；无 rollout 方案。
- **强制追问：这属于什么经典问题/变体？**
  - 大爆炸上线风险；
  - 金丝雀/影子/特性开关；
  - 蓝绿/strangler。
- **优秀方案**：shadow → warn → enforce；per-repo canary；kill switch；rollback。
- **本项目选择**：2 周 shadow（只记录不阻断）→ 2 周 warn（警告）→ enforce；policy `enforcement: off|warn|enforce`；按 repo 灰度；保留上一插件版本。
- **落盘**：policy、check、runbook、pilot。
- **验收**：shadow 无误拦；warn 可见；enforce 可回滚。
- **不做什么**：不直接全仓 enforce。

#### P-28 注册表冷启动

- **现象/证据**：目标仓 0 注册表；unknown 会 L2。
- **强制追问：这属于什么经典问题/变体？**
  - 冷启动/覆盖；
  - 分类法/所有权映射；
  - 覆盖-精度权衡。
- **优秀方案**：自动 inventory + 人工审核；CODEOWNERS 映射；覆盖率指标；迭代。
- **本项目选择**：`scripts/bootstrap-registry.mjs` 从 tree/CODEOWNERS 生成候选；人工确认；覆盖率 ≥95%；unknown ≤5%；否则不 enforce。
- **落盘**：脚本、模板、docs。
- **验收**：本仓 + 外部仓 unknown ≤5%；ownerless 0；评审人可解析。
- **不做什么**：不自动生成“正确”架构。

#### P-29 Synthesis 是“记录”而不是“独立验证”

- **现象/证据**：`synthesize` 不调用模型；独立性靠 provider/model 字符串；plan 不被 record 强制；`elapsed_minutes` 自报；L2 receipt 却要求 synthesis。
- **强制追问：这属于什么经典问题/变体？**
  - 安全剧场/仪式化（ceremony/security theater）；
  - 独立性由标签声明（independence by label）；
  - 记录 vs 强制（record-keeping vs enforcement）；
  - 多源证据的伪独立（pseudo-independence）。
- **优秀方案**：
  1. 真多模型编排：DSH `subagent` 指定不同 provider/model、独立上下文、结构化输出、记录调用 id；成本高但真实；
  2. 外部评审/人类专家作为独立席位；成本更高；
  3. 降级为可选记录，不再作为门禁；诚实但减少证据；
  4. 删除该机制，等有数据再恢复。
- **本项目选择**：v0.1 **降级为可选咨询记录**：L2 receipt 不再要求 synthesis；若提供，只校验 plan/round 内部一致性，不声称“独立验证”；classify 同理。试点后若数据证明多席位改变决定，再升级为门禁。
- **落盘**：receipt schema/tool 去掉 L2 必须 synthesis；synthesis 仍可写；docs/CLAIMS 明确“advisory”；测试 L2 无 synthesis 绿、无效 synthesis 红。
- **验收**：L2 无 synthesis 可生成 receipt；含 synthesis 时 plan/round 不一致红；文档不再声称独立验证。
- **不做什么**：不假装单模型多提示词是多专家。

#### P-30 intent/classification/dossier 是装饰

- **现象/证据**：`intent.sha256` 不指向文件；`classification.dossier_sha256` 不读 dossier；`classification.subsystem` 不与 impact 比对；100 PR 试点用 `subsystem: 'pilot'`、`dossier_sha256: 'a'×64` 通过。
- **强制追问：这属于什么经典问题/变体？**
  - 需求追溯（requirements traceability）缺失；
  - 来源/监管链（provenance/chain of custody）断裂；
  - 装饰性字段（decorative configuration）；
  - 对象辨识与交付脱节。
- **优秀方案**：
  1. 所有引用都是内容寻址的 artifact ref（path+sha256），验证时打开并比对；
  2. classification 从 dossier 派生，而非调用方自填；
  3. 若 Q1 不参与门禁，就把 classification 从 receipt 移除，避免假证据；
  4. 需求/规范基线（intent）纳入版本控制并 hash。
- **本项目选择**：v0.1 **移除 receipt 的 classification 必填**（classify/dossier 仍是 advisory）；`intent` 仅在 policy 要求时必填，且必须指向可校验 artifact（path+sha256）；若未来恢复 Q1，classification 必须由 dossier artifact ref 派生并校验 kind/method。
- **落盘**：receipt schema/tool、assess、docs、tests；pilot 的假 dossier 不再进入回执。
- **验收**：L2 不填 classification 绿；policy 要求 intent 时假 hash 红；恢复 Q1 时 dossier 不存在红。
- **不做什么**：不把 dossier 变成每个 PR 的必经步骤。

---

## 4. 目标契约 v1（实现规格）

### 4.1 Receipt v1（示意）

```json
{
  "schema": "firetree.receipt/v1",
  "change": {
    "id": "chg-...",
    "repo": "owner/repo",
    "base": "<sha>",
    "head": "<sha>",
    "tree_sha": "<sha>",
    "diff_sha256": "<sha256>",
    "files": ["..."],
    "files_sha256": "<sha256>"
  },
  "assessment": { "path": "...", "sha256": "..." },
  "tier": "L2",
  "policy": { "digest": "<sha256>", "decisions": [{ "rule": "...", "result": "L2", "reason": "..." }] },
  "assurance": "A3",
  "impact": {
    "files": ["..."],
    "subsystems": [],
    "interfaces": [],
    "owners": [],
    "tests": [],
    "unknown": ["tools/legacy/x.py"],
    "unresolved_consumers": [],
    "traversed": false,
    "confidence": "low"
  },
  "provenance": {
    "issuer": "https://token.actions.githubusercontent.com",
    "repository": "owner/repo",
    "workflow_ref": "owner/repo/.github/workflows/firetree.yml@refs/heads/main",
    "sha": "<sha>",
    "run_id": "123",
    "run_attempt": "1",
    "claims_sha256": "<sha256>"
  },
  "evidence": [{
    "id": "ev-1",
    "kind": "test",
    "subject": { "diff_sha256": "<sha256>" },
    "producer": { "type": "ci", "id": "github-actions" },
    "run_ref": "https://...",
    "artifact": { "path": "junit.xml", "sha256": "<sha256>" },
    "produced_at": "...",
    "verified": { "format": "junit", "ok": true, "tests": 2436, "failures": 0 }
  }],
  "review": {
    "mode": "full",
    "package_sha256": "<sha256>",
    "diff_sha256": "<sha256>",
    "rounds": 2,
    "new_findings": [3, 0],
    "dissent": 2,
    "verdict": "ready"
  },
  "correctness_case": {
    "path": "...",
    "sha256": "<sha256>",
    "claims": 2,
    "mapped_claims": 2,
    "unaccepted_residuals": 0
  },
  "synthesis": { "plan": {"path": "...", "sha256": "..."}, "rounds": 2, "last_round": {"path": "...", "sha256": "..."}, "converged": true },
  "signoff": {
    "by": "human:github-login",
    "identity": "github:12345",
    "at": "...",
    "scope": "L2 ...",
    "approval": { "provider": "dsh", "id": "..." },
    "waiting_seconds": 3600
  },
  "expires_at": "...",
  "verifier": { "name": "firetree-check", "version": "0.1.0", "checked_at": "...", "result": "pass" }
}
```

规则：`assurance`/`verifier` 由 verifier 写；`provenance` 来自 claims；`signoff` 必须绑定 package/diff；`evidence[].subject` 必须等于 change diff；`review.diff_sha256` 必须等于 change diff；**L2 允许 `subsystems`/`owners` 为空，但必须 `unknown` 非空或 `traversed=false`；L0/L1 不允许空**。**v0.1 中 `synthesis`/`classification` 可选（advisory）；`intent` 仅在 policy 要求时必填且必须可校验。**

### 4.2 Assessment v1

```json
{
  "schema": "firetree.assessment/v1",
  "change": { "id": "...", "repo": "...", "base": "...", "head": "...", "tree_sha": "...", "diff_sha256": "...", "files": ["..."], "files_sha256": "..." },
  "revision": 1,
  "prev": null,
  "tier": "L2",
  "auto_tier": "L2",
  "reasons": [{ "code": "unknown_path", "detail": "..." }],
  "impact": { "files": [], "subsystems": [], "interfaces": [], "owners": [], "tests": [], "unknown": [], "unresolved_consumers": [], "traversed": false },
  "policy": { "path": "...", "digest": "..." },
  "required_artifacts": ["..."],
  "sampling": { "rate": 0, "selected": false, "method": "sha256(...)" },
  "signoff_required": "human",
  "created_at": "..."
}
```

规则：revision 不可变；同 `(change, base, head, diff)` 幂等；新 diff 新增 revision；不允许覆盖。

### 4.3 Evidence v1

```json
{
  "schema": "firetree.evidence/v1",
  "id": "ev-...",
  "kind": "test|coverage|sarif|sbom|bench|analysis",
  "subject": { "repo": "...", "diff_sha256": "...", "head": "..." },
  "producer": { "type": "ci|tool|local", "id": "...", "claims_sha256": "..." },
  "artifact": { "path": "...", "sha256": "...", "bytes": 123 },
  "format": { "name": "junit", "version": "..." },
  "verified": { "ok": true, "tests": 0, "failures": 0, "errors": 0, "skipped": 0, "findings": 0, "coverage": 0.9 },
  "produced_at": "...",
  "run_ref": "..."
}
```

规则：`kind=test` 必须有 `verified.tests > 0`；`failures/errors=0`；`sarif` 无 error（可按 policy）；`sbom` packages/components 非空；`coverage` 达到阈值；`analysis` 不能单独满足 L1/L2 的“测试证据”要求。

### 4.4 Policy v1（示意）

```json
{
  "schema": "firetree.policy/v1",
  "scope": "repo",
  "extends": "org-policy.json",
  "digest": "<sha256>",
  "tiers": {
    "L0": { "sample_rate": 0.1, "review_rounds": 1, "signoff": "none", "correctness_case": "none", "token_budget": 20000, "enforcement": "warn" },
    "L1": { "sample_rate": 1, "review_rounds": 2, "signoff": "peer", "correctness_case": "light", "token_budget": 100000, "enforcement": "enforce" },
    "L2": { "sample_rate": 1, "review_rounds": 3, "signoff": "human", "correctness_case": "full", "token_budget": 400000, "enforcement": "enforce" }
  },
  "triggers": [
    { "id": "interface-change", "when": { "interfaces": true }, "tier": "L2", "reason": "interface changed" },
    { "id": "sensitive-config", "when": { "paths": ["**/.env*", "**/config/**", ".github/**"] }, "tier": "L1", "reason": "sensitive config" },
    { "id": "unknown", "when": { "unknown": true }, "tier": "L2", "reason": "unknown path" }
  ],
  "exceptions": [
    { "id": "EX-001", "scope": "services/billing/**", "reason": "...", "approver": "human:...", "created_at": "...", "expires_at": "..." }
  ],
  "inheritance": { "mode": "tighten_only" }
}
```

规则：`digest` 由 canonical JSON 计算（排除 digest 自身）；`extends` 递归；子层只能加严；放松必须 exception + expiry；未被消费的字段不允许存在（schema lint + 测试）。

### 4.5 Review / Synthesis / Hypothesis v1

- review：`mode: light|standard|full`；`assessment_sha256`、`diff_sha256`、`package_sha256`；seats 来自 CODEOWNERS；findings 的 evidence 是 `{path|url, sha256}`；verdict/signoff 绑定 package。
- synthesis（v0.1 可选、advisory）：若使用，plan 的 seats/question 在 record 时必须匹配；seat 的 `provenance` 区分 `model|human|tool`；timebox 用 `started_at/ended_at` 而不是自报；converged 必须有逐条 objection 状态。**不声称独立验证，也不作为 L2 门禁。**
- hypotheses：`accepted_risks[]`；`evidence_ref` 是 `{evidence_id, sha256}`；detection 的 `pass_criterion` 结果字段。

### 4.6 Events v1

```json
{"seq":1,"prev":"<hash>","event_id":"...","ts":"...","change":"...","actor":"agent:...","tool":"firetree_assess","action":"assess","tier":"L2","result":"ok","duration_ms":12,"policy_digest":"...","detail":{},"hash":"<sha256 of canonical event>"}
```

规则：append-only；`prev` 链接；每 change 一个文件；state 从事件投影；metrics 从事件聚合；不含代码内容/密钥。

### 4.7 状态机（tier × review × assurance）

| tier | review | signoff | assurance 最低 | 备注 |
|---|---|---|---|---|
| L0 未采样 | null | null | A1（本地）/A2（CI） | 仅 docs/test/非运行配置 |
| L0 采样 | light | 人类 spot-check | A1/A2 | 1 轮、3 步、checked；人类确认，agent 不可自写 |
| L1 | standard | peer | A2（governed） | 三步、1–2 轮 |
| L2 | full | human | A3 | 七步、≥2 轮、correctness、approval；synthesis/classification 为可选记录，不作门禁 |

---

## 5. 修复工作包

> 每个 WP 都有：目标、改动、测试、DoD、依赖、估算。WP 编号与诊断卡对应。

### WP0 真值基线（第 0–1 周）

- **对应**：P-01、P-02、P-04、P-19、P-20（部分）。
- **目标**：先让契约自洽，CI 能跑，文档不再说谎。
- **改动**：
  - schema：L0 nullable + 条件；unknown 字段；schema 版本 v1；lint 脚本。
  - `src/tools/receipt.js`、`review.js`、`assess.js`：状态机分支；v0.1 去掉 L2 对 synthesis/classification 的必填（P-29/P-30）。
  - `docs/CLAIMS.md`：把 classify/synthesize 标为 advisory，不再声称独立验证。
  - `.github/workflows/ci.yml`：Ubuntu+Windows，`node --test`、`check-docs`、`node --check`、`lint:schemas`。
  - `docs/CLAIMS.md`：每条主张状态。
  - `package.json`：0.1.0、engines、files。
- **测试**：tier matrix、unknown-only、L0 build/check、schema lint、跨平台 skeleton 修复。
- **DoD**：`npm test` 全绿；L0/L1/L2 e2e 绿；CI 双平台绿；CLAIMS 无悬空。
- **估算**：3–4 人日。

### WP1 不可变 change 与 git 绑定（第 1–2 周）

- **对应**：P-07、P-08、P-17（部分）。
- **目标**：变更身份来自 git，重评估不能降级。
- **改动**：
  - `src/lib/git.js`；assess `verify_git`；revision/prev；diff/tree hash。
  - review 绑定 assessment/diff/package。
  - lock/事件骨架。
  - 新增 `bin/firetree-assess.mjs`（从 git 计算 base/head/files，调用 assess）。
  - CI 模板读取 `github.event.pull_request.base/head`。
- **测试**：临时 git 仓 rename/delete/binary；子集重评估红；并发 assess。
- **DoD**：receipt 绑定 assessment/diff/tree；重评估红；CI 模板可跑。
- **估算**：5 人日。

### WP2 信任根与身份（第 2–4 周）

- **对应**：P-06、P-09、P-10、P-11。
- **目标**：A2/A3 由外部锚派生，不再自述。
- **改动**：
  - `src/lib/identity.js`、`assurance.js`、`bundle.js`、`approval.js`。
  - 新增 `bin/firetree-approval.mjs`：从 GitHub API 导出 PR review 记录（reviewer/commit/state），供 A3。
  - `firetree-check --claims/--bundle/--require`。
  - CI `id-token: write`；claims 文件；`actions/attest-build-provenance`；可选 cosign。
  - receipt/review signoff 绑定 package/diff；L1 peer 强制。
- **测试**：伪 claims/过期/错 repo/错 workflow/缺 claims；A2+local；A3 无审批；bundle 离线。
- **DoD**：A2 必须有 claims；A3 必须有审批；本地 A1；0 未验证 A2。
- **估算**：8–10 人日。

### WP3 证据与正确性（第 3–5 周）

- **对应**：P-12、P-13、P-14、P-15。
- **目标**：证据内容可验证，claims 连到 evidence。
- **改动**：
  - evidence adapters（JUnit/SARIF/SBOM/coverage）+ 解析器决策。
  - 新增 `bin/firetree-evidence.mjs`（收集/校验证据）与 `bin/firetree-receipt.mjs`（build/check 包装）。
  - correctness case evidence index；accepted_risks；interface hash/contract test/depends_on。
  - 负例库与 fixtures。
- **测试**：伪造 JUnit、空 SBOM、SARIF error、假 refs、过期 risk、接口 hash。
- **DoD**：真实 50 JUnit 绿；负例全红；L2 case 无假 refs。
- **估算**：8 人日。

### WP4 policy 与分级校准（第 4–6 周）

- **对应**：P-03、P-22、P-24。
- **目标**：策略可执行，L2 比例可控。
- **改动**：
  - `src/lib/policy.js`：resolve/evaluate/digest/decision log；triggers/exceptions/inheritance/review_rounds/correctness_case。
  - impact 收窄 L0；config 敏感；git diff 行数。
  - bootstrap registry 脚本。
- **测试**：继承/放松/例外过期/triggers/L0 四误判/覆盖率。
- **DoD**：policy digest 稳定；同一 change 两 policy 不同 tier；L0 误判修复。
- **估算**：7 人日。

### WP5 状态、指标与再评估（第 5–7 周）

- **对应**：P-16、P-23、P-26。
- **目标**：可观测、可重估、可审计。
- **改动**：
  - events.jsonl + 投影 + state expiring/blocked + metrics 脚本 + SPC。
  - approval waiting/quality 指标；schedule/cron 模板。
  - 周报模板。
- **测试**：事件链、过期、tamper、metrics 聚合。
- **DoD**：state 真实；周报可生成；SLO 告警。
- **估算**：5 人日。

### WP6 DSH 集成与发布（第 6–8 周）

- **对应**：P-21、P-20。
- **目标**：真的能安装、能升级、能回滚。
- **改动**：
  - `ctx.effect` 注册/清理；Config；`meta.detail`；files；LICENSE/NOTICE。
  - install/upgrade/rollback 脚本；profile smoke；版本矩阵。
- **测试**：fake ctx、profile install、HMR/disable、pack 内容。
- **DoD**：install applied；7 工具/6 技能可见；pack 正确；回滚可用。
- **估算**：5 人日。

### WP7 文档真值与发布（第 7–9 周）

- **对应**：P-19、P-05、P-20。
- **目标**：文档与实现一致，发布可复现。
- **改动**：重写 ARCHITECTURE/README 状态；CLAIMS；COMPATIBILITY；THREAT-MODEL；OPERATIONS；DEPLOYMENT；POLICY；ATTESTATION；release checklist；v0→v1 迁移。
- **测试**：CLAIMS 检查、链接、迁移幂等。
- **DoD**：审计报告的漂移项 0；发布 checklist 全绿。
- **估算**：5 人日。

### WP8 部署与试点（第 8–11 周）

- **对应**：P-25、P-27、P-28、P-22。
- **目标**：本仓 + 1 个外部代码仓、1 个外部团队、100 PR、4 周真实运行。
- **改动**：bootstrap 本仓 + 外部仓；CI enforce；shadow→warn→enforce；培训；周会；误拦裁决；例外。
- **DoD**：见 §8。
- **估算**：10 人日 + 试点团队。

### WP9 加固与 1.0-rc（第 10–12 周）

- **对应**：P-17、P-18、安全/性能/回归。
- **目标**：可发布、可维护。
- **改动**：并发锁、OWNERS 缓存、安全审查、fuzz、性能、备份/恢复、事故演练、bus factor（第二维护者）。
- **DoD**：安全审查通过；p95 达标；事故演练；1.0-rc。
- **估算**：8 人日。

---

## 6. 部署蓝图（真实运行）

### 6.1 环境与拓扑

| 环境 | 用途 | 信任等级 | 组件 |
|---|---|---|---|
| 本地开发 | 快速反馈、草稿 | A0/A1 | DSH profile + plugin；无网络 |
| CI 验证 | 真实 gate | A2 | GitHub Actions + OIDC；证据生成；`firetree-check` |
| 治理 | L2/审计 | A3 | 人工审批 + 可选 Sigstore + 证据库 |
| 离线审计 | 外部复验 | A2/A3 | `firetree-check --bundle` + 公钥 |

### 6.2 安装步骤（第一件真事）

1. 锁定 DSH 版本（当前 `0.2.2-rc.3`）；记录到 `docs/COMPATIBILITY.md`。
2. 在 profile 中安装：
   ```powershell
   # 通过 DSH plugin_manager（需 Full access/approval）
   # action: install_bundle, target: D:\AiCode\FireTree-DSH
   ```
3. 重启 DSH；验证：
   - Tools 列表出现 7 个 `firetree_*`；
   - Skills 出现 6 个 FireTree 技能；
   - `firetree_state` 返回 empty；
   - `firetree_assess` 在 fixture 上返回 L0/L1；
   - `firetree_receipt` 在 fixture 上 build/check。
4. 记录安装结果与 DSH 版本；失败则回滚到上一个插件版本。
5. 在 CI 中安装固定版本（npm pack / release artifact），不要用工作区路径。
6. **人签通道**：当前会话 approval policy = never，DSH `approval` 不会弹窗；因此 v0.1 的人签记录走 GitHub PR review + `approval.json`。只有把 profile 策略改为 `ask` 且确有第二个人时，才启用 DSH approval 适配器。

### 6.3 CI 模板（消费者仓库）

```yaml
name: firetree
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
permissions:
  contents: read
  actions: read            # 下载/读取 artifact
  id-token: write          # OIDC claims
  pull-requests: read
jobs:
  firetree-evidence:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - name: Assess from git diff
        run: |
          node bin/firetree-assess.mjs \
            --repo "$GITHUB_REPOSITORY" \
            --base "${{ github.event.pull_request.base.sha }}" \
            --head "${{ github.event.pull_request.head.sha }}" \
            --change "pr-${{ github.event.number }}" \
            --verify-git
      - name: Tests + evidence
        run: |
          node --test --test-reporter=junit \
            --test-reporter-destination=.firetree/evidence/junit.xml
          # 其他扫描：SARIF/coverage/SBOM
      - name: Evidence + receipt
        run: |
          node bin/firetree-evidence.mjs --change "pr-${{ github.event.number }}"
          node bin/firetree-receipt.mjs build --change "pr-${{ github.event.number }}"
      - name: Human approval record (A3)
        if: github.event.pull_request.base.repo.private == false || vars.FIRETREE_A3 == 'true'
        run: |
          node bin/firetree-approval.mjs --pr "${{ github.event.number }}" \
            --commit "${{ github.event.pull_request.head.sha }}" \
            --out .firetree/approval.json
      - name: Attest bundle (A3)
        if: github.event.pull_request.base.repo.private == false || vars.FIRETREE_A3 == 'true'
        uses: actions/attest-build-provenance@v2
        with:
          subject-path: .firetree/**
      - uses: actions/upload-artifact@v4
        with:
          name: firetree-bundle
          path: .firetree/
  firetree-verify:
    needs: firetree-evidence
    # 关键：验证 workflow 固定从默认分支读取，不执行 PR 代码
    uses: owner/repo/.github/workflows/firetree-verify.yml@main
    with: { artifact: firetree-bundle }
```

> 注意：`pull_request` 触发的 workflow 来自 PR 分支，不可信；验证 job 必须用 `workflow_run` 或 `pull_request_target` + 默认分支上的固定 workflow，只下载 artifact 并验证，不 checkout/执行 PR 代码。这是本项目“验证器不可被 agent 修改”的关键。

### 6.4 分支保护

- 必需检查：`firetree-verify`（enforce 后）。
- 要求 CODEOWNERS 评审；dismiss stale approvals；require conversation resolution；linear history；禁止 admin bypass（或至少记录）。
- 保护 `.github/workflows/` 与 `.firetree/policy.json`：仅平台团队可改。
- PR 模板：change id、tier 自述、例外 id、证据链接。

### 6.5 证据库与保留

- 短期：GitHub Actions artifact（90 天）+ `actions/attest-build-provenance` 签名（SLSA/in-toto）；每个 run 上传 bundle（assessment/receipt/evidence/claims/approval）。
- 长期：S3/MinIO Object Lock（1 年）+ manifest；可选 Rekor 透明日志。
- 仓库只保留 receipt 摘要/链接，不提交大证据；`.firetree` 是投影。
- 保留策略：receipt/attestation 1 年；事件 2 年；证据按合规；删除需双人审批。

### 6.6 指标与告警

- 事件：`events.jsonl`，字段见 §4.6；每工具成功/失败都写。
- 周指标：L0/L1/L2 比例、误拦、例外、回执完整率、检查 p50/p95、评审时延、签字等待、成本（估算）、agent 自签（应 0）、未验证 A2（应 0）。
- SLO：`firetree-check` p95 ≤2s；`assess` p95 ≤5s；L1 ≤1d、L2 ≤3d；回执完整率 ≥95%。
- 告警：p95 超 SLO、L2 >15% 连续 4 周、误拦 >2%、例外 >5%、自签 >0、未验证 A2 >0、证据解析失败率 >1%。

### 6.7 安全与威胁模型

| 威胁 | 场景 | 控制 |
|---|---|---|
| 证据伪造 | agent 写 JUnit/日志 | CI 产生 + OIDC + digest + 解析器 |
| 身份冒充 | 自填 human/ci | OIDC + approval + 身份绑定 |
| 重放 | 旧 receipt 复用 | diff/tree/assessment 绑定 + expiry |
| 供应链 | 依赖/插件被篡改 | 锁版本、SBOM、签名、npm provenance |
| 解析器攻击 | 恶意 XML/YAML | 标准解析器、大小/深度限制、禁 DOCTYPE/ENTITY |
| SSRF | 远程证据 URL | 不 fetch；allowlist；禁私网；CI 内 fetch |
| DoS | 大文件/全树 walk | 大小上限、缓存、超时 |
| 密钥/PII | 证据含日志 | 脱敏、最小化、secret scanning |
| 权限过大 | PR workflow 改验证器 | 受保护 workflow、最小权限、分支保护 |
| 审计篡改 | 改 `.firetree` | 外部证据库 + 事件链 + 透明日志 |

信任假设：GitHub/Actions、OIDC issuer、CI runner、DSH host、人类审批者可信；恶意 CI admin/平台根权限不在 threat model 内（但要有审计）。

### 6.8 运维与回滚

- Runbook：安装/升级/回滚、OIDC 轮换、证书/公钥轮换、证据库故障、误拦裁决、例外、事故、数据恢复。
- Kill switch：policy `enforcement: off|warn|enforce`；可按 repo/team 降级；降级必须记录并到期。
- 回滚：插件上一版本 + 旧 schema 读取；receipt 不可变，回滚不删除历史；新 receipt 标记 supersedes。
- 备份：证据库 + policy + CODEOWNERS；恢复演练每季度。
- 事件响应：撤销 token/公钥、冻结 enforce、重放验证、发布事故报告。

### 6.9 试点与推广

- 选本仓（docs/config 多，dogfood）+ 1 个外部代码仓；先 1 个外部团队；每仓有 CODEOWNERS 与 CI。4 周后再扩第 2 个外部团队/仓。
- 4 周：第 1–2 周 shadow（只记录）；第 3 周 warn；第 4 周 enforce。
- 每周：误拦裁决会、指标复盘、例外清理；每天：CI 失败分类。
- 推广：golden path 模板、培训 30 分钟、champion、例外流程、季度 go/no-go。
- 不追全组织；先证明 2 仓有效。

---

## 7. 12 周执行计划

| 周 | WP | 里程碑 | 关键产出 |
|---:|---|---|---|
| 0 | WP0 | M0 真值基线 | CI 双平台、schema lint、L0/unknown 修复、CLAIMS |
| 1 | WP0/WP1 | M1 契约自洽 | tier matrix、git 适配、revision、review 绑定 |
| 2 | WP1/WP2 | M2 变更身份 | diff/tree/assessment 绑定、claims 设计 |
| 3 | WP2 | M2 信任根 | OIDC、A2、bundle、approval |
| 4 | WP2/WP3 | M3 证据 | JUnit/SARIF/SBOM/coverage、case 证据链 |
| 5 | WP3/WP4 | M3 policy | policy 编译器、accepted risk、interface |
| 6 | WP4/WP5 | M4 可观测 | events、state、metrics、SPC |
| 7 | WP5/WP6 | M4 DSH | 安装/清理/Config、install smoke |
| 8 | WP6/WP8 | M5 部署 | 本仓 + 外部仓 bootstrap、shadow 开始 |
| 9 | WP8 | M5 试点 | warn、误拦台账、周报 |
| 10 | WP8/WP9 | M6 试点 | enforce、100 PR、安全审查 |
| 11 | WP9 | M6 加固 | 并发/性能/备份/演练 |
| 12 | WP9 | v0.1.0 | 发布、复盘、go/no-go |

**人员**：1 协议/后端（全职）、1 CI/平台（0.75）、0.5 安全、0.25 SRE、试点团队各 0.2、审计/顾问 0.2。总计约 2.5–3 FTE × 12 周。

**关键路径**：L0/unknown → git 绑定 → OIDC/A2 → 证据解析 → policy → 试点。classify/synthesize 不在关键路径。

---

## 8. 验收与停止规则

### 8.1 D1/D2/D3 验收

| 级别 | 验收项 | 命令/证据 |
|---|---|---|
| D1 | install applied；7 工具/6 技能可见；smoke 7/7；重启可用 | `plugin_manager`、`Tools.listTools`、smoke 脚本 |
| D2 | 本仓 + 1 外部代码仓、1 外部团队、100 PR、4 周；每周 metrics；CI gate | CI 日志、周报、事件 |
| D3 | 外部验证者离线复验 20 个变更（其中至少 5 个 L2）；A3 签名/审批；0 未验证 A2 | `firetree-check --bundle --require A3` |

### 8.2 量化门槛

- 误拦：M1 <5%，M4 <2%；每例有裁决记录。
- L2 占比：校准后 ≤15%；若客观原因超，写书面例外并给触发器复盘，不得静默放宽。
- 回执完整率 ≥95%；检查 p95 ≤2s；assess p95 ≤5s。
- 自签 = 0；未验证 A2 = 0；L2 无 correctness case = 0；case 假证据 = 0。
- 例外 <5%，全部有到期日；过期例外 0。
- 安全：0 高危；0 secret；依赖扫描通过；威胁模型评审。
- 文档：CLAIMS 无悬空；审计漂移项 0。

### 8.3 停止/回滚规则

- 若 shadow 期无误拦数据或团队拒绝 → 不 enforce。
- 若 L2 连续 4 周 >15% → 调 triggers/配额，不降级。
- 若误拦 >2% → 回滚到 warn，修分级。
- 若 OIDC/审批不可用 → 停在 A1/A2，撤下“可审计”对外表述。
- 若成本 >3× 基线且无质量改善 → 收缩机制，停试点。
- 若发现新的 P0 → 停止扩面，先修。

---

## 9. 修复项目自身风险

| 风险 | P | I | 触发 | 缓解 |
|---|---|---|---|---|
| 范围膨胀 | 高 | 高 | 新增工具/机制 | 冻结 7 工具；Parking Lot；WP 外不做 |
| 试点团队不可用 | 高 | 高 | 2 周内未定 | 先 dogfood；选备选仓；缩小样本 |
| OIDC/CI 权限受阻 | 中 | 高 | 无法 `id-token: write` | A2 降级 A1；企业 IdP；先本地 |
| 误拦高 | 中 | 高 | >2% | shadow；调 triggers；例外；不 enforce |
| 性能不达标 | 中 | 中 | p95 >2s | 缓存/索引/异步；限制证据大小 |
| XML 依赖/许可 | 中 | 中 | 评审不通过 | 自研严格子集；隔离 adapter |
| DSH API 漂移 | 中 | 中 | 升级失败 | 锁版本；契约测试；适配层 |
| 维护者 bus factor | 高 | 中 | 单人 | 第二维护者；runbook；测试 |
| 安全漏洞 | 中 | 高 | 解析器/SSRF | 安全审查；fuzz；allowlist |
| 指标被游戏 | 中 | 中 | L2 异常低 | 预注册；抽样审计；禁止指标 |
| 发布合规 | 低 | 高 | LICENSE/NOTICE 缺 | 发布前 checklist |
| 过度拟合试点 | 中 | 中 | 仅一仓有效 | 本仓 + 外部仓；匹配设计；方向性报告 |

---

## 10. 已决策（2026-11-18）

> 完整理由、候选方案、代价与复议触发见 [REPAIR-DECISIONS-2026-11-18.md](REPAIR-DECISIONS-2026-11-18.md)。以下为最终值；变更必须新开决策记录。

| # | 决策 | 最终决定 | 关键代价 |
|---|---|---|---|
| D1 | 身份/信任根 | **GitHub Actions OIDC + PR review 为参考；A2 机器身份、A3 人类审批 + artifact attestation；DSH approval 仅可选；无 OIDC 只能 A1** | 绑定 GitHub；PR review 是账号级，不是法律签名 |
| D2 | L0 review | **默认 null；10% 抽样由人类 spot-check；agent 不得自写轻评审；无人类则仅 A1/A2** | 10% 人类负担；被抽中的 L0 会等待 |
| D3 | policy 引擎 | **自研类型化 JSON 编译器 + 决策日志；OPA/Cedar 仅适配器** | 自研测试成本；表达力有限 |
| D4 | 证据库 | **GitHub artifacts + artifact attestations 为权威；repo 只存 manifest；可选 S3 Object Lock/Rekor** | 保留/存储成本；GitHub 依赖 |
| D5 | 试点范围 | **本仓 + 1 个外部代码仓；先 1 个外部团队，4 周后再扩** | 本仓规模小；外部仓协调 |
| D6 | XML 解析 | **`fast-xml-parser` 5.11.x（或修复版）隔离使用；拒绝 DOCTYPE/ENTITY + 大小/深度/fuzz；备选 `@xmldom/xmldom`；不用 saxes** | 一个依赖面；大文件内存 |
| D7 | schema 策略 | **干净 v1 + 迁移脚本 + 兼容矩阵；不双写** | 一次性迁移 |
| D8 | 周期/人力 | **12 周、2.5–3 FTE；单人 18–20 周并砍 A3/签名/长期库** | 人员/时间 |
| D9 | Q1/Q3 去留 | **v0.1 降级 advisory，不作 L2 门禁；试点后按数据决定** | 少两个“机制”的强制力；换真实 |

> 以上为最终决策；D1/D4/D5 变更会改变关键路径，需重排 §7。

---

## 11. 第一周行动清单（可直接执行）

**Day 1**
- 建分支 `repair/v0.1`；冻结 7 工具；在 `docs/PARKING-LOT.md` 记录本计划的新想法。
- 加 `docs/CLAIMS.md` 骨架；把审计报告中的 14 条主张录入。
- 加 CI：`node --test`、`check:docs`、`node --check`、`lint:schemas`；修 skeleton 跨平台断言。

**Day 2**
- 实现 P-01：schema nullable + L0 人类 spot-check 状态机；加 tier matrix 测试；agent 自写 light review 必须红。
- 实现 P-02：receipt impact 增加 unknown；schema 条件；unknown-only 测试。

**Day 3**
- 实现 P-04：schema lint；白名单关键字；CI 接入。
- 定义 receipt/assessment v1 草案（§4）。

**Day 4**
- 实现 `src/lib/git.js` + `verify_git`；临时 git 仓测试。
- 设计 revision/prev 布局；迁移脚本骨架。

**Day 5**
- 评审 v1 契约；确定 OIDC/证据库/审批的部署前提。
- 写 `docs/THREAT-MODEL.md` 初稿；列信任假设。

**Day 6–7**
- 用 fixture 跑通 L0/L1/L2 端到端；录一次 demo。
- 在本地 profile 试安装（若可用）；记录失败点。
- 准备试点仓候选与 baseline 测量。

**Day 8–10**
- 完成 WP0 DoD；启动 WP1/WP2 并行；给用户第一周报告。

---

## 12. 附录

### 12.1 经典问题索引

| 缩写 | 经典问题 | 本计划出现 |
|---|---|---|
| TOCTOU | Time-of-check to time-of-use | P-07、P-08 |
| RATS | Remote ATtestation procedureS | P-06、P-10 |
| PDP/PEP | Policy Decision/Enforcement Point | P-03 |
| CQRS | Command Query Responsibility Segregation | P-16 |
| GSN | Goal Structuring Notation / Assurance Case | P-13 |
| SoD | Separation of Duties | P-06、P-09 |
| Lost update | 并发读改写覆盖 | P-17 |
| ReDoS | 正则灾难性回溯 | P-18 |
| Goodhart | 指标成为目标 | P-12、P-22、P-23、P-26 |
| Little's law | 排队/在制品/时延 | P-22 |
| Fail-open | 失败时放行 | P-04、P-06 |
| Open-world | 未知即一等公民 | P-02 |
| Unreachable state | 不可达状态 | P-01 |
| Schema evolution | schema 演化 | P-05 |
| SLSA | 供应链保证等级 | P-06、P-20 |
| in-toto/DSSE | 供应链 attestation | P-06、P-11、P-13 |
| Sigstore | 无密钥签名/透明日志 | P-06、P-20 |
| OIDC | 工作负载身份 | P-06、P-09 |
| Pact | 消费者驱动契约 | P-15 |
| SPC | 统计过程控制 | P-16、P-26 |
| STRIDE | 威胁建模 | P-06、P-11、P-12 |

### 12.2 参考标准/资料（按名称）

- NIST SP 800-207 Zero Trust Architecture；
- NIST SP 800-53 Audit and Accountability；
- RFC 9334 RATS Architecture；
- SLSA（Supply-chain Levels for Software Artifacts）；
- in-toto Attestation Framework / DSSE；
- Sigstore（cosign / Fulcio / Rekor）；
- OpenID Connect Core + GitHub Actions OIDC claims；
- Open Policy Agent / Cedar（可选）；
- JSON Schema 2020-12 + metaschema；
- JUnit XML、SARIF 2.1.0、SPDX 2.3、CycloneDX 1.5；
- Saltzer & Schroeder（least privilege / fail-safe defaults / separation of privilege）；
- Senge《第五项修炼》系统原型；
- Little's law / queueing theory；
- Goodhart's law；
- ISO 31000 风险管理；
- ISO/IEC 42001（AI 管理体系，可选）；
- REUSE / SPDX license identifiers。

### 12.3 文件改动地图（按 WP）

- **WP0**：`schemas/*.json`、`src/tools/{assess,review,receipt}.js`、`src/lib/receipt.js`、`test/tier-matrix.test.mjs`、`test/schema-lint.test.mjs`、`.github/workflows/ci.yml`、`docs/CLAIMS.md`、`package.json`、`test/skeleton.test.mjs`。
- **WP1**：`src/lib/git.js`、`src/tools/assess.js`、`bin/firetree-assess.mjs`、`schemas/assessment.schema.json`、`src/lib/receipt.js`、`src/lib/lock.js`、`test/git-assess.test.mjs`、CI 模板。
- **WP2**：`src/lib/{identity,assurance,bundle,approval}.js`、`bin/firetree-approval.mjs`、`bin/firetree-check.mjs`、`schemas/receipt.schema.json`、`docs/ATTESTATION.md`、`test/identity.test.mjs`。
- **WP3**：`src/lib/evidence/*`、`bin/firetree-evidence.mjs`、`bin/firetree-receipt.mjs`、`src/lib/correctness.js`、`src/lib/technical.js`、`schemas/hypotheses.schema.json`、`schemas/receipt.schema.json`（synthesis/classification 可选）、`src/tools/synthesize.js`/`classify.js`（advisory 标注）、`src/lib/interface.js`、`test/evidence-*.test.mjs`。
- **WP4**：`src/lib/policy.js`、`src/lib/impact.js`、`src/lib/registry.js`、`schemas/policy.schema.json`、`scripts/bootstrap-registry.mjs`、`test/policy.test.mjs`。
- **WP5**：`src/lib/events.js`、`src/tools/state.js`、`scripts/metrics.mjs`、`docs/OPERATIONS.md`、`test/events.test.mjs`。
- **WP6**：`index.js`、`package.json`、`locale/*.json`、`docs/DETAIL.md`、`LICENSE`、`NOTICE`、`test/skeleton.test.mjs`、install smoke。
- **WP7**：`docs/*.md`、`README.md`、`plan/STATUS.md`、`docs/COMPATIBILITY.md`、`docs/THREAT-MODEL.md`。
- **WP8**：试点仓 `/.firetree/*`、CI、runbook、pilot report。
- **WP9**：并发/缓存/安全/性能测试、`docs/RUNBOOK.md`、release。

### 12.4 常用命令

```powershell
# 本地质量门
node --test
node scripts/check-docs.mjs
node --check <file>
node scripts/lint-schemas.mjs

# 安装（示例；需 DSH Full access）
# plugin_manager install_bundle target=D:\AiCode\FireTree-DSH

# CI 验证
node bin/firetree-check.mjs --change pr-123 --mode governed --root <repo> --claims claims.json --bundle .firetree --require A3

# 迁移
node scripts/migrate-v0-to-v1.mjs --root <repo>

# 指标
node scripts/metrics.mjs --root <repo> --since 2026-11-01 --out metrics.json
```

### 12.5 术语

- **Attestation**：由受信任方签发的声明（此处：CI 对“我产生了这些证据”的声明）。
- **Assurance**：验证者根据证据与身份派生出的置信等级（A0–A3），不是调用方输入。
- **Bundle**：一次变更的 assessment/receipt/evidence/claims 的离线包。
- **PDP/PEP**：策略决策点/执行点；本项目的 `policy.js` 是 PDP，`assess`/`receipt`/CI gate 是 PEP。
- **Revision**：同一 change 的不可变评估版本；不同 diff 生成新 revision。
- **Shadow/Warn/Enforce**：只记录/警告/阻断三种上线模式。

---

**计划结束。** 9 个决策已记录（§10 与 [REPAIR-DECISIONS-2026-11-18.md](REPAIR-DECISIONS-2026-11-18.md)）；下一步按 §11 的 Day 1 开始，WP0 完成即提交第一版可运行修复。
