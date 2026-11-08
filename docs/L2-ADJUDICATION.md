# Kubernetes 5 个 L2 人工可接受性判定

> 日期：2026-11-08。状态：**待人类判定**。AI 只做筛选与技术初判，不签字、不替人确认。
>
> 样本来自 [PILOT-K8S.md](PILOT-K8S.md) 的 50 PR / 13 个 L2。这里选 5 个覆盖不同 L2 原因：
> 跨子系统、接口邻近、依赖变更、security、vendor/依赖。

## 判定口径

| 代号 | 含义 |
|---|---|
| A | L2 恰当：该变更确实需要 L2 的 synthesis + 七步评审 + correctness case + 人签 |
| B | 过严：应降为 L1/L0，L2 工件是负担 |
| C | 过松：应升到更高保证或增加额外证据 |
| D | 信息不足：无法判断，需补充上下文 |

判定问题：**如果这个 PR 在 FireTree 下被要求 L2 工件，这个要求是否与真实风险相称？**

注意：PR 已被合并，不等于 L2 工件被接受；人工判定不能由合并状态替代。

## 5 个样本

| PR | 变更主题 | FireTree L2 原因 | AI 初判（非签字） | 人工判定 |
|---|---|---|---|---|
| [#143751](https://github.com/kubernetes/kubernetes/pull/143751) | scheduler preemption / kube-scheduler interface | cross-subsystem: `pkg-scheduler`, `staging-kube-scheduler` | 偏 A：跨子系统且改 staging 接口文件；接口表缺失，但风险信号真实 | ☐ A ☐ B ☐ C ☐ D |
| [#143791](https://github.com/kubernetes/kubernetes/pull/143791) | scheduler podgroup 调度 | cross-subsystem: `pkg-scheduler`, `staging-kube-scheduler` | 偏 A：跨 scheduler 与 staging 契约；有 integration test | ☐ A ☐ B ☐ C ☐ D |
| [#142397](https://github.com/kubernetes/kubernetes/pull/142397) | ML-DSA service account token / go-jose | 多模块 dependency；testdata PEM 已豁免 security | 偏 A：依赖与新算法路径；testdata 豁免后仍因依赖保持 L2 | ☐ A ☐ B ☐ C ☐ D |
| [#143776](https://github.com/kubernetes/kubernetes/pull/143776) | RBAC bootstrap list reconcile | sensitive path: `pkg/registry/rbac/rest` | 偏 A：RBAC 权限路径，安全敏感；应保留人签 | ☐ A ☐ B ☐ C ☐ D |
| [#143657](https://github.com/kubernetes/kubernetes/pull/143657) | go-jose v4.1.7 依赖升级 | 多模块 dependency + staging/vendor cross | 偏 B 待议：纯依赖升级，是否值得完整 L2 工件需团队判断 | ☐ A ☐ B ☐ C ☐ D |

## 每个样本的判定记录

### #143751

- 文件：`pkg/scheduler/...` 8 个 + `staging/src/k8s.io/kube-scheduler/framework/interface.go`
- 影响：2 个子系统，26 个 owner，0 unknown，0 interface（接口表未建）
- 请判定：跨子系统 + staging 接口文件是否足以要求 L2？
- 人工结论：☐ A ☐ B ☐ C ☐ D
- 证据检查：____________________
- 备注：____________________
- 判定人 / 日期：____________________

### #143791

- 文件：`pkg/scheduler/algorithm_podgroup.go`、`schedule_one_podgroup.go`、测试、`staging/.../interface.go`、integration test
- 影响：3 个子系统，43 个 owner，0 unknown
- 请判定：scheduler 与 staging 的跨边界是否应触发 L2？
- 人工结论：☐ A ☐ B ☐ C ☐ D
- 证据检查：____________________
- 备注：____________________
- 判定人 / 日期：____________________

### #142397

- 文件：根/多模块 `go.mod/go.sum`、service account、OIDC、vendor go-jose、testdata 证书、feature list
- 影响：90 个 owner；testdata `.pem` 已不再贡献 sensitive 原因
- 请判定：依赖 + 加密算法路径是否应要求 L2？testdata 豁免是否合理？
- 人工结论：☐ A ☐ B ☐ C ☐ D
- 证据检查：____________________
- 备注：____________________
- 判定人 / 日期：____________________

### #143776

- 文件：`pkg/registry/rbac/rest/storage_rbac.go` + test
- 影响：security sensitive path，19 个 owner
- 请判定：RBAC 敏感路径的 L2 人签是否恰当？
- 人工结论：☐ A ☐ B ☐ C ☐ D
- 证据检查：____________________
- 备注：____________________
- 判定人 / 日期：____________________

### #143657

- 文件：多模块 `go.mod/go.sum`、vendor go-jose、vendor/modules.txt
- 影响：54 个 owner；纯依赖升级
- 请判定：依赖升级是否必须 L2，还是可以按依赖影响面降级？
- 人工结论：☐ A ☐ B ☐ C ☐ D
- 证据检查：____________________
- 备注：____________________
- 判定人 / 日期：____________________

## 不在本文件做的事

- 不把 AI 初判当人签；
- 不修改 FireTree 的 L2 规则；
- 不因为 PR 已合并就判定 L2 工件被接受；
- 不替代 CI 证据或 correctness case。

## 汇总（人工填写）

| 项 | 值 |
|---|---|
| A 数量 | |
| B 数量 | |
| C 数量 | |
| D 数量 | |
| 结论 | |
| 判定人 / 日期 | |
