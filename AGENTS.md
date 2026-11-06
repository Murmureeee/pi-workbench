# Pi Workbench · AI 协作与开发指南

本文件适用于整个仓库，供后续 AI 在新会话、长任务和上下文恢复时使用。先遵循系统与本次用户指令，再按本指南和对应设计工作；下级 AGENTS 可细化局部规则，不能自行推翻已确认路线。文中“产品权限”约束待开发工作台，不代表协助开发的 AI 修改源码前必须逐次请求审批。

## 1. 目标与不可混淆的事实

- 产品是基于 pi agent 的个人、本地优先编码工作台，Windows 桌面优先，保留共享服务与数据的本机网页入口。参考 Codex、Claude Code、PI-Desktop 的交互与规格，采用独立实现。
- 首个重点交付目标是 M3：对话、审批、修改审查与回滚闭环。完整本地范围为 M0–M7；M8 是可选候选池，不计入本地完成率。保留所有既有功能与里程碑 ID。
- **已确认方案、设计覆盖、依赖已安装、实现候选、实际验收是不同状态。** 静态原型、fake kernel、示例数据、SDK API 存在及参考产品源码，都不能证明本产品功能完成。
- 当前工程具有离线基础壳、CORE-04 受管 SDK 子进程、CORE-05 REST / WS 只读观察 / 重放、CORE-06 原生历史索引 / 检查点恢复、CORE-07 有界资源 / 受管冷恢复、SEC-06 原生凭证边界 / 统一输出脱敏、SEC-07 资源信任及 SEC-08 客户端配对；SDK 使用本地 HTTP 夹具，固定工具经最终守卫和明确单次审批；扩展与真实提供商仍关闭。`?observe=<sessionId>` 可观察受管运行时或重启后的最新轮次，`?history=<sessionId>` 可只读分页查看历史、恢复记录与诊断，`?resources` 可只读核对资源限额和排队，`?credentials` 仅展示凭证状态，`?clients` 管理本机客户端，侧栏设置区或 `?trust` 检查和管理资源信任；这些实际数据入口须先配对。WS-01 的 Electron 侧栏“打开工作区”或 Ctrl+O 进入 `?workspaces`，原生选择器 / 绝对路径经 daemon 校验，按物理目录复用身份，支持本窗口切换和诊断；不创建会话或自动信任资源。Electron 默认由 SESSION-01 接入真实 daemon / SDK 的本地夹具发送；浏览器首页及桌面 `?samples` 仍为带来源标记的假内核样本。真实产品能力以 backlog 各条验收为准。开发场景中的审批按钮、Diff、工具过程不自动代表真实执行。不要为了演示效果接入绕过 daemon 的模型请求。
- OPS-08 的 M1 契约基线、CORE-05 双客户端重放及 CORE-06 真实 SDK 本地硬杀 / 持久恢复已接入离线 CI；整体仍为进行中，CORE-07 配额 / 排队 / 取消 / 冷恢复及 SEC-06 凭证 / 分片脱敏、SEC-07 来源 / 指纹 / 撤销、SEC-08 配对 / 撤销、WS-01 目录身份 / Windows ACL / Electron 切换也已接入。SESSION-01 原子首发 / 幂等 / 失败恢复、真实 Windows 微软拼音及原生 Electron 草稿 / 设置返回 / 目录 / 主题已补证；SESSION-02 的 3 视图 / 草稿 / 阅读与面板恢复、后台同 PID / 重连及旧 pi 历史只读发现已接入；其余 M2 业务审批 / 双端交互与 M3 以后验收须随实现补齐。来源、阶段矩阵及证据见 [工具规范](docs/development/tooling.md)，不能用本地样本通过提前验收对应功能。
- MODEL-01 已接入 Electron 侧栏设置区 / 原生菜单的 `?models`：只读展示安装 SDK 静态目录、显式 PIW_PI_AGENT_DIR 的 auth / models / settings 元数据、模型能力 / 来源 / 默认匹配及本地认证状态，统一脱敏。已配置与未联网验证分开，工作台真实传输仍关闭；不改配置、不执行认证 / 请求头命令、不刷新 OAuth、不恢复动态目录缓存、不加载扩展，也不因其他产品账号推断权益。`GET /api/models` 仅向已配对 desktop 身份开放，网页版独立功能暂缓。模型发现的实际 SDK / HTTP / SQLite 及 Electron / 原生菜单验证已纳入 OPS-08，同一门禁继续保持进行中。
- SESSION-03 已验收：daemon SQLite 独占置顶 / 未读 / 归档，revision 与结果 / 阅读游标隔离迟到回执；新终态标未读，活动可见且有焦点的对话实际显示对应结果并读到最新才清除。原生已验证重启保持、恢复不启动内核、中段保留未读、取消归档同 PID 继续运行、明确停止后再次确认归档及正常退出。实际后台状态来自内核 / 队列 / 提交，归档在事务内阻止发送竞态；不把视图隐藏当成任务结束。完整 179 项 Vitest / 49 项 E2E、SDK 冒烟与 frozen clean 通过，最后提示文案补跑完整 CI；OPS-08 整体继续进行，来源与限制见 [验收记录](docs/validation/session-03-evidence/acceptance.md)。
- SESSION-11 已验收：Electron 重命名、Unicode 码点校验、失败保留、CAS 冲突、独立标题订阅与人工来源保护均通过。完整 185 项 Vitest / 53 项 E2E、SDK 冒烟与 frozen clean 通过；真实 Windows 微软拼音 Enter / Escape / 选词、原生预填 / 取消 / 写失败恢复 / 标题同步、同 data / profile 重启持久及两次正常退出已补齐。原生是 SendInput 操作真实 OS 输入法，与合成 composition 分开记录；230 个产品 / 测试 / 根配置文件与 clean 一致，按用户要求复用已通过门禁。本地完成数从 backlog 计算，OPS-08 继续进行；见 [验收记录](docs/validation/session-11-evidence/acceptance.md)。
- WS-02 已验收 Electron 持久最近列表 / 自定义名、明示排序、失效诊断、仅隐藏移除和同物理目录重新定位；既有会话 cwd 与后台任务不随整理改变。实际目录 / SQLite / HTTP / SDK 本地夹具、完整 192 项 Vitest / 57 项 E2E、frozen clean 和 25 步原生 Windows / IME / 选择器 / 重启证据见 docs/validation/ws-02-evidence。
- WS-06 已验收 Electron 项目创建 / 改名 / 置顶 / 组内排序持久、展开 / 检索 / 同名区分、新会话归属、单默认目录与独立空间。0008 迁移、CAS、创建原输入幂等 / 墓碑及解散分组的同事务归无项目由 daemon 独占；整理保留文件 / cwd / 模型 / 历史 / 权限和已运行任务。完整 201 项 Vitest / 63 项 E2E、SDK 冒烟、frozen clean、40 步实际 Windows IME / 选择器 / 同 PID 后台 / 原生重启与两次正常退出见 [验收记录](docs/validation/ws-06-evidence/acceptance.md)。249 个产品 / 测试 / 配置文件与 clean 一致，原生后复用门禁；OPS-08 继续进行中；SESSION-12 后续验收见下条。真实提供商请求 0、配置 / 预算未改，无安装包，网页独立功能暂缓。
- SESSION-12 已验收 Electron 中文标题 / 用户 / 助手正文、项目 / 状态 / 日期 / 归档筛选、200ms 防抖 / 迟到隔离、脱敏分页及原消息定位；0009 为可重建派生索引。完整 209 项 Vitest / 67 项浏览器及 Electron E2E、SDK 冒烟、frozen clean 与真实微软拼音 Enter / Escape / 数字及 Space 选词、原生失败恢复 / 后台同 PID / 明暗窄窗 / 重启搜索和两次正常菜单退出均通过。270 个产品 / 测试 / 脚本 / 配置文件与 clean 一致，原生后复用门禁，三项勾选，本地 20 / 133；OPS-08 继续进行。主动迁移 / 删除入口仍待后续功能，仅用明确 SQLite 夹具验证索引消费。真实提供商请求 0，配置 / 预算未改，无安装包，网页独立功能暂缓；见 [验收记录](docs/validation/session-12-evidence/acceptance.md)。
- WS-03 已验收：Electron cwd／仓库根／分支／detached、非 Git／子模块／多仓库、目标隔离与错误恢复进入 8 项服务／5 项 Electron 自动回归；完整 217 项 Vitest／72 项 E2E、SDK 冒烟及 frozen clean 通过。用户明确授权后补齐 28 步 Windows 原生操作：外部 HEAD 更新、非 Git 续发、切换同 PID／epoch 与原 cwd、明确停止、明暗 800px 窄窗、同 data/profile 重启及两次正常退出；重启零内核／零新请求、历史哈希不变。277 文件与 clean 一致，原生后复用门禁，两项勾选并 verified。第一段 hold terminated 与重试后明确停止分开记录；OPS-08 继续 in_progress，真实提供商请求 0、pi 配置／预算／锁文件未改，无安装包，网页独立功能暂缓；[验收记录](docs/validation/ws-03-evidence/acceptance.md)。
- INPUT-01 已验收两项：沿用既有产品实现，新增2项实际Electron自动回归，完成27条Windows原生观察；真实中文候选Enter/Escape/Space/数字、换行、独立草稿/项目/模型及所属续发通过。原生Ctrl+R/F5没有建立实际刷新证据，刷新仅据Electron page.reload测试；未独立重查IME厂商。两项新增测试已纳入SESSION-07本次完整223／78、SDK与frozen clean；见 docs/validation/input-01-evidence/acceptance.md。
- SESSION-07 已验收：0010不可变session_origins与membershipVersion CAS，Electron“执行空间与项目归属”显示保存cwd／创建来源／能力来源，整理不搬文件、不改cwd或授权，失败／冲突／迟到保持隔离。6项实际服务与4项Electron回归，最终27文件／223项Vitest、78项E2E、SDK和frozen clean通过，包含INPUT-01新增测试。29条实际Windows原生观察、同PID／epoch后台、明暗800px、同data/profile重启0内核／0重发及两次正常菜单退出补证；282文件与clean一致，原生后复用门禁。外部验收夹具产物非SDK生成，工具继续禁用。当前本地23 / 133；SESSION-13只交付整理子集、三项仍false，OPS-08继续in_progress。真实提供商0、pi配置／canonical预算／锁未改，无安装包，网页独立功能暂缓；[验收记录](docs/validation/session-07-evidence/acceptance.md)。
- OBS-03 已验收：完整 35 文件／251 项 Vitest、93 项浏览器及 Electron E2E、SDK 冒烟与 frozen clean 通过；Windows 原生工具身份／摘要／长输出脱敏与收起、跨会话及逐轮展开隔离、后台同 PID／epoch 和焦点、明暗 802px 窄窗、同 data/profile 只读重启 0 内核／0 新发送／0 注入、历史哈希不变及正常菜单退出已补证。316 文件与 CI／clean 一致，原生后复用门禁；仅文档模板另更新。两项勾选，当前本地 27 / 133，OPS-08 继续 in_progress。合成工具观察与真实 SDK 禁用工具错误分开，未开启生产工具／审批／MCP／回滚；真实提供商 0，配置／预算／锁未改。见 [验收记录](docs/validation/obs-03-evidence/acceptance.md)。
- OBS-06 已验收公开思考权限过滤、默认折叠、脱敏复制下载、本窗口隐藏与明确缺失状态。静态检查、257 项 Vitest／SDK通过；一次 CI 的既有 E2E 超时保留，随后完整95项E2E通过；最终边界加强经47项相关测试、2项Electron和完整frozen clean验证。56条Windows原生观察、明暗802px窄窗、同data/profile重启0发送／0内核、历史哈希不变及两次正常退出补证。319文件与clean一致，原生后复用门禁。本地28／133，OPS-08继续in_progress；真实提供商0，pi配置／预算／锁未改，无安装包，网页独立功能暂缓。见 [验收记录](docs/validation/obs-06-evidence/acceptance.md)。
- SEC-02 已验收：daemon 独占无倒计时的最终参数单次审批，首个有效多端决定生效，保存先于许可；取消、停止、IPC／内核／策略及退出失效，重启不恢复旧授权。完整45文件／292项Vitest、107项E2E、SDK与frozen clean通过；56条Windows原生观察（含中间态，另排除1张非产品截图）、两次正常退出、同data/profile重启0发送／0内核／0待审批，3份JSONL哈希不变。347文件与clean一致，原生后复用门禁；此前两次完整失败与安装命令记录分别保留。原生命令仅核对／取消，实际执行由自动Electron覆盖；没有新增真实IME证据。当前本地33／133，OPS-08继续in_progress；真实提供商0，pi配置／canonical预算／锁未改，无安装包，网页独立功能暂缓。见 [验收记录](docs/validation/sec-02-evidence/acceptance.md)。
- SEC-03 已验收：daemon 独占显式完整参数／物理目录会话授权，L3与嵌套始终单次；单条／全部撤销先同步失效，最终异步检查后重查，重启不恢复授权。无CHANGE基线时每次仍须单独确认本次不可回滚执行，撤销不停止已运行动作。完整46文件／300项Vitest、111项E2E、SDK与frozen clean通过；102条Windows原生观察含802px审批遮挡缺陷及修复、三次正常菜单退出、同data/profile重启0授权／0待审批／0内核／0发送，JSONL哈希不变。353文件与clean一致；三轮CI失败与定向受干扰失败、HTTP500夹具及原生IME／焦点限制见证据。当前本地34／133，OPS-08继续in_progress；真实提供商0，pi配置／canonical预算／锁未改，无安装包，网页独立功能暂缓。见 [验收记录](docs/validation/sec-03-evidence/acceptance.md)。
- 进度从 `docs/product/backlog.json` 的 `features[].progress` 及依赖计算；不要沿用聊天、旧报告或正文中的完成数，也不要发明工时百分比、目标日期或已通过的证据。

