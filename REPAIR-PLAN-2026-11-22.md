# FireTree-DSH 全量修复计划

> 日期：2026-11-22  
> 基线：`AUDIT-2026-11-22.md`、main `58c9c7d`  
> 目标：把“A2 原型 + 单 provider A3-AI-S”修成真正可上线、机器可审计、无需第二个人类的系统  
> 原则：先修复信任根，再谈功能；每个问题先回答经典问题，再给方案，再排期

---

## 0. 目标与非目标

### 目标

1. 生产交付使用 **A3-AI（多 provider）**，不要求第二个人类；
2. 保留 `A3` 人类签字为可选路径，但不再作为唯一生产路径；
3. 所有 gate 的信任根在 agent/PR 可写范围之外；
4. 任何“通过”都能从 clean checkout 重放；
5. 失败时 fail-closed，不靠文档或人工记忆补救。

### 非目标

- 不把 A3-AI-S 冒充 A3；
- 不增加新的业务功能；
- 不继续扩大协议范围；
- 不用“再跑一次测试”代替证据可信性；
- 不让 agent 用管理员权限绕过 required check。

### 生产声明的新定义

```text
production-ready = A3-AI
  + trusted-base deterministic evidence
  + external multi-provider review
  + attested bundle
  + protected branch required check
  + retained reproducible artifacts
```

`A3` 人类路径保留，但不是当前唯一路径。  
`A3-AI-S` 只允许 shadow / 内部使用，不得作为生产声明。

---

## 1. 全局不变量

1. **I1 验证器不执行被审对象提供的 gate 代码**；
2. **I2 证据来自 base/trusted 命令，不是 PR 自评**；
3. **I3 策略、registry、schema 来自 base 或固定 digest**；
4. **I4 证据、review、approval 都在 attested bundle 内**；
5. **I5 assurance 由 verifier 派生，不能由 caller 声明**；
6. **I6 A3-AI 至少两个独立 provider**；
7. **I7 任何缺失/未知状态 fail-closed**；
8. **I8 A3-AI-S 永不满足 `--require A3`**。

---

## 2. 问题总览与工作包

| ID | 问题 | 严重度 | 工作包 | 目标 |
|---|---|---|---|---|
| C1 | A3 human signoff 是字符串 | Critical | WS-1 | 删除自证，外部 approval |
| C2 | A2 证据来自 PR 自己的测试 | Critical | WS-2 | trusted base tests |
| C3 | A3-AI-S review 由作者提供 | Critical | WS-3 | 多 provider 独立 review |
| C4 | L2 无条件要求 AI review | Critical | WS-1 | 按 require/policy 路由 |
| C5 | registry/policy/OIDC 信任根可注入 | Critical | WS-4 | content-addressed root |
| H1 | approval CLI 不绑定 diff/assessment | High | WS-1 | 生产者/消费者一致 |
| H2 | base.ref 进入 shell | High | WS-5 | immutable base SHA |
| H3 | actions 可变 tag、branch protection 不在仓库 | High | WS-5 | SHA pin + policy as code |
| H4 | receipt assurance enum 漂移 | High | WS-1 | 单一 assurance 契约 |
| H5 | JUnit 不在 bundle、retention 不一致 | High | WS-2 | 证据入 bundle |
| H6 | docs/pilot/license 不可复现 | High | WS-6 | claim 机器校验 + 发布合规 |
| M1 | event chain 无 anchor | Medium | WS-7 | 链头入 signed receipt |
| M2 | RMW 不同锁 | Medium | WS-7 | 事务级锁/CAS |
| M3 | lock stale 逻辑 | Medium | WS-7 | lease/PID + 清理 |
| M4 | approval 不处理后续 reject | Medium | WS-1 | review timeline |
| M5 | dossier/classification 未校验 | Medium | WS-4 | hash + semantic check |
| M6 | producer blocklist | Medium | WS-2 | allowlist + claims |
| M7 | CLI/测试覆盖不足 | Medium | WS-8 | 表驱动 + 覆盖率门槛 |
| M8 | symlink 路径逃逸 | Medium | WS-4 | realpath + lstat |
| M9 | `--claims` 死路径 | Medium | WS-1 | 删除或只读信息 |

