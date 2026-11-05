# 代码规范与检查

关联 OPS-01 工程基线与 OPS-08 契约回归门禁。按用户选择使用 Oxlint 1.90.0、Oxfmt 0.75.0 和 oxlint-tsgolint 7.0.2005，版本统一放在 pnpm 的 dev catalog。ESLint 配置和直接依赖已移除；Knip 继续检查跨文件的无用代码和依赖。

## 常用命令

| 命令                  | 用途                                                              |
| --------------------- | ----------------------------------------------------------------- |
| `pnpm fix`            | 先执行安全 lint 修复，再格式化与排序；日常推荐入口                |
| `pnpm lint`           | 类型感知 lint，任何 error / warning 都失败                        |
| `pnpm lint:fix`       | Oxlint 安全修复，包括命名 import 成员排序；不启用危险修复         |
| `pnpm format`         | Oxfmt 格式化、import 声明分组、package.json 和 Tailwind 排序      |
| `pnpm format:check`   | 只检查格式，不修改文件                                            |
| `pnpm check`          | 格式 → lint → TypeScript → Knip → 文档一致性与链接检查            |
| `pnpm test:contracts` | 构建服务后，定向运行投影、录制样本重放、IPC 与 daemon 内核契约    |
| `pnpm run ci`         | check → 单元 / 集成 → SDK 离线冒烟 → 浏览器 / Electron E2E 和构建 |
| `pnpm verify:clean`   | 全新目录 frozen 安装、check、构建、测试、SDK 冒烟及服务启动       |

运行 E2E 和 clean 验证前核对本项目服务归属，释放 5173 / 4317；CORE-05 浏览器隔离 daemon 使用 4318，原生事件 TCP 集成测试使用 4328、SEC-08 使用 24348，不停止无关服务。检查默认离线，不调用真实提供商。`pnpm smoke:sdk` 使用真实 SDK 子进程与本地 HTTP 夹具，验证握手、prompt 流式、abort 和 dispose；输出区分 localRequests 与真实 providerRequests。工具 / 扩展全部禁用，不读取用户认证。合成 IPC 故障夹具单独标记为 synthetic-ipc-fixture，不作为真实 SDK 对话证据。

`lint` 先构建 workspace 声明及 daemon：类型感知规则需要解析跨包导出，daemon 测试也使用编译后的 Nest 模块。保留 TypeScript 6.0.3 的 `tsc` 为正式类型检查，Oxlint 不替代它；`options.typeCheck` 关闭，`options.typeAware` 开启。升级任一类型工具时，重跑类型规则反例和全量检查。

## 排序与格式

配置在根目录 `.oxfmtrc.json` 和 `.oxlintrc.json`：

| 内容         | 约定                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| import 声明  | 类型 → Node 内置 → 外部库 → `@pi-workbench/` → 相对路径；组间空行，组内字母升序，忽略大小写                            |
| import 成员  | Oxlint `sort-imports` 只排序 `{ a, b }` 成员；声明顺序交给 Oxfmt，避免规则冲突                                         |
| 类型导入     | `import type` 独立声明，避免类型被当成运行时依赖                                                                       |
| package.json | 标准字段顺序，依赖字段和 scripts 字母排序，条件 exports 保留语义顺序                                                   |
| Tailwind     | 根据 `packages/ui/src/styles.css` 的 Tailwind 4 入口排序 className 和 `cn` / `clsx` / `cva` 字符串；去重复类和多余空格 |
| 通用格式     | 2 空格、100 列、LF、文件末换行、无分号、JS 单引号 / JSX 双引号、箭头函数带括号、支持位置保留尾逗号                     |
| 其他文件     | JSON / JSONC、CSS、HTML、YAML、Markdown 统一由 Oxfmt 处理；Markdown 不强制重排段落                                     |

副作用 import 保留顺序，注释可显式分隔 import 区块。不自动按字母排列任意对象、数组、CSS 属性或 JSX props：这些位置可能承载执行顺序、层叠或展开覆盖语义。Oxfmt 不负责 import 成员排序，完整自动修复使用 `pnpm fix`。

## Lint 覆盖

- 正确性、可疑代码和性能分类；Promise、Node、import、TypeScript、React、jsx-a11y 原生规则，测试额外启用 Vitest。
- 禁止显式 any、未处理 Promise、错误的异步回调及不安全赋值 / 调用 / 返回；要求联合类型 switch 穷尽检查。
- 检查未使用变量、重复 / 循环 / 自引用 import；Node 内置包使用 `node:`；禁止 eval、debugger、var，统一严格相等与控制流花括号。
- React Hooks 顺序和 effect 依赖、Fast Refresh 导出边界、基础无障碍检查；Vitest 禁止 only / skip 并校验 expect。
- shared 禁止引入 Node IO、React、Nest 和宿主包；renderer 禁止直接引入 Electron、数据库、Nest 和 Agent / ledger 特权包。
- 应用默认只允许 console.warn / error；启动脚本和 SDK 冒烟可输出运行结果。`_` 开头表示有意不使用的参数。无效的 oxlint-disable 注释会报错，旧 eslint-disable 不生效。

有意保留的局部例外：

1. React 自动 JSX runtime 关闭旧的 React-in-scope 要求；当前未启用 React Compiler，关闭它专属的实验规则，常规 Hooks 规则仍开启。
2. `packages/ui/src/components` 是可复用组件模块，可导出 variants / hooks 等组件辅助 API，Fast Refresh 的仅组件导出约束保留在应用层。
3. shadcn InputGroup 的 group 容器与附加区点击仅负责把指针焦点转交给真实输入框，不增加可执行动作；仅该文件豁免语义标签偏好和相应的非交互容器点击规则，输入和按钮仍保留原生键盘交互。
4. Nest 装饰器 Module 允许无实例成员的类；顺序命令验证、预算文件锁的有界轮询允许循环内 await。
5. CSS 和 reflect-metadata 允许副作用导入；新副作用包须先审查再加白名单。

## 编辑器

`.vscode/extensions.json` 推荐官方 `oxc.oxc-vscode` 扩展。安装后，显式保存会执行 Oxlint 修复和 Oxfmt 格式化；关闭编辑器自己的 organizeImports，避免重复整理。类型感知设置从根配置读取。首次安装后运行 `pnpm build:server`，生成跨包声明。

`.editorconfig` 同步缩进、字符集和换行；Markdown 保留有意义的行尾空格。命令行门禁是验收依据，编辑器扩展配置不代表已经在用户编辑器中实测。

