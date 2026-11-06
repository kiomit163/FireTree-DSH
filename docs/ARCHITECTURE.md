# 架构：DSH 原生的可审计交付协议

> 一句话：**能借宿主的一律借，不能借的才自己写；自己写的部分必须能拒绝一次交付。**

---

## 一、DSH 原语映射（先删，再写）

| 需求 | V5 做法（删除） | DSH 原生做法（保留） |
|---|---|---|
| 事件日志 / 回放 | `packages/workflow/events.mjs` 事件溯源 | Session log + `sessionProjections` |
| 工具策略 / 硬边界 | `packages/policy` + PreToolUse hook | `ctx.tools.guard`（同步、单调）+ `ctx.tools.restrict` + 沙箱策略 |
| 身份 / 职责 | `packages/identity` + roles + SoD 字符串 | agent scope + permission presets + `approval` |
| 技能注入 | SessionStart 注入 15.4KB 全文 | `ctx.systemPrompt.section`（短路由）+ `ctx.skills.register`（按需） |
| 计划状态 | `.firetree/active-plan` + ledger 解析 | `sessionProjections`（从日志派生）+ `.firetree/` 工件 |
| 并发编排 | 自研 + 手工派发 | `subagent` / `workflow`（schema 化输出、并发） |
| 长任务 | 自研 runner | `jobs` + `agentLoop` |
| 调度 / 重估 | `re_eval` 字段 + 计划中的 scheduler | `schedule` 服务 + 状态过期 |
| 安装 | `install.mjs` + 3 宿主清单 | `plugin_manager` bundle |
| 证据库 | 本地 JSON + 自研验签 | CI 产物 + 哈希清单；v1 只校验，不签名 |
| 通知 / 交互 | 无 | `ask_user_question` / `approval` |

**原则**：v1 的运行时完全由 DSH 承担；插件只负责**协议、校验、拒绝**。

## 二、包结构

```
firetree-dsh/
├── package.json              # @local/firetree-dsh，dsh.bundle.patch
├── cordis.patch.yml          # 插入一行 host 插件
├── index.js                  # apply: 注册工具 / 短 prompt section / 技能
├── src/
│   ├── tools/classify.js
│   ├── tools/hypothesis.js
│   ├── tools/synthesize.js
│   ├── tools/review.js
│   ├── tools/receipt.js
│   ├── tools/state.js
│   ├── lib/artifacts.js      # .firetree/ 读写、原子写、哈希
│   ├── lib/dossier.js        # OID schema + 判定
│   ├── lib/policy.js         # 分级/采样/例外/继承（策略即代码）
│   ├── lib/registry.js       # 子系统/接口注册表与索引
│   ├── lib/impact.js         # 影响分析 v1（确定性）
│   ├── lib/hypotheses.js     # 假设 schema + 覆盖率
│   ├── lib/rounds.js         # 轮次 schema + 收敛/差异度
│   ├── lib/receipt.js        # 回执 schema + 校验规则
│   ├── lib/tiers.js          # L0/L1/L2 裁剪
│   ├── lib/qian.js           # 概念登记表：原文→机制→信号→证伪
│   ├── lib/guard.js          # 拒绝规则（供 tools.guard 使用）
│   └── lib/json.js           # 严格 JSON（无 undefined/NaN）
├── skills/                   # 6 个技能（V5 文本改写，非照搬）
│   ├── firetree/SKILL.md
│   ├── firetree-classify/SKILL.md
│   ├── firetree-assess/SKILL.md
│   ├── firetree-synthesize/SKILL.md
│   ├── firetree-review/SKILL.md
│   └── firetree-receipt/SKILL.md
├── reference/qian/           # 抽取脚本、SHA-256、已验证引文
├── docs/                     # 本目录
├── plan/                     # M0 任务
├── locale/{en,zh}.json
├── icon.svg
└── test/
```

不写：`packages/`、hooks 层、多宿主清单、install.mjs、workflow engine、ccb、identity、org。

## 三、七个工具

命名统一 `firetree_*`；全部声明 `output.schema`，返回值经严格 JSON 化（无 `undefined`/`NaN`）。
**每次变更的入口是 `firetree_assess`，出口是 `firetree_receipt`；中间机制按等级裁剪。**

### 1. `firetree_classify`

- **作用域**：子系统/项目（低频，不是每个 PR）。
- **动作**：`set | show`
- **输入**：`subsystem`、`kind`（simple|large|simple-giant|open-complex-giant|unknown）、`layers_known[]`、`layers_unknown[]`、`coupling_evidence[]`、`reducibility_test{command, result}`、`method`（decompose|metasynthesis）、`owner_of_unknowns[]`、`learning_plan[]`
- **拒绝规则**：`layers_unknown` 非空却声明 `reducible`；`metasynthesis` 却没有 owner；`unknown` 没有 learning plan。
- **输出**：dossier + 允许的方法/工具约束（例如「OCG：禁止分解式自治交付，回执需人工签字」）。
- **工件**：`.firetree/subsystems/<id>.json`

