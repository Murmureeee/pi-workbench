# 项目结构设计

日期：2026-11-01。状态：用户已确认单仓库及应用 / 公共包拆分，OPS-01 已建立应用与共享包并完成离线基线验收。关联 OPS-01、OPS-08、CORE-04–07、UX 及后续模块。全量范围和实现进度仍由 backlog 管理。

## 已确认选择与工程验证

用户已确认 Windows 桌面优先、保留本机网页入口；首个重点交付目标 M3；服务采用 NestJS + Fastify 适配器；存储采用 SQLite + pi 原生 JSONL。

第 2 轮已确认 pnpm workspace 单仓库、React / Vite / Tailwind / shadcn（Zustand / Query）与 Drizzle + better-sqlite3。下述目录和依赖边界按此落地；内部文件名可在不改变边界时调整，OPS-01 的精确版本、兼容验证与边界见 docs/validation/ops-01-acceptance.md。

## 当前目录与后续边界

```text
pi-workbench/
├─ apps/
│  ├─ desktop/                  Electron main / preload，窗口与系统集成
│  ├─ web/                      桌面与浏览器共用的前端
│  │  └─ src/
│  │     ├─ app/                入口、路由、全局 providers
│  │     ├─ features/           sessions / composer / approvals / changes ...
│  │     ├─ services/           HTTP / WS 客户端和查询操作
│  │     └─ stores/             领域投影与界面状态，按会话隔离
│  └─ daemon/                   独立 Node 服务；NestJS + Fastify
│     ├─ src/
│     │  ├─ bootstrap/          CLI、服务启动 / 停止、适配器与全局过滤器
│     │  ├─ modules/            每个业务领域一个 Nest 模块
│     │  └─ infrastructure/     SQLite、消息传输、时钟、文件系统等适配
│     ├─ migrations/            经过评审的数据库迁移
│     └─ test/                  HTTP / WS / 持久化 / 生命周期集成测试
├─ packages/
│  ├─ shared/                   领域类型、Zod 契约、纯 reducer
│  ├─ agent-adapter/            pi SDK 子进程、IPC、事件归一化、执行守卫
│  ├─ ui/                       tokens、基础组件、可访问性封装
│  └─ config/                   TS、lint、构建等共享配置
├─ e2e/                         浏览器与 Electron 端到端场景
├─ scripts/
│  ├─ planning/                 PRD / roadmap 生成器、templates 与 assets
│  ├─ docs/                     文档预览、旧地址重定向及链接校验
│  └─ *.mjs                     开发编排与干净工作区验证
├─ docs/
│  ├─ product/                  权威 backlog、产品规划、生成 PRD 与看板
│  ├─ architecture/             实施方案、依赖边界与数据生命周期
│  ├─ design/                   高保真稿、设计规格、assets 与 screenshots
│  ├─ decisions/                用户确认与参考产品评估
│  ├─ development/              工具规范与组件采用规则
│  └─ validation/               验收说明、预算与各次归档证据
├─ .workbench/                  本机数据、日志、缓存与未归档验证输出（忽略）
├─ README.md                    运行、检查与主要文档入口
├─ AGENTS.md                    项目协作与验收约束
├─ pnpm-workspace.yaml
├─ pnpm-lock.yaml
└─ package.json
```

上述顶层目录已经建立；app 内部的 app / features / services / stores 和 infrastructure 等仍是逐步实现的职责分区，不表示所有模块已有实现。实际已建立三个应用及 shared / agent-adapter / ui / config；`packages/ledger` 在 M3 随账本生产化创建，公共 `fixtures` 仅在有跨包样本复用时建立。终端在 M4，desktop 的完整产品行为按 UX-05 在 M2 验收，不建立空实现冒充完成。

规划文档归入 docs，生成器归入 scripts/planning，设计稿资源与截图分别归入 docs/design/assets 和 screenshots。M0 必要验收报告 / 原预算归入 docs/validation/m0-evidence，固定回归录制归入 packages/agent-adapter/test/contracts/recordings；本机原始 spikes 整个目录不提交，也不作为运行 / 构建 / 测试 / 文档预览的前置。根目录仅保留入口和工程配置，完整索引及生成 / 预览规则见 [docs/README.md](../README.md)。整理不改变验收状态或原始证据字节。

agent-adapter 包集中维护内部执行守卫及动态工具包装入口；实现时保持 CORE-02 的真实约束，不因把代码称为 extension 就依赖普通 tool_call 顺序。对外导出宿主接口，子进程入口独立构建，不引入 NestJS。

## daemon 的领域模块

| 模块 | 职责 | 对应功能 / 阶段 |
| --- | --- | --- |
| Health / Lifecycle | 健康检查、配置校验、关闭顺序和故障报告 | OPS-01 / 08、M1 |
| Runtime | SDK 进程池、prompt / abort、轮次编排及资源预算 | CORE-04 / 07、M1 |
| Sessions | 会话索引、原生历史指针、状态 / 队列 / 恢复；M2 扩展创建与组织 | CORE-05 / 06、SESSION、M1–M2 |
| Projects / Workspaces | 项目归属、实际目录、信任与目录写入互斥 | WS、M2–M3 |
| Approvals | 风险策略、最终参数请求、授权及审计 | SEC、M2 |
| Search | 可重建索引、会话标题和正文定位 | SESSION-12、M2 |
| Changes | 快照与变更归属、Diff、接受 / 回滚及恢复 | CHANGE、M3 |
| Settings / Models | 配置来源、现有 pi 模型、可用能力、用量和脱敏 | MODEL / EXT、按既有里程碑 |
| Tasks / Terminals | 后台进程、PTY、输出与生命周期 | EXEC、M4 |

