# firetree-synthesize（M0 占位）

> M0 占位文本；`firetree_synthesize` 仍是 stub，返回 `NOT_IMPLEMENTED`。

用途：仅 L2 的跨边界决策，用独立席位与多源证据收敛异议。名称是「独立席位评审」，不是「研讨厅」。

- 至少两个独立 provider/model；单模型多提示词不算多专家。
- 数据席位必须给出可复现命令与数值；经验席位给判断与依据。
- 综合器必须逐条回应异议；一轮无新异议才收敛，最多 3 轮，超时记未收敛并阻断。
- 输出写入 `.firetree/changes/<change>/round-N.json`。

正式规则见 `docs/ARCHITECTURE.md` §三.4、`docs/QIAN-LANDING.md` Q3。当前不要调用该工具期待真实结果。