### 2. `firetree_assess`（每次变更的唯一入口）

- **动作**：`assess`
- **输入**：`base/head`、`files[]`、`declared_tier?`、`policy_path?`
- **输出**：`tier` + 判定理由、`impact{files, subsystems, interfaces, owners, tests}`、`confidence`、`required_artifacts[]`、`sampling`、`signoff_required`
- **拒绝规则**：声明等级低于自动等级；无法映射的路径却声明 `high` 置信度；例外无到期日。
- **规模行为**：只读影响集；任一 `unknown` 路径 → 强制 L2。
- **工件**：`.firetree/changes/<change>/assessment.json`

### 3. `firetree_hypothesis`

- **动作**：`add | verify | list`
- **add**：`statement`、`kind`（assumption|risk|claim）、`detection{method: test|metric|experiment|analysis, command?, pass_criterion, evidence_kind}`
- **verify**：`id`、`result`（verified|falsified）、`evidence_ref`（外部证据路径/URL + sha256）
- **拒绝规则**：`add` 缺 `detection`；`verify` 缺证据；`verify` 的 evidence 生产者是 agent。
- **输出**：当前覆盖率、未检测清单、被证伪清单。
- **规模行为**：L2 可按 policy 抽样验证；未验证必须显式接受风险并带到期日。
- **工件**：`.firetree/changes/<change>/hypotheses.json`

### 4. `firetree_synthesize`

- **动作**：`plan | record`
- **plan**：输入 `change`、`risk_tier`、`question`；输出席位表（数据/模型/经验）、每个席位的 provider/model 要求、输出 schema、轮次规则与时间盒。
- **record**：输入一轮结构化结果（每席位：主张、证据、置信度、异议）；输出差异度、重叠率、新异议数、是否收敛、下一轮要问什么。
- **拒绝规则**：少于两个独立 provider/model 却声称「多专家」；数据席位无命令/数值；综合器未回应异议；超过时间盒仍声称收敛。
- **规模行为**：仅 L2 触发；最多 3 轮；超时记「未收敛」并阻断回执。
- **工件**：`.firetree/changes/<change>/round-N.json`

### 5. `firetree_review`

- **动作**：`open | round | verdict`
- **open**：绑定评审包（diff 哈希、spec 哈希、证据清单、评审准则、评审人席位来自 CODEOWNERS）。
- **round**：记录本轮发现（schema：location、claim、evidence、verdict、route、lens）。
- **verdict**：L2 七步齐全才允许；L1 三步；L2 需要外部签字；零异议轮要求写「查过什么」。
- **拒绝规则**：缺步骤、缺失效评审包、agent 自签。
- **规模行为**：按 tier 决定镜头数与轮数上限；支持导入 CI/人工评审记录。
- **工件**：`.firetree/changes/<change>/{package.json, round-N.json, verdict.json}`

### 6. `firetree_receipt`

- **动作**：`build | check`
- **build**：从**外部证据文件**（JUnit/JSON/SARIF/coverage/SBOM）组装回执；每条证据带 `producer`（工具名/CI）、`sha256`、`produced_at`、`run_ref`；L2 同时校验 `correctness-case.json`。
- **check**：按风险等级校验：证据齐备、未过期、生产者不是 agent、假设已检测、评审已收敛、签字人不是 agent、影响遍历已列、采样决定已记录、正确性主张已映射。
- **拒绝规则**：任何一条不满足即 `ok:false` 并列出缺口；**永不自动补证据**。
- **规模行为**：校验 ≤2s；支持 `receipts/` 外置引用（只存哈希与 URL）。
- **工件**：`.firetree/receipts/<change>.json`

### 7. `firetree_state`

- **动作**：只读
- **输出**：当前 program/subsystem/change 状态、假设覆盖、评审轮次、回执状态、即将过期项、下一步必须动作。
- **规模行为**：按 change/subsystem 查询，不做全库扫描。
- **用途**：模型每次进入交付流程先读一次，替代 V5 的每 prompt 状态注入。

## 四、工件与状态

```
.firetree/
├── policy.json                 # 分级/采样/例外/继承（策略即代码）
├── subsystems/<id>.json        # 子系统：paths/owners/interfaces/tests/dossier
├── interfaces/<id>.json        # 接口：kind/file/sha256/contract_test/consumers
├── programs/<id>.json          # 项目/程序级对象辨识与基线（季度）
├── changes/<change>/
│   ├── assessment.json         # 分级 + 影响集 + 要求
│   ├── hypotheses.json
│   ├── package.json | round-N.json | verdict.json
│   └── receipt.json            # 也可外置到制品库，仓库只留引用
└── metrics/events.jsonl        # 追加写，不含代码内容
```

