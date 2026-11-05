# Pi Workbench 全量功能清单

基线：2026-11-03 · 146 项功能 · 19 个模块 · M0–M8

完整本地产品 M0–M7：27/133 已验收；M8 候选扩展 13 项单列。已有详细设计 56 项；文档不计作产品实现。

> 本文件由 `node scripts/planning/build-roadmap.mjs` 生成。请维护 backlog JSON，不要手工改本表。

[交互看板](roadmap.html) · [产品规划](plan.md) · [数据源](backlog.json)

## 交付阶段

| 阶段 | 结果 | 功能数 | 已验收 |
| --- | --- | ---: | ---: |
| M0 可行性验证 | 验证真实 pi 接入、审批覆盖和文件快照，消除核心技术不确定性。 | 3 | 3 |
| M1 运行与数据底座 | 可恢复的本地服务、会话运行内核、事件契约和持久化。 | 6 | 5 |
| M2 双端对话与审批 | 桌面与本机浏览器可直接输入创建项目或无项目会话，自动命名、搜索并观察和控制真实任务。 | 32 | 19 |
| M3 变更审查闭环 | 形成可日常试用的观察、审批、审查与文件回滚闭环。 | 9 | 0 |
| M4 日常开发能力 | 补齐上下文、终端、命令任务、配置和文件阅读。 | 29 | 0 |
| M5 稳定桌面版 | 建立可分发、可恢复、有权限边界的 Windows 稳定版。 | 10 | 0 |
| M6 完整编码工作台 | 补齐独立 Worktree、Git、PR、审查和扩展管理。 | 31 | 0 |
| M7 并行与自动化 | 增加子 Agent、任务计划、预算和无人值守运行的管理能力。 | 13 | 0 |
| M8 可选扩展 | 评估远程主机、云端、团队、浏览器与多模态；逐条决定是否立项。 | 13 | 0 |

## CORE 运行内核

把 pi 运行时接入可恢复的工作台服务

