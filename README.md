# Pi Workbench

基于 pi agent 的个人、本地优先编码工作台。Windows 桌面优先，保留共用服务与数据的本机网页入口。

AI 参与开发前先读 [AGENTS.md](AGENTS.md)：已确认技术栈、目录边界、协作方式、开发测试及验收规则。

## 开发运行

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

网页入口为 `http://127.0.0.1:5173`；桌面开发改用 `pnpm dev:desktop`，二者不要同时启动。桌面关窗收到托盘，“退出应用”结束其受管开发服务。`pnpm start` 当前只启动构建后的 daemon。

桌面使用轻量控制栏与 Windows 原生窗口按钮。侧栏“设置”、左下设置图标或“文件 → 设置…”进入统一设置；快捷键 Ctrl+,。设置左侧分类与搜索、右侧内容，支持明暗主题；模型、凭证、资源信任、客户端与资源状态集中在此。返回工作台保留当前草稿及展开审查，敏感页面仍须配对；完整字号 / 密度、多窗口和生命周期继续按 UX 条目验收。[布局与边界](docs/design/core-spec.md#electron-控制栏与统一设置--2026-11-02)。

Electron 默认进入 SESSION-01 会话工作台，首次有效发送才保存会话与配置，并经 daemon 调度真实 pi SDK 子进程和本地 HTTP 夹具；模型选择明确标注离线验收，真实提供商仍关闭。浏览器首页和 Electron 的“离线状态样本”（`?samples`）保留 OPS-01 基础壳，样本的命令、Diff、审批和发送不代表真实执行。daemon 的 CORE-04–07 运行底座、SEC-06 / 07 / 08、WS-01 与 MODEL-01 继续复用。开发数据默认位于 `.workbench/dev`。功能进度与本地完成数从 [backlog](docs/product/backlog.json) 计算，不将 SDK 目录或本地凭证状态视为实际模型请求成功。

pnpm 12.16.1 通过 `devEngines.runtime` 使用 Node 24.22.2，首次安装可能下载运行时；用 `pnpm exec node --version` 核对。Electron 首次运行需要下载；浏览器测试使用本机 Chrome。技术栈为 React / TypeScript / Vite、Tailwind / shadcn Base UI、NestJS / Fastify、Drizzle / SQLite 与 pi 原生 JSONL。

```text
浏览器 / Electron → 共享 React 页面（5173）→ /api → Nest daemon（4317）
                                                  ├─ SQLite（索引与恢复记录）
                                                  ├─ fake kernel（当前 UI 样本）
                                                  └─ 受管 pi SDK 子进程（本地夹具）
```

CORE-04 已实现每会话单进程、守卫握手、流式、中止、销毁与故障隔离。SEC-01 已接入固定工具的最终 execute 守卫：仅核验实际 cwd 内的有界普通 UTF-8 文本读取自动执行，宿主捕获快照后 SDK 不重新打开路径；写入、命令及未知能力没有有效审批一律拒绝。最终门禁与原生验收已通过，边界见下方 SEC-01 记录。扩展和真实提供商继续关闭，SDK 使用隔离配置，不读取用户模型认证。SEC-06 可在显式指定来源后由宿主读取现有 pi 凭证状态，不向 SDK 或页面发送凭证。`GET /api/kernels` 只读核对 daemon 管理的会话、代际、PID、cwd 和原生 sessionFile；SESSION-01 的 `/api/chat` 仅接受已配对桌面身份，提交和停止均经 KernelService，SEC-02 已开放最终参数单次审批，真实提供商传输仍关闭。当前启动器不复用已运行的服务；前端热更新不重载 daemon，修改服务后重新构建并重启开发入口。验收边界见[实施方案](docs/architecture/implementation-plan.md)，常见问题见[工具规范与排障](docs/development/tooling.md)。

CORE-05 已验收：`GET /api/protocol` 核对版本与能力，`GET /api/sessions/:sessionId/snapshot` 读取完整观察快照，`WS /api/events` 按游标重放并订阅。已存在运行时可用 `http://127.0.0.1:5173/?observe=<sessionId>` 只读查看，关闭观察不停止任务；不会自动创建会话或调用模型。缺口 / 缓冲不足重新同步，重连不重发任务；不兼容保留内容并禁用变更入口。CORE-06 已补齐重启后的只读历史与中断恢复，CORE-07 已补齐资源调度，接着进入 M2。协议与边界见[实施方案](docs/architecture/implementation-plan.md#core-05-已交付边界)。

OPS-08 已纳入已验收 M1／M2 及本次 M3 文件回滚／审查回归；最终 385 项 Vitest、140 项 E2E、SDK 和 frozen clean 的来源、失败及原生证据见[最新记录](docs/validation/change-04-05-07-09-evidence/acceptance.md)。整体仍进行中，CHANGE-08、其余双端业务和后续平台等跨阶段门继续按 backlog 判断；真实提供商请求 0。

CORE-06 已验收：`GET /api/sessions` 发现受管索引，`http://127.0.0.1:5173/?history=<sessionId>` 查看只读原生历史与恢复记录。默认最新 100 条 / 页，每条预览最多 64 KiB，全文按需读取，展示与导出经过 SEC-06 脱敏；损坏记录保留原件，无法安全解析的内容不导出。独立 inflight 检查点以 1.5 秒为目标间隔，崩溃回复仅标为中断；重启不创建 SDK 进程、不重发队列或恢复旧授权。CORE-06 初次的队列／审批／变更引用由合成记录验证；后续真实业务及本次 M3 回滚事实已接入，各阶段证据分别记录。说明与证据见[实施方案](docs/architecture/implementation-plan.md#core-06-已交付边界)。

CORE-07 已验收：默认最多 3 个活跃内核、1 个模型任务，内核 / 模型各自 FIFO，支持内部任务入口取消；空闲内核按 LRU 或 300 秒超时回收，运行 / 待审批不回收。显式打开时从受管原生历史冷恢复，不额外复制历史、不重放输入或旧授权。`http://127.0.0.1:5173/?resources` 只读查看实际占用、限额和顺序；网页发送 / 取消接口随 M2 开放。终端仅预留 6 个预算，真实 PTY 在 M4 验收。完整 **118 项单元 / 集成、21 项浏览器 / Electron E2E**、SDK 冒烟与干净目录验证通过，新增真实提供商请求 0；[边界与证据](docs/architecture/implementation-plan.md#core-07-已交付边界)已归档。OPS-08 后续阶段继续进行，不据此把整个 M1 功能统计记成 100%。

SEC-06 已验收：从工作台顶部进入“凭证与隐私”，或打开 `http://127.0.0.1:5173/?credentials`，查看来源、缺失 / 过期等元数据，不回显密钥。默认离线且不读取真实配置；设置 `PIW_PI_AGENT_DIR` 指向既有 pi 配置目录后重启，宿主只读状态，不执行凭证命令、刷新 OAuth 或调用模型。凭证仍由原生 pi 文件保存，不复制到业务库；宿主内部更新具备锁、冲突与失败保护，保留其他配置及文件访问权限。日志、审批摘要、REST / WS 流式与重放、历史展示和导出共用脱敏规则；含敏感内容只导出安全副本，未知二进制返回 422，原件不变。该过滤覆盖已知凭证及常见格式，无法保证识别所有未知或混淆内容。浏览器修改凭证留待 MODEL-02 配置流程；实际数据入口现已由 SEC-08 配对保护。[实现、测试来源与证据](docs/architecture/implementation-plan.md#sec-06-已交付边界)已归档。

## 本机浏览器配对

桌面启动时通过私有宿主 IPC 自动授权。从桌面“文件”或托盘菜单选择“连接本机浏览器”，打开两分钟有效的一次性链接，在页面确认配对。网页开发用 `pnpm dev` 后，在同一个交互终端输入 `pair`，打开生成的链接；非交互终端不会输出票据。独立 `pnpm start` 只提供 API，交互终端只输出短期票据，不托管前端。

设置中的“已连接的客户端”或 `http://127.0.0.1:5173/?clients` 可查看身份、截止时间并撤销浏览器（包括自身）。受管观察、历史、资源、凭证、资源信任及 WS 要求有效身份；授权最长八小时，服务重启后全部重新配对。撤销立即断开该客户端观察，后台任务继续；关页也不会停止任务。Cookie 为 HttpOnly / SameSite=Strict，会话票据不写浏览器存储。普通离线样本保持公开；配对不授予工具执行或凭证修改权限。

SEC-08 已验收，完整 CI 与干净目录复现通过，新增真实提供商请求 0；[规则与证据](docs/architecture/implementation-plan.md#sec-08-本机客户端授权边界)已归档。

## 项目与资源信任

配对后，从侧栏下方“资源信任”或 `http://127.0.0.1:5173/?trust` 输入待检查目录，查看项目 / 用户 / 第三方资源的来源、影响与指纹，逐项预览后确认；已有记录可查看和撤销。按你的选择，信任跨重启保存，目录、来源或内容变化后重新确认；浏览器身份仍须按 SEC-08 重新配对。撤销从下一轮生效，当前任务保留已检查快照，历史记录不删除。

SEC-07 已验收：SDK 仅加载已确认的上下文文本，未信任内容不自动加载；扩展、脚本、技能、安装动作和设置合并仍禁用。保存信任不授予工具或命令权限，也不代表系统沙箱。服务端在确认及每轮排队结束后重查，旧预览、链接、越界或不可完整检查来源不获加载许可。[实现、测试来源与证据](docs/architecture/implementation-plan.md#sec-07-已交付边界)已归档。

## 桌面工作区

运行 `pnpm dev:desktop`，从侧栏“打开工作区”、原生“文件 → 打开工作区…”菜单或 Ctrl+O 进入目录管理。可使用 Windows 文件夹选择器，或输入绝对路径；同一物理目录的大小写 / junction 等别名复用同一工作区。打开、列表切换和“重新校验”都检查目录存在及实际读写 / 清理能力；会短暂创建并删除一个 4 字节 `.pi-workbench-check-` 文件，不读取或执行项目脚本。

目录失效、不可读写或客户端未授权时显示原因与恢复方式，保留既有选择和历史，不创建空会话；取消选择也不改变当前目录。切换只改变查看位置，后台任务继续。资源信任可从当前目录进入独立检查，打开目录本身不授信。本窗口已打开列表与持久最近列表分别展示；最近按成功显式打开 / 切换降序，同毫秒顺延，重命名、刷新、校验和重新定位不改排序。最多展示 100 项及总数，记录不表示目录当前可用，打开时重新检查；旧库不伪造最近时间。

最近项菜单可重命名、恢复目录名、从最近移除和重新定位。自定义名去首尾空白后 1–80 个 Unicode 码点，支持 Enter / Escape / IME，失败或版本冲突保留编辑。名称只用于显示，不改文件夹或项目名称。移除只隐藏最近，目录、会话、自定义名、当前窗口和任务均保留，重开复用同身份。重新定位只接受移动后的同一物理目录，原生选择器仅填路径，另行明确保存；既有会话 cwd 不变，旧 cwd 与登记路径不匹配时拒绝续发，不自动把运行任务切到新目录。SESSION-01 在首次提交和执行准入后再次校验实际目录；网页独立工作区操作暂缓，不制作安装包。

WS-01 的[实现、来源与证据](docs/architecture/implementation-plan.md#ws-01-已交付边界)已归档；完整离线 CI、实际 Windows 选择器及干净目录复现通过，新增真实提供商请求 0。

## 模型与已有提供商

在 Electron 侧栏设置区或原生“文件 → 模型与提供商”进入 `?models`。MODEL-01 展示安装的 pi SDK 目录、已有提供商、模型能力、来源文件状态和 pi 默认模型的匹配结果；支持本地搜索、仅看已有配置 / 全部 SDK 目录、分批展示和刷新。过期 / 缺失凭证、未执行的命令型配置、无效端点或 API、配置损坏及离线无模型均给出原因和 pi 配置指引。读取失败保留上次结果并标明已失效。

默认不连接用户配置；设置 `PIW_PI_AGENT_DIR` 指向现有 pi 目录后重启，宿主只读 `auth.json`、`models.json`、`settings.json`，不改写文件或默认选择。只读取 SDK 静态目录与显式模型覆盖，不恢复动态目录缓存、不执行凭证 / 请求头命令、不刷新 OAuth、不加载扩展，也不调用模型。已配置仅表示本地凭证状态，全部模型仍为“未联网验证”，工作台真实传输仍关闭；其他产品账号不会自动赋予 pi 的 API / 订阅权限，环境 / 平台认证未经主动检查时单独标明。

该 API 仅向已配对的桌面宿主开放，网页版独立模型发现暂缓。实际 Electron 菜单、搜索和刷新已验证；来源、限制及证据见 [MODEL-01 边界](docs/architecture/implementation-plan.md#model-01-已交付边界)。本轮不制作安装包。

## 首次发送与草稿

Electron 新会话无需填写名称或项目；全局默认无项目，从项目入口新建则预选该项目。WS-06 已接入侧栏项目创建、改名、置顶、组内上下移、展开和名称 / 路径 / ID 检索；同名以目录及短 ID 区分。已置顶优先，新建位于未置顶末尾，切换置顶进入目标组末尾，跨重启保存。发送前可明确选择模型和经过校验的执行目录；未选目录时，首次提交建立持久的 `<dataDir>/standalone/<sessionId>`，不继承上个项目。已有会话沿用保存的模型 / 目录，续发不会创建第二会话。

项目最多绑定一个经过工作区校验的默认目录；原生选择器只填路径，须明确保存，项目编辑不改变最近工作区排序。不绑定目录时，同项目的每个会话仍各用独立空间。修改默认仅影响未来会话；项目菜单“移除项目分组”经确认后将所属会话归无项目，保留文件、历史、实际 cwd 和后台运行任务，不授予权限。保存失败 / 版本冲突保留编辑，未知创建先核对原请求，不自动重试。会话搜索见下文；SESSION-07 已开放仅整理移入 / 移出项目，实际环境切换仍待 SESSION-13；[WS-06 验收与限制](docs/validation/ws-06-evidence/acceptance.md)已归档。

## 基础会话搜索

Electron 侧栏“搜索会话”或 Ctrl+K 搜索中文标题和已保存的用户 / 助手正文。支持全部、指定或无项目，真实状态、更新时间及归档范围；默认不含归档，空查询显示最近会话，每页 20 项。结果显示归属、时间和脱敏片段；正文结果直接定位原消息及上下文，标题结果打开最新对话。↑↓ 选择、Enter 打开、Escape 取消，保留草稿和后台任务。

查询及筛选默认 200ms 防抖，IME 选词不打开结果或关闭搜索；新条件隐藏旧结果，迟到请求隔离。失败保留条件并提供重试；无结果可清除筛选。全文先经 SEC-06 脱敏再索引和截片，SQLite 搜索表可重建，原生 JSONL 保持权威；历史缺失显示诊断。搜索不启动内核或调用模型，工具 / 文件及旧 CLI 历史不在基础搜索范围。仅已配对桌面可访问，网页独立功能暂缓。完整离线 CI、frozen clean 与真实 Windows 微软拼音 / 原生筛选 / 旧消息定位 / 失败恢复 / 后台状态 / 明暗窄窗 / 正常退出及重启搜索均已验收，SESSION-12 三项通过。[SESSION-12 验收与限制](docs/validation/session-12-evidence/acceptance.md)。

正文、项目、模型、目录和待核对的请求标识在当前窗口保存，切换或刷新可恢复；关闭窗口后的未发送草稿恢复未在本次范围内。Enter 发送、Shift+Enter 换行，中文选词 Enter 不发送。SQLite 原子保存稳定会话 ID、首消息及配置后才启动 SDK；双击和同一请求重试复用原结果。落库前失败保留草稿，落库后的已知失败保留会话；没有工具／审批记录时提供“明确重试此任务”，含工具或审批记录时阻止整任务重放；断线 / 子进程中断等结果未知时先核对原请求，不自动重放。标题使用本地脱敏摘要，不额外调用模型。

当前成功路径仅使用“离线验收模型 · pi SDK 本地夹具”，固定样本回复；SEC-01 的工具夹具通过真实 SDK 和最终守卫验证受限读取与拒绝，扩展关闭，仅开发环境可用。已有 pi 模型可选并保留，但全部未联网验证，真实传输关闭时不能发送；模型消失也不会自动改成夹具。配置不改写，独立网页发送暂缓；SESSION-02 的会话恢复与阅读位置见下文。

SESSION-01 已验收：真实 Windows 微软拼音组合态提交 / 中文选词不误发、原生首发与同会话续发、独立草稿 / 设置返回、目录和明暗窄窗均已补齐。修复同项目新草稿重入丢失显式目录，修复前失败 / 修复后通过；最终完整离线 CI 为 **164 项 Vitest / 40 项浏览器与 Electron E2E**，SDK 冒烟通过。复用修复前 clean 的未变依赖 / 原生模块 / 构建与启停证据，锁哈希一致。真实请求 0；[逐项证据与限制](docs/validation/session-01-evidence/acceptance.md)保留，OPS-08 继续进行中。SESSION-02 的后续验收见下文。

## 恢复、切换与旧 pi 历史

Electron 侧栏切换已保存会话，只改变查看对象。每会话保留独立草稿、阅读消息锚点 / 像素偏移、工具展开、历史分页和所选只读变更引用；最多保留 3 个视图，新草稿也占一个。淘汰视图只断开观察，不停止后台 SDK 任务；侧栏仍显示运行 / 待审批 / 待处理状态。重连、重开或刷新后获取最新权威状态，不重复发送，后台结果不换当前面板。小型书签与草稿只在当前窗口 sessionStorage 保存；整个应用重启后的草稿与跨窗口同步不在本次范围。

侧栏“旧 pi 历史 · 只读”或 `?legacy` 发现显式 `PIW_PI_AGENT_DIR/sessions` 下的 v3 JSONL；未指定时不读取默认用户路径。展示原来源 / cwd / 时间与只读状态，最多 2000 目录项、200 文件、单文件 16 MiB，100 消息 / 页、64 KiB 预览及按版本全文。CLI 同写 / 替换要求刷新，半行和损坏可诊断；不迁移、改写源文件、恢复授权或启动内核，续聊尚未开放。该入口仅向已配对 Electron 身份开放，内容统一脱敏。

SESSION-02 已验收：完整 **170 项 Vitest / 44 项浏览器与 Electron E2E**、SDK 冒烟、本次 frozen 干净目录复现与实际 Windows Electron 操作已归档。原生临时脚本在退出后额外读已关闭 SQLite 而退出 1，操作结果与该收尾错误分开记录，正常启停另有 CI / clean 证据。最终标题状态布局与草稿回执隔离修改复用未变基础设施，完整 CI 重新通过；真实提供商新增请求 0，pi 配置 / 预算未改，无安装包。见[逐项证据与限制](docs/validation/session-02-evidence/acceptance.md)。OPS-08 继续进行中；SESSION-03 后续交付见下文。

## 本地配置

变量在启动时读取，按实际代码支持的范围使用：

| 变量                                      | 默认与限制                                                                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PIW_DATA_DIR`                            | 开发为 `.workbench/dev`；独立 daemon 为 `%LOCALAPPDATA%\PiWorkbench`。测试使用隔离目录；更换路径不会迁移数据                                                           |
| `PIW_PORT`                                | daemon 为 `4317`；独立启动可改。当前 Vite 代理固定 4317，整套开发入口保持默认                                                                                          |
| `PIW_KERNEL`                              | 未设置或 `fake`；其他值拒绝启动，不可据此启用真实模型                                                                                                                  |
| `PIW_PI_AGENT_DIR`                        | 默认不读取现有 pi 配置；显式指定目录后由宿主只读凭证 / 模型 / 默认选择元数据、注册脱敏值，并作为用户资源发现来源。未信任资源不加载，不启用真实提供商；不要填写密钥本身 |
| `PIW_DOCS_PORT`                           | 文档为 `8765`；换端口会改变浏览器来源，旧进度副本不会自动迁移                                                                                                          |
| `PIW_MAX_KERNELS` / `PIW_MAX_MODEL_TASKS` | 启动时配置内核 / 模型任务上限，默认 `3` / `1`，范围 `1–32` / `1–16`                                                                                                    |
| `PIW_MAX_TERMINALS`                       | 预留终端预算，默认 `6`，范围 `1–64`；真实 PTY 在 M4 接入，不表示当前已有终端限流                                                                                       |
| `PIW_KERNEL_IDLE_MS`                      | 空闲内核回收时间，默认 `300000` ms；范围 `1–86400000`，不会回收运行 / 待审批内核                                                                                       |
| `PIW_EVIDENCE_DIR`                        | E2E / clean 输出为 `.workbench/evidence/latest`；归档指定新目录，避免覆盖旧证据                                                                                        |

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
pnpm test:contracts # 定向跑录制、投影、IPC、daemon 内核、快照 / TCP WS、持久恢复与模型发现契约
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

## 会话列表、置顶、未读与归档（SESSION-03）

SESSION-11 的最终验收见下方专节；SESSION-03 的历史证据继续保留。

Electron 侧栏按已置顶、项目和最近无项目组织，可从行菜单置顶、手动标记已读 / 未读、归档及恢复。整理状态跨重启保留；新完成、失败或中断结果产生未读，只有活动窗口实际展示并读到最新才自动清除，历史中段和隐藏缓存保持未读。归档保留历史和草稿并禁发；恢复不运行任务或恢复授权。

后台运行由 daemon 的实际提交 / SDK / 队列状态驱动。运行中归档明确说明先停止，服务确认结束后仍需再次点击确认归档；取消弹窗不停止后台任务。待审批 / held 队列先处理，整理入口不代替生产审批。保存失败 / 版本冲突保留内容，断线暂不可整理，不显示乐观成功。

SESSION-03 已验收：Electron 置顶 / 未读 / 归档由 daemon SQLite 持久保存，恢复不启动内核或旧授权；新完成 / 失败 / 中断结果标未读，仅活动窗口实际展示并读到最新才清除，支持手动标记。后台真实状态独立于视图，运行中归档先明确停止，等待服务确认后再次单独确认；取消归档保持同 SDK PID 继续运行。新增 7 项服务 / 5 项 Electron 流程，完整 179 项 Vitest / 49 项浏览器与 Electron E2E、SDK 冒烟通过；本次 frozen clean 通过，最后提示文案仅复用未变基础设施，完整 CI 已补跑。原生 Windows 重启持久 / 恢复 / 中段未读 / 后台停止归档及两次正常退出通过；真实请求 0，配置 / 预算未改，无安装包。实际 Windows 中文直接输入与 SESSION-01 真实微软拼音证据分开；原生最大化为 1920×1032 工作区，1080p / 深色 / 窄窗另由 Electron E2E 覆盖。[逐项验收与限制](docs/validation/session-03-evidence/acceptance.md)。OPS-08 继续进行中；SESSION-11 的后续验收见下节。

## 会话重命名与多端同步（SESSION-11）

Electron 的侧栏 / 标题菜单共用重命名框，支持预填、去首尾空白后的 1–80 个 Unicode 码点、Enter / Escape、失败保留、版本冲突与人工标题保护。两 Electron 和已有配对浏览器历史只读同步；重连补读标题索引，旧列表 / 回执不倒退标题。SQLite 来源 / 版本持久，改名不改 SDK 历史、目录或后台任务。

SESSION-11 三项验收均通过：完整 **185 项 Vitest / 53 项浏览器和实际 Electron E2E**、SDK 冒烟与 frozen clean 通过；真实微软拼音候选 Enter / Escape / Space 选词、原生预填 / 取消 / 写失败恢复、标题同步和重启持久化已补齐。原生 SendInput 与合成 composition 分开记录，两个 SDK 历史文件字节不变，两次正常退出通过。本轮未改产品代码，230 个产品 / 测试 / 根配置文件与 clean 一致，按用户要求复用已通过门禁。SESSION-11 标为 `verified`，该次本地完成数为 **17 / 133**，当前进度见下方 WS-02 记录；OPS-08 继续进行中。真实请求 0，pi 配置 / 预算未改，无安装包；[逐项结果、门禁和下一步提示词](docs/validation/session-11-evidence/acceptance.md)。

## 最近工作区与重命名验收

WS-02 两项验收通过：完整 **192 项 Vitest / 57 项浏览器和 Electron E2E**、SDK 冒烟、本次 frozen clean，以及 25 步真实 Windows 微软拼音 / 原生选择器 / 失败恢复 / 后台同 PID / 重启持久与两次正常菜单退出均已归档。产品代码未再改动，文档 / PRD / 进度回填后另跑完整 check。该次本地完成数为 **18 / 133**，OPS-08 继续进行中；下一项建议 WS-06 项目管理、分组与侧栏组织。真实提供商请求 0、pi 配置 / 预算不变，无安装包；[逐项结果、边界及下一步提示词](docs/validation/ws-02-evidence/acceptance.md)。

## 工作区与 Git 环境（WS-03）

Electron 对话标题下及工作区详情显示真实 cwd、最近所属仓库、分支／detached／尚无提交；子模块补充主仓库，非 Git 明确标注。后台本地检查与“刷新环境标识”仅观察，不切换分支、不改配置或已有会话目录，不调用模型。切换后旧响应隔离，失联／Git 缺失／元数据异常显示未知和恢复指引。多个或嵌套仓库按当前 cwd 判断，不自动扫描全部子目录。实现及自动门禁见 [WS-03 验收](docs/validation/ws-03-evidence/acceptance.md)；已完成 28 步 Windows 原生补验、同 PID／epoch 后台与 cwd 保留、明暗 800px 窄窗、同 data/profile 重启及两次正常退出；277 文件与 clean 一致，复用完整 217 项 Vitest／72 项 E2E、SDK 与 frozen clean。WS-03 verified，该次本地 21／133；OPS-08 继续进行。

INPUT-01 两项验收已通过：Enter／换行／真实 Windows 中文 IME、空白拒绝、独立草稿与项目／模型保留；两项新增 Electron E2E及27条原生观察见[验收记录](docs/validation/input-01-evidence/acceptance.md)。刷新使用真实 Electron 自动测试证明；两项新增测试已包含于本次 SESSION-07 完整223／78、SDK和clean门禁。

## 无项目会话与独立执行空间（SESSION-07）

Electron 全局“新会话”默认无项目，首次发送后显示真实持久独立目录。标题菜单“执行空间与项目归属”可查看创建来源、全局／当前目录资源的发现、下轮可加载与当前轮已加载状态；工具、命令、扩展及真实模型传输仍关闭。选择目标并明确确认仅整理分组，保留cwd、历史、文件、原始来源和后台任务；失败保留选择、冲突明确核对，完整环境迁移仍待SESSION-13。

本次完整 **223项Vitest／78项浏览器及Electron E2E**、SDK冒烟和frozen clean通过，包含INPUT-01新增回归。29条实际Windows观察覆盖首发／续发、失败恢复、同PID／epoch后台、明暗窄窗、同data/profile重启和两次正常菜单退出；重启0内核／0新请求，282文件与clean一致，原生后复用门禁。当前本地 **23 / 133**；OPS-08继续进行，真实提供商请求0。[逐项证据与下一步提示词](docs/validation/session-07-evidence/acceptance.md)。

## 工作区信任与不可用恢复（WS-07）

Electron 对话中显示项目资源受限、目录失效原因、重新校验和同物理目录重新定位。目录失效时 daemon 独立于视图停止相关排队／后台任务，历史和草稿保留；恢复只检查，不重发。工作区重新定位不改已有会话 cwd，旧会话需要恢复原路径；新位置可明确新建会话，完整环境迁移仍属 SESSION-13。资源确认绑定来源、内容与物理目录；旧路径指纹需重新确认，扩展／脚本／安装仍禁用。已完成自动与原生验收，具体门禁及边界见 [WS-07 记录](docs/validation/ws-07-evidence/acceptance.md)。

WS-07 已验收：完整230项Vitest／82项浏览器及Electron E2E、SDK与frozen clean通过；68条原生观察补齐未信任资源、真实路径丢失与Windows ACL后台停止、原cwd／历史／草稿保留、同物理目录重新定位与明确恢复、明暗800px窄窗、同data/profile重启0内核／0新请求及两次正常菜单退出。288个代码文件与clean一致，原生后复用门禁；本地24／133，OPS-08继续in_progress。真实提供商0、pi配置／canonical预算／锁未改，无安装包，网页独立功能暂缓。

## OBS-01 已验收

Electron流式与安全内容展示已验收：每帧累计全部delta，非delta状态即时冲刷，权威终态替换去重；CommonMark/GFM安全Markdown、仅显式HTTP(S)链接、禁止自动图片和原始HTML执行、本地协议惰性。16k预览可展开，64k以上纯文本、12k以上代码不高亮，未知语言／未闭合围栏／可选模块失败回退；按需Shiki与异步身份保护。8项新增Vitest、4项新增Electron流程；完整238项Vitest／86项E2E、SDK和frozen clean通过。Windows原生富文本／纯文本切换、长内容展开／收起、明暗主题、同data/profile重启0请求及两次正常退出补证。图示仅惰性代码，未接入执行型图示。真实提供商0、pi配置／canonical预算未改，无安装包，网页独立功能暂缓；OPS-08继续in_progress。[逐项证据与下一步提示词](docs/validation/obs-01-evidence/acceptance.md)。

## OBS-04 已验收

OBS-04 已验收：Electron 回看不强拉、按消息计数、显式／键盘返回最新、消息锚点与偏移跨分页／3 视图淘汰／renderer 刷新恢复；长文展开保持现场、收起不留空白，后台完成或合成审批观察不抢当前焦点与面板。新增 2 项 Vitest／4 项实际 Electron 回归，完整 31 文件／240 项 Vitest、90 项 E2E、SDK 和 frozen clean 通过；60 条 Windows 原生观察、明暗窄窗、后台同 PID／epoch、同 data/profile 重启 0 内核／0 新请求及两次正常菜单退出补证。304 文件与 clean 一致，原生后复用门禁；当前本地 26 / 133，OPS-08 继续 in_progress。分页行／审批观察均明确为合成样本，完整应用重启不承诺窗口书签；真实提供商 0，配置／canonical 预算／锁未改，无安装包，网页独立功能暂缓。[逐项证据与下一步提示词](docs/validation/obs-04-evidence/acceptance.md)。

## OBS-03 工具时间线

OBS-03 已验收 Electron 工具时间线：调用身份／最终参数与父子关联、拒绝／失败／取消／结果未知、乱序终态保护、脱敏长文明确展开和可验证摘要；未知指标显示未知，Diff 仅观察。原生 Windows 工具卡／长输出／逐轮隔离、后台同 PID／epoch 与焦点、明暗窄窗、同 data/profile 重启不重发和正常退出均已补证，两项勾选。真实提供商 0，工具／扩展继续禁用，不改 pi 配置／canonical 预算，无安装包，网页独立功能暂缓；OPS-08 继续 in_progress。[实现、验证来源与继续提示词](docs/validation/obs-03-evidence/acceptance.md)。

OBS-03 已验收：完整 35 文件／251 项 Vitest、93 项浏览器及 Electron E2E、SDK 冒烟与 frozen clean 通过；Windows 原生工具身份／摘要／长输出脱敏与收起、跨会话及逐轮展开隔离、后台同 PID／epoch 和焦点、明暗 802px 窄窗、同 data/profile 只读重启 0 内核／0 新发送／0 注入、历史哈希不变及正常菜单退出已补证。316 文件与 CI／clean 一致，原生后复用门禁；仅文档模板另更新。两项勾选，当前本地 27 / 133，OPS-08 继续 in_progress。合成工具观察与真实 SDK 禁用工具错误分开，未开启生产工具／审批／MCP／回滚；真实提供商 0，配置／预算／锁未改。

## OBS-06 已验收

OBS-06 已验收公开思考权限过滤、默认折叠、脱敏复制下载、本窗口隐藏与明确缺失状态。静态检查、257 项 Vitest／SDK通过；一次 CI 的既有 E2E 超时保留，随后完整95项E2E通过；最终边界加强经47项相关测试、2项Electron和完整frozen clean验证。56条Windows原生观察、明暗802px窄窗、同data/profile重启0发送／0内核、历史哈希不变及两次正常退出补证。319文件与clean一致，原生后复用门禁。本地28／133，OPS-08继续in_progress；真实提供商0，pi配置／预算／锁未改，无安装包，网页独立功能暂缓。[逐项证据与下一步提示词](docs/validation/obs-06-evidence/acceptance.md)。

## MODEL-07 已验收

MODEL-07 已验收：实际 SDK 请求计数、零自动重试策略、脱敏原错误、权威等待期限／未知等待／到期不执行、终态清除等待、同操作错误合并及工具／审批阻止整任务重放。完整261项Vitest／97项E2E、SDK与frozen clean，55条Windows原生观察、同data/profile重启0请求／0内核及两次正常退出；真实提供商0。 当前本地29／133，OPS-08继续in_progress。pi配置／预算／锁未改，无安装包，网页独立功能暂缓。[逐项证据与下一步提示词](docs/validation/model-07-evidence/acceptance.md)。

## INPUT-06 已验收

INPUT-06 已验收：daemon持久有界引导／追加队列、实际SDK边界FIFO、settled后追加新轮、编辑CAS与失败保留、停止／重启held及单条明确恢复。完整40文件／264项Vitest、99项E2E、SDK与frozen clean通过；78条Windows原生观察、后台同PID／epoch／cwd、明暗802px窄窗及两次正常退出，同data/profile重启0发送／0内核且历史不变。329文件与clean一致，原生后复用门禁；短边界原生顺序未建立，SDK顺序和合成IME守卫以自动测试为证。当前本地30／133，OPS-08继续in_progress；真实提供商0，pi配置／预算／锁未改，无安装包，网页独立功能暂缓。[逐项证据与下一步提示词](docs/validation/input-06-evidence/acceptance.md)。

## OBS-02 已验收

OBS-02 已验收：单一主阶段、按操作合并错误、终态消隐及停止请求／确认／未知分开。完整42文件／270项Vitest、102项E2E、SDK与frozen clean通过；88条Windows原生观察补齐正常终态消隐、停止失败同PID后台、SDK aborted确认、held不能消隐、脱敏错误详情、设置返回与明暗802px窄窗。两次正常退出；同data/profile重启0发送／0内核，四份JSONL哈希不变。335文件与clean一致，原生后复用门禁；首发握手超时与明确重试分开记录。当前本地31／133，OPS-08继续in_progress；真实提供商0，pi配置／预算／锁未改，无安装包，网页独立功能暂缓。[逐项证据与下一步提示词](docs/validation/obs-02-evidence/acceptance.md)。

## SEC-01 已验收

SEC-01 已验收：固定工具在 SDK 最终 execute 处冻结参数并经宿主私有 IPC 裁决，多个规则取最高风险；仅实际 cwd 内核验后的有界 UTF-8 快照读取自动，写入与命令无有效审批拒绝，参数改写／嵌套不继承许可。完整44文件／281项Vitest、104项E2E、SDK与frozen clean通过；80条Windows原生观察（含中间态与重试）、后台同PID／epoch、明暗802px窄窗、同data/profile重启0发送／0内核、三份JSONL哈希不变及两次正常菜单退出补证。扩展、MCP、真实提供商关闭；审批交互、会话授权、写入基线仍属后续。当前本地32／133，OPS-08继续in_progress。真实提供商0，pi配置／canonical预算／锁未改，无安装包，网页独立功能暂缓。[逐项证据与下一步提示词](docs/validation/sec-01-evidence/acceptance.md)。

## SEC-02 已验收

SEC-02 已验收：daemon 独占无倒计时的最终参数单次审批，首个有效多端决定生效，保存先于许可；取消、停止、IPC／内核／策略及退出失效，重启不恢复旧授权。完整45文件／292项Vitest、107项E2E、SDK与frozen clean通过；56条Windows原生观察（含中间态，另排除1张非产品截图）、两次正常退出、同data/profile重启0发送／0内核／0待审批，3份JSONL哈希不变。347文件与clean一致，原生后复用门禁；此前两次完整失败与安装命令记录分别保留。原生命令仅核对／取消，实际执行由自动Electron覆盖；没有新增真实IME证据。当前本地33／133，OPS-08继续in_progress；真实提供商0，pi配置／canonical预算／锁未改，无安装包，网页独立功能暂缓。[逐项证据与下一步提示词](docs/validation/sec-02-evidence/acceptance.md)。

## SEC-03 已验收

SEC-03 已验收：daemon 独占显式完整参数／物理目录会话授权，L3与嵌套始终单次；单条／全部撤销先同步失效，最终异步检查后重查，重启不恢复授权。无CHANGE基线时每次仍须单独确认本次不可回滚执行，撤销不停止已运行动作。完整46文件／300项Vitest、111项E2E、SDK与frozen clean通过；102条Windows原生观察含802px审批遮挡缺陷及修复、三次正常菜单退出、同data/profile重启0授权／0待审批／0内核／0发送，JSONL哈希不变。353文件与clean一致；三轮CI失败与定向受干扰失败、HTTP500夹具及原生IME／焦点限制见证据。当前本地34／133，OPS-08继续in_progress；真实提供商0，pi配置／canonical预算／锁未改，无安装包，网页独立功能暂缓。[逐项证据与下一步提示词](docs/validation/sec-03-evidence/acceptance.md)。

## SEC-09 已验收

SEC-09 已验收：daemon追加审计、审批与新授权同事务，撤销先失效且失败不复活。Electron设置及原生菜单只读筛选、固定快照分页和本页脱敏导出，原件保留无删除入口。完整47文件／307项Vitest、114项E2E、SDK与frozen clean通过；58条Windows原生观察中4条系统文件列表为隐私省略，明暗802px窄窗、两次正常退出和同data/profile重启0发送／0内核／0授权通过，JSONL与pi配置／预算／锁哈希不变。361文件与clean一致；原生保存框取消，实际导出文件由自动Electron验证。真实提供商0，无安装包，网页独立功能暂缓，OPS-08继续in_progress。 当前本地35／133。见[逐项证据与下一步提示词](docs/validation/sec-09-evidence/acceptance.md)。

## SEC-10 已验收

SEC-10 已验收：受管文件工具按真实物理 cwd 逐级核验，统一拒绝设备／数据流／歧义路径、链接及目录外目标，不开放附加根。文件命令、bash、引用／展开／重定向／控制运算符和未知命令均单次；少量无文件目标的 PowerShell 字面量才可精确参数会话授权，界面明确没有 OS 文件／网络沙箱。完整47文件／311项Vitest、115项E2E、SDK与frozen clean通过；59条Windows原生观察、明暗窄窗、两次正常退出和同data/profile重启零发送／零内核／零待审批／零授权，JSONL与配置／预算／锁哈希不变。361文件与clean一致；真实提供商0，无安装包，网页独立暂缓，OPS-08继续in_progress。 当前本地36／133。见[逐项证据与下一步提示词](docs/validation/sec-10-evidence/acceptance.md)。

## MODEL-03 已验收

MODEL-03 已验收：0013会话模型CAS与安装SDK逐请求prepareRequest边界；空闲保存不请求，运行中对下一次模型请求（含工具续请求）生效并展示待生效，SDK确认后更新实际配置。固定离线模型按能力禁用思考选项，保存失败保留、版本冲突须明确核对，附件和真实提供商传输仍关闭。完整48文件／315项Vitest、117项E2E、SDK与frozen clean通过；85条Windows原生观察、明暗窄窗、两次正常退出及同data/profile重启0发送／0内核，JSONL与pi配置／预算／锁哈希不变。365文件与clean一致，原生后复用门禁；真实提供商0，无安装包，网页独立暂缓，OPS-08继续in_progress。 当前本地37／133。见[逐项证据与下一步提示词](docs/validation/model-03-evidence/acceptance.md)。

## MODEL-05 已验收

MODEL-05 已验收：只读SDK原生历史，按会话／轮次／模型消息追溯输入、输出、缓存与总量，部分和保留未知次数；SDK默认零值不冒充实际报告。最近请求只作上下文参考，窗口来自同源离线模型元数据，未知模型／价格来源／价格时间及费用明确未知，不造账单。完整50文件／317项Vitest、118项E2E、SDK及frozen clean通过；54条Windows原生观察、明暗802px窄窗、故障恢复、两次正常退出及同data/profile重启0发送／0内核，JSONL与pi配置／预算／锁哈希不变。371文件与clean一致，原生后复用门禁；真实提供商0，无安装包，网页独立暂缓，OPS-08继续in_progress。 当前本地38／133。见[逐项证据](docs/validation/model-05-evidence/acceptance.md)。

## 轮次文件版本、来源与历史 Diff

受管轮次在写入前保存独立 Git 基线，落稳或实际进程退出后持久保存收尾与结果。基线失败先暂停，只有单次明确接受不可回滚执行才能继续。工具来源显示实际观察一致、混合或未知；文件列表和只读 Diff 固定到所选轮次的历史版本，当前文件变化不替换历史。Electron 在版本区展开来源并打开审查，窄窗使用可关闭 Dialog。切换和关闭审查保留后台任务，重启不恢复许可或自动重放。

CHANGE-01／02／03 的基线、来源与历史 Diff 继续保留。[此前记录](docs/validation/change-02-03-evidence/acceptance.md)对应当时无回滚的交付范围。CHANGE-05／07／09／04 已验收：整文件／整轮预检与单独覆盖确认、条件补偿、不可变历史与当前条件重算、持久回滚事实及 SDK 环境说明、接受和成功回滚的 2/2 处理进度。最终 58 文件／385 项 Vitest、SDK、140 项 E2E 与 frozen clean 通过；228 条 Windows 原生观察含中间态，四组同 data/profile 只读重启与八次正常菜单退出补证。真实提供商 0，配置／canonical 预算／锁未改，OPS-08 继续 in_progress；范围／容量／保留 CHANGE-08 和代码块 CHANGE-06 未交付。本地 46/133；[逐项证据与下一步提示词](docs/validation/change-04-05-07-09-evidence/acceptance.md)。

## 回滚范围、容量与版本保留

此前 CHANGE-05／07／09／04 记录中的“CHANGE-08 未交付”为当时范围；本次已完成。审批和历史详情显示范围、排除项、容量和必要版本保留，写入前基线失败仍暂停，混合／未知来源须产品内单独确认覆盖。容量不足保留旧版本并暂停新采集，失效引用禁止回滚；没有自动过期／清理或代码块回滚。

CHANGE-08 已验收：审批与历史详情共用可回滚／部分／不可回滚范围，沿用 5 MiB／32 MiB／2048 项／8 层限制；每物理目录 512 MiB Git 对象估算、80% 预警，容量未知／不足暂停且保留所有已发布版本。失效诊断禁用回滚，执行在物理租约内重验原引用，预检后失效整批零写。最终 59 文件／398 项 Vitest、SDK、144 项 E2E 与完整 frozen clean 通过；78 条 Windows 原生观察含中间态，明暗 802×961、容量及引用故障、两次正常菜单退出和同 data/profile 重启零重放通过，5 份 JSONL 哈希不变。429 输入与 clean 一致，最终 CI 仅另有既有 SEC-08 测试等待修正，完整 clean 已覆盖，复用未变产品／窗口阶段。真实提供商 0，pi 配置／canonical 预算／锁未改；OPS-08 仍 in_progress [true,false]。代码块回滚和清理／删除版本未交付。 本地47/133；[逐项证据、失败记录与下一步提示词](docs/validation/change-08-evidence/acceptance.md)。

## FILE-06 已验收

外部打开先重验路径／版本／行号，Electron main以固定参数数组交付。默认发现VS Code，原生选择只保存、另点打开；编辑器失效可更换，不安装程序。查看／切换保留后台任务，重启不重放打开。完整450项Vitest／175项E2E、SDK、frozen clean和Windows原生证据见[验收记录](docs/validation/file-06-evidence/acceptance.md)。系统打开原生仅达到Windows选择器，不承诺最终关联应用已启动。真实提供商0。

## FILE-03 已验收

FILE-03 已验收：有界UTF-8／BOM／统一换行编辑、撤销、四稿暂存与明确保存；daemon复用物理目录互斥并在独占句柄内重验身份／ACL／完整字节版本，冲突保稿、覆盖单独确认。完整459项Vitest／180项E2E、SDK、frozen clean、79条原生观察和同profile零重放／两次正常退出通过；480输入未变后复用门禁。真实提供商0，pi配置／预算／锁及原目录工作不改，OPS-08继续in_progress。见[验收记录](docs/validation/file-03-evidence/acceptance.md)。
