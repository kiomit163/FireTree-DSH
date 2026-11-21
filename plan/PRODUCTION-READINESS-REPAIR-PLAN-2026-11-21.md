# FireTree-DSH 生产上线修复计划

> 日期：2026-11-21  
> 基线：`main` / `9d19ed5`  
> 依据：[AUDIT-2026-11-18.md](../AUDIT-2026-11-18.md)、[REPAIR-STATUS.md](REPAIR-STATUS.md)、2026-11-21 全项目深度盘点  
> 目标：从“高质量的 A1/A2 技术原型”变成“可以被一个真实团队用于 governed delivery 的生产系统”。

---

## 0. 先定义“上线”是什么

本计划里的“上线”不是“插件能安装”，也不是“CI 绿”，而是：

```text
一个真实变更
→ 变更集可被独立重算
→ 证据来自可验证的 CI 身份
→ 人签来自 agent 之外
→ 所有工件可留存、可在 clean checkout 重放
→ 失败时能阻断，成功时能解释
```

因此本计划把“生产可用”拆成五个 gate：

| Gate | 问题 | 不通过就不能上线的原因 |
|---|---|---|
| G1 变更真实性 | 回执是否真的绑定了 git diff | 否则业务可以“只交一个文件”通过 |
| G2 身份真实性 | 证据是否真的来自 CI | 否则 agent 可以伪造 A2 |
| G3 人类真实性 | 签字是否真的来自独立人类 | 否则 A3 是自签 |
| G4 审计留存 | 6 个月后还能不能重放 | 否则“可审计”只在当天成立 |
| G5 组织可用性 | 仓库自己的 PR 能不能通过、误拦是否可接受 | 否则上线即被绕过或拖死 |

**当前结论：G1–G5 均未完全通过；P0 未清除前只允许 shadow，不允许生产准入。**

---

## 1. 目标架构：先移动信任根，再谈功能

### 1.1 现在的信任边界

```text
PR 代码
  ├─ 修改 policy / registry / CODEOWNERS
  ├─ 修改 verifier 脚本
  ├─ 写 claims.json
  └─ 运行 firetree-check
        ↓
   同一个 job 输出“绿”
```

这是 pwn request / TCB 污染的典型形态：被审对象控制了验证器。

### 1.2 目标信任边界

```text
┌──────────────────────────────┐
│ Untrusted PR build            │
│ - 只跑测试/构建               │
│ - 无 id-token / secrets       │
│ - 产出 JUnit 与 artifact      │
└──────────────┬───────────────┘
               │ artifact (digest)
┌──────────────▼───────────────┐
│ Trusted verifier              │
│ - 从 base/default SHA 取代码  │
│ - base policy / registry      │
│ - 验 OIDC JWT（JWKS）         │
│ - 验 evidence / bundle        │
│ - 调 approval API             │
│ - 输出 required check         │
└──────────────┬───────────────┘
               │ receipt / bundle digest
┌──────────────▼───────────────┐
│ Human approval                │
│ - PR review / environment     │
│ - 独立 reviewer               │
│ - 绑定 head/diff/bundle       │
└──────────────┬───────────────┘
               │ approval record
┌──────────────▼───────────────┐
│ Evidence store                │
│ - artifact retention          │
│ - WORM / external store       │
│ - replay + re-hash            │
└──────────────────────────────┘
```

### 1.3 不可妥协的 8 条不变量

1. **I1 变更必须来自 git**：L1/L2 不接受调用方自报 `files`。
2. **I2 验证器不执行被审代码**：OIDC/verify job 不 checkout PR 代码。
3. **I3 策略来自可信基线**：base policy/registry/CODEOWNERS，不是 PR 工作树。
4. **I4 身份必须验签**：JWT 用 GitHub JWKS 验签，校验 `exp/aud/run_id/workflow_ref`。
5. **I5 证据必须绑定**：`diff_sha256 → assessment_sha256 → evidence_sha256 → bundle_digest` 链式可重算。
6. **I6 人签必须外部**：agent 写的 `human:*` 不算；必须来自 GitHub API/签名记录。
7. **I7 工件必须留存**：clean checkout 能下载并重放 governed check。
8. **I8 失败关闭**：缺 sidecar、缺 approval、缺 bundle、未知状态一律 fail。