## 检查范围与证据

当前产品代码、工程脚本、测试与配置全部纳入。`node_modules`、dist、缓存、覆盖率、测试报告和生成的 Drizzle 迁移不重写；本机 `spikes` 不提交、不批量格式化。M0 报告 / 预算与当前回归所需录制按原始字节归档，后者由 manifest 校验 SHA-256。规划工具移至 `scripts/planning/`，生成页面和历史文档按职责归入 `docs/product`、`design`、`architecture`、`decisions`、`validation`，这些内容沿用独立生成和校验流程，不参与全量格式迁移；AGENTS.md 也不自动格式化。新增的 `scripts/docs/`、文档索引和当前开发说明纳入 Oxfmt；目录及链接通过 `pnpm docs:check` 检查，并已接入 `pnpm check`。

工具迁移的历史验证记录存放在 `docs/validation/tooling-evidence`，与已有 OPS-01 / M0 历史证据分开。后续 E2E 截图与 clean 验证默认输出到 `.workbench/evidence/latest`，可通过 `PIW_EVIDENCE_DIR` 指定独立证据目录，归档时不覆盖历史记录。没有 Git 仓库时不安装 Git hooks；以后初始化仓库再按需要接入。不因工具或目录整理改变产品功能的验收状态。

## 常见开发问题

启动与环境变量见根 [README](../../README.md)，实现规则见 [AGENTS 第 6 节](../../AGENTS.md)。先记录完整错误和退出状态，不靠删除锁文件 / 数据库或停掉未知进程排障。

| 现象                             | 核对与处理                                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5173 / 4317 端口占用             | 用 `Get-NetTCPConnection -State Listen -LocalPort 5173,4317` 找 OwningProcess，再用 `Get-Process -Id <PID>` 确认归属，从原终端 / 托盘关闭本项目服务               |
| 无法连接 / Host 或 Origin 被拒绝 | 核对 `http://127.0.0.1:4317/api/health`、Vite 代理和预期端口；健康结果仅证明服务响应，不代表模型可用，不放开任意 Host / Origin 绕过限制                           |
| 跨包声明缺失 / 服务修改未生效    | 核对 `pnpm exec node --version`，运行 `pnpm build:server` 并重启开发入口；前端热更新不等于服务已重载                                                              |
| SQLite 原生模块加载失败          | 记录 Node / 模块 ABI 与安装日志，核对项目 Node 24 和锁文件；不按 Electron ABI 盲目重编译 daemon 模块                                                              |
| Electron 无窗口 / 立即退出       | 查看完整错误、退出码、二进制下载和托盘 / 沙箱条件；GUI 启动进程使用 windowsHide:false 并在加载后显式显示，后台 helper 继续隐藏；不关闭 sandbox 或修改系统安全设置 |

当前顶部“离线状态样本”复用实际组件展示新会话、运行、审批、拒绝、停止、收尾、审查、错误与离线；并非参考项目的 `?preview=...` 场景库。OPS-08 已加入长文本、未知命令、迟到响应及渲染失败回归，来源与阶段边界见下节。配置保存与能力生效分别验证。

文本使用 UTF-8 / LF；命令输出乱码先查产生和解码位置，不猜测修补已损坏的字符串。当前开发服务不自动重载、真实传输未开放等限制应随代码变化同步 README，不能照搬外部文档的能力描述。

