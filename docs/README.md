# 文档索引与维护

根 [README](../README.md) 负责运行和检查；本目录集中维护需求、方案、设计与验证。产品功能及进度的唯一数据源是 [product/backlog.json](product/backlog.json)，文档、原型和依赖安装不计为产品完成。

## 文档分区

| 目录            | 主要入口                                                                                                                                                                                                       | 维护方式                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `product/`      | [规划](product/plan.md)、[backlog](product/backlog.json)、[会话设计](product/session-design.md)、[看板](product/roadmap.html)、[PRD](product/prd.html)、[功能清单](product/feature-list.md)                    | 编辑需求源与规格；后面三项通过脚本生成               |
| `architecture/` | [实施方案](architecture/implementation-plan.md)、[项目结构](architecture/project-structure.md)、[数据生命周期](architecture/data-lifecycle.md)、[架构草案](architecture/overview.html)                         | 维护工程边界与阶段设计；产品决定以 backlog 为准      |
| `design/`       | [高保真评审](design/review.html)、[UI brief](design/brief.md)、[核心规格](design/core-spec.md)、[PRD 设计依据](design/prd-design.md)、[参考](design/prd-references.md)、[设计验证记录](design/verification.md) | 设计稿源码与 `assets/` 同目录；截图放 `screenshots/` |
| `decisions/`    | [共同确认](decisions/project-confirmation.md)、[PI-Desktop 评估](decisions/pi-desktop-review.md)、[spec 审计](decisions/pi-desktop-spec-audit.json)                                                            | 记录用户选择和方案依据，保留待验证边界               |
| `development/`  | [工具规范与排障](development/tooling.md)、[组件来源](development/ui-components.md)                                                                                                                             | 当前开发约定；同步维护根 AGENTS 的引用               |
| `validation/`   | [OPS-01](validation/ops-01-acceptance.md)、[工具验收](validation/tooling-acceptance.md)、[真实验收政策](validation/live-validation-policy.md)、[预算账本](validation/live-validation-budget.json)              | 验收说明与各次独立证据目录配套，历史输出不改写       |

[M0 阶段门及边界](validation/m0-acceptance.md)、原始验收报告与预算在本目录归档；14 份固定契约录制归入 `packages/agent-adapter/test/contracts/recordings/`。本机 `spikes/` 及其完整历史工作区、SDK 会话和 Git 对象库整个目录不提交；常规 CI、文档预览与 clean 不依赖它。精简归档不代表完整现场可在克隆后直接重放。

CORE-04 的实现边界与验收说明合并在[实施方案](architecture/implementation-plan.md)，原始 [CI 输出](validation/core-04-evidence/ci.log)与[干净目录结果](validation/core-04-evidence/clean-workspace.json)独立保留；页面仍为离线样本，真实提供商未开放。