---

## 2. 每个问题先问三句

> 对每个 finding，固定先回答：
> 1. **这属于什么经典问题或变体？**
> 2. **有没有优秀的解决方案？**
> 3. **怎样才能做到最优？**
>
> 下面是工作包。每个工作包给出“覆盖的发现、经典问题、候选方案、选择、实现步骤、验收测试”。

---

## 3. 工作包 A：可信验证架构（P0-1、P0-2、P1-8、P1-9）

### WP-A1 把 verifier 移出 PR 代码 / PR 策略

**覆盖发现**

- P0-1：PR gate 运行 PR 代码、加载 PR policy/registry；
- P0-4 的一部分：`.firetree/**` 被排除在 diff 外；
- P1-9：可变 action tag、PR 代码在 `id-token: write` job 中运行。

**经典问题**

- **Pwn request / confused deputy**：高权限 verifier 执行低信任输入；
- **Policy injection**：被审对象控制策略文件；
- **TCB contamination**：验证器与被验证对象共享同一工作区。

**候选方案**

1. `pull_request_target` + checkout PR head：**拒绝**，经典 pwn request；
2. 同一个 `pull_request` job 里 checkout base 做验证：可行，但构建/验证仍耦合；
3. **拆成 untrusted build + trusted `workflow_run` verifier**：推荐；
4. verifier 从 base SHA checkout，PR 只作为数据（diff/artifact），不执行 PR 脚本：推荐。

**最优选择**

采用 3 + 4：

- `pr-build.yml`（untrusted）：
  - 无 `id-token`、无 secrets、无 write；
  - 跑 `node --test --test-reporter=junit`；
  - 产出 JUnit、coverage/SARIF/SBOM，上传 artifact；
  - 只记录 `head_sha`、`base_sha`、artifact digest。
- `pr-verify.yml`（trusted）：
  - 由 `workflow_run` 触发；
  - 从 `main`/base SHA checkout verifier；
  - 从 `git show base:.firetree/...` 读取 policy/registry；
  - 下载 artifact，验 hash；
  - 调 `firetree-assess`（mandatory git）、`firetree-check`；
  - 输出 required check；
  - 无 PR 代码执行。
- 对 `.firetree/policy.json`、registry、CODEOWNERS、`.github/workflows/**` 变更单独做 **protected-policy review**，不能静默排除。

**实现步骤**

1. 新增 `pr-build.yml`，删掉 `pr-a2.yml` 中运行 verifier 的步骤；
2. 新增 `pr-verify.yml`，固定 `permissions: contents: read` + `id-token` 仅验证 job；
3. 在 verifier 中用 `git show <base>:...` 写临时 base policy/registry；
4. `changedFiles` 不再排除 `.firetree/**` 用于“策略变更检测”，但策略文件本身走单独保护路径；
5. 增加 artifact 下载后的 SHA-256 校验；
6. 所有 `uses:` 固定到 full commit SHA（A4 一并做）。

**验收 / 攻击测试**

- `attack-policy-tamper`：PR 改 policy 为 L0，verifier 仍使用 base policy，gate 失败；
- `attack-verifier-tamper`：PR 改 `firetree-check`，trusted verifier 不受影响；
- `attack-pr-code-oidc`：PR 脚本尝试篡改 claims，verifier 不读 PR 脚本；
- required check 在 PR 上必须出现，且 `skipped` 不能算通过；
- 验证 PR 不执行任何来自 PR 的 `node`/shell 脚本。

**工作量**：3–5 天。

---

### WP-A2 OIDC JWT 真验签

**覆盖发现**

- P0-2：decode-only claims、无 exp、无 JWKS、无 run 绑定。

**经典问题**

- **JWT theater**：只 base64 decode，不验签；
- **Replay**：无 `exp/nbf/iat/jti`；
- **Forgeable provenance**：claims 是可写 JSON。

