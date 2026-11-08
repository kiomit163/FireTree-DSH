# Prow OWNERS 二进制级对拍

> 日期：2026-11-08。目的：让 CI 编译并运行 Prow 官方 `repoowners` 代码，和 FireTree 的 `src/lib/owners.js` 比较真实解析结果；不是只跑改编的 Node 断言。

## 1. 组成

| 文件 | 作用 |
|---|---|
| [.github/workflows/prow-owners-parity.yml](../.github/workflows/prow-owners-parity.yml) | CI：固定 Prow commit、跑官方测试、跑探针、Node 差分 |
| [tools/prow-owners-probe/official_probe_test.go](../tools/prow-owners-probe/official_probe_test.go) | 放进 Prow `pkg/repoowners` 的 Go 测试，调用官方 `loadOwnersFrom` / `Approvers` |
| [fixtures/owners-prow/](../fixtures/owners-prow/) | 两边共享的 OWNERS/OWNERS_ALIASES 夹具 |
| [scripts/compare-prow-owners.mjs](../scripts/compare-prow-owners.mjs) | 比较官方 JSON 与 FireTree 解析结果 |

固定 Prow commit：`86b2c49084b4bc31ed77ec8643ae3efbe9b82dc4`。

## 2. CI 步骤

1. 从 GitHub 拉取固定 Prow commit；
2. 把 FireTree 探针复制进 `pkg/repoowners`；
3. `go test ./pkg/repoowners -count=1` 运行 Prow 官方测试包；
4. 带环境变量运行 `TestFireTreeOwnersProbe`，输出官方 owner JSON；
5. `node scripts/compare-prow-owners.mjs` 对 8 个文件比较 owner 集合；不一致即失败。

探针在缺少环境变量时会 `t.Skip`，因此官方测试包单独运行时不会因为探针失败。

## 3. 本地验证

已完成两种环境：

- Windows + Go 1.26.5：探针 `PASS`；官方输出与 FireTree 的 8/8 case 对拍通过；
- Ubuntu Docker `golang:1.26.5`（CI 等价）：官方 `go test ./pkg/repoowners -count=1` **PASS**；探针与 FireTree 8/8 对拍通过。

**注意**：本机 Windows 直接跑官方全量测试会失败，原因是 Prow 测试在 Windows 下使用 `src\dir` 路径分隔符，而期望值是 `src/dir`；Linux 容器通过。GitHub Actions workflow 文件已加入，但仓库暂无远端运行记录；不要把本地 Docker 通过写成“GitHub CI 已通过”。

## 4. 对拍覆盖

- 父目录 OWNERS 累积；
- 子目录 OWNERS；
- `filters`（所有匹配，含未命中回退父目录）；
- `no_parent_owners`；
- `OWNERS_ALIASES` 大小写不敏感展开；
- `@` 前缀归一化。

## 5. 未覆盖

- 只比较 `Approvers`，没有比较 reviewers/labels/required_reviewers；
- 没有 MD YAML header；
- 没有 `emeritus_approvers` / advisory approvers；
- 没有 Kubernetes 官方 `verify-owners` 的 collaborator 校验；
- 没有在真实 GitHub runner 上跑过该 workflow。

## 6. 下一步

1. 有远端后触发 workflow，确认 GitHub runner 上官方测试 + 8/8 对拍通过；
2. 扩展探针到 reviewers/labels/no-parent 多目录；
3. 再做 5 个 L2 的人工可接受性判定（见 [L2-ADJUDICATION.md](L2-ADJUDICATION.md)）。
