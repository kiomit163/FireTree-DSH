# firetree-classify（M1 初版）

用途：在子系统/项目层做对象辨识，回答「这次对象能否分解、未知层次由谁负责、用什么方法」。

- 作用域是子系统或项目，不是单个 PR。
- `action=set` 写入 `.firetree/oid/<id>.json`；`action=show` 读取并校验 hash。
- 未知层次非空却声明可分解会被拒绝；metasynthesis 无 owner、unknown 无 learning plan、OCG 用 decompose 均拒绝。
- 输出 dossier，包含 `allowed.decomposition_autonomy` 与 `allowed.requires_human_signoff`。
- 当前初版只覆盖 classify；不要把它扩大到每个 PR。

正式规则见 `docs/ARCHITECTURE.md` §三.1、`docs/QIAN-LANDING.md` Q1。
