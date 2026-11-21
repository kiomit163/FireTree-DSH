# 修复状态（WP0–WP2）

> 更新：2026-11-18。分支：`repair/v0.1`。基线：`8550599`。
> 本文件记录实际落地的代码、测试与仍未完成项；不把计划当成完成。

## 已完成

### WP0 真值基线

- `schemas/*.schema.json` 全部升级为 **v1** 字符串；fixtures、工具输出、测试同步。
- 修复 **L0 回执死锁**：
  - `receipt.review` 允许 `null`（仅未采样 L0）；L1/L2 强制对象；L0 采样强制 `review.mode=light` + `human_spot_check`。
  - `firetree_review` 支持 L0 light review；必须有 `human_spot_check`，否则拒绝；无采样 L0 不允许开评审。
  - `firetree_receipt` 根据 `assessment.sampling.selected` 决定是否读取/要求 review；L0 未采样不再写 `review:null` 到强制对象。
  - `assess.required_artifacts` 动态化：L0 采样才要求 `light_review`。
  - `firetree_state` 不再把未采样 L0 的 review、L0 的 hypotheses 计为 pending；synthesis 改为 advisory，不再计 pending。
- 修复 **unknown 契约**：
  - receipt `impact` 增加 `unknown`、`unresolved_consumers`、`reasons`。
  - L0/L1 仍要求 `subsystems`/`owners` 非空；L2 只有 `unknown` 非空时才允许空（由语义检查）。
  - `firetree_receipt` 输出/校验 unknown、unresolved、reasons；新增 unknown-only L2 端到端测试。
- 新增 `scripts/lint-schemas.mjs`：拒绝运行时校验器不支持的 schema 关键字（避免“字段看起来有约束、实际不检查”）。
- 新增 `scripts/check-syntax.mjs`、`.github/workflows/ci.yml`（Ubuntu + Windows、Node 22）。
- 修复 `test/skeleton.test.mjs` 的 Windows-only 路径断言。
- `package.json`：0.1.0、`engines.node >=20`、`lint:schemas`/`check:syntax`/`check` 脚本。

### WP1 不可变 change 与评审绑定

- 新增 `src/lib/git.js`：
  - `resolveCommit`/`resolveTree`；
  - `changedFiles`（`--no-renames`，并排除 `.firetree/**`，避免协议工件自我递归）；
  - `diffSha256`；
  - `verifyGitChange`：拒绝与 `git diff` 不一致的 `files`。
- `firetree_assess` 新增 `verify_git`：
  - base/head 解析为完整 SHA；
  - 写入 `git.tree_sha`/`git.diff_sha256`；
  - 同一 change 同 base/head/files 幂等返回；
  - 不同评估且已有 review/receipt/synthesis → `CHANGE_IMMUTABLE`；
  - 未评审的不同评估 → 旧 assessment 归档到 `revisions/<n>.json`，新评估 `revision+1`。
- `review.open` 自动绑定 assessment SHA；若 assessment 有 git diff 而传入 `diff_sha256` 不一致 → `DIFF_MISMATCH`。
- `review.verdict` 写入 `assessment_sha256`、`package_sha256`；receipt 的 review 摘要携带二者；`checkReceiptSemantics` 复验 assessment/package 哈希。
- 新增 `bin/firetree-assess.mjs`：从 git 计算 diff、调用 assess、输出 JSON。
- 新增 `test/git-assess.test.mjs`（git 绑定、评审绑定、不可变/修订）。

### WP2 信任根（核心部分）

- 新增 `src/lib/identity.js`：
  - OIDC claims 解析/校验（issuer、audience、repository、workflow_ref、sha、event、run_id）；
  - claims 哈希；producer 派生。
- 新增 `src/lib/assurance.js`：
  - A0/A1/A2/A3 派生；`atLeast`。
- 新增 `src/lib/bundle.js`：
  - 内容寻址 bundle manifest；离线校验/篡改检测。
- `bin/firetree-check.mjs`：
  - `--claims`、`--bundle`、`--require`、`--repository`、`--issuer`、`--audience`；
  - 有 claims 且 CI 证据 → A2；无 claims → 拒绝 A2 声明；
  - A3 明确报“未实现”，不伪造；
  - claimed assurance 高于 derived → gap。