---

## 3. 每个问题的“先提问，再方案”

> 下面每个修复卡都固定回答：
> 1. 这属于什么经典问题或变体？
> 2. 有没有高效、质量极高的解决方案？
> 3. 对这个项目最优的是什么？

---

## 4. Critical 修复卡

### C1. A3 人类签字是字符串

**问题**：`firetree_review`/`firetree_receipt` 接受 agent 写的 `{by:"human", identity:"..."}`；L2 只检查 `by === "human"`。

**证据**：`src/tools/review.js:233`、`src/tools/review.js:452`、`src/tools/receipt.js:185`、`src/lib/receipt.js:300`。

#### 经典问题

- **Self-attestation**
- **Stringly-typed privilege**
- **Confused deputy**
- **未经外部验证的授权声明**

这是“被审计对象自己声明自己是人类”。

#### 候选方案

1. 给 identity 加 `^human:` 前缀；
2. 用 Ed25519 人类密钥，公钥 pin 在 policy；
3. 从 GitHub PR review / Environment API 取 approval；
4. 直接改为 A3-AI，不再要求人类。

#### 最优方案

**双轨，但都以外部工件为准：**

- **A3 人类路径**：只接受外部 approval，公钥/审查身份 pin 在 base policy；reject free string。
- **A3-AI 路径**：使用多 provider review，不经过人类签字。
- `firetree_review`/`firetree_receipt` 不再接受裸 `signoff` 作为 L2 授权；只接受 `approval_ref` 或 AI review artifact。
- 旧的人类 `signoff` 字段只用于展示/审计，不再作为 gate 条件。

#### 实施步骤

1. 删除 `PARAMETERS.signoff` 的 L2 授权语义；
2. 新增 `approval_ref`（路径 + sha256）和 `ai_review_ref`；
3. L2 receipt 必须引用其中之一；
4. `checkReceiptSemantics` 校验引用文件、digest、head/diff/assessment 绑定；
5. 迁移旧 receipt：无引用只允许 A1/A2/legacy，不允许 L2；
6. 负向测试：手写 human 字符串失败。

#### 验收

- 手写 `{by:"human"}` → 失败；
- 本地生成 key + approval → 失败；
- 外部 approval digest 不匹配 → 失败；
- A3-AI 路径无需人类，但必须多 provider；
- A3-AI 不满足 `--require A3`。

**工作量**：3–4 天。

---

### C2. A2 证据来自 PR 自己的测试

**问题**：build job 跑 PR 测试，上传 JUnit；trusted verifier 把 `ci:` producer 当 A2 证据。PR 可以删除自己的测试。

**证据**：`.github/workflows/pr-a2.yml:20,33,38`；`src/lib/assurance.js:26`；`src/lib/junit.js:143`。

#### 经典问题

- **Self-graded exam**
- **TCB inversion**
- **Evidence produced by the artifact under test**
- **Coverage theater**

#### 候选方案

1. 继续用 PR 测试，但加 coverage；
2. verifier 从 base 运行固定测试；
3. PR 只提供 artifact，verifier 在 base 代码 + PR diff 上运行测试；
4. 双跑：PR 测试仅诊断，base 测试作为 A2 证据。

#### 最优方案

**4**：

- untrusted build 仅做诊断；
- trusted verify 从 base checkout，运行 base 的固定测试命令 + PR 源码；
- A2 证据只来自 trusted 运行；
- PR JUnit 不能作为 A2 证据，不进入 `ci:` producer；
- coverage / mutation / negative tests 作为额外证据。

#### 实施步骤

