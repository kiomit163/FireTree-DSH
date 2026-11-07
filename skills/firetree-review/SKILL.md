# firetree-review（M2 初版）

用途：把评审当作过程，记录评审包、轮次、发现、异议与裁决。

- `open` 读取 assessment 的 tier，绑定 diff/spec 哈希、准则、证据清单与席位；L2 至少两个不同 owner 的席位。
- `round` 记录发现：location / claim / evidence / verdict / route / lens；零发现必须写「查过什么」。
- `verdict`：L1 三步（criteria/review/conclusion），L2 七步（criteria/data/seats/pre_read/discussion/written_conclusion/notify）；L2 至少两轮、最后一轮零发现、人签；零异议必须附检查记录。
- 工件：`.firetree/changes/<change>/{package.json,round-N.json,verdict.json}`，带 `.sha256`。
- 工具只校验工件，不自动开会、不模拟评委会。

正式规则见 `docs/ARCHITECTURE.md` §三.5、`docs/QIAN-LANDING.md` Q4。
