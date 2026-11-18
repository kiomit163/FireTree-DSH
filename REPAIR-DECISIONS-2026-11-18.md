# FireTree-DSH 修复决策记录（2026-11-18）

> **性质**：受用户委托，由 AI lead 代决；用户可随时否决或修改。任何变更必须新开一条决策记录，不覆盖本文件。
> **依据**：`AUDIT-2026-11-18.md`、`REPAIR-PLAN-2026-11-18.md`、当前 DSH 运行时（`0.2.2-rc.3`）与 2026-11 可用的工程实践。
> **环境事实**（影响决策）：
> - 当前会话审批提示被关闭（approval policy = never），所以 **DSH 的 `approval` 不能作为可靠的人签通道**；它只能作为可选适配器。
> - 当前 profile 未安装 FireTree；插件尚未 live 验证。
> - 本机此前访问 `github.com:443` 曾受阻；因此决策采用“GitHub 参考实现 + 可替换 CI/证据库适配器”，没有 OIDC 时只能 A1。
> - DSH 是本地桌面宿主：有 `approval`、`plugin_manager`、`subagent`（provider/model）、`schedule`、`jobs`、`session` 日志、`Config`、`cordis_inspect`；这些能力被逐条纳入下面的决策。

> **决策方法**：每个决策先回答“这属于什么经典问题或变体？有什么优秀方案？”，再给决定。理由里区分“安全收益 / 运营成本 / DSH 适配 / 2026-11 成熟度”。

---

## 0. 决策总表

| # | 决策 | 最终决定（一句话） |
|---|---|---|
| D1 | 身份与信任根 | **GitHub Actions OIDC + GitHub PR review 为参考实现；A2 机器身份、A3 人类审批；DSH approval 仅可选；无 OIDC 只能 A1** |
| D2 | L0 评审/采样 | **L0 默认无评审；10% 抽样由人类 spot-check；不允许 agent 自写“轻评审”** |
| D3 | 策略引擎 | **自研类型化 JSON policy 编译器（PDP）+ 决策日志；OPA/Cedar 仅做适配器** |
| D4 | 证据库 | **外部不可变存储为权威：GitHub Actions artifacts + GitHub artifact attestations；repo 只存 manifest；可选 S3 Object Lock/Rekor** |
| D5 | 试点范围 | **本仓库（docs/config 自用）+ 1 个外部代码仓；先 1 个外部团队，4 周后再扩** |
| D6 | XML 解析 | **隔离引入维护良好的 XML 解析器（默认 `fast-xml-parser` 5.11.x，备选 `@xmldom/xmldom` 0.9.x）；拒绝 DOCTYPE/ENTITY + 大小/深度限制 + fuzz；不用已归档的 saxes** |
| D7 | Schema 策略 | **干净 v1 + 迁移脚本 + 兼容矩阵；不做 v0 双写** |
| D8 | 周期/人力 | **12 周、2.5–3 FTE；单人则 18–20 周并砍 A3/签名/长期证据库** |
| D9 | Q1/Q3 去留 | **v0.1 把 classify/synthesize 降级为 advisory，不作 L2 门禁；试点后用数据决定是否恢复** |

**一句话总结**：用 2026 年已经成熟、但“无聊”的 OIDC + Sigstore 生态做信任根；用 DSH 本地能力做记录与投影；不再用字段假装证明。

---

## D1 身份与信任根

### 这属于什么经典问题/变体？

- **信任锚选择（trust anchor selection）**：系统把“谁说的”作为可信起点；
- **远程证明架构（RATS）角色未分离**：Attester（产生声明）、Verifier（验证）、Relying Party（依赖结论）混在同一个 agent 里；
- **自证/身份冒充**：被审计对象自己写 `human`/`ci:`；
- **不可否认性（non-repudiation）**：签字人不能事后否认；
- **身份联合（identity federation）**：本地 DSH 没有 IdP，需要外部身份。

### 2026-11 可用的优秀方案