**候选方案**

1. 继续用 claims JSON + 手工字段检查：**不满足**；
2. 用 `jose` / `jwks-rsa` 验 GitHub JWKS 签名：最小正确方案；
3. 直接用 OIDC token + GitHub attestation：更强；
4. 自建 PKI：**拒绝**，不要重造 Sigstore。

**最优选择**

2 + 3：

- `github-oidc.mjs` 保存 **raw JWT**，不先转成 claims；
- `identity.js` 用 `jose.jwtVerify`：
  - issuer `https://token.actions.githubusercontent.com`；
  - JWKS 从 GitHub OIDC discovery 缓存；
  - `aud` 必须包含 firetree；
  - `exp/nbf/iat` 必须有效；
  - `repository`、`workflow_ref`、`sha`、`run_id`、`run_attempt` 必须匹配 run；
  - 允许的 `workflow_ref` 从 policy 读取，不在 CLI 由调用方随意传；
- 把 `claims_sha256` / `jwt_hash` 写进 assessment/receipt；
- 任何没有签名验证的 claims 文件最高 A1；
- A2 最终由 attested evidence 作为第二证据。

**实现步骤**

1. 引入 `jose`（或 Node crypto + JWKS，禁止手写 JWT 解析）；
2. 新增 `verifyGithubJwt`，返回 `{claims, claimsSha256}`；
3. `firetree-check --claims` 改为 `--jwt`，或自动识别；
4. 增加 `--workflow-ref` / `--run-id`，由 verifier 从 policy/run 上下文提供；
5. 拒绝过期 claims（加测试）；
6. 把 `claimsSha256` 写进 `assessment.git` 或 `receipt.provenance`。

**验收测试**

- 伪造 payload、无签名 JWT → A2 失败；
- 过期 `exp` → 失败；
- `aud` 不匹配 → 失败；
- `run_id` 不匹配 → 失败；
- 合法 GitHub token → A2 派生成功。

**工作量**：2–3 天。

---

## 4. 工作包 B：变更与证据完整性（P0-4、P0-5、P1-3、P1-4、P1-5、P1-6）

### WP-B1 强制 git 绑定与 diff 链

**覆盖发现**

- P0-4：`verify_git` 可选，receipt 无 diff/tree，check 不重跑 git；
- P1-6：registry/classification 未 enforcement（与 B5 联动）。

**经典问题**

- **TOCTOU / self-described scope**：调用方告诉审计器“改了哪些文件”；
- **Binding gap**：receipt 只绑 assessment 的 hash，不绑 git tree。

**候选方案**

1. 保持 `verify_git` 可选：**不满足生产**；
2. 强制 git 验证，非 git 变更只能 A0/analysis：推荐；
3. 由 CI 在独立 job 计算 diff，verifier 重算：必须；
4. change id 从 diff 派生：推荐。

**最优选择**

2 + 3 + 4：

- `verify_git` 默认 true；`--no-verify-git` 删除或只能生成 A0 分析工件；
- `assess` 写入 `base/head/tree_sha/diff_sha256/files_sha256`；
- `receipt` 增加 `change.tree_sha/diff_sha256`，check 重算；
- `change = chg-<diff_sha256 前 12 位>`，禁止调用方任意 id（至少新 change 不允许）；
- policy/registry/schema 文件也纳入 diff 或单独的 protected policy gate。

**实现步骤**

1. `assess` 强制 `verify_git`（或显式 `declared:true` 只允许 A0）；
2. `receipt.schema` 增加 `diff_sha256/tree_sha`；
3. `receipt` build 复制 assessment 的 git 字段；
4. `check` 调 `verifyGitChange(base,head,files)`，不匹配即 gap；
5. 迁移旧 receipt：没有 diff 的只允许 A1/legacy，不能进生产。

**验收测试**

- 伪造 base/head/files → 失败；
- 只改 files 列表少报一个文件 → 失败；
- receipt 与 assessment diff 不一致 → 失败；
- change id 从 diff 派生，不由调用方重掷采样。

