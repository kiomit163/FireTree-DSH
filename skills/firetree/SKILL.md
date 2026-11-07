# FireTree 交付协议（M2 初版，W8 重写）

> 这是 M2 的可加载文本，W8 会重写。它用于路由与边界说明；不得据此声称未经工件验证的能力。

FireTree-DSH 是「可审计交付协议」，不是治理 OS。四机制是对象辨识、假设台账、综合集成评审、再评估；两横切是外部证据回执与人签。

## 路由

- 每次变更先调用 `firetree_assess`，出口是 `firetree_receipt`。
- 子系统/项目级的对象辨识用 `firetree_classify`，不要塞进每个 PR。
- 当前状态用 `firetree_state` 读取，不做每 prompt 注入。
- L2 才需要综合集成评审、七步评审、人签与完整 correctness case。

## 铁律

1. 没有回执，不声称完成。
2. 证据只能引用 CI/确定性工具产物；agent 不能生产证据，也不能自签。
3. 影响未知一律升 L2。
4. L2 的每条 claim 至少映射一个 invariant 与一条证据；空映射拒绝。
5. 新想法入 Parking Lot，不扩大 v1 范围。

## M1 边界

当前 7 个 FireTree 工具全部已实现；其中 `firetree_synthesize` 与 `firetree_review` 是 M2 初版，L2 的真实多席位/七步数据仍待试点。`classify` 写 `.firetree/oid/<id>.json`，`assess` 写 `.firetree/changes/<change>/assessment.json`，`hypothesis` 写 `.firetree/changes/<change>/hypotheses.json`，`review` 写评审包/轮次/裁决，`synthesize` 写 `synthesis/plan.json` 与 `synthesis/round-N.json`，`receipt` 写 `.firetree/receipts/<change>.json`。
