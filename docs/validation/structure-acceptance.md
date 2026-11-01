# 仓库目录整理验证

关联 OPS-01 的工程组织与维护。本次只整理文件、脚本与文档入口，不改变功能定义、验收条件或产品状态；完整本地产品保持 4 / 133 项已验收，M8 仍单列。

## 整理结果

- 迁移 93 个文件。根目录的 PRD、roadmap、backlog、规划和架构等文档归入 `docs/`，不保留重复副本。
- 文档按 `product`、`architecture`、`design`、`decisions`、`development`、`validation` 分区；[完整索引](../README.md)集中记录目录职责和维护方式，根 README 聚焦运行与检查。
- 原 planning 中的生成器、模板及嵌入资源迁到 `scripts/planning/`；设计评审资源与截图归入 `docs/design/`；验收证据按主题独立归档。
- 同步调整生成器输入输出、跨文档链接、预算离线测试、spike 验证器引用、clean 复制清单、Oxlint / Oxfmt / Knip 范围及 AGENTS。
- 新增 `pnpm docs:dev`、`docs:build`、`docs:check`；旧 `planning:build` 兼容保留。文档门禁包含规划一致性与本地链接检查，已接入 `pnpm check`。
- 预览监听 127.0.0.1:8765；旧 PRD、看板、设计评审及资产 / 证据地址重定向并保留查询参数和片段；浏览器存储 key 保持不变。
- E2E 截图和 clean 报告默认写入 `.workbench/evidence/latest`，长期证据显式选择独立目录，避免常规重跑覆盖历史验收。

应用 / 公共包原有边界继续保留；未创建空 ledger 或其他未实现业务模块。依赖、构建和测试工具仍使用各自默认产物目录并忽略。

## 验证证据

| 检查 | 结果与证据 |
| --- | --- |
| 迁移完整性 | [迁移前清单](structure-evidence/migration-manifest.json)与[核对报告](structure-evidence/migration-audit.json)：93 个文件到位，2,918 个历史证据 / 预算文件 SHA-256 相同；146 项功能 ID、验收条件、状态及勾选项相同 |
| 规划生成 | 两个生成器成功；看板 revision `c4601ca25f45`，PRD revision `9410088fa3a9`；12 项规划检查通过，内嵌需求与权威 backlog 一致 |
| 日常与完整离线门禁 | `pnpm fix`、`pnpm check` 通过；[完整 CI 日志](structure-evidence/ci.log)包含 12 项单测、SDK 启动 / dispose 冒烟及 6 项浏览器 / Electron E2E，均通过 |
| 干净安装复现 | [命令输出](structure-evidence/clean-commands.json)、[结果](structure-evidence/clean-workspace.json)及[运行日志](structure-evidence/verify-clean.log)：新目录 frozen 安装、检查、构建、测试和 SDK 冒烟退出 0，锁文件哈希相同；SQLite 服务、UI / 源模块均可访问，正常关闭 |
| HTTP 与旧入口 | 核对报告含 44 项 HTTP 检查；全部旧单文件路由 302 到存在的新文件，查询参数保留；入口 / 资源返回 200，HEAD / 方法处理与目录访问边界通过 |
| 实际浏览器 | [Playwright 记录](structure-evidence/docs-browser.log)：导航跳转、旧 feature 片段、PRD 片段、高保真明暗 iframe 正常；页面异常、控制台错误和失败 HTTP 响应均为空；768px 看板无整页横向溢出 |
| 人工查看 | 已查看 [明暗对照](structure-evidence/design-comparison.png)与[768px 看板](structure-evidence/roadmap-768.png)，内容及资源正常加载 |

## 复现边界

clean 首次复制遇到历史 CORE-03 junction 夹具的 EPERM，保留[首次日志](structure-evidence/verify-clean-initial.log)。复制规则已排除 `spikes/` 的符号链接 / junction，原始样本不变，独立重试通过。该复现验证产品工程及文档，不重建或重跑 M0 的链接夹具和模型场景。

历史日志、报告和预算里的旧路径字段保留为原始记录；迁移后的现行入口以文档索引和重定向表为准。新 clean 目录是独立的安装复现目录，位置记录于报告，不作为产品源码目录。

本轮新增真实提供商请求为 0；预算账本字节保持不变。模拟 UI、SDK 无 prompt 启动和本机 HTTP 校验均不作为真实对话、审批或回滚接入的完成证据。