- **工件是权威**，随 PR 提交、可评审、可哈希。
- `sessionProjections` 只做缓存与快速读取（活动的 change/subsystem/回执状态），不替代工件。
- 所有写入原子化（临时文件 + rename），并记录 `updated_at` 与 `sha256`。
- 大规模时可把 `changes/*/receipt.json`、证据文件外置到制品库，仓库保留 `uri + sha256`。

## 五、交付回执契约（v0）

```json
{
  "schema": "firetree.receipt/v0",
  "change": { "base": "<sha>", "head": "<sha>", "files_sha256": "<hash>" },
  "tier": "L0 | L1 | L2",
  "policy": { "version": "<hash>", "sampling": "none | sampled | full" },
  "intent": { "spec": "<path>", "sha256": "<hash>" },
  "classification": { "subsystem": "<id>", "kind": "<...>", "method": "<...>", "dossier_sha256": "<hash>" },
  "hypotheses": { "total": 3, "verified": 2, "accepted_risk": 1 },
  "evidence": [
    { "kind": "test|coverage|sarif|sbom|bench",
      "producer": "<tool or ci>",
      "run_ref": "<url or path>",
      "sha256": "<hash>",
      "produced_at": "<iso8601>" }
  ],
  "review": { "rounds": 2, "new_findings": [5, 0], "dissent": 2, "verdict": "ready|not-ready" },
  "correctness_case": {
    "path": ".firetree/changes/<id>/correctness-case.json",
    "sha256": "<hash>",
    "claims": 4,
    "mapped_claims": 4,
    "unaccepted_residuals": 0
  },
  "impact": { "interfaces": ["..."], "files": ["..."], "subsystems": ["..."], "owners": ["..."], "traversed": true, "confidence": "high|low" },
  "signoff": { "by": "<ci|human>", "identity": "<id>", "at": "<iso8601>", "scope": "<what was accepted>" },
  "expires_at": "<iso8601>"
}
```

**校验规则（v1）**

1. `evidence[].producer` 不得为 `agent`/空；每条证据必须有 `sha256` 与可打开的 `run_ref`。
2. `signoff.by` 不得为 `agent`；L2 必须有 `signoff`。
3. `expires_at` 缺失或过期 → 拒绝。
4. L1/L2：`hypotheses` 未检测数 > 0 且无 `accepted_risk` → 拒绝。
5. L2：`review.rounds` 至少 2，且最后一轮 `new_findings` 为 0；`dissent` 为 0 时必须附「查过什么」。
6. `classification.kind` 为 OCG/unknown 且 `signoff` 非人工 → 拒绝。
7. 影响遍历未完成（`traversed=false`）或 `confidence=low` 却声明 L0/L1 → 拒绝。
8. `policy.sampling` 为 `sampled` 时，必须有抽样记录（谁、何时、结论）。
9. L2：`correctness_case` 必须存在且通过校验（见下）。

**正确性论证（correctness case，L2 必需，L1 轻量）**

`.firetree/changes/<id>/correctness-case.json`：

```json
{
  "schema": "firetree.correctness-case/v0",
  "claims": [
    { "id": "c1", "statement": "并发提交不会重复扣款", "kind": "functional|safety|security|performance|compatibility", "owner": "<id>" }
  ],
  "invariants": [
    { "id": "i1", "statement": "扣款前必须写入幂等键", "enforced_by": "code|test|config|contract", "evidence_ref": "<path or url>" }
  ],
  "mapping": [
    { "claim_id": "c1", "invariant_ids": ["i1"], "tests": ["TestIdempotentCharge"], "evidence_refs": ["<junit/sarif/...>"] }
  ],
  "residual": [
    { "claim_id": "c1", "reason": "未覆盖跨区域网络分区", "accepted_by": "<human id>", "expires_at": "<iso8601>" }
  ]
}
```

校验规则：

1. 每条 `claim` 至少映射到一个 `invariant` 与一条 `evidence`；空映射拒绝。
2. `residual` 必须有 `accepted_by`（人）与 `expires_at`；过期拒绝。
3. `evidence_refs` 必须能在回执 `evidence[]` 中找到（哈希一致）。
4. L1 允许只填 `claims + mapping + tests`；L0 不需要。

**边界**：correctness case 是「正确性论证的记录」，不是证明；它让「为什么这些证据足以支撑主张」可检查、可拒绝。