**工作量**：2–3 天。

---

### WP-B2 证据：拒绝远程 fail-open，补 parser 语义

**覆盖发现**

- P0-5：URL evidence 不 fetch、JUnit 根计数、coverage >100、SARIF/SBOM shape-only；
- P2：JSON 深度、`files_sha256` newline、bundle localeCompare。

**经典问题**

- **Unverified external reference**：URL 不是证据；
- **Parser trust mismatch**：根属性与元素数量不一致；
- **Goodhart’s law**：证据存在 ≠ 证据通过。

**最优选择**

- governed 模式**拒绝 `http(s)` evidence**；只接受 bundle 内文件或 attestation 覆盖的 artifact；
- 若必须支持 URL：allowlist + timeout + max bytes + 下载后 hash；
- JUnit：
  - 读 `<testsuites tests failures errors>` 根属性；
  - 双向核对 declared vs collected；
  - 失败/错误元素和属性任一非零都拒绝；
  - 用文件大小上限 + 流式/深度上限，避免 parse 后 OOM；
- coverage：
  - 0–100；
  - policy 增加 `minimum_coverage`，低于阈值失败；
- SARIF：
  - 按 severity/level 阈值；
- SBOM：
  - 校验 packages/components，并至少检查 vuln/license 字段（按 policy）；
- 所有 parser 加 fuzz/property tests。

**验收测试**

- `https://evil` + 任意 sha → governed 失败；
- `<testsuites tests="3" failures="2">` → 失败；
- `LF:1 / LH:5` → 失败；
- coverage 0% 带阈值 → 失败；
- 10MB/深层 XML/JSON → 快速失败，不 OOM；
- 合法 JUnit/SARIF/SBOM/coverage → 通过。

**工作量**：3–4 天。

---

### WP-B3 原子工件、锁、事件链

**覆盖发现**

- P1-3：event chain 可被 `...event` 覆盖，读改写无锁；
- P1-4：JSON 与 `.sha256` 分两次写，无 fsync，无 per-change lock；
- P2：bundle localeCompare、files hash newline、JSON 深度。

**经典问题**

- **Non-atomic write / lost update**；
- **TOCTOU**；
- **Hash-chain forgery**。

**最优选择**

- 单 JSON envelope：`{sha256, payload}` 一次原子 rename；
- 写文件 + 目录 `fsync`；
- per-change lock（`mkdir` 或 `O_EXCL`），超时/重试；
- event append：
  - 字段白名单，禁止 `...event` 覆盖 `seq/prev`；
  - 锁内读最后 hash + append；
  - 定期 checkpoint / 外部锚定；
- bundle 路径排序用 `codepoint`（`<`），不用 `localeCompare`；
- `files_sha256` 用 `canonicalJson(files)`，不用 `join('\n')`；
- 给并发 assess/review/event 加测试。

**验收测试**

- 100 个并发 append → seq 连续、无分叉；
- 两个并发 assess → 无 lost update；
- 崩溃注入（写后/rename 前）→ 可恢复或明确 fail；
- 事件字段篡改 → 拒绝；
- Ubuntu/Windows 生成同一 bundle digest。

**工作量**：3–4 天。

---

### WP-B4 sidecar 与 state 默认验证

**覆盖发现**

- P1-5：缺 sidecar 默认信任；state 读 receipt 不验 hash。

**经典问题**

- **Fail-open integrity check**；
- **Observability projection 未验证源**。

**最优选择**

- `readFiretreeJson` 默认 `verifyHash:true`；
- 只有迁移/legacy 用显式 `trustUnverified:true`；
- `state` 所有 artifact 都验 sidecar+schema；缺 hash 显示 `invalid`，不是 `present`；
- sidecar 使用单 envelope 后，不存在“缺 sidecar”路径。

**验收测试**

- 删除 `.sha256` → 读取失败；
- 篡改 JSON → state 不显示 present；
- 旧 legacy 显式迁移才允许无 hash。

**工作量**：1–2 天。

---

