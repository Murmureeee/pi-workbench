# Pi Workbench

基于 pi agent 的个人、本地优先编码工作台。Windows 桌面优先，保留共用服务与数据的本机网页入口。

AI 参与开发前先读 [AGENTS.md](AGENTS.md)：已确认技术栈、目录边界、协作方式、开发测试及验收规则。

## 开发运行

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

网页入口为 `http://127.0.0.1:5173`；桌面开发改用 `pnpm dev:desktop`，二者不要同时启动。桌面关窗收到托盘，“退出应用”结束其受管开发服务。`pnpm start` 当前只启动构建后的 daemon。

普通页面是 OPS-01 已验收的离线基础壳，会话、命令、Diff 和发送使用带来源标记的样本；daemon 已接入 CORE-04 受管 SDK 子进程、CORE-05 REST / WS 快照与重放、CORE-06 持久化 / 只读故障恢复、CORE-07 资源排队与冷恢复、SEC-06 凭证边界 / 输出脱敏、SEC-07 资源信任、SEC-08 本机客户端授权，以及 WS-01 桌面工作区，使用本地夹具验证，真实提供商仍关闭。开发数据默认位于 `.workbench/dev`。CORE-01–07、OPS-01、SEC-06 / 07 / 08 和 WS-01 共 12 / 133 项本地功能已验收，具体状态以 [backlog](docs/product/backlog.json) 为准。

pnpm 12.16.1 通过 `devEngines.runtime` 使用 Node 24.22.2，首次安装可能下载运行时；用 `pnpm exec node --version` 核对。Electron 首次运行需要下载；浏览器测试使用本机 Chrome。技术栈为 React / TypeScript / Vite、Tailwind / shadcn Base UI、NestJS / Fastify、Drizzle / SQLite 与 pi 原生 JSONL。

```text
浏览器 / Electron → 共享 React 页面（5173）→ /api → Nest daemon（4317）
                                                  ├─ SQLite（索引与恢复记录）
                                                  ├─ fake kernel（当前 UI 样本）
                                                  └─ 受管 pi SDK 子进程（本地夹具）
```

CORE-04 已实现每会话单进程、守卫握手、流式、中止、销毁与故障隔离；工具 / 扩展全部禁用，SDK 使用隔离配置，不读取用户模型认证。SEC-06 可在显式指定来源后由宿主读取现有 pi 凭证状态，不向 SDK 或页面发送凭证。`GET /api/kernels` 只读核对 daemon 管理的会话、代际、PID、cwd 和原生 sessionFile；进程按内部服务显式创建，没有向页面开放 prompt / 审批写接口。运行页面顶部可切换“离线状态样本”和明暗主题；样本中的发送、审批和审查不代表实际执行。当前启动器不复用已运行的服务；前端热更新不重载 daemon，修改服务后重新构建并重启开发入口。验收边界见[实施方案](docs/architecture/implementation-plan.md)，常见问题见[工具规范与排障](docs/development/tooling.md)。

