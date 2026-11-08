# 文档索引与维护

CHANGE-08 已验收：审批与历史详情共用可回滚／部分／不可回滚范围，沿用 5 MiB／32 MiB／2048 项／8 层限制；每物理目录 512 MiB Git 对象估算、80% 预警，容量未知／不足暂停且保留所有已发布版本。失效诊断禁用回滚，执行在物理租约内重验原引用，预检后失效整批零写。最终 59 文件／398 项 Vitest、SDK、144 项 E2E 与完整 frozen clean 通过；78 条 Windows 原生观察含中间态，明暗 802×961、容量及引用故障、两次正常菜单退出和同 data/profile 重启零重放通过，5 份 JSONL 哈希不变。429 输入与 clean 一致，最终 CI 仅另有既有 SEC-08 测试等待修正，完整 clean 已覆盖，复用未变产品／窗口阶段。真实提供商 0，pi 配置／canonical 预算／锁未改；OPS-08 仍 in_progress [true,false]。代码块回滚和清理／删除版本未交付。 本地47/133；[最新验收与下一步提示词](validation/change-08-evidence/acceptance.md)。此前[回滚／历史链／处理决定](validation/change-04-05-07-09-evidence/acceptance.md)、[基线](validation/change-01-evidence/acceptance.md)和[来源／Diff](validation/change-02-03-evidence/acceptance.md)证据按交付时点保留。

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