## 2. 开始任务：先定位，再修改

1. 读取根 [README](README.md)、[产品规划](docs/product/plan.md)，在 [backlog](docs/product/backlog.json) 定位本任务的功能 ID、阶段、前置依赖、验收项、现有证据与状态。工程维护 / 文档任务标明关联领域，不强行新增功能 ID。
2. 阅读任务对应设计与当前实现；用 `rg` / `rg --files` 搜索现有模块、组件、配置和测试。优先复用已有能力，先确认导出与调用链，再创建文件。
3. 简要说明本次范围、预期结果和验证方式；较大功能拆成可独立验证的步骤，继续完成当前已授权范围。不要把整理计划当作实现交付。
4. 确认相关目录是否有更细的 AGENTS，检查当前变更与运行服务，保留用户已有工作。没有 Git 时不假设可使用 diff / reset / worktree，不擅自初始化仓库。

本机以 Windows / PowerShell 为基线，命令注意路径空格和引号；搜索优先 `rg`。独立读取可并行，文件修改、构建和占用相同端口的测试按依赖顺序执行。删除 / 移动前核对绝对路径与归属，不跨 shell 拼接递归删除，不覆盖用户环境变量、私有配置或无关进程。

按需阅读，不必每次全文读取所有历史报告：

| 任务 | 必读依据 |
| --- | --- |
| 技术路线、包边界、数据所有权 | [实施方案](docs/architecture/implementation-plan.md)、[项目结构](docs/architecture/project-structure.md) |
| 用户偏好与是否已经确认 | [共同确认记录](docs/decisions/project-confirmation.md) |
| 会话创建、命名、搜索、项目归属 | [会话设计](docs/product/session-design.md) |
| UI、组件、主题与交互 | [核心页面规格](docs/design/core-spec.md)、[高保真稿](docs/design/review.html)、[组件采用规则](docs/development/ui-components.md) |
| 内核、执行守卫、快照与回滚 | 对应 CORE / SEC / CHANGE 条目、[M0 验收与边界](docs/validation/m0-acceptance.md)及当前实施方案 |
| 持久化、迁移、备份、历史兼容 | [数据生命周期](docs/architecture/data-lifecycle.md) |
| 代码规范、函数文档与异步隔离 | 本指南第 6 节、[工具规范](docs/development/tooling.md)、根 lint / formatter / TS 配置 |
| 启动、环境变量、离线场景与排障 | [README](README.md)、[工具规范](docs/development/tooling.md)；先核对实际入口，不照搬参考项目命令 |
| 真实模型验证 | [真实验收政策](docs/validation/live-validation-policy.md)、[预算账本](docs/validation/live-validation-budget.json) |
| 文档、生成器与文件位置 | [文档索引](docs/README.md) |

