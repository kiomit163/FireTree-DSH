# OpenTelemetry Collector 50-PR 技术预演

> 日期：2026-11-08。性质：**Stage 0 技术预演**，不是 M1 里程碑，不是团队试点，不冒充 CI 证据或误拦结论。

## 1. 样本与方法

- 仓库：`open-telemetry/opentelemetry-collector`（Apache-2.0，公开）。
- 源码：GitHub codeload `main` tarball（2.2 MB，2,909 个文件），因为本机 `github.com:443` 被挡；未修改源仓库。
- PR 元数据：GitHub REST API `pulls?state=closed&per_page=100&sort=updated&direction=desc`，取最近 50 个已合并 PR 的文件列表。
- 样本中 1 个 PR（`#16325`）达到 API 的 100 文件上限，按截断处理；其余 49 个文件列表完整。
- 使用最小 `.firetree` 注册表：22 个子系统、6 个接口、默认 CODEOWNERS owner；处理后 **unknown=0**。
- 运行方式：`scripts/pilot-assess.mjs` 直接调用与 `firetree_assess` 相同的 `loadRegistry` / `loadCodeowners` / `analyzeImpact`。
- 单元测试与 live 工具抽样：`#16250` 经 `firetree_assess` 实际调用得到 **L1**，与报告一致。

复现：

```powershell
node scripts/pilot-assess.mjs `
  --root  D:\FireTree-DSH\.tmp\otel-pilot\opentelemetry-collector-main `
  --manifest D:\FireTree-DSH\.tmp\otel-pilot\manifest.json `
  --out D:\FireTree-DSH\.tmp\otel-pilot\report.json
```

## 2. 结果（修复后）

| 指标 | 值 |
|---|---|
| 已评估 PR | 50 / 50 |
| 失败 | 0 |
| L0 | 17 |
| L1 | 15 |
| L2 | 18 |
| low confidence / unknown | 0 / 0 |
| 接口变更 PR | 2（#16019、#16281） |
| 真实跨子系统 PR | 15 |
| dependency 原因计数 | 283 |
| interface 原因计数 | 2 |

结论：在真实多模块 Go 仓库上，注册表覆盖了全部 50 个 PR 的路径；没有出现 unknown 导致的低置信 L2。L2 占比 36%，主要来自跨子系统与多模块 `go.mod` 变更；这符合当前策略，但说明“依赖变更即 L2”在多模块仓库会偏高，需要真实团队判断是否可接受。

## 3. 预演发现并修复的 bug

初版结果为 **L0 12 / L1 3 / L2 35**，其中 34 个 PR 被标记为 cross-subsystem。逐 PR 核查发现：

- `.chloggen/`、`docs/`、测试文件、根配置被计入了 `changedSubsystems`；
- 一个代码文件 + 一个文档文件就被判成跨子系统 L2；
- 20 个 PR 的 L2 仅由 L0 路径造成，其中 18 个在修正后降为 L1/L0，2 个仍因 dependency/interface 保持 L2。

修复：`src/lib/impact.js` 区分 `changedSubsystems`（完整影响上下文）与 `codeSubsystems`（仅非 L0 路径）；cross-subsystem 判定和 L2 只使用 `codeSubsystems`。接口消费者仍视为代码依赖。回归测试见 `test/impact.test.mjs`。

修复后：**L0 17 / L1 15 / L2 18**；cross 原因 34 → 15；未知路径仍为 0。

## 4. 这次预演证明了什么

- 真实 OSS 的 2,909 文件树、22 个子系统、CODEOWNERS 路径可以跑通确定性 impact/tier；
- 文档/测试/配置不应制造跨子系统 L2，已在产品代码中修复；
- 工具输出与脚本输出可以一致（`#16250` live L1）。

## 5. 没有证明什么

- **不是 M1**：没有 50 个真实团队 PR 的误拦 adjudication、成本、采用意愿。
- 没有使用 CI 的 JUnit/SARIF/coverage/SBOM 工件；OpenTelemetry 的 JUnit artifact 需要 GitHub Actions 访问/保留窗口。
- 没有运行 review/synthesize/receipt 全流程；L1/L2 的实际回执仍缺真实证据与人类签字。
- 没有判断 L2 36% 是否“过高”——需要团队以真实 PR 判定哪些是必要升级。
- `#16325` 文件列表被 API 截断；不应作为精确文件集指标。

## 6. 下一步

1. 对 50 个 PR 中 5 个 L2 做人工可接受性判定，建立最小 false-block 台账；
2. 接一两个真实 JUnit artifact 或本地重跑 CI，验证 A1/A2 边界；
3. 若继续，才把 OpenTelemetry 的注册表扩展到更细粒度（避免 `repo-root` 过大）。