| 方案 | 优点 | 代价/限制 | 成熟度（2026-11） |
|---|---|---|---|
| **GitHub Actions OIDC + PR review + artifact attestations** | 零额外基础设施；claims 可验证；artifact attestation 原生支持 SLSA/in-toto，Sigstore 签名；和仓库/PR/CODEOWNERS 天然集成 | 绑定 GitHub；PR review 是账号级，不是“人手一把私钥”的强不可否认；企业/离线需替代 | 生产级；GitHub 的 attestation 用短时 Sigstore 证书，公/私有仓均有路径 |
| Sigstore keyless + in-toto/DSSE + Rekor | 可离线验证；透明日志；OIDC 身份绑定；生态成熟 | 需要 Fulcio/Rekor 或自建；网络/信任根配置；团队学习成本 | 生产级；2026 年 keyless 已是容器/制品签名主流 |
| 企业 IdP + SPIFFE/SPIRE + 内部审批 | 最强企业集成；工作负载身份；离线可控 | 重；需要平台团队；DSH 桌面端集成复杂 | 企业级，但不适合 v0.1 |
| 仅 DSH `approval` | 宿主原生、零外部依赖 | **当前 approval policy = never，提示被关闭**；本地同一用户，不能证明“另一个人”；无跨机器可验证记录 | 只能做可选 UX，不是信任根 |
| 仅本地文件/自述 | 最简单 | 不构成证明；agent 可改 | 不可接受 |

