# 100 PR autonomous 技术证据（含 49 个 A2 coverage）

> 日期：2026-11-08。性质：49 个 OTel PR 为 **A2 / ci-evidence / coverage**；51 个为 **A1 / analysis-only**。不是交付回执，不是 M1/M2。

## 1. 结果

| 项目 | 样本 | A2 CI coverage | A1 analysis-only | L0 | L1 | L2 |
|---|---:|---:|---:|---:|---:|---:|
| OpenTelemetry Collector | 50 | **49** | 1（`#16308` 无 Codecov 报告） | 17 | 15 | 18 |
| Kubernetes | 50 | 0 | 50（未接入 TestGrid JUnit） | 11 | 26 | 13 |
| 合计 | 100 | **49** | **51** | 28 | 41 | 31 |

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

- evidence kind：`coverage`
- producer：`ci:codecov`
- Codecov 报告：`ci_passed=true`、`state=complete`
- coverage 范围：约 **91.25%–91.38%**

A1 证据：

```json
{
  "scope": "analysis-only",
  "assurance": "A1"
}
```

## 2. 每个 PR 的工件

- `.firetree/changes/pr-<number>/assessment.json`
- `.firetree/pilot-analysis/pr-<number>.json`（A1）
- `.firetree/pilot-ci/pr-<number>-codecov.json`（A2，49 个）
- `.firetree/evidence/pr-<number>.json`

49 个 A2 文件已由 `check mode=autonomous` 校验；100 个 per-PR 工件（49 A2 + 51 A1）全部通过 harness 语义检查。旧的 `pr-143751-owned4` 测试工件不属于这 100 个，缺少 `scope`，不计入。

## 3. 生成命令

A1 analysis 基线：

```powershell
node scripts/pilot-technical-evidence.mjs `
  --root  D:\FireTree-DSH\.tmp\otel-pilot\opentelemetry-collector-main `
  --report D:\FireTree-DSH\.tmp\otel-pilot\report.json `
  --repo open-telemetry/opentelemetry-collector
```

A2 Codecov 升级：

```powershell
# 报告已用 curl 缓存在 .tmp/otel-pilot/codecov/<number>.json
node scripts/pilot-codecov-evidence.mjs `
  --root  D:\FireTree-DSH\.tmp\otel-pilot\opentelemetry-collector-main `
  --report D:\FireTree-DSH\.tmp\otel-pilot\report.json `
  --cache D:\FireTree-DSH\.tmp\otel-pilot\codecov `
  --out   D:\FireTree-DSH\.tmp\otel-pilot\codecov-summary.json
```

`#16308` 返回 404，保留 A1 analysis-only。

## 4. 这证明了什么

- 真实 OTel 提交的 Codecov coverage 报告可以下载、校验 `commitid`/`ci_passed`、作为外部 CI 证据；
- `scope` 从 `analysis-only` 升级到 `ci-evidence`，`assurance` 从 A1 升级到 A2；
- 49 个 PR 的 A2 工件全部通过 build/check；
- 没有人类参与，也没有伪造 human signoff。

## 5. 没有证明什么

- coverage 不等于测试全部通过；它是 Codecov 上传的覆盖率报告；
- 没有 JUnit 测试结果、SARIF、SBOM；
- K8s 50 个仍是 A1 analysis-only；TestGrid JUnit 尚未接入；
- 不是人类验收，不是 M1/M2；
- coverage 百分比只说明覆盖，不说明变更行为正确；
- Codecov 报告获取依赖公开 API；不可用时应降回 A1，不能伪造。

## 6. 下一步

1. 为 K8s 接入 TestGrid/JUnit（需要可访问的 GCS artifact 路径或凭据）；
2. 为 OTel 补齐 `#16308` 的 coverage 或声明其 A1；
3. 如要 SARIF/SBOM，接入 CodeQL/SBOM 生成器；
4. 没有这些证据的 PR 保持 `analysis-only`，不升级声明。