冲突处理：用户最新明确指令优先；产品范围、验收与状态以 backlog 和总规划为准，产品规则对照 D01–D15；技术 / 默认值对照最新共同确认及实施方案，UI 对照已确认设计。旧架构草案和外部 spec 仅作实现参考。发现冲突先核对来源，能够确定的同步回填；涉及尚未决定的产品取舍才提问，不靠自行选择“更严格规则”掩盖矛盾。

## 3. 已确认技术栈

以下是选定路线，不因当前 AI 更熟悉其他框架而替换。精确版本以根 `package.json`、`pnpm-workspace.yaml` 的 named catalogs 和 `pnpm-lock.yaml` 为准；下表的版本用于识别基线，不另建版本清单。

| 层 | 基线与职责 |
| --- | --- |
| 仓库与语言 | pnpm workspace 单仓库；TypeScript 6 strict；ESM；内部依赖 `workspace:*` |
| 运行环境 | Node 24；当前 `devEngines.runtime` 固定 24.22.2，pnpm 固定 12.16.1；通过 pnpm 使用运行时，不替换用户系统 Node |
| 前端 | React 19 + Vite 8；Zustand 维护客户端 / 会话视图状态，TanStack Query 维护请求缓存；领域投影用 shared 纯 reducer |
| 视觉与组件 | Tailwind CSS 4；官方 shadcn/ui **Base UI / base-nova**；AI Elements 展示组合；Lucide 图标；语义主题 tokens |
| 桌面 | Electron 薄壳；main 管窗口、托盘和受管服务生命周期；renderer 复用 web |
| 本地服务 | NestJS + Fastify 适配器；领域模块、应用编排与基础设施分层；HTTP / WS / IPC 按相应功能逐步接入 |
| Agent | `@earendil-works/pi-coding-agent` SDK，当前 1.4.0；每个活跃会话的受管 SDK 子进程；宿主保留执行守卫 |
| 契约 | Zod 4 + TS 类型；外部输入、HTTP / WS / IPC 边界运行时校验 |
| 存储 | daemon 独占 Drizzle + better-sqlite3 / SQLite；pi 原生 JSONL 保存 SDK 历史；独立 Git 账本按 M3 实现 |
| 工具与测试 | Oxlint + Oxfmt + tsc + Knip；Vitest 单元 / 集成；Playwright 浏览器 / Electron E2E |

- 增加依赖先检查现有能力；说明用途、放在哪个包和代价。使用既有 named catalog，提交精确锁文件变更，安装后核对原生模块与 peer dependencies。不混用 npm / yarn 锁文件，不随意使用浮动 `latest` 升级。
- 不引入第二套 UI 基础、ORM、全局状态、构建器、格式化或 lint 系统；不重引 ESLint / Prettier。更换核心路线先给出问题、备选与迁移影响，由用户确认。
- 使用库 / SDK 的新接口前核对已安装版本的类型、源码或官方文档，不凭其他版本示例猜 API；参考产品中的能力须独立验证。

## 4. 目录与依赖边界

| 目录 | 应放内容与限制 |
| --- | --- |
| `apps/web/src/app` | 入口、providers、整体工作台布局；业务行为逐步下沉 features / services |
| `apps/web/src/features` | 会话、输入、审批、审查等业务组合；不在公共 UI 组件中编码领域策略 |
| `apps/web/src/services` / `stores` | 契约化客户端请求 / Zustand 视图状态；不成为第二套执行权威 |
| `apps/desktop` | Electron 系统集成与服务监护；不复制 daemon 的会话、审批或数据库逻辑 |
| `apps/daemon/src/modules` | Nest 领域模块；Controller 负责校验与转发，应用服务负责跨模块编排 |
| `apps/daemon/src/infrastructure` / `migrations` | 数据库、文件系统及传输适配 / 显式 Drizzle 迁移 |
| `packages/shared` | 纯类型、Zod 契约、纯 reducer；不依赖 React、Nest、Node IO 或宿主包 |
| `packages/agent-adapter` | pi SDK 隔离、事件归一化、子进程接口和执行守卫；不依赖 Nest |
| `packages/ui` | shadcn 源码、语义 tokens、通用展示组件；通过公开 exports 使用 |
| `packages/config` | 共享配置；先检查根配置与包配置的继承关系 |
| `e2e` / 就近 `*.test.ts` / `apps/daemon/test` | 跨端流程 / 单测 / 服务集成测试 |
| `docs` / `scripts` | 分类文档、必要历史验收归档 / 可执行工程工具及生成器 |
| `.workbench` | 本地运行数据、日志、临时样本、任务笔记及未归档证据，保持忽略 |

