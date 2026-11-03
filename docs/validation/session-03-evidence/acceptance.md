# SESSION-03 验收记录

2026-11-03：两条验收通过，SESSION-03 为 `verified`，前置 SESSION-02 已验收。本地进度按 canonical backlog 计算为 **16 / 133**；OPS-08 仍 `in_progress`，第二条跨阶段验收不勾选。来源为实际 daemon / SQLite / pi SDK 子进程 + 本地 HTTP 夹具及实际 Electron；工具、扩展和真实提供商关闭，新增真实提供商请求 **0**，无安装包，独立网页功能暂缓。

## 逐项验收

| 验收项 | 实现与自动验证 | Windows 原生验证 |
| --- | --- | --- |
| 置顶、未读和归档在重启后保持，归档记录可恢复 | `session_organization` 的 SQLite 迁移 / CAS revision；真实服务和 Electron 重启后逐字段相同。恢复不启动 SDK、不改历史或恢复授权，归档禁发但保留草稿。结果与阅读版本独立，重复终态不产生新未读，旧版本回执不能抹去新结果或手动标记。 | 甲置顶 / 未读 / 归档 → 产品文件菜单正常退出 → 相同 data/profile 重启，三个状态与 revision 6 均保持；恢复后仍置顶 / 未读、kernels 为空，打开可读。历史中段及切换返回 unread=true，滚到最新才清除。 |
| 运行中归档先说明是否停止；隐藏列表项不会伪装任务已结束 | daemon 同步检查真实 SDK / 内核 / FIFO 队列、接受提交、待审批和 held 记录；SQLite 事务再检查归档 / 发送竞态。取消不停止，明确停止经 KernelService.abort，settled 后再次单独确认归档。 | 乙后台真实运行，归档提示先停止且确认禁用；取消后 PID 39844、epoch、running 不变。再次明确停止后 status=aborted / running=false / archived=false，另点确认才归档。丙重复补验并确认停止成功提示与服务状态一致。 |

用户已确认“读到最新才清除未读”。自动回执还要求活动对话、窗口可见且有焦点、对应终态确已展示；打开会话、隐藏缓存、历史面板和中段书签不会清除。手动已读 / 未读可用，原地轮询不清除手动标记。列表按已置顶、项目、最近无项目组织，独立归档列表可恢复；后台运行 / 待审批 / 待处理与未读均含文字。

主要实现：`packages/shared/src/session-organization.ts`，`apps/daemon/migrations/0005_session_organization.sql`，`SessionStore` / `SessionService` / `session-command.transport.ts`，`apps/web/src/features/conversation/session-library.tsx` / `use-session-organization.ts` / `managed-thread.tsx` / `remembered-viewport.tsx`。菜单与确认框复用官方 shadcn Base UI/base-nova 源码，无新依赖或锁文件变更。桌面整理 HTTP 继续要求已配对 desktop 身份、Host / Origin / JSON / CSRF 及变更协议能力检查；保存失败不显示成功、不自动重试 POST。

## 自动门禁

- `pnpm fix` 与最终完整 `pnpm run ci` 退出 **0**：[最后提示文案补验 CI](ci-native-followup.log) 为 **21 文件 / 179 项 Vitest、49 项浏览器与 Electron E2E、SDK 冒烟**全部通过。此前同样通过的 [ci-final.log](ci-final.log) 独立保留。
- 新增 **7 项** `apps/daemon/test/session-organization.test.ts` 覆盖真实持久化、CAS / 终态去重、运行及排队、归档 / 发送竞态、写失败 / 权限、迁移与中断恢复；新增 **5 项** `e2e/session-library.spec.ts` 覆盖实际重启、阅读位置 / 手动标记、取消 / 停止 / 再确认、失败与迟到列表、后台失败未读且无自动重发。完整回归保留 SESSION-01 / 02 的 IME 合成、草稿、3 视图、重连和卸载恢复。
- `pnpm verify:clean` 退出 **0**：[结果](clean-workspace.json)、[完整命令输出](clean-commands.json)、[日志](clean.log)。新目录 frozen 安装、check、build、179 项测试、SDK 冒烟、健康检查和开发服务正常退出通过；报告沿用工具的 OPS-01 标识，不代表安装包验收。clean 在最后停止提示文案修改前运行，依赖 / 原生模块 / 构建 / daemon 均未再变，复用这部分基础设施证据；文案后的完整 CI 已重新运行。
- 锁文件 SHA-256 为 `d9d46d301907ef4d86e5c53de3eca57433f5978ebf1e6547f8d094f50a60b40a`，与 frozen 副本一致。文档 / 进度最后通过 `pnpm docs:build`、`pnpm docs:check`、`pnpm fix` 与 `pnpm check` 校验，生成文件只由源码生成。

