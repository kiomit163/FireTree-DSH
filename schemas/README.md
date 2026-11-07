# FireTree 规模契约 v0（M0 冻结）

> 冻结日期：2026-11-06。M0 的四个 schema 是规模契约；M1/M2 增加 `dossier.schema.json`、`assessment.schema.json`、`hypotheses.schema.json`、`review.schema.json`。M1/M2 只按这些字段实现，不静默扩字段。
> 变更契约必须走 `docs/DECISIONS.md`，并同步更新样例与测试。

## 1. 文件

| 文件 | 作用 |
|---|---|
| `policy.schema.json` | 分级触发、采样、例外、时间盒、继承/覆盖规则（org → repo → subsystem） |
| `subsystems.schema.json` | 子系统 id、paths glob、owners、interfaces、tests、dossier 引用 |
| `interfaces.schema.json` | 接口 id、kind、定义文件、hash、contract test、consumers、depends_on |
| `receipt.schema.json` | 交付回执 v0；含 `correctness_case` 摘要与 `$defs.correctnessCase` 完整结构 |
| `dossier.schema.json` | M1：对象辨识 dossier（kind、已知/未知层次、可分解性测试、owner、允许的自治等级） |
| `assessment.schema.json` | M1：变更入口的 tier/impact/required_artifacts/sampling/signoff 工件 |
| `hypotheses.schema.json` | M1：变更级假设台账，含 detection 与外部 evidence_ref |
| `review.schema.json` | M2：L1 三步/L2 七步评审的 package/round/verdict 工件 |

配套纯函数：

- `../src/lib/schema.js`：M0 所需的 JSON Schema 2020-12 子集校验器（本地 `$ref`、条件、oneOf、pattern、date-time 等）。
- `../src/lib/correctness.js`：correctness case v0 的跨字段校验（claim 覆盖、residual 人签与到期）。

**边界**：这两个函数是 M0 契约的验证底座，不是完整回执校验器；完整回执的跨字段检查按 M2 实现。

## 2. 样例矩阵

| 样例 | 用途 |
|---|---|
| `fixtures/policy-org.json` → `policy-repo.json` → `policy-subsystem.json` | 继承链；子层提高采样率、降低 token 预算，只能加严 |
| `fixtures/subsystem-billing.json` | 子系统注册表样例 |
| `fixtures/interface-billing-api.json` | 接口注册表样例 |
| `fixtures/receipt-l0.json` | L0：A1、本地证据、采样记录、零异议自证、无 correctness case |
| `fixtures/receipt-l1.json` | L1：A2、CI 证据、轻量 correctness case、peer 人签 |
| `fixtures/receipt-l2.json` | L2：A2、双轮评审、人签、完整 correctness case 摘要 |
| `fixtures/correctness-case-l1.json` | L1 轻量 case（claims/invariants/mapping，无残差） |
| `fixtures/correctness-case-l2.json` | L2 完整 case（含人签、未过期残差） |
| `fixtures/correctness-case-l2-empty-mapping.json` | 反例：空映射，被 schema 与语义检查同时拒绝 |
| `fixtures/correctness-case-l2-unmapped-claim.json` | 反例：mapping 非空但漏掉 claim，被语义检查拒绝 |

样例中的 id、审批人、CI URL 与 hash 是合成占位，不是生产证据；不含个人信息、密钥或钱学森原文。

## 3. 回执九条拒绝规则 ↔ 字段

| # | 规则（`docs/ARCHITECTURE.md` §五） | v0 已由 schema 保证 | M2 还需的语义检查 |
|---|---|---|---|
| 1 | 证据 producer 不得为 agent；每条带 sha256 与 run_ref | `evidence[].producer` 负向前瞻拒绝 `agent`/`agent:*`；`run_ref` 非空；sha256 64 位；A2 再拒绝 `local:` | `run_ref` 可打开、内容 hash 与文件一致 |
| 2 | `signoff.by` 不得为 agent；L2 必须有人签 | enum 只能 human/ci；L2 条件强制 `signoff` 对象且 `by=human` | 身份来自 CI OIDC / 真实人类记录；等待时长与橡皮图章检测 |
| 3 | `expires_at` 缺失或过期拒绝 | 必填，date-time | 以检查时刻比较是否过期 |
| 4 | L1/L2 未检测假设 >0 且无 accepted_risk 拒绝 | 字段 `total/verified/accepted_risk` 存在且非负 | 跨字段不等式；风险接受的人签与到期 |
| 5 | L2 至少 2 轮，最后一轮 new_findings=0；dissent=0 时附「查过什么」 | L2 rounds≥2、new_findings≥2；dissent=0 条件要求 `zero_dissent_checks` | 数组末项为 0；轮次与 review 工件一致 |
| 6 | OCG/unknown 必须 L2 且人签 | 条件强制 tier=L2；再套用 L2 人签 | OCG dossier 与分类输入一致 |
| 7 | 影响未遍历或 low confidence 却声明 L0/L1 拒绝 | L0/L1 条件强制 `impact.traversed=true` 且 `confidence=high` | 影响集与注册表/CODEOWNERS 的遍历一致性 |
| 8 | sampling=sampled 时必须有抽样记录 | 条件要求 `policy.sample`；字段谁/何时/结论 | 抽样决定与策略采样率一致 |
| 9 | L2 必须有 correctness_case 并通过校验 | L2 条件强制对象；摘要字段完整；`unaccepted_residuals=0` | 摘要中的 claims/mapped 与完整 case 文件一致；证据 hash 对应 |

**M0 的诚实边界**：第 1、3、4、5、7、9 条只完成了字段与可表达性验证；真正的跨字段/文件/时钟检查在 M2。现在不得声称 `firetree_receipt` 已能执行完整校验。

## 4. correctness case v0

- 完整文件结构在 `receipt.schema.json#/$defs/correctnessCase`；回执只存摘要（路径、hash、counts）。
- 结构：`claims`（主张）→ `invariants`（不变量及强制方式）→ `mapping`（claim → invariant → tests/evidence）→ `residual`（未覆盖部分、人签、到期）。
- 校验：
  1. 每条 claim 至少一个 mapping；
  2. 每个 mapping 至少一个 invariant 与一条 evidence；
  3. mapping 引用的 claim/invariant 必须存在；
  4. residual 必须由 `human:` 接受且未过期。
- 空映射 `mapping: []` 同时触发 schema `minItems` 与语义「claim has no mapping」；`mapping` 漏掉某个 claim 时 schema 仍通过，但语义检查拒绝。这是 M0 演示「空映射被拒」的反例路径。
- 它是正确性论证的**记录**，不是数学证明；不要宣称它证明了正确性。

## 5. 策略继承

- 继承链：`policy-org.json` → `policy-repo.json` → `policy-subsystem.json`。
- `inheritance.mode = tighten_only`；子层可提高采样率、降低预算、增加触发条件。
- 放松只能通过 `exceptions[]`：必须带 `human:` 批准人、`created_at`、`expires_at`；没有到期日不成立。
- schema 拒绝 `mode` 非 `tighten_only`、`approver` 非 `human:` 的例外。

## 6. 复验

```bash
node --test test/schema-contracts.test.mjs
node --test test/schema-validator.test.mjs
```

2026-11-06 结果：`schema-contracts` 17/17 通过，`schema-validator` 4/4 通过；完整套件以 `npm test` 为准。
