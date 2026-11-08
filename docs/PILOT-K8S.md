# Kubernetes 50-PR 规模预演

> 日期：2026-11-08。性质：**Stage 0 规模预演**。OWNERS 适配器为最小实现，不是 M1，不冒充团队试点或 CI 证据。

## 1. 方法与边界

- 仓库：`kubernetes/kubernetes`，默认分支 `master`。
- 源码/历史：Gitee 镜像 `https://gitee.com/mirrors/Kubernetes.git`，blobless、无工作区克隆；实际返回 140,166 个 commit 的完整历史（`--depth=300` 未生效），未 checkout 源码。
- 样本：最近 50 个 `Merge pull request #...` merge commit；base 取第一父提交，文件列表用 `git diff-tree base..merge`；共 368 个文件。
- 注册表：先跑 12 个顶层子系统，再细化到 **77 个**（`api`、`build`、`cluster`、`cmd`、`hack`、`test`、`third_party`、`vendor`、`repo-root`、`pkg/*` 的 30 个一级目录、`staging/src/k8s.io/*` 的 35 个仓库）。
- **没有 CODEOWNERS**：Kubernetes 使用 `OWNERS`/`OWNERS_ALIASES`；已实现最小适配器（最近目录 + 父目录累积、filters、aliases、approvers/reviewers、`no_parent_owners`），从 git tree 提取 **594 个 OWNERS** 与根 `OWNERS_ALIASES`。owner 不再使用占位符。
- 对拍：`test/owners-official.test.mjs` 使用 `kubernetes-sigs/prow/pkg/repoowners/repoowners_test.go` 的 `TestGetApprovers` / `TestExpandAliases` 语义：父目录累积、filter 全匹配、`no_parent_owners`、大小写不敏感 alias。
- 没有定义接口注册表；因此本次没有 interface-change 原因。

复现：

```powershell
node scripts/pilot-assess.mjs `
  --root  D:\FireTree-DSH\.tmp\k8s-pilot\repo `
  --manifest D:\FireTree-DSH\.tmp\k8s-pilot\manifest.json `
  --out D:\FireTree-DSH\.tmp\k8s-pilot\report-refined.json