### WP-B5 registry / dossier / classification / depends_on

**覆盖发现**

- P1-6：classify 的 `allowed` 没被 assess/receipt 使用；dossier hash 不校验；subsystem.depends_on 未用；
- P1-1：registry 冷启动。

**经典问题**

- **Dead policy / control not wired**；
- **Object-identification bypass**：agent 可把 OCG 说成 simple。

**最优选择**

- `loadRegistry` 校验 subsystem.dossier.path 存在且 hash 匹配；
- `assess` 读取 dossier，若 `kind=open-complex-giant/unknown` 或 `requires_human_signoff`，强制 L2/governed；
- `receipt` 要求 classification（L2），并验证 `dossier_sha256`；
- impact 使用 subsystem.depends_on 做反向依赖遍历；
- registry coverage lint：
  - 所有 tracked 路径映射到 subsystem 或显式 allowlist；
  - 未映射 → 明确 L2，不是静默 unknown；
  - bootstrap 报告人工确认后才进 registry。

**验收测试**

- OCG dossier → L2，autonomous 拒绝；
- 假 dossier hash → 失败；
- package.json/CODEOWNERS/plan 的路径有明确策略；
- depends_on 消费者被拉入 impact；
- registry coverage 100%。

**工作量**：3–5 天。

---

## 5. 工作包 C：人类审批与 A3（P0-3、P0-6、P1-7）

### WP-C1 外部 approval，删除字符串签字

**覆盖发现**

- P0-3：`human:*` 字符串、A3 approval 不绑定、`state undefined`、approval 不 attest；
- P1-7 的一部分：review seats 可伪造。

**经典问题**

- **Self-declared authorization / rubber stamp**；
- **Approval-of-run ≠ approval-of-artifact**。

**候选方案**

1. 继续 `by:'human'`：**淘汰**；
2. Ed25519 人类密钥：可行但分发/轮换复杂；
3. GitHub PR review API / environment approvals：推荐；
4. 企业 SSO/审批系统 webhook：后续。

**最优选择**

3：

- `firetree_receipt build` 不再接受裸 `signoff`；
- 输入 `approval_ref`/`approval`，验证：
  - `reviewer` 是组织允许的 reviewer；
  - `head`/`diff_sha256`/`assessment_sha256` 匹配；
  - `run_id`/environment 匹配；
  - source 为 GitHub PR review 或 environment approval；
- approval 文件必须来自受信任脚本（trusted verifier），并有 `approval_sha256`；
- approval 进入 final bundle，attestation 覆盖 bundle manifest；
- 环境必须：`Prevent self-review: true`、至少 2 名 reviewer、`can_admins_bypass: false`；
- `approval.js` 删除 `state === undefined` 的 fail-open；
- 审批时间不可得时明确标记 `observed_at`，不要伪装成 GitHub 原始时间。

**验收测试**

- 手写 `{by:'human',identity:'human:a'}` → 失败；
- approval head/bundle 不匹配 → 失败；
- 自审批 → 失败（independent reviewer check）；
- 同一 approval 复用到另一个 change → 失败；
- environment approval 成功 → 通过。

**工作量**：3–5 天。

---

### WP-C2 A3 只允许 governed receipt

**覆盖发现**

- P0-6：autonomous A3、docs 禁止 A3、fixture smoke、无留存；
- P0-7 的一部分：A3 无 artifact。

**经典问题**

- **Spec/implementation drift**；
- **Demo-driven development**：把 plumbing 当协议能力。

**最优选择**

- `firetree-check --mode autonomous --require A3` 直接拒绝；
- 新增/明确 `mode=governed` A3；
- `technical-evidence` 保持 A1/A2；
- `a3-keyless` 改名为 `keyless-attestation-smoke`，不再输出 A3；
- 真正的 `a3-governed` workflow：
  - governed assessment/review/correctness/signoff；
  - environment approval；
  - bundle includes approval；
  - attest bundle manifest；
  - check A3；
  - upload artifacts；
- A3 只在 release/tag 或高风险变更上运行，不是每个 PR。

