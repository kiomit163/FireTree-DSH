# Kubernetes 50-PR 规模预演

> 日期：2026-11-08。性质：**Stage 0 规模预演**。OWNERS 适配器为最小实现，不是 M1，不冒充团队试点或 CI 证据。

## 1. 方法与边界

- 仓库：`kubernetes/kubernetes`，默认分支 `master`。
- 源码/历史：Gitee 镜像 `https://gitee.com/mirrors/Kubernetes.git`，blobless、无工作区克隆；实际返回 140,166 个 commit 的完整历史（`--depth=300` 未生效），未 checkout 源码。
- 样本：最近 50 个 `Merge pull request #...` merge commit；base 取第一父提交，文件列表用 `git diff-tree base..merge`；共 368 个文件。
- 注册表：先跑 12 个顶层子系统，再细化到 **77 个**（`api`、`build`、`cluster`、`cmd`、`hack`、`test`、`third_party`、`vendor`、`repo-root`、`pkg/*` 的 30 个一级目录、`staging/src/k8s.io/*` 的 35 个仓库）。
- **没有 CODEOWNERS**：Kubernetes 使用 `OWNERS`/`OWNERS_ALIASES`；已实现最小适配器（最近目录、filters、aliases、approvers/reviewers），从 git tree 提取 **594 个 OWNERS** 与根 `OWNERS_ALIASES`。owner 不再使用占位符。
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
| sensitive path 原因 | 4 | 4 |
| interface 原因 | 0（未建接口表） | 0（未建接口表） |
| OWNERS 文件 | 594 | 594 |
| 无 owner 的 PR | 0 | 0 |

细化后唯一的 tier 变化：`#142763` 从 L1 → L2，原因是同时改动 `staging-apimachinery` 与 `staging-apiserver`。这说明**粗粒度确实会低估跨子系统，但在本样本里只低估 1/50**，不是主要误差来源。

细化后的 L2：`143751`、`143791`、`142397`、`143778`、`143776`、`139079`、`143587`、`142956`、`143657`、`142789`、`143696`、`143734`、`142763`。

典型 L2：

- `143751`：`pkg/scheduler` 与 `staging/src/k8s.io/kube-scheduler` 跨子系统；
- `142397`：多模块 `go.mod/go.sum` + 安全敏感路径；
- `143776`：`pkg/registry/rbac/rest` 命中 security 段；
- `143657`：`staging` + `vendor` + 根依赖跨子系统；
- `142763`：`apimachinery` 与 `apiserver` 跨仓库。

Live 抽样：`#143751` 经 `firetree_assess` 实际调用得到 **L2**，与脚本报告一致；打开 assessment 后可看到 `pkg/scheduler` 与 `staging/.../kube-scheduler` 的真实 owner。

OWNERS 验证：加载 **594 个 OWNERS**、50 个 PR 全部解析出 owner（`ownerless_prs=[]`）。例如 `go.mod` 命中根 `filters` 的 `go\.(mod|sum|work|work\.sum)$`，`pkg/scheduler/...` 命中 `pkg/scheduler/OWNERS`，`staging/.../kube-scheduler/...` 命中对应 staging OWNERS。

## 3. 发现

1. **粗粒度低估跨子系统，但幅度有限**：12 → 77 个子系统后只多 1 个 L2（`#142763`）。原先“27 个 L1 中可能大量是误判”的假设被数据削弱；下一步更值得做的是接口表和 owner。
2. **testdata 的 `.pem` 被当 security 敏感路径**：`142397` 的 `staging/.../testdata/mldsa_*.pem` 触发 sensitive path。它们看起来是测试证书，是否应阻断 L2 需要团队决定；当前规则不区分 `testdata`。
3. **OWNERS 适配器已实现，但仍是“最小”语义**：支持最近目录、`filters`（按最后一个匹配）、`aliases`、approvers/reviewers；忽略 `emeritus_approvers`、`options`、复杂 YAML。真实 owner 已解析，但不能等同 Kubernetes 官方 OWNERS 工具的全部行为。
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
- 没有验证 Kubernetes 官方 OWNERS 工具的全部语义；当前适配器是最小实现（filters 取最后一个匹配，忽略 emeritus/options/复杂 YAML）。
- 50 个 merge commit 的文件列表是 merge 结果，不等于 PR 分支的原始 diff；对合并冲突的 PR 可能多出内容。

## 6. 下一步

1. 用 Kubernetes 官方 `verify-owners`/OWNERS 测试数据对拍当前适配器，确认 filters 顺序与 aliases 语义；
2. 决定 `testdata/*.pem` 是否应豁免 security L2；
3. 再选 5 个 L2 做人工可接受性判定；没有这一步，不能谈误拦率。
