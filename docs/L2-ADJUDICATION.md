# Kubernetes 5 个 L2 规则一致性审计（autonomous）

> 日期：2026-11-08。状态：**autonomous 技术审计完成**。这不是人类可接受性判定，不产生 human signoff。
>
> 在 A 方案下，没有人类工程师做 A/B/C/D；这里只验证：**每个 L2 是否由确定性规则一致地产生**。它不回答“L2 是否过严/过松”。

## 审计口径

| 项 | 含义 |
|---|---|
| 规则命中 | 该 PR 的每个 L2 原因都能在 registry/policy 规则下复现 |
| 无 unknown | 文件全部映射到 subsystem |
| 无伪接口 | 没有把未注册接口说成 interface-change |
| 不判断比例 | 不判断依赖/跨子系统是否“值得” L2，这是政策问题 |

## 结果

| PR | FireTree L2 原因 | 规则一致性 | 备注 |
|---|---|---|---|
| [#143751](https://github.com/kubernetes/kubernetes/pull/143751) | cross-subsystem: `pkg-scheduler`, `staging-kube-scheduler` | PASS | 2 个子系统，0 unknown；接口表未建，未声称 interface |
| [#143791](https://github.com/kubernetes/kubernetes/pull/143791) | cross-subsystem: `pkg-scheduler`, `staging-kube-scheduler` | PASS | 含 integration test；仍为跨子系统 |
| [#142397](https://github.com/kubernetes/kubernetes/pull/142397) | dependency + cross-subsystem | PASS | testdata PEM 已豁免 security；仍因多模块依赖保持 L2 |
| [#143776](https://github.com/kubernetes/kubernetes/pull/143776) | sensitive path: `pkg/registry/rbac/rest` | PASS | security 段命中，规则一致 |
| [#143657](https://github.com/kubernetes/kubernetes/pull/143657) | dependency + cross-subsystem | PASS | 纯依赖升级；**政策问题未决**：依赖是否应一律 L2 |

## 开放政策问题

- 依赖升级是否一律 L2，还是按影响面降级？
- 跨 `pkg`/`staging` 的变更是否应因“同一逻辑模块”而合并判定？
- 这些需要团队/政策决定；autonomous 模式没有资格签字，只记录规则结果。

## 没有做的事

- 没有人类 A/B/C/D；
- 没有声称 M1/M2 通过；
- 没有把“规则一致”当作“风险比例合理”；
- 没有修改 L2 规则来迎合样本。

## 结论

5 个 L2 都由当前确定性规则一致产生；没有发现规则执行 bug。**人类可接受性仍未判定**，因为当前环境没有人类工程师；这不再阻断 autonomous 技术轨道。