依赖方向：`web → ui/shared`；`daemon → shared/agent-adapter`；`agent-adapter → shared/pi SDK`。未来 ledger 由 daemon 使用。renderer 禁止直接引用 Electron、Nest、数据库、Agent / ledger 特权实现或 Node IO；不跨包深引私有 `src` / `dist` 绕过 exports。

退出由 KernelService 顺序协调：等待 SDK 终态与实际进程退出，再关闭 EventService、冲刷 SessionStore、关闭数据库及释放数据目录租约；不要改成相互并发的 Nest 销毁钩子。

SQLite 业务写入归 daemon，pi JSONL 归 SDK；索引、队列、inflight 和已提交历史分开管理。数据库 schema 不冒充前端协议。跨模块通过公开服务交互，不直接操作对方私有表 / store。只为实际复用抽取公共包；不预建空 ledger、万能 utils、无用途的接口层或未实现功能模块。

修改共享契约须同时核对生产者、客户端、持久化 / 重放和夹具。CORE-05 握手区分版本与实际能力，不兼容先阻止变更请求并提示匹配版本后再同步；技能菜单与设置同源，磁盘发现、允许使用、当前已加载分开表示，保存配置不等于运行时已生效。

CORE-05 运行时观察协议见 `packages/shared/src/runtime-contracts.ts`，与旧 fake 场景的 `Projection` 分开。daemonId 标识服务实例；seq 在 sessionId + epoch 内连续，事件 ID 为 epoch:seq；不按旧架构草案的全局 seq 检查单会话缺口。`KernelService.prompt / abort` 发布权威观察，业务调用不绕过它直接操作子进程。CORE-06 的 SessionStore 独占 SQLite 索引与独立 inflight，正文只读回源 SDK v3 JSONL；SDK custom turn marker 不进入模型上下文。检查点按 epoch / turnId / messageId / seq 去重，终态原文优先，中断回复不写入 SDK。重启队列变为 held、pending 审批失效，历史 allowed 只作审计；业务观察通道只读；SEC-08 已保护传输身份，生产工具审批仍按后续 SEC 功能验收。CORE-07 内核和模型各自 FIFO，启动 / 回收占名额，实际退出后才释放；open 仅返回观察句柄，模型任务必须经 KernelService.prompt。冷恢复仅重开 daemon 独占的受管 v3 JSONL，使用新 epoch 与原 nativeSessionId，历史按原绑定去重，不把 inflight 导入模型，不接管旧 CLI 会话；网页资源页不提供写入口，真实终端和完整视图缓存后续分别验收。

SEC-06 的 SecurityService 由宿主独占现有 pi 凭证来源；默认关闭，只有显式 PIW_PI_AGENT_DIR 才读取 auth.json / models.json 状态，不执行命令型凭证或刷新 OAuth，不向 renderer、SQLite、SDK IPC 复制配置密钥。内部保存保留原生锁、冲突检测和访问权限，临时文件先应用权限再写密钥；浏览器写入口仍关闭。日志、审批摘要、HTTP / WS、历史和导出共用 shared Redactor；执行参数、原生历史与持久检查点保持原文。流式按累计文本处理分片，中止 / 错误 / 恢复与历史全文也保护未完整密钥后缀；观察通道使用 visibleSnapshot / visible subscription，支持 message.replaced 与终态安全全文。redacted-observation 是必需能力，不能绕回原始事件发送。损坏记录只导出经脱敏检查的副本，无法安全解析返回 422；原件保留。已知值及常见格式过滤不承诺识别任意未知 / 编码秘密，未来新展示、通知、索引与导出必须接入同一边界并补验收。

SEC-08 的 AccessService 仅在宿主内存保存票据 / 客户端哈希映射，随机票据 120 秒且一次性；浏览器持有 Path=/api、HttpOnly / SameSite=Strict 的会话 Cookie，授权绝对期限 8 小时，服务重启全部失效。票据只能由桌面父子私有 IPC 或交互 TTY 主动签发，网页不可自发授权；URL fragment 在首帧请求 / 同页 hashchange 后立即移除，不写浏览器存储。除公开 health / protocol / access 状态 / 票据兑换和明确 fake 样本外，REST / WS 要求客户端身份；写入口还要求精确 Origin、JSON 和客户端 CSRF，Host 精确匹配回环端口，不信任代理头。撤销 / 到期断开所属 WS 观察，不取消 daemon 任务；旧授权不从 SQLite、历史或备份恢复。拒绝 WS 升级也必须释放底层 socket；不要移除早期拒绝清理钩子。桌面身份只由宿主管理，配对不自动开放 MODEL-02 凭证修改或真实模型传输。

WS-01 的 WorkspaceService 独占目录登记，使用 realpath 和平台 / 设备 / inode / 创建时间校验物理身份，不能简单小写路径。打开 / 切换先检查存在、列目录及独占创建 / 删除 4 字节探针；失败保留旧记录，不创建会话。WS-02 的 0007 迁移在 workspaces 增加自定义名、最近打开时间与 revision；成功显式打开 / 切换才更新最近顺序，同毫秒单调顺延、ID 次排序，重命名 / 校验 / 刷新 / 重新定位不更新时间。列表最多展示 100 项并返回 total，旧库不伪造最近时间，standalone 内部登记不加入最近。名称去首尾空白后 1–80 Unicode 码点，拒控制 / 格式字符；null 恢复目录名。元数据编辑使用 CAS，冲突和失败保留编辑、不自动重试。移除仅隐藏最近记录，保留目录 / 名称 / 身份 / 项目 / 会话 / 当前窗口和任务；重开恢复同身份。重新定位必须显式保存且匹配同一物理指纹，只改登记路径，既有会话 cwd 不变，旧 cwd 与登记路径不匹配时续发拒绝、不启动模型。活动选择和本窗口列表仍属于客户端视图，切换不调用 KernelService.abort / dispose。sandbox CJS preload 只暴露固定目录选择器，main 核对发送窗口、主 frame 与 Origin；路径仍经已配对的 daemon HTTP 校验。目录可用不等于资源可信、执行权限或以后持续可写，实际发送 / 写入须再次检查。网页独立工作区操作暂缓，不以放开 bridge 或 Origin 实现。