| ID | 功能 | 阶段 | 优先级 | 设计 | 实现 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| [CORE-01](roadmap.html#feature=CORE-01) | 验证 SDK 核心生命周期 | M0 | P0 | 已有详细设计，待校正 | 已验收 | — |
| [CORE-02](roadmap.html#feature=CORE-02) | 验证执行前拦截覆盖 | M0 | P0 | 已有详细设计，待校正 | 已验收 | CORE-01 |
| [CORE-03](roadmap.html#feature=CORE-03) | 验证变更快照与修改归属 | M0 | P0 | 已有详细设计，待校正 | 已验收 | CORE-01 |
| [CORE-04](roadmap.html#feature=CORE-04) | 会话内核与守护进程 | M1 | P0 | 已有详细设计，待校正 | 已验收 | CORE-01, CORE-02, OPS-01 |
| [CORE-05](roadmap.html#feature=CORE-05) | 事件契约、快照与断线重放 | M1 | P0 | 已有详细设计，待校正 | 已验收 | CORE-04 |
| [CORE-06](roadmap.html#feature=CORE-06) | 会话持久化与故障恢复 | M1 | P0 | 已有详细设计，待校正 | 已验收 | CORE-04 |
| [CORE-07](roadmap.html#feature=CORE-07) | 进程池与资源排队 | M1 | P0 | 已有详细设计，待校正 | 已验收 | CORE-04, CORE-06 |
| [CORE-08](roadmap.html#feature=CORE-08) | 运行时兼容与升级诊断 | M5 | P1 | 已有详细设计，待校正 | 未开始 | CORE-02, CORE-05, OPS-08 |

### CORE-01 验证 SDK 核心生命周期

用真实 pi 1.4.0 验证会话创建、流式订阅、排队、中止及稳定结束。

实现来源：pi 已有接口，待集成验证。负责人：murmure；目标日期：未估算。

- [x] 使用真实 pi SDK 录制正常对话、错误、压缩、重试、排队和中止的完整事件样本，并对应到可见状态；正常流式和中止须补充现有提供商的真实调用证据，本地模拟来源须明确标注。
- [x] Agent 轮次以 agent_settled 判定没有自动延续；独立手动压缩以操作 Promise、compaction_end 和 SDK 空闲判定结束。实际调用示例和运行结果可复现，空闲与成功分别记录。

进展 / 阻塞：2026-11-01：真实 SDK 的 9 类本地 HTTP 场景、9 项边界测试通过；沿用 dli / deepseek-v4.1-flash，真实短回复、手动压缩和补充中止通过。中止样本记录首个正文增量后 abort，消息 aborted，最终 agent_settled(aborted=true)，SDK 空闲、队列为空。完整事件可回放到可见状态；本地故障服务来源已标注。首轮 3 次加补充 1 次，累计 4 次真实 HTTP 请求，原预算与失败记录保留、原配置未改；费用未知。CORE-01 两条验收通过，后续验证进展见 CORE-02 / CORE-03，M0 阶段门仍需单独通过。

验证证据：docs/validation/m0-acceptance.md#core-01；docs/validation/m0-evidence/core-01-acceptance.json。M0 历史验收报告按原始字节归档；14 份固定契约录制见 packages/agent-adapter/test/contracts/recordings.json 及 recordings/，保留原 SHA-256 和来源。原 spikes/ 验证源码、完整事件 / 文件系统 / Git 现场仅在本机保留，不随版本库分发；本次仅归档迁移，不重新验收或新增模型请求。

### CORE-02 验证执行前拦截覆盖

确认内建、扩展、MCP、嵌套工具及参数改写均受最终审批约束。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [x] 拒绝每一类代表性调用后，文件、命令或外部请求的副作用确实未发生。
- [x] 拦截钩子缺失、异常、断线及参数在后续钩子被改写时均不能绕过最终裁决。

进展 / 阻塞：2026-11-01：真实 pi SDK 1.4.0 的 28 个本地场景全部通过。内建 write / PowerShell、扩展文件 / HTTP、真实 stdio MCP 和两层嵌套调用均用允许 / 拒绝及实际副作用验证；观察钩子缺失 / 移除 / 异常、真实 IPC 错误 / 断线 / 超时、失配 / 过期裁决和等待中撤销均失败关闭。原始对照复现普通前置审批可被后续参数改写影响；宿主执行入口守卫改为最终快照裁决并执行同一快照，动态 MCP 注册也受包装。架构时序和 PRD 已回填。没有新增付费模型调用，原 pi 配置未改。生产审批服务与 OS 沙箱不计入本条完成；CORE-03 后续验证已完成，M0 综合阶段门与限制见 spikes/m0-acceptance.md；后续生产功能仍按各自阶段验收。

验证证据：docs/validation/m0-acceptance.md#core-02；docs/validation/m0-evidence/core-02-acceptance.json。M0 历史验收报告按原始字节归档；14 份固定契约录制见 packages/agent-adapter/test/contracts/recordings.json 及 recordings/，保留原 SHA-256 和来源。原 spikes/ 验证源码、完整事件 / 文件系统 / Git 现场仅在本机保留，不随版本库分发；本次仅归档迁移，不重新验收或新增模型请求。

### CORE-03 验证变更快照与修改归属

在隔离测试目录验证基线、快照、冲突和外部编辑的处理能力。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [x] 预先存在的未提交改动在文件和整轮回滚后保持完整。
- [x] 并发修改、超大文件、忽略文件、符号链接与快照失败的结果有验证记录和产品限制。

进展 / 阻塞：2026-11-01：34 个隔离实际文件 / Git / SDK 工具场景及独立证据核验通过。单文件与整轮恢复保留 staged / unstaged / 原有未跟踪内容，用户 Git HEAD / index / config 及全部元数据指纹一致；连续工具链记 agent-observed，外部编辑记 mixed / unknown 并限制自动回滚。真实子进程与 junction 别名争锁、>5 MiB / 忽略 / 嵌套仓库排除、路径 / hardlink / junction、真实 index.lock 和对象缺失 / 损坏、注入的快照与 IO 失败均有记录。预检冲突整批不写，运行期失败条件补偿；补偿遇外部编辑保留现场并标 needs-recovery。本机文件 symlink 创建 EPERM，未算执行验证，产品保守排除。未读取用户认证、未新增模型请求。架构和 PRD 已回填；M0 三个阶段门另由 spikes/verify-m0.mjs 综合核对。生产 CHANGE / WS / SEC、OS 竞态隔离、崩溃恢复与其他平台仍未验收。

验证证据：docs/validation/m0-acceptance.md#core-03；docs/validation/m0-evidence/core-03-acceptance.json。M0 历史验收报告按原始字节归档；14 份固定契约录制见 packages/agent-adapter/test/contracts/recordings.json 及 recordings/，保留原 SHA-256 和来源。原 spikes/ 验证源码、完整事件 / 文件系统 / Git 现场仅在本机保留，不随版本库分发；本次仅归档迁移，不重新验收或新增模型请求。

### CORE-04 会话内核与守护进程

将每个活跃 pi 会话置于可管理的运行时中，由本地服务统一控制。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [x] 每个活跃会话一个 SDK 子进程；启动、就绪、运行、停止和销毁均绑定会话 / 轮次 / 运行时代际，执行守卫握手失败不得执行未验证工具。
- [x] 一个内核异常不破坏其他会话；cwd、原生 sessionFile 与运行时关联可核对；窗口与浏览器共用 daemon，不创建两套执行状态。

进展 / 阻塞：daemon 统一管理每会话一个真实 pi 1.4.0 SDK 子进程，单代际 / 单轮次、ready 守卫握手、流式 / 中止 / 销毁、异常隔离与宿主退出清理通过。当前固定 deny-all，工具 / 扩展禁用、真实提供商关闭；真实 SDK + 本地 HTTP 夹具与合成 IPC 故障明确区分。页面仍为离线样本，客户端重放、持久恢复和资源池按 CORE-05–07 单独验收。

验证证据：docs/architecture/implementation-plan.md 的 CORE-04 已交付边界；packages/agent-adapter/src/kernel.ts、kernel-protocol.ts、sdk-child.ts、sdk-runtime.ts、kernel.test.ts；apps/daemon/src/modules/kernels、apps/daemon/test/kernels.test.ts。24 项新增测试，完整 36 项 Vitest / 6 项浏览器与 Electron E2E / SDK 流式与中止冒烟通过；pnpm fix、pnpm run ci、pnpm verify:clean 退出 0，Node 24.22.2，锁文件 SHA-256 一致。原始证据 docs/validation/core-04-evidence/ci.log、clean-workspace.json、clean-commands.json；真实提供商请求 0，预算账本未改。

### CORE-05 事件契约、快照与断线重放

为客户端提供带稳定 ID 和序号的状态快照与增量事件。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [x] 两个客户端重连后消息和工具只出现一次且最终一致；旧轮次终态不影响新轮次，原始 text_delta 全部累计、审批与终态立即冲刷。
- [x] 事件缺口或缓冲不足必须重新同步；连接时核对协议版本与实际能力，不兼容先阻止变更请求并明确提示匹配版本 / 重启后再同步。快照和增量以稳定 ID / seq / epoch 对齐，不拼接不完整历史或写回截断展示。

进展 / 阻塞：daemon 单一 EventService 发布 REST 完整内存快照与 WS 有界重放 / 实时增量；daemonId、sessionId、epoch、turnId、messageId、toolCallId 与连续 seq 对齐。真实 SDK + 本地模型夹具的文本、工具拒绝、中止、错误经两个 TCP 与浏览器客户端验证；重复 / 迟到终态不覆盖新轮，缺口 / 缓冲不足 / 代际变化重新同步，迟到快照受请求代际约束。版本与实际能力分别核对，不兼容保留内容、提示匹配 / 重启并禁用变更。当前只读、deny-all、真实提供商关闭；不是 CORE-06 持久恢复或 M2 创建 / 发送 / 审批验收。

验证证据：docs/architecture/implementation-plan.md 的 CORE-05 已交付边界；packages/shared/src/runtime-contracts.ts、runtime-contracts.test.ts；apps/daemon/src/modules/events、modules/kernels/kernel.service.ts、test/events.test.ts；packages/agent-adapter/src/sdk-child.ts、kernel-protocol.ts；apps/web/src/services/runtime-client.ts、features/conversation/runtime-observer.tsx；e2e/runtime.spec.ts。新增 9 项单元 / 集成与 4 项浏览器流程，完整 94 项 Vitest / 16 项浏览器与 Electron E2E、SDK 本地冒烟通过；pnpm fix、pnpm run ci、pnpm verify:clean 退出 0，干净目录 frozen 安装 / 构建 / 测试 / 启停与锁文件 SHA-256 一致。原始输出及复核截图 docs/validation/core-05-evidence（ci.log、clean-workspace.json、clean-commands.json、runtime-*.png）；真实提供商请求 0，历史证据与预算账本未改。

### CORE-06 会话持久化与故障恢复

保存工作台索引并关联 pi 会话历史，恢复中断的观察状态。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [x] 重启可读历史、队列、审批结果及变更引用；SDK JSONL 为正文真源，初始历史最多 100 条 / 页、单条展示 64 KiB，完整内容可按需读取且不写回截断版。
- [x] 损坏记录可诊断和原始导出；独立 inflight 原子检查点初始目标间隔 1.5 秒，按消息 / 轮次 / 代际去重，崩溃部分回复只作中断展示，不伪造 SDK 历史或自动重放工具 / 未决授权。

进展 / 阻塞：SQLite / Drizzle 持久受管索引、队列、审批结果及变更引用；SDK v3 JSONL 是正文真源，SDK custom 元数据绑定轮次而不进入模型上下文。只读历史默认最新 100 条 / 页、64 KiB UTF-8 预览，完整原文按需读取；损坏记录可诊断并按精确原始字节导出，不修复 / 写回源。独立 inflight 以 1.5 秒目标间隔 fsync + 原子替换，立即刷开始 / 停止 / 审批 / 终态，按身份及 seq 去重，原生终态优先。真实 SDK / daemon 硬杀后只恢复中断展示；重启不创建内核、不自动重发 / 执行或恢复授权，队列 held、pending 审批失效，历史结果仅审计。工作台记录用标明来源的合成样本验证；M2 / M3 业务服务、SDK 冷恢复 / 旧 CLI 接管、备份迁移仍待各条功能验收。

验证证据：docs/architecture/implementation-plan.md 的 CORE-06 已交付边界；packages/shared/src/history-contracts.ts；packages/agent-adapter/src/native-history.ts、native-history.test.ts、sdk-child.ts；apps/daemon/src/infrastructure/database 与 migrations/0001_white_maverick.sql；apps/daemon/src/modules/sessions、events / kernels / bootstrap 接线；apps/daemon/test/sessions.test.ts、test/fixtures/recovery-host.mjs；apps/web/src/features/conversation/session-history.tsx；e2e/history.spec.ts。新增 12 项 Vitest / 3 项浏览器流程，完整 106 项单元 / 集成与 19 项浏览器 / Electron E2E、SDK 本地冒烟通过。pnpm fix、pnpm run ci、pnpm verify:clean 退出 0，干净目录 frozen 安装 / 构建 / 测试 / 启停与锁文件 SHA-256 一致。docs/validation/core-06-evidence 保存 ci.log、clean-workspace.json、clean-commands.json、history-*.png。真实提供商新增请求 0，预算账本和历史证据未改。

### CORE-07 进程池与资源排队

限制活跃内核和后台资源，对超限请求公平排队。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [x] M1 验证最多 3 个活跃内核、1 个模型任务，超限 FIFO 显示原因和顺序，可取消且不回收运行 / 待审批内核；终端预算预留 6，真实 PTY 在 M4 接入验收。
- [x] 空闲内核回收后可冷恢复；限额可配置、可核对，视图保留上限与内核池独立管理；资源负载待实测，不把初始值当性能保证。

进展 / 阻塞：daemon 统一分配默认 3 个内核 / 1 个模型任务，6 个终端仅预留预算；启动 / 回收占名额，实际退出才释放。内核和模型各自 FIFO，显示原因 / 顺序，256 等待背压，按身份取消，不自动重试或重发。空闲 LRU 与 300 秒自动回收保护运行 / 预留 / 待审批内核；受管 v3 JSONL 用新代际冷恢复，验证实际 SDK 请求包含原生上下文且不包含 inflight，稳定消息不重复，旧中断仍在原位置。12 项新增服务集成与 2 项浏览器流程、完整 118 项 Vitest / 21 项浏览器与 Electron E2E、SDK 冒烟和干净目录验证通过。审批保留 / 部分检查点为明确标注的合成观察，网页资源页只读；M2 发送 / 审批 / 配对、旧 CLI 接管、M4 PTY 与完整视图缓存另行验收。新增真实提供商请求 0。

验证证据：docs/architecture/implementation-plan.md#core-07-已交付边界；apps/daemon/src/modules/kernels/kernel-pool.ts、kernel.service.ts；packages/shared/src/resource-contracts.ts；packages/agent-adapter/src/sdk-runtime.ts / kernel.ts；apps/daemon/src/modules/sessions/session.store.ts；apps/daemon/test/resources.test.ts、e2e/resources.spec.ts；docs/validation/core-07-evidence/ci.log、clean-workspace.json、clean-commands.json 及 3 份资源 UI 截图。

### CORE-08 运行时兼容与升级诊断

锁定支持的 pi 版本并验证升级后的接口与权限契约。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 版本不匹配时给出当前版本、支持范围与修复指引。
- [ ] 升级前后运行契约样本；无法保证审批的模式只提供明示的只读能力。

## WS 项目与工作区

目录、项目、文件访问和修改归属

| ID | 功能 | 阶段 | 优先级 | 设计 | 实现 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| [WS-01](roadmap.html#feature=WS-01) | 打开、切换与校验工作区 | M2 | P0 | 已有详细设计，待校正 | 已验收 | CORE-05, CORE-06, SEC-07 |
| [WS-02](roadmap.html#feature=WS-02) | 最近工作区与重命名 | M2 | P0 | 已有详细设计，待校正 | 已验收 | WS-01 |
| [WS-03](roadmap.html#feature=WS-03) | 工作区与 Git 环境标识 | M2 | P0 | 已有详细设计，待校正 | 已验收 | WS-01 |
| [WS-04](roadmap.html#feature=WS-04) | 同目录写入互斥与外部改动 | M3 | P0 | 已列范围，待细化 | 未开始 | CORE-03, WS-01 |
| [WS-05](roadmap.html#feature=WS-05) | 多根目录与多仓库项目 | M6 | P1 | 已列范围，待细化 | 未开始 | WS-01, SEC-10 |
| [WS-06](roadmap.html#feature=WS-06) | 项目管理、分组与侧栏组织 | M2 | P0 | 已有详细设计，待校正 | 已验收 | WS-02, CORE-06 |
| [WS-07](roadmap.html#feature=WS-07) | 工作区信任与不可用恢复 | M2 | P0 | 已有详细设计，待校正 | 已验收 | WS-01, SEC-07 |

### WS-01 打开、切换与校验工作区

使用规范化目录身份打开桌面或本机网页工作区。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [x] 重复打开同一路径进入既有工作区，路径大小写和符号链接按平台规范处理。
- [x] 路径不存在、不可读写或未授权时不创建误导性的空会话，并显示可恢复原因。

进展 / 阻塞：完成 Electron 原生目录选择 / 取消、绝对路径输入、realpath 与平台物理目录指纹、并发 / 大小写 / junction 别名去重、重启后重新打开复用、本窗口切换及重新校验。实际列目录与 4 字节独占探针验证读写 / 清理，目录消失、替换、权限拒绝、保存失败和连接失效均给出恢复原因；保留旧记录，不创建空会话。切换保持实际 SDK 本地后台请求的 PID 与运行状态，不自动信任 / 执行项目资源。5 项服务集成（含实际 Windows ACL）和 2 项真实 Electron 流程进入门禁；另验证未拦截的 Windows 选择器打开中文目录及取消。完整 146 项 Vitest / 30 项浏览器与 Electron E2E、SDK 冒烟和干净目录复现通过。最近 / 重命名等仍属 WS-02，网页独立操作暂缓，本次不制作安装包；新增真实提供商请求 0。

验证证据：packages/shared/src/workspace-contracts.ts；apps/daemon/src/modules/workspaces/workspace.service.ts / workspace.transport.ts、infrastructure/database/schema.ts 与 migrations/0003_workspace_identity.sql；apps/desktop/src/directory-picker.ts / preload.cts / main.ts、scripts/dev.mjs；apps/web/src/features/workspaces/workspace-manager.tsx、services/workspace-client.ts、app/app.tsx；apps/daemon/test/workspaces.test.ts、e2e/workspaces.spec.ts / helpers/desktop.ts / desktop.spec.ts。pnpm fix、pnpm run ci、pnpm verify:clean 均退出 0；docs/architecture/implementation-plan.md#ws-01-已交付边界；docs/validation/ws-01-evidence（ci.log、clean-workspace.json、clean-commands.json、native-validation.json 与 3 张实际页面截图）。CI 的 OS 选择结果为夹具，原生选择器另有真实操作证据；真实 SDK 使用本地 HTTP 夹具，断线 / 迟到为网络故障注入。用户提供商 / 模型配置、预算账本、锁文件和固定录制本轮未改。

### WS-02 最近工作区与重命名

维护最近打开列表、显示名与失效路径处理入口。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [x] 重启后最近工作区和名称仍可恢复，排序按明示规则更新。
- [x] 失效目录可移除或重新定位，移除最近记录不删除目录和会话。

进展 / 阻塞：2026-11-03 WS-02 已验收：Electron 最近列表与自定义名由 daemon SQLite / 0007 迁移持久保存；成功显式打开 / 切换才更新最近顺序，同毫秒顺延，重命名 / 刷新 / 校验 / 重新定位不更新时间。最多展示 100 项及总数，旧库不伪造最近，standalone 内部登记不进入最近。Unicode 1–80 码点、预填 / Enter / Escape / IME、失败保留与 CAS 冲突处理通过。移除只隐藏最近，保留文件 / 身份 / 名称 / 项目 / 会话 / 当前窗口和后台任务；重新定位仅同物理目录且明确保存，不改既有会话 cwd，旧 cwd 不匹配时拒绝续发。新增 7 项实际目录 / SQLite / HTTP / SDK 本地服务测试与 4 项 Electron 流程；完整 192 项 Vitest / 57 项 E2E、SDK 冒烟及本次 frozen clean 通过。25 步原生 Windows / 微软拼音 / 真实选择器、失败恢复、同 PID 后台任务、同 data/profile 重启和两次正常菜单退出已补证。原生首段 hold 约 300 秒后 terminated，后续明确本地启动 / 停止分别记录，不冒充一轮贯穿；真实提供商请求 0，pi 配置 / canonical 预算未改，无安装包，网页独立操作暂缓。

验证证据：docs/validation/ws-02-evidence/acceptance.md、ci.log、clean-workspace.json、clean-commands.json、native-validation.json、native-steps.json、native-first-closed.json、native-final-closed.json、native-code-reuse-audit.json；apps/daemon/test/workspace-recents.test.ts；e2e/workspace-recents.spec.ts；0007_workspace_recents.sql。完整离线 CI / clean 退出 0，192 项 Vitest / 57 项 E2E、SDK 冒烟与实际 Electron / Windows 验收通过；文档与 PRD 同源重建后另跑完整 check。

### WS-03 工作区与 Git 环境标识

持续显示真实工作目录、仓库和当前分支或 detached 状态。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [x] 持续显示真实 cwd、仓库根目录及当前分支／detached／尚无提交状态；切换工作区、会话或外部分支后更新，不沿用其他对象的迟到结果。
- [x] 非 Git 目录、子模块及多个仓库按实际 cwd 区分，不虚构分支或阻止基础对话；查看或刷新不隐式改变已有会话 cwd。

进展 / 阻塞：Electron 真实 cwd／仓库根／中文分支／detached、非 Git／子模块／linked worktree／多个仓库、目标隔离及错误恢复已验收。完整 217 项 Vitest／72 项 E2E、SDK 冒烟与 frozen clean 通过；用户授权后的 28 步原生 Windows 验证补齐外部更新、非 Git 续发、切换同 PID／epoch 后台任务及原 cwd 保留、明确停止、明暗 800px 窄窗、同 data/profile 重启与两次正常菜单退出。重启 0 内核／0 新请求，历史哈希不变。277 文件与 clean 一致，原生后复用门禁；第一段 hold terminated 与后续明确重试／停止分开记录。真实提供商请求 0、pi 配置／预算／锁文件未改，无安装包，网页独立功能暂缓。OPS-08 继续进行。

验证证据：docs/validation/ws-03-evidence/acceptance.md、ci.log、clean-workspace.json、clean-commands.json、validation.json、native-observations.json、native-final-closed.json、native-code-reuse-audit.json 与 native/；apps/daemon/test/workspace-environment.test.ts；e2e/workspace-environment.spec.ts。

### WS-04 同目录写入互斥与外部改动

以物理目录为边界管理 agent 写入、回滚与可控命令任务。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 同一物理目录仅一个写入轮次，其他写入请求排队并展示归属。
- [ ] 终端或外部编辑混入时明确标记来源不确定，禁止将整份混合快照直接作为 agent 独占改动自动回滚。

### WS-05 多根目录与多仓库项目

一个项目可关联多个目录，明确主目录与每个操作目标。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 新会话、Git 与 Worktree 默认目标清楚，文件搜索可指定范围。
- [ ] 移除目录不会删除文件；跨根目录写入仍受独立权限和变更归属检查。

### WS-06 项目管理、分组与侧栏组织

创建、重命名和选择项目，按项目组织会话；项目可绑定单个默认目录，也可只用于组织。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [x] 项目创建、重命名、置顶和排序在重启后保持；侧栏可展开项目并显示其会话，项目名称与路径可检索。
- [x] 从项目新建预选该项目，从全局新建默认无项目，选择器始终显示实际归属；同名项目能通过稳定 ID 与目录区分。
- [x] 项目默认目录经过工作区校验；未绑定目录的项目会话使用独立执行空间，多根目录留给 WS-05。
- [x] 整理、重命名或移除项目不隐式移动文件、删除会话、切换执行目录或授予文件权限。

进展 / 阻塞：Electron 项目创建 / 重命名 / 置顶 / 手动排序与单默认目录由 daemon SQLite 0008 迁移持久保存；按已确认规则置顶优先、组内上下移、新建或切换置顶到目标组末尾。侧栏展开会话，名称 / 路径 / 稳定ID检索与同名区分；全局无项目、项目入口预选，未绑定目录的会话各自持久独立空间。默认目录经既有物理身份及读写校验但不更新最近；编辑仅影响未来会话。移除明确解散分组，在同事务把会话归无项目，保留文件 / cwd / 模型 / JSONL / 权限及已运行任务；创建墓碑、CAS、失败保留、未知创建核对、迟到隔离与目录异步准入复核均已验证。新增9项服务 / 6项Electron流程；完整201项Vitest / 63项E2E、SDK冒烟、本次frozen clean与实际Windows微软拼音 / 原生选择器 / 失败恢复 / 同PID任务 / 重启及两次正常退出通过。真实提供商请求0、pi配置与canonical预算未改，无安装包；网页独立功能暂缓。SESSION-12搜索与SESSION-13主动归属/环境迁移继续独立验收。

验证证据：docs/validation/ws-06-evidence/acceptance.md、ci.log、clean-workspace.json、clean-commands.json、native-validation.json、native-steps.json、native-remove-before.json / native-remove-after.json、native-final-closed.json、native-code-reuse-audit.json；apps/daemon/test/project-organization.test.ts；e2e/project-organization.spec.ts。完整24文件/201项Vitest、63项浏览器/Electron E2E及SDK本地冒烟退出0，frozen clean退出0；真实OS IME与合成composition、SDK本地夹具与真实提供商分开记录。

### WS-07 工作区信任与不可用恢复

让用户知道项目资源何时加载以及目录消失后如何恢复。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [x] 未信任仓库不会自动执行项目扩展、设置脚本或安装动作。
- [x] 目录移动、卸载或删除时暂停相关执行，保留历史并允许重新关联。

进展 / 阻塞：Electron 工作区信任与不可用恢复已验收：未信任文本／扩展／脚本／安装不执行，信任绑定物理身份；目录失效阻止发送并停止后台SDK，历史／草稿／原cwd保留，同物理目录明确重新关联仅改登记，恢复与重启不重发。新增7项服务／4项Electron回归，完整28文件／230项Vitest、82项E2E、SDK及frozen clean通过。68条原生观察完成真实路径移动、Windows ACL失效／后台同PID停止、真实选择器／取消／错误／明确保存、明暗800px、同data/profile重启0内核／0新请求及两次正常退出；288代码文件与clean一致后复用门禁。设备物理卸载未实测，采样边界及来源见证据。真实提供商0，pi配置／canonical预算／锁未改，无安装包，网页独立功能暂缓；OPS-08继续in_progress。

验证证据：docs/validation/ws-07-evidence/acceptance.md、validation.json、ci.log、clean-workspace.json、clean-commands.json、code-reuse-audit.json、targeted-services.log、targeted-electron-draft-recovery.log、monitor-negative-control.log、workspace-recovery-light.png、workspace-recovery-dark-800.png；apps/daemon/test/workspace-recovery.test.ts；e2e/workspace-recovery.spec.ts；packages/shared/src/workspace-availability.ts；apps/daemon/src/modules/workspaces/workspace-availability.service.ts；apps/daemon/src/modules/kernels/kernel.service.ts；apps/web/src/features/workspaces/workspace-safety.tsx。；docs/validation/ws-07-evidence/native-validation.json、native/first-closed.json、native/restart-closed.json。

## SESSION 会话管理

组织、查找、恢复与分叉长期工作

| ID | 功能 | 阶段 | 优先级 | 设计 | 实现 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| [SESSION-01](roadmap.html#feature=SESSION-01) | 首次发送创建会话与配置 | M2 | P0 | 已有详细设计，待校正 | 已验收 | WS-01, MODEL-01, CORE-06 |
| [SESSION-02](roadmap.html#feature=SESSION-02) | 恢复与切换会话 | M2 | P0 | 已有详细设计，待校正 | 已验收 | SESSION-01, CORE-06 |
| [SESSION-03](roadmap.html#feature=SESSION-03) | 会话列表、置顶、未读与归档 | M2 | P0 | 已有详细设计，待校正 | 已验收 | SESSION-02 |
| [SESSION-04](roadmap.html#feature=SESSION-04) | 高级历史检索与跨对象定位 | M6 | P1 | 已列范围，待细化 | 未开始 | SESSION-12, SEC-06 |
| [SESSION-05](roadmap.html#feature=SESSION-05) | 历史树与消息分叉 | M4 | P1 | 已有详细设计，待校正 | 未开始 | SESSION-02, CHANGE-07 |
| [SESSION-06](roadmap.html#feature=SESSION-06) | 会话导入与脱敏导出 | M4 | P1 | 已列范围，待细化 | 未开始 | SESSION-02, SEC-06, SEC-09 |
| [SESSION-07](roadmap.html#feature=SESSION-07) | 无项目会话与独立执行空间 | M2 | P0 | 已有详细设计，待校正 | 已验收 | SESSION-01, SEC-07 |
| [SESSION-08](roadmap.html#feature=SESSION-08) | 产物、PR 与任务关联 | M4 | P1 | 已列范围，待细化 | 未开始 | SESSION-02, CHANGE-03 |
| [SESSION-09](roadmap.html#feature=SESSION-09) | 会话删除与数据保留 | M5 | P1 | 已列范围，待细化 | 未开始 | SESSION-03, OPS-05 |
| [SESSION-10](roadmap.html#feature=SESSION-10) | 自动生成会话名称 | M2 | P0 | 已有详细设计，待校正 | 进行中 | SESSION-01, SEC-06 |
| [SESSION-11](roadmap.html#feature=SESSION-11) | 会话重命名与多端同步 | M2 | P0 | 已有详细设计，待校正 | 已验收 | SESSION-01, CORE-06 |
| [SESSION-12](roadmap.html#feature=SESSION-12) | 基础会话搜索与项目筛选 | M2 | P0 | 已有详细设计，待校正 | 已验收 | SESSION-02, WS-06, SEC-06 |
| [SESSION-13](roadmap.html#feature=SESSION-13) | 会话项目归属与环境迁移 | M2 | P0 | 已有详细设计，待校正 | 进行中 | SESSION-07, WS-06, SESSION-02, SEC-03 |

### SESSION-01 首次发送创建会话与配置

进入新会话页先保存草稿，首次有效发送才创建会话及首条消息；项目可选，绑定明确模型与实际执行空间。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [x] 全局新会话默认无项目，项目入口预选项目；未发送离开不产生永久空会话，已有会话发送不会意外创建另一会话。
- [x] 首次发送持久化稳定会话 ID 与首条消息后出现在侧栏；连续双击或同一创建请求断线重试只产生同一会话与同一首条消息。
- [x] 落库前失败保留草稿，落库后模型或内核失败保留原会话并提供明确重试；不静默重放执行结果不确定的副作用。
- [x] 无需先填名称或选择项目即可发送；创建中有反馈，命名任务不阻塞主响应，中文输入法选词不会误发送。

进展 / 阻塞：Electron 默认工作台通过实际 daemon / SQLite / pi SDK 本地夹具首发与续发；先保存稳定会话 / 首消息 / 配置再调度，同 requestId 与双击去重。落库失败保留草稿和原请求，已知运行失败明确重试，SDK SIGKILL / 重启后结果未知不重放；准入前后重查目录，standalone 拒绝链接逃逸。项目可选，模型 / cwd 明确，新旧草稿独立，刷新 / 设置返回和迟到回执均受保护。本轮真实 Windows 微软拼音候选态 Enter 提交及 Space 选出中文不发送，Shift+Enter 换行、普通 Enter 首发、同 ID 续发、原生目录选择 / 明暗 / 窄窗与退出均通过。补验发现并修复同项目新草稿重新进入丢失显式目录，修复前失败 / 修复后通过，最终完整离线 CI 再次通过；复用修复前 clean 的未变基础设施证据。本地摘要命名不额外调用模型，不改 pi 配置，已有提供商真实传输禁发。无安装包，网页独立发送暂缓。

验证证据：docs/validation/session-01-evidence/acceptance.md、ci.log、ci-native-followup.log、directory-regression-before.log、directory-regression-after.log、native-validation.json、native-before-send.json、native-first-run-audit.json、native-final-audit.json 及原生截图；apps/daemon/test/session-creation.test.ts；e2e/session-creation.spec.ts。目录修复后完整 164 项 Vitest / 40 项浏览器与 Electron E2E、SDK 本地冒烟退出 0；clean-workspace.json / clean-commands.json 是修复前 frozen 干净目录复现，依赖 / 原生模块 / 服务 / 构建配置未变而复用，锁哈希一致。原生最终只读审计为 2 会话 / 3 完成提交 / 3 完成轮次，指定 cwd 正确、SQLite 哈希未变，真实提供商请求 0。

### SESSION-02 恢复与切换会话

重新展示消息、运行、队列、审批和未审查变更。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [x] 切换只改变查看对象；后台运行 / 审批仍可找到且不抢焦点；每会话保存草稿、阅读锚点 / 偏移、工具展开及工作面板上下文，初始最多保留 3 个视图。历史 / 文件 / Diff 等异步响应绑定原会话、对象和请求版本，迟到结果不覆盖新内容或串入其他会话，卸载视图清理自身订阅但不停止后台执行。
- [x] 重新连接或卸载视图后恢复相应位置与最新权威状态，不启动第二次同样任务；后台文件 / Diff / 产物更新不替换当前阅读面板。 首版可发现并只读查看旧 pi 历史，标注来源 / 只读，不启动运行时或改写源文件 / 授权；CLI 同写时检查读取版本，不完整末行待刷新，损坏可诊断。

进展 / 阻塞：Electron 按会话保存独立草稿、阅读消息锚点 / 像素偏移、工具展开、分页与只读变更引用；MRU 最多 3 视图，新草稿占一个。淘汰只清理观察 / 查询，不停止 daemon 任务；四会话轮换、迟到 A→B→A、TCP WS 重连及 renderer reload 均恢复所属位置和权威状态，SDK 本地 hold 同 PID / epoch、无第二次 prompt，显式停止才 abort。侧栏显示运行 / 待审批 / held 状态，长标题不遮状态。显式 PIW_PI_AGENT_DIR/sessions 旧历史有界只读发现，拒绝链接与混合快照；版本绑定分页 / 全文，CLI 同写 409、半行待刷新、损坏诊断，源文件 / DB / 内核数量不变。工具 / 审批 / 变更引用是标注来源的合成恢复记录，不提前验收生产执行。sessionStorage 仅本窗口刷新与卸载恢复，不承诺应用重启或跨窗口草稿；旧历史续聊留待 SESSION-06。默认离线、真实传输关闭，不改 pi 配置或预算，无安装包，网页独立功能暂缓。 淘汰旧草稿视图后重开并选择新目录，晚到旧校验回执不得覆盖新选择；回归修复前失败 / 修复后通过，挂载代际失效在视图卸载时生效。

验证证据：docs/validation/session-02-evidence/acceptance.md、ci.log、ci-final.log、sidebar-before.log、sidebar-after.log、clean-workspace.json、clean-commands.json、native-validation.json、native-final-audit.json、native-running-before.json / evicted / reopened、docs-final.log 及 Electron / 原生截图；apps/daemon/test/legacy-history.test.ts、packages/agent-adapter/src/native-history.test.ts、e2e/session-switching.spec.ts / history.spec.ts。完整 170 项 Vitest / 44 项浏览器与 Electron E2E、SDK 本地冒烟通过；本次 frozen 新目录复现退出 0、锁 SHA-256 一致，最终标题布局与草稿回执隔离改动复用未变基础设施。原生四会话、独立草稿 / 900px 中段恢复 / 深色设置返回、后台同 PID 与旧历史只读分页通过；宿主脚本退出后多做一次 SQLite 审计导致退出 1，失败日志保留，所有自有进程和活动连接已释放，正常启停另由 CI / clean 证明。新增真实请求 0。；目录回执隔离补验 docs/validation/session-02-evidence/directory-before.log / directory-after.log；纳入既有迟到 Electron 用例，测试总数不变。

### SESSION-03 会话列表、置顶、未读与归档

组织日常工作并保留归档后的内容。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [x] 置顶、未读和归档在重启后保持，归档记录可恢复。
- [x] 运行中归档先说明是否停止；隐藏列表项不会伪装任务已结束。

进展 / 阻塞：SESSION-03 已验收：Electron 置顶 / 未读 / 归档由 daemon SQLite 持久保存，恢复不启动内核或旧授权；新完成 / 失败 / 中断结果标未读，仅活动窗口实际展示并读到最新才清除，支持手动标记。后台真实状态独立于视图，运行中归档先明确停止，等待服务确认后再次单独确认；取消归档保持同 SDK PID 继续运行。新增 7 项服务 / 5 项 Electron 流程，完整 179 项 Vitest / 49 项浏览器与 Electron E2E、SDK 冒烟通过；本次 frozen clean 通过，最后提示文案仅复用未变基础设施，完整 CI 已补跑。原生 Windows 重启持久 / 恢复 / 中段未读 / 后台停止归档及两次正常退出通过；真实请求 0，配置 / 预算未改，无安装包。旧历史完整消息脱敏后缀及本地夹具禁用端口回归修复前失败 / 修复后通过；生产审批 / held 阻挡用合成记录验证，不提前验收对应能力。网页版独立功能暂缓。

验证证据：docs/validation/session-03-evidence/acceptance.md、ci-native-followup.log、ci-final.log、clean-workspace.json、clean-commands.json、native-validation.json、native-final-closed.json、native-final-audit.json 和同名截图 / UIA / 分步审计；apps/daemon/test/session-organization.test.ts（7 项）、e2e/session-library.spec.ts（5 项）。完整 179 项 Vitest / 49 项 E2E 及 SDK 冒烟、pnpm fix / pnpm run ci / pnpm verify:clean 均退出 0；clean 仅复用最后停止提示文案前未变基础设施。legacy-suffix-before.log / legacy-suffix-after.log、fixture-port-before.log / fixture-port-after.log 为实际 HTTP red/green，保留旧偶发失败及根因证据限制。真实请求 0。

### SESSION-04 高级历史检索与跨对象定位

在基础会话搜索上补齐工具参数、日志、文件引用及高级跨对象检索。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 可检索工具、日志和文件引用，并跳到对应消息、调用或文件位置，显示命中上下文。
- [ ] 大历史搜索不冻结当前流式对话，敏感隐藏值不因索引预览泄露，索引缺失或损坏有明确重建路径。

### SESSION-05 历史树与消息分叉

以明确的消息边界分叉会话并解释文件版本语义。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 分叉展示继承范围，默认不复制授权、不自动恢复旧文件。
- [ ] 新会话明确告知沿用当前文件；要恢复历史文件时必须另选快照或 Worktree 流程。

### SESSION-06 会话导入与脱敏导出

以明确格式携带历史、工具摘要和必要审查记录。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 导出前可预览字段，密钥、环境变量和敏感输出按白名单剔除。
- [ ] 导入损坏或不兼容文件时不覆盖既有会话，不恢复有效授权或自动运行。 后续开放旧历史续聊前必须验证 CLI 并发写入、租约 / 锁、版本冲突与 SDK 兼容；未通过时保持只读，不把复制或改索引当作安全续写。

### SESSION-07 无项目会话与独立执行空间

允许不选项目就开始讨论或工作，由宿主管理每会话独立目录，历史与产物持久保存。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [x] 不选择项目也能创建、运行并在重启后恢复会话，可在最近和无项目范围找到；未隐式沿用上一个项目的目录和项目能力。
- [x] 界面显示无项目及实际独立目录；只加载明确启用的全局或会话能力，不因无项目扩大目录权限，已有外部权限显示来源。
- [x] 无项目会话的产物不在退出时自动删除，后续关联项目不搬移产物或丢失原始来源。

进展 / 阻塞：Electron 无项目首发、持久独立目录、不可变创建来源及能力来源、仅整理归属 CAS、失败保留／冲突／迟到隔离已验收。0010 迁移诚实标记旧记录来源。新增6项实际目录／SQLite／HTTP／SDK本地服务及4项Electron流程；最终完整27文件／223项Vitest、78项浏览器／Electron E2E、SDK冒烟与frozen clean通过，包含INPUT-01两项新增回归。29条Windows原生观察补齐不继承旧项目、真实首发／续发、写失败恢复、后台同PID／epoch及原cwd、明暗800px与键盘、同data/profile重启和两次正常菜单退出。重启0内核／0请求，历史／来源／外部夹具产物哈希不变，282文件与clean一致，原生后复用门禁。SESSION-13仅交付整理归属子集，完整环境迁移未验收；OPS-08继续进行。真实提供商0，pi配置／canonical预算／锁文件未改，无安装包，网页版独立功能暂缓。

验证证据：docs/validation/session-07-evidence/acceptance.md、validation.json、ci.log、clean-workspace.json、clean-commands.json、native-validation.json、native-observations.json、native-first-closed.json、native-restart-closed.json、native-code-reuse-audit.json与native/；apps/daemon/test/session-spaces.test.ts；e2e/session-spaces.spec.ts。

### SESSION-08 产物、PR 与任务关联

将文件结果、变更、任务和 PR 关联到产生它们的会话。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 关联对象可从会话与检查器双向定位，具有稳定来源和时间。
- [ ] 失效路径或外部链接显示不可用原因，移除关联不删除外部对象。

### SESSION-09 会话删除与数据保留

区分归档、清理缓存与删除原始历史。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 删除前显示包含的消息、日志、快照以及不可恢复的部分。
- [ ] 清理不删除仍在运行或未审查的必需记录，保留策略可查。

### SESSION-10 自动生成会话名称

默认用首条消息的本地脱敏摘要命名，不额外调用模型；可选模型润色默认关闭，不阻塞任务或覆盖人工标题。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 首条消息持久化后立即有最多 40 个 Unicode 字符的本地标题；默认无额外模型请求。显式启用模型润色后只用现有配置、一次请求、10 秒超时回退。
- [ ] 可选命名请求不调用工具、不读取文件、不写入主会话历史；用量单独追踪，标题为脱敏纯文本，离线或失败不阻塞主任务。
- [ ] 标题写入校验来源、版本与请求 ID；人工改名后迟到结果不得覆盖，后续消息不反复改名；显式重新自动命名先确认是否调用模型。

进展 / 阻塞：SESSION-01 已实现最多 40 Unicode 字符的脱敏纯文本本地标题、local 来源和版本 1，不新增命名请求、不阻塞主任务；原生执行输入保持原文。可选模型润色 / 用量 / 超时、显式重新命名及人工改名后的 CAS 防覆盖未交付，不整条验收。

验证证据：docs/validation/session-01-evidence/acceptance.md、ci.log、clean-workspace.json、clean-commands.json；apps/daemon/test/session-creation.test.ts；e2e/session-creation.spec.ts。完整 164 项 Vitest / 40 项浏览器与 Electron E2E、SDK 本地冒烟及 frozen 干净目录复现通过，锁哈希一致，真实提供商请求 0。

### SESSION-11 会话重命名与多端同步

从侧栏或标题菜单手动改名，保留人工标题并同步列表、页签和搜索索引。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [x] 重命名支持预填、Enter 保存和 Escape 取消，接受去首尾空白后的 1–80 个 Unicode 字符；允许同名，会话 ID 和历史不变。
- [x] 保存失败保留原名和编辑内容，两个客户端并发修改通过版本检查防止静默覆盖；成功后其他客户端与索引显示新标题。
- [x] 保存后标题来源为用户，后台命名不能覆盖；取消和中文输入法选词不会触发误保存。

进展 / 阻塞：Electron 侧栏 / 标题菜单共用重命名，支持预填全选、去首尾空白后 1–80 Unicode 码点、Enter / Escape、失败保留、CAS 冲突与显式继续编辑、独立 WS 多端同步 / 重连及人工标题保护。完整 185 项 Vitest / 53 项浏览器和实际 Electron E2E、SDK 冒烟、frozen clean 通过。真实 Windows 微软拼音候选 Enter / Escape / Space 选词、原生取消 / 写失败恢复 / 标题与历史同步、同 data / profile 重启持久及两次正常退出均补证，三项验收通过。原生 SendInput 与合成 composition 分开记录；230 个产品 / 测试 / 根配置文件与 clean 一致，按用户要求复用门禁。真实提供商请求 0，pi 配置 / 预算未改，无安装包。

验证证据：docs/validation/session-11-evidence/acceptance.md；ci-complete.log、clean-workspace.json、clean-commands.json；apps/daemon/test/session-titles.test.ts（6 项）；e2e/session-titles.spec.ts（4 项：双 Electron + 只读浏览器、冲突 / 重连、故障恢复、合成 IME 与旧版本隔离）；native-validation.json、native-steps.json（17 检查点 / 18 截图）、native-first-closed.json、native-final-closed.json、native-restarted-audit.json、native-history-hashes-before.json / native-history-hashes-after.json、native-code-reuse-audit.json。首轮 CI 失败及原生暂停记录保留。

### SESSION-12 基础会话搜索与项目筛选

在 M2 搜索标题和用户 / 助手正文，按项目、无项目、状态、时间及归档过滤并定位消息。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [x] 中文标题和正文均可命中，支持全部项目、指定项目及无项目过滤；默认不含归档，可显式加入，正文结果能定位对应消息。
- [x] 结果分页并显示归属、时间与脱敏片段；默认 200 ms 防抖，迟到查询不会覆盖新结果，键盘可选择并打开会话。
- [x] 重命名、移入移出项目、归档和删除后索引更新；空查询显示最近会话，无结果时可清除筛选，搜索不会启动新运行。

进展 / 阻塞：Electron 中文标题 / 用户 / 助手正文搜索、全部 / 指定 / 无项目、真实状态 / 本地日期 / 归档、脱敏分页与原消息定位、200ms 防抖 / 迟到隔离 / 键盘及索引更新已验收。新增 8 项实际 SQLite / v3 JSONL / HTTP / SDK 本地服务与 4 项 Electron 流程，完整 209 项 Vitest / 67 项 E2E、SDK 冒烟、frozen clean 通过；270 个产品 / 测试 / 脚本 / 配置文件与 clean 一致，原生后复用门禁。真实微软拼音 Enter / Escape / 数字及 Space 选词、原生失败显式恢复 / 改名刷新 / 同 PID 后台状态 / 明暗窄窗 / 同 data/profile 重启搜索与两次正常菜单退出已补证。项目迁移 / 删除产品入口仍未交付，使用明确 SQLite 夹具验证索引消费边界，不提前验收 SESSION-13。真实提供商请求 0，pi 配置 / canonical 预算未改，无安装包，网页独立功能暂缓。

验证证据：docs/validation/session-12-evidence/acceptance.md；ci-complete.log、clean-workspace.json、clean-commands.json；apps/daemon/test/session-search.test.ts（8 项）、e2e/session-search.spec.ts（4 项）；native-validation.json、native-observations.json、native-first-menu-closed.json、native-final-closed.json、native-code-reuse-audit.json。真实 OS IME 与合成 composition 分开，早期失败 / 暂停 / 强制夹具清理留档。

### SESSION-13 会话项目归属与环境迁移

支持移入、移出和改换项目，将侧栏整理与显式切换执行目录分开处理。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 移到项目或移出项目后列表、搜索和持久化归属一致，保留会话 ID、消息、运行状态和产物；默认只整理归属，cwd、文件和权限不变。
- [ ] 用户明确选择改用项目环境时预览目录与能力差异；运行、待审批、排队或未审查状态阻止切换，不在轮次中途改 cwd。
- [ ] 成功切换保留可见历史，从下一轮使用新环境并撤销旧目录授权；旧快照与产物仍关联原目录，文件复制走独立冲突预检流程。

进展 / 阻塞：SESSION-07已验收仅整理归属的CAS与Electron入口，保留cwd／文件／原始来源／真实任务，作为本条部分支撑。完整环境预览、忙碌检查、切换与撤销旧目录授权仍待本条及SEC-03，不提前验收；三项保持未勾选。

验证证据：docs/validation/session-07-evidence/acceptance.md

## INPUT 任务输入与上下文

让任务、附件、指令和队列正确进入模型

| ID | 功能 | 阶段 | 优先级 | 设计 | 实现 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| [INPUT-01](roadmap.html#feature=INPUT-01) | 文本输入、中文输入法与草稿 | M2 | P0 | 已有详细设计，待校正 | 已验收 | SESSION-01 |
| [INPUT-02](roadmap.html#feature=INPUT-02) | 斜杠命令与技能选择 | M4 | P1 | 已有详细设计，待校正 | 未开始 | INPUT-01, EXT-01 |
| [INPUT-03](roadmap.html#feature=INPUT-03) | 文件、目录与代码范围引用 | M4 | P1 | 已列范围，待细化 | 未开始 | INPUT-01, FILE-02, SEC-10 |
| [INPUT-04](roadmap.html#feature=INPUT-04) | 图片与截图附件 | M6 | P1 | 已列范围，待细化 | 未开始 | INPUT-01, MODEL-03 |
| [INPUT-05](roadmap.html#feature=INPUT-05) | 文档与其他附件 | M6 | P1 | 已列范围，待细化 | 未开始 | INPUT-01, FILE-04 |
| [INPUT-06](roadmap.html#feature=INPUT-06) | 引导、追加与可编辑队列 | M2 | P0 | 已有详细设计，待校正 | 未开始 | CORE-05, INPUT-01 |
| [INPUT-07](roadmap.html#feature=INPUT-07) | 问答、计划与执行模式 | M6 | P1 | 已列范围，待细化 | 未开始 | INPUT-01, SEC-04, SEC-05 |
| [INPUT-08](roadmap.html#feature=INPUT-08) | 结构化澄清与决定 | M4 | P1 | 已列范围，待细化 | 未开始 | INPUT-01, CORE-05 |
| [INPUT-09](roadmap.html#feature=INPUT-09) | 目标、计划清单与运行预算 | M7 | P1 | 已列范围，待细化 | 未开始 | INPUT-08, MULTI-06 |
| [INPUT-10](roadmap.html#feature=INPUT-10) | 项目指令与上下文来源 | M4 | P1 | 已列范围，待细化 | 未开始 | SESSION-01, SEC-07 |

### INPUT-01 文本输入、中文输入法与草稿

提供可靠的发送、换行、中文输入法和草稿；未创建会话的新会话页也能保留独立草稿。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [x] Enter 发送、Shift+Enter 换行与中文输入法组合态不冲突，纯空白输入不发送。
- [x] 未发送的新会话草稿与已有会话草稿分开保存，切换或刷新可恢复正文、已选项目和模型；不会把草稿误发到另一会话。

进展 / 阻塞：沿用 SESSION-01/02 产品实现，新增两项实际 Electron E2E 通过：空白 / 组合态 / Enter / 换行、独立草稿与项目 / 已配置未联网模型、真实 reload 和仅续发所属会话。27 条原生观察补齐 Windows 中文候选 Return / Escape / Space / 数字、跨四视图及设置返回、真实首发和乙续发完成、甲草稿保持；正常菜单退出。仅新增测试文件变化，未变产品/运行时复用 WS-03 CI/clean，本次 SESSION-07 最终完整223项Vitest／78项浏览器与Electron E2E及SDK冒烟已包含两项新增测试，frozen clean通过。原生快捷键未证明刷新，刷新结论只来自实际 Electron E2E。真实请求0，配置/预算未改，无安装包，网页独立功能暂缓。

验证证据：docs/validation/input-01-evidence/acceptance.md、target.log、native-validation.json、native-final-closed.json、code-reuse-audit.json；docs/validation/session-07-evidence/ci.log、clean-workspace.json。

### INPUT-02 斜杠命令与技能选择

发现并调用当前会话实际可用的命令、技能和模板。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 列表来自有效能力快照，选择后能看到将使用的参数或说明。
- [ ] 未知命令内联报错；未加载技能不会被显示为已执行。

### INPUT-03 文件、目录与代码范围引用

通过 @、拖入或选择代码添加有边界的上下文。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 发送前显示引用路径、行号和内容规模，可移除或修改；长粘贴引用保留精确字节、预览和撤销，不以引用形式宣称天然节省 token。
- [ ] 不存在、越界、过大或变化文件有提示，不自动发送整个目录；新会话附件按 draftId 暂存，首次发送成功才绑定 sessionId，失败保留草稿，不提前持久建会话。

### INPUT-04 图片与截图附件

让支持视觉的模型读取图片，并提示不支持的情况。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 发送前可预览、移除图片，显示大小与模型支持状态。
- [ ] 模型不支持、尺寸超限或上传失败时保留草稿，不静默丢弃附件。

### INPUT-05 文档与其他附件

支持文本、PDF 等可提取文档的受控上下文输入。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 明确原件、提取文本和截断范围，可预览将进入上下文的内容。
- [ ] 不支持的文件类型、扫描文档和超限文件显示处理办法，不虚报全文已读。

### INPUT-06 引导、追加与可编辑队列

区分当前轮纠偏和下一轮任务，维护各自送达顺序。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 先追加后引导时，引导在可用模型边界生效；两类队列各自 FIFO，界面解释实际顺序。
- [ ] 待发消息可以取消或编辑，中止默认保留队列且不自动恢复执行。

### INPUT-07 问答、计划与执行模式

明确任务只讨论、产出计划还是允许修改环境。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 切换模式显示实际可用工具和写入权限，不仅改变提示词。
- [ ] 计划阶段的结果可确认后转执行，切换期间不自动执行先前未经授权的动作。

### INPUT-08 结构化澄清与决定

支持单选、多选或短文本问题，并保留决定历史。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 问题、选项、默认建议和提交结果可回看，取消不被当作同意。
- [ ] 等待用户输入时运行状态与队列清楚，重连后同一问题不重复提交。

### INPUT-09 目标、计划清单与运行预算

记录长期目标、执行步骤、停止条件和预算。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 计划项可标记进行、完成或阻塞，并关联运行证据。
- [ ] 达到预算或停止条件时清楚停下，未完成项不会被自动标成成功。

### INPUT-10 项目指令与上下文来源

展示 AGENTS、项目指令、技能和附加目录的加载来源。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 发送前或详情中可查看生效来源与优先级，覆盖冲突有明确规则。
- [ ] 仓库指令不被当作额外授权，修改后何时重新加载可见。

## OBS 过程观察

消息、工具、状态和运行证据

| ID | 功能 | 阶段 | 优先级 | 设计 | 实现 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| [OBS-01](roadmap.html#feature=OBS-01) | 流式消息与安全内容渲染 | M2 | P0 | 已有详细设计，待校正 | 已验收 | CORE-05, SESSION-01 |
| [OBS-02](roadmap.html#feature=OBS-02) | 运行阶段与中止结果 | M2 | P0 | 已有详细设计，待校正 | 未开始 | CORE-05, INPUT-06 |
| [OBS-03](roadmap.html#feature=OBS-03) | 工具时间线与嵌套调用 | M2 | P0 | 已有详细设计，待校正 | 已验收 | CORE-05, SEC-06 |
| [OBS-04](roadmap.html#feature=OBS-04) | 滚动跟随与新消息提醒 | M2 | P0 | 已有详细设计，待校正 | 已验收 | OBS-01 |
| [OBS-05](roadmap.html#feature=OBS-05) | 消息检索、引用与深链接 | M4 | P1 | 已列范围，待细化 | 未开始 | OBS-01, FILE-02 |
| [OBS-06](roadmap.html#feature=OBS-06) | 可用的思考信息展示 | M2 | P0 | 已有详细设计，待校正 | 未开始 | OBS-01, MODEL-01 |

### OBS-01 流式消息与安全内容渲染

渲染文本、代码、列表、表格及受支持的图示。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [x] 一帧内累计所有文本增量再渲染，不能只保留最后一个 delta；审批 / 错误 / 取消 / 终态立即冲刷，完成时由权威消息去重替换，不能吞字或重复拼接。
- [x] 不可信 Markdown、链接和 HTML 不执行脚本或获得本地文件权限；展示截断可展开且不影响原始历史与模型上下文。高亮 / 支持的图示按需加载，未知语言、未闭合围栏、超限或渲染失败保留安全文本；异步渲染不覆盖新内容，图示接入时验证净化 / 隔离。

进展 / 阻塞：Electron流式与安全内容展示已验收：每帧累计全部delta，非delta状态即时冲刷，权威终态替换去重；CommonMark/GFM安全Markdown、仅显式HTTP(S)链接、禁止自动图片和原始HTML执行、本地协议惰性。16k预览可展开，64k以上纯文本、12k以上代码不高亮，未知语言／未闭合围栏／可选模块失败回退；按需Shiki与异步身份保护。8项新增Vitest、4项新增Electron流程；完整238项Vitest／86项E2E、SDK和frozen clean通过。Windows原生富文本／纯文本切换、长内容展开／收起、明暗主题、同data/profile重启0请求及两次正常退出补证。图示仅惰性代码，未接入执行型图示。真实提供商0、pi配置／canonical预算未改，无安装包，网页独立功能暂缓；OPS-08继续in_progress。

验证证据：docs/validation/obs-01-evidence/acceptance.md、ci.log、clean-workspace.json、native-validation.json、code-reuse-audit.json；apps/web/src/services/runtime-client.test.ts；apps/web/src/features/conversation/content-policy.test.ts；e2e/message-rendering.spec.ts。

### OBS-02 运行阶段与中止结果

区分启动、运行、待审批、压缩、重试、收尾、失败与中断。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 仍有工具、重试、压缩或队列延续时不会显示任务完成；当前运行阶段有一个主要反馈位置，同一操作的事件 / 请求错误不重复提示，等待模型不伪造思考。终态提示消隐不改变权威结果，进行中或待决定状态不能被当作已处理。
- [ ] 中止表示请求已确认并等待停止结果；无法确认进程已停时展示未知或处理中。

### OBS-03 工具时间线与嵌套调用

用稳定调用 ID 展示参数、审批、并行关系、结果与耗时。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [x] 拒绝、失败、取消及嵌套工具都可追溯，返回顺序不改变调用的关联关系。
- [x] 长输出可展开或下载，敏感值脱敏；按可验证的工具结构显示文件 / 变更 / 命令 / MCP 摘要，未知工具或结构解析失败降级为安全文本，不影响执行结果。缺失的退出码 / 耗时显示未知，工具卡 Diff 不冒充可回滚账本。

进展 / 阻塞：OBS-03 已验收：完整 35 文件／251 项 Vitest、93 项浏览器及 Electron E2E、SDK 冒烟与 frozen clean 通过；Windows 原生工具身份／摘要／长输出脱敏与收起、跨会话及逐轮展开隔离、后台同 PID／epoch 和焦点、明暗 802px 窄窗、同 data/profile 只读重启 0 内核／0 新发送／0 注入、历史哈希不变及正常菜单退出已补证。316 文件与 CI／clean 一致，原生后复用门禁；仅文档模板另更新。两项勾选，当前本地 27 / 133，OPS-08 继续 in_progress。合成工具观察与真实 SDK 禁用工具错误分开，未开启生产工具／审批／MCP／回滚；真实提供商 0，配置／预算／锁未改。

验证证据：docs/validation/obs-03-evidence/acceptance.md、validation.json、ci.log、fix.log、targeted-vitest.log、targeted-electron.log、identity-negative-control.log、native-validation.json、clean-workspace.json、clean-commands.json、code-reuse-audit.json；e2e/tool-timeline.spec.ts；packages/shared/src/tool-observation.test.ts、tool-presentation.test.ts；packages/agent-adapter/src/tool-observer.test.ts、kernel.test.ts；apps/daemon/test/tool-observations.test.ts。；native-validation.json、native/observations.json、native/first-closed.json、native/restart-closed.json、native/active-background-before.json、native/active-background-after.json。

### OBS-04 滚动跟随与新消息提醒

尊重用户回看历史的位置，提供返回最新入口。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [x] 用户回看不被流式更新强拉到底；会话切换和历史分页以消息锚点 / 偏移恢复，卸载视图后同样可恢复。
- [x] 新消息数量、返回最新和长消息展开的位置变化可理解；后台完成或审批不抢焦点、不打开其他会话面板。

进展 / 阻塞：Electron 滚动跟随与新消息提醒已验收：回看不强拉，按用户／助手消息身份计数，显式返回最新恢复跟随并聚焦消息区；消息锚点／像素偏移跨历史分页、3 视图淘汰和本窗口 renderer 刷新恢复。长文展开／格式切换保留现场，收起按缩短内容限制偏移，避免空白。新增 2 项 Vitest、4 项实际 Electron 流程；最终完整 31 文件／240 项 Vitest、90 项浏览器及 Electron E2E、SDK 与 frozen clean 通过。60 条原生观察归档，覆盖慢流回看、2／1／3 条消息计数、键盘返回、后台同 PID／epoch、分页位置、明暗窄窗及同 data/profile 重启 0 内核／0 新请求、两次正常菜单退出；304 个产品／测试／脚本／配置文件与 clean 一致，原生后复用门禁。分页文件行与审批观察明确为合成样本，不冒充生产审批；跨完整应用重启不承诺窗口草稿／阅读书签。真实提供商 0、pi 配置／canonical 预算／锁未改，无安装包，网页独立功能暂缓；OPS-08 继续 in_progress。

验证证据：docs/validation/obs-04-evidence/acceptance.md、validation.json、ci.log、clean-workspace.json、clean-commands.json、code-reuse-audit.json、native-validation.json、native-observations.json、native/first-closed.json、native/restart-closed.json；e2e/scroll-reading.spec.ts；apps/web/src/features/conversation/message-updates.test.ts、remembered-viewport.tsx、latest-messages-button.tsx、session-history.tsx。

### OBS-05 消息检索、引用与深链接

支持会话内查找、复制、引用消息以及跳转文件行。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 链接可返回指定会话、消息或工具，复制代码不夹带装饰文本。
- [ ] 目标归档、内容被清理或文件已变更时展示真实状态。

### OBS-06 可用的思考信息展示

仅展示上游实际提供的思考文本、摘要或状态。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 支持的内容可折叠，模型未提供时显示状态而不伪造推理内容。
- [ ] 导出、复制和隐私设置遵循模型输出权限，不承诺获取隐藏的内部推理。

## SEC 审批与权限

明确授权，并在执行环境中落实限制

| ID | 功能 | 阶段 | 优先级 | 设计 | 实现 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| [SEC-01](roadmap.html#feature=SEC-01) | 风险分类与最终参数裁决 | M2 | P0 | 已有详细设计，待校正 | 未开始 | CORE-02 |
| [SEC-02](roadmap.html#feature=SEC-02) | 执行前审批与失败关闭 | M2 | P0 | 已有详细设计，待校正 | 未开始 | SEC-01, CORE-05 |
| [SEC-03](roadmap.html#feature=SEC-03) | 会话授权查看与撤销 | M2 | P0 | 已列范围，待细化 | 未开始 | SEC-02 |
| [SEC-04](roadmap.html#feature=SEC-04) | 权限配置与任务模式 | M4 | P1 | 已列范围，待细化 | 未开始 | SEC-01, SEC-03, MODEL-04 |
| [SEC-05](roadmap.html#feature=SEC-05) | 操作系统级执行隔离 | M5 | P0 | 已列范围，待细化 | 未开始 | SEC-04, SEC-10 |
| [SEC-06](roadmap.html#feature=SEC-06) | 密钥存储与输出脱敏 | M2 | P0 | 已有详细设计，待校正 | 已验收 | CORE-04 |
| [SEC-07](roadmap.html#feature=SEC-07) | 项目、扩展和脚本信任 | M2 | P0 | 已有详细设计，待校正 | 已验收 | CORE-04 |
| [SEC-08](roadmap.html#feature=SEC-08) | 本机浏览器配对与客户端撤销 | M2 | P0 | 已有详细设计，待校正 | 已验收 | CORE-05, SEC-06 |
| [SEC-09](roadmap.html#feature=SEC-09) | 审批与操作审计 | M2 | P0 | 已有详细设计，待校正 | 未开始 | SEC-02, SEC-06 |
| [SEC-10](roadmap.html#feature=SEC-10) | 目录与网络访问规则 | M2 | P0 | 已列范围，待细化 | 未开始 | SEC-01 |

### SEC-01 风险分类与最终参数裁决

对路径、命令、凭证、外部服务和未知工具按最高风险裁决。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 新会话仅经验证的受限读取自动，写文件和命令先审批（显式有限会话授权按范围复用，L3 仍单次）；任意 Shell 或未知工具不凭只读注解放行，多个规则命中取最高风险。
- [ ] 最终执行参数与批准参数相同；参数改写、组合命令及嵌套调用重新检查。

### SEC-02 执行前审批与失败关闭

默认写文件与命令执行前询问；本地审批无倒计时，参数或生命周期失效时失败关闭。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 决定前副作用未发生；本地请求无倒计时，可显式取消，拒绝原因回传且不自动换形式重试；待审批资源和后台入口可见。
- [ ] 关闭展示或短暂断线继续等待且不执行；取消、IPC / 服务 / 内核失效、最终参数或策略代际变化使旧请求失效并唤醒等待；首个有效多端决定生效。

### SEC-03 会话授权查看与撤销

显示已授予的路径、命令和工具范围，支持即时撤销。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] L3 不产生会话授权；普通授权须显式授予，绑定会话、工具、目录 / 路径和最终参数的明确匹配边界，不超出所展示的范围。
- [ ] 可撤销全部及单条授权，撤销阻止后续复用；正在执行的动作需单独中止。

### SEC-04 权限配置与任务模式

提供只读、需要审批和受限执行等有明确作用范围的配置。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 界面列出实际目录、网络和命令边界，展示配置来源与生效时机。
- [ ] 提高限制立即作用于后续执行，降低限制有明确确认且不绕过 L3 单次决定。

### SEC-05 操作系统级执行隔离

按平台选择真实限制文件、进程与网络的执行方案。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 超出沙箱允许范围的代表性读写和网络访问被执行环境阻止并有证据。
- [ ] 不支持或无法启用时明确标注并降级，不能把审批开关宣传为执行隔离。

### SEC-06 密钥存储与输出脱敏

安全接入模型及工具凭证，并控制显示、日志和导出。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [x] 界面不回显明文密钥，日志、审批摘要和导出使用同一脱敏规则。
- [x] 密钥缺失、过期或保存失败时可诊断，更新不覆盖其他有效配置。

进展 / 阻塞：沿用现有 pi auth.json / models.json，仅宿主读取凭证并返回来源、缺失 / 过期 / 命令未执行等元数据，默认离线不读真实配置。内部 API key 更新具备原生锁、revision、原子替换、写入前应用原访问权限和失败诊断，不覆盖其他有效配置。日志、审批摘要、HTTP / WS 累计流式与重放、历史展示和安全导出共用脱敏策略，原始执行 / JSONL / 检查点不改；中止 / 错误 / 恢复及历史全文不释放未完整密钥前缀，无法安全解析的二进制拒绝导出。真实 SDK 本地夹具、合成凭证 / 审批 / 分片与实际 Windows ACL、HTTP / TCP WS、浏览器流程验证通过。完整 127 项 Vitest / 23 项浏览器与 Electron E2E、SDK 冒烟及干净目录验证通过，新增真实提供商请求 0。浏览器修改留待 SEC-08 / MODEL-02；不宣称 pi 原生文件加密，也不承诺过滤所有未知 / 混淆秘密。

验证证据：docs/architecture/implementation-plan.md#sec-06-已交付边界；packages/shared/src/redaction.ts、security-contracts.ts、redaction.test.ts；apps/daemon/src/modules/security/security.service.ts、bootstrap/app.ts、modules/events/event.service.ts / event.transport.ts、modules/sessions/session.transport.ts；apps/daemon/test/security.test.ts；apps/web/src/features/settings/credential-status.tsx、features/conversation/session-history.tsx；e2e/security.spec.ts。pnpm fix、pnpm run ci、pnpm verify:clean 均退出 0（127 项 Vitest / 23 项 E2E，锁文件 SHA-256 一致，服务优雅退出，0 真实提供商请求）。原始输出与截图 docs/validation/sec-06-evidence/ci.log、clean-workspace.json、clean-commands.json、credentials-light.png、credentials-dark-390.png、redacted-approval.png；预算账本和固定录制未改。

### SEC-07 项目、扩展和脚本信任

区分用户级配置、仓库内容和第三方执行资源。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [x] 首次加载项目执行资源前显示来源和影响，未信任时不自动运行。
- [x] 外部内容中的指令不扩大工具权限，信任记录可查看和撤销。

进展 / 阻塞：完成项目 / 显式用户目录 / 第三方声明的来源与影响检查、逐项预览确认、按实际目录 / 来源 / SHA-256 指纹持久复用、变化重确认及记录查看 / 撤销。KernelService 在 FIFO 排队后逐轮重查，已检查文本快照经私有 IPC 加载；旧预览、越界、链接 / junction、超限、损坏记录和保存失败不获许可。撤销下一轮生效，当前快照与历史保留。SDK 仅加载已确认上下文文本，原生扩展 / 技能 / 脚本 / 包安装 / 设置合并及工具继续禁用，不凭信任扩大权限。7 项服务集成与 2 项浏览器流程、扩充真实 Electron；完整 141 项 Vitest / 28 项浏览器与 Electron E2E、SDK 冒烟及干净目录复现通过，新增真实提供商请求 0。

验证证据：packages/shared/src/trust-contracts.ts；apps/daemon/src/modules/security/trust-discovery.ts / trust.service.ts / trust.transport.ts、modules/kernels/kernel.service.ts 与 migrations/0002_curious_winter_soldier.sql；packages/agent-adapter/src/sdk-runtime.ts / kernel-protocol.ts；apps/web/src/features/settings/resource-trust.tsx、services/trust-client.ts；apps/daemon/test/trust.test.ts、e2e/trust.spec.ts / desktop.spec.ts。pnpm fix、pnpm run ci、pnpm verify:clean 退出 0；docs/architecture/implementation-plan.md#sec-07-已交付边界；docs/validation/sec-07-evidence（ci.log、clean-workspace.json、clean-commands.json、3 张实际页面截图）。真实 SDK + 本地 HTTP 夹具与合成资源 / 故障来源已标明，用户真实配置、预算账本和固定录制未改。

### SEC-08 本机浏览器配对与客户端撤销

用独立客户端身份安全访问本机服务并同步会话。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [x] 配对令牌有一次性与过期约束，错误 Origin、Host 或未认证写请求被拒绝。
- [x] 可列出和撤销浏览器会话；重新启动服务后按规则重新授权。

进展 / 阻塞：宿主签发 256 bit 随机一次性票据（120 秒），HttpOnly / SameSite=Strict 会话 Cookie、独立客户端身份与 8 小时绝对有效期；精确 Host / Origin、JSON / CSRF 和未认证默认拒绝覆盖现有及未来写请求，REST / WS 实际数据均需配对。客户端列表、撤销 / 自撤销、到期关闭 WS，后台 SDK 任务继续；服务重启全部重新配对。真实 SDK + 本地模型夹具、原生 HTTP / TCP WS、两个独立 Chromium 客户端及 Electron 私有父子 IPC / Cookie / 原生菜单通过；OS 外部浏览器启动为测试拦截，IME 为合成事件。新增 7 项安全测试及 3 项浏览器 / Electron 流程，完整 134 项 Vitest / 26 项 E2E、SDK 冒烟、干净目录 frozen 安装 / 构建 / 启停与锁文件一致性通过。真实提供商新增 0，配置未改；MODEL-02 凭证写入与生产工具审批仍关闭。

验证证据：packages/shared/src/access-contracts.ts；apps/daemon/src/modules/security/access.service.ts / access.transport.ts / host-access.ts；apps/desktop/src/main.ts、scripts/dev.mjs；apps/web/src/features/settings/client-access.tsx；apps/daemon/test/access.test.ts、e2e/access.spec.ts、e2e/desktop.spec.ts。pnpm fix、pnpm run ci、pnpm verify:clean 退出 0；docs/architecture/implementation-plan.md#sec-08-本机客户端授权边界；docs/validation/sec-08-evidence（ci.log、clean-workspace.json、clean-commands.json、3 张实际页面截图）。

### SEC-09 审批与操作审计

记录人类决定、授权变更、回滚和重要设置变化。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 记录含对象、风险、来源、决定、范围和时间，agent 不能改写自己的审批历史。
- [ ] 可导出和清理的范围明确；审计正文不包含未脱敏密钥。

### SEC-10 目录与网络访问规则

统一路径解析、附加根目录、网络目标和组合命令授权边界。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 路径穿越、前缀近似、符号链接和大小写变化不会扩大批准的目录。
- [ ] 命令会话授权考虑工作目录、参数边界及控制运算符，无法判定时单次审批。

## CHANGE 变更与回滚

可靠审查修改并保留用户已有工作

| ID | 功能 | 阶段 | 优先级 | 设计 | 实现 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| [CHANGE-01](roadmap.html#feature=CHANGE-01) | 轮次基线与持久快照 | M3 | P0 | 已有详细设计，待校正 | 未开始 | CORE-03, WS-04, CORE-06 |
| [CHANGE-02](roadmap.html#feature=CHANGE-02) | 修改来源与混合变更处理 | M3 | P0 | 已列范围，待细化 | 未开始 | CHANGE-01, OBS-03 |
| [CHANGE-03](roadmap.html#feature=CHANGE-03) | 文件列表与 Diff 审查 | M3 | P0 | 已有详细设计，待校正 | 未开始 | CHANGE-01 |
| [CHANGE-04](roadmap.html#feature=CHANGE-04) | 逐文件审查与混合处理终态 | M3 | P0 | 已列范围，待细化 | 未开始 | CHANGE-03 |
| [CHANGE-05](roadmap.html#feature=CHANGE-05) | 整文件与整轮回滚 | M3 | P0 | 已有详细设计，待校正 | 未开始 | CHANGE-02, CHANGE-03, SEC-09 |
| [CHANGE-06](roadmap.html#feature=CHANGE-06) | 代码块级回滚 | M6 | P1 | 已有详细设计，待校正 | 未开始 | CHANGE-05, CHANGE-07 |
| [CHANGE-07](roadmap.html#feature=CHANGE-07) | 后续修改、冲突与历史链 | M3 | P0 | 已列范围，待细化 | 未开始 | CHANGE-03 |
| [CHANGE-08](roadmap.html#feature=CHANGE-08) | 回滚范围、大小限制与快照保留 | M3 | P0 | 已列范围，待细化 | 未开始 | CHANGE-01 |
| [CHANGE-09](roadmap.html#feature=CHANGE-09) | 回滚记录与上下文一致性 | M3 | P0 | 已列范围，待细化 | 未开始 | CHANGE-05, CORE-06 |

### CHANGE-01 轮次基线与持久快照

在宿主定义的工作轮次前后记录可恢复的文件版本。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 基线在写入前成功；失败时暂停写入或经用户单次确认进入明示的不可回滚模式。
- [ ] 新一轮快照、失败和中止都有持久记录，不修改用户仓库的提交历史。

### CHANGE-02 修改来源与混合变更处理

将工具可确认的修改与外部、终端及其他运行修改分开表述。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 能够确认的文件修改关联工具和轮次，无法确认的来源显示未知或混合。
- [ ] 混合变更不得被整体宣称属于 agent，回滚前用户能看见将影响的外部修改。

### CHANGE-03 文件列表与 Diff 审查

展示新增、修改、删除、重命名及文件内差异。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 行数、类型和内容对应选中轮次，历史 Diff 不被当前文件静默替换。
- [ ] 非 Git 项目可使用独立账本，空轮次显示无文件变更。

### CHANGE-04 逐文件审查与混合处理终态

区分运行结果、审查进度与变更是否仍适用于当前文件。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 接受只记录保留决定，不改文件；后续修改不抹掉原审查决定。
- [ ] 一文件接受、一文件回滚后显示已处理 2/2，而非永久停在部分处理。

### CHANGE-05 整文件与整轮回滚

有冲突预检和操作记录的文件恢复能力。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 新增回滚删除、删除回滚恢复、重命名回滚恢复原名及内容，已有脏改动保留。
- [ ] 整轮任一文件冲突则预检失败整批不写，覆盖外部修改必须单独确认。

### CHANGE-06 代码块级回滚

在精确上下文匹配时撤销选定 hunk。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 只撤销选定代码块，其余保留内容逐字节不变。
- [ ] 上下文不匹配、重复回滚或已发生后续修改时不静默套用补丁。

### CHANGE-07 后续修改、冲突与历史链

记录文件版本链，区分后续修改、覆盖及外部冲突。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 后轮修改不同代码块时不谎称先前全部差异已消失，历史仍可查看。
- [ ] 旧轮次的回滚可用性与依赖版本明确，最新轮回滚后重新计算前轮可用性。

### CHANGE-08 回滚范围、大小限制与快照保留

让排除文件、大文件、二进制和过期快照的能力可见。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 审批与变更详情注明可回滚、部分可回滚及不可回滚范围，包括命令外部副作用。
- [ ] 未审查必要快照不静默回收；到达容量限制先提示，快照失效时禁用回滚并解释。

### CHANGE-09 回滚记录与上下文一致性

在会话保留回滚事实，让后续执行知道文件已经变化。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 记录目标、前后版本、结果和来源，恢复会话后仍能查到。
- [ ] 后续运行接收到简明的环境变更记录，不把文件回滚误当作消息历史也被撤销。

## FILE 文件与预览

在工作台内理解代码和查看产物

| ID | 功能 | 阶段 | 优先级 | 设计 | 实现 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| [FILE-01](roadmap.html#feature=FILE-01) | 文件树、快速打开与搜索 | M4 | P1 | 已列范围，待细化 | 未开始 | WS-01, SEC-10 |
| [FILE-02](roadmap.html#feature=FILE-02) | 代码阅读、行号与上下文引用 | M4 | P1 | 已列范围，待细化 | 未开始 | FILE-01 |
| [FILE-03](roadmap.html#feature=FILE-03) | 轻量文件编辑与保存冲突 | M6 | P1 | 已列范围，待细化 | 未开始 | FILE-02, CHANGE-02 |
| [FILE-04](roadmap.html#feature=FILE-04) | 图片、文档与产物预览 | M6 | P1 | 已列范围，待细化 | 未开始 | FILE-02, FILE-07 |
| [FILE-05](roadmap.html#feature=FILE-05) | 开发服务器与网页预览 | M6 | P1 | 已列范围，待细化 | 未开始 | EXEC-04, FILE-07 |
| [FILE-06](roadmap.html#feature=FILE-06) | 外部 IDE、文件管理器与系统打开 | M4 | P1 | 已列范围，待细化 | 未开始 | FILE-02 |
| [FILE-07](roadmap.html#feature=FILE-07) | 预览内容与宿主隔离 | M6 | P1 | 已列范围，待细化 | 未开始 | SEC-08, SEC-10 |

### FILE-01 文件树、快速打开与搜索

在授权范围内查找文件和查看目录结构。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 可区分仓库根、附加目录、忽略项和不可访问项，打开目标可定位。
- [ ] 大型目录按需加载，不因扫描 node_modules 等目录阻塞对话。

### FILE-02 代码阅读、行号与上下文引用

只读查看代码、搜索结果和工具关联文件。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 工具、Diff 和消息链接可跳到真实路径与行号，选区可加入输入。
- [ ] 二进制、编码异常或文件被删除时提供正确降级，不显示过期内容为当前内容。

### FILE-03 轻量文件编辑与保存冲突

支持小范围手动修改，并保留未保存状态和版本边界。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 保存前检测外部改写，冲突不静默覆盖；撤销、编码和换行规则可验证。
- [ ] 用户编辑标记为外部修改来源，切换文件和退出时草稿处理明确。

### FILE-04 图片、文档与产物预览

在工作台查看生成的图片、PDF、HTML 和其他支持的文件。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 每个预览显示文件路径和来源，可打开原件或下载。
- [ ] 类型不支持或文件超限时显示替代入口，不擅自向远端上传原件。

### FILE-05 开发服务器与网页预览

管理任务启动的本地预览服务及其页面。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 预览关联命令任务、端口和工作目录，启动失败能查看日志。
- [ ] 停止任务和关闭预览的区别明确，不意外暴露到局域网。

### FILE-06 外部 IDE、文件管理器与系统打开

从工作台定位代码和项目目录。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 打开操作使用校验后的路径与行号，可选择用户配置的 IDE。 默认优先 VS Code，允许更换；缺失提示选择其他程序，不替用户安装。
- [ ] 没有安装目标程序或路径失效时给出原因，不拼接不可信 shell 参数。

### FILE-07 预览内容与宿主隔离

隔离不可信 HTML、网页导航和下载。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 产物脚本不能读取会话凭证、控制本地服务或取得宿主文件权限。
- [ ] 外链、下载及外部协议跳转有明确边界与用户动作，预览失败不影响工作台。

## GIT Git 与 Worktree

隔离并行修改并完成版本交付

| ID | 功能 | 阶段 | 优先级 | 设计 | 实现 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| [GIT-01](roadmap.html#feature=GIT-01) | 仓库状态与本地改动概览 | M4 | P1 | 已列范围，待细化 | 未开始 | WS-03, CHANGE-03 |
| [GIT-02](roadmap.html#feature=GIT-02) | 创建独立 Worktree | M6 | P1 | 已列范围，待细化 | 未开始 | GIT-01, WS-04 |
| [GIT-03](roadmap.html#feature=GIT-03) | Worktree 初始化与环境配置 | M6 | P1 | 已列范围，待细化 | 未开始 | GIT-02, SEC-07, EXEC-04 |
| [GIT-04](roadmap.html#feature=GIT-04) | Worktree 列表、关联与切换 | M6 | P1 | 已列范围，待细化 | 未开始 | GIT-02 |
| [GIT-05](roadmap.html#feature=GIT-05) | Worktree 归档、恢复与清理 | M6 | P1 | 已列范围，待细化 | 未开始 | GIT-04, OPS-05 |
| [GIT-06](roadmap.html#feature=GIT-06) | 本地与 Worktree 交接 | M6 | P1 | 已列范围，待细化 | 未开始 | GIT-04, GIT-05, CHANGE-07 |
| [GIT-07](roadmap.html#feature=GIT-07) | 暂存、取消暂存与提交 | M6 | P1 | 已列范围，待细化 | 未开始 | GIT-01, GIT-10, SEC-02 |
| [GIT-08](roadmap.html#feature=GIT-08) | 分支、拉取与推送 | M6 | P1 | 已列范围，待细化 | 未开始 | GIT-07, SEC-06 |
| [GIT-09](roadmap.html#feature=GIT-09) | 合并、变基与冲突处理 | M6 | P1 | 已列范围，待细化 | 未开始 | GIT-08, FILE-03 |
| [GIT-10](roadmap.html#feature=GIT-10) | 按基线与暂存状态比较 Diff | M6 | P1 | 已列范围，待细化 | 未开始 | GIT-01, CHANGE-03 |

### GIT-01 仓库状态与本地改动概览

只读展示 staged、unstaged、untracked 与分支状态。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 状态与真实仓库一致，支持刷新并解释非 Git 或损坏仓库。
- [ ] 用户已有改动与 agent 变更独立标识，查看状态不写入 Git。

### GIT-02 创建独立 Worktree

从明确分支、提交或用户选择的工作状态开始隔离任务。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 创建前展示基线与是否复制未提交内容，实际目录和会话关联一致。
- [ ] 冲突、未初始化子模块或缺失基线时保持原目录完整，不丢弃用户改动。

### GIT-03 Worktree 初始化与环境配置

运行可信的项目设置脚本，处理依赖和未跟踪资源。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 创建后显示设置进度、成功或失败日志，失败可重试而不重复破坏已有状态。
- [ ] 忽略文件复制白名单、密钥排除和脚本信任有明确规则。

### GIT-04 Worktree 列表、关联与切换

管理任务对应的物理目录、分支和生命周期。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 会话始终显示当前执行目录，切换查看不会偷偷移动运行中的任务。
- [ ] 用户已有 Worktree 可校验后关联，活动与永久目录有清楚区别。

### GIT-05 Worktree 归档、恢复与清理

回收环境前保存可恢复的修改和必要引用。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 归档前列出未提交、未推送和未跟踪文件，必要忽略文件的处理明确。
- [ ] 恢复得到可读的代码与会话关系，正在运行、共享或受保护目录不能被误清理。

### GIT-06 本地与 Worktree 交接

将会话与代码安全迁移到另一工作副本。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 交接前停止相关执行、预检目标脏状态并展示冲突，失败可恢复原状态。
- [ ] 代码、分支和会话目录在交接后保持一致，忽略文件不被假定已经迁移。

### GIT-07 暂存、取消暂存与提交

提供用户明确发起的版本控制写操作。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 提交前可选择范围、查看实际 staged Diff 与提交信息，不包含隐藏的其他改动。
- [ ] 提交失败保留修改及可操作原因，不自动反复提交或补入额外文件。

### GIT-08 分支、拉取与推送

管理常见远端同步并说明将影响的目标。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 显示远端、分支和待推送提交，认证失败不泄露凭证。
- [ ] 强制推送、删除分支及可能覆盖本地内容的操作单独确认，不默认自动执行。

### GIT-09 合并、变基与冲突处理

为交付过程中的 Git 冲突提供可恢复流程。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 展示冲突文件、当前步骤与继续、放弃入口，操作结果可核对。
- [ ] 已有未提交改动有明确保护方式，流程中断后仍可恢复或退出。

### GIT-10 按基线与暂存状态比较 Diff

区分轮次 Diff、未提交改动、暂存改动和分支对比。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 每个视图标明比较双方与版本，文件已阅标记绑定当前展示版本。
- [ ] 切换基线不覆盖文件，也不会把旧版本审阅结果当作新版已经审阅。

## EXEC 终端与命令任务

独立执行、监控和停止本机命令

| ID | 功能 | 阶段 | 优先级 | 设计 | 实现 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| [EXEC-01](roadmap.html#feature=EXEC-01) | 工作区 PTY 终端与多标签 | M4 | P1 | 已有详细设计，待校正 | 未开始 | WS-01, UX-05 |
| [EXEC-02](roadmap.html#feature=EXEC-02) | 终端中断、关闭与退出 | M4 | P1 | 已有详细设计，待校正 | 未开始 | EXEC-01 |
| [EXEC-03](roadmap.html#feature=EXEC-03) | 多行粘贴与高危命令确认 | M4 | P1 | 已有详细设计，待校正 | 未开始 | EXEC-01 |
| [EXEC-04](roadmap.html#feature=EXEC-04) | 后台命令任务与日志 | M4 | P1 | 已有详细设计，待校正 | 未开始 | CORE-06, WS-01 |
| [EXEC-05](roadmap.html#feature=EXEC-05) | 任务并发、排队与停止 | M4 | P1 | 已有详细设计，待校正 | 未开始 | EXEC-04, WS-04 |
| [EXEC-06](roadmap.html#feature=EXEC-06) | 任务结果显式注入上下文 | M4 | P1 | 已有详细设计，待校正 | 未开始 | EXEC-04, INPUT-06, SEC-06 |
| [EXEC-07](roadmap.html#feature=EXEC-07) | 常用动作与环境命令 | M6 | P1 | 已列范围，待细化 | 未开始 | EXEC-04, SEC-07 |

### EXEC-01 工作区 PTY 终端与多标签

在明确目录启动真实交互式 shell。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 各标签工作目录、进程和缓冲独立，resize 与中文输入在目标平台可用。 Windows 默认优先发现可用 PowerShell 7，缺失提示并可选 Windows PowerShell；允许更换默认 Shell，仅新进程生效，不依赖开发工具私有运行时。
- [ ] 终端输出默认不进入 agent 上下文，切换会话不改变终端归属。

### EXEC-02 终端中断、关闭与退出

区分前台进程中断、销毁标签和停止整个服务。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 中断只影响指定进程组，关闭标签后相关子进程得到清理。
- [ ] 退出守护进程后终端停止，重新打开不假装恢复了旧进程。

### EXEC-03 多行粘贴与高危命令确认

让终端粘贴的实际执行内容可见。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 多行及明显高危粘贴显示完整预览与行数，取消后不执行。
- [ ] 确认只授权当前终端输入，不创建 agent 的会话级授权。

### EXEC-04 后台命令任务与日志

独立跟踪用户发起的构建、测试和开发服务。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 任务有命令、目录、状态、退出码、耗时和可追溯日志，前台界面关闭不被误认为任务已完成。
- [ ] 日志上限和截断范围明确，不因会话切换丢失运行记录。

### EXEC-05 任务并发、排队与停止

控制工作区资源并处理优雅中断和强制结束。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 达到并发上限时显示排队位置，可取消等待，写入任务遵守目录互斥。
- [ ] 停止先请求中断，再按明示时限强制结束；状态保留真实退出与强制终止原因。

### EXEC-06 任务结果显式注入上下文

只将用户选择的日志内容交给 agent。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 注入前展示命令、退出码和所选日志，确认后成为可见用户消息。
- [ ] 运行中注入遵循引导或追加规则，不静默提交完整日志或敏感信息。

### EXEC-07 常用动作与环境命令

保存可复用的构建、测试、启动和检查动作。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 动作显示命令、目录和配置来源，可手动触发并查看运行历史。
- [ ] 仓库提供的动作先经过信任检查，动作修改不会悄悄改变已确认的运行。

## MODEL 模型与配置

模型、凭证、配置、用量和上下文管理

| ID | 功能 | 阶段 | 优先级 | 设计 | 实现 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| [MODEL-01](roadmap.html#feature=MODEL-01) | 发现模型与已有提供商 | M2 | P0 | 已有详细设计，待校正 | 已验收 | CORE-04 |
| [MODEL-02](roadmap.html#feature=MODEL-02) | 提供商、端点与凭证配置 | M4 | P1 | 已列范围，待细化 | 未开始 | MODEL-01, SEC-06 |
| [MODEL-03](roadmap.html#feature=MODEL-03) | 模型与思考级别切换 | M2 | P0 | 已有详细设计，待校正 | 未开始 | MODEL-01 |
| [MODEL-04](roadmap.html#feature=MODEL-04) | 全局、项目与会话配置 | M4 | P1 | 已有详细设计，待校正 | 未开始 | MODEL-01, SEC-03 |
| [MODEL-05](roadmap.html#feature=MODEL-05) | 上下文、Token 与费用 | M4 | P1 | 已有详细设计，待校正 | 未开始 | MODEL-01, CORE-05 |
| [MODEL-06](roadmap.html#feature=MODEL-06) | 手动与自动上下文压缩 | M4 | P1 | 已有详细设计，待校正 | 未开始 | CORE-05, SESSION-02 |
| [MODEL-07](roadmap.html#feature=MODEL-07) | 错误、重试与限流策略 | M2 | P0 | 已有详细设计，待校正 | 未开始 | CORE-05, MODEL-01 |

### MODEL-01 发现模型与已有提供商

读取 pi 当前可用的模型及配置状态。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [x] 列表反映实际运行时能力，模型不可用时说明原因和配置入口。
- [x] 不把其他产品账号权益当成 pi 自动获得的 API 或订阅权限。

进展 / 阻塞：Electron 侧栏 / 原生菜单只读发现安装的 pi 1.4.0 目录与显式 PIW_PI_AGENT_DIR 配置，展示提供商、模型能力、文件来源 / 状态、默认模型匹配、本地认证与不可用原因。已配置与未联网验证分开，其他产品账号不推断为 pi 权益；真实传输关闭，不改配置、不执行认证 / 请求头命令或刷新 OAuth、不恢复动态缓存 / 加载扩展。网页独立流程暂缓，无安装包。实际 SDK / 文件 / HTTP / SQLite 及 Electron 来源、搜索 / 分批 / 明暗 / 键盘 / 断线恢复 / 迟到结果验证通过，原生菜单与刷新实际操作、三文件字节不变及无会话 / 运行时 / 信任 / 工作区记录已审计。完整 155 项 Vitest / 33 项浏览器与 Electron E2E、SDK 本地冒烟和新目录 frozen 复现通过，新增真实提供商请求 0。

验证证据：packages/shared/src/model-contracts.ts；packages/agent-adapter/src/model-discovery.ts；apps/daemon/src/modules/models/model.service.ts、modules/security/security.service.ts、bootstrap/app.ts；apps/web/src/features/settings/model-discovery.tsx、services/model-client.ts；apps/desktop/src/main.ts。apps/daemon/test/models.test.ts 9 项（含修复前失败 / 修复后通过的模型覆盖请求头回归），e2e/models.spec.ts 3 项；已纳入 test:contracts 与完整 CI。pnpm fix、pnpm run ci、pnpm verify:clean 均退出 0；frozen 安装 / 原生模块 / 构建 / 155 项测试 / SDK 冒烟 / 服务正常退出与锁 SHA-256 一致。docs/architecture/implementation-plan.md#model-01-已交付边界；docs/validation/model-01-evidence/ci.log、clean-workspace.json、clean-commands.json、native-validation.json、models-light.png、models-dark-800.png、native-models.jpg。模型 / 凭证为合成来源，HTTP 故障明确标注，账号与网络授权未验证；自动输入不作为人工 Windows IME 验收。历史预算与固定录制不变。

### MODEL-02 提供商、端点与凭证配置

配置受支持的服务、自定义端点和连接诊断。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 保存前能验证配置格式并测试连接，失败时保留原可用值。
- [ ] 密钥不进入普通配置导出，模型支持能力与认证方式来自实际提供商。

### MODEL-03 模型与思考级别切换

在会话中明确配置何时生效和哪些能力可用。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 空闲时切换立即生效，运行中对下一次模型请求生效并显示待生效状态。
- [ ] 不支持的级别或附件能力不能选择，切换失败不丢失原模型。

### MODEL-04 全局、项目与会话配置

明确继承优先级、修改范围与文件版本冲突。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 界面显示生效值、来源、覆盖关系及新会话或下一次请求生效时机。
- [ ] 外部配置修改后保存会检测冲突，损坏配置不被静默覆盖。

### MODEL-05 上下文、Token 与费用

展示上下文规模、输入输出及缓存用量和可用价格估算。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 统计按会话和轮次追溯，未知上限或价格明确显示未知而不猜测。
- [ ] 估算有价格来源与时间，缺少支持时只显示可验证计数，不当作实际账单。

### MODEL-06 手动与自动上下文压缩

可见地管理摘要、原始历史和压缩后上下文。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 压缩原因、前后规模和摘要可查看，原始记录仍可回看。
- [ ] 忙碌和审批期间手动压缩不可误触，失败后消息和队列保留且不虚报压缩成功。

### MODEL-07 错误、重试与限流策略

区分模型请求重试和工具副作用重试。

实现来源：pi 已有接口，待集成验证。负责人：未分配；目标日期：未估算。

- [ ] 展示脱敏原错误、次数、等待和中止入口，重试上限可查；倒计时仅来自权威等待期限，未知期限不编造，到点等待事件而不由 UI 自发重试。同一操作的推送错误和请求失败合并主要反馈，旧成功提示不冒充新操作结果。
- [ ] 模型请求重试不自动重复已完成工具，被拒绝动作不因切换模型重新放行。

## EXT 技能与扩展

接入可控、可诊断的工具和工作流

| ID | 功能 | 阶段 | 优先级 | 设计 | 实现 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| [EXT-01](roadmap.html#feature=EXT-01) | 技能发现、来源与调用 | M4 | P1 | 已列范围，待细化 | 未开始 | CORE-04, SEC-07 |
| [EXT-02](roadmap.html#feature=EXT-02) | 技能创建、编辑与管理 | M6 | P1 | 已列范围，待细化 | 未开始 | EXT-01, FILE-03 |
| [EXT-03](roadmap.html#feature=EXT-03) | MCP 连接与认证诊断 | M6 | P1 | 已列范围，待细化 | 未开始 | CORE-02, SEC-06, MODEL-04 |
| [EXT-04](roadmap.html#feature=EXT-04) | 工具发现、延迟加载与能力检查 | M6 | P1 | 已列范围，待细化 | 未开始 | EXT-03, OBS-03 |
| [EXT-05](roadmap.html#feature=EXT-05) | 扩展安装、启停与版本管理 | M6 | P1 | 已列范围，待细化 | 未开始 | SEC-07, MODEL-04 |
| [EXT-06](roadmap.html#feature=EXT-06) | 工作流插件包与本地来源 | M6 | P1 | 已列范围，待细化 | 未开始 | EXT-02, EXT-03, EXT-05 |
| [EXT-07](roadmap.html#feature=EXT-07) | 会话能力快照与重新加载 | M4 | P1 | 已有详细设计，待校正 | 未开始 | MODEL-04, EXT-01 |
| [EXT-08](roadmap.html#feature=EXT-08) | 扩展交互 UI 桥接 | M6 | P1 | 已列范围，待细化 | 未开始 | CORE-02, INPUT-08 |

### EXT-01 技能发现、来源与调用

展示当前用户、项目和扩展提供的实际技能。

实现来源：需要扩展或宿主编排。负责人：未分配；目标日期：未估算。

- [ ] 可查看技能说明、来源、作用范围和是否加载，显式调用留有记录；技能菜单与设置使用同一发现来源，磁盘发现、允许使用和当前内核实际加载分开显示，未加载项不能冒充当前可执行能力。
- [ ] 同名覆盖及不可信项目技能的行为明确，不把安装记录当作已生效。

### EXT-02 技能创建、编辑与管理

维护本地可复用的工作流说明和资源。

实现来源：需要扩展或宿主编排。负责人：未分配；目标日期：未估算。

- [ ] 编辑可校验格式、引用文件和作用范围，更新记录可追溯。
- [ ] 删除或禁用前显示影响，运行中的会话按能力快照保持一致。

### EXT-03 MCP 连接与认证诊断

管理 stdio、HTTP 等受支持连接及其凭证。

实现来源：需要扩展或宿主编排。负责人：未分配；目标日期：未估算。

- [ ] 连接状态、工具数量、错误、超时和重连可查看，配置能验证。
- [ ] SDK 模式显式加载所需 MCP 扩展，认证及嵌套调用仍经过权限裁决。

### EXT-04 工具发现、延迟加载与能力检查

在工具较多时清楚展示当前可用能力及加载状态。

实现来源：需要扩展或宿主编排。负责人：未分配；目标日期：未估算。

- [ ] 可按来源、用途和权限筛选，未加载工具可请求加载并显示结果。
- [ ] MCP 注解只作为提示，未知或嵌套工具不因注解绕过最终权限检查。

### EXT-05 扩展安装、启停与版本管理

管理 pi 扩展及项目执行资源的生命周期。

实现来源：需要扩展或宿主编排。负责人：未分配；目标日期：未估算。

- [ ] 安装前显示来源和将执行的资源，版本和启停状态可追溯。
- [ ] 失败可回退且不破坏既有会话，扩大权限需要明确用户决定。

### EXT-06 工作流插件包与本地来源

把技能、MCP、扩展和模板组织为可复用包。

实现来源：需要扩展或宿主编排。负责人：未分配；目标日期：未估算。

- [ ] 包的能力清单、版本和兼容范围可读，安装与卸载结果一致。
- [ ] 明确这是 Pi Workbench 包规范，不承诺直接兼容 Codex 的私有运行环境或账号授权。

### EXT-07 会话能力快照与重新加载

固定当前会话加载的技能、工具和配置版本。

实现来源：需要扩展或宿主编排。负责人：未分配；目标日期：未估算。

- [ ] 设置页能区分已保存、当前已生效和需重新加载 / 新建会话的能力，注明立即 / 下一轮 / 重建生效的范围；保存版本与当前内核能力快照可核对，失败不显示已生效。
- [ ] 更新不会热替换正在执行的工具；重新加载后版本与诊断一致。

### EXT-08 扩展交互 UI 桥接

支持扩展提供的选择、输入、确认和状态展示。

实现来源：需要扩展或宿主编排。负责人：未分配；目标日期：未估算。

- [ ] 支持的 UI 请求在桌面和网页都可完成或取消，结果只回传一次。
- [ ] 不支持的自定义 TUI 明确降级，不能让扩展无限等待或静默放行。

## REVIEW 代码审查与交付

从验证证据走到本地审查和 PR

| ID | 功能 | 阶段 | 优先级 | 设计 | 实现 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| [REVIEW-01](roadmap.html#feature=REVIEW-01) | 本地变更审查模式 | M6 | P1 | 已列范围，待细化 | 未开始 | GIT-10, INPUT-07 |
| [REVIEW-02](roadmap.html#feature=REVIEW-02) | 审查意见与代码定位 | M6 | P1 | 已列范围，待细化 | 未开始 | REVIEW-01 |
| [REVIEW-03](roadmap.html#feature=REVIEW-03) | 验证命令与证据记录 | M4 | P1 | 已列范围，待细化 | 未开始 | EXEC-04, CHANGE-03 |
| [REVIEW-04](roadmap.html#feature=REVIEW-04) | 创建或更新 Pull Request | M6 | P1 | 已列范围，待细化 | 未开始 | GIT-08, SEC-06, REVIEW-03 |
| [REVIEW-05](roadmap.html#feature=REVIEW-05) | PR、检查与反馈面板 | M6 | P1 | 已列范围，待细化 | 未开始 | REVIEW-04, GIT-10 |
| [REVIEW-06](roadmap.html#feature=REVIEW-06) | 检查失败与审查修复循环 | M7 | P1 | 已列范围，待细化 | 未开始 | REVIEW-05, MULTI-04, INPUT-09 |

### REVIEW-01 本地变更审查模式

对指定分支差异或未提交内容生成可追溯审查意见。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 启动前明确比较范围，审查过程默认不修改工作树。
- [ ] 输出每条意见的文件、位置、触发条件与证据，用户可定位。

### REVIEW-02 审查意见与代码定位

用严重性和当前版本组织行内意见及处理结果。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 意见绑定被审查版本，版本变化后明确标记需重新确认。
- [ ] 可接受、忽略或转修复任务，处理记录保留且不自动发布外部评论。

### REVIEW-03 验证命令与证据记录

将测试、检查、构建及手动验证结果关联到修改。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 记录实际命令、目录、退出码、时间和必要输出，可从变更追溯。
- [ ] 未运行、失败或证据过期时不显示验证通过，后续修改使相关结果需要重验。

### REVIEW-04 创建或更新 Pull Request

从选定分支准备可预览的 PR 标题、正文与修改范围。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 发布前展示目标仓库、分支、提交、标题与正文，创建后绑定会话。
- [ ] 认证失败或重复请求不产生重复 PR，不自动合并或部署。

### REVIEW-05 PR、检查与反馈面板

查看 PR 描述、Diff、评论及 CI 状态。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 显示检查和评论对应的提交版本，过期反馈能识别。
- [ ] 发布评论、批准、请求修改、合并等外部动作均由用户明确发起并展示结果。

### REVIEW-06 检查失败与审查修复循环

把确定的反馈转成任务并验证修复后的新版本。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 修复任务保留原始反馈、代码范围和最新验证证据。
- [ ] 达到重试、费用或时间上限时停下报告阻塞，不无限推送或反复改写 PR。

## MULTI 多 Agent 与计划

管理有边界的并行执行和结果汇总

| ID | 功能 | 阶段 | 优先级 | 设计 | 实现 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| [MULTI-01](roadmap.html#feature=MULTI-01) | 父子 Agent 与委派任务树 | M7 | P1 | 已列范围，待细化 | 未开始 | GIT-04, EXT-05 |
| [MULTI-02](roadmap.html#feature=MULTI-02) | 并行文件隔离与结果交付 | M7 | P1 | 已列范围，待细化 | 未开始 | MULTI-01, GIT-06 |
| [MULTI-03](roadmap.html#feature=MULTI-03) | 各 Agent 过程、消息与用量 | M7 | P1 | 已列范围，待细化 | 未开始 | MULTI-01, MODEL-05 |
| [MULTI-04](roadmap.html#feature=MULTI-04) | 全局并发、预算与级联中止 | M7 | P1 | 已列范围，待细化 | 未开始 | MULTI-01, EXEC-05 |
| [MULTI-05](roadmap.html#feature=MULTI-05) | 结果汇总与验证来源 | M7 | P1 | 已列范围，待细化 | 未开始 | MULTI-02, MULTI-03, REVIEW-03 |
| [MULTI-06](roadmap.html#feature=MULTI-06) | 计划依赖与人工调整 | M7 | P1 | 已列范围，待细化 | 未开始 | MULTI-01, MULTI-04 |

### MULTI-01 父子 Agent 与委派任务树

通过受控子会话分工，显示角色、输入和归属。

实现来源：需要扩展或宿主编排。负责人：未分配；目标日期：未估算。

- [ ] 每个子任务的目的、父任务、模型、工具范围和状态可查看。
- [ ] 委派不会自动扩大文件和网络权限，子任务失败与父任务失败的关系明确。

### MULTI-02 并行文件隔离与结果交付

为会修改文件的子任务提供独立 Worktree 或明确串行写入。

实现来源：需要扩展或宿主编排。负责人：未分配；目标日期：未估算。

- [ ] 多个写入任务不共享同一工作副本，变更和验证证据按任务归属。
- [ ] 结果合并先检查冲突和依赖，不把互相覆盖的修改静默合并。

### MULTI-03 各 Agent 过程、消息与用量

聚合观察子任务，必要时展开独立消息与工具。

实现来源：需要扩展或宿主编排。负责人：未分配；目标日期：未估算。

- [ ] 可从总览进入任一子任务的状态、调用、错误和产物。
- [ ] 并行日志不会串入其他任务，上下文与费用有明确统计边界。

### MULTI-04 全局并发、预算与级联中止

约束委派任务的运行资源和终止行为。

实现来源：需要扩展或宿主编排。负责人：未分配；目标日期：未估算。

- [ ] 并发、深度、时长和费用上限可设置，达到限制时明确排队或停止。
- [ ] 停止父任务后指定子进程被清理，保留已完成产物与未完成清单。

### MULTI-05 结果汇总与验证来源

汇总各任务产出并保留证据和未解决问题。

实现来源：需要扩展或宿主编排。负责人：未分配；目标日期：未估算。

- [ ] 父任务可区分完成、失败、被取消和结果待验证，不把子任务自述当作验收。
- [ ] 每个采用的结论或补丁保留来源，重跑只更新对应结果。

### MULTI-06 计划依赖与人工调整

把任务计划拆为有依赖和验收条件的步骤。

实现来源：需要扩展或宿主编排。负责人：未分配；目标日期：未估算。

- [ ] 依赖未满足时不会运行后续写入步骤，循环依赖被识别。
- [ ] 用户可暂停、调整和取消计划，调整后已有结果及待验证步骤仍可追溯。

## AUTO 自动化与持续任务

调度、跟进、运行历史和需要处理的结果

| ID | 功能 | 阶段 | 优先级 | 设计 | 实现 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| [AUTO-01](roadmap.html#feature=AUTO-01) | 周期任务与时区管理 | M7 | P1 | 已列范围，待细化 | 未开始 | OPS-05, EXEC-05 |
| [AUTO-02](roadmap.html#feature=AUTO-02) | 会话内持续跟进 | M7 | P1 | 已列范围，待细化 | 未开始 | AUTO-01, INPUT-09, UX-06 |
| [AUTO-03](roadmap.html#feature=AUTO-03) | 自动化执行环境与离线恢复 | M7 | P1 | 已列范围，待细化 | 未开始 | AUTO-01, GIT-03, CORE-06 |
| [AUTO-04](roadmap.html#feature=AUTO-04) | 运行历史与待处理收件箱 | M7 | P1 | 已列范围，待细化 | 未开始 | AUTO-01, SESSION-08, UX-06 |
| [AUTO-05](roadmap.html#feature=AUTO-05) | 无人值守授权与敏感动作策略 | M7 | P1 | 已列范围，待细化 | 未开始 | AUTO-01, SEC-05, SEC-09 |
| [AUTO-06](roadmap.html#feature=AUTO-06) | 外部事件触发与去重 | M8 | P2 | 已列范围，待细化 | 未开始 | AUTO-03, AUTO-05, REVIEW-05 |

### AUTO-01 周期任务与时区管理

创建、编辑、暂停和删除周期执行计划。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 可预览用户时区下的下次执行时间，夏令时和错过执行策略明确。
- [ ] 暂停后不触发新运行，删除计划与删除历史是独立动作。

### AUTO-02 会话内持续跟进

在同一会话中按条件检查进展并决定是否继续。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 每次运行保留原上下文，满足完成、失败或停止条件后停止跟进。
- [ ] 状态未变化时保持安静，只在有意义变化或需要用户处理时通知。

### AUTO-03 自动化执行环境与离线恢复

明确本地目录、独立 Worktree、睡眠和服务退出的行为。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 运行前校验目录、模型、凭证与可信设置，无法执行时记录具体原因。
- [ ] 唤醒或重启后的补跑按策略处理，同一计划不会产生重复副作用。

### AUTO-04 运行历史与待处理收件箱

集中查看每次自动化的产物、证据、错误和需要决定的事项。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 有结果的运行能跳到对应会话或变更，状态和时间清楚。
- [ ] 已读、重试、停止及归档动作有明确含义，不把等待审批当作成功。

### AUTO-05 无人值守授权与敏感动作策略

用预先授权范围约束自动运行中的工具和外部操作。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 无用户在线时，未授权或必须单次确认的动作阻塞或拒绝，不自动扩大权限。
- [ ] 可查看和撤销自动化的目录、网络及工具授权，审计包含计划与运行来源。

### AUTO-06 外部事件触发与去重

按明确授权的 GitHub 等事件启动任务。

实现来源：需独立可行性评估。负责人：未分配；目标日期：未估算。

- [ ] 触发源、条件、凭证和需要的外部权限在创建时可见。
- [ ] 重复、乱序和批量事件有去重与合并规则，失效认证不形成无限重试。

## UX 工作台体验

布局、键盘、通知与桌面交互

| ID | 功能 | 阶段 | 优先级 | 设计 | 实现 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| [UX-01](roadmap.html#feature=UX-01) | 面板、分屏与布局恢复 | M4 | P1 | 已列范围，待细化 | 未开始 | OBS-01, FILE-02, EXEC-01 |
| [UX-02](roadmap.html#feature=UX-02) | 命令面板与键盘操作 | M4 | P1 | 已列范围，待细化 | 未开始 | SESSION-03, OBS-02 |
| [UX-03](roadmap.html#feature=UX-03) | 主题、字号、密度与中文体验 | M4 | P1 | 已列范围，待细化 | 进行中 | OBS-01 |
| [UX-04](roadmap.html#feature=UX-04) | 无障碍与减弱动效 | M5 | P1 | 已列范围，待细化 | 未开始 | UX-02, SEC-02, CHANGE-05 |
| [UX-05](roadmap.html#feature=UX-05) | 桌面外壳、窗口与生命周期 | M2 | P0 | 已有详细设计，待校正 | 进行中 | CORE-05, CORE-06 |
| [UX-06](roadmap.html#feature=UX-06) | 完成、失败与待决定通知 | M5 | P1 | 已列范围，待细化 | 未开始 | OBS-02, SEC-02, SESSION-03 |

### UX-01 面板、分屏与布局恢复

采用已确认的 A 日常对话 + B 展开审查组合，按需组织会话、文件、Diff、终端与预览。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 日常对话使用 A 的阅读与内联过程布局，打开变更采用 B 的宽审查 / 轮次摘要，关闭回到日常布局，保留草稿、阅读位置和工具展开；用户可调整 / 关闭面板并恢复布局，各会话面板上下文独立，后台不抢焦点。
- [ ] 小窗口侧栏与面板可折叠，切换保留阅读 / 终端位置；自动收起 / 展开使用不同阈值避免边界抖动，手动收起保持到用户再次展开，输入 / 停止 / 审批入口仍可达。M1 有基础壳、M2 接真实对话，完整分屏 / 布局恢复仍在 M4 验收。

### UX-02 命令面板与键盘操作

在统一全局搜索入口发现会话与命令，提供快捷键和明确焦点路径；会话基础搜索先于完整命令目录交付。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 新建、切换、搜索、停止和打开面板可用键盘完成；统一搜索可区分会话结果与操作命令，M2 不因 M4 命令目录未完成而阻塞基础搜索。
- [ ] 模态关闭后焦点返回触发位置；快捷键不干扰输入法 / 文本编辑，不覆盖浏览器常用组合，待审批和窄窗也能到达停止入口。

### UX-03 主题、字号、密度与中文体验

默认跟随系统，明暗两套同等设计，中等密度；已确认界面 14 px、消息 15 px、辅助 12 px 的字号基线，并保留可配置展示。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 默认跟随系统且实时响应系统主题变化，也可显式选择明暗主题；明暗两套同等设计，主题、字号和密度设置持久保存，文字和状态有可读对比；冷启动 / 重启首帧不闪错主题，Electron 可控底色与应用主题协调。初始字号采用用户确认的界面 14 px / 消息 15 px / 辅助 12 px 基线，字号与缩放设置后续按 UX 验收。
- [ ] 中等密度为用户确认基线；在 1920×1080 @100% 主稿及窄窗口 / 放大场景下，中文、长路径、长工具名和大代码块不截断关键决定信息，代码区内部滚动而整页不横向溢出；1080 100% 的宽高解释保留为设计假设。

进展 / 阻塞：部分实现：统一外观 / 模型 / 凭证 / 客户端 / 信任 / 资源设置布局，主题跟随系统或显式明暗并持久化非敏感偏好，跨页与 Electron 窗口颜色同步；中性灰和 14 / 15 / 12 px 基线保留。1920×1080、800 px 桌面与 390 px 布局纳入离线 E2E。完整字号 / 密度可配置、真实会话和全部放大 / 中文场景未验收，依赖 OBS-01 尚未完成，两项验收继续不勾选。 PRD 可点击原型同步顶部栏、轨道、全页设置与窄窗导航；保留全部原型分类，设计不增加已验收数。Windows 原生菜单、Ctrl+逗号、明暗、最大化 / 还原、最小化恢复和 × 后服务保持已核对；空白区双击可最大化，自动拖动未观察到位移，真实拖动和托盘菜单恢复仍待人工确认。

验证证据：docs/design/core-spec.md 的 Electron 控制栏与统一设置；docs/architecture/implementation-plan.md#electron-控制栏与统一设置；apps/desktop/src/window-chrome.ts、apps/web/src/app/app-frame.tsx、features/settings/settings-shell.tsx / appearance.tsx；e2e/settings.spec.ts、e2e/desktop.spec.ts。；docs/validation/ui-shell-evidence（ci.log、clean-workspace.json、clean-commands.json、native-validation.json、prd-layout.json、实际应用与 PRD 截图）；完整 155 项 Vitest / 35 项浏览器与 Electron E2E、SDK 本地冒烟及 frozen 新目录复现通过；真实提供商请求 0。

### UX-04 无障碍与减弱动效

让辅助技术和放大场景也能完成核心旅程。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 键盘及屏幕阅读器可完成发任务、审批、查看变更和回滚。
- [ ] 焦点可见、状态不只靠颜色、流式更新不持续刷屏，减弱动效设置生效。

### UX-05 桌面外壳、窗口与生命周期

管理单实例、多窗口、深链接和退出语义。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 打开同一服务的新窗口共享权威状态，窗口身份和当前目录可确认；在 Electron 单独验证窗口按钮 / 焦点，若采用自绘标题栏，拖拽区域中的交互控件须排除拖拽命中，不能以网页检查代替桌面验证。
- [ ] 桌面 × 默认到托盘并保持任务 / 待审批；自启默认关。退出应用保存记录、取消待审批 / 排队，确认受管服务、Agent、命令及已接入终端停止后才完成，失败展示未停止对象；不误停独立 serve / CLI。浏览器关闭仅断开查看，独立服务显式退出；重启恢复记录但不自动重放队列 / 副作用或旧授权。

进展 / 阻塞：部分实现：40 px 桌面控制栏、Windows 原生窗口按钮、固定枚举菜单 / 主题桥、设置导航和返回保留上下文；原有 × 到托盘与显式退出保留。新增跨窗口身份 / 参数拒绝、主题和导航回归。完整多窗口共享业务、深链接、真实会话 / 审批 / 终端退出与异常对象提示尚未验收，两项验收继续不勾选。 PRD 可点击原型同步顶部栏、轨道、全页设置与窄窗导航；保留全部原型分类，设计不增加已验收数。Windows 原生菜单、Ctrl+逗号、明暗、最大化 / 还原、最小化恢复和 × 后服务保持已核对；空白区双击可最大化，自动拖动未观察到位移，真实拖动和托盘菜单恢复仍待人工确认。

验证证据：docs/design/core-spec.md 的 Electron 控制栏与统一设置；docs/architecture/implementation-plan.md#electron-控制栏与统一设置；apps/desktop/src/window-chrome.ts、apps/web/src/app/app-frame.tsx、features/settings/settings-shell.tsx / appearance.tsx；e2e/settings.spec.ts、e2e/desktop.spec.ts。；docs/validation/ui-shell-evidence（ci.log、clean-workspace.json、clean-commands.json、native-validation.json、prd-layout.json、实际应用与 PRD 截图）；完整 155 项 Vitest / 35 项浏览器与 Electron E2E、SDK 本地冒烟及 frozen 新目录复现通过；真实提供商请求 0。

### UX-06 完成、失败与待决定通知

在界面和系统通知中提示需要关注的任务。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 默认仅工作台在后台时发出需要审批 / 失败 / 完成三类系统通知，点击跳回正确会话或审批，不自动裁决；多端与多窗口去重。
- [ ] 默认通知只显示通用状态，不展示正文、会话标题或路径；可关闭或只保留待决定通知。系统禁用通知时保留应用内待办，不以通知送达作为任务完成条件。

## OPS 工程与发布

安装、升级、数据保护和持续验收

| ID | 功能 | 阶段 | 优先级 | 设计 | 实现 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| [OPS-01](roadmap.html#feature=OPS-01) | 仓库、共享领域模型与构建基线 | M1 | P0 | 已有详细设计，待校正 | 已验收 | CORE-01 |
| [OPS-02](roadmap.html#feature=OPS-02) | Windows 安装包与首次启动 | M5 | P1 | 已列范围，待细化 | 未开始 | CORE-08, UX-05, SEC-05 |
| [OPS-03](roadmap.html#feature=OPS-03) | macOS 与 Linux 支持 | M6 | P1 | 已列范围，待细化 | 未开始 | OPS-02, EXEC-02 |
| [OPS-04](roadmap.html#feature=OPS-04) | 升级、数据迁移与失败回退 | M5 | P1 | 已列范围，待细化 | 未开始 | OPS-02, OPS-05 |
| [OPS-05](roadmap.html#feature=OPS-05) | 存储用量、备份与恢复 | M5 | P1 | 已列范围，待细化 | 未开始 | CORE-06, CHANGE-08 |
| [OPS-06](roadmap.html#feature=OPS-06) | 诊断、日志与隐私控制 | M5 | P1 | 已列范围，待细化 | 未开始 | SEC-06, CORE-08 |
| [OPS-07](roadmap.html#feature=OPS-07) | 性能预算与大型项目降级 | M5 | P1 | 已列范围，待细化 | 未开始 | CORE-05, CHANGE-03, FILE-01 |
| [OPS-08](roadmap.html#feature=OPS-08) | 持续集成与可复现契约测试 | M1 | P0 | 已有详细设计，待校正 | 进行中 | CORE-01, CORE-02, CORE-03, OPS-01 |

### OPS-01 仓库、共享领域模型与构建基线

按用户确认建立 pnpm 单仓库：React 前端、NestJS + Fastify 本地服务、Drizzle / SQLite、SDK 适配层及 Electron 薄壳；先交付假内核和基础 UI 壳。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [x] 全新目录按文档可安装、类型检查、构建并启动 NestJS + Fastify 服务和 UI 壳；Node 24 兼容基线及依赖精确锁定，Drizzle 显式迁移、SQLite 原生模块与 SDK 子进程冒烟通过。 工作台数据根默认使用当前用户 %LOCALAPPDATA%\PiWorkbench，统一路径配置并为后续受控迁移保留入口；项目代码与原 pi 模型配置不搬迁。
- [x] apps / packages 和 Nest 领域模块边界明确；shared 契约 / reducer 不依赖 Nest、React 或 Node IO；新会话 / 运行 / 审批 / 错误 / 断线状态可评审，默认假内核且不消耗模型余额，UI 壳不提前验收产品功能。 开发验收默认离线；预算入口按里程碑累计最多新增 2 次底层请求、单次输出 512 token、失败不自动重试，先原子预占并保留失败 / 中止记录，不重置旧额度；离线验证边界与超限拒绝。新增真实调用前验证隐式回合 / 压缩 / 重试和提供商输出限制均受约束，不可可靠约束则使用标注来源的离线样本；政策与空记录不构成守卫完成证据。

进展 / 阻塞：R9 确认后建立 pnpm 单仓库与离线基础壳；Node 24.22.2 / TS 6.0.3 固定，干净安装与构建、SQLite 迁移、SDK 子进程、持久预算预占及浏览器 / Electron 通过。新增真实请求 0；真实提供商入口禁用，完整 M1 / M2 功能单独验收。 工程规范按用户要求迁移为 Oxlint / Oxfmt，完善类型感知、排序和保存配置；12 项单元 / 集成、6 项 E2E 与干净目录复验通过，模型请求仍为 0。

验证证据：docs/validation/ops-01-acceptance.md；docs/validation/ops-01-evidence/clean-workspace.json、clean-commands.json、checks.log；apps/daemon/test、packages/shared/src/reducer.test.ts、packages/agent-adapter/src/validation-budget.test.ts；e2e/*.spec.ts。11 项单元 / 集成与 6 项 E2E、SDK bootstrap、干净目录 frozen install / typecheck / build / start 通过。；后续规范迁移复验见 docs/validation/tooling-acceptance.md 与 docs/validation/tooling-evidence（完整 ci、类型规则反例、排序及 frozen 干净安装）。

### OPS-02 Windows 安装包与首次启动

交付包含必要运行时的可安装桌面程序。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 先交付 Windows 当前用户安装包，尽量无需管理员；干净机器上安装、选择项目、诊断和卸载有验证记录；便携版后续。
- [ ] pi、Git 或 shell 依赖缺失有明确处理，不要求用户猜测运行环境。

### OPS-03 macOS 与 Linux 支持

逐平台验证文件、终端、沙箱和分发行为。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 平台支持矩阵区分已验收、受限和未支持的能力。
- [ ] 安装、更新、路径、换行、进程停止及权限行为有各平台证据。

### OPS-04 升级、数据迁移与失败回退

在升级桌面和运行时前保护现有工作。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 默认 %LOCALAPPDATA%\PiWorkbench，设置支持后续受控数据迁移：任务空闲并暂停写入后，校验目标、空间、一致性、原生历史和管理路径重绑定，成功才原子切换启动位置；失败仍可使用原位置，不移项目 / 旧历史 / pi 配置，不自动删除原件。升级前检查任务和备份，迁移失败可恢复。
- [ ] 更新由用户手动检查、确认后执行；签名、来源和结果可核验，不在任务运行中静默重启。便携版后续交付，不作为首个安装包前提。

### OPS-05 存储用量、备份与恢复

管理会话、日志、快照和配置的磁盘生命周期。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 可查看分类占用、保留策略和清理影响，普通会话与未审查必要快照不自动删除；仅升级前自动备份，其余手动，可选择其他磁盘，无默认每日备份或 7 份轮转。
- [ ] 备份在一致性边界保存工作台数据库（含已提交 WAL 内容）、管理的 JSONL / 检查点、账本和独立目录必要产物，清单明确不包含的项目代码 / 外部历史 / 模型密钥。恢复先校验版本、完整性与引用并保护当前数据，不恢复授权或自动执行；失败原数据可用，升级前备份失败暂停升级。

### OPS-06 诊断、日志与隐私控制

收集本机可操作故障信息并支持脱敏诊断导出。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 诊断包括版本、运行状态和必要错误，导出前可预览，默认不含代码正文和密钥。
- [ ] 遥测和崩溃上传的开关及范围明确，默认不外发会话内容。

### OPS-07 性能预算与大型项目降级

定义并测量启动、流式、历史、搜索、Diff 和快照预算。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [ ] 测试样本、机器配置和指标可查，冷启动、长历史和大仓库有测量证据。
- [ ] 超出预算时使用可见分页、延迟加载或能力限制，不静默跳过应记录的修改。

### OPS-08 持续集成与可复现契约测试

提供假内核、真实事件样本和自动检查入口。

实现来源：工作台自行实现。负责人：未分配；目标日期：未估算。

- [x] 契约样本覆盖顺序、重复、缺口重同步、迟到终态、断线、错误、拒绝和中断；真实 SDK 样本和本地模拟来源分开标注，失败给出可定位差异。
- [ ] 每阶段绑定真实验收；随功能阶段扩充复用实际组件的离线场景，包含迟到响应、状态去重、未知工具 / 长输出及渲染失败，明确样本来源且不触发真实工具 / 提供商。M2 Chromium / Electron 检验 IME 发送、草稿、切换回看、改名、审批和双端重连，后续加入回滚与平台门禁，不以源码字符串断言替代用户交互。

进展 / 阻塞：M1 契约基线、CORE-05–07、SEC-06 / 07 / 08、WS-01、MODEL-01、SESSION-01 / 02 接入同一离线 CI；固定 SDK 录制、真实 SDK + 本地 HTTP / SQLite / TCP WS / Electron、合成工具 / 审批 / 变更及故障注入分别标记。SESSION-01 原子首发 / 幂等 / 草稿 / 失败恢复与真实 Windows 微软拼音已验收。SESSION-02 增加 5 项实际文件 / 服务测试、1 项循环 parent 防护及 4 项 Electron 流程，覆盖 3 视图 / 草稿 / 阅读与面板、后台同 PID / 重连 / 卸载恢复、迟到隔离及旧历史只读版本检查；长标题状态回归修复前失败 / 修复后通过。最终完整 170 项 Vitest / 44 项 E2E 与 SDK 冒烟通过，本次 frozen clean 通过，最终标题布局 / 草稿回执隔离 / 文档改动复用未变基础设施。原生 Windows 操作与脚本退出后审计错误如实保留，真实请求 0。第一项保持通过；第二项仍待生产业务审批 / 双端审批、M3 回滚及后续平台门禁，整体继续 in_progress，UX-03 / UX-05 等只部分实现。 淘汰旧草稿视图后重开并选择新目录，晚到旧校验回执不得覆盖新选择；回归修复前失败 / 修复后通过，挂载代际失效在视图卸载时生效。 SESSION-03 已验收：Electron 置顶 / 未读 / 归档由 daemon SQLite 持久保存，恢复不启动内核或旧授权；新完成 / 失败 / 中断结果标未读，仅活动窗口实际展示并读到最新才清除，支持手动标记。后台真实状态独立于视图，运行中归档先明确停止，等待服务确认后再次单独确认；取消归档保持同 SDK PID 继续运行。新增 7 项服务 / 5 项 Electron 流程，完整 179 项 Vitest / 49 项浏览器与 Electron E2E、SDK 冒烟通过；本次 frozen clean 通过，最后提示文案仅复用未变基础设施，完整 CI 已补跑。原生 Windows 重启持久 / 恢复 / 中段未读 / 后台停止归档及两次正常退出通过；真实请求 0，配置 / 预算未改，无安装包。OPS-08 第一项保持通过，第二项仍待生产业务审批 / 双端审批、M3 回滚与后续平台门禁。 2026-11-03 SESSION-11 新增 6 项实际 SQLite / SDK 本地 HTTP / TCP WS 服务测试与 4 项实际 Electron / 双端及只读浏览器流程；最终完整 185 项 Vitest / 53 项 E2E、SDK 冒烟、本次 frozen clean 通过。真实 Windows IME 后续原生补验已通过，最终状态及证据见本条末尾；OPS-08 继续进行中。 2026-11-03 SESSION-11 原生补验通过：真实微软拼音 Enter / Escape / Space 选词、预填 / 取消 / 写失败恢复 / 标题同步、重启人工来源与版本持久及两次正常退出已归档，三项勾选并标 verified。产品代码未改，230 文件与 clean 一致，复用 185 项 Vitest / 53 项 E2E、SDK / clean 门禁；真实请求 0。OPS-08 第二项仍待生产业务审批 / 双端审批、M3 回滚及后续平台门禁，整体继续进行中。 2026-11-03 WS-02 已验收：Electron 最近列表与自定义名由 daemon SQLite / 0007 迁移持久保存；成功显式打开 / 切换才更新最近顺序，同毫秒顺延，重命名 / 刷新 / 校验 / 重新定位不更新时间。最多展示 100 项及总数，旧库不伪造最近，standalone 内部登记不进入最近。Unicode 1–80 码点、预填 / Enter / Escape / IME、失败保留与 CAS 冲突处理通过。移除只隐藏最近，保留文件 / 身份 / 名称 / 项目 / 会话 / 当前窗口和后台任务；重新定位仅同物理目录且明确保存，不改既有会话 cwd，旧 cwd 不匹配时拒绝续发。新增 7 项实际目录 / SQLite / HTTP / SDK 本地服务测试与 4 项 Electron 流程；完整 192 项 Vitest / 57 项 E2E、SDK 冒烟及本次 frozen clean 通过。25 步原生 Windows / 微软拼音 / 真实选择器、失败恢复、同 PID 后台任务、同 data/profile 重启和两次正常菜单退出已补证。原生首段 hold 约 300 秒后 terminated，后续明确本地启动 / 停止分别记录，不冒充一轮贯穿；真实提供商请求 0，pi 配置 / canonical 预算未改，无安装包，网页独立操作暂缓。 OPS-08 第一项保持通过，第二项仍待生产业务审批 / 双端审批、M3 回滚及后续平台门禁，整体继续 in_progress。 2026-11-03 WS-06 已验收：新增9项实际SQLite/目录/HTTP/SDK本地服务测试及6项Electron流程，覆盖项目持久整理、默认仅未来生效、独立目录、CAS/失败/创建幂等墓碑、迟到准入、原子解散归无项目及运行中同PID/cwd保留。完整201项Vitest/63项E2E、SDK冒烟、本次frozen clean通过；实际Windows微软拼音、未拦截选择器、失败恢复、同PID后台、同data/profile重启和两次正常菜单退出补证。首段hold到时terminated与后续单独本地轮次分开记录；真实请求0、配置/预算未改，无安装包。OPS-08第一项保持通过，第二项仍待生产业务审批/双端审批、M3回滚及平台门禁，整体继续in_progress。 2026-11-04 SESSION-12 已验收：8 项实际 SQLite / v3 JSONL / HTTP / SDK 本地服务与 4 项 Electron 流程，完整 209 项 Vitest / 67 项 E2E、SDK 冒烟、frozen clean 通过。真实 Windows IME、原生筛选 / 脱敏 / 消息定位 / 失败恢复 / 索引刷新 / 同 PID 后台状态 / 明暗窄窗 / 重启搜索及两次正常退出补证；270 文件与 clean 一致，原生后复用门禁。主动归属迁移 / 删除仍只以明确夹具验证搜索消费边界；真实提供商请求 0，配置 / 预算未改，无安装包。OPS-08 第二项继续待生产业务审批 / 双端审批、M3 回滚及平台门禁，整体 in_progress。 WS-03 新增真实 Git／cwd 观察的8项服务及5项Electron自动回归，完整217项Vitest／72项E2E和frozen clean通过；28步原生Windows补验、重启与两次正常退出已通过，277文件与clean一致，原生后复用门禁；WS-03两项勾选并verified。OPS-08第二项继续待生产审批／双端审批、M3回滚及平台门禁，整体保持in_progress。 INPUT-01 两项新增 Electron 回归与27条原生观察通过；复用未变产品运行时门禁，真实提供商0。OPS-08整体继续in_progress。 2026-11-04 SESSION-07三项验收通过，6项真实服务与4项Electron流程、0010迁移／来源／归属CAS／能力边界／迟到隔离纳入同一门禁，INPUT-01两项新回归同时覆盖。最终完整223项Vitest／78项E2E、SDK与frozen clean通过；29条原生观察、后台同PID／epoch／cwd、明暗窄窗、重启0内核／0重发及两次正常退出已补证，282文件与clean一致。SESSION-13只交付整理归属子集，OPS-08第二项仍待生产业务审批／双端审批、M3回滚及平台门禁，整体保持in_progress。真实提供商0。 WS-07增量已验收：230项Vitest／82项E2E、SDK与frozen clean；68条原生观察／同profile重启／两次正常退出补证。288代码文件一致后复用门禁。生产业务审批／双端审批、M3回滚及平台门禁仍未完成，整体in_progress。真实提供商0。 OBS-01增量：238项Vitest／86项E2E、SDK和frozen clean通过；Windows原生富文本／长消息／明暗主题／重启与正常退出补证；生产审批与M3回滚继续待验收。 OBS-04 增量已验收：2 项 Vitest／4 项实际 Electron 回归加入完整 240／90 门禁，SDK 与 frozen clean 通过；60 条原生观察、同 PID／epoch 后台、分页／缓存阅读恢复、明暗窄窗、重启 0 请求及两次正常退出补证，304 文件一致后复用。合成审批只验证观察与焦点，不代表生产审批执行；第二项仍待生产／双端审批、M3 回滚及平台门禁，整体 in_progress。 OBS-03 增量：OBS-03 自动门禁：完整 35 文件／251 项 Vitest、93 项浏览器及 Electron E2E 和 SDK 冒烟通过；本次 frozen clean 安装／check／build／251 项测试／SDK／健康检查及正常服务退出通过，锁哈希一致。新增 11 项 Vitest、3 项实际 Electron 回归，嵌套／拒绝／取消／MCP／Diff 为明确合成观察；真实 SDK 禁用工具错误单独验证。原生控制尚未进行，仍为 in_review、两项未勾选，本地完成数 26 / 133，OPS-08 继续 in_progress。 OBS-03 已验收：完整 35 文件／251 项 Vitest、93 项浏览器及 Electron E2E、SDK 冒烟与 frozen clean 通过；Windows 原生工具身份／摘要／长输出脱敏与收起、跨会话及逐轮展开隔离、后台同 PID／epoch 和焦点、明暗 802px 窄窗、同 data/profile 只读重启 0 内核／0 新发送／0 注入、历史哈希不变及正常菜单退出已补证。316 文件与 CI／clean 一致，原生后复用门禁；仅文档模板另更新。两项勾选，当前本地 27 / 133，OPS-08 继续 in_progress。合成工具观察与真实 SDK 禁用工具错误分开，未开启生产工具／审批／MCP／回滚；真实提供商 0，配置／预算／锁未改。

验证证据：docs/development/tooling.md 的 OPS-08 契约回归门禁（来源、阶段矩阵及限制）；packages/agent-adapter/test/contracts/recordings.json、src/contracts.test.ts、src/kernel.test.ts；packages/shared/src/reducer.ts、reducer.test.ts；e2e/contracts.spec.ts；apps/web/src/app/scene-content.tsx、workbench.tsx、services/api.ts。pnpm fix、pnpm run ci、pnpm verify:clean 退出 0，完整 85 项 Vitest / 12 项浏览器与 Electron E2E、SDK 本地流式 / 中止 / dispose、干净目录 frozen 安装 / 构建 / 启停通过且锁文件 SHA-256 一致。原始输出及复核截图 docs/validation/ops-08-evidence（ci.log、clean-workspace.json、clean-commands.json、contract-*.png）。真实预算账本与历史证据未改。；CORE-05 后续扩充见 docs/architecture/implementation-plan.md 的 CORE-05 已交付边界、docs/validation/core-05-evidence、packages/shared/src/runtime-contracts.test.ts、apps/daemon/test/events.test.ts、e2e/runtime.spec.ts。；CORE-06 扩充见 docs/architecture/implementation-plan.md 的 CORE-06 已交付边界、docs/validation/core-06-evidence、packages/agent-adapter/src/native-history.test.ts、apps/daemon/test/sessions.test.ts、e2e/history.spec.ts。；CORE-07：apps/daemon/test/resources.test.ts、e2e/resources.spec.ts、docs/architecture/implementation-plan.md#core-07-已交付边界、docs/validation/core-07-evidence/ci.log 与 clean-workspace.json。；SEC-06：packages/shared/src/redaction.test.ts、apps/daemon/test/security.test.ts、e2e/security.spec.ts、docs/architecture/implementation-plan.md#sec-06-已交付边界与 docs/validation/sec-06-evidence（CI / clean / 实际页面截图）。；SEC-08：apps/daemon/test/access.test.ts、e2e/access.spec.ts / desktop.spec.ts、docs/architecture/implementation-plan.md#sec-08-本机客户端授权边界及 docs/validation/sec-08-evidence（CI / clean / 实际页面截图）。；SEC-07：apps/daemon/test/trust.test.ts、e2e/trust.spec.ts / desktop.spec.ts、docs/architecture/implementation-plan.md#sec-07-已交付边界及 docs/validation/sec-07-evidence（CI / clean / 实际页面截图）。；WS-01：apps/daemon/test/workspaces.test.ts、e2e/workspaces.spec.ts、docs/architecture/implementation-plan.md#ws-01-已交付边界及 docs/validation/ws-01-evidence。；MODEL-01：apps/daemon/test/models.test.ts、e2e/models.spec.ts、docs/architecture/implementation-plan.md#model-01-已交付边界及 docs/validation/model-01-evidence（CI / clean / 原生审计 / 实际 Electron 截图）；155 项 Vitest / 33 项 E2E，真实请求 0。；桌面布局与 PRD 同步：docs/validation/ui-shell-evidence（ci.log、clean-workspace.json、clean-commands.json、native-validation.json、prd-layout.json、实际应用与 PRD 截图）；完整 155 项 Vitest / 35 项浏览器与 Electron E2E、SDK 本地冒烟及 frozen 新目录复现通过；真实提供商请求 0。；SESSION-01 候选：docs/validation/session-01-evidence/acceptance.md、ci.log、clean-workspace.json、clean-commands.json；apps/daemon/test/session-creation.test.ts；e2e/session-creation.spec.ts。完整 164 项 Vitest / 40 项浏览器与 Electron E2E、SDK 本地冒烟及 frozen 干净目录复现通过，锁哈希一致，真实提供商请求 0。；SESSION-01 原生补验与目录修复：docs/validation/session-01-evidence/native-validation.json、native-final-audit.json、ci-native-followup.log、directory-regression-before.log、directory-regression-after.log；原生微软拼音与合成 composition 分开记录，最终 CI 164 / 40、SDK 冒烟通过，clean 仅复用未变基础设施，真实请求 0。；SESSION-02：docs/validation/session-02-evidence/acceptance.md、ci-final.log、clean-workspace.json、native-validation.json、native-final-audit.json、sidebar-before.log / sidebar-after.log；apps/daemon/test/legacy-history.test.ts、e2e/session-switching.spec.ts / history.spec.ts。完整 170 项 Vitest / 44 项 E2E、SDK 冒烟通过，新增真实请求 0；原生临时脚本收尾退出 1 与产品操作结果分开记录。；目录回执隔离补验 docs/validation/session-02-evidence/directory-before.log / directory-after.log；纳入既有迟到 Electron 用例，测试总数不变。；SESSION-03：docs/validation/session-03-evidence/acceptance.md、ci-native-followup.log、clean-workspace.json、native-validation.json、native-final-closed.json；apps/daemon/test/session-organization.test.ts、e2e/session-library.spec.ts；完整 179 项 Vitest / 49 项 E2E、SDK 冒烟及 frozen clean 通过，真实请求 0。；SESSION-11：docs/validation/session-11-evidence/acceptance.md、ci-complete.log、clean-workspace.json、native-validation.json、native-steps.json、native-final-closed.json、native-code-reuse-audit.json；真实 OS 输入法与合成事件分开标记。；WS-02：docs/validation/ws-02-evidence/acceptance.md、ci.log、clean-workspace.json、native-validation.json、native-steps.json、native-final-closed.json、native-code-reuse-audit.json；apps/daemon/test/workspace-recents.test.ts；e2e/workspace-recents.spec.ts；192 项 Vitest / 57 项 E2E，真实请求 0。；WS-06：docs/validation/ws-06-evidence/acceptance.md、ci.log、clean-workspace.json、native-validation.json、native-steps.json、native-final-closed.json、native-code-reuse-audit.json；apps/daemon/test/project-organization.test.ts、e2e/project-organization.spec.ts；201项Vitest/63项E2E，真实提供商请求0。；SESSION-12：docs/validation/session-12-evidence/acceptance.md、ci-complete.log、clean-workspace.json、native-validation.json、native-observations.json、native-final-closed.json、native-code-reuse-audit.json；apps/daemon/test/session-search.test.ts、e2e/session-search.spec.ts。；WS-03：docs/validation/ws-03-evidence/acceptance.md、ci.log、clean-workspace.json、code-reuse-audit.json；apps/daemon/test/workspace-environment.test.ts、e2e/workspace-environment.spec.ts。原生补验见同目录native-observations.json、native-final-closed.json、native-code-reuse-audit.json；WS-03 verified，OPS-08继续进行。；SESSION-07：docs/validation/session-07-evidence/acceptance.md、ci.log、clean-workspace.json、native-validation.json、native-code-reuse-audit.json；INPUT-01新增两项回归已包含于本次223／78门禁。；WS-07：docs/validation/ws-07-evidence/acceptance.md、validation.json、ci.log、clean-workspace.json、code-reuse-audit.json；原生68条观察、重启不重发及两次正常退出已补证。；docs/validation/obs-01-evidence/acceptance.md。；docs/validation/obs-04-evidence/acceptance.md、validation.json、native-validation.json、code-reuse-audit.json；e2e/scroll-reading.spec.ts。；docs/validation/obs-03-evidence/acceptance.md、validation.json、ci.log、native-validation.json；e2e/tool-timeline.spec.ts。

## REMOTE 远程与协作扩展

跨主机执行与协作的可选产品线

| ID | 功能 | 阶段 | 优先级 | 设计 | 实现 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| [REMOTE-01](roadmap.html#feature=REMOTE-01) | 局域网访问与远程终端 | M8 | P2 | 已列范围，待细化 | 未开始 | SEC-05, SEC-08, SEC-10 |
| [REMOTE-02](roadmap.html#feature=REMOTE-02) | SSH 与远程开发主机 | M8 | P2 | 已列范围，待细化 | 未开始 | GIT-03, CORE-08 |
| [REMOTE-03](roadmap.html#feature=REMOTE-03) | 云端隔离运行环境 | M8 | P2 | 已列范围，待细化 | 未开始 | REMOTE-02, AUTO-05 |
| [REMOTE-04](roadmap.html#feature=REMOTE-04) | 账号与跨设备会话同步 | M8 | P2 | 已列范围，待细化 | 未开始 | REMOTE-01, OPS-05 |
| [REMOTE-05](roadmap.html#feature=REMOTE-05) | 团队空间、权限与共享审查 | M8 | P2 | 已列范围，待细化 | 未开始 | REMOTE-04, SEC-09 |
| [REMOTE-06](roadmap.html#feature=REMOTE-06) | 移动端查看与有限审批 | M8 | P2 | 已列范围，待细化 | 未开始 | REMOTE-01, SEC-02 |

### REMOTE-01 局域网访问与远程终端

在独立安全评审后开放跨设备访问本机服务。

实现来源：需独立可行性评估。负责人：未分配；目标日期：未估算。

- [ ] 访问地址、加密、设备身份、令牌撤销和防火墙边界明确，默认不开启。
- [ ] 终端与 agent 控制分别授权，关闭访问后立即终止相关客户端能力。

### REMOTE-02 SSH 与远程开发主机

把执行、文件与工具放在明确的远程主机上。

实现来源：需独立可行性评估。负责人：未分配；目标日期：未估算。

- [ ] 会话显示主机、目录和实际执行位置，掉线后状态可恢复或说明未知。
- [ ] 凭证、端口转发、权限及产物取回有明确规则，不把本机与远端文件混淆。

### REMOTE-03 云端隔离运行环境

评估容器或远端执行器的调度和资源管理。

实现来源：需独立可行性评估。负责人：未分配；目标日期：未估算。

- [ ] 任务的镜像、资源、网络、密钥、成本和产物保留可见。
- [ ] 销毁环境前保存必要结果，断线和超时不会重复执行已完成的外部副作用。

### REMOTE-04 账号与跨设备会话同步

评估加密同步和执行环境间继续任务的能力。

实现来源：需独立可行性评估。负责人：未分配；目标日期：未估算。

- [ ] 明确哪些历史和附件上传，文件权限不因同步扩大。
- [ ] 同一会话的执行主机唯一且可见，设备撤销和离线冲突有处理规则。

### REMOTE-05 团队空间、权限与共享审查

评估多用户协作、工作区角色和共享资源。

实现来源：需独立可行性评估。负责人：未分配；目标日期：未估算。

- [ ] 共享范围、操作者身份、凭证使用者及审批责任明确。
- [ ] 成员移除后访问立即按规则撤销，操作与费用可归因。

### REMOTE-06 移动端查看与有限审批

评估小屏查看任务、引导和处理待决定事项。

实现来源：需独立可行性评估。负责人：未分配；目标日期：未估算。

- [ ] 移动页面展示任务真实执行主机，审批信息足够完整且不会误触默认放行。
- [ ] 断线、过期决定和远端状态变化时重新校验，不声称手机上有本机执行环境。

## EXTRA 浏览器与多模态扩展

搜索、操作和更多输入输出的可选能力

| ID | 功能 | 阶段 | 优先级 | 设计 | 实现 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| [EXTRA-01](roadmap.html#feature=EXTRA-01) | 网页搜索、读取与来源引用 | M8 | P2 | 已列范围，待细化 | 未开始 | EXT-03, SEC-10 |
| [EXTRA-02](roadmap.html#feature=EXTRA-02) | 浏览器操作与页面验证 | M8 | P2 | 已列范围，待细化 | 未开始 | EXT-03, FILE-07, SEC-05 |
| [EXTRA-03](roadmap.html#feature=EXTRA-03) | 桌面应用与计算机操作 | M8 | P2 | 已列范围，待细化 | 未开始 | SEC-05, SEC-09, EXT-08 |
| [EXTRA-04](roadmap.html#feature=EXTRA-04) | 语音输入与转写 | M8 | P2 | 已列范围，待细化 | 未开始 | INPUT-01 |
| [EXTRA-05](roadmap.html#feature=EXTRA-05) | 实时语音与任务协同 | M8 | P2 | 已列范围，待细化 | 未开始 | EXTRA-04, OBS-02, SEC-02 |
| [EXTRA-06](roadmap.html#feature=EXTRA-06) | 图像、文档与数据产物工具 | M8 | P2 | 已列范围，待细化 | 未开始 | FILE-04, EXT-06 |

### EXTRA-01 网页搜索、读取与来源引用

通过受支持工具搜索公开资料并在结果中保留引用。

实现来源：需独立可行性评估。负责人：未分配；目标日期：未估算。

- [ ] 引用能对应实际读取的来源和时间，搜索摘要不被冒充完整原文。
- [ ] 网络能力、凭证及页面不可信指令遵守统一权限边界。

### EXTRA-02 浏览器操作与页面验证

接入独立浏览器会话、DOM 和截图等能力。

实现来源：需独立可行性评估。负责人：未分配；目标日期：未估算。

- [ ] 明确浏览器身份、页面和操作结果，可由用户接管或停止。
- [ ] 登录、外部提交和下载遵守用户授权，页面内容不能改变工具权限。

### EXTRA-03 桌面应用与计算机操作

通过平台适配器控制用户明确授权的桌面应用。

实现来源：需独立可行性评估。负责人：未分配；目标日期：未估算。

- [ ] 输入、截图、窗口目标和应用权限可追溯，用户可立即中止。
- [ ] 凭证变更、权限扩大等关键动作有明确交接或确认规则，失败不盲目连续操作。

### EXTRA-04 语音输入与转写

把语音转换成可审阅的任务输入。

实现来源：需独立可行性评估。负责人：未分配；目标日期：未估算。

- [ ] 转写结果可在发送前修改，麦克风状态和录音结束可见。
- [ ] 权限拒绝、转写失败及噪声不会自动发送错误任务。

### EXTRA-05 实时语音与任务协同

评估语音交谈、任务状态播报和打断控制。

实现来源：需独立可行性评估。负责人：未分配；目标日期：未估算。

- [ ] 会话、语音与工具执行状态同步，用户可以停止播报与任务。
- [ ] 语音内容涉及工具授权时保留可回看的明确决定，不把模糊应答当作高风险许可。

### EXTRA-06 图像、文档与数据产物工具

通过可选模型或插件生成并预览更多文件类型。

实现来源：需独立可行性评估。负责人：未分配；目标日期：未估算。

- [ ] 可用能力、模型要求、成本来源和输出路径明确，结果能在安全预览中打开。
- [ ] 无法生成或渲染时显示真实限制，不承诺与其他产品专有模型或服务直接等价。

## 进度说明

CORE-01–03 的 M0 技术验证、OPS-01 工程 / 离线 UI 基线、CORE-04 受管 SDK 内核、CORE-05 事件 / 快照 / WS 重放、CORE-06 持久化 / 故障恢复、CORE-07 进程池 / 资源排队、SEC-06 原生凭证边界 / 统一脱敏、SEC-07 资源来源 / 指纹信任、SEC-08 本机客户端配对 / 撤销及 WS-01 桌面工作区打开 / 校验 / 切换已验收。OPS-08 已绑定 M1 基线与 CORE-05–07 / SEC-06 / 07 / 08 / WS-01 回归，整体随其余 M2 真实业务及后续回滚 / 平台门禁继续进行。浏览器首页及 Electron ?samples 为假内核样本，另有只读实时观察、历史 / 中断恢复、资源与凭证状态、配对及资源信任管理页；SDK 使用本地夹具，工具与真实提供商禁用。资源信任跨重启保存，变化后重新确认，仅已确认文本可加载，原生扩展 / 脚本 / 安装仍禁用。合成审批 / 分片 / 检查点及工作台记录不等于生产审批完成；浏览器凭证写入仍关闭，终端仅预留预算，真实 PTY 在 M4 验收。 WS-01 以实际物理目录身份去重，目录失效 / 权限不足不创建空会话；切换不停止后台任务，也不自动信任或执行项目资源。已核对真实 Windows 目录选择器；该次未包含最近 / 重命名，WS-02 的后续验收见本次记录，网页独立工作区操作暂缓，尚无安装包。 MODEL-01 已验收：Electron 只读展示安装 SDK 及显式 pi 配置的模型 / 提供商 / 能力 / 来源和默认模型匹配，已配置与未联网验证分开，不推断其他产品账号权益；真实传输关闭，不改配置、不执行认证命令 / OAuth 刷新或额外调用模型。实际 SDK / 原生文件 / HTTP 与 Electron / Windows 原生菜单审计通过，配置字节不变，不创建会话、授信或登记工作区。动态模型缓存和外部扩展不加载，网页独立模型流程暂缓；OPS-08 随其余真实会话及后续门禁继续进行，SESSION-01 的后续验收见本次记录。 2026-11-02 按用户提供的 Codex 截图优化 Electron 控制栏与统一设置，关联 UX-03 / UX-05 部分实现；保留原生窗口按钮、离线样本来源、配对和真实传输限制，尚未验收完整字号 / 密度、多窗口 / 深链接及真实业务生命周期，已验收功能数不变。 2026-11-03 SESSION-01 已验收：SQLite 原子首发 / 幂等、明确模型与 cwd、草稿 / 刷新 / 设置返回、已知失败明确重试及未知中断不重放进入真实 SDK + 本地 HTTP / SQLite / Electron 回归；本轮补齐真实 Windows 微软拼音、原生首发 / 同会话续发、草稿 / 设置返回、目录 / 明暗 / 窄窗。修复同项目新草稿重入丢失所选目录，回归修复前失败 / 修复后通过，完整 164 项 Vitest / 40 项 E2E 与 SDK 冒烟重新通过；原 clean 复用未变的依赖 / 原生模块 / 构建与启停证据，锁哈希一致。四项验收全部勾选，真实提供商新增请求 0，pi 配置未改。WS-06 / SESSION-07 / 10 / INPUT-01 仅记录相关部分实现；OPS-08 整体继续 in_progress，SESSION-02 后续验收见本次记录。 2026-11-03 SESSION-02 已验收：Electron 每会话草稿 / 阅读锚点与偏移 / 工具展开 / 面板上下文，最多 3 个视图，卸载只释放观察，后台 SDK 任务在淘汰 / WS 重连 / renderer 刷新后保持同一 PID 且不重复发送；迟到响应隔离。显式 PIW_PI_AGENT_DIR/sessions 旧历史有界只读发现、稳定版本分页 / 全文、半行与损坏诊断；不迁移、续聊或恢复授权。新增 5 项服务 / 1 项循环引用测试及 4 项 Electron 流程，最终完整 170 项 Vitest / 44 项 E2E 与 SDK 冒烟通过；本次 frozen clean 通过，收尾仅前端标题状态布局、草稿回执隔离和文档变动，未变基础设施证据复用。Windows 原生草稿 / 阅读恢复 / 设置主题 / 后台 PID / 旧历史分页已补证；临时宿主退出后读取已关闭 SQLite 导致脚本退出 1，原日志与关闭前审计保留，不计为脚本成功。真实提供商请求 0、预算 / pi 配置未改、无安装包；OPS-08 继续 in_progress；SESSION-03 后续验收见本次记录。 2026-11-03 SESSION-03 已验收：Electron 置顶 / 未读 / 归档由 daemon SQLite 持久保存，恢复不启动内核或旧授权；新完成 / 失败 / 中断结果标未读，仅活动窗口实际展示并读到最新才清除，支持手动标记。后台真实状态独立于视图，运行中归档先明确停止，等待服务确认后再次单独确认；取消归档保持同 SDK PID 继续运行。新增 7 项服务 / 5 项 Electron 流程，完整 179 项 Vitest / 49 项浏览器与 Electron E2E、SDK 冒烟通过；本次 frozen clean 通过，最后提示文案仅复用未变基础设施，完整 CI 已补跑。原生 Windows 重启持久 / 恢复 / 中段未读 / 后台停止归档及两次正常退出通过；真实请求 0，配置 / 预算未改，无安装包。修复旧历史完整消息被流式脱敏吞后缀及 fetch 禁用端口夹具问题，修复前失败 / 修复后通过；旧偶发失败的确切根因不作无证据推断。SESSION-03 两项均勾选，OPS-08 仍进行中；SESSION-11 后续验收见本次记录。 2026-11-03 SESSION-11 已验收：Electron 重命名 / Unicode 码点校验、失败保留 / CAS 冲突、标题多端同步 / 重连与人工保护进入实际 SQLite / SDK 本地 HTTP / TCP WS / 双 Electron 回归；完整 185 项 Vitest / 53 项 E2E、SDK 冒烟与 frozen clean 通过。真实微软拼音 Enter / Escape / Space 选词、原生预填 / 取消 / 写失败恢复 / 标题同步、同 data / profile 重启持久与两次正常退出已补证，三项均勾选。原生 SendInput 与合成事件分开记录，两个 SDK JSONL 字节不变、重启无内核 / 无重发；产品代码未改，230 个文件与 clean 一致，按用户要求复用门禁。真实提供商请求 0，pi 配置 / canonical 预算不变，无安装包。该次本地 17 / 133，OPS-08 继续 in_progress；WS-02 的后续验收见本次记录。 2026-11-03 WS-02 已验收：Electron 最近列表与自定义名由 daemon SQLite / 0007 迁移持久保存；成功显式打开 / 切换才更新最近顺序，同毫秒顺延，重命名 / 刷新 / 校验 / 重新定位不更新时间。最多展示 100 项及总数，旧库不伪造最近，standalone 内部登记不进入最近。Unicode 1–80 码点、预填 / Enter / Escape / IME、失败保留与 CAS 冲突处理通过。移除只隐藏最近，保留文件 / 身份 / 名称 / 项目 / 会话 / 当前窗口和后台任务；重新定位仅同物理目录且明确保存，不改既有会话 cwd，旧 cwd 不匹配时拒绝续发。新增 7 项实际目录 / SQLite / HTTP / SDK 本地服务测试与 4 项 Electron 流程；完整 192 项 Vitest / 57 项 E2E、SDK 冒烟及本次 frozen clean 通过。25 步原生 Windows / 微软拼音 / 真实选择器、失败恢复、同 PID 后台任务、同 data/profile 重启和两次正常菜单退出已补证。原生首段 hold 约 300 秒后 terminated，后续明确本地启动 / 停止分别记录，不冒充一轮贯穿；真实提供商请求 0，pi 配置 / canonical 预算未改，无安装包，网页独立操作暂缓。 当前本地 18 / 133，OPS-08 继续 in_progress；下一项建议 WS-06 项目管理、分组与侧栏组织，再推进 SESSION-12。 WS-07、OBS-01、OBS-04 已按顺序完成自动与 Windows 原生验收。OBS-04 完整 240 项 Vitest／90 项 E2E、SDK 与 frozen clean 通过，304 文件与 clean 一致；真实提供商 0。生产业务审批／双端审批、M3 回滚与平台门禁仍待完成，OPS-08 继续 in_progress。

只有依赖已验收、全部验收项勾选且有非空验证证据的功能，才能标记 verified。M8 不计入本地完整版完成率；完成率按条目计数，不是工时或发布承诺。

设计状态和实现状态分别维护。日期和工时未估算时保持为空，不以条目数量预测发布时间。