> 技术核查（2026-11，外部资料，仅作选型依据）：
> - Sigstore keyless 在 2026 已成熟，cosign 2.4 改善离线验证/信任根；[Safeguard: Cosign keyless 2026](https://safeguard.sh/resources/blog/cosign-keyless-signing-workflows-2026)
> - GitHub `actions/attest-build-provenance` 用短时 Sigstore 证书生成 SLSA/in-toto 证明；公开仓用公共 Sigstore，私有仓走 GitHub 托管签名路径；[官方 action](https://github.com/actions/attest-build-provenance)
> - 真实项目在 2026-11 的 ADR 也采用 GitHub attest + Sigstore 的发布证明；[Kubetail ADR](https://github.com/kubetail-org/kubetail/blob/be6cdd76e7680bcf4b1aee6ca41840a7b094bcef/docs/adr/2026-11-10-attest-build-provenance-in-the-release-jobs.md)

### 决定

1. **机器身份（A2）**：GitHub Actions OIDC。CI 把 claims 写入 `claims.json`；`firetree-check` 验证：
   - `iss = https://token.actions.githubusercontent.com`
   - `aud` 符合配置
   - `repository`/`repository_owner` 匹配
   - `workflow_ref`/`job_workflow_ref` 指向受保护 workflow
   - `ref`/`sha` 与 change 的 base/head 一致
   - `event_name` 属于允许集合（pull_request / push / workflow_dispatch）
2. **人类身份（A3）**：GitHub PR review（CODEOWNER/审批人）由 CI 通过 GitHub API 导出 `approval.json`（reviewer login、state、commit_id、submitted_at、PR number），与 receipt 的 package/diff 绑定；A3 = A2 + 该审批 + **GitHub artifact attestation**（`actions/attest-build-provenance`）对 receipt bundle 的签名。没有签名时只能叫 A2H（内部标记），不得对外称 A3。
3. **DSH `approval`**：只作为**可选**人签 UX；当前 approval=never 时不可用。插件检测到 approval 不可用时，不得伪造 human，只能降级 A1/A2。
4. **本地模式**：只允许 A0/A1；不得生成 L2 governed 定稿。
5. **企业/离线替代**：实现 `IdentityProvider` 适配器接口（GitHub、GitLab OIDC、企业 OIDC、SPIFFE），v0.1 只交付 GitHub 参考实现；无 OIDC = A1 only。
6. **`assurance` 不再作为输入**：由 verifier 派生并写入 receipt。

### 为什么适合 DSH / 本项目

- DSH 是本地单机宿主，没有企业 IdP；`approval` 只能问“当前用户”，且可被策略关闭。**唯一可信的外部锚是 CI 的 OIDC**。
- GitHub 已经是仓库/PR/CODEOWNERS/CI 的所在地；artifact attestation 原生，减少自建 PKI。
- 对 L2 的“人签”，GitHub PR review + CODEOWNER 是团队已经在用的动作；不需要新 UI。
- 如果未来客户要求“人类持私钥签名/法律级不可否认”，再加 WebAuthn/HSM/Sigstore 人类密钥；v0.1 不假装具备。

### 代价与风险

- 绑定 GitHub；若团队用 GitLab/Gitee/自建，需要适配器（已预留）。
- GitHub PR review 是账号级身份，不是密码学人类签名；对外只能声称“CI 验证了 GitHub 账号的审批”，不能声称“法律签名”。
- A3 需要 artifact attestation/签名权限；私有仓配置需验证。
- 当前 approval=never，所以本地无法用 DSH 收集人签；必须在 CI/GitHub 完成。

### 何时反悔（复议触发）

- 目标组织不用 GitHub，或 GitHub 不可访问且无法代理 → 切 GitLab/Jenkins OIDC + S3/MinIO；
- 合规要求“人类持私钥/硬件签名” → 升级 A4（WebAuthn/HSM）；
- GitHub review 被证明可被 agent 账号伪造（共享账号/机器人） → 加 CODEOWNER 白名单 + 双人控制。

---

## D2 L0 评审与采样

### 这属于什么经典问题/变体？

- **风险基础控制（risk-based control）**：低风险变更走轻路径；
- **抽样检验（acceptance sampling）**：全检成本高，按比例抽检；
- **四人眼原则（four-eyes）的成本**：独立评审是控制，也是瓶颈；
- **控制粒度（control granularity）**：太粗会漏，太细会拖垮吞吐；
- **自证陷阱**：agent 写“轻评审”不是独立评审。

### 2026-11 可用的优秀方案

| 方案 | 优点 | 代价 | 适用 |
|---|---|---|---|
| L0 完全不评审 | 最快 | 无独立检查；文档/配置也可能出事 | 极高信任/极低风险 |
| **10% 人类抽检** | 成本可控；保留独立控制；可度量漏检 | 需要人类；抽样可能漏 | 推荐 |
| 自动独立评审（另一个模型/agent） | 快、便宜 | 仍是模型，不是独立身份；可能同源错误 | 辅助，不替代人 |
| L0 全量人类评审 | 最强 | 成本高，违背分级初衷 | 高风险团队 |

### 决定

- **L0 默认 `review: null`**，不要求 agent 生成“轻评审”。
- **按 10% 确定性抽样**（现有 `sha256(change+files)` 机制保留）；被抽中的 L0 需要**人类 spot-check**：
  - GitHub PR review（推荐，CI 导出 `approval.json`）；或
  - DSH `approval`（仅当 policy=ask 且确实有第二个人）。
- 人类 spot-check 记录为 `review.mode = "light"`（1 轮、3 步、checked 列表、无 human signoff 也可），但**必须由人类触发/确认**，不是 agent 自写。
- 若没有人类可用：L0 只能产出 A1/A2 技术证据，不能声称 governed 完成；`firetree_receipt check` 返回 gap `human_spot_check_required`。
- 抽样率可被 policy 调整（5%–20%），但默认 10%。

### 为什么适合 DSH / 本项目

- L0 多为 docs/config；10% 人类抽检是团队可承受的。
- agent 自写“轻评审”会重演自证困境；必须由人类动作。
- 当前 approval=never，所以优先用 GitHub review；DSH approval 只作为可选。

### 代价与风险

- 被抽中的 L0 会等待人类，可能增加时延；需要排队而不是绕过。
- 抽样会漏；用 metrics（L0 事故/漏检）调整比例。
- 人类可能橡皮图章；记录等待时长/抽查质量。

### 何时反悔

- L0 发生逃逸缺陷或抽检漏检 → 提高抽样率或收窄 L0；
- 人类抽检成为瓶颈 → 改为“高风险 L0 全检 + 低风险 5%”；
- 团队无人类 → 仅 autonomous，不声称 governed。

---

## D3 策略引擎

### 这属于什么经典问题/变体？

- **策略决策点（PDP）/执行点（PEP）分离**；
- **策略即代码（policy as code）**：版本化、可测试、可审计；
- **表达力 vs 可审计性**：通用语言灵活但难审；DSL 受限但可验证；
- **策略漂移/死配置**：写了不执行。

### 2026-11 可用的优秀方案

| 方案 | 优点 | 代价 | DSH 适配 |
|---|---|---|---|
| OPA/Rego | 生态成熟、决策日志、测试工具、CNCF 事实标准 | 需要运行时（WASM/服务）、学习成本；对本地插件偏重 | 可做可选适配器 |
| Cedar | 形式化验证、清晰语义、AWS 生态 | 需要 Rust/WASM/绑定；团队不熟 | 可做可选适配器 |
| **自研类型化 JSON 规则** | 零依赖、可离线、可审计、和 schema 同源 | 表达力有限；自研测试成本 | 最适合 DSH 本地插件 |
| 硬编码分支 | 最简单 | 不可审计、不可配置、漂移 | 不可接受 |

### 决定

- 实现 `src/lib/policy.js`：类型化 JSON 规则 → 编译为决策函数；输出 `{tier, reasons, required_artifacts, signoff, sampling, review_rounds, correctness_case, policy_digest, decision_log}`。
- 规则集保持小而可审：tier 触发、采样、例外、继承、评审轮数、证据要求。**超过 20 条规则或多团队独立治理时，重新评估 OPA/Cedar。**
- `policy.version` 改为 `digest`（canonical JSON 的 SHA-256，排除 digest 自身）；工具不信任文件里的 digest，自己计算。
- 每次决策写一条 `decision_log`（规则 id、输入摘要、结果、理由），供审计与 metrics。
- 未实现的字段直接删除（`schema lint` + 测试），不允许“字段即机制”。
- 留 `PolicyEngine` 适配器接口；OPA/Cedar 作为可选实现，不进入 v0.1 运行时。

### 为什么适合 DSH / 本项目

- DSH 插件是本地 Node 进程，不能假设有 OPA sidecar；零依赖是部署优势。
- 当前策略规模小（L0/L1/L2、几类触发、例外），JSON 规则足够。
- 和 receipt/assessment 的 schema 可以共用同一套字段与测试。

### 代价与风险

- 自研引擎有 bug 风险；用 schema lint、决策表测试、属性测试（对任意输入 tier 单调）降低。
- 表达力有限；复杂组织策略要 OPA/Cedar。
- 规则变更需要评审 + digest + 回归。

### 何时反悔

- 规则 >20 条、需要多团队自定义、需要 Rego 生态 → 切 OPA；
- 需要形式化保证/强类型策略 → 切 Cedar；
- 自研引擎出现无法修复的语义 bug → 切换并保留 digest 兼容。

---

## D4 证据库

### 这属于什么经典问题/变体？

- **审计日志完整性（audit trail integrity）**；
- **WORM/不可变存储**；
- **内容寻址（content-addressed storage）**；
- **透明日志（transparency log）**；
- **保留/删除策略与可复验性**；
- **agent 可写仓库 ≠ 证据库**。

### 2026-11 可用的优秀方案

| 方案 | 优点 | 代价 | 适用 |
|---|---|---|---|
| repo `.firetree` 仅存 | 简单、随 PR | agent 可重写；不是审计证据 | 不可作为权威 |
| **GitHub Actions artifacts + artifact attestations** | 原生、与 OIDC/PR 集成、Sigstore 签名、可下载/保留 | 保留期有限（默认 90 天）；依赖 GitHub | 推荐 v0.1 |
| OCI registry + cosign | 内容寻址、签名、跨云、可离线 | 需要 registry/运维 | 企业/长期 |
| S3/MinIO Object Lock | WORM、保留策略、离线可控 | 需要对象存储/权限 | 长期/合规 |
| Rekor 透明日志 | 公开可验证、防篡改 | 公共实例网络/隐私；自建成本 | 对外审计/公开项目 |

> 技术核查：Sigstore keyless + GitHub attestations 在 2026 已是生产实践；见 D1 引用。

### 决定

- **权威证据 = 外部不可变存储**；repo 的 `.firetree` 只保存 receipt/manifest/投影，不是权威。
- v0.1 参考实现：**GitHub Actions artifacts + `actions/attest-build-provenance`**（或等价 cosign 签名）绑定 receipt bundle；保留期至少覆盖审计窗口（默认 1 年；GitHub 默认 90 天，需延长或转存）。
- 长期/合规：**S3/MinIO Object Lock**（1 年+），可选 **Rekor** 透明日志。
- 离线验证：CI 生成 `bundle.tar.zst`（assessment/receipt/evidence/claims/attestation），`firetree-check --bundle` 校验；bundle 的 manifest 含每个文件的 sha256。
- 远程 URL 不作为唯一证据；必须落到 bundle 或对象存储。

### 为什么适合 DSH / 本项目

- DSH 本地文件全部在 agent 写作用域内，不能当证据库。
- DSH session log 是宿主私有的，不可移植/离线复验；不能替代 CI 证据库。
- GitHub 已经是仓库和 CI 所在地；artifact attestation 原生，成本最低。
- 对无 GitHub 的环境，S3/MinIO Object Lock 是成熟替代。

### 代价与风险

- 存储/保留成本；下载/验证时间。
- GitHub artifact 保留期短；必须转存或延长。
- 对象存储权限/加密/生命周期配置错误会导致证据丢失。
- Rekor 可能暴露元数据；私有项目默认关闭。

### 何时反悔

- 合规要求 7 年 WORM/法律保留 → S3 Object Lock + 法务流程；
- 多 CI/多仓 → OCI registry + cosign；
- 需要公开可验证 → Rekor/透明日志；
- GitHub 不可用 → S3/MinIO + 内部 OIDC。

---

## D5 试点范围

### 这属于什么经典问题/变体？

- **试点选择/外部有效性（external validity）**；
- **冷启动（cold start）**：注册表/策略/证据从 0 开始；
- **自用（dogfooding）**：自己不用，团队不信；
- **创新扩散（diffusion of innovations）**：champion/黄金路径；
- **样本的代表性**：一个仓不能代表百万行。

### 2026-11 可用的优秀方案

| 方案 | 优点 | 代价 | 风险 |
|---|---|---|---|
| 只做 1 个外部仓 | 聚焦 | 无法证明 docs/config 与代码两条路径 | 外部依赖 |
| 2 个外部仓 | 代表性好 | 协调成本高 | 启动慢 |
| **本仓 + 1 个外部代码仓** | 立即 dogfood；覆盖 L0 与 L1/L2；协调少 | 本仓不是大规模代码 | 外部仓仍需要 |
| 多仓/全组织 | 数据多 | 风险/成本高 | 不推荐 |

### 决定

- **Pilot A：本仓库 `FireTree-DSH`**（docs/config 为主，dogfood；先把 `.firetree` 用起来）。
- **Pilot B：1 个外部代码仓**（有 CODEOWNERS、CI、愿意配合的团队；优先中等规模、非超大型）。
- 先 **1 个外部团队**；4 周后若数据支持，再扩第 2 个外部团队/仓。
- 目标不是“百万行验证”，而是验证**协议可运行、证据可验证、误拦可控**；百万行留给 M4。

### 为什么适合 DSH / 本项目

- 本仓是现成的、无协调成本；能立即暴露 L0/L1 与安装问题。
- 外部代码仓提供真实 PR/CODEOWNERS/CI；一个就够验证主要链路。
- DSH profile 安装、plugin_manager、cordis_inspect 都能在本仓先跑通。

### 代价与风险

- 本仓规模小，不能证明大规模性能；需明确标注。
- 外部团队可能延期；设 2 周 fallback：先本仓 + 一个公开仓（离线/本地 git）跑技术预演。
- 只一个外部仓，外部有效性有限；报告中只报方向性。

### 何时反悔

- 4 周内没有外部团队 → 改公开仓/本地仓技术预演，但不声称团队试点；
- 本仓无法产生 L1/L2 数据 → 增加一个外部代码仓；
- 误拦/性能问题严重 → 暂停扩面，先修。

---

## D6 XML 解析

### 这属于什么经典问题/变体？

- **解析器差异（parser differential）**：同一文档，不同解析器结论不同；
- **XML 安全**：XXE、实体膨胀（billion laughs）、DOCTYPE、超大文档；
- **供应链**：依赖维护状态/CVE；
- **正则解析不可靠**：JUnit 是结构化 XML，不是文本。

### 2026-11 可用的优秀方案

| 方案 | 优点 | 代价 | 结论 |
|---|---|---|---|
| 正则/手写扫描 | 无依赖 | 易错、可被伪造、解析器差异 | 拒绝 |
| `saxes` | 流式 SAX、API 好 | **2026 年已归档/维护评分极低** | 不再选 |
| **`fast-xml-parser` 5.11.x** | 维护活跃、MIT、验证+解析、性能好 | 2026-10 有 DOCTYPE 实体膨胀类 advisory；必须拒绝 DOCTYPE + 固定修复版本 | 默认 |
| `@xmldom/xmldom` 0.9.x | 维护、W3C DOM、标准 | DOM 内存高；历史 CVE 需跟踪 | 备选 |
| 自研严格子集 | 无依赖、可控 | 自研成本/漏洞 | 最后备选 |

> 技术核查（外部资料，仅作选型依据）：
> - `fast-xml-parser` 维护健康、MIT、最新 5.11.x；[Snyk package health](https://security.snyk.io/package/npm/fast-xml-parser)、[FOSSA](https://fossa.com/packages/npm/fast-xml-parser/)
> - 2026-10 有 DOCTYPE/实体限制相关 advisory；[GitLab advisories](https://advisories.gitlab.io/pkg/npm/fast-xml-parser/)
> - `saxes` 已归档、维护评分 0/10；[deps.dev](https://deps.dev/project/github/lddubeau%2Fsaxes)
> - `@xmldom/xmldom` 仍在维护；[npm](https://www.npmjs.com/package/@xmldom/xmldom/v/0.8.15?activeTab=dependents)

### 决定

- **默认 `fast-xml-parser` 5.11.x（或当前修复 advisory 的更高版本）**，隔离在 `src/lib/evidence/xml.js`，作为唯一新增运行时依赖。
- 强制安全配置：
  - 先拒绝含 `<!DOCTYPE`/`<!ENTITY` 的文档；
  - `processEntities: false`、`htmlEntities: false`；
  - 文件大小上限（默认 64 MiB）、testcase 数上限、深度上限；
  - 用 `XMLValidator` 先验证 well-formed，再解析；
  - 从 `testcase` 元素计数，不信任 `tests` 属性；
  - 拒绝 `<failure>`/`<error>`（或按 policy 允许）。
- **备选**：若安全评审否决 `fast-xml-parser`，切 `@xmldom/xmldom` 0.9.x（同样拒绝 DOCTYPE/ENTITY + 大小限制）；不回到正则。
- 依赖固定版本 + lockfile + SBOM + `npm audit`/Dependabot；核心仍零依赖，只有证据适配器引入。
- 对超大文件：逐文件处理、流式/分块；若内存超限，降级为“拒绝并给出 gap”，不静默跳过。

### 为什么适合 DSH / 本项目

- JUnit 是真实证据的关键；正则校验会重演“证据剧场”。
- DSH bundle 支持 npm 依赖；隔离一个解析器比自研更安全。
- 2026 年 `fast-xml-parser` 仍活跃，MIT；`saxes` 已不维护。

### 代价与风险

- 多一个依赖/供应链面；需要锁版本/审计。
- 大 JUnit 文件的内存/时延；需要上限和逐文件处理。
- advisory 需要跟踪；固定修复版本。

### 何时反悔

- 新 CVE/维护停滞 → 切 `@xmldom/xmldom` 或自研严格子集；
- 内存/性能不达标 → 流式 tokenizer/分块；
- 依赖政策禁止 → 自研 + fuzz + 第三方测试。

---

## D7 Schema 策略

### 这属于什么经典问题/变体？

- **Schema 演化（schema evolution）**；
- **向后/向前兼容**；
- **破坏性变更/语义版本**；
- **迁移/双写/expand-contract**；
- **审计证据的长期可读性**。

### 2026-11 可用的优秀方案

| 方案 | 优点 | 代价 | 适用 |
|---|---|---|---|
| 兼容 v0、补丁式修 | 不破坏现有工件 | v0 契约有 L0 死锁/unknown 矛盾；补丁会保留坏语义 | 已有生产时 |
| **干净 v1 + 迁移** | 语义干净、代码简单、测试清晰 | 一次性迁移；旧工件需转换 | 无生产/早期 |
| 双写/expand-contract | 平滑 | 复杂、长期维护两套 | 大生产 |
| Schema registry | 自动兼容检查 | 额外基础设施 | 多团队/长期 |

### 决定

- **干净 v1（major bump）**：receipt/assessment/evidence/policy/review/synthesis/hypotheses 全部 v1；`firetree.xxx/v1`。
- `scripts/migrate-v0-to-v1.mjs`：转换旧 `.firetree`/fixtures；幂等；保留原始备份。
- `docs/COMPATIBILITY.md`：v0→v1 字段映射、破坏性变更、迁移命令。
- **不做双写**；v1 工具拒绝 v0 工件并给迁移提示；v0 fixtures 保留作为“旧工件被拒/可迁移”测试。
- 包版本 `0.1.0`；`engines.dsh`/`engines.node` 明确。

### 为什么适合 DSH / 本项目

- 没有生产用户；v0 已知有契约死锁，继续背兼容包袱不划算。
- DSH 插件升级是显式的；一次性迁移可控。
- 干净 v1 让“L0/unknown/assurance”一次改对，避免长期补丁。

### 代价与风险

- `.tmp` 下 100 PR 试点工件需要迁移/重建；测试/fixtures 更新。
- 外部已引用 v0 的文档/样例需更新。
- 迁移脚本 bug 可能丢字段；需幂等/备份/校验。

### 何时反悔

- 发布前发现真实生产 v0 工件 → 加 expand-contract 窗口；
- 外部消费者已依赖 v0 → 保留 v0 读取适配器一个版本；
- 版本升级造成不可接受的破坏 → 重新评估。

---

## D8 周期与人力

### 这属于什么经典问题/变体？

- **规划谬误（planning fallacy）**；
- **关键链/资源约束**；
- **布鲁克斯法则**（加人不能救急）；
- **总线因子（bus factor）**；
- **范围-时间-质量三角**。

### 2026-11 可用的优秀方案

| 方案 | 周期 | 人力 | 取舍 |
|---|---|---|---|
| 8 周 | 紧 | 2–3 FTE | 只能修 P0 + 部分 evidence；无 pilot |
| **12 周** | 现实 | 2.5–3 FTE | P0/P1 + 2 仓 pilot + 加固 |
| 18–20 周 | 宽松 | 1–1.5 FTE | 单人可做，砍 A3/签名/长期库 |
| 24 周+ | 完整 | 3 FTE | 接近原计划，但可能过度 |

### 决定

- **12 周、2.5–3 FTE**：1 协议/后端全职 + 1 CI/平台 0.75 + 0.5 安全 + 0.25 SRE + 试点团队 0.2 + 审计 0.2。
- **第二维护者**必须指定（bus factor）。
- 如果只有 1 FTE：**18–20 周**，并砍掉 A3 签名、长期证据库、第二试点团队；仍保留 P0 + A2 + 本仓/1 外部仓。
- 不把 12 周压成 8 周；8 周只能做“契约自洽 + 本仓 dogfood”，不能声称真实部署。

### 为什么适合 DSH / 本项目

- 工作跨协议、CI、安全、证据、试点；单人 12 周不现实。
- DSH 插件/CI/attestation/pilot 都需要外部协调。
- 第二维护者是对 R9（单维护者）风险的直接缓解。

### 代价与风险

- 人员/时间成本；招聘/协调。
- 关键路径依赖 CI/安全评审；可能延期。
- 单人模式会拉长，需接受范围缩减。

### 何时反悔

- 第 2 周仍无试点团队 → 先本仓 + 公开仓技术预演，延长 2 周；
- 只有 1 FTE → 立即按 18–20 周重排，砍 A3/长期库；
- 安全问题阻塞 OIDC → 降级 A1/A2，不硬推 A3。

---

## D9 Q1/Q3 去留

### 这属于什么经典问题/变体？

- **范围蔓延（scope creep）/功能主义**；
- **仪式化/安全剧场（ceremony/security theater）**；
- **独立验证（independent verification）**：验证者必须独立于被验证对象；
- **MVP/最小可审计核心**；
- **过度类比**（把“多模型”叫“多专家”）。

### 2026-11 可用的优秀方案

| 方案 | 优点 | 代价 | 诚实度 |
|---|---|---|---|
| 保持 Q1/Q3 门禁（现状） | 叙事完整 | 假独立性、假 dossier、L2 摩擦；数据不可信 | 低 |
| 真做 Q3：DSH `subagent` 多 provider/model + 独立上下文 + 记录 run id | 真实、可测 | 成本高、延迟高、模型差异难控 | 高 |
| **降级 advisory，记录但不门禁** | 诚实、低摩擦；保留数据 | 少两个“机制”的强制力 | 高 |
| 删除 | 最简单 | 丢失记录/未来选项 | 高 |

### 决定

- **v0.1 将 `classify` 与 `synthesize` 降级为 advisory（记录型/咨询型）**：
  - 不再作为 L2 receipt 的必填；
  - 不声称“独立验证/多专家”；
  - 保留工具/schema，便于记录与未来恢复；
  - 文档/CLAIMS 标注 `advisory`。
- L2 仍保留：review（七步/双轮）、correctness case、human signoff、evidence。
- **恢复条件**：4 周 pilot 后，如果数据显示“多席位/对象辨识改变决定或降低逃逸”，再用 DSH `subagent` 做真 Q3（不同 provider/model、独立上下文、run id、结构化输出），并重新作为门禁。
- 不用“单模型多提示词”冒充多专家。

### 为什么适合 DSH / 本项目

- 当前 Q1/Q3 没有消费者/独立验证；强制只会产生假数据（100 PR 试点已用假 dossier hash）。
- DSH 的 `subagent` 支持 provider/model 覆盖，未来做真 Q3 的集成成本低；现在不做是范围控制。
- 把 L2 的控制集中到 review+correctness+human，更容易在 12 周内跑通。

### 代价与风险

- 对外叙事从“四机制”变成“两机制 + 两 advisory”；需要诚实沟通。
- 可能被误解为退步；用 pilot 数据说明。
- 如果未来恢复，需要重新设计/测试；保留接口。

### 何时反悔

- pilot 显示多席位显著改善跨边界决策 → 恢复 Q3 门禁；
- pilot 显示对象辨识错误导致缺陷 → 恢复 Q1 门禁；
- 监管/客户要求 Q1/Q3 → 重新评估。

---

## 1. 这些决策对修复计划的改动

1. **L0（P-01）**：不再让 agent 写 light review；改为“默认 null + 10% 人类 spot-check”。§4.7 状态机、WP0、测试矩阵同步。
2. **人签（D1/D2）**：GitHub review + CI 导出 `approval.json` 为主；DSH approval 仅可选；A3 用 GitHub artifact attestation/签名。
3. **试点（D5）**：本仓 + 1 个外部代码仓 + 1 个外部团队；4 周后再扩。
4. **Q1/Q3（D9）**：classify/synthesize advisory；L2 不再要求 synthesis/classification；文档/CLAIMS 同步。
5. **XML（D6）**：`fast-xml-parser` 5.11.x（或修复版）+ DOCTYPE/ENTITY 拒绝 + 大小/深度/fuzz；备选 xmldom；不用 saxes。
6. **Policy（D3）**：自研 JSON 编译器 + decision log；OPA/Cedar 仅适配器。
7. **证据库（D4）**：外部不可变为权威；GitHub artifacts + attestations；repo 只存 manifest。
8. **Schema（D7）**：v1 + 迁移；不双写。
9. **周期（D8）**：12 周 2.5–3 FTE；单人 18–20 周并砍 A3。
10. **D1 环境限制**：当前 approval=never，插件不得伪造 human；无 OIDC 只能 A1。

## 2. 需要你知道的三件事（非工程师版）

1. **“谁说的”比“说了什么”更重要。** 以前插件只能看到 `human`/`ci:` 这样的字；现在由 GitHub 的 CI 身份和 PR 审批来证明“谁做的”。如果不用 GitHub/没有 CI 身份，项目只能算“本地自述”，不能对外称“可审计”。
2. **L0 不再让 agent 自己写“我看过了”。** 默认不评审；抽到 10% 时由真人快速看一眼。没有真人时，L0 只能算技术证据，不算交付完成。
3. **少两个“机制”，但更真。** `classify`（对象辨识）和 `synthesize`（多席位）先作为记录工具，不再卡 L2。等真实数据证明它们有用，再用 DSH 的多模型能力做真。L2 仍有评审、正确性论证、人签、证据。

## 3. 决策状态

- 状态：**ACCEPTED（AI 代决，2026-11-18）**；用户可随时否决。
- 生效：立即用于 `REPAIR-PLAN-2026-11-18.md`。
- 复核：M2（信任根上线后）与 M4（试点数据后）。
- 变更：任何修改新开 `DECISIONS-REPAIR-<date>.md`，不覆盖本文件。

---

## 4. 参考（2026-11 技术核查，外部资料仅作选型依据）

- Sigstore keyless 2026：[safeguard.sh](https://safeguard.sh/resources/blog/cosign-keyless-signing-workflows-2026)
- GitHub artifact attestation/SLSA：[官方 action](https://github.com/actions/attest-build-provenance)、[Kubetail ADR 2026-11-10](https://github.com/kubetail-org/kubetail/blob/be6cdd76e7680bcf4b1aee6ca41840a7b094bcef/docs/adr/2026-11-10-attest-build-provenance-in-the-release-jobs.md)
- `fast-xml-parser` 维护/安全：[Snyk](https://security.snyk.io/package/npm/fast-xml-parser)、[FOSSA](https://fossa.com/packages/npm/fast-xml-parser/)、[GitLab advisories](https://advisories.gitlab.io/pkg/npm/fast-xml-parser/)
- `saxes` 归档：[deps.dev](https://deps.dev/project/github/lddubeau%2Fsaxes)
- `@xmldom/xmldom` 维护：[npm](https://www.npmjs.com/package/@xmldom/xmldom/v/0.8.15?activeTab=dependents)
- DSH approval 服务与当前 approval=never：本次 `cordis_inspect_query` 与运行时快照。

> 外部资料可能变化；每次升级/复议重新核对版本与 advisory。