**本地模式**：没有 CI 时允许 `producer: "local:<tool>"`，但回执强制标记 `assurance: "A1"`，且不得声称 A2。

## 六、风险分级（裁剪）

| Tier | 触发条件 | 必需机制 | 采样 | 签字 |
|---|---|---|---|---|
| **L0** | 文档/配置/测试-only；或 ≤20 行且无接口变更 | 测试证据 + 轻量评审（1 轮）+ 回执 | 10% 人工抽检 | 无 |
| **L1** | 常规代码变更 | L0 + 假设台账 + 三步评审（1–2 轮）+ 影响遍历 | 全量 | 作者之外的评审人 |
| **L2** | 接口/跨子系统/安全/数据/依赖；或影响未知 | L1 + 综合集成（≥2 独立席位）+ 七步 + 双轮收敛 | 全量 | 接口 owner / 架构师（人） |

分级由 `firetree_assess` 自动判定、`firetree_receipt` 与 `firetree_review` 共同校验；分错级 → 拒绝。人工 override 只能**升**不能降，降级必须走例外（带到期日）。

**例外**：热修可 24h 内补回执，需技术负责人批准并设到期日；例外率纳入指标，超阈值触发复盘。

## 七、守卫与人签

- **guard 场景（v1 只做两条）**
  1. dossier 为 OCG/unknown 且无人工签字 → 拒绝 `firetree_receipt` 定稿。
  2. L2 变更的 `signoff` 为 agent → 拒绝（纵深防御，工具内也校验）。
- **人签场景**：L2 定稿、风险接受（`accepted_risk`）、OCG 方法选择、接口基线变更。
- 所有人工动作通过 `approval` / `ask_user_question` 落日志；回执记录签字人与后果声明。

## 八、注入与技能策略

- **prompt section**：≤ 12 行，只写「四机制 + 先 assess/state + 无回执不声称完成 + 证据不能自写」。
- **skills**：6 个（firetree / classify / assess / synthesize / review / receipt），目录常驻（约 1–2k tokens），正文按需加载。V5 的 15.4KB 全文注入不再使用。
- **状态**：由 `firetree_state` 拉取，不做每 prompt 注入。

## 九、可移植性

- 核心（`lib/`）是纯函数 + JSON schema，不 import DSH API；工具层是薄适配。
- 目标：未来移植到其他宿主时，只换工具层与注入层。
- 不引入外部依赖（与 DSH 插件规范一致）；需要库时优先 Node 内置。

## 十、失败模式与对策

| 失败模式 | 症状 | 对策 |
|---|---|---|
| 证据造假 | agent 写证据 | producer 校验 + CI 生成（M3） |
| 分级规避 | 把 L2 报成 L0 | 触发条件机器判定；人工 override 记录 |
| 回执空转 | 全绿但无实质证据 | 证据必须可打开（run_ref + hash） |
| 橡皮图章 | 人工秒批 | 记录等待时长；超阈值抽样审计 |
| 流程绕过 | 直接改代码不建工件 | PR 必需检查（M3）；插件只做早提醒 |
| 规模失速 | 大变更无人跑 | 风险分级 + 只对 L2 全流程 |

## 十一、规模与集成（百万行）

**作用域上移**（详见 [SCALE.md](SCALE.md) §2）：

| 机制 | 小项目 | 百万行 |
|---|---|---|
| 对象辨识 | 每个变更 | 子系统/项目（季度/立项） |
| 综合集成 | 每个评审 | 跨子系统/接口决策（L2） |
| 基线 | 每次提交 | 接口基线 + 发布基线 |
| 评审 | 每个变更 | 分级：L0 采样 / L1 三步 / L2 七步 |
| 再评估 | 每个决策 | 接口/ADR/程序基线按季度 |

**集成点**

| 系统 | 消费 | 产出 | 失败时 |
|---|---|---|---|
| git | diff、commit、tag | 变更工件 | 明确报错 |
| CI | JUnit/SARIF/coverage/SBOM、run URL、OIDC | 回执校验、事件 | 拒绝（缺证据/过期） |
| 接口注册表 | 接口定义、consumers、契约测试 | 影响集 | 置信度 low → 升 L2 |
| CODEOWNERS | 评审人/owner | 评审席位 | 人工指派 |
| 制品库（可选） | 回执/证据引用 | 外置引用 | 本地引用 + A1 |

**规模预算**：L0 ≤20k tokens、L1 ≤100k、L2 ≤400k；回执校验 ≤2s；assess ≤5s。

**规模失败模式**：影响分析漏报（未知即 L2、标注集评估）、吞吐崩溃（采样/WIP/异步）、成本超支（分层预算/便宜席位/缓存）、团队绕过（CI 强制 + 低误拦）。