1. 新增 `scripts/trusted-test-runner.mjs` 或 CI 固定命令；
2. verifier checkout base，复制 PR 变更到临时 worktree，运行 base tests；
3. 生成 trusted JUnit，写入受控 bundle；
4. PR JUnit 上传为 diagnostic，不参与 assurance；
5. producer 绑定 `run_id`/`claims_sha256`；
6. 删除测试的 PR 不能影响 trusted suite。

#### 验收

- PR 删除测试，A2 仍运行 base tests；
- 伪造 PR JUnit 不影响 A2；
- A2 证据 producer 与 OIDC claims 一致；
- coverage 有最低门槛。

**工作量**：4–5 天。

---

### C3. A3-AI-S review 由作者提供

**问题**：PR 把 `.firetree/ai-reviews/pr-N.json` 提交进 head；verifier 读取并升级 A3-AI-S。单 provider、同模型、作者可伪造。

**证据**：`.github/workflows/pr-a2.yml:71`；`src/lib/ai-review.js:20`；`docs/A3-AI.md:33`。

#### 经典问题

- **Author-controlled review**
- **Self-attestation**
- **Independence theater**
- **Confused deputy**

#### 候选方案

1. 继续单 provider，接受残余风险；
2. 多 provider 独立 review；
3. 人类 reviewer；
4. 只允许确定性工具，不允许 AI review。

#### 最优方案

**2 + 3 作为可选，但生产必须 2：**

- A3-AI-S 保留为 shadow；
- 生产 `A3-AI` 至少两个独立 provider；
- review 在 trusted workflow 生成，PR 只提供输入数据；
- review transcript 签名并进入 attestation；
- protected path 仍可要求人类/CODEOWNERS；
- 无第二 provider 时 production **NO-GO**。

#### 实施步骤

1. 新增第二个 provider（OpenAI/Anthropic/Gemini/本地）；
2. 建立 `ai-review-service`，不读 PR 生成的 review 文件；
3. PR 只传 diff/assessment；
4. service 生成两 seat + transcript，签名；
5. verifier 只接受 service attestation；
6. A3-AI-S 只用于 shadow，禁止 `--require A3-AI`。

#### 验收

- PR 伪造 review 文件 → 失败；
- 同 provider 不能产生 A3-AI；
- transcript/attestation 可验证；
- 两个 provider 的结论冲突 → 阻断。

**工作量**：5–8 天 + provider 接入；没有 provider 则无法完成。

---

### C4. L2 无条件要求 AI review

**问题**：`firetree-check` 对任意 L2 要求 AI review；`firetree-ci` 对 L2 只看 `--ai-review` 路径存在。governed A3 和 autonomous L2 被破坏。

**证据**：`bin/firetree-check.mjs:277`；`bin/firetree-ci.mjs:53`；`docs/AUTONOMOUS-MODE.md:28`。

#### 经典问题

- **Hidden mandatory dependency**
- **Over-broad gate**
- **Contract drift**
- **Fail-closed 变成不可用**

#### 候选方案

1. 所有 L2 都必须 AI；
2. 所有 L2 都必须人类；
3. 按 `--require`/policy 路由；
4. 按 tier + change type 路由。

#### 最优方案

**3 + 4**：

```text
--require A2              → 不要求 AI
--require A3              → 人类 approval
--require A3-AI-S         → 单 provider AI
--require A3-AI           → 多 provider AI
policy.production_assurance → A3-AI
```

`firetree-ci` 只在对应 require 时校验 review；不再用 tier 单独强制。

#### 实施步骤

1. 从 `check` 删除无条件 L2 AI 要求；
2. 在 policy 增加 `assurance_route`；
3. `firetree-ci` 增加 `--require` 或读取 policy；
4. 增加 L2 governed/autonomous/A3-AI 矩阵测试；
5. 文档同步。

#### 验收

- L2 human receipt 无 AI review 可通过 A3；
- L2 autonomous 可 A2；
- A3-AI 只有显式 require 才强制；
- 所有路径有端到端测试。

**工作量**：2 天。

---

### C5. 信任根可注入/替换

