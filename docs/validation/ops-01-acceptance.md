# OPS-01 工程与离线界面基线验收

日期：2026-11-01。前置 CORE-01 已验收。R9 已确认核心高保真作为 M1 / M2 实现基线，第一阶段个人本地使用。本次仅验收 OPS-01，不代表 M1 阶段门或 M2 / M3 产品功能完成。

## 结果与证据

| 验收内容 | 实际结果 | 证据 |
| --- | --- | --- |
| 干净目录安装、类型、构建与启动 | 新目录 frozen-lockfile 安装、typecheck、build、test、SDK smoke 全部退出 0；Vite 首页、入口模块与代理健康检查均 200；IPC 请求后优雅退出 0 | [干净目录结果](ops-01-evidence/clean-workspace.json)、[命令完整输出](ops-01-evidence/clean-commands.json)、[可重复脚本](../../scripts/verify-clean.mjs) |
| 固定工具链 | 项目 Node 24.22.2、pnpm 12.16.1、TypeScript 6.0.3；所有直接依赖使用精确版本 / named catalogs，生成锁文件。未替换系统 Node 26 | package.json、pnpm-workspace.yaml、pnpm-lock.yaml；干净目录与原锁 SHA-256 一致 |
| SQLite 原生模块与显式迁移 | better-sqlite3 13.0.3 在 Node 24 实际打开 SQLite；Drizzle 迁移一次；WAL、关闭重开、标记保留和迁移幂等检查通过 | apps/daemon/test/bootstrap.test.ts；migrations/0000_aromatic_squadron_sinister.sql |
| 服务与契约 | Nest / Fastify 实际启动；health 与场景边界 Zod 校验；无效场景 400、非预期 Host / Origin 403、未提供写接口 404 | 同上；packages/shared/src/contracts.ts |
| 共享边界 | shared 只包含 Zod、类型和纯 reducer，无 Nest / React / Node IO；daemon 持有 SQLite；renderer 仅通过 HTTP 读取假内核样本；SDK bootstrap 独立子进程 | apps / packages 的 package.json、shared/src、agent-adapter/src/smoke.ts |
| SDK 子进程冒烟 | 真 SDK 1.4.0 创建、检查工具为空并 dispose；隔离工作 / agent / session 目录，不读取现有模型配置；fetch 尝试计数必须为 0。未调用 prompt | `pnpm smoke:sdk` 输出 source=real-sdk/bootstrap-only/no-prompt、Node v24.22.2、tools=0、providerRequests=0、disposed=true |
| 离线预算守卫 | 请求前文件锁、重读与原子替换；2 次 / 512 token / 禁自动重试；失败、中止及不确定预占保留；缺文件、超限、M0 / M8 与修改限额拒绝。5 个独立进程竞争，只 2 个预占成功 | packages/agent-adapter/src/validation-budget.test.ts；测试仅复制预算文件到临时目录 |
| 浏览器与桌面壳 | 6 项 E2E 通过：中文组合输入 / 换行 / 发送、审批允许 / 拒绝、停止过程与终态、草稿、审查开关、错误 / 服务断线恢复、系统明暗 / 390px、Electron 沙箱与关窗隐藏 / 重新打开 / 退出 | e2e/*.spec.ts；[本地完整检查日志](ops-01-evidence/checks.log) |
| 本地完整检查 | `pnpm run ci` 退出 0：lint、typecheck（含测试工具）、Knip、11 项单元 / 集成测试、SDK smoke、生产构建和 6 项 E2E | [checks.log](ops-01-evidence/checks.log) |

## 实现范围

- apps/web 是可启动的 React UI；apps/desktop 是共用 UI 的 Electron 开发壳；apps/daemon 使用 Nest 模块与 Fastify。
- packages/shared 保存样本事件契约和纯投影；agent-adapter 保存假内核、离线预算预占和 SDK bootstrap；ui 是经官方 shadcn CLI 添加并适配的基础组件；config 保存严格 TypeScript 配置。
- UI 可评审新会话、运行、审批、拒绝、正在停止 / 已停止、收尾、审查、错误与断线，顶部始终说明离线来源。示例命令和 Diff 不执行，不接触用户项目。
- 生产入口的数据根默认为当前用户 `%LOCALAPPDATA%\PiWorkbench`，`PIW_DATA_DIR` 可覆盖；开发默认 `.workbench/dev`，E2E 与干净目录另行隔离。后续设置中的受控迁移属于 M5。

## 明确的限制

真实提供商路径保持关闭，`PIW_KERNEL=real` 被拒绝，没有 prompt / 审批 / 文件修改 API。已验证的是持久预占算法和默认离线禁用边界；SDK 的隐式工具回合、压缩、重试和现有提供商的有效输出上限尚未完成端到端拦截验证。开放真实调用前必须补齐这些约束，不能把该算法当作已启用的提供商传输守卫。本次新增真实请求为 0，预算原记录没有预占，M0 的 3 + 1 次证据保留。

当前事件 reducer 和场景切换是工程样本，不是完整 CORE-05 协议；SQLite 只建立 metadata 迁移，不是 CORE-06 会话持久化。真实内核运行 / 中止、WS 重放与鉴权、会话创建 / 搜索 / 项目管理、真实审批、快照 / 回滚和发布安装均在后续功能验收。完整 UX-05 单实例、退出清理与故障恢复没有提前验收。

`pnpm dev` / `pnpm dev:desktop` 使用 Vite 开发服务；`pnpm start` 当前只启动独立只读 daemon。生产 SPA 托管、受管服务监护和安装包仍需后续实现，不把 build 成功当成发行版完成。

## 实测中修正的问题

1. workspace 构建使用显式包名过滤，保证 shared / UI / adapter 先于应用编译。
2. TypeScript 5.9.3 与当前 Vitest ESLint 插件的 >=6 peer 不兼容，固定 6.0.3；Node 仍为 24.22.2。
3. Electron ESM 入口改用 app.whenReady().then 初始化，解除顶层等待造成的启动阻塞。
4. CSS 基础规则放入 base layer，避免覆盖组件的透明边框；InputGroup 仅随输入控件禁用而变灰，不因附加按钮未开放而使整个输入区变灰。
5. Electron 首次从默认源下载未完成；本机通过一次性的 npmmirror 下载配置安装，仍校验 npm 包自带 SHA-256，没有修改全局镜像设置。不是每次运行的隐含模型请求。

## 截图复核

已实际查看 [新会话浅色](ops-01-evidence/new-light.png)、[审批深色](ops-01-evidence/approval-dark.png)、[展开审查](ops-01-evidence/review-light.png)、[390px](ops-01-evidence/approval-390.png)和 [Electron](ops-01-evidence/desktop.png)。自动化检查不代替用户最终使用验收；这些截图只说明离线基础壳的渲染结果。

下一项为 CORE-04：受管 SDK 子进程、生命周期、真实运行控制与执行守卫集成，继续先离线，按里程碑累计预算验收必要真实调用。