**验收测试**

- autonomous A3 → 失败；
- governed A3 + 独立 approval + attestation → 通过；
- clean checkout 下载 artifact 重放 → 通过；
- A3 artifact 有 retention 记录。

**工作量**：3–5 天（依赖 C1 / E1）。

---

### WP-C3 L2 独立席位与 synthesis 真实性

**覆盖发现**

- P1-7：seats/provider/model 是字符串；无真实多模型/多 agent 证据。

**经典问题**

- **Independence theater**；
- **Self-attestation of multi-agent evidence**。

**最优选择**

- 短期：synthesis/classification 标为 **advisory**，不作为 L2 gate；
- 中期：如果 DSH 提供真实 subagent/run ID，要求记录 `agent_id/provider/model/transcript_hash`，并在 verifier 侧可查；
- 长期：L2 需要至少 2 个真实独立席位 + 1 个 data seat，否则 L2 不通过；
- 若无法验证，写清楚“advisory”，不要声称独立评审。

**验收测试**

- 伪造两个 model 字符串 → 不能通过 L2；
- 真实 subagent 记录 → 可验证；
- 无独立证据 → L2 失败/降级。

**工作量**：2–4 天（取决于 DSH subagent 可观测性）。

---

## 6. 工作包 D：策略与仓库自治理（P1-1、P1-2）

### WP-D1 Registry 覆盖与冷启动

**覆盖发现**

- P1-1：package.json/CODEOWNERS/plan 等 unknown L2，PR gate 不能过自己的仓库。

**经典问题**

- **Cold-start registration gap**；
- **Fail-closed becoming unusable**。

**最优选择**

- 生成 registry 覆盖全部 tracked 路径；
- 先 `bootstrap-registry` 生成候选，人工确认；
- 每类路径有明确策略（L0/L1/L2/unknown），unknown 不用“静默 L2”拖死 adoption；
- CI 加 `registry-coverage` check：看到未映射路径直接失败并给出修复提示；
- L2 变更走 governed workflow，不假装 PR gate 能自动过；
- shadow 阶段只 warn，不阻断。

**验收**

- registry 覆盖 100%；
- 任意 tracked 文件 assess 不再 unknown；
- package.json 等 L2 有文档化处理路径；
- 新 PR 不再因为“scope 不在 registry”误拦。

**工作量**：2–3 天。

### WP-D2 抽样与 policy floor

**覆盖发现**

- P1-2：`.firetree/policy.json` L0 sample_rate=0，关闭了 10% 人类 spot-check。

**经典问题**

- **Control erosion / Goodhart**：为了让 gate 绿而降低控制。

**最优选择**

- 恢复 L0 10% 抽样；
- `policy-chain` 增加 floor：L0 sample_rate 不得低于 org 设置（除非有 expiring exception 且人工批准）；
- `test/policy-floor.test.mjs` 验证 child 不能降级；
- 采样记录必须进入 receipt/review。

**工作量**：1 天。

---

## 7. 工作包 E：留存、发布与运维（P0-7、P1-8、P1-9、P1-10、P1-11、P1-12、P1-13）

### WP-E1 审计留存

**覆盖**：P0-7。

**经典问题**：audit log evaporation / no non-repudiation。

**最优选择**

- CI `upload-artifact`：`.firetree/**`、JUnit、bundle、attestation；
- retention 至少 400 天（或组织策略）；
- 外部 WORM（S3 Object Lock / GitHub release asset / Rekor）；
- receipt 记录 `retention_uri`、`retention_until`；
- scheduled `verify-retained` workflow 重放并 re-hash；
- clean checkout + download bundle 能过 governed check。

**验收**

- A3 run 有 artifact；
- 90 天后仍可拉取；
- 外部存储失败时 fail closed。

**工作量**：2–3 天 + 存储配置。

### WP-E2 文档真值与 claims

**覆盖**：P1-10。

**经典问题**：documentation drift / claims inflation。

**方案**

