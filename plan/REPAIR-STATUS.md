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
- **JUnit**：按 D6 引入 `fast-xml-parser` 5.11.2，替换正则校验；拒绝 DOCTYPE/ENTITY、限制大小/testcase 数、从 `<testcase>` 计数，防止 `tests="999999"` 伪造。
- **证据格式**：governed receipt 与技术证据都校验 JUnit/SARIF/SBOM 内容；L1/L2 evidence 不再是“只哈希不看内容”。
- **正确性论证**：`validateCorrectnessCase` 支持 `evidenceRefs`；mapping/invariant 的 evidence_ref 必须命中回执 evidence；tier-matrix/ receipt 测试使用真实 refs。
- **accepted risk**：hypotheses ledger 增加 `accepted_risks`；`firetree_hypothesis` 新增 `accept`（human + approval_ref + expiry）；receipt 统计 active accepted risk 并复验；新增 `test/accepted-risk.test.mjs`。
- **intent/classification**：governed receipt 的 `intent` 改为可选（policy 要求时再填）；`classification` 继续保持 optional/advisory。
- **事件与状态**：新增 `src/lib/events.js` 哈希链 `.firetree/events.jsonl`；assess/review/receipt 写入事件；`firetree_state` 的 expiring/blocked 由 receipt/technical evidence 的 `expires_at` 计算；新增 `scripts/metrics.mjs`。

### WP4 policy chain（本轮追加）

- 新增 `src/lib/policy.js`：
  - `extends` 递归解析；
  - tighten-only 合并（sample_rate/review_rounds/signoff/correctness_case/token_budget 只能加严）；
  - `version` 改为 canonical policy 的 SHA-256（不再信任文件里的字面值）；
  - cycle/missing parent/relaxation 分类错误。
- `src/lib/registry.js` 的 `loadPolicy` 改走 policy chain；assessment/receipt 的 `policy.version` 现在是真实 digest。
- 新增 `test/policy-chain.test.mjs`（继承、放松拒绝、缺父、环、digest）。
- **L0 收窄**：`.env*`、`.github/**`、任意服务 config、`docs/` 下的代码、`test/` 目录中的运行时代码不再 L0；接口 consumers 不再被算作“changed code subsystems”，避免接口变更误报 cross-subsystem。新增 impact 反例测试。

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

## 验证

| 项 | 结果 |
|---|---|
| `node --test` | **177/177 通过**（新增 A3、JUnit 解析、accepted risk、policy chain、L0 反例、事件/状态测试） |
| `node scripts/lint-schemas.mjs` | `schemas=10 errors=0` |
| `node scripts/check-syntax.mjs` | `checked=80 failed=0` |
| `node scripts/check-docs.mjs` | `docs=37 links=85 errors=0` |
| live 安装 | `install_bundle` → `application: applied`；`firetree_state`/assess/receipt 实际调用通过 |
| 分支 | `repair/v0.1`：`e30963b`（WP0/WP1）、`2277136`（WP2 core）、`f9374cb`（WP2 A3/WP3/WP5）、`33a28ab`（WP4 policy + live install） |

## 仍未完成（下一步）

1. **WP2 收尾**：GitHub `actions/attest-build-provenance` 真验签适配（当前 A3 用 Ed25519 离线签名，是可用但非 keyless 的路径）；`bin/firetree-approval.mjs`（从 GitHub API 生成 approval.json）；CI 模板端到端跑一次。
2. **WP3 收尾**：coverage adapter；SARIF/SBOM 的 policy 阈值；interface hash/contract test/depends_on；`intent` 按 policy 可选（D9/P-30）。
3. **WP4 收尾**：triggers 真正驱动 tier（当前 policy chain/digest 已落地，但 impact 仍用内置规则）；exceptions 在 assess 中消费；L0 收窄（`.env`/config/CI/代码在 docs/test 目录）；bootstrap registry。
4. **WP5 收尾**：events 全工具覆盖（classify/hypothesis/synthesize/state 尚未写事件）；metrics 周报/SPC 模板；state 过期夹具测试；schedule/re-eval。
5. **WP6 收尾**：`ctx.effect` 清理、Config schema、LICENSE/NOTICE、README/详情页、升级/回滚 smoke。
6. **WP7**：文档 v1 同步、CLAIMS、COMPATIBILITY、THREAT-MODEL、v0→v1 迁移脚本。
7. **WP8/WP9**：本仓 + 1 外部代码仓试点、shadow/warn/enforce、安全/性能/回滚。

## 已知限制

- `firetree-check` 的 A2 仍依赖调用方提供 `claims.json`；CI workflow 模板中的 `--claims` 步骤尚未在真实 GitHub Actions 上跑过。
- A3 仅占位，未实现签名验证；不得对外声称 A3。
- `receipt` 的 `intent` 仍是必填（D9/P-30 的“policy 要求才必填”尚未完成）。
- `firetree_receipt` 工具内的 `assurance` 仍是输入字段；目前只有 CI `firetree-check` 做派生校验。
- JUnit 仍走旧 `src/lib/junit.js` 正则校验；WP3 才换标准解析器。
- `.firetree` 工件仍是 v1 断代；v0→v1 迁移脚本未写。
- 当前 profile 仍未安装插件；安装 smoke 属于 WP6。