官方参考：[Oxlint 配置](https://oxc.rs/docs/guide/usage/linter/config.html)、[类型感知规则](https://oxc.rs/docs/guide/usage/linter/type-aware.html)、[Oxfmt 排序](https://oxc.rs/docs/guide/usage/formatter/sorting.html)、[编辑器配置](https://oxc.rs/docs/guide/usage/formatter/editors.html)。

## OPS-08 契约回归门禁

SESSION-03 已验收：Electron 置顶 / 未读 / 归档由 daemon SQLite 持久保存，恢复不启动内核或旧授权；新完成 / 失败 / 中断结果标未读，仅活动窗口实际展示并读到最新才清除，支持手动标记。后台真实状态独立于视图，运行中归档先明确停止，等待服务确认后再次单独确认；取消归档保持同 SDK PID 继续运行。新增 7 项服务 / 5 项 Electron 流程，完整 179 项 Vitest / 49 项浏览器与 Electron E2E、SDK 冒烟通过；本次 frozen clean 通过，最后提示文案仅复用未变基础设施，完整 CI 已补跑。原生 Windows 重启持久 / 恢复 / 中段未读 / 后台停止归档及两次正常退出通过；真实请求 0，配置 / 预算未改，无安装包。旧历史完整消息脱敏和本地夹具端口两项实际 HTTP 回归均保留 red/green；早前偶发硬杀 / seed 的确切根因证据不足，不作已定位断言。新增服务包含迁移、终态去重、CAS、归档 / 发送竞态、权限与写失败；Electron 包括中段 / 手动未读、后台失败、迟到列表及隐藏弹窗。[逐项验收与限制](../validation/session-03-evidence/acceptance.md)、[最终 CI](../validation/session-03-evidence/ci-native-followup.log)、[clean](../validation/session-03-evidence/clean-workspace.json)和[原生记录](../validation/session-03-evidence/native-validation.json)独立归档；OPS-08 整体继续进行。

SESSION-02 已验收并扩充同一门禁：`apps/daemon/test/legacy-history.test.ts` 新增 **5 项**实际文件 / HTTP / SQLite 边界，native-history 测试增加循环 parent 防护；`e2e/session-switching.spec.ts` 新增 **4 项**实际 Electron 流程，既有 history 流程补刷新分页恢复。四会话 / 3 视图、独立草稿 / 阅读锚点 / 面板、后台同 PID / 淘汰 / TCP WS 重连 / reload、迟到 A→B→A、旧历史版本 / 并发同写 / 半行 / 损坏 / 脱敏及只读源不变均进入回归。长标题隐藏状态的可见性回归修复前失败 / 修复后通过。最终 `pnpm fix` / 完整 `pnpm run ci`：**170 项 Vitest / 44 项浏览器与 Electron E2E** 和 SDK 冒烟通过；本次 frozen clean 通过，最终标题布局、草稿回执隔离与文档改动复用未变基础设施。原生 Windows 草稿 / 阅读 / 设置返回 / 后台 PID / 旧历史分页另有记录，临时宿主退出后多做 SQLite 审计导致脚本退出 1 如实保留，未影响关闭前证据，自有进程 / 活动连接释放。真实提供商请求 0；[逐项验收](../validation/session-02-evidence/acceptance.md)、[最终 CI](../validation/session-02-evidence/ci-final.log)、[clean](../validation/session-02-evidence/clean-workspace.json)及[原生记录](../validation/session-02-evidence/native-validation.json)。OBS-04 / UX / FILE / CHANGE 只记录支撑范围；改名与标题多端同步的后续结果见 SESSION-11，生产审批 / 双端交互、M3 回滚及后续平台门禁仍待各阶段验收。

SESSION-01 已验收并扩充同一门禁：`apps/daemon/test/session-creation.test.ts` 的 **9 项**真实 SDK / 本地 HTTP / SQLite / 文件系统测试和 `e2e/session-creation.spec.ts` 的 **5 项**真实 Electron 流程覆盖原子首发、幂等、草稿 / 设置返回、SQL 失败、HTTP 回执丢失、SDK error / SIGKILL / 重启不重放、模型消失及目录复核 / junction。原生补验发现同项目草稿重入丢失所选目录，修复前失败 / 修复后通过；最终 `pnpm fix` / 完整 `pnpm run ci` 退出 0：**164 项 Vitest / 40 项浏览器与 Electron E2E**、SDK 冒烟通过。依赖 / 原生模块 / 服务 / 构建配置未变，复用修复前 frozen clean 基础设施证据，锁哈希一致。真实 Windows 微软拼音、原生首发 / 同会话续发、独立草稿 / 设置返回、实际目录选择、明暗窄窗 / 最大化和正常退出均补证，来源与合成 composition 分开。真实提供商请求 0；[逐项验收与来源](../validation/session-01-evidence/acceptance.md)、[最终 CI](../validation/session-01-evidence/ci-native-followup.log)、[原 clean](../validation/session-01-evidence/clean-workspace.json)、[原生记录](../validation/session-01-evidence/native-validation.json)及[最终审计](../validation/session-01-evidence/native-final-audit.json)独立保留；不提前验收其余会话 / 权限、M3 回滚或整体 OPS-08。

M1 基线已接入完整离线 CI；OPS-08 整体仍为进行中，第二条验收须随真实产品阶段补齐。`pnpm test:contracts` 是定向诊断入口，完整 `pnpm test` 已包含同一批用例，CI 不重复执行它。当前已有 Git 仓库；`pnpm run ci` 是可复现的本机门禁，不代表已启用托管分支保护。

WS-01 当前扩展：`apps/daemon/test/workspaces.test.ts` 的 5 项集成和 `e2e/workspaces.spec.ts` 的 2 项真实 Electron 流程进入同一门禁，前者已加入 `test:contracts`。实际目录 / SQLite 验证并发别名、大小写 / junction、重启复用、失效 / 替换 / 恢复、迁移与保存失败，Windows 自带 `whoami` / `icacls` 在隔离测试目录中核对真实列目录 / 创建文件权限拒绝并恢复；它们不是新增 npm 依赖，非 Windows 环境不应静默跳过并宣称该验收通过。HTTP 验证 SEC-08 拒绝；Electron 覆盖取消、切换、迟到响应、断线恢复、焦点和明暗 / 1080p / 800px，实际 SDK 本地 hold 请求在切换后继续运行。CI 只把系统目录选择器的返回值设为夹具，另有未拦截的实际 Windows 选择 / 取消证据；程序生成 IME 不等于物理输入法验收。完整 **146 项 Vitest / 30 项 E2E**、SDK 冒烟及 `pnpm verify:clean` 通过，锁文件一致、无新增依赖，真实提供商新增请求 0。[CI / clean / 原生流程与截图](../architecture/implementation-plan.md#ws-01-已交付边界)见实施方案。该次未包含 WS-02 最近 / 重命名；后续工作区与会话验收见下文，生产工具审批仍待交付。

SEC-07 当前扩展：`apps/daemon/test/trust.test.ts` 的 7 项服务集成、`e2e/trust.spec.ts` 的 2 项浏览器流程和既有真实 Electron 测试进入同一门禁。真实 SDK + 本地 HTTP 夹具核对逐轮系统提示中的未信任 / 已确认 / 变化 / 撤销 / 冷恢复文本；真实 SQLite / 文件系统验证迁移、保存失败、损坏记录、来源边界、链接与超限拒绝、FIFO 后重新检查，以及扩展副作用 / 脚本始终不执行。真实配对后的 HTTP 校验身份、CSRF 和旧指纹冲突；503 与迟到响应明确为网络故障注入。实际页面验证确认 / 撤销、明暗 / 1080p / 390px、键盘焦点、长列表滚动和 SVG 纯文本。完整 **141 项 Vitest / 28 项 E2E**、SDK 冒烟与 `pnpm verify:clean` 通过，锁文件一致，新增真实提供商请求 0，无新增第三方依赖。边界与 [CI / clean / 页面证据](../architecture/implementation-plan.md#sec-07-已交付边界)见实施方案；信任记录不启用原生扩展 / 脚本或扩大工具权限，OPS-08 整体仍进行中。

SEC-08 当前扩展：`apps/daemon/test/access.test.ts` 的 7 项用例与 `e2e/access.spec.ts` / `desktop.spec.ts` 的 3 项流程进入同一门禁。真实票据兑换、Host / Origin / CSRF 默认拒绝、并发单次消费、到期 / 撤销、重启失效及独立客户端实际运行；授权时钟注入、OS 外部浏览器启动拦截、程序 IME 与真实 SDK + 本地模型夹具分别标明。未认证 WS 拒绝后 socket 释放和服务正常退出也已回归。完整 **134 项 Vitest / 26 项 E2E**、SDK 冒烟和 `pnpm verify:clean` 通过，锁文件一致，真实提供商新增 0。新增运行依赖只有 desktop 到已有 shared 包的 workspace 引用；官方 Field 复用既有依赖。边界及 [CI / clean / 页面证据](../architecture/implementation-plan.md#sec-08-本机客户端授权边界)见实施方案；M2 其余真实业务 / 人工 IME、M3 回滚与后续平台门禁继续待验收。

| 层次          | 入口与当前覆盖                                                                                                                                           | 来源 / 限制                                                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 纯投影        | `packages/shared/src/reducer.test.ts`：17 项，含顺序、重复、缺口、跨会话 / 代际、迟到终态和完整快照                                                      | 事件与快照为合成输入；`restoreProjection` 只验证展示快照，调用方负责当前握手身份与请求版本，不承担 CORE-05 传输职责；实际通道见下方当前扩展                |
| 历史 SDK 样本 | `packages/agent-adapter/src/contracts.test.ts`：31 项；14 份录制按 SHA-256、来源、事件种类、完整文本与最终状态固定                                       | 只读现有 JSONL，不执行 spike 脚本；重放桥接的 session / turn / seq 为 `fake-kernel`，不是生产归一化器                                                      |
| IPC 与服务    | `packages/agent-adapter/src/kernel.test.ts`：28 项，以及 `apps/daemon/test/kernels.test.ts`：2 项；握手、协议、重复 / 缺口、旧轮次、断线、异常隔离与清理 | 实际 SDK 子进程 + 本地 HTTP 夹具；故障子进程标记 `synthetic-ipc-fixture`；不运行真实工具或读取用户认证                                                     |
| 实际 UI 组合  | `e2e/contracts.spec.ts`：6 项，重复与超过 64 KiB 的 Unicode 输出、缺口 / 显式重同步、迟到响应、格式不兼容、渲染失败、未知命令安全文本                    | HTTP 样本经实际页面 / store / reducer / 组件；渲染故障仅替换 Conversation 模块，真实错误边界、shadcn Alert / Button 与输入框仍运行；不等于真实会话业务验收 |

14 份录制包括 CORE-01 的 9 份真实 SDK + 本地 HTTP 场景、2 份原已配置提供商录制（正常 / 手动压缩与真实中止），以及 CORE-02 的 3 份真实 SDK + 本地夹具的拒绝 / 撤销 / 审批 IPC 断开记录。清单是 [recordings.json](../../packages/agent-adapter/test/contracts/recordings.json)，固定原始字节归入同目录 recordings/，SHA-256 与来源不变，常规回归不依赖本机 spikes；测试校验原始字节与逐行来源，失败定位到样本文件、原始行号、事件与归一化 seq。重试、排队和压缩沿用本地录制，不能描述为新增的真实提供商证据。

当前 UI 在数据契约不兼容时暂停发送并保留草稿；发现序号缺口后阻止继续追加，显式重新读取完整离线样本；可选消息渲染崩溃时保留工作台与草稿，可用键盘返回新会话。后两者是本地样本与展示恢复，未开放真实执行 / 重试接口。CI 中出现 `OPS-08 synthetic renderer fault` 的 React 错误日志是有意注入并被边界捕获的验收场景，不是未处理的测试失败。

| 阶段        | 必须继续绑定的真实验收                                                                                               | 当前状态                                                                                                                                                                                                                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 基线     | 固定录制、纯投影、真实 SDK 本地生命周期 / IPC、实际 UI 故障场景                                                      | OPS-08 首次基线通过（85 项 Vitest / 12 项 E2E）；CORE-05 本轮见下方                                                                                                                                                                                                                                                                 |
| M1 运行底座 | CORE-05 双客户端握手 / 重放 / 缺口快照，CORE-06 JSONL / inflight 崩溃恢复，CORE-07 配额 / FIFO / 取消                | CORE-05–07 已验收并接入；真实 SDK + 本地夹具，来源与后续业务独立记录                                                                                                                                                                                                                                                                |
| M2 真实试用 | 凭证 / 脱敏、资源信任、配对、工作区、模型发现，以及 Chromium / Electron 的 IME、草稿、切换回看、改名、审批、双端重连 | SEC-06 / 07 / 08、WS-01 / 02、MODEL-01、SESSION-01 / 02 / 03 / 11 已验收并纳入实际 SDK / SQLite / HTTP / TCP WS / Chromium / Electron 回归；真实 Windows 微软拼音已补证，与合成事件分开。3 视图 / 后台任务 / 重连、旧历史只读、持久整理 / 最新已读 / 明确停止归档，以及改名 / 标题多端同步均已补齐；生产业务审批 / 双端交互仍待实现 |
| M3 修改闭环 | 实际文件 / 账本的接受、回滚、冲突预检与失败恢复                                                                      | 待 CHANGE 功能实现；CORE-03 原始验证不等于产品回滚                                                                                                                                                                                                                                                                                  |
| M4–M7       | 按 backlog 增加 PTY / 面板、安装升级 / 平台、Git / 扩展及多 Agent / 调度验收                                         | 未验收；实现时沿用同一离线门禁与实际组件，不提前记为通过                                                                                                                                                                                                                                                                            |

OPS-08 首次基线的 `pnpm fix`、`pnpm run ci` 与 `pnpm verify:clean` 均退出 0；干净目录 frozen 安装、构建、85 项测试、SDK 冒烟与服务启停通过，锁文件 SHA-256 一致，真实提供商新增请求 0。证据为 [CI 输出](../validation/ops-08-evidence/ci.log)、[干净目录结果](../validation/ops-08-evidence/clean-workspace.json)、[命令输出](../validation/ops-08-evidence/clean-commands.json)，以及复核后的 [缺口提示](../validation/ops-08-evidence/contract-gap.png)、[不兼容提示](../validation/ops-08-evidence/contract-mismatch.png)、[390px 深色渲染降级](../validation/ops-08-evidence/contract-renderer-390-dark.png)。历史证据及真实预算账本保持原内容；后续扩展见下方 CORE-05 / 06 记录。

CORE-05 当前扩展：`pnpm test:contracts` 已加入 `packages/shared/src/runtime-contracts.test.ts` 的 5 项协议 / 投影测试和 `apps/daemon/test/events.test.ts` 的 4 项快照 / 重放 / 原生 TCP WS 测试；`e2e/runtime.spec.ts` 增加 4 项实际 React 观察流程。真实 SDK 本地流式、中止、未知工具拒绝、错误与双客户端重连实际运行；超长文本、丢帧、缓冲耗尽、迟到快照、代际与不兼容为标明来源的合成观察 / 网络故障。浏览器测试只代理 REST 和原生 WS URL 到隔离 daemon，保留实际客户端 reducer 与组件。完整 CI 为 **94 项 Vitest / 16 项浏览器与 Electron E2E**，干净目录验证通过，新增真实提供商请求 0。协议、只读入口、内存边界及 [CI / clean 证据](../architecture/implementation-plan.md#core-05-已交付边界)见实施方案；M2 的真实业务交互仍未验收。

CORE-06 当前扩展：`pnpm test:contracts` 加入原生历史解析与 SessionStore 测试；新增 12 项 Vitest、3 项实际浏览器流程。真实 SDK + 本地模型夹具验证正常 / 中止 / 错误、daemon 与 SDK 同 tick SIGKILL、重启不创建内核 / 不重发。合成 v3 文件与工作台记录验证分支 / 版本 / 损坏原始字节、100 条分页 / 64 KiB UTF-8 预览、检查点身份 / seq / 终态去重，以及队列 held / 未决审批失效 / 变更引用。实际文件系统阻断写入验证 1.5 秒目标检查点失败时保留旧文件并阻止新任务；这不是硬实时或断电损失保证。浏览器实际验证全文读取、分页、二进制下载、明暗 / 390px 与键盘刷新，HTTP 仅代理至隔离 daemon，不替换存储或客户端组件。完整 **106 项 Vitest / 19 项浏览器与 Electron E2E**、SDK 冒烟、`pnpm fix` / `pnpm run ci` / `pnpm verify:clean` 全部通过，新目录 frozen 安装 / 构建 / 启停与锁文件一致。原始 [CI](../validation/core-06-evidence/ci.log)、[clean 结果](../validation/core-06-evidence/clean-workspace.json)、[命令输出](../validation/core-06-evidence/clean-commands.json)与[来源及验收边界](../architecture/implementation-plan.md#core-06-已交付边界)独立保留，新增真实提供商请求 0。CORE-07 资源门禁现已接入；OPS-08 第二条仍待 M2 / M3 及后续阶段补齐。

CORE-07 当前扩展：`apps/daemon/test/resources.test.ts` 新增 12 项集成测试，覆盖启动计数、模型并发、FIFO / 取消、共享启动取消、256 等待背压、SIGKILL / 错误后释放、空闲回收、原生上下文冷恢复、历史去重 / 中断位置和退出；`e2e/resources.spec.ts` 新增 2 项实际组件流程。SDK / 文件 / 进程真实运行，模型为本地 HTTP 夹具；审批保留和部分检查点为合成观察，503 / 版本不兼容是 HTTP 故障注入。完整 118 项 Vitest / 21 项浏览器与 Electron E2E、SDK 冒烟、pnpm fix / pnpm run ci / pnpm verify:clean 均退出 0，新目录 frozen 安装及锁文件哈希一致。真实提供商新增请求 0，原始 [CI / clean 与截图](../architecture/implementation-plan.md#core-07-已交付边界)独立归档；终端仅预留预算，M2 真实审批 / 配对及 M4 PTY 未提前验收。

SEC-06 当前扩展：`packages/shared/src/redaction.test.ts` 的 3 项纯策略测试和 `apps/daemon/test/security.test.ts` 的 6 项服务测试已加入 `pnpm test:contracts`；`e2e/security.spec.ts` 新增 2 项实际浏览器流程。合成凭证覆盖原生配置缺失 / 过期 / 环境引用 / 命令不执行、锁 / 冲突、原子保存失败、其他配置和实际 Windows ACL 保留；真实 SDK + 本地 HTTP 夹具覆盖原始 JSONL 保持、REST 历史 / 全文 / 脱敏导出和二进制 422。合成审批与分片内容通过实际 TCP WS、明暗 / 1080p / 390px 页面和重载验证，503 为 HTTP 故障注入；浏览器未开放凭证写入，生产审批与配对仍待各自验收。正常流式与 CORE-05–07 回归继续通过；无新增依赖或本轮锁文件修改，新增真实提供商请求 0，预算账本与固定录制未改。

SEC-06 的 `pnpm fix`、完整 `pnpm run ci`、`pnpm verify:clean` 均退出 0，**127 项 Vitest / 23 项浏览器与 Electron E2E**、SDK 冒烟及新目录 frozen 安装 / 构建 / 启停通过，锁文件哈希一致。原始 [CI](../validation/sec-06-evidence/ci.log)、[clean 结果](../validation/sec-06-evidence/clean-workspace.json)、[命令输出](../validation/sec-06-evidence/clean-commands.json)及[实现边界 / 截图](../architecture/implementation-plan.md#sec-06-已交付边界)独立归档。统一 clean 工具沿用 OPS-01 的报告标识，验证的是本轮源码副本；不代表重新验收生产分发。OPS-08 第一条保持通过，第二条仍待其余 M2 交互、M3 回滚和后续平台门禁，整体继续进行中。

MODEL-01 当前扩展：`pnpm test:contracts` 已纳入 `apps/daemon/test/models.test.ts` 的 **9 项**模型目录 / 只读来源 / 脱敏 / 请求头覆盖 / 桌面身份测试，`e2e/models.spec.ts` 增加 **3 项**真实 Electron 流程。来源是已安装 pi 1.4.0 静态目录、合成 pi JSONC / 凭证 / 默认选择、实际文件系统、SQLite、Host IPC / HTTP 和 React 组件；不加载外部扩展或动态模型缓存，不执行认证命令、刷新 OAuth、探测账号权益或发出模型请求。503 / 延迟为标明的 HTTP 故障注入。覆盖断线保留失效数据、更新 / 损坏后恢复、离开后的迟到响应、搜索 / 分批展示、键盘、1080p 明色及 800px 深色；Windows 原生菜单、搜索和刷新另经未拦截的实际开发入口验证，配置字节不变且数据库无会话 / 运行时 / 信任 / 工作区记录。不能将自动输入当作人工 Windows IME 验收。

该次完整 `pnpm fix`、`pnpm run ci`、`pnpm verify:clean` 均退出 0：**155 项 Vitest / 33 项浏览器与 Electron E2E**、真实 SDK 本地冒烟及新目录 frozen 安装 / 原生模块 / 构建 / 服务启停通过，锁文件哈希一致；新增真实提供商请求 **0**，预算与固定录制未改。clean 保留 OPS-01 报告标识，E2E 在主工作区 CI 执行；进度 / 文档回填后单独生成并运行完整 check。原始 [CI](../validation/model-01-evidence/ci.log)、[clean 结果](../validation/model-01-evidence/clean-workspace.json)、[命令输出](../validation/model-01-evidence/clean-commands.json)、[原生流程审计](../validation/model-01-evidence/native-validation.json)和[能力 / 来源 / 截图边界](../architecture/implementation-plan.md#model-01-已交付边界)独立归档。WS-01 的目录 / Windows ACL / Electron 切换门禁继续包含在该 CI 中；SEC-07 / 08 与 WS-01 的历史证据见实施方案。MODEL-01 两项验收通过；该次未提前验收 SESSION-01 等后续功能，SESSION-01 的本轮补验见上文。OPS-08 仍 `in_progress`，完整会话恢复 / 改名、真实业务审批 / 双端重连、M3 回滚与后续平台门禁继续保留。

2026-11-02 桌面布局后续回归：**155 项 Vitest / 35 项浏览器与 Electron E2E**、真实 SDK 本地夹具冒烟与 frozen 新目录复现通过，来源与费用约束不变。新增设置导航、主题、搜索、保留草稿 / 审查和窄窗流程，扩充 Electron 窗口颜色 / 菜单 / 桥身份拒绝检查。PRD 可点击原型同步布局并独立检查；Windows 控制栏、菜单、主题和窗口按钮另实际操作。真实拖动、托盘菜单恢复及真实中文 IME 仍有人工证据缺口；[完整来源、命令及限制](../validation/ui-shell-evidence/acceptance.md)、[CI](../validation/ui-shell-evidence/ci.log)、[clean](../validation/ui-shell-evidence/clean-workspace.json)与[原生操作记录](../validation/ui-shell-evidence/native-validation.json)独立归档。UX-03 / UX-05 仅 `in_progress`，OPS-08 整体不提前完成。

## SESSION-11 门禁与原生验收

本次完整 `pnpm run ci`：**22 文件 / 185 项 Vitest、53 项浏览器与实际 Electron E2E、SDK 冒烟**全部通过；本次 `pnpm verify:clean` 的 frozen 安装 / check / build / test / SDK / 健康检查 / 正常退出通过。新增 6 项服务与 4 项 Electron 流程，标题订阅独立于至多 3 个视图的运行观察；测试服务每轮使用独立 `.workbench/e2e-<UUID>`，不复用旧进程租约，产品守卫保持有效。

SESSION-11 已补齐真实微软拼音候选 Enter / Escape / Space 选词、原生预填 / 取消 / 写失败恢复、标题 / 侧栏 / 只读历史一致及同 data / profile 重启持久化；三项验收通过，标为 `verified`。原生 SendInput 与合成 composition 分开记录，两次正常退出、重启无内核 / 无重发、两个 SDK JSONL 字节不变均通过。230 个产品 / 测试 / 根配置文件与 clean 一致，按用户要求复用已通过 CI / clean，本轮仅更新证据、文档和进度并执行 docs:build / fix / check。[验收记录](../validation/session-11-evidence/acceptance.md)、[最终 CI](../validation/session-11-evidence/ci-complete.log)、[clean](../validation/session-11-evidence/clean-workspace.json)与[原生结果](../validation/session-11-evidence/native-validation.json)保留来源、失败轮次和限制。真实提供商请求 0，配置 / 预算未改，无安装包；OPS-08 继续进行中。

## WS-02 门禁与原生验收

`apps/daemon/test/workspace-recents.test.ts` 新增 7 项实际目录 / SQLite / HTTP / SDK 本地夹具集成，已纳入 test:contracts；`e2e/workspace-recents.spec.ts` 新增 4 项真实 Electron 流程。覆盖排序 / 100 项 / 旧库与内部目录、名称 / CAS / 写失败、移除保留后台 PID 与 cwd、同身份重新定位 / 不同目录拒绝、迁移及 desktop / Host / Origin / CSRF；Electron 覆盖完整重启、预填 / 合成 IME / 冲突、断线 / 迟到隔离及明暗 / 1080p / 800px。窄窗重叠有修复前失败 / 修复后通过的几何断言，不靠截图文字断言代替交互。

完整 `pnpm fix`、`pnpm run ci`、`pnpm verify:clean` 退出 0：23 文件 / 192 项 Vitest、57 项浏览器 / Electron E2E、SDK 冒烟、frozen 安装 / 构建 / 原生模块 / HTTP 健康及正常退出通过；锁一致、无新依赖。25 步实际 Windows 微软拼音、未拦截原生选择器、保存失败恢复、同 PID 后台任务、同 data/profile 重启及两次菜单正常退出通过；原生 / 合成 IME、本地样本请求 / 真实提供商分开。首段本地 hold 约 300 秒 terminated、隐藏宿主初次启动和后续明确启动 / 停止均如实保留；不计入正常菜单退出或连续一轮任务证据。产品代码后未改，复用本次 CI / clean，文档 / PRD 回填后单独生成、fix 和完整 check。两项验收通过，OPS-08 第二项仍待生产业务审批 / 双端审批、M3 回滚及平台门禁，整体不提前验收。真实提供商请求 0、配置 / 预算未改，无安装包，网页独立操作暂缓；[逐项证据](../validation/ws-02-evidence/acceptance.md)。

## WS-06 门禁与原生验收

新增 apps/daemon/test/project-organization.test.ts 的 **9 项**实际 SQLite / 显式迁移 / 物理目录 / desktop HTTP / SDK 本地夹具集成与 e2e/project-organization.spec.ts 的 **6 项**实际 Electron 流程，纳入同一完整离线 CI。覆盖持久名称 / 置顶 / 手动排序、新旧迁移、同名 / 检索 / 归属、Unicode / IME / CAS / 写失败、创建原输入幂等及墓碑、未知结果核对、卸载迟到隔离、目录 IO 后准入复核、默认仅未来生效、独立 cwd、解散原子回滚与同 PID 运行保留。编辑后最近工作区完整列表不变有回归断言。

pnpm fix / 完整 pnpm run ci / pnpm verify:clean 均退出 0：**24 文件 / 201 项 Vitest、63 项浏览器 / Electron E2E**、SDK 冒烟、frozen 安装 / build / 原生模块 / HTTP 健康及正常退出。clean 不另跑 E2E，主 CI 已跑完整；初轮 bootstrap 旧迁移数失败（8→9）与最终通过日志分别保留。原生补验后 249 个产品 / 测试 / 配置文件与通过 clean 一致，复用该 CI / clean；文档及进度回填后运行 docs:build / fix / 完整 check。

40 步真实 Windows Electron / SendInput 微软拼音、预填 / 取消 / SQLite 写失败恢复、未拦截选择器、默认变更 / 运行中移除同 PID 与 cwd、明暗 / 窄窗、同 data/profile 重启及两次菜单正常退出均归档；合成 composition 与真实 OS IME 分开。第一段 hold 约 300 秒 terminated，解散验证另起本地轮次并采样相同 turn/PID，最后经产品明确停止，不冒充全程同一轮。真实请求 0，pi 配置与 canonical 预算未改，无安装包，网页版独立功能暂缓。WS-06 四项标 verified；OPS-08 第一项保持通过、第二项仍待生产业务审批 / 双端审批、M3 回滚及平台门禁，整体继续 in_progress。[验收、日志、审计和下一步提示词](../validation/ws-06-evidence/acceptance.md)。

## SESSION-12 搜索门禁与原生验收

新增 8 项实际 SQLite / v3 JSONL / HTTP / SDK 本地夹具服务测试及 4 项实际 Electron 自动流程，已纳入 test:contracts / 完整离线 CI。覆盖中文标题 / 用户 / 助手、工具排除、长正文和超过 100 条历史页的定位、项目 / 状态 / 时间边界 / 归档、脱敏先索引再截片、新凭证更新、迁移 / 索引事务失败 / 源文件竞争、首发 / 续发 / 同 PID 后台、分页 / 200ms / A→B→A / 关闭迟到 / 合成 IME / 失败停止轮询与显式恢复。主动项目迁移 / 删除产品入口未交付，使用明确 SQLite 夹具验证搜索消费边界。

完整 pnpm run ci 退出 0：**25 文件 / 209 项 Vitest、67 项浏览器 / Electron E2E**及 SDK 冒烟通过；pnpm verify:clean 的 frozen 安装 / check / build / test / SDK / HTTP 健康 / 正常服务退出通过。初轮工具类型检查、旧迁移数 9→10 的失败日志及最终通过日志分别保留。历史定位修前加载正确页但滚到最新，实际消息 viewport 断言失败；修后通过。270 个产品 / 测试 / 脚本 / 根配置文件与 clean 一致；文档和进度回填后独立运行 docs:build / fix / check，复用本次 CI / clean。

用户恢复控制后完成 41 条原生观察（首条遮挡截图弃用）：真实微软拼音 Enter / Escape / 数字及 Space 选词、中文标题 / 双角色正文 / 原消息定位、项目 / 状态 / 日期 / 归档 / 分页、脱敏 / 失败停止轮询及明确重试、改名索引刷新、草稿 / 设置返回、明暗 / 800px 与最大化、真实 SDK 本地后台同 PID / 代际与产品显式停止、同 data/profile 重启及两次正常菜单退出。恢复前两次激活失败和强制夹具清理仍作为历史尝试保留，不计正常退出；合成 composition 与 OS IME 分开。原生后产品代码未改，复用通过的 CI / clean，文档生成后另跑完整 check。三项 verified、本地 20 / 133；OPS-08 仍待生产业务审批 / 双端审批、M3 回滚及平台门禁，继续 in_progress。真实提供商请求 0、配置 / canonical 预算未改，无安装包，网页独立功能暂缓；[逐项来源与证据](../validation/session-12-evidence/acceptance.md)。

## WS-03 Git 环境自动门禁与原生验收

新增 **8 项**实际 Git／目录身份／SQLite／desktop HTTP／SDK 本地夹具服务测试，以及 **5 项**真实 Electron 自动流程，纳入 test:contracts／完整 CI。覆盖分支／detached／尚无提交、非 Git／损坏 Git／Git 缺失、子模块／linked worktree／嵌套兄弟仓库、继承 GIT_* 隔离、fsmonitor 不执行、index／HEAD／reflog／最近排序保留、已保存 cwd 与后台同 PID、迟到／失败恢复、长分支、键盘、明暗与390px窄窗。

完整 CI：**26 文件／217 项 Vitest、72 项浏览器及 Electron E2E**，SDK 冒烟通过；frozen clean 的安装／check／build／test／SDK／HTTP 健康／正常退出通过，277 文件与 clean 一致。真实提供商请求0，配置／canonical预算／锁文件未改，无安装包，网页独立功能暂缓。用户明确授权后补齐28步Windows原生操作，覆盖cwd／外部HEAD更新／非Git续发／子模块和多仓库、同PID／epoch后台与cwd保留、明确停止、明暗800px窄窗、同data/profile重启及两次正常退出。重启无内核／新请求、历史不变；277文件与clean一致，复用既有门禁，WS-03两项勾选并verified，OPS-08继续in_progress。[逐项记录及继续提示词](../validation/ws-03-evidence/acceptance.md)。

INPUT-01 新增两项真实 Electron E2E，实际page.reload验证配置恢复；27条原生观察与正常退出已补证。产品未改，只新增测试，复用WS-03未变运行时门禁，本次SESSION-07完整223／78、SDK及frozen clean已覆盖；[逐项证据](../validation/input-01-evidence/acceptance.md)。

## SESSION-07 独立空间与来源门禁

新增6项真实目录／SQLite／HTTP／SDK本地夹具服务和4项实际Electron回归，纳入test:contracts和完整CI。覆盖无项目首发／续发／实际重启、仅精确cwd和指纹信任文本、不继承旧项目、归属CAS／ABA／项目解散、旧库legacy-observed、文件／JSONL／原始输入保持、真实后台同PID、失败／迟到／重新开框与明暗窄窗。项目列表读失败禁保存并保留选择，未知归属不伪装无项目。

最终fix／完整CI／frozen clean全部退出0：27文件／223项Vitest、78项浏览器及Electron E2E、SDK冒烟，已包含INPUT-01两项新增回归。29条Windows原生观察、失败后明确重试、同PID／epoch／cwd后台、明暗800px、同data/profile重启0内核／0重发与两次正常菜单退出通过。282文件与clean一致，原生后复用；文档生成后另跑完整check。三项verified、本地23 / 133，SESSION-13仅整理子集、OPS-08第二项继续未勾选；[逐项来源、失败日志与限制](../validation/session-07-evidence/acceptance.md)。真实提供商0，配置／canonical预算／锁未改，无安装包，网页独立功能暂缓。

## WS-07 门禁与原生验收

WS-07 已验收：完整230项Vitest／82项浏览器及Electron E2E、SDK与frozen clean通过；68条原生观察补齐未信任资源、真实路径丢失与Windows ACL后台停止、原cwd／历史／草稿保留、同物理目录重新定位与明确恢复、明暗800px窄窗、同data/profile重启0内核／0新请求及两次正常菜单退出。288个代码文件与clean一致，原生后复用门禁；本地24／133，OPS-08继续in_progress。真实提供商0、pi配置／canonical预算／锁未改，无安装包，网页独立功能暂缓。

新增服务覆盖真实移动／删除／替换、同身份关联、Windows icacls 只对隔离目录的权限失效与恢复、无视图后台／排队停止、关闭确认丢失、超时／迟到 Task 隔离及 desktop／CSRF。Electron 覆盖历史／草稿、明确校验／选择器夹具／保存、完整重启不重放、故障和迟到以及新草稿失效后的改选；实际设备拔除未验证。初轮 CI 两处旧测试在新 POST 前读取了 pending 按钮／上一轮终态，修正为等待实际请求与本次轮次数；初轮79／81与最终82／82分别归档。窄窗修前失败与后台监测反向验证保留，不能算通过轮次。clean 不重复 E2E，主 CI 已跑完整；原生鼠标／键盘／未拦截选择器、重启及正常退出已补证。详见 [逐项来源、限制与继续提示词](../validation/ws-07-evidence/acceptance.md)。

## OBS-01 已验收

Electron流式与安全内容展示已验收：每帧累计全部delta，非delta状态即时冲刷，权威终态替换去重；CommonMark/GFM安全Markdown、仅显式HTTP(S)链接、禁止自动图片和原始HTML执行、本地协议惰性。16k预览可展开，64k以上纯文本、12k以上代码不高亮，未知语言／未闭合围栏／可选模块失败回退；按需Shiki与异步身份保护。8项新增Vitest、4项新增Electron流程；完整238项Vitest／86项E2E、SDK和frozen clean通过。Windows原生富文本／纯文本切换、长内容展开／收起、明暗主题、同data/profile重启0请求及两次正常退出补证。图示仅惰性代码，未接入执行型图示。真实提供商0、pi配置／canonical预算未改，无安装包，网页独立功能暂缓；OPS-08继续in_progress。[逐项证据与下一步提示词](../validation/obs-01-evidence/acceptance.md)。

## OBS-04 已验收

OBS-04 已验收：Electron 回看不强拉、按消息计数、显式／键盘返回最新、消息锚点与偏移跨分页／3 视图淘汰／renderer 刷新恢复；长文展开保持现场、收起不留空白，后台完成或合成审批观察不抢当前焦点与面板。新增 2 项 Vitest／4 项实际 Electron 回归，完整 31 文件／240 项 Vitest、90 项 E2E、SDK 和 frozen clean 通过；60 条 Windows 原生观察、明暗窄窗、后台同 PID／epoch、同 data/profile 重启 0 内核／0 新请求及两次正常菜单退出补证。304 文件与 clean 一致，原生后复用门禁；当前本地 26 / 133，OPS-08 继续 in_progress。分页行／审批观察均明确为合成样本，完整应用重启不承诺窗口书签；真实提供商 0，配置／canonical 预算／锁未改，无安装包，网页独立功能暂缓。[逐项证据与下一步提示词](../validation/obs-04-evidence/acceptance.md)。

## OBS-03 工具时间线验收

OBS-03 已验收 Electron 工具时间线：调用身份／最终参数与父子关联、拒绝／失败／取消／结果未知、乱序终态保护、脱敏长文明确展开和可验证摘要；未知指标显示未知，Diff 仅观察。原生 Windows 工具卡／长输出／逐轮隔离、后台同 PID／epoch 与焦点、明暗窄窗、同 data/profile 重启不重发和正常退出均已补证，两项勾选。真实提供商 0，工具／扩展继续禁用，不改 pi 配置／canonical 预算，无安装包，网页独立功能暂缓；OPS-08 继续 in_progress。

新增 11 项 Vitest（shared 调用合并／脱敏／摘要／迭代嵌套、SDK 类型映射、实际 SQLite／HTTP／TCP／重启）和 3 项实际 Electron 流程，纳入 test:contracts／完整 CI。真实 SDK 的禁用 write 请求沿用已有本地 HTTP 用例并加强参数／ID／错误断言，不增加请求；拒绝／取消／MCP／Diff／长输出／嵌套来源为明确合成观察，不代表生产工具执行。关键反向控制验证同一会话下一轮相同 ID 不共享展开；初轮脱敏 JSON／运行中工具恢复失败与修后日志保留。自动与原生结果见[验收记录](../validation/obs-03-evidence/acceptance.md)。

OBS-03 已验收：完整 35 文件／251 项 Vitest、93 项浏览器及 Electron E2E、SDK 冒烟与 frozen clean 通过；Windows 原生工具身份／摘要／长输出脱敏与收起、跨会话及逐轮展开隔离、后台同 PID／epoch 和焦点、明暗 802px 窄窗、同 data/profile 只读重启 0 内核／0 新发送／0 注入、历史哈希不变及正常菜单退出已补证。316 文件与 CI／clean 一致，原生后复用门禁；仅文档模板另更新。两项勾选，当前本地 27 / 133，OPS-08 继续 in_progress。合成工具观察与真实 SDK 禁用工具错误分开，未开启生产工具／审批／MCP／回滚；真实提供商 0，配置／预算／锁未改。

## OBS-06 已验收

OBS-06 已验收公开思考权限过滤、默认折叠、脱敏复制下载、本窗口隐藏与明确缺失状态。静态检查、257 项 Vitest／SDK通过；一次 CI 的既有 E2E 超时保留，随后完整95项E2E通过；最终边界加强经47项相关测试、2项Electron和完整frozen clean验证。56条Windows原生观察、明暗802px窄窗、同data/profile重启0发送／0内核、历史哈希不变及两次正常退出补证。319文件与clean一致，原生后复用门禁。本地28／133，OPS-08继续in_progress；真实提供商0，pi配置／预算／锁未改，无安装包，网页独立功能暂缓。[逐项证据与下一步提示词](../validation/obs-06-evidence/acceptance.md)。

## MODEL-07 已验收

MODEL-07 已验收：实际 SDK 请求计数、零自动重试策略、脱敏原错误、权威等待期限／未知等待／到期不执行、终态清除等待、同操作错误合并及工具／审批阻止整任务重放。完整261项Vitest／97项E2E、SDK与frozen clean，55条Windows原生观察、同data/profile重启0请求／0内核及两次正常退出；真实提供商0。 当前本地29／133，OPS-08继续in_progress。pi配置／预算／锁未改，无安装包，网页独立功能暂缓。[逐项证据与下一步提示词](../validation/model-07-evidence/acceptance.md)。
