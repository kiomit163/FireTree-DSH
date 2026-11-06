# firetree-classify（M0 占位）

> M0 占位文本；`firetree_classify` 仍是 stub，返回 `NOT_IMPLEMENTED`。

用途：在子系统/项目层做对象辨识，回答「这次对象能否分解、未知层次由谁负责、用什么方法」。

- 作用域是子系统或项目，不是单个 PR。
- 输入应包含 `kind`、已知/未知层次、耦合证据、可分解性测试、方法与未知项 owner。
- 未知层次非空时，不得声称可分解；OCG/unknown 必须保留人工签字路径。
- 输出 dossier，写入 `.firetree/subsystems/<id>.json`。

正式规则见 `docs/ARCHITECTURE.md` §三.1、`docs/QIAN-LANDING.md` Q1。当前不要调用该工具期待真实结果。
