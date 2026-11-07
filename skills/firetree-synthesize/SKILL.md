# firetree-synthesize（M2 初版）

用途：仅 L2 的跨边界决策，用独立席位与多源证据收敛异议。名称是「独立席位评审」，不是「研讨厅」。

- `plan`：读取 L2 assessment，生成数据/模型/经验席位、输出 schema、20 分钟时间盒、最多 3 轮；写 `.firetree/changes/<change>/synthesis/plan.json`。
- `record`：至少两个不同 provider/model 的 model 席位；数据席位必须给 `command` 与数值；综合器逐条回应异议。
- 收敛条件：综合器声明 converged、无未回应异议、无新异议、未超时间盒；否则 `ok:false`，不得写收敛轮。
- 工件的轮次写入 `.firetree/changes/<change>/synthesis/round-N.json`，带 `.sha256`；不与 review 的 `round-N.json` 混用。
- 工具不调用模型；它校验席位结果与收敛记录。

正式规则见 `docs/ARCHITECTURE.md` §三.4、`docs/QIAN-LANDING.md` Q3。