- 统一 `docs/CLAIMS.md` 为唯一对外主张表；
- 每行绑定一个可执行命令/测试；
- `scripts/check-claims.mjs` 运行命令并比对，失败则 CI 失败；
- 删除 v0 旧文/加 `SUPERSEDED` 标记；
- README 的 M1/M2、A3、pilot 数字全部以当前实现为准；
- `plan/REPAIR-STATUS` 自动从测试/运行结果生成关键数字。

**验收**

- 文档中的 “implemented” 有命令；
- “partial” 有缺口；
- 没有 “A3 未实现” 和 “A3 已落地” 同时存在；
- 40 docs / links / claims 全绿。

### WP-E3 测试与覆盖率

**覆盖**：P1-11。

**经典问题**：test-count theater / coverage illusion。

**方案**

- 区分 docs lint 与运行时测试；
- 给 `src/lib` 设 line/branch 阈值（例如 line 90 / branch 75，按实际达成逐步提高）；
- 增加：
  - attack tests（P0-1/2/3/4/5）；
  - concurrency tests；
  - fuzz JUnit/SARIF/JSON；
  - e2e git + governed + A3；
  - migration/metrics/SPC/bootstrap/CLI tests；
  - load tests（assess/check p95）；
- CI 跑 coverage 并上传 report。

**验收**

- 所有 P0 attack test 在 CI；
- 覆盖率门槛进 CI；
- 4/5 CLI 有直接测试；
- 并发/崩溃注入至少一组。

### WP-E4 许可证、包、版本、迁移

**覆盖**：P1-12。

**经典问题**：unlicensed distribution / version skew / irreversible migration。

**方案**

- 选 Apache-2.0（建议），加 LICENSE、NOTICE、THIRD-PARTY；
- BMAD/superpowers MIT 归属；
- `package.json`：repository/homepage/engines.dsh/author/version；
- 每个 artifact 记录 `generator_version`/`schema_version`；
- v0→v1 迁移测试 corpus，拒绝/转换行为有测试；
- 升级/回滚 smoke；
- release checklist。

**验收**

- `npm pack` 包含 LICENSE/README；
- 旧 artifact 迁移可重放；
- 升级/回滚演练通过；
- 法务确认后再发布。

### WP-E5 运维、性能、事故

**覆盖**：P1-13。

**经典问题**：blocking I/O at scale / operational readiness / key rotation。

**方案**

- `git`/`gh` 改 async `execFile` + timeout + AbortSignal；
- assess/check 基准：目标仓规模 1M LOC、50–500 PR/周；
- `metrics`/`spc` 定时 workflow + 失败通知；
- 备份/恢复 `.firetree` 与证据存储；
- SECURITY.md、漏洞披露、事故 runbook；
- 密钥/审批轮换与撤销。

**验收**

- p95 达到预注册目标；
- 备份恢复演练；
- 事故演练；
- 无同步子进程阻塞。

---

## 8. 工作包 F：真实试点（P1 的 organizational 结论）

**目标**：证明“可用”而不只是“能跑”。

1. 本仓 + 1 个外部代码仓；
2. shadow：gate 只报告，不阻断；记录 false block/false pass；
3. warn：阻断但不 required；
4. enforce：required check；
5. 50–100 PR；
6. 10 个 L2 correctness case；
7. 预注册指标：
   - false-block rate；
   - assess/check p95；
   - L2 比例；
   - 审批等待时间；
   - 证据缺失率；
   - 回滚次数；
8. 停止规则：false-block 超阈值、L2 比例不降、审批橡皮图章率过高 → 暂停。

**结论门槛**

- 两个仓、50+ PR、至少 10 个 L2；
- 人类 reviewer 独立；
- 失败可解释、可回滚；
- 与基线对照，证明不是流程噪声。

---

## 9. 依赖与排期

```text
WP-A1/A2 (trusted verifier + JWT)
        ↓
WP-C1 (approval) → WP-C2 (governed A3)
        ↓
WP-B1 (git) → WP-B2 (evidence) → WP-B3/B4 (atomic/sidecar)
        ↓
WP-B5/D1/D2 (registry/policy)
        ↓
WP-E1/E4/E5 (retention/release/ops)
        ↓
WP-F (pilot)
```