OPS-08 的 M1 契约基线、来源说明、命令与后续阶段矩阵见[工具规范](development/tooling.md#ops-08-契约回归门禁)，本次 [CI 输出](validation/ops-08-evidence/ci.log)与[干净目录结果](validation/ops-08-evidence/clean-workspace.json)独立归档。整体仍为进行中，真实 M2 交互与后续回滚验收未完成。

CORE-05 的协议、只读观察入口、身份 / 游标 / 重同步及验收边界见[实施方案](architecture/implementation-plan.md#core-05-已交付边界)，[CI 输出](validation/core-05-evidence/ci.log)与[干净目录结果](validation/core-05-evidence/clean-workspace.json)独立归档；内存重放已验收。CORE-06 的 JSONL 分页 / 全文 / 记录导出、持久记录、独立检查点与实际硬杀恢复也已验收；[实现边界](architecture/implementation-plan.md#core-06-已交付边界)、[CI 输出](validation/core-06-evidence/ci.log)和[干净目录结果](validation/core-06-evidence/clean-workspace.json)独立保留。CORE-07 的配额、FIFO / 取消、空闲回收及原生上下文冷恢复也已验收；[边界](architecture/implementation-plan.md#core-07-已交付边界)、[CI](validation/core-07-evidence/ci.log)和[干净目录结果](validation/core-07-evidence/clean-workspace.json)独立保留。下一阶段为 M2。

M2 的 SEC-06 原生凭证边界、统一脱敏、流式分片保护及安全导出已验收，状态页为 `http://127.0.0.1:5173/?credentials`；[实现、来源与限制](architecture/implementation-plan.md#sec-06-已交付边界)、[CI](validation/sec-06-evidence/ci.log)和[干净目录结果](validation/sec-06-evidence/clean-workspace.json)独立归档。真实提供商仍关闭；客户端配对现已由 SEC-08 接入，浏览器凭证修改留待 MODEL-02。

SEC-08 的一次性配对、客户端身份 / 撤销、Host / Origin / CSRF 以及重启授权规则见[实施方案](architecture/implementation-plan.md#sec-08-本机客户端授权边界)。入口为 `http://127.0.0.1:5173/?clients`，完整离线 [CI](validation/sec-08-evidence/ci.log)、[干净目录结果](validation/sec-08-evidence/clean-workspace.json)与三张实际页面截图独立归档；新增真实提供商请求 0。

SEC-07 已验收，配对后从侧栏下方“资源信任”或 `http://127.0.0.1:5173/?trust` 检查来源、逐项确认和撤销。信任按目录 / 来源 / 指纹跨重启保存，仅已确认文本可加载，扩展 / 脚本执行仍禁用；[实现与边界](architecture/implementation-plan.md#sec-07-已交付边界)、[CI](validation/sec-07-evidence/ci.log)、[干净目录结果](validation/sec-07-evidence/clean-workspace.json)和三张实际页面截图独立归档。该次完整 141 项单元 / 集成、28 项浏览器 / Electron E2E 通过，新增真实提供商请求 0。

WS-01 已验收：Electron 从侧栏或 Ctrl+O 打开目录，规范化物理身份复用，切换不停止后台任务；目录 / 权限失败可诊断恢复，不创建空会话或自动信任资源。[实现与来源](architecture/implementation-plan.md#ws-01-已交付边界)、[CI](validation/ws-01-evidence/ci.log)、[干净目录结果](validation/ws-01-evidence/clean-workspace.json)、[真实 Windows 选择器流程](validation/ws-01-evidence/native-validation.json)与三张实际页面截图独立归档。当前完整 146 项单元 / 集成、30 项浏览器 / Electron E2E、SDK 冒烟和干净目录复现通过，新增真实提供商请求 0。本轮未制作安装包，网页独立操作暂缓；下一项建议 MODEL-01 模型发现，再衔接 SESSION-01。

本次目录整理的迁移清单、完整性核对与离线验证见 [整理验收记录](validation/structure-acceptance.md)。

## 本机预览

```powershell
pnpm docs:dev
```

打开 `http://127.0.0.1:8765/`，从导航进入 `/product/roadmap.html`、`/product/prd.html` 与 `/design/review.html`。服务仅监听回环地址，仅提供 `docs/` 中的文档 / 归档；不暴露应用源码、本机 spikes、node_modules 或配置目录。端口可通过 `PIW_DOCS_PORT` 修改；产品开发入口仍是 5173。

旧的根目录 `pi-workbench-*.html`、历史设计资产和证据地址由预览服务重定向，保留查询参数和片段。文件系统路径已迁移，外部脚本应使用新路径。浏览器存储 key 不变；使用相同来源（127.0.0.1:8765）可继续读取原先的进度副本及设计偏好。

## 生成与回填

```powershell
pnpm docs:build
pnpm docs:check
```

生成器、模板和嵌入页面的资源都位于 `scripts/planning/`：

| 输入                                                                                                                           | 输出                                                        |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `docs/product/backlog.json` + `scripts/planning/templates/roadmap.html` + `assets/roadmap-app.js`                              | `docs/product/roadmap.html`、`docs/product/feature-list.md` |
| 同一 backlog + `templates/prd.html`、`templates/prd-document.html`、`prd-flows.mjs`、`assets/prd-ui.css` / `assets/prd-app.js` | `docs/product/prd.html`                                     |

上表中的模板、assets 与 flows 路径均相对 `scripts/planning/`。不要手改生成文件。看板副本导出后可回填：

```powershell
node scripts/planning/build-roadmap.mjs --import "导出的 JSON 文件路径"
pnpm docs:build
pnpm docs:check
```

原有 `pnpm planning:build` 保留为生成加校验的兼容命令。`pnpm check` / `pnpm run ci` 已包含文档门禁；在修改 backlog 或模板后先生成，再检查。链接校验排除历史证据中的原始命令路径，不为迁移重写历史记录。

## 新文件放置规则

- 产品代码放对应 app / package；跨包共享内容必须有真实复用边界。
- 需求与进度改 `product/`，架构改 `architecture/`，界面与截图改 `design/`，选型与用户决定改 `decisions/`。
- 文档脚本放 `scripts/docs/`，规划生成逻辑放 `scripts/planning/`；不把说明文档和可执行脚本混在一起。
- 开发验证默认写入 `.workbench/evidence/latest`。需要长期保留时选择新的 `docs/validation/<topic>-evidence/` 并配验收说明，避免覆盖之前的证据。
- 缓存、日志、临时服务数据放 `.workbench/`；依赖和构建产物保留工具默认位置并忽略，不搬进 docs。
- 不因目录整理创建空业务包、不改变功能 ID 或验收状态。组件与后端权责继续遵循 [UI 组件规则](development/ui-components.md)及[项目结构](architecture/project-structure.md)。