**问题**：`registry_root` 任意路径；git guard 只看根 `.git`；OIDC repository 可选；generated `.firetree` 被排除；signer workflow 可选。

**证据**：`src/tools/assess.js:175,176`；`bin/firetree-check.mjs:117`；`src/lib/git.js:85`；`src/lib/attestation.js:64`。

#### 经典问题

- **Config injection**
- **Mutable trust root**
- **TOCTOU**
- **Self-referential attestation**

#### 候选方案

1. 只信任 repo root；
2. 固定 policy/registry digest；
3. 从 base 读 policy/registry；
4. 全部组合。

#### 最优方案

**4**：

- registry_root 必须是 repo root 或固定 digest；
- `git rev-parse --is-inside-work-tree` 探测；
- OIDC 强制 repository + workflow_ref；
- generated artifacts 从 base/trusted bundle 读取；
- policy/registry/schema digest 写进 assessment/receipt；
- signer workflow 必填。

#### 实施步骤

1. `assess` 用 `resolveWithin` + realpath；
2. 记录 `registry_digest`；
3. `git.js` worktree 探测；
4. `firetree-check` 强制 repo/workflow/signer；
5. base artifact loader；
6. 增加注入攻击测试。

#### 验收

- `/tmp/evil` registry → 失败；
- 子目录 workspace → 强制 git；
- 错 repo OIDC → 失败；
- 修改 assessment 不改 diff → 检测；
- 验证器从 base 读 policy。

**工作量**：4–5 天。

---

## 5. High 修复卡

### H1. approval CLI 不绑定 diff/assessment

**经典问题**：Producer/consumer contract mismatch。

**最优方案**：approval CLI 读 assessment，填 `diff_sha256`/`assessment_sha256`；`verifyApproval` 对缺失字段给出明确 gap。

**验收**：正常 assessed change 的 approval 能通过；伪造 diff → 失败。

**工作量**：1 天。

---

### H2. base.ref 进入 shell

**经典问题**：Command injection / CWE-78。

**最优方案**：使用 `github.event.pull_request.base.sha`；ref 通过 env 传入并 allowlist；禁止 `${{ }}` 直接拼进 `run:`。

**验收**：恶意 ref 不执行；base SHA 与 checkout/claims 一致。

**工作量**：1 天。

---

### H3. Actions 可变 tag / branch protection 不在仓库

**经典问题**：Mutable supply chain；security config outside VCS。

**最优方案**：SHA pin；Dependabot/Renovate；branch protection as code；CODEOWNERS 多 owner；required checks `firetree-a2` + `ci`。

**验收**：所有 `uses:` 40 位 SHA；规则可重放；直接 push main 被拒。

**工作量**：2 天 + 管理员配置。

---

### H4. receipt assurance enum 漂移

**经典问题**：Enum/contract drift；self-declared assurance。

**最优方案**：单一 assurance 模块；`claimed_assurance` 与 `derived_assurance` 分离；receipt/technical evidence enum 同步；A3-AI 摘要持久化。

**验收**：所有合法 assurance 都能 schema 验证；caller 声明不能超过 derived；A3-AI-S 可持久化。

**工作量**：2 天。

---

### H5. JUnit 不在 bundle、retention 不一致

**经典问题**：Attestation scope / retention mismatch。

**最优方案**：JUnit 进 bundle 或同时 attest；retention 统一 90 天；manifest 覆盖所有重放所需文件。

**验收**：30 天后仍可重放；bundle 重算通过。

**工作量**：1 天。

---

### H6. docs/pilot/license 不可复现

**经典问题**：Documentation drift；evidence theater；release hygiene。

**最优方案**：

- claims 机器校验；
- ARCHITECTURE/AUTONOMOUS/REPAIR/README 统一；
- pilot artifacts 入库或提供可验证位置；
- LICENSE/NOTICE/CHANGELOG/SECURITY；
- release workflow。

**验收**：docs 中的每个“implemented”有命令；pilot 数字可重算；license 文件存在。