OPS-08 的 M1 契约基线、来源说明、命令与后续阶段矩阵见[工具规范](development/tooling.md#ops-08-契约回归门禁)，本次 [CI 输出](validation/ops-08-evidence/ci.log)与[干净目录结果](validation/ops-08-evidence/clean-workspace.json)独立归档。整体仍为进行中；已交付 M2 与本次 M3 回滚审查见各功能记录，CHANGE-08 范围／保留已补齐，其余双端业务及平台门仍待验收。

CORE-05 的协议、只读观察入口、身份 / 游标 / 重同步及验收边界见[实施方案](architecture/implementation-plan.md#core-05-已交付边界)，[CI 输出](validation/core-05-evidence/ci.log)与[干净目录结果](validation/core-05-evidence/clean-workspace.json)独立归档；内存重放已验收。CORE-06 的 JSONL 分页 / 全文 / 记录导出、持久记录、独立检查点与实际硬杀恢复也已验收；[实现边界](architecture/implementation-plan.md#core-06-已交付边界)、[CI 输出](validation/core-06-evidence/ci.log)和[干净目录结果](validation/core-06-evidence/clean-workspace.json)独立保留。CORE-07 的配额、FIFO / 取消、空闲回收及原生上下文冷恢复也已验收；[边界](architecture/implementation-plan.md#core-07-已交付边界)、[CI](validation/core-07-evidence/ci.log)和[干净目录结果](validation/core-07-evidence/clean-workspace.json)独立保留。下一阶段为 M2。

M2 的 SEC-06 原生凭证边界、统一脱敏、流式分片保护及安全导出已验收，状态页为 `http://127.0.0.1:5173/?credentials`；[实现、来源与限制](architecture/implementation-plan.md#sec-06-已交付边界)、[CI](validation/sec-06-evidence/ci.log)和[干净目录结果](validation/sec-06-evidence/clean-workspace.json)独立归档。真实提供商仍关闭；客户端配对现已由 SEC-08 接入，浏览器凭证修改留待 MODEL-02。

SEC-08 的一次性配对、客户端身份 / 撤销、Host / Origin / CSRF 以及重启授权规则见[实施方案](architecture/implementation-plan.md#sec-08-本机客户端授权边界)。入口为 `http://127.0.0.1:5173/?clients`，完整离线 [CI](validation/sec-08-evidence/ci.log)、[干净目录结果](validation/sec-08-evidence/clean-workspace.json)与三张实际页面截图独立归档；新增真实提供商请求 0。

SEC-07 已验收，配对后从侧栏下方“资源信任”或 `http://127.0.0.1:5173/?trust` 检查来源、逐项确认和撤销。信任按目录 / 来源 / 指纹跨重启保存，仅已确认文本可加载，扩展 / 脚本执行仍禁用；[实现与边界](architecture/implementation-plan.md#sec-07-已交付边界)、[CI](validation/sec-07-evidence/ci.log)、[干净目录结果](validation/sec-07-evidence/clean-workspace.json)和三张实际页面截图独立归档。该次完整 141 项单元 / 集成、28 项浏览器 / Electron E2E 通过，新增真实提供商请求 0。

WS-01 已验收：Electron 从侧栏或 Ctrl+O 打开目录，规范化物理身份复用，切换不停止后台任务；目录 / 权限失败可诊断恢复，不创建空会话或自动信任资源。[实现与来源](architecture/implementation-plan.md#ws-01-已交付边界)、[CI](validation/ws-01-evidence/ci.log)、[干净目录结果](validation/ws-01-evidence/clean-workspace.json)、[真实 Windows 选择器流程](validation/ws-01-evidence/native-validation.json)与三张实际页面截图独立归档。该次完整 146 项单元 / 集成、30 项浏览器 / Electron E2E、SDK 冒烟和干净目录复现通过，新增真实提供商请求 0；未制作安装包，网页独立操作暂缓。

MODEL-01 已验收：Electron 侧栏或原生“工作台”菜单进入模型与提供商页，只读展示 SDK / 显式 pi 配置、能力、来源、默认模型匹配与本地认证状态；全部标注未联网验证，真实传输关闭，不改配置或调用模型。[实现与限制](architecture/implementation-plan.md#model-01-已交付边界)、[CI](validation/model-01-evidence/ci.log)、[clean 结果](validation/model-01-evidence/clean-workspace.json)、[clean 命令](validation/model-01-evidence/clean-commands.json)、[原生 Electron / 配置与数据库审计](validation/model-01-evidence/native-validation.json)、[1080p 明色](validation/model-01-evidence/models-light.png)、[800px 深色](validation/model-01-evidence/models-dark-800.png)和[原生菜单入口](validation/model-01-evidence/native-models.jpg)独立归档。该次完整 **155 项单元 / 集成、33 项浏览器 / Electron E2E**、SDK 冒烟及干净目录复现通过，新增真实提供商请求 0。网页独立功能暂缓，无安装包；SESSION-01 的后续验收见下文，保留原验收与费用限制。

Electron 顶部控制栏与统一设置已参照用户的 Codex 截图调整；[PRD 原型](product/prd.html)与[核心页面规格](design/core-spec.md#electron-控制栏与统一设置--2026-11-02)同步布局。后续完整 **155 项 Vitest / 35 项浏览器与 Electron E2E**、SDK 冒烟和干净目录复现通过，真实调用 0；[验收说明与人工缺口](validation/ui-shell-evidence/acceptance.md)、[CI](validation/ui-shell-evidence/ci.log)、[原生窗口记录](validation/ui-shell-evidence/native-validation.json)独立保留。UX-03 / UX-05 仍为部分实现，已验收数不因原型更新增加。

SESSION-01 已验收：Electron 实际 daemon / SQLite / SDK 本地夹具首发、幂等、明确模型 / cwd、草稿、失败恢复及真实 Windows 微软拼音均通过；原生首发 / 同会话续发、设置返回、实际目录选择与明暗窄窗已补证。修复同项目草稿重入丢失目录后完整 **164 项 Vitest / 40 项 E2E** 及 SDK 冒烟重新通过；修复前 frozen clean 仅复用未变基础设施，真实请求 0。[逐项说明](validation/session-01-evidence/acceptance.md)、[最终 CI](validation/session-01-evidence/ci-native-followup.log)、[原 clean](validation/session-01-evidence/clean-workspace.json)、[原生记录](validation/session-01-evidence/native-validation.json)和[最终审计](validation/session-01-evidence/native-final-audit.json)独立归档。OPS-08 继续进行中；SESSION-02 后续交付见下文。

SESSION-02 已验收：Electron 最多 3 个视图、独立草稿 / 阅读锚点与偏移 / 工具展开 / 面板恢复、后台同 PID / 淘汰 / 重连 / 刷新不重发、迟到隔离，以及显式 pi 旧历史只读发现 / 版本分页 / 同写与损坏诊断。最终完整 **170 项 Vitest / 44 项 E2E** 与 SDK 冒烟通过，本次 frozen clean 通过，收尾标题布局与草稿回执隔离修改复用未变基础设施。实际 Windows 草稿 / 阅读恢复 / 设置主题 / 后台 PID / 旧历史分页有独立证据；宿主脚本退出后读已关闭 SQLite 而退出 1 的限制如实记录，正常启停另有 CI / clean 证明。真实请求 0，配置 / 预算未改，无安装包；[逐项说明](validation/session-02-evidence/acceptance.md)、[最终 CI](validation/session-02-evidence/ci-final.log)、[clean](validation/session-02-evidence/clean-workspace.json)、[原生记录](validation/session-02-evidence/native-validation.json)及[审计](validation/session-02-evidence/native-final-audit.json)。OPS-08 继续进行中；SESSION-03 后续交付见下文。

SESSION-03 已验收：Electron 置顶 / 未读 / 归档由 daemon SQLite 持久保存，恢复不启动内核或旧授权；新完成 / 失败 / 中断结果标未读，仅活动窗口实际展示并读到最新才清除，支持手动标记。后台真实状态独立于视图，运行中归档先明确停止，等待服务确认后再次单独确认；取消归档保持同 SDK PID 继续运行。新增 7 项服务 / 5 项 Electron 流程，完整 179 项 Vitest / 49 项浏览器与 Electron E2E、SDK 冒烟通过；本次 frozen clean 通过，最后提示文案仅复用未变基础设施，完整 CI 已补跑。原生 Windows 重启持久 / 恢复 / 中段未读 / 后台停止归档及两次正常退出通过；真实请求 0，配置 / 预算未改，无安装包。[逐项验收](validation/session-03-evidence/acceptance.md)、[最终 CI](validation/session-03-evidence/ci-native-followup.log)、[clean](validation/session-03-evidence/clean-workspace.json)、[原生步骤](validation/session-03-evidence/native-validation.json)与[正常退出审计](validation/session-03-evidence/native-final-closed.json)独立保留。最新进度以 backlog 和本文后续验收记录为准，OPS-08 继续进行。

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

SESSION-11 已验收 Electron 重命名 / Unicode 校验 / CAS 冲突 / 多端标题同步 / 人工保护，完整 **185 项 Vitest / 53 项 E2E**、SDK 冒烟和 frozen clean 通过。真实微软拼音 Enter / Escape / 选词、原生失败恢复 / 标题同步和重启持久化已补证，三项均勾选；230 个产品 / 测试 / 根配置文件与 clean 一致，本轮复用已通过门禁。该次完成数为 **17 / 133**，OPS-08 继续进行，WS-02 后续验收见下文。见[逐项结果与下一步提示词](validation/session-11-evidence/acceptance.md)、[最终 CI](validation/session-11-evidence/ci-complete.log)、[clean](validation/session-11-evidence/clean-workspace.json)及[原生结果](validation/session-11-evidence/native-validation.json)。

WS-02 两项验收已通过：Electron 最近列表 / 自定义名 / 明示排序持久、失效诊断、仅隐藏移除及同物理目录明确重新定位，不改既有会话 cwd 或停止后台任务。完整 **192 项 Vitest / 57 项 E2E**、SDK 冒烟、本次 frozen clean 与 25 步真实 Windows IME / 原生选择器 / 失败恢复 / 后台同 PID / 重启及两次正常菜单退出通过；产品代码之后未改，文档与 PRD 同源重建并执行完整 check。该次 **18 / 133**；后续 WS-06 验收见下文，OPS-08 继续进行。真实请求 0、配置 / 预算不变、无安装包；[逐项验收与下一步提示词](validation/ws-02-evidence/acceptance.md)、[CI](validation/ws-02-evidence/ci.log)、[clean](validation/ws-02-evidence/clean-workspace.json)、[原生汇总](validation/ws-02-evidence/native-validation.json)和[重启关闭审计](validation/ws-02-evidence/native-final-closed.json)。

## WS-06 项目组织验收

WS-06 四项已验收：项目创建 / 改名 / 置顶 / 组内顺序跨重启持久，侧栏展开与名称 / 路径检索、同名区分、项目新建预选 / 全局无项目、单默认目录与独立空间均通过。默认仅影响未来会话；明确移除解散归无项目，原子回滚失败，保留文件 / 会话 / cwd / 模型 / 历史 / 权限及已运行任务。完整 **201 项 Vitest / 63 项 E2E**、SDK 冒烟与本次 frozen clean 通过；40 步原生 Windows IME / 真实选择器 / 失败恢复 / 同 PID 后台 / 重启及两次正常退出已补证。249 个产品 / 测试 / 配置文件与 clean 一致，后续仅回填文档与进度并重建 PRD。该次 **19 / 133**，OPS-08 继续进行；SESSION-12 本次进展见下文。

真实提供商请求 0、pi 配置 / canonical 预算不变、无安装包，网页版独立功能暂缓。[逐项验收与下一步提示词](validation/ws-06-evidence/acceptance.md)、[CI](validation/ws-06-evidence/ci.log)、[clean](validation/ws-06-evidence/clean-workspace.json)、[原生汇总](validation/ws-06-evidence/native-validation.json)、[重启关闭审计](validation/ws-06-evidence/native-final-closed.json)及[代码复用审计](validation/ws-06-evidence/native-code-reuse-audit.json)。

## SESSION-12 基础搜索验收

Electron 中文标题 / 用户 / 助手正文搜索、全部 / 指定 / 无项目、状态 / 本地日期 / 归档、脱敏分页与消息定位、200ms 防抖 / 迟到隔离 / 键盘和索引更新已实现。完整 **209 项 Vitest / 67 项浏览器及实际 Electron E2E**、SDK 冒烟和 frozen clean 通过；270 个产品 / 测试 / 脚本 / 配置文件与 clean 字节一致。用户恢复控制后，真实微软拼音 Enter / Escape / 数字及 Space 选词、原生筛选 / 旧消息定位 / 失败显式恢复 / 同 PID 后台状态 / 明暗窄窗 / 正常退出及同数据重启均已补证；SESSION-12 三项标 verified，完成数为 **20 / 133**，OPS-08 继续进行中。真实提供商请求 0，配置 / 预算未改，无安装包，网页独立功能暂缓。[实现、逐项验收及下一步提示词](validation/session-12-evidence/acceptance.md)。

## WS-03 工作区与 Git 环境

真实 cwd／仓库／HEAD 的 Electron 观察实现与离线自动验证见 [WS-03 验收记录](validation/ws-03-evidence/acceptance.md)。28 步 Windows 原生操作、同 PID／cwd、明暗窄窗与重启退出已补齐；277 文件与 clean 一致，复用 217／72、SDK 和 clean，WS-03 两项均验收。

INPUT-01 输入与独立草稿已验收，新增2项实际Electron回归和27条Windows原生观察，来源与快捷键刷新限制见[逐项记录](validation/input-01-evidence/acceptance.md)。

## SESSION-07 独立执行空间验收

无项目首发／续发、真实独立目录、不可变来源、能力来源与仅整理归属已验收；失败／冲突／迟到、后台同PID／cwd、产物和历史持久均有自动及原生证据。完整223项Vitest／78项E2E、SDK与frozen clean通过，包含INPUT-01新增测试；29条Windows观察、重启0内核／0重发及两次正常退出补证，282文件与clean一致。当前本地23 / 133，SESSION-13完整迁移及OPS-08跨阶段门继续保留。真实提供商0；[逐项记录与下一步提示词](validation/session-07-evidence/acceptance.md)、[原生汇总](validation/session-07-evidence/native-validation.json)。

## WS-07 验收记录

[工作区信任与不可用恢复](validation/ws-07-evidence/acceptance.md)记录目录物理身份／后台停止／明确恢复、实际服务和 Electron 自动结果、68条原生观察、重启／正常退出与继续提示词；两项验收已通过。

WS-04 的目录互斥、外部改动观察与两项验收见[记录](validation/ws-04-evidence/acceptance.md)。复用 332 项 Vitest／SDK／frozen clean，授权后最终完整 122 项 E2E、82 条 Windows 原生观察、同 data/profile 重启与两次正常退出补齐；来源、失败修复及 clean helper 补充检查分别记录。WS-04 本身仅提供元数据观察；持久文件版本随后由 CHANGE-01 交付，OPS-08 继续跨阶段判断。

## OBS-01 已验收

Electron流式与安全内容展示已验收：每帧累计全部delta，非delta状态即时冲刷，权威终态替换去重；CommonMark/GFM安全Markdown、仅显式HTTP(S)链接、禁止自动图片和原始HTML执行、本地协议惰性。16k预览可展开，64k以上纯文本、12k以上代码不高亮，未知语言／未闭合围栏／可选模块失败回退；按需Shiki与异步身份保护。8项新增Vitest、4项新增Electron流程；完整238项Vitest／86项E2E、SDK和frozen clean通过。Windows原生富文本／纯文本切换、长内容展开／收起、明暗主题、同data/profile重启0请求及两次正常退出补证。图示仅惰性代码，未接入执行型图示。真实提供商0、pi配置／canonical预算未改，无安装包，网页独立功能暂缓；OPS-08继续in_progress。[逐项证据与下一步提示词](validation/obs-01-evidence/acceptance.md)。

## OBS-04 已验收

OBS-04 已验收：Electron 回看不强拉、按消息计数、显式／键盘返回最新、消息锚点与偏移跨分页／3 视图淘汰／renderer 刷新恢复；长文展开保持现场、收起不留空白，后台完成或合成审批观察不抢当前焦点与面板。新增 2 项 Vitest／4 项实际 Electron 回归，完整 31 文件／240 项 Vitest、90 项 E2E、SDK 和 frozen clean 通过；60 条 Windows 原生观察、明暗窄窗、后台同 PID／epoch、同 data/profile 重启 0 内核／0 新请求及两次正常菜单退出补证。304 文件与 clean 一致，原生后复用门禁；当前本地 26 / 133，OPS-08 继续 in_progress。分页行／审批观察均明确为合成样本，完整应用重启不承诺窗口书签；真实提供商 0，配置／canonical 预算／锁未改，无安装包，网页独立功能暂缓。[逐项证据与下一步提示词](validation/obs-04-evidence/acceptance.md)。

## OBS-03 工具时间线

OBS-03 已验收 Electron 工具时间线：调用身份／最终参数与父子关联、拒绝／失败／取消／结果未知、乱序终态保护、脱敏长文明确展开和可验证摘要；未知指标显示未知，Diff 仅观察。原生 Windows 工具卡／长输出／逐轮隔离、后台同 PID／epoch 与焦点、明暗窄窗、同 data/profile 重启不重发和正常退出均已补证，两项勾选。真实提供商 0，工具／扩展继续禁用，不改 pi 配置／canonical 预算，无安装包，网页独立功能暂缓；OPS-08 继续 in_progress。[实现、验证来源与继续提示词](validation/obs-03-evidence/acceptance.md)。

OBS-03 已验收：完整 35 文件／251 项 Vitest、93 项浏览器及 Electron E2E、SDK 冒烟与 frozen clean 通过；Windows 原生工具身份／摘要／长输出脱敏与收起、跨会话及逐轮展开隔离、后台同 PID／epoch 和焦点、明暗 802px 窄窗、同 data/profile 只读重启 0 内核／0 新发送／0 注入、历史哈希不变及正常菜单退出已补证。316 文件与 CI／clean 一致，原生后复用门禁；仅文档模板另更新。两项勾选，当前本地 27 / 133，OPS-08 继续 in_progress。合成工具观察与真实 SDK 禁用工具错误分开，未开启生产工具／审批／MCP／回滚；真实提供商 0，配置／预算／锁未改。

GIT-01 已验收：真实只读 Git 状态、轮前／工具来源及混合诊断，完整 407 项 Vitest／147 项 E2E、SDK、frozen clean 与阶段补充通过；71 条 Windows 原生观察、同 profile 重启零重放和两次正常退出补证。限制与失败见[验收记录](validation/git-01-evidence/acceptance.md)。