- 新增 `test/identity.test.mjs`、`bin/firetree-check` 的 A2/A3 CLI 测试。

### WP2 A3 / WP3 证据 / WP5 事件（本轮追加）

- **A3**：新增 `approval.js`、`signature.js`；`firetree-check` 支持 `--approval`、`--signature`、`--public-key`；A3 = claims + CI 证据 + 人类审批 + Ed25519 签名 bundle。`--require A3` 现在真验签，不再占位。
- **approval CLI**：新增 `bin/firetree-approval.mjs`，把 GitHub PR review JSON 归一化为 `firetree.approval/v1`；新增 `test/approval.test.mjs`。
- **Keyless A3 verifier**：新增 `src/lib/attestation.js` + `bin/firetree-attest.mjs`：
  - 用 `gh attestation verify --bundle --format json` 验证 GitHub artifact attestation（Fulcio/Rekor 证书链由 GitHub CLI 执行）；
  - 校验 attestation subject 的 SHA-256 与待验证 artifact 一致；
  - `firetree-check` 支持 `--attestation`/`--attested-artifact`/`--signer-workflow`/`--source-digest`；
  - `deriveAssurance` 接受 `attested` 作为 A3 的 signed/attested 证明。
  - 新增 `.github/workflows/keyless-attest.yml`（真实生成 + 验证 attestation）；A3 仍要求人类 approval，workflow 目前只验证 keyless plumbing。
- **Environment A3 gate**：新增 `scripts/github-environment-approval.mjs`（读取 GitHub run approvals API，生成 `source=github-environment` 的 approval）和 `.github/workflows/a3-keyless.yml`（`environment: firetree-a3`，审批后构建 technical evidence + bundle + keyless attestation，再 `firetree-check --require A3`）。
  - 需要仓库 Settings → Environments 配置 `firetree-a3` 的 Required reviewers 后才能真正等待人工审批。
