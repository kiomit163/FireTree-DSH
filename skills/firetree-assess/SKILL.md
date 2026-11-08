# firetree-assess（M1 初版）

用途：每次变更的唯一入口，输出风险等级、影响集、必需要工件与签字要求。

- 输入 `base`、`head`、`files[]`；可选 `declared_tier`、`policy_path`、`change`。
- 读取 `.firetree/policy.json`、`.firetree/subsystems/*.json`、`.firetree/interfaces/*.json`；owner 先读 CODEOWNERS，缺失时回退 Kubernetes OWNERS/OWNERS_ALIASES（最近目录、filters、aliases）。
- 只读变更集与注册表，不读全库。
- 声明等级低于自动等级时拒绝；人工 override 只能升不能降。
- 任一无法映射的路径或未知接口 → 置信度 low → 强制 L2。
- 输出写入 `.firetree/changes/<change>/assessment.json`；采样决定确定性记录。

正式规则见 `docs/ARCHITECTURE.md` §三.2、`docs/SCALE.md` §3。