```

## 2. 结果

| 指标 | 12 个顶层子系统（粗） | 77 个子系统（细化） |
|---|---:|---:|
| 已评估 PR | 50 / 50 | 50 / 50 |
| 失败 | 0 | 0 |
| L0 | 11 | 11 |
| L1 | 27 | 26 |
| L2 | 12 | **13** |
| unknown | 0 | 0 |
| 低置信 | 0 | 0 |
| 跨子系统 PR | 11 | 12 |
| dependency 原因 | 26 | 26 |
| sensitive path 原因 | 1 | 1 |
| interface 原因 | 0（未建接口表） | 0（未建接口表） |
| OWNERS 文件 | 594 | 594 |
| 无 owner 的 PR | 0 | 0 |

> `testdata/` 已按测试夹具处理：`testdata/*.pem` 不再触发 security L2。`142397` 仍因多模块依赖保持 L2；敏感路径原因从 4 降为 1（`143776` 的 `pkg/registry/rbac`）。

细化后唯一的 tier 变化：`#142763` 从 L1 → L2，原因是同时改动 `staging-apimachinery` 与 `staging-apiserver`。这说明**粗粒度确实会低估跨子系统，但在本样本里只低估 1/50**，不是主要误差来源。

细化后的 L2：`143751`、`143791`、`142397`、`143778`、`143776`、`139079`、`143587`、`142956`、`143657`、`142789`、`143696`、`143734`、`142763`。

典型 L2：

- `143751`：`pkg/scheduler` 与 `staging/src/k8s.io/kube-scheduler` 跨子系统；
- `142397`：多模块 `go.mod/go.sum`；testdata 证书已豁免，不再贡献 sensitive 原因；
- `143776`：`pkg/registry/rbac/rest` 命中 security 段；
- `143657`：`staging` + `vendor` + 根依赖跨子系统；
- `142763`：`apimachinery` 与 `apiserver` 跨仓库。

Live 抽样：`#143751` 经 `firetree_assess` 实际调用得到 **L2**，与脚本报告一致；打开 assessment 后可看到 `pkg/scheduler` 与 `staging/.../kube-scheduler` 的真实 owner。

OWNERS 验证：加载 **594 个 OWNERS**、50 个 PR 全部解析出 owner（`ownerless_prs=[]`）。例如 `go.mod` 命中根 `filters` 的 `go\.(mod|sum|work|work\.sum)$`，`pkg/scheduler/...` 累积根、`pkg`、`pkg/scheduler` 的 OWNERS，`staging/.../kube-scheduler/...` 命中对应 staging OWNERS。Live `#143751` 解析出 **26 个真实 owner**，不再含 `@kubernetes/pilot-owner`。

## 3. 发现

1. **粗粒度低估跨子系统，但幅度有限**：12 → 77 个子系统后只多 1 个 L2（`#142763`）。原先“27 个 L1 中可能大量是误判”的假设被数据削弱；下一步更值得做的是接口表和 owner。
2. **testdata 的 `.pem` 已决定豁免 security L2**：`testdata/` 加入测试路径集合，`.pem` 不再触发 sensitive path；`142397` 仍因依赖保持 L2。真实密钥泄露仍应由 secret scanning 负责，FireTree 不替代它。
3. **OWNERS 适配器已对拍，但仍是“最小”实现**：支持父目录累积、`filters`（所有匹配）、大小写不敏感 `aliases`、`no_parent_owners`、approvers/reviewers；忽略 `emeritus_approvers`、`options` 其他字段、复杂 YAML。对拍用例来自 Prow 官方测试，但不是直接运行 Prow 二进制。
4. **没有接口注册表就不能验证接口变更**：`staging/src/k8s.io/kube-scheduler/framework/interface.go` 这类文件被跨子系统规则捕获，但不是因为 interface-change。
5. **多模块 `go.mod/go.sum` 会放大 dependency L2**：26 条 dependency 原因；是否“依赖变更必 L2”需要真实团队校准。

## 4. 与 OTel 对比

| | OTel Collector | Kubernetes |
|---|---|---|
| PR | 50 | 50 |
| 文件 | 623 | 368 |
| L0/L1/L2 | 17 / 15 / 18 | 11 / 26 / 13 |
| unknown | 0 | 0 |
| CODEOWNERS | 有，已用 | 无；OWNERS 适配器已用 |
| 接口注册表 | 6 个 | 无 |
| 粒度 | 22 子系统 | 77 子系统（细化后） |

两者不可直接比较：Kubernetes 没有接口表，L1 占比更高；OTel 有接口表和 CODEOWNERS。这个对比说明**注册表和接口覆盖会显著改变 tier 分布**。

## 5. 没有证明什么

- 不是 M1；没有 50 个真实 PR 的团队误拦判定、成本、采用意愿。
- 没有使用 Kubernetes TestGrid JUnit、SARIF、coverage 或 SBOM。
- 没有跑 review/synthesize/receipt 全流程。
- 没有验证 Kubernetes 官方 OWNERS 工具的全部语义；当前适配器是最小实现（忽略 emeritus/options 其他字段/复杂 YAML），但已用 Prow 官方 `repoowners` 二进制级探针做 8/8 对拍，见 [PROW-OWNERS-PARITY.md](PROW-OWNERS-PARITY.md)。
- 50 个 merge commit 的文件列表是 merge 结果，不等于 PR 分支的原始 diff；对合并冲突的 PR 可能多出内容。

## 6. 下一步

1. Prow 官方测试已接入 CI workflow，并在 Linux Docker 中通过官方测试 + 8/8 对拍；GitHub runner 待真实触发，见 [PROW-OWNERS-PARITY.md](PROW-OWNERS-PARITY.md)；
2. 再选 5 个 L2 做人工可接受性判定；没有这一步，不能谈误拦率。见 [L2-ADJUDICATION.md](L2-ADJUDICATION.md)。
