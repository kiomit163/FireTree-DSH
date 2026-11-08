# CI 证据检查

> 日期：2026-11-08。性质：**证据检查命令**，不是交付回执，不是 M1/M2。

## 1. 命令

```powershell
node bin/firetree-check.mjs --change <change-id> --mode governed --root <repo>
node bin/firetree-check.mjs --change <change-id> --mode autonomous --root <repo>
```

退出码：

| 退出码 | 含义 |
|---:|---|
| 0 | 检查通过 |
| 1 | 存在缺失/过期/哈希不符/语义不满足的 gap |
| 2 | 参数或运行错误 |

stdout 是 JSON：

```json
{
  "ok": false,
  "mode": "autonomous",
  "change": "pr-143751",
  "gaps": ["..."],
  "render": "..."
}
```

## 2. 两种模式

| 模式 | 检查对象 | 是否需要人类签字 |
|---|---|---|
| `governed` | `.firetree/receipts/<change>.json` + review/synthesis | 是；L2 必须 human signoff |
| `autonomous` | `.firetree/evidence/<change>.json` | 否；A1/A2，`human_signoff=false` |

autonomous 通过**不代表**交付完成，只代表技术证据可复核。

## 3. CI 用法

CI 必须先获得 `.firetree` 工件，再运行检查。例如：

```yaml
- name: FireTree evidence check
  run: node bin/firetree-check.mjs --change "$FIRE_TREE_CHANGE" --mode autonomous
```

工件可以来自：

- 受控 artifact 下载；
- 本地生成后上传；
- 同一 job 中先生成 evidence。

仓库本身不提交 `.firetree/evidence` 或 `.firetree/receipts`，避免把运行态当源码。

## 4. 已验证

本地 live：

```powershell
node bin/firetree-check.mjs --change pr-143751 --mode autonomous --root D:\FireTree-DSH\.tmp\k8s-pilot\repo
# exit 0

node bin/firetree-check.mjs --change pr-16308 --mode autonomous --root D:\FireTree-DSH\.tmp\otel-pilot\opentelemetry-collector-main
# exit 0
```

缺工件时 exit 1；非法 mode 时 exit 2。

## 5. 限制

- `governed` 不会自动生成 review/synthesis，也不会补人类签字；
- `autonomous` 不能升级为回执，不能声称完成；
- CI 检查只验证既有证据，不替代测试、编译器或静态分析；
- 证据文件必须由外部工具/CI 产生，agent 自产证据仍会被拒。