**工作量**：3–4 天。

---

## 6. Medium 修复卡

### M1. event chain 无 anchor

**经典问题**：Unanchored append-only log / rollback。

**最优方案**：chain head 写入 signed receipt；或 HMAC + CI key；check 时比较。

**验收**：删除尾部事件 → 失败；重写链 → 失败。

**工作量**：1–2 天。

---

### M2. RMW 不同锁

**经典问题**：Lost update / TOCTOU。

**最优方案**：整个 read-modify-write 持一把锁，或 CAS（expected previous sha256）；assess/review/synthesize/hypothesis 全部改。

**验收**：并发 add/review/assess 无重复编号、无丢失。

**工作量**：2–3 天。

---

### M3. lock stale 逻辑

**经典问题**：Unsafe stale-lock reclamation；resource leak。

**最优方案**：lease 刷新/PID 存活检查；创建+写入 try/finally；失败清理。

**验收**：长操作不被误删；异常后不留锁。

**工作量**：1 天。

---

### M4. approval 不处理后续 reject

**经典问题**：Stale approval acceptance。

**最优方案**：拉 review timeline；后出现的 CHANGES_REQUESTED/DISMISSED 使 approval 失效；缺失时间戳拒绝而不是 now。

**验收**：后审撤销前审；伪造时间失败。

**工作量**：1–2 天。

---

### M5. dossier/classification 未校验

**经典问题**：Provenance field copied without verification。

**最优方案**：hash `.firetree/oid/<id>.json` 并与 dossier_sha256 比较；check 验证 classification。

**验收**：假 dossier hash 失败。

**工作量**：1–2 天。

---

### M6. producer blocklist

**经典问题**：Denylist identity bypass。

**最优方案**：allowlist + 绑定 OIDC/attestation。

**验收**：`my-agent` 不能通过。

**工作量**：1 天。

---

### M7. CLI/测试覆盖不足

**经典问题**：Test theater；untested entry points。

**最优方案**：五个 CLI 表驱动 spawn 测试；coverage 阈值；多 provider/L2/并发/fuzz 测试；prose tests 移出。

**验收**：所有 CLI `--help`/错误/成功路径；coverage 门槛。

**工作量**：3–4 天。

---

### M8. symlink 路径逃逸

**经典问题**：Symlink path traversal。

**最优方案**：lexical + realpath + lstat 拒绝 symlink。

**验收**：仓库 symlink 不能读外部。

**工作量**：1 天。

---

### M9. `--claims` 死路径

**经典问题**：Dead/misleading interface。

**最优方案**：删除或只读诊断，不能影响 A2。

**验收**：`--claims` 不再产生“通过”。

**工作量**：0.5 天。

---

## 7. 依赖关系与排期

```text
Phase 0  声明冻结/隔离 A3-AI-S
   ↓
Phase 1  C4, C5, H1, H2
   ↓
Phase 2  C1, C2, H4, H5
   ↓
Phase 3  C3 (第二 provider), H3, H6
   ↓
Phase 4  M1–M9
   ↓
Phase 5  真实试点 4–8 周
```

### 建议工期

| 阶段 | 内容 | 工期 |
|---|---|---|
| Week 0 | 冻结错误声明；A3-AI-S 只 shadow | 2–3 天 |
| Week 1 | C4、C5、H1、H2 | 1 周 |
| Week 2 | C1、C2、H4、H5 | 1 周 |
| Week 3 | C3 + 第二 provider、H3 | 1–2 周 |
| Week 4 | H6、M1–M6 | 1 周 |
| Week 5 | M7–M9、回归、clean checkout | 1 周 |
| Week 6–13 | 2 仓库试点、修复、Go/No-Go | 4–8 周 |

**现实总工期：8–13 周，2 名工程师 + 第二模型 provider。**  
没有第二 provider 时，A3-AI 无法完成，生产仍是 **NO-GO**。

---

## 8. 验收标准与 Go / No-Go

