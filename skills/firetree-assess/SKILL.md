# firetree-assess（M0 占位）

> M0 占位文本；`firetree_assess` 仍是 stub，返回 `NOT_IMPLEMENTED`。

用途：每次变更的唯一入口，输出风险等级、影响集、必需要工件与签字要求。

- 只读变更集与注册表，不读全库。
- 声明等级低于自动等级时拒绝；人工 override 只能升不能降，降级必须走带到期日的例外。
- 任一无法映射的路径或未知接口 → 置信度 low → 强制 L2。
- 输出写入 `.firetree/changes/<change>/assessment.json`。

正式规则见 `docs/ARCHITECTURE.md` §三.2、`docs/SCALE.md` §3。当前不要调用该工具期待真实结果。
