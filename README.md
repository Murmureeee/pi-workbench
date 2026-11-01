# Pi Workbench

基于 pi agent 的个人、本地优先编码工作台。Windows 桌面优先，保留共用服务与数据的本机网页入口。

AI 参与开发前先读 [AGENTS.md](AGENTS.md)：已确认技术栈、目录边界、协作方式、开发测试及验收规则。

## 开发运行

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

网页入口为 `http://127.0.0.1:5173`；桌面开发改用 `pnpm dev:desktop`，二者不要同时启动。桌面关窗收到托盘，“退出应用”结束其受管开发服务。`pnpm start` 当前只启动构建后的 daemon。

普通页面是 OPS-01 已验收的离线基础壳，会话、命令、Diff 和发送使用带来源标记的样本；daemon 已接入 CORE-04 受管 SDK 子进程、CORE-05 REST / WS 快照与重放，以及 CORE-06 持久化 / 只读故障恢复，使用本地夹具验证，真实提供商仍关闭。开发数据默认位于 `.workbench/dev`。CORE-01–06 和 OPS-01 共 7 / 133 项本地功能已验收，具体状态以 [backlog](docs/product/backlog.json) 为准。

pnpm 12.16.1 通过 `devEngines.runtime` 使用 Node 24.22.2，首次安装可能下载运行时；用 `pnpm exec node --version` 核对。Electron 首次运行需要下载；浏览器测试使用本机 Chrome。技术栈为 React / TypeScript / Vite、Tailwind / shadcn Base UI、NestJS / Fastify、Drizzle / SQLite 与 pi 原生 JSONL。

```text
浏览器 / Electron → 共享 React 页面（5173）→ /api → Nest daemon（4317）
                                                  ├─ SQLite（索引与恢复记录）
                                                  ├─ fake kernel（当前 UI 样本）
                                                  └─ 受管 pi SDK 子进程（本地夹具）
```

CORE-04 已实现每会话单进程、守卫握手、流式、中止、销毁与故障隔离；工具 / 扩展全部禁用，不读取用户模型认证。`GET /api/kernels` 只读核对 daemon 管理的会话、代际、PID、cwd 和原生 sessionFile；进程按内部服务显式创建，没有向页面开放 prompt / 审批写接口。运行页面顶部可切换“离线状态样本”和明暗主题；样本中的发送、审批和审查不代表实际执行。当前启动器不复用已运行的服务；前端热更新不重载 daemon，修改服务后重新构建并重启开发入口。验收边界见[实施方案](docs/architecture/implementation-plan.md)，常见问题见[工具规范与排障](docs/development/tooling.md)。

CORE-05 已验收：`GET /api/protocol` 核对版本与能力，`GET /api/sessions/:sessionId/snapshot` 读取完整观察快照，`WS /api/events` 按游标重放并订阅。已存在运行时可用 `http://127.0.0.1:5173/?observe=<sessionId>` 只读查看，关闭观察不停止任务；不会自动创建会话或调用模型。缺口 / 缓冲不足重新同步，重连不重发任务；不兼容保留内容并禁用变更入口。CORE-06 已补齐重启后的只读历史与中断恢复，下一项为 **CORE-07**。协议与边界见[实施方案](docs/architecture/implementation-plan.md#core-05-已交付边界)。

OPS-08 的 M1 契约基线已接入；CORE-06 本轮完整门禁为 **106 项单元 / 集成、19 项浏览器 / Electron 测试通过**，干净目录验证通过，新增真实提供商请求 0。OPS-08 整体仍为进行中，M2 真实交互与后续回滚门禁待随功能补齐；[阶段矩阵与证据](docs/development/tooling.md#ops-08-契约回归门禁)说明限制。

CORE-06 已验收：`GET /api/sessions` 发现受管索引，`http://127.0.0.1:5173/?history=<sessionId>` 查看只读原生历史与恢复记录。默认最新 100 条 / 页，每条预览最多 64 KiB，完整原文按需读取；损坏记录可诊断并按原始字节导出。独立 inflight 检查点以 1.5 秒为目标间隔，崩溃回复仅标为中断；重启不创建 SDK 进程、不重发队列或恢复旧授权。队列 / 审批 / 变更引用的存储用明确标记的合成记录验证，真实业务服务与 M3 回滚尚未接入。说明与证据见[实施方案](docs/architecture/implementation-plan.md#core-06-已交付边界)。

## 本地配置

变量在启动时读取，按实际代码支持的范围使用：

| 变量               | 默认与限制                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `PIW_DATA_DIR`     | 开发为 `.workbench/dev`；独立 daemon 为 `%LOCALAPPDATA%\PiWorkbench`。测试使用隔离目录；更换路径不会迁移数据 |
| `PIW_PORT`         | daemon 为 `4317`；独立启动可改。当前 Vite 代理固定 4317，整套开发入口保持默认                                |
| `PIW_KERNEL`       | 未设置或 `fake`；其他值拒绝启动，不可据此启用真实模型                                                        |
| `PIW_DOCS_PORT`    | 文档为 `8765`；换端口会改变浏览器来源，旧进度副本不会自动迁移                                                |
| `PIW_EVIDENCE_DIR` | E2E / clean 输出为 `.workbench/evidence/latest`；归档指定新目录，避免覆盖旧证据                              |

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

默认命令无付费模型调用。E2E / clean 使用 5173 / 4317，CORE-05 另用隔离端口 4318 / 4328，运行前核对服务归属；新验证输出默认写入 `.workbench/evidence/latest`，可用 `PIW_EVIDENCE_DIR` 指定独立归档目录。历史 [OPS-01 验收](docs/validation/ops-01-acceptance.md)、[M0 阶段门](docs/validation/m0-acceptance.md)及[真实验收预算](docs/validation/live-validation-policy.md)分别保留。

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
