# 100 PR autonomous 技术证据

> 日期：2026-11-08。性质：**analysis-only / A1 技术证据**。不是交付回执，不是 CI 证据，不是 M1/M2。

## 1. 结果

| 项目 | 样本 | 生成 | 失败 | L0 | L1 | L2 |
|---|---:|---:|---:|---:|---:|---:|
| OpenTelemetry Collector | 50 | 50 | 0 | 17 | 15 | 18 |
| Kubernetes | 50 | 50 | 0 | 11 | 26 | 13 |
| 合计 | 100 | 100 | 0 | 28 | 41 | 31 |

每个 PR 产出：

- `.firetree/changes/pr-<number>/assessment.json`
- `.firetree/pilot-analysis/pr-<number>.json`
- `.firetree/evidence/pr-<number>.json`

技术证据字段：

```json
{
  "schema": "firetree.technical-evidence/v0",
  "mode": "autonomous",
  "assurance": "A1",
  "scope": "analysis-only",
  "human_signoff": false,
  "completion_claim": false,
  "milestone_claim": false
}
```

证据 producer：`tool:firetree-pilot-assess`；kind：`analysis`。  
它不是 test/coverage/SARIF/SBOM。

## 2. 生成命令

```powershell
node scripts/pilot-technical-evidence.mjs `
  --root  D:\FireTree-DSH\.tmp\otel-pilot\opentelemetry-collector-main `
  --report D:\FireTree-DSH\.tmp\otel-pilot\report.json `
  --repo open-telemetry/opentelemetry-collector `
  --out D:\FireTree-DSH\.tmp\otel-pilot\evidence-summary.json
```

Kubernetes 同理，`--repo kubernetes/kubernetes`，report 用 `report-owned.json`。

生成脚本内置 `check mode=autonomous`，100/100 通过。

## 3. 这证明了什么

- assessment → analysis evidence → technical evidence → check 的 autonomous 闭环可以在 100 个真实 PR 上跑通；
- 每个工件有 assessment 哈希、impact、owner、tier、expiry；
- 无人类参与，也没有伪造 human signoff；
- state 对单个样本显示 0 pending（technical evidence 存在时不再报 governed gaps）。

## 4. 没有证明什么

- **没有 test/coverage/SARIF/SBOM 证据**：analysis-only 只证明“分析和分级已执行”，不证明代码行为正确；
- 没有 A2 CI 证据；
- 没有人类可接受性判定；
- 没有 M1/M2 里程碑；
- K8s 的 merge commit 文件集仍可能包含合并结果，不等于 PR 分支原始 diff；
- OTel/K8s 的 source/registry 是 .tmp 中的隔离快照，不是目标团队试点。

## 5. 下一步

1. 对每个 PR 接入真实 JUnit/coverage/SARIF/SBOM，才能把 scope 从 `analysis-only` 升级为 `test-evidence` / `ci-evidence`；
2. 没有这些证据时，技术证据只能停在 A1；
3. 如果要回答“L2 是否过严”，仍需人类或组织政策，autonomous 不能替代。
