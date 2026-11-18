# 威胁模型（v1）

> 更新：2026-11-18。范围：FireTree-DSH 插件、CI gate、证据 bundle、人工审批、policy。
> 目的：说明“回执能证明什么、不能证明什么”，以及信任假设。

## 1. 资产

- 源码与变更集（git tree/diff）；
- assessment/receipt/evidence/correctness case/review 工件；
- CI OIDC claims、approval 记录、签名；
- policy/CODEOWNERS/分支保护配置；
- 人类签字与审批等待记录。

## 2. 对手

| 对手 | 能力 | 目标 |
|---|---|---|
| 被审计 agent | 可写工作区、可调用工具、可伪造 `.firetree` 文本 | 获得“已完成”回执、降低等级、跳过评审 |
| 恶意/疏忽的贡献者 | 可改 PR 分支、workflow（若允许） | 让验证器执行不可信代码、伪造证据 |
| 供应链攻击者 | 可污染依赖/构建 | 在证据生成或解析阶段注入 |
| 内部人员 | 可改 CI/分支保护/审批 | 绕过/橡皮图章 |
| 外部攻击者 | 可投递恶意 XML/JSON/URL | DoS、SSRF、解析器攻击 |

## 3. 信任假设

- GitHub/Actions、OIDC issuer、CI runner、DSH host 本身可信；
- 持有 CI/平台 root 权限的人可信（但应有审计）；
- 人类审批者可能犯错或橡皮图章，不能假设其专业判断始终正确；
- 审计者可以在没有 agent 本地文件的情况下获得 bundle。

## 4. 控制

| 威胁 | 控制 |
|---|---|
| agent 自签 | L2 必须 human approval；DSH approval 仅当 policy=ask；CI A3 验证 approval head/reviewer |
| 证据伪造 | CI OIDC claims；evidence `producer=ci:*`；JUnit/SARIF/SBOM/coverage 内容校验；bundle digest |
| 变更替换 | assessment 绑定 git tree/diff；review 绑定 assessment/package；receipt 复验 |
| 重放 | change/diff/head/expiry 绑定；bundle manifest digest |
| workflow 篡改 | 验证 workflow 固定在默认分支；只下载 artifact，不 checkout 执行 PR 代码 |
| 解析器攻击 | 拒绝 DOCTYPE/ENTITY；大小/testcase 上限；标准解析器；fuzz |
| SSRF | 验证时不 fetch URL；证据必须进 bundle；如需 fetch 只在 CI allowlist 内 |
| 供应链 | 锁版本 + lockfile + SBOM + `npm audit`/Dependabot；证据库保留 |
| 内部人绕过 | 分支保护、CODEOWNERS、保护 policy/workflow、事件链、抽样审计 |
| 指标游戏 | 预注册指标；抽样审计；禁止指标；L2 异常低时复核 |

## 5. 明确不防

- 恶意 CI 管理员/平台 root；
- 被完全攻陷的 GitHub/IdP；
- 人类审批者与 agent 合谋；
- 法律级不可否认（v1 的 Ed25519 A3 是技术签名，不是法律签名；GitHub review 是账号级）。

## 6. 残余风险

- GitHub OIDC claims 只证明“哪个 workflow/仓库/提交”，不证明“代码正确”；
- JUnit/SARIF/SBOM 只校验格式与最低条件，不证明测试覆盖真实行为；
- Ed25519 A3 依赖公钥分发/轮换；keyless Sigstore 适配仍是后续项；
- 本地 A1 回执只能作为自述，不能作为独立审计。
