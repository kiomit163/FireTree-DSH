# Autonomous 技术模式（A 方案）

> 日期：2026-11-08。适用：没有人类工程师可做独立签字，但仍要让 AI 在 FireTree 下持续工作。

## 1. 为什么需要它

FireTree 的 governed 模式要求 **producer 与 acceptor 分离**：AI 可以生产代码、测试和证据，但不能同时作为人类签字人。没有人类时，继续声称“交付回执”就是伪造。

autonomous 模式把保证上限显式降到 **A2：外部确定性证据完整**。它继续提供：

- 风险分级与影响集；
- 外部证据哈希校验；
- 假设台账；
- 可复核的变更工件。

它**不提供**：

- 人类签字；
- “交付完成”结论；
- M1/M2 里程碑通过；
- 对 L2 风险比例的人工判断。

## 2. 两种模式

| | governed（默认） | autonomous |
|---|---|---|
| 人类 signoff | L2 必需 | **禁止** |
| 输出 | `.firetree/receipts/<change>.json` | `.firetree/evidence/<change>.json` |
| schema | `firetree.receipt/v0` | `firetree.technical-evidence/v0` |
| correctness case / review / synthesis | L2 必需 | 不要求 |
| assurance | A1/A2 | A1/A2 |
| completion/milestone 声明 | 可表达 | `false` |
| 结论 | 可做 governed 交付判断 | 技术证据，不是交付完成 |

## 3. 用法

```json
{
  "action": "build",
  "mode": "autonomous",
  "change": "chg-123",
  "intent": { "spec": "specs/foo.md", "sha256": "<sha256>" },
  "classification": {
    "subsystem": "billing",
    "kind": "large",
    "method": "decompose",
    "dossier_sha256": "<sha256>"
  },
  "evidence": [{
    "kind": "test",
    "producer": "ci:github-actions",
    "run_ref": "evidence/junit.xml",
    "produced_at": "2026-11-08T00:00:00Z"
  }],
  "expires_at": "2026-12-08T00:00:00Z",
  "assurance": "A2"
}
```

`check` 时带 `"mode":"autonomous"` 读取 technical evidence。

## 4. 硬规则

- 证据 producer 不得是 `agent`；本地文件必须存在且 hash 一致；
- `human_signoff`、`completion_claim`、`milestone_claim` 永远为 `false`；
- 不接受 A3；
- autonomous 模式拒绝 `signoff` / `review` / `correctness_case` 输入，避免把人工或半人工字段混入；
- 技术证据过期即 `ok:false`。

## 5. 这意味着什么

AI 可以在没有人类工程师的情况下继续做 **技术验证、影响分析、证据收集、50-PR 预演、CI 对拍**。它不能把“没有人类验收”包装成“交付已验收”。

M1/M2 原定义仍然需要人类；autonomous 模式是并行的技术轨道，不是里程碑替代品。