CORE-05 已验收：`GET /api/protocol` 核对版本与能力，`GET /api/sessions/:sessionId/snapshot` 读取完整观察快照，`WS /api/events` 按游标重放并订阅。已存在运行时可用 `http://127.0.0.1:5173/?observe=<sessionId>` 只读查看，关闭观察不停止任务；不会自动创建会话或调用模型。缺口 / 缓冲不足重新同步，重连不重发任务；不兼容保留内容并禁用变更入口。CORE-06 已补齐重启后的只读历史与中断恢复，CORE-07 已补齐资源调度，接着进入 M2。协议与边界见[实施方案](docs/architecture/implementation-plan.md#core-05-已交付边界)。

OPS-08 的 M1 契约基线及 CORE-05–07 / SEC-06 / 07 / 08 回归已接入；当前完整门禁为 **141 项单元 / 集成、28 项浏览器 / Electron 测试通过**，干净目录验证通过，新增真实提供商请求 0。OPS-08 整体仍为进行中，M2 真实交互与后续回滚门禁待随功能补齐；[阶段矩阵与证据](docs/development/tooling.md#ops-08-契约回归门禁)说明限制。

CORE-06 已验收：`GET /api/sessions` 发现受管索引，`http://127.0.0.1:5173/?history=<sessionId>` 查看只读原生历史与恢复记录。默认最新 100 条 / 页，每条预览最多 64 KiB，全文按需读取，展示与导出经过 SEC-06 脱敏；损坏记录保留原件，无法安全解析的内容不导出。独立 inflight 检查点以 1.5 秒为目标间隔，崩溃回复仅标为中断；重启不创建 SDK 进程、不重发队列或恢复旧授权。队列 / 审批 / 变更引用的存储用明确标记的合成记录验证，真实业务服务与 M3 回滚尚未接入。说明与证据见[实施方案](docs/architecture/implementation-plan.md#core-06-已交付边界)。

CORE-07 已验收：默认最多 3 个活跃内核、1 个模型任务，内核 / 模型各自 FIFO，支持内部任务入口取消；空闲内核按 LRU 或 300 秒超时回收，运行 / 待审批不回收。显式打开时从受管原生历史冷恢复，不额外复制历史、不重放输入或旧授权。`http://127.0.0.1:5173/?resources` 只读查看实际占用、限额和顺序；网页发送 / 取消接口随 M2 开放。终端仅预留 6 个预算，真实 PTY 在 M4 验收。完整 **118 项单元 / 集成、21 项浏览器 / Electron E2E**、SDK 冒烟与干净目录验证通过，新增真实提供商请求 0；[边界与证据](docs/architecture/implementation-plan.md#core-07-已交付边界)已归档。OPS-08 后续阶段继续进行，不据此把整个 M1 功能统计记成 100%。

SEC-06 已验收：从工作台顶部进入“凭证与隐私”，或打开 `http://127.0.0.1:5173/?credentials`，查看来源、缺失 / 过期等元数据，不回显密钥。默认离线且不读取真实配置；设置 `PIW_PI_AGENT_DIR` 指向既有 pi 配置目录后重启，宿主只读状态，不执行凭证命令、刷新 OAuth 或调用模型。凭证仍由原生 pi 文件保存，不复制到业务库；宿主内部更新具备锁、冲突与失败保护，保留其他配置及文件访问权限。日志、审批摘要、REST / WS 流式与重放、历史展示和导出共用脱敏规则；含敏感内容只导出安全副本，未知二进制返回 422，原件不变。该过滤覆盖已知凭证及常见格式，无法保证识别所有未知或混淆内容。浏览器修改凭证留待 MODEL-02 配置流程；实际数据入口现已由 SEC-08 配对保护。[实现、测试来源与证据](docs/architecture/implementation-plan.md#sec-06-已交付边界)已归档。

## 本机浏览器配对

桌面启动时通过私有宿主 IPC 自动授权。从桌面“工作台”或托盘菜单选择“连接本机浏览器”，打开两分钟有效的一次性链接，在页面确认配对。网页开发用 `pnpm dev` 后，在同一个交互终端输入 `pair`，打开生成的链接；非交互终端不会输出票据。独立 `pnpm start` 只提供 API，交互终端只输出短期票据，不托管前端。

顶部“客户端”或 `http://127.0.0.1:5173/?clients` 可查看身份、截止时间并撤销浏览器（包括自身）。受管观察、历史、资源、凭证、资源信任及 WS 要求有效身份；授权最长八小时，服务重启后全部重新配对。撤销立即断开该客户端观察，后台任务继续；关页也不会停止任务。Cookie 为 HttpOnly / SameSite=Strict，会话票据不写浏览器存储。普通离线样本保持公开；配对不授予工具执行或凭证修改权限。

SEC-08 已验收，完整 CI 与干净目录复现通过，新增真实提供商请求 0；[规则与证据](docs/architecture/implementation-plan.md#sec-08-本机客户端授权边界)已归档。

## 项目与资源信任

配对后，从侧栏下方“资源信任”或 `http://127.0.0.1:5173/?trust` 输入待检查目录，查看项目 / 用户 / 第三方资源的来源、影响与指纹，逐项预览后确认；已有记录可查看和撤销。按你的选择，信任跨重启保存，目录、来源或内容变化后重新确认；浏览器身份仍须按 SEC-08 重新配对。撤销从下一轮生效，当前任务保留已检查快照，历史记录不删除。

SEC-07 已验收：SDK 仅加载已确认的上下文文本，未信任内容不自动加载；扩展、脚本、技能、安装动作和设置合并仍禁用。保存信任不授予工具或命令权限，也不代表系统沙箱。服务端在确认及每轮排队结束后重查，旧预览、链接、越界或不可完整检查来源不获加载许可。[实现、测试来源与证据](docs/architecture/implementation-plan.md#sec-07-已交付边界)已归档。

## 桌面工作区

运行 `pnpm dev:desktop`，从侧栏“打开工作区”、原生“工作台 → 打开工作区…”菜单或 Ctrl+O 进入目录管理。可使用 Windows 文件夹选择器，或输入绝对路径；同一物理目录的大小写 / junction 等别名复用同一工作区。打开、列表切换和“重新校验”都检查目录存在及实际读写 / 清理能力；会短暂创建并删除一个 4 字节 `.pi-workbench-check-` 文件，不读取或执行项目脚本。

目录失效、不可读写或客户端未授权时显示原因与恢复方式，保留既有选择和历史，不创建空会话；取消选择也不改变当前目录。切换只改变查看位置，后台任务继续。资源信任可从当前目录进入独立检查，打开目录本身不授信。当前列表仅代表本窗口已打开的目录；重启后重新打开可复用持久身份，最近列表、重命名及重新定位属于 WS-02。真实会话发送仍待 SESSION-01 等功能接入；本轮未制作安装包，网页独立工作区操作暂缓。

WS-01 的[实现、来源与证据](docs/architecture/implementation-plan.md#ws-01-已交付边界)已归档；完整离线 CI、实际 Windows 选择器及干净目录复现通过，新增真实提供商请求 0。下一步建议 **MODEL-01：发现模型与已有提供商**，随后接入 SESSION-01。

## 本地配置

变量在启动时读取，按实际代码支持的范围使用：

| 变量                                      | 默认与限制                                                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PIW_DATA_DIR`                            | 开发为 `.workbench/dev`；独立 daemon 为 `%LOCALAPPDATA%\PiWorkbench`。测试使用隔离目录；更换路径不会迁移数据                                         |
| `PIW_PORT`                                | daemon 为 `4317`；独立启动可改。当前 Vite 代理固定 4317，整套开发入口保持默认                                                                        |
| `PIW_KERNEL`                              | 未设置或 `fake`；其他值拒绝启动，不可据此启用真实模型                                                                                                |
| `PIW_PI_AGENT_DIR`                        | 默认不读取现有 pi 配置；显式指定目录后由宿主读取凭证元数据、注册脱敏值，并作为用户资源发现来源。未信任资源不加载，不启用真实提供商；不要填写密钥本身 |
| `PIW_DOCS_PORT`                           | 文档为 `8765`；换端口会改变浏览器来源，旧进度副本不会自动迁移                                                                                        |
| `PIW_MAX_KERNELS` / `PIW_MAX_MODEL_TASKS` | 启动时配置内核 / 模型任务上限，默认 `3` / `1`，范围 `1–32` / `1–16`                                                                                  |
| `PIW_MAX_TERMINALS`                       | 预留终端预算，默认 `6`，范围 `1–64`；真实 PTY 在 M4 接入，不表示当前已有终端限流                                                                     |
| `PIW_KERNEL_IDLE_MS`                      | 空闲内核回收时间，默认 `300000` ms；范围 `1–86400000`，不会回收运行 / 待审批内核                                                                     |
| `PIW_EVIDENCE_DIR`                        | E2E / clean 输出为 `.workbench/evidence/latest`；归档指定新目录，避免覆盖旧证据                                                                      |

Vite / Electron 页面固定 `127.0.0.1:5173`。`pnpm start` 需先构建服务，当前只提供 daemon API，不托管生产前端；`pnpm build` 不生成安装包。

## 文档与设计

- [完整文档索引及维护说明](docs/README.md)
- [需求与进度看板](docs/product/roadmap.html) · [产品规划](docs/product/plan.md)
- [交互式 PRD](docs/product/prd.html) · [高保真设计评审](docs/design/review.html)
- [实施方案](docs/architecture/implementation-plan.md) · [项目结构与依赖边界](docs/architecture/project-structure.md)
- [代码规范](docs/development/tooling.md) · [组件采用规则](docs/development/ui-components.md)

```powershell
pnpm docs:dev     # 本机文档预览：http://127.0.0.1:8765/
pnpm docs:build   # 由权威 backlog 与模板生成看板、功能清单和 PRD
pnpm docs:check   # 规划一致性、目录与本地链接校验
```

预览入口为 `/product/roadmap.html`、`/product/prd.html`、`/design/review.html`，旧 PRD / roadmap / 设计稿 URL 保留重定向。自包含看板和 PRD 也可直接打开。浏览器进度仅保存为本地副本，导入及源文件维护方式见文档索引；原型模拟不代表产品实现。

## 检查与验证

```powershell
pnpm fix          # Oxlint 安全修复、排序与 Oxfmt 格式化
pnpm check        # 格式、lint、类型、无用依赖和文档校验
pnpm test:contracts # 定向跑录制、投影、IPC、daemon 内核、快照 / TCP WS 与持久恢复契约
pnpm run ci       # 完整离线门禁，含单测、SDK 冒烟及浏览器 / Electron E2E
pnpm verify:clean # 在新目录复现 frozen 安装、检查、构建、测试与服务启动
```

默认命令无付费模型调用。E2E / clean 使用 5173 / 4317，CORE-05 另用隔离端口 4318 / 4328 / 24348，运行前核对服务归属；新验证输出默认写入 `.workbench/evidence/latest`，可用 `PIW_EVIDENCE_DIR` 指定独立归档目录。历史 [OPS-01 验收](docs/validation/ops-01-acceptance.md)、[M0 阶段门](docs/validation/m0-acceptance.md)及[真实验收预算](docs/validation/live-validation-policy.md)分别保留。

## 目录职责

| 目录          | 用途                                           |
| ------------- | ---------------------------------------------- |
| `apps/`       | desktop、web、daemon 三个应用                  |
| `packages/`   | shared、agent-adapter、ui、config 公共包       |
| `docs/`       | 产品需求、设计、架构、决定、开发说明与归档证据 |
| `scripts/`    | 开发、干净安装验证、文档生成及预览工具         |
| `e2e/`        | 浏览器与 Electron 端到端测试                   |
| `.workbench/` | 本机运行数据、临时文件、日志和未归档验证输出   |

根目录保留工程配置、README 和 AGENTS。详细文档按职责归档，不再平铺；未来的 ledger 等模块随对应需求实现再创建。

版本库保留源码、测试与固定契约录制、需求 / 设计及有引用的验收证据。`spikes/` 整个目录、`.workbench/`、依赖、构建产物和测试报告不提交。M0 的必要验收报告 / 原预算归入 `docs/validation/m0-evidence/`，14 份固定录制归入 `packages/agent-adapter/test/contracts/recordings/`；常规 CI、文档预览与干净安装验证均不依赖本机 spikes。完整历史现场仅本机保留，不将精简归档当作完整文件系统快照，也不重跑已耗尽预算的真实模型。`.gitattributes` 保留历史证据、固定录制与锁文件原始字节，防止 Windows 换行转换破坏指纹。