### 工程验收

- [ ] A3 free-string 签字被删除或失效；
- [ ] L2 governed 可走人类，A3-AI 可走多 provider，互不干扰；
- [ ] A2 由 trusted base tests 产生，PR 不能自评；
- [ ] A3-AI review 不在 PR 文件里，由 trusted service 生成；
- [ ] registry/policy/OIDC/attestation 全部 pin；
- [ ] JUnit 在 attested bundle 内，90 天可重放；
- [ ] branch protection as code，required checks 可重建；
- [ ] all actions SHA-pinned；
- [ ] event chain anchored；RMW 原子；lock lease；
- [ ] CLI/覆盖率/并发/攻击测试通过；
- [ ] clean checkout 能重放 governed check。

### 安全验收

- [ ] 伪造 human signoff → 失败；
- [ ] 伪造 approval/key → 失败；
- [ ] 删除测试的 PR → A2 失败；
- [ ] 伪造 AI review → 失败；
- [ ] 同 provider 冒充 A3-AI → 失败；
- [ ] 恶意 base ref → 不执行；
- [ ] 改 assessment 不改 diff → 检测；
- [ ] symlink/registry_root 逃逸 → 失败。

### 发布/组织

- [ ] LICENSE/NOTICE/CHANGELOG/SECURITY；
- [ ] package license/engines/packageManager 一致；
- [ ] 2 仓库、50–100 PR、10 个 L2 试点；
- [ ] false-block/延迟/L2 比例/成本指标；
- [ ] 回滚、备份、事故 runbook。

### 最终判断

```text
全部 Critical + High + M1–M9 关闭
AND 多 provider A3-AI 可用
AND 50+ PR 试点完成
AND license/release 完成
→ 才可称 production-ready
```

否则：

```text
只可称 A2 + A3-AI-S shadow 原型
```

---

## 9. 风险与取舍

| 风险 | 影响 | 应对 |
|---|---|---|
| 第二 provider 不可用 | A3-AI 无法完成 | 生产保持 NO-GO；A3-AI-S 仅 shadow |
| AI review 成本高 | 延迟/费用 | 只对 L2 / protected path 运行 |
| 多 provider 结论冲突 | 阻断增加 | 分歧即 fail-closed，人工/额外轮次 |
| 移除 free signoff 破坏旧流程 | 迁移成本 | 提供 legacy A2 过渡，不允许 L2 |
| branch protection 管理员绕过 | 控制失效 | ruleset + bypass list 留空 + 审计 |
| 误拦过多 | 团队绕过 | shadow→warn→enforce，预注册阈值 |
| 文档/试点造假 | 失去可信度 | claim 机器校验、artifact 留存 |

---

## 10. 现在不要做的事

1. 不要把 A3-AI-S 改名为 A3；
2. 不要给 agent 管理员 token 来“自动合并”；
3. 不要继续用 PR 自己的 JUnit 当 A2；
4. 不要让 PR 提交 review artifact；
5. 不要在 L2 上无条件强制 AI；
6. 不要先加功能再修信任根；
7. 不要把“测试绿”当“可审计”。

---

## 11. 立刻执行的 10 个动作

1. 生产声明降级：A3-AI-S 只 shadow；
2. 移除 free-form human signoff 的 gate 语义；
3. 移除 L2 无条件 AI review，改显式 require；
4. trusted verify 跑 base tests，PR JUnit 仅诊断；
5. 固定 registry_root/policy/OIDC/base SHA；
6. 让 AI review 由 trusted service 生成，PR 不提供；
7. JUnit 放进 attested bundle；
8. SHA-pin actions，branch protection as code；
9. 加 LICENSE/NOTICE，更新 docs/claims；
10. 接入第二个模型 provider，目标 A3-AI。

> 本计划的核心不是再加机制，而是把**验证权、策略权、证据权、复审权**从 agent/PR 手里拿走。  
> 在这之前，A3-AI-S 只是可运行的机器流程，不是独立审计。
