# 100 PR autonomous 技术证据（99 个 A2）

> 日期：2026-11-08。性质：49 个 OTel 为 **A2 / coverage**；50 个 K8s 为 **A2 / JUnit**；1 个 OTel 为 **A1 / analysis-only**。不是交付回执，不是 M1/M2。

## 1. 结果

| 项目 | 样本 | A2 | A1 | 主要证据 |
|---|---:|---:|---:|---|
| OpenTelemetry Collector | 50 | **49** | 1（`#16308`） | Codecov coverage，`ci:codecov` |
| Kubernetes | 50 | **50** | 0 | Prow JUnit XML，`ci:prow` |
| 合计 | 100 | **99** | **1** | coverage + JUnit |

Tier 分布不变：

| 项目 | L0 | L1 | L2 |
|---|---:|---:|---:|
| OTel | 17 | 15 | 18 |
| Kubernetes | 11 | 26 | 13 |
| 合计 | 28 | 41 | 31 |

A2 证据：

```json
{
  "schema": "firetree.technical-evidence/v0",
  "mode": "autonomous",
  "assurance": "A2",
  "scope": "ci-evidence",
  "human_signoff": false,
  "completion_claim": false,
  "milestone_claim": false
}
```

- OTel：kind `coverage`，producer `ci:codecov`，`ci_passed=true`，coverage 约 **91.25%–91.38%**。
- Kubernetes：kind `test`，producer `ci:prow`，JUnit XML（如 `#143751`：`tests=2436 failures=0`）。

A1 证据：

```json
{ "scope": "analysis-only", "assurance": "A1" }
```

`#16308` 没有 Codecov 报告，保留 A1。

## 2. 每个 PR 的工件

- `.firetree/changes/pr-<number>/assessment.json`
- `.firetree/pilot-analysis/pr-<number>.json`（A1 基线）
- `.firetree/pilot-ci/pr-<number>-codecov.json`（OTel A2）
- `.firetree/pilot-ci/pr-<number>-junit.xml`（K8s A2）
- `.firetree/evidence/pr-<number>.json`

99 个 A2 工件通过 `check mode=autonomous`；100 个 per-PR 工件（99 A2 + 1 A1）通过 harness 语义检查。旧的 `pr-143751-owned4` 测试工件不属于这 100 个。

## 3. 生成方式

A1 analysis 基线：

```powershell
node scripts/pilot-technical-evidence.mjs `
  --root  <repo> --report <report.json> --repo <label>
```

OTel A2 coverage：

```powershell
# 先用 curl 缓存 .tmp/otel-pilot/codecov/<number>.json
node scripts/pilot-codecov-evidence.mjs `
  --root  <otel> --report <report.json> `
  --cache .tmp/otel-pilot/codecov
```

K8s A2 JUnit：

```powershell
node scripts/pilot-prow-junit-evidence.mjs `
  --root  D:\FireTree-DSH\.tmp\k8s-pilot\repo `
  --report D:\FireTree-DSH\.tmp\k8s-pilot\report-owned.json
```

K8s 流程：merge commit 的第二父提交 → GitHub statuses → Prow `target_url` → Prow `lensArtifacts` → GCS JUnit XML。50/50 成功。

## 4. 这证明了什么

- OTel 的 coverage 来自真实提交的 Codecov 报告；
- K8s 的 JUnit 来自真实 Prow presubmit 的 GCS artifact；
- 99 个 PR 的 `scope` 已从 `analysis-only` 升级到 `ci-evidence`，`assurance` 升级到 A2；
- 99 个 A2 工件全部通过 build/check；
- 没有人类参与，也没有伪造 human signoff。

## 5. 没有证明什么

- coverage ≠ 测试全部通过；K8s JUnit 是 **unit** presubmit，不等于 e2e/integration 全覆盖；
- 没有 SARIF、SBOM；
- `#16308` 仍是 A1；
- 不是人类验收，不是 M1/M2；
- 证据只证明“CI 产出了这份 coverage/JUnit 并被哈希引用”，不证明变更行为完全正确。

## 6. 下一步

1. 为 `#16308` 找 Codecov 替代或保持 A1；
2. 接入 SARIF（CodeQL）和 SBOM；
3. 对 K8s JUnit 增加 XML 结构/失败数校验（当前只校验 XML 起点和 CI status）；
4. 没有证据的 PR 不升级声明。