- **OIDC A2 smoke**：新增 `scripts/github-oidc.mjs`（取 GitHub Actions OIDC token 并校验 claims）和 `scripts/ci-a2-smoke.mjs`（在隔离 fixture 上调用真实 `firetree-check --require A2`），以及 `.github/workflows/oidc-a2.yml`。GitHub 运行 [44747400263](https://github.com/kiomit163/FireTree-DSH/actions/runs/44747400263) 成功。
  - 注意：这是 A2 **plumbing smoke**，不是对每个 PR 的实际变更做 gate；真实 PR gate 还需要仓库内 `.firetree` policy/registry 和按 diff 生成评估/证据。
- **JUnit**：按 D6 引入 `fast-xml-parser` 5.11.2，替换正则校验；拒绝 DOCTYPE/ENTITY、限制大小/testcase 数、从 `<testcase>` 计数，防止 `tests="999999"` 伪造。
- **证据格式**：governed receipt 与技术证据都校验 JUnit/SARIF/SBOM 内容；L1/L2 evidence 不再是“只哈希不看内容”。
- **正确性论证**：`validateCorrectnessCase` 支持 `evidenceRefs`；mapping/invariant 的 evidence_ref 必须命中回执 evidence；tier-matrix/ receipt 测试使用真实 refs。
- **accepted risk**：hypotheses ledger 增加 `accepted_risks`；`firetree_hypothesis` 新增 `accept`（human + approval_ref + expiry）；receipt 统计 active accepted risk 并复验；新增 `test/accepted-risk.test.mjs`。
- **intent/classification**：governed receipt 的 `intent` 改为可选（policy 要求时再填）；`classification` 继续保持 optional/advisory。
- **coverage/interface**：新增 `coverage.js`（Codecov/Istanbul/LCOV 结构校验）；governed receipt 与技术证据都校验 coverage；新增 `interface.js`，assess 校验 interface 文件 SHA-256（不匹配 `INTERFACE_HASH_MISMATCH`）；impact 现在沿 `depends_on` 递归拉入依赖消费者。contract test 执行仍未做。
- **事件与状态**：新增 `src/lib/events.js` 哈希链 `.firetree/events.jsonl`；assess/classify/hypothesis/synthesize/review/receipt 写入事件；`firetree_state` 的 expiring/blocked 由 receipt/technical evidence 的 `expires_at` 计算；tier-matrix 已覆盖 expiring=1；新增 `scripts/metrics.mjs` 与 `scripts/spc.mjs`（L2 比例 p-chart）。

### WP4 policy chain（本轮追加）

- 新增 `src/lib/policy.js`：
  - `extends` 递归解析；
  - tighten-only 合并（sample_rate/review_rounds/signoff/correctness_case/token_budget 只能加严）；
  - `version` 改为 canonical policy 的 SHA-256（不再信任文件里的字面值）；
  - cycle/missing parent/relaxation 分类错误。
- `src/lib/registry.js` 的 `loadPolicy` 改走 policy chain；assessment/receipt 的 `policy.version` 现在是真实 digest。
- 新增 `test/policy-chain.test.mjs`（继承、放松拒绝、缺父、环、digest）。
- **L0 收窄**：`.env*`、`.github/**`、任意服务 config、`docs/` 下的代码、`test/` 目录中的运行时代码不再 L0；接口 consumers 不再被算作“changed code subsystems”，避免接口变更误报 cross-subsystem。新增 impact 反例测试。
- **bootstrap registry**：新增 `scripts/bootstrap-registry.mjs`，从目录树/CODEOWNERS 生成候选分组报告（不伪造 registry 条目/dossier）。
- **triggers/exceptions**：`evaluatePolicy` 已驱动 assess 的 auto tier：
  - soft trigger（dependency/cross-subsystem）仅在 `triggers.L2` 配置时升 L2，可由 active exception 的 `waives` 豁免；
  - hard trigger（unknown-impact/interface-change/security/data）不可豁免；
  - exception 要求 human approver + 未过期 + scope 覆盖全部变更文件；
  - assessment.reasons 记录 exception id/waived trigger。
  - 新增 assess 测试；`policy.schema.json` 的 exception 增加可选 `waives`。

### WP7 文档/迁移（本轮追加）

- 新增 `docs/CLAIMS.md`（主张 ↔ 状态 ↔ 测试/缺口）、`docs/COMPATIBILITY.md`（v0→v1 字段与迁移）、`docs/THREAT-MODEL.md`（对手/信任假设/控制/残余风险）。
- 新增 `scripts/migrate-v0-to-v1.mjs`：报告 v0 工件；安全项可 `--apply`；review hash/spot-check 等 blocked 项要求人工重做。
- `README.md`、`schemas/README.md` 加 v1/修复状态说明。

### WP6 安装与 live smoke（本轮追加）

- 已通过 `plugin_manager install_bundle` 安装 `@local/firetree-dsh@0.1.0`，结果 `application: applied`。
- 当前 DSH 会话技能目录已出现 6 个 FireTree 技能；7 个 `firetree_*` 工具已可调用。
- 在 `.tmp/live` fixture 上完成 live：
  - `firetree_assess` → L0（subsystems=1, unknown=0）；
  - `firetree_state` → 1 pending；
  - `firetree_receipt build` → `ok=true; 0 gap(s)`；
  - `firetree_receipt check` → `ok=true; 0 gap(s)`；
  - `firetree_state` → 0 pending。
- 说明：这是“插件真实安装 + 工具真实调用”的 smoke，不是团队试点。

### 2026-11-22 生产就绪修复（进行中）

- **A2 身份**：`firetree-check` 新增 `--jwt` + `--jwks`；`jose` 对原始 GitHub OIDC JWT 做 JWKS 验签、`exp/aud/issuer/repository/sha` 校验；旧 `--claims` JSON 明确降为不可信（A1）。
- **Trusted PR gate**：`pr-a2` 已拆为 build（PR 代码、无 id-token）→ verify（base 代码、JWT、base policy）→ report；PR #2 run 44915432273 全绿，`firetree-a2` check 已发布到 PR head `76e4922`。这是 PR gate 第一次以“验证器不执行 PR 代码”的方式通过。
- **可信策略**：`firetree-assess`/`firetree-ci` 新增 `--registry-root`；PR gate 从 base SHA 归档 `.firetree` + CODEOWNERS，避免 PR 改写 policy/registry 直接降级。
- **git 绑定**：git 仓库内不带 `verify_git` 的 assess 直接失败；非 git fixture 才允许无 git 评估。
- **A3 语义**：`firetree-check` 的 autonomous 模式最多 A2；`a3-keyless` 改名为 `keyless-a2`，不再声称 A3。真正的 governed A3 仍未实现。
- **证据 fail-open**：远程 URL evidence 在 governed/technical/hypothesis 路径一律拒绝；JUnit 读取 `<testsuites>` 根计数；LCOV >100% 拒绝。
- 测试：**195/195 通过**；syntax 97；docs 41。
- 这仍是 P0 修复的**第一段**：trusted build/verify 拆分、approval 绑定、retention、governed A3 未完成。

## 验证

| 项 | 结果 |
|---|---|
| `node --test` | **190/190 通过**（新增 A3/approval/environment approval、keyless attestation、OIDC audience arrays、JUnit/coverage、accepted risk、policy chain、triggers/exceptions、L0 反例、interface hash/depends_on、事件/状态测试） |
| `node scripts/lint-schemas.mjs` | `schemas=10 errors=0` |
| `node scripts/check-syntax.mjs` | `checked=96 failed=0` |
| `node scripts/check-docs.mjs` | `docs=40 links=89 errors=0` |
| live 安装 | `install_bundle` → `application: applied`；`firetree_state`/assess/receipt 实际调用通过 |
| 分支 | `repair/v0.1`：`e30963b`（WP0/WP1）、`2277136`（WP2 core）、`f9374cb`（WP2 A3/WP3/WP5）、`33a28ab`（WP4 policy + live install）、`4731150`（L0 收窄/optional intent）、`20473b1`（全工具事件 + docs v1）、`a79a135`（coverage/interface/migration）、`6f4a8dc`（triggers/exceptions）、`0e3deaf`（approval CLI）、`af7cfd1`（bootstrap/SPC）、`bedede2`（depends_on）、`0837e07`（state expiry 测试） |

## 仍未完成（下一步）

1. **WP2 收尾**：keyless verifier + environment A3 workflow 已落地；还需配置 `firetree-a3` 的 Required reviewers、运行 `a3-keyless` 并确认 approvals API 返回审批人。Ed25519 路径仍保留为离线 fallback。
2. **WP3 收尾**：SARIF/SBOM/coverage 的 policy 阈值；interface contract test/depends_on；`intent` 按 policy 必填开关。
3. **WP4 收尾**：policy 模板/playbook；bootstrap 报告到 registry 的人工确认流程。
4. **WP5 收尾**：周报模板；schedule/re-eval（DSH `schedule` 由用户配置，插件不自建调度器）。
5. **WP6 收尾**：`ctx.effect` 清理、Config schema、LICENSE/NOTICE、README/详情页、升级/回滚 smoke。
6. **WP8/WP9**：本仓 + 1 外部代码仓试点、shadow/warn/enforce、安全/性能/回滚。

## 已知限制（2026-11-20 更新）

- **A2 是 smoke，不是 PR gate**：`oidc-a2.yml` 在隔离 fixture 上验证 OIDC claims → technical evidence → `firetree-check --require A2`；尚未对每个 PR 的真实 diff 生成 `.firetree` 评估/证据。
- **A3 keyless 未实现**：当前 A3 需要 Ed25519 签名 + approval；没有 Fulcio/Rekor/GitHub attestation 证书链验证，不得对外声称 keyless A3。
- **`firetree_receipt` 的 assurance 仍是调用方输入**：`firetree-check` 会派生并校验，但 receipt 工具本身尚未移除该输入。
- **contract test/阈值未做**：interface hash/depends_on 已校验，但不执行 `contract_test`；SARIF/SBOM/coverage 没有 policy 阈值。
- **GitHub Actions 日志下载需要 admin**：public 仓库可以读取 run/job 元数据，但 `logs` API 仍返回 403；失败详情目前通过 annotation/`::error::` 暴露。
- **LICENSE 未定**：`package.json` 仍是 `UNLICENSED`；公开可见不等于允许再分发/商用。
- **WP8 未开始**：没有外部团队试点、shadow/warn/enforce 数据。
- **当前 profile 已安装插件**（2026-11-18 live smoke 通过）；安装不是团队试点。
