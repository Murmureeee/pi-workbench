# OPS-01 · Oxlint / Oxfmt 迁移验证

日期：2026-11-01。用户明确选择 Oxlint / Oxfmt，并要求完善排序与代码规范。迁移属于 OPS-01 工程基线维护，不增加产品功能完成数；OPS-08 的完整协议门禁仍独立验收。

## 配置结果

- Oxlint 1.90.0 + oxlint-tsgolint 7.0.2005，开启类型感知，TypeScript 6.0.3 继续独立 typecheck。
- Oxfmt 0.75.0，统一样式、import 声明分组、package.json / scripts、Tailwind 排序；命名 import 成员由 Oxlint 排序。
- 移除原 ESLint 配置和直接依赖，保留 Knip；接入 pnpm fix / check / ci、EditorConfig 与官方 Oxc 扩展建议。
- 规则范围、保存行为、原生规则例外与历史资料排除见 [代码规范](../development/tooling.md)。编辑器配置按官方文档核对；未声称已在用户 VS Code 中实测。

## 实际验证

| 内容 | 结果 | 证据 |
| --- | --- | --- |
| 规则反例 | 临时源码触发未处理 Promise、显式 any、shared 特权导入、条件 Hooks、缺少 alt；检查后删除反例文件 | [规则和排序样本](tooling-evidence/sorting-and-rules.json) |
| 排序 | import 类型 / builtin / external / workspace 分组、命名成员、scripts / dependencies、className / cn / cva / clsx 排序符合预期；副作用顺序保持；Oxfmt 二次输出完全一致 | 同上，保留输入及输出 |
| 完整本地门禁 | `pnpm run ci` 退出 0：格式、类型感知 lint、TypeScript、Knip、12 项单元 / 集成、隔离 SDK bootstrap、构建与 6 项真实浏览器 / Electron E2E | [完整输出](tooling-evidence/checks.log) |
| 干净目录 | frozen 安装、check、build、12 项测试、SDK smoke 全部退出 0；原锁与新目录锁 SHA-256 相同；健康检查、首页与 TSX 模块 200，优雅关闭退出 0 | [结果](tooling-evidence/clean-workspace.json)、[命令输出](tooling-evidence/clean-commands.json)、[外层日志](tooling-evidence/clean.log) |

新 lint 发现的 JSON 信任边界改为 Zod 校验；预算文件必须显式保留 automaticRetry=false，并校验已有请求记录。新增反例覆盖缺失策略与损坏记录，锁定、原子预占、失败 / 中止计数和并发限制仍由原有测试验证。UI select 和 Electron 可空窗口索引改为显式收窄，保留原有交互。

本次新增提供商请求 **0**，SDK 冒烟没有 prompt。M0 两份真实费用记录和当前里程碑预算均保留，当前预算没有新增预占。历史 OPS-01 证据目录不覆盖；本次使用 PIW_EVIDENCE_DIR=docs/validation/tooling-evidence。快照、真实会话和完整安全边界没有提前验收。