**建议节奏**

| 阶段 | 内容 | 工期（2–3 人） |
|---|---|---|
| Week 0 | 停止 A3 误宣称；attack tests；文档更正 | 3–5 天 |
| Week 1–2 | WP-A1/A2 + WP-B1 | 1.5–2 周 |
| Week 2–3 | WP-B2/B3/B4 | 1.5–2 周 |
| Week 3–4 | WP-C1/C2 + WP-D1/D2 | 2 周 |
| Week 4–5 | WP-E1/E2/E3/E4/E5 | 1.5–2 周 |
| Week 5–12 | WP-F 试点 + 修复 | 4–8 周 |

**总计**：2 名工程师 + 1 名独立 reviewer，约 **8–12 周**；单人没有独立审批者，只能做 A1/A2 shadow，不能宣称 governed production。

---

## 10. Go / No-Go 清单

### 工程

- [ ] P0-1: trusted verifier；无 PR 代码
- [ ] P0-2: JWT JWKS 验签 + exp/run 绑定
- [ ] P0-3: external approval；独立 reviewer；A3 bind bundle
- [ ] P0-4: mandatory git；receipt diff/tree
- [ ] P0-5: no URL evidence；parser 双向核对；coverage 阈值
- [ ] P0-6: autonomous 无 A3；governed A3
- [ ] P0-7: artifact retention + clean replay
- [ ] P1-1/2: registry 100%；L0 10% 抽样
- [ ] P1-3/4/5: lock/fsync/envelope
- [ ] P1-6: dossier/OCG enforced
- [ ] P1-8/9: branch protection/required checks/SHA pin
- [ ] P1-10/11: claims machine-checked；覆盖率门槛
- [ ] P1-12/13: license/engines.dsh/rollback/ops

### 安全

- [ ] 所有 P0 attack tests 在 CI 失败路径正确；
- [ ] claims/approval 不可伪造；
- [ ] 无 PR 代码在 OIDC job；
- [ ] 无自审批；
- [ ] 依赖审计/SBOM。

### 法务

- [ ] LICENSE/NOTICE/THIRD-PARTY；
- [ ] Qian 引用政策；
- [ ] 隐私/数据保留说明。

### 组织

- [ ] 第二名 reviewer；
- [ ] release authority；
- [ ] incident/on-call owner；
- [ ] 真实试点团队。

**结论**：在 P0 全部通过、试点完成、法务完成前，**不能宣称生产可用**。

---

## 11. 风险与停止规则

| 风险 | 触发 | 应对 |
|---|---|---|
| 过度工程 | P0 没有先做，先做 A3/UI | 停止新功能，先修信任 |
| 误拦导致绕过 | false-block 高 | shadow/warn，不 enforce |
| 审批橡皮图章 | 自审批/秒批 | 独立 reviewer + 等待时间指标 |
| GitHub 依赖 | API/attestation 不可用 | 降级 A1；不伪造 A2/A3 |
| 性能 | assess/check p95 超标 | async + 缓存 + 规模基准 |
| 法务 | LICENSE 未定 | 不发布 bundle |

---

## 12. 现在立刻要做的 5 件事

1. **停止宣称 A3**：把 current A3 标成 keyless attestation smoke；更新 README/CLAIMS/REPAIR-STATUS。
2. **不要在该仓库直接 merge 测试 PR**；保持 main 只包含可信代码。
3. **先做 WP-A1**：拆 build/verify；trusted verifier 不使用 PR 代码。
4. **做 WP-A2**：JWT 真验签；任何 claims JSON 不再直接当 A2。
5. **加 attack tests**：policy tamper、verifier tamper、forged claims、remote evidence、handwritten signoff。测试先红，再实现。

> 这份计划的核心不是“再加十个功能”，而是把 **验证器、策略、身份、审批、留存** 从被审计对象的手中拿走。  
> 在这五件事完成前，任何“生产可用/A3 完成”的说法都应当撤回。