MODEL-01 的 ModelService 只通过 SecurityService 读取各自有界、独立的来源元数据，通过 agent-adapter 的公共 ModelRuntime 目录 getter 获取实际能力；源文件读取前后摘要改变则拒绝该次发现。显式无凭证存储、拒绝持久化模型缓存和关闭初始刷新阻止 SDK 默认 auth / 缓存路径；不得用 getAvailable / checkAuth / auth resolver 代替目录读取。auth.json 优先且只检查明确环境引用，其他环境 / 平台认证标为未检查。请求头按 SDK 覆盖顺序检查命令 / 缺失状态，不返回原值。SDK 内置、models.json 定义及 auth.json 状态须分辨，目录存在不代表真实模型授权。SESSION-01 选择 / 发送继续经内核，真实提供商守卫保持关闭，不能绕过费用限制。

SESSION-01 的 `/api/chat` 仅开放已配对 desktop 身份，写请求继续核对 Host / Origin / JSON / CSRF 与协议能力。SessionService 在同一 SQLite 事务中保存稳定 session / request / message / turn、配置和待发送输入，再经 KernelService.prompt 调度；相同 requestId 必须匹配同一不可变输入，先核对已保存结果再检查可变目录。每轮在资源准入前后重新校验工作区，独立目录持久保存且拒绝 standalone 基目录链接逃逸。已提交正文回源 SDK JSONL，SQLite outbox 在匹配 native user entry 后清空。重启 / 结果未知不自动重放，已知失败明确重试生成新请求 / 轮次并关联原任务。桌面 per-window sessionStorage 保留新 / 旧会话各自草稿及未确认请求，同项目新草稿重入保留显式目录，变更项目入口才重置目录覆盖；设置返回记住当前会话，迟到回执不抢页面。当前只有 development 的显式本地夹具可执行；选择现有提供商只保留配置，真实传输继续关闭，不把它静默替换为夹具。WS-06 项目整理已独立验收，SESSION-07 / 10 等继续按各自验收。

WS-06 的 ProjectService 独占名称 / 默认工作区 / pinned / position / revision / 创建幂等输入和 removed 墓碑。项目保存使用 WorkspaceService 的 remember:false 校验，不计作最近打开；编辑及会话准入在目录 IO 后重查版本 / 当前默认或归属。SessionService 通过 SessionStore.detachProject 公开边界在同一 SQLite 事务内解散归属，不改提交、模型、cwd、SDK JSONL、信任或已运行任务。项目上下移基于未过滤完整组，置顶切换入目标组末尾；客户端查询和收折仅控制视图，迟到创建不覆盖新草稿。SESSION-07已交付仅整理归属，实际环境迁移仍留待SESSION-13，网页独立操作暂缓。

SESSION-02 的视图缓存与内核池独立，最多 3 个视图含新草稿；卸载只释放自身查询 / 观察，不调用 abort / dispose。小型书签存当前窗口 sessionStorage，恢复面板 / cursor / 展开 ID / 引用及消息锚点与偏移；正文与执行 / 队列 / 审批权威仍由 daemon / SDK 保存，不恢复授权。迟到结果绑定所属会话 / 对象 / 请求版本，卸载同步失效 pane 的展示请求身份，同一草稿键重开后的目录 / 项目选择不能被旧回执覆盖；重新打开恢复位置并同步权威，不重发任务或替换当前面板。应用重启 / 跨窗口草稿不在此范围。旧历史只从显式 PIW_PI_AGENT_DIR/sessions 有界发现，2000 目录项 / 200 文件 / 16 MiB，拒绝链接；稳定 descriptor / 文件身份 / 内容版本绑定分页和全文，CLI 同写拒绝混合快照，v3 只读、半行待刷新、损坏诊断，不调用 SDK SessionManager 或迁移 / 修改源文件。SEC-08 desktop-only / SEC-06 统一脱敏继续适用，旧历史续聊属于 SESSION-06。

## 5. 不得破坏的产品与运行边界