实际 Electron 的 [1920×1080 亮色](session-library-light.png)、[深色确认框](session-library-dark-dialog.png)、[800px 深色与键盘焦点](session-library-dark-800.png)、[运行中归档](session-library-running-archive.png)、[后台失败](session-library-failed-result.png)均经截图复核；专项还检查 pageerror、Enter / Escape 和 back / forward 后隐藏视图不残留弹窗。故意注入的 SQL 错误和 `OPS-08 synthetic renderer fault` 是明确的故障测试，不是未处理门禁失败。

## 原生证据

[原生步骤与限制](native-validation.json)记录实际鼠标 / 键盘、UIA 和无传输拦截的宿主。关键截图、UIA 与同刻审计按同名文件配套：

- [重启前](native-before-restart.jpg) / [重启后](native-after-restart.jpg) / [恢复未启动内核](native-restored-no-kernel-audit.json)。
- [中段返回仍未读](native-returned-mid-unread.jpg) / [最新才清除](native-latest-read-audit.json)。
- [后台运行](native-background-running-audit.json) / [取消后同 PID](native-cancel-keeps-running-audit.json) / [停止后尚未归档](native-stopped-before-archive-audit.json) / [单独确认后归档](native-background-archived-audit.json)。
- [停止成功提示补验](native-stopped-confirmed-copy.jpg) / [最终归档列表](native-final-archives.jpg) / [原生最大化](native-maximized-final.jpg)。
- 两次正常文件菜单退出的宿主退出码均为 **0**，[首次关闭](native-first-closed.json)、[最终关闭](native-final-closed.json)及[最终审计](native-final-audit.json)保留 closed / ownedProcessesExited、提交、任务状态、配置与预算摘要。[重启宿主日志](native-restart-host.log)包含文案 HMR 和 `NATIVE_CLOSED_OK`。

预算原件 SHA-256 前后为 `cbc52551a5e083e17dd8f1f2343a67ebab8b05a199b53ecb5d48be48f25f1251`；仅使用隔离的无凭证 pi 夹具，三个配置文件摘要前后不变。初始三条完成历史由本地 SDK 夹具预置，本轮原生两次 hold 输入均实际停止，不是模型付费请求。

## 回归修复及边界

完整回归发现旧历史完整消息也按流式未完成文本脱敏，吞掉末尾字符。现在保留 `incomplete` 元数据，完整 user / tool / 已完成 assistant 使用完整脱敏，截断或中断 / 未知 assistant 继续保护密钥后缀。[修复前](legacy-suffix-before.log)在实际 HTTP 断言失败，[修复后](legacy-suffix-after.log)六项服务用例通过，四项切换流程也通过 [switching-diagnostic.log](switching-diagnostic.log)。原件没有改写。

本机 Windows 的低位动态端口范围可能让 `listen(0)` 分配 fetch 禁用的 6000。新增实际 HTTP 回归，[修复前](fixture-port-before.log)为 `fetch failed / bad port`，[修复后](fixture-port-after.log)通过；离线夹具在高位端口绑定，仅在请求发生前对 EADDRINUSE 有界重绑，不重试模型请求。此前 [CORE-07 偶发失败](ci-resource-failure.log)和[旧切换 seed 失败](ci-seed-and-redaction-before.log)缺少完整底层 cause，**不能断言二者已被证明由该端口问题引起**；诊断断言已补全，最终两次完整 CI 均通过，原失败输出保留。迁移夹具计数及旧按钮定位更新也保留对应失败日志，没有 skip、放宽断言或删除测试。

本轮原生中文为直接文本输入，不能充当真实 IME；composer 未改变，复用 [SESSION-01 微软拼音记录](../session-01-evidence/native-validation.json)，合成 composition 随 CI 继续执行。原生为普通窗口及最大化 **1920×1032 Windows 工作区**，不能称为原生 1920×1080；深色、1080p、800px、键盘流程是实际 Electron 自动 E2E 的证据。

待审批 / held 队列以显式合成记录验证阻止归档，不冒充生产审批；停止失败 / 未知结果保留任务和归档状态供核对。整理元数据跨应用重启，草稿 / 阅读书签仍按 SESSION-02 的 sessionStorage 边界，不承诺跨窗口 / 完全退出后保留。旧 pi 历史继续只读。生产工具审批、会话改名 / 多端业务同步、M3 回滚与后续平台门禁仍待各自验收，OPS-08 不提前完成。
