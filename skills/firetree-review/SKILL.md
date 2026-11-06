# firetree-review（M0 占位）

> M0 占位文本；`firetree_review` 仍是 stub，返回 `NOT_IMPLEMENTED`。

用途：把评审当作过程，记录评审包、轮次、发现、异议、回应与裁决。

- L1 三步：准则、评审、结论。
- L2 七步：准则、数据、人选、会前独立研究、会上充分讨论、书面结论、会后告知。
- 缺任一步不得 verdict；零异议轮必须自证「查过什么」。
- L2 需要外部人签；agent 自签恒为 0。
- 输出写入 `.firetree/changes/<change>/{package.json,round-N.json,verdict.json}`。

正式规则见 `docs/ARCHITECTURE.md` §三.5、`docs/QIAN-LANDING.md` Q4。当前不要调用该工具期待真实结果。