- **共用权威状态：** 桌面与浏览器连接同一 daemon；UI 展示投影，不自行执行工具或裁决审批。事件身份、会话 / 轮次 / 运行时代际、顺序、重复、缺口重同步、迟到终态与断线恢复按 CORE 验收；不以乐观 UI 当作执行成功。
- **会话与队列：** 新会话页只存草稿，首次有效发送才持久创建；请求幂等，失败保留输入；中文 IME Enter 不发送。默认本地脱敏摘要标题，不额外调用模型，不覆盖人工改名。项目归属与 cwd / 授权分开；steer 与 follow-up 各自保序，下一轮等待 settled / 快照，中止后不自动重发队列。
- **执行守卫：** 仅经验证的受限读取可自动执行；写文件与命令默认先审批，L3 始终单次确认。裁决绑定最终不可变参数，执行同一快照；扩展改写、MCP、嵌套与未知工具必须纳入守卫。SDK 的准备事件和普通早期钩子不等于最终安全边界。
- **授权与重启：** 本地交互审批无倒计时；切换视图 / 短暂断线不自动裁决。取消、参数 / 策略失效及运行时重建使旧请求失效；重启不恢复旧授权、不自动重放未知副作用。产品中的有限会话授权须显式授予并可撤销。
- **文件与回滚：** 同一物理目录最多一个受管写入轮次；并行写入需隔离 Worktree。写入前基线失败先暂停；仅用户单次明确接受后可执行已说明的不可回滚动作。混合 / 未知来源、大文件、忽略项、链接和外部副作用不能冒充可整轮回滚；冲突先预检，运行期失败按条件补偿，失败保留现场。
- **隔离与隐私：** Electron 保留 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`；特权接口最小化并校验。进程隔离 / 工具守卫不等于 OS 沙箱；原生扩展的直接 Node 副作用需单独约束。默认仅回环访问，不用开放任意 Origin / Host 修复联调。
- **资源信任：** 信任记录绑定实际目录、来源和内容指纹；按用户确认跨重启保存，变化版本须重新确认，撤销从下一轮生效，不删除历史。`TrustService` 在资源排队结束后逐轮重查，只把已确认文本快照通过私有 IPC 传入 SDK。外部设置、技能、包、脚本和原生扩展仍禁用，不实例化会先解析包来源的默认 SDK 资源加载器。后续接入任何执行资源须同时满足资源信任、实际能力和最终参数守卫；不能凭已保存信任启用命令 / Node 副作用、绕过审批或改写宿主权限。
- **数据与生命周期：** 默认 `%LOCALAPPDATA%\PiWorkbench`，开发 / 测试用隔离目录；不移动用户代码、改写现有 pi 模型配置或删除未审查所需快照。旧 pi 历史首版只读。仅升级前自动备份，其余手动，不包含密钥。桌面 × 到托盘；退出只停止自身受管进程，浏览器关闭仅断开观察，自启默认关闭。

以上是实现必须满足的边界，不表示均已开发。Shell / 外部编辑器、分发、更新与通知等已确认默认值继续遵循共同确认记录，不根据框架默认行为替换用户选择。

## 6. UI 与实现质量

- 沿用已确认的中性灰、中等密度、A 日常对话 + B 展开审查；跟随系统，明暗同等设计。主要使用条件按 1920×1080 / 100% 校验，字号基线界面 14px / 消息 15px / 辅助 12px，并覆盖窄窗。
- 新 UI 先查 `packages/ui/components.json`、已有组件及官方 shadcn / AI Elements 模式。公共基础组件经官方 CLI 按当前风格加入，审查依赖与源码差异；业务组合放 feature。新增自制 primitive 必须说明现有组件的具体不足。
- shadcn 的本地 Tailwind / cva / cn 源码是正常分发形式；不能用“有 Tailwind”判断未使用组件库。反之，安装组件也不证明对应产品行为已实现；当前采用缺口见组件规则。
- 复用 AI Elements 的展示组合，保留 pi / daemon 传输与权威；不直接接入示例 `useChat`、AI SDK transport、模拟发送或自动续聊绕开现有规则。
- 为受影响流程补齐加载、空态、错误、取消 / 停止、离线 / 恢复及键盘焦点；长输出与滚动保留上下文，后台事件不抢焦点。状态包含文字，控件有可访问名称，不只依赖颜色。
- TypeScript 保持 strict，边界接收 `unknown` 后校验；不通过 `any`、宽泛类型断言、`@ts-ignore`、吞异常、全局禁用规则或删测试压过失败。例外须范围最小并解释原因。
- 新增 / 修改的公共接口、复杂业务算法、权限 / 持久化边界及有重要副作用的函数须有 JSDoc / TSDoc，说明约束、失败、取消及资源所有权；简单取值和转发不写重复代码的注释。类型不在注释中重复，参数 / 返回值有不明显业务含义时再说明；行为改变同步更新。
- 保持状态所有权单一，纯逻辑与 IO 分开，异步路径处理错误、取消及资源清理；复杂度围绕真实需求增长。一次修改只做相关重构，不批量改名或重写无关模块。
- 异步请求和展示任务绑定所属会话 / 对象及请求版本，迟到结果只能更新仍有效的所属对象；切换视图不取消后台真实任务。订阅、定时器和监听由创建者清理，取消浏览器请求不等于服务端操作已经停止。
- 不可信正文、链接、工具输出和 SVG 走受控渲染与协议校验，不用原始 HTML 注入或自制解析器绕过现有组件。未知格式、未闭合代码和可选渲染失败均保留安全文本；高亮 / 图表按需加载，展示失败不改历史或执行状态。
- 格式与排序交给 `pnpm fix`；不手工重排有执行 / 覆盖语义的对象、数组、CSS 或副作用 import。原生模块、Electron 和子进程变更须验证实际运行，不以类型通过代替。
- 当前文本使用 UTF-8 / LF，遵循 `.editorconfig`；不转码历史证据。元素级全局基础样式放 `@layer base`，优先语义 tokens 和组件 variants，避免未分层样式覆盖工具类。

## 7. 开发与测试命令

所有命令从仓库根执行；脚本含义以 `package.json` 为准。默认验证使用 fake kernel 和真实 SDK + 本地模型夹具，不读取真实凭证或调用提供商。

| 命令 | 用途 / 注意事项 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 按锁安装；依赖缺失再运行，不每轮重复重装 |
| `pnpm exec node --version` | 核对 pnpm 管理的 Node 运行时 |
| `pnpm dev` / `pnpm dev:desktop` | 网页 / Electron 开发入口，二选一；共用 5173 前端和 4317 daemon |
| `pnpm docs:dev` | 8765 本机文档预览，独立于产品应用 |
| `pnpm build:server` / `pnpm build` | 服务与共享声明 / 全部应用构建 |
| `pnpm start` | 只启动构建后的 daemon，不能当作已交付安装包 |
| `pnpm fix` | Oxlint 安全修复、import 成员排序、Oxfmt 格式化与配置的排序 |
| `pnpm check` | 格式、类型感知 lint、tsc、Knip、文档检查；交付前必跑 |
| `pnpm test` | Vitest 单元 / 服务集成；可用 `pnpm exec vitest run <path>` 定位测试，注意服务测试依赖先构建 |
| `pnpm test:contracts` | 定向运行纯投影、固定 SDK 录制、IPC、daemon 内核、CORE-05 快照 / 原生 TCP WS、CORE-06 JSONL / 检查点 / 硬杀恢复、CORE-07 资源、SEC-06 凭证 / 脱敏、SEC-08 配对 / 撤销、MODEL-01 模型发现及 SESSION-01 原子首发 / 幂等 / 中断契约；已包含在完整 test / CI，不新增提供商调用 |
| `pnpm smoke:sdk` | 真实 SDK 子进程握手 / 本地夹具 prompt / abort / dispose，无真实提供商请求 |
| `pnpm test:e2e` | 先构建，再运行本机 Chrome / Electron 用户流程；测试自行启动开发服务 |
| `pnpm run ci` | 完整离线门禁：check → test → SDK 冒烟 → E2E（含构建） |
| `pnpm verify:clean` | 新目录 frozen 安装、检查、构建、测试、SDK 冒烟和服务启动复现 |
| `pnpm docs:build` / `pnpm docs:check` | 生成看板 / PRD / 功能清单 / 校验规划、链接和同源数据 |

验证随改动选择，但不能降低相关验收要求：

- 文档 / 协作约定：核对内容和链接，`pnpm fix` 后运行 `pnpm check`；改需求或模板时先 `pnpm docs:build`。不为纯文档或可逆低影响样式编写无意义测试。
- 产品代码：为受影响行为补必要测试，完成 `pnpm fix` 和完整 `pnpm run ci`。优先验证验收条件、失败路径及真实边界，不只验证函数被调用；服务集成覆盖实际 SQLite / IPC / 生命周期，UI 用用户操作验证。
- 工程 / 依赖 / 运行时 / 构建 / 打包相关变更：在相应门禁外运行 `pnpm verify:clean`，核对锁文件、原生模块及服务退出；不能只在已有 node_modules 上声称可复现。
- UI 变更：在实际 5173 应用检查相关场景、明暗、1080p / 窄窗、键盘与 IME，查看截图和控制台；原型截图不能替代运行应用。明确区分程序合成事件测试与真实输入法手动验收。
- 随功能阶段扩充复用真实组件的离线场景，覆盖迟到响应、状态去重、未知工具 / 超长内容和渲染失败；样本标明来源，不允许预览控件触发真实工具或提供商。Electron 另查窗口首帧、系统主题切换与标题栏控件，不能只检查网页。
- 修复缺陷时尽可能先复现，验证修复前失败 / 修复后通过；不以源码字符串断言、实现镜像、无关快照或仅 mock 的结果证明用户行为。
- E2E / clean 前检查端口（含已绑定 / 活跃连接）及服务归属，只停止本任务明确拥有的服务。开发服务使用 5173 / 4317，CORE-05 浏览器隔离 daemon 使用 4318，原生事件 TCP 集成测试使用 4328，SEC-08 使用 24348，避免不同文件并发冲突和本机较低动态端口段。测试当前使用本机 Chrome；环境缺失、权限受限、跳过测试都必须如实报告，不能记为通过。
- 检查失败先读完整错误并定位，不删除锁文件 / 缓存碰运气，不用 skip / 降规则避开；同一方向无新证据时换诊断方式。已通过后仅在新变更或未解风险需要时重跑相关门禁。

## 8. 真实模型调用与证据

- 沿用现有唯一提供商 / 模型，日常开发和 UI 回归离线。每个里程碑**累计新增最多 2 次底层请求**，每次输出最多 512 token，失败不自动重试；不是每个功能、聊天或脚本各 2 次。
- 必要真实验收已在该限额内获授权，不重复逐次询问。先核对剩余额度、真实传输守卫及提供商有效限制，原子持久预占后才调用；工具后续回合、压缩、失败、中止和结果未知的预占均计数。不删除 / 重建账本、借用其他阶段额度或补发模型命名请求。
- 当前真实传输仍关闭；预算预占算法不等于提供商完整守卫。不能可靠约束隐式回合、重试 / 压缩与输出时继续使用注明来源的离线样本；超限且有不可替代证据缺口时说明用途与追加上限，再请用户决定。
- 不重跑 M0 的原 3 + 1 次真实调用。测试预算守卫仅操作临时副本，不改 canonical 预算。价格 / 用量缺失显示未知，不承诺人民币金额上限。
- 验证输出默认 `.workbench/evidence/latest`，可用 `PIW_EVIDENCE_DIR` 指向新的归档目录；长期证据放 `docs/validation/<topic>-evidence/` 并配验收说明，历史报告、事件、日志、截图和预算不覆盖。
- 记录来源（真实 SDK + 配置提供商 / 真实 SDK + 本地夹具 / fake kernel）、命令、退出状态、结果和限制；脱敏，不输出凭证。PRD 模拟消息、命令、文件、Git、子 Agent 与调度均不能当作真实执行证据。

## 9. 需求、进度和生成文件

- 保留功能 ID、里程碑、前置依赖与用户范围。任务发现遗漏时补充可验证验收项；不静默删范围、放宽标准或拆条目虚增完成率。
- 只有前置功能已验收、每条验收均通过且有具体实现 / 验证证据时，才将功能标为 `verified`。状态只用现有 `not_started`、`in_progress`、`blocked`、`in_review`、`verified`、`deferred`；部分实现不提前勾选未通过的验收，受阻注明原因。阶段门与单功能验收分别判断。
- 根据实际结果更新 `progress` 的状态、验收勾选、说明和证据，保留无关条目及用户填写；设计覆盖单独记录。单纯改本指南、移动文件或装依赖不提高产品完成数。
- 变更 backlog 定义 / 进度后运行 `pnpm docs:build` 和 `pnpm docs:check`，检查生成页面、功能映射与 canonical 数据一致。
- `docs/product/roadmap.html`、`prd.html`、`feature-list.md` 是生成结果，禁止手改。roadmap 源为 `scripts/planning/build-roadmap.mjs`、`templates/roadmap.html`、`assets/roadmap-app.js` 等。
- PRD 编辑 `scripts/planning/templates/prd.html`、`templates/prd-document.html`、`prd-flows.mjs`、`assets/prd-ui.css`、`assets/prd-app.js`，运行 `node scripts/planning/build-prd.mjs`；需求改变时仍须同时重建看板。
- 浏览器看板进度仅为本地工作副本，导出后用 `node scripts/planning/build-roadmap.mjs --import <path>` 回填 canonical，再重建两页。PRD 的模拟存储独立于看板副本，不互相转换为真实进度。
- 文档按 `docs/` 职责分区，不回到根目录平铺；生成工具归 `scripts/planning/`，文档工具归 `scripts/docs/`。历史证据和生成文件遵循现有 formatter 排除范围，不能批量格式化改写。
- 提交前检查实际暂存清单与体积；`spikes/` 整个本机实验目录、依赖、构建产物、`.workbench/`、运行数据库、凭证和一次性测试工作区不入库。M0 必要报告 / 原预算归入 `docs/validation/m0-evidence/`，14 份固定录制位于 `packages/agent-adapter/test/contracts/recordings/`，常规 CI / 文档预览 / clean 不得依赖 spikes；不以 force-add 绕过忽略规则。遵循 `.gitattributes` 保留历史证据、录制及锁文件字节，不能因换行归一化破坏既有 SHA-256。

## 10. 如何与用户协作、延续任务

- 默认中文说明，先讲结果 / 判断，再给理由、取舍和下一步；具体到功能 ID、文件与可见行为，避免空泛承诺。长任务持续报告已确认事实、未解问题和下一步验证。
- 对用户已授权的实现、修复、检查和可逆整理直接推进；常规命名、内部拆分、测试方法自行判断，不反复确认已选技术栈或设计，不把产品审批规则套用为开发操作审批。
- 会改变产品范围、关键交互 / 高保真方向、技术路线、默认权限、数据保留 / 迁移或费用时，主动在实施前按问答提出。每轮通常 2–3 项，给推荐、主要取舍与影响；不等用户发现缺口再补问。未答复不表示同意，等待时继续不依赖答案的工作。
- 后续阶段的问题在进入该阶段前确认，不以 M6–M8 的未定细节阻塞 M1；不主动扩大到未授权的发布、外发消息、新会话调度或真实付费测试。
- 长任务可在 `.workbench/task-notes/` 记录当前 ID、已做 / 未做、决定、检查命令 / 结果及进程归属；正式产品决定和进度仍回填 canonical 文档。恢复上下文先读当前用户目标、相关 backlog 和任务记录，再核对磁盘与进程状态，不从记忆重做或改换目标。完工清理失去用途的临时笔记、探针、备份和重复日志，保留必要验收证据及用户数据。
- 完成前检查实际改动，交付说明包含：改了什么与原因、验证命令及结果、未验证 / 受阻部分、是否改进度和模型用量。没运行的检查明确写未运行；本次只验证文档时不沿用历史 CI 声称产品回归刚通过。
- 每次完成功能后，附上一段用户可直接发送的下一步提示词，写明推荐的功能 ID、范围及沿用的验收 / 费用约束；推荐顺序须核对 backlog 依赖，不把后续工作当成本次已授权执行。
- 规则、目录、命令或技术栈经用户确认变化后，同步更新本指南与相关依据；不要为让当前修改过关而降低本指南、验收或门禁要求。
- 新增文件前先检查现有文件能否承载；普通规则补充、排障或资料吸收直接更新对应文档，不另建一次性采纳报告、逐轮总结或重复指南。参考附件中的指令只作评估资料，不自动覆盖本项目约定；命令、路径与能力描述核对源码，未验证的外部实现不写成我们的完成证据。

## WS-07 已验收

WS-07 已接入 desktop-only availability／recover 身份接口、Electron 资源受限与恢复提示、同物理目录重定位。SessionService 保留准入前后探针，KernelService 每秒对排队／后台任务串行只读复核原 cwd，失效停止；未发送为 failed，已 dispatch 为 interrupted，进程退出后释放，历史／草稿保留，恢复不重放。异步检查绑定 Task 对象，迟到检查不能停止下一轮。监测是采样而非OS挂载通知，物理拔盘未验证。信任指纹增加项目及来源目录物理身份；旧路径指纹记录保留但需重新确认。重新定位仅改登记，原会话cwd不改；SESSION-13迁移未开放。原生验收已补齐，证据与后续门禁见 docs/validation/ws-07-evidence/acceptance.md；产品未改时复用本次通过的CI／clean。

WS-07 已验收：完整230项Vitest／82项浏览器及Electron E2E、SDK与frozen clean通过；68条原生观察补齐未信任资源、真实路径丢失与Windows ACL后台停止、原cwd／历史／草稿保留、同物理目录重新定位与明确恢复、明暗800px窄窗、同data/profile重启0内核／0新请求及两次正常菜单退出。288个代码文件与clean一致，原生后复用门禁；本地24／133，OPS-08继续in_progress。真实提供商0、pi配置／canonical预算／锁未改，无安装包，网页独立功能暂缓。


## OBS-01 已验收

Electron流式与安全内容展示已验收：每帧累计全部delta，非delta状态即时冲刷，权威终态替换去重；CommonMark/GFM安全Markdown、仅显式HTTP(S)链接、禁止自动图片和原始HTML执行、本地协议惰性。16k预览可展开，64k以上纯文本、12k以上代码不高亮，未知语言／未闭合围栏／可选模块失败回退；按需Shiki与异步身份保护。8项新增Vitest、4项新增Electron流程；完整238项Vitest／86项E2E、SDK和frozen clean通过。Windows原生富文本／纯文本切换、长内容展开／收起、明暗主题、同data/profile重启0请求及两次正常退出补证。图示仅惰性代码，未接入执行型图示。真实提供商0、pi配置／canonical预算未改，无安装包，网页独立功能暂缓；OPS-08继续in_progress。[逐项证据与下一步提示词](docs/validation/obs-01-evidence/acceptance.md)。

## OBS-04 已验收

OBS-04 已验收：Electron 回看不强拉、按消息计数、显式／键盘返回最新、消息锚点与偏移跨分页／3 视图淘汰／renderer 刷新恢复；长文展开保持现场、收起不留空白，后台完成或合成审批观察不抢当前焦点与面板。新增 2 项 Vitest／4 项实际 Electron 回归，完整 31 文件／240 项 Vitest、90 项 E2E、SDK 和 frozen clean 通过；60 条 Windows 原生观察、明暗窄窗、后台同 PID／epoch、同 data/profile 重启 0 内核／0 新请求及两次正常菜单退出补证。304 文件与 clean 一致，原生后复用门禁；当前本地 26 / 133，OPS-08 继续 in_progress。分页行／审批观察均明确为合成样本，完整应用重启不承诺窗口书签；真实提供商 0，配置／canonical 预算／锁未改，无安装包，网页独立功能暂缓。[逐项证据与下一步提示词](docs/validation/obs-04-evidence/acceptance.md)。


## MODEL-07 已验收

MODEL-07 已验收：实际 SDK 请求计数、零自动重试策略、脱敏原错误、权威等待期限／未知等待／到期不执行、终态清除等待、同操作错误合并及工具／审批阻止整任务重放。完整261项Vitest／97项E2E、SDK与frozen clean，55条Windows原生观察、同data/profile重启0请求／0内核及两次正常退出；真实提供商0。 当前本地29／133，OPS-08继续in_progress。pi配置／预算／锁未改，无安装包，网页独立功能暂缓。[逐项证据与下一步提示词](docs/validation/model-07-evidence/acceptance.md)。


## INPUT-06 已验收

INPUT-06 已验收：daemon持久有界引导／追加队列、实际SDK边界FIFO、settled后追加新轮、编辑CAS与失败保留、停止／重启held及单条明确恢复。完整40文件／264项Vitest、99项E2E、SDK与frozen clean通过；78条Windows原生观察、后台同PID／epoch／cwd、明暗802px窄窗及两次正常退出，同data/profile重启0发送／0内核且历史不变。329文件与clean一致，原生后复用门禁；短边界原生顺序未建立，SDK顺序和合成IME守卫以自动测试为证。当前本地30／133，OPS-08继续in_progress；真实提供商0，pi配置／预算／锁未改，无安装包，网页独立功能暂缓。[逐项证据与下一步提示词](docs/validation/input-06-evidence/acceptance.md)。


## OBS-02 已验收

OBS-02 已验收：单一主阶段、按操作合并错误、终态消隐及停止请求／确认／未知分开。完整42文件／270项Vitest、102项E2E、SDK与frozen clean通过；88条Windows原生观察补齐正常终态消隐、停止失败同PID后台、SDK aborted确认、held不能消隐、脱敏错误详情、设置返回与明暗802px窄窗。两次正常退出；同data/profile重启0发送／0内核，四份JSONL哈希不变。335文件与clean一致，原生后复用门禁；首发握手超时与明确重试分开记录。当前本地31／133，OPS-08继续in_progress；真实提供商0，pi配置／预算／锁未改，无安装包，网页独立功能暂缓。[逐项证据与下一步提示词](docs/validation/obs-02-evidence/acceptance.md)。

## SEC-01 已验收

SEC-01 已验收：固定工具在 SDK 最终 execute 处冻结参数并经宿主私有 IPC 裁决，多个规则取最高风险；仅实际 cwd 内核验后的有界 UTF-8 快照读取自动，写入与命令无有效审批拒绝，参数改写／嵌套不继承许可。完整44文件／281项Vitest、104项E2E、SDK与frozen clean通过；80条Windows原生观察（含中间态与重试）、后台同PID／epoch、明暗802px窄窗、同data/profile重启0发送／0内核、三份JSONL哈希不变及两次正常菜单退出补证。扩展、MCP、真实提供商关闭；审批交互、会话授权、写入基线仍属后续。当前本地32／133，OPS-08继续in_progress。真实提供商0，pi配置／canonical预算／锁未改，无安装包，网页独立功能暂缓。[逐项证据与下一步提示词](docs/validation/sec-01-evidence/acceptance.md)。
