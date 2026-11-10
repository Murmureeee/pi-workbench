# 验收记录与上下文恢复

本目录保存阶段验收、功能验收和原始证据。当前功能状态的唯一可维护来源是 [backlog](../product/backlog.json)；[生成功能清单](../product/feature-list.md) 和 [看板](../product/roadmap.html) 提供同源阅读入口。本页只维护查阅方法，不另存一份完成状态或测试数量。

## 新会话与上下文恢复

1. 先读根 [AGENTS.md](../../AGENTS.md)、[README](../../README.md) 和 [产品规划](../product/plan.md)，核对当前用户目标与约束。
2. 从 backlog 提取并浏览**全部已验收和进行中的功能**，读取 ID、标题、阶段、依赖及 `progress.status`，建立已交付范围概览。不要只看旧聊天、AGENTS 摘要或某次报告的完成数，也不必全文读取每条历史说明。
3. 定位本次任务和直接依赖，读取其 `acceptance`、`progress.acceptanceChecked`、`progress.note`、`progress.evidence`，按证据路径打开相关验收说明，再查实际实现和测试。已验收能力优先复用；指南未列出某项功能不表示它未实现。
4. `verified` 仍须符合已有验收及依赖规则；`in_progress` 可能已有可复用子集，但不能当作全部完成。发现状态、证据与实现冲突时先定位差异，明确记录回归或待补证据，不直接重做功能或静默改状态。

在仓库根用 PowerShell 提取状态概览：

```powershell
$backlog = Get-Content -LiteralPath docs/product/backlog.json -Raw | ConvertFrom-Json
$backlog.features |
  Where-Object { $_.progress.status -in @('verified', 'in_progress') } |
  Select-Object id, title, milestone, dependsOn, @{ Name = 'status'; Expression = { $_.progress.status } } |
  ConvertTo-Json -Depth 4
```

这个查询始终读取当前数据，后续新增的已验收功能会自动包含在结果中；无需在 AGENTS.md 维护第二份清单。此处要求内部核对，面向用户的回复只需说明与本次任务相关的已有能力。

## 证据入口

| 需要核对的内容 | 入口与用途 |
| --- | --- |
| 功能状态、依赖与验收项 | [backlog](../product/backlog.json) 和 [生成功能清单](../product/feature-list.md)，再按 `progress.evidence` 定位证据 |
| M0 可行性及工程基线 | [M0 验收与边界](m0-acceptance.md)、[OPS-01 验收](ops-01-acceptance.md) |
| 当前实现及协议边界 | [实施方案](../architecture/implementation-plan.md)、[项目结构](../architecture/project-structure.md)、[数据生命周期](../architecture/data-lifecycle.md) |
| 回归来源与阶段门 | [工具规范](../development/tooling.md#ops-08-契约回归门禁)，执行范围仍按 AGENTS 第 7 节选择 |
| 功能实证 | `docs/validation/<topic>-evidence/` 下的验收说明、日志、截图和结果；主题与路径以 backlog 证据字段为准 |
| 原 AGENTS 中的验收摘要 | [迁移归档](agents-history.md)，用于追溯历史限制、失败及证据复用，当前状态仍回查 backlog |
| 用户已确认的选择 | [共同确认记录](../decisions/project-confirmation.md)，历史任务授权按其原范围判断 |

## 后续交付如何留存

- 新交付或修复的验收结果写入对应主题的验收说明，保留历史证据；更新 backlog 中的状态、逐项勾选、说明和证据路径。
- backlog 变更后运行 `pnpm docs:build` 和 `pnpm docs:check`，更新同源清单与看板。单功能验收、阶段门及其限制分别记录。
- AGENTS.md 维护稳定协作规则、运行边界和查阅入口，不再追加功能验收流水、固定完成数或测试条数。已有迁移归档保持历史属性，后续结果写回各主题记录。
- 验收只证明对应时点和范围；后续修改按影响补验，已通过且不受影响的结果按 AGENTS 第 7 节复用，避免把历史流程变成每次提交的固定动作。
