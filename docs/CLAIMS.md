# 对外主张与实现状态（CLAIMS）

> 更新：2026-11-18。规则：`implemented` 必须有测试/命令；`partial` 必须写缺口；`planned` 不得对外作为能力宣称。

| 主张 | 状态 | 证据 / 缺口 |
|---|---|---|
| 7 个 FireTree 工具注册且可调用 | implemented | `test/skeleton.test.mjs`；live `firetree_state`/`assess`/`receipt` |
| 6 个技能按需加载 | implemented | `test/skeleton.test.mjs`；当前 DSH 技能目录 |
| L0/L1/L2 自动分级 | implemented | `test/impact.test.mjs`、`test/assess.test.mjs` |
| 未知路径强制 L2，且回执可表达 | implemented | `test/tier-matrix.test.mjs`（unknown-only L2） |
| L0 未采样不需要 review；采样需要人类 spot-check | implemented | `test/tier-matrix.test.mjs` |
| 证据由 CI/确定性工具产生，插件只读 | partial | 哈希/格式/claims 已校验；producer 仍是字符串，OIDC 只证明 CI 运行 |
| A2 需要 OIDC claims | implemented | `test/identity.test.mjs`、CLI A2 测试 |
| A3 需要人类审批 + 签名 bundle | partial | Ed25519 A3 已验证；GitHub keyless/Sigstore 适配未做 |
| 变更集来自 git diff，不可自述 | implemented | `test/git-assess.test.mjs` |
| 重评估不能覆盖已评审 change | implemented | `test/git-assess.test.mjs` |
| 评审绑定 assessment/diff/package | implemented | `test/git-assess.test.mjs`、receipt 复验 |
| correctness case 的 evidence 必须命中回执 | implemented | `test/receipt.test.mjs`、`test/tier-matrix.test.mjs` |
| 未验证假设必须有人类风险接受 | implemented | `test/accepted-risk.test.mjs` |
| JUnit 标准解析，拒绝伪造计数 | implemented | `test/junit.test.mjs`、`test/coverage.test.mjs` |
| policy 继承 tighten-only + digest | implemented | `test/policy-chain.test.mjs` |
| policy triggers 驱动 tier / exceptions 消费 | planned | impact 仍用内置规则；见 plan/REPAIR-STATUS.md |
| coverage/SARIF/SBOM 内容校验 | partial | coverage/JUnit/SARIF/SBOM 结构已校验；阈值策略未做 |
| interface hash/contract test | partial | interface hash 已校验；contract test 执行未做 |
| 事件链 + state expiry/metrics | partial | 事件/聚合/expiry 已做；SPC/调度未做 |
| DSH 安装与 live 调用 | implemented | `install_bundle` applied；live smoke |
| v0→v1 迁移 | partial | 报告/安全项迁移脚本；review hash 需人工重做 |
| 真实 2 仓团队试点 | planned | 需要外部团队/仓库 |

## 使用方式

- 对外发布/演示时，只能引用 `implemented`；`partial` 必须附缺口；`planned` 不得写成“已支持”。
- 本文件由人工维护；任何状态变化必须同时更新测试或缺口说明。