命名允许随实现小幅调整，职责和依赖边界先确认。模块间通过公开服务 / 端口交互，不互相直接读取对方的表或私有 store。涉及审批、轮次收尾、快照的编排由宿主应用服务负责，不能交给 Controller 或界面组件拼接。

NestJS 负责生命周期及依赖注入；Fastify 适配器负责 HTTP 层。WS 认证、协议版本、序号、背压及关闭流程按 CORE-05 统一设计，不能根据 HTTP 适配器名称推断已经实现。对话或审批的长期等待须有取消和进程失效路径。

## 依赖与数据所有权

```text
web ───────> ui / shared
desktop ──> 系统集成 + daemon 监护 + 共用 web 构建
daemon ───> shared / agent-adapter / ledger
agent-adapter ──> shared / pi SDK
ledger ────> 纯账本领域逻辑与受控 Git / 文件系统适配
shared ────> 纯 TS / Zod；不依赖 NestJS、React、Node IO
```

- SQLite 的业务写入方为 daemon。浏览器和 Electron renderer 通过同一服务访问，不各自开数据库连接。
- pi JSONL 由 SDK 维护已提交消息，SQLite 维护可重建索引 / 元数据等；待送达请求及 inflight 数据有自己的生命周期，不能冒充正式消息历史。
- API 的稳定请求 / 事件由 shared 中的 Zod 契约定义，Nest 控制器、WebSocket 和 IPC 边界进行运行时验证。数据库 schema 与迁移属于 daemon，不泄漏为前端公共 API。
- 密钥由现有 pi 配置或安全存储适配管理，普通库只保存配置引用 / 状态。
- 工作区文件仍由受控工具 / 回滚服务操作；“会话移到项目”不隐式迁移 cwd 或文件。

## 数据访问方式：已选 Drizzle + better-sqlite3

| 方案 | 优点 | 需要承担的工作 |
| --- | --- | --- |
| Drizzle + better-sqlite3（用户已选） | TS 类型化查询、接近 SQL、可生成和执行显式迁移；可由 Nest Provider 注入 | 团队需理解 SQL / 事务；手工评审迁移，备份与故障恢复仍自行验证 |
| TypeORM + SQLite 驱动 | Entity / Repository 风格，Nest 生态较熟悉 | 更多实体 / 装饰器及映射；关闭生产自动同步，使用版本化迁移 |
| 直接 better-sqlite3 + SQL | 依赖较少，查询与事务完全显式 | schema、查询类型和迁移组织需自行维护 |

以上保留选型比较，实际采用用户已选的 Drizzle + better-sqlite3，不维护三套并行数据访问实现。选择 ORM 不代表迁移可自动无损回退，也不改变原生模块打包要求。SQLite 一致性备份、WAL 配置、事务边界、启动迁移失败与旧版本恢复均需 OPS / CORE 的真实验收。

本次实际查阅 [Drizzle SQLite 接入说明](https://orm.drizzle.team/docs/get-started-sqlite)与 [TypeORM SQLite 驱动说明](https://typeorm.io/docs/drivers/sqlite)，均有 better-sqlite3 适配。文档支持已经 OPS-01 的原生 SQLite / Drizzle 实测补充；不据此宣称 TypeORM 实测或会话持久化已完成。

## 前端组合：用户已确认

采用 React + TypeScript + Vite + Tailwind + shadcn/ui；运行态使用纯 reducer / Zustand，列表与设置等请求缓存使用 TanStack Query。共享协议和运行态不绑定 React，业务请求放在 services / actions，组件保持清楚的职责。

前端组合已选，不再将 Vue 保留为并行实施路线。正式 UI 实现前确认对应高保真与交互状态；后端、SQLite 与 SDK 子进程保持清晰边界。

## 开发与验证入口（OPS-01 已建立）

| 目标命令 | 结果 |
| --- | --- |
| `pnpm dev` | 前端 + daemon + 默认假内核，不读取模型密钥或发起模型调用 |
| `pnpm dev:desktop` | 在共用服务 / UI 上启动 Electron 外壳 |
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | 类型、边界与可复现构建 |
| `pnpm test` | 本地单测、契约及服务集成测试，无付费请求 |
| `pnpm test:e2e` | 浏览器 / Electron 用户流程，先由假内核驱动 |

根脚本编排工作区任务；业务单测靠近代码，服务集成测试放 daemon/test，跨客户端流程放 e2e。真实提供商测试使用独立入口和明确预算，不混入上述默认命令。上述入口已通过 OPS-01；pnpm start 当前只启动 daemon。完整本地检查使用 pnpm run ci，干净目录复现使用 pnpm verify:clean；pnpm smoke:sdk 经 CORE-04 升级为真实 SDK + 本地夹具的握手 / prompt / abort / dispose，不调用真实提供商。
