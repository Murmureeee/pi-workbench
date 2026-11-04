# WS-03 工作区与 Git 环境 · 验收记录

日期：2026-11-04。来源为真实本地 Git／目录／SQLite／HTTP、真实 Electron main／preload／renderer，以及真实 pi SDK + 本地 HTTP 夹具；真实提供商新增请求 **0**。实现与自动门禁已通过：完整 **217 项 Vitest／72 项浏览器及 Electron E2E**、SDK 冒烟及本次 frozen clean；277 个产品／测试／脚本／根配置文件与 clean 输入一致。用户明确授权后已完成 28 步 Windows 原生 Electron 补验与两次正常菜单退出。同 data/profile 重启只恢复观察，未启动内核、未新增请求且 SDK 历史字节不变。产品代码未改，277 文件复核一致，按用户要求复用已通过 CI／clean。WS-03 两项勾选并标 verified，OPS-08 整体继续进行。

## 实现与范围

- Electron 显示实际 cwd（新草稿为待用目录）、仓库根、分支／detached／尚无提交；无目录时不提前创建，非 Git 不阻塞对话。
- 子模块显示自身仓库和主仓库，linked worktree 显示自身 HEAD；嵌套／兄弟仓库按当前 cwd 最近仓库区分，不递归枚举所有仓库。
- 两次 Git 快照与前后物理目录检查；身份 Query key／AbortSignal，重入先检查、迟到不覆盖；失败隐藏旧分支，保留原 cwd／草稿／后台任务。
- desktop-only 配对／Host／Origin、只接收登记 ID，统一脱敏；不加载资源、不写 Git index／HEAD／reflog／配置、不改工作区最近排序、不隐式切换会话 cwd。
- 沿祖先有界核对 .git；明确非 Git 时不启动 Git 子进程，避免 Windows 为目录检测短暂占用待移动目录。实际仓库使用固定 Git plumbing，无 shell／网络／可选锁／fsmonitor／安全目录绕过，输出／超时／并发有界；观察不会启动内核。Git 观察不能保证下一轮执行时环境仍然不变。

## 自动检查

新增 **8 项服务集成／5 项 Electron 自动流程**；pnpm fix、pnpm run ci 与 pnpm verify:clean 均退出 0。完整 CI 含 check／217 项 Vitest／SDK 冒烟／72 项 E2E（含构建）。clean 在新目录执行 frozen 安装、check／build／test／SDK 冒烟、实际 HTTP 健康及正常服务退出，未另跑 E2E。原始命令结果与来源见 validation.json、ci.log、clean-commands.json、clean-workspace.json；4 张实际 Electron 自动截图已经检查。clean 通用工具沿用 OPS-01 的报告标识，destination 与文件哈希对应本次源码；最终文档／进度重建后 pnpm docs:build／pnpm fix／完整 pnpm check 均退出 0，见 fix-final.log／check-final.log。自动验证进程与相关端口已释放，见 automatic-final-closed.json；最终 277 文件对 clean 的哈希复核仍无差异。测试中的网络失败／迟到和 hold 是明确注入；Git init／switch／submodule／worktree 均仅操作本次临时目录。文件探针仅由既有显式打开或发送准入创建，环境观察本身不创建探针。

## 验收覆盖

| 验收项 | 自动证据 | 原生状态 |
| --- | --- | --- |
| 持续显示真实 cwd／仓库根／分支／detached／尚无提交；切换与外部变更更新、迟到隔离 | workspace-environment.test.ts 的真实 Git／身份与 HTTP 测试；workspace-environment.spec.ts 的外部切换、返回／reload、迟到和失败恢复 | 原生 03–05：中文分支、外部切换更新与 detached；27 同 data/profile 恢复原 cwd／仓库／分支 |
| 非 Git／子模块／多个仓库准确区分；不阻止基础对话、不改变已有 cwd | 真实非 Git 首发／续发均完成；子模块／linked worktree／嵌套兄弟仓库；后台同 PID 与保存 cwd、重新定位后仍保留旧 cwd | 原生 07、10–13：非 Git 真实续发完成、子模块／linked worktree／乙仓库；16–18 同 PID／epoch 与原 cwd 保留 |

## 回归修复记录

首次完整 CI 为 217 项 Vitest／SDK 冒烟通过、E2E 71／72，该失败轮次日志保留于 ci-before-directory-lock.log。失败是新增观察对普通非 Git 目录启动 git -C，在 Windows 与已有目录移动流程重叠导致 EBUSY。改为有界核对祖先 .git，不存在时不启动 Git；原有工作区移动／诊断／恢复用例未经删减，定向与最终完整 CI 均通过。

加强新增测试的实际运行／续发等待后，还发现测试 WebSocket 未路由到同一隔离 daemon，以及两轮结果使用了单元素断言；修复测试连接与定位后重跑，失败记录保留于 e2e-before-ws-routing.log。这些修正没有放宽产品断言或引入模拟事件。

## Windows 原生补验

本轮直接操作真实 Electron 窗口，通过 SendInput／UI Automation 输入和系统窗口操作验证，没有 CDP、路由拦截或前端注入。隔离临时 Git 目录、真实 daemon／SQLite／SDK + 本地 HTTP 夹具作为数据来源。28 步截图及可访问树见 native-observations.json 和 native/，运行审计、两次退出与复用检查分别归档。

- 03–05：真实 cwd／仓库根／中文分支、外部切分支自动更新、detached；随后还原夹具原分支。
- 07、10–13：普通非 Git 目录与首发／续发 OFFLINE_OK，子模块自身 beta／主仓库、独立 linked worktree 分支及乙仓库 beta，返回既有会话不改变 cwd。08 名称虽带 completed，当时仍排队，完成以 13 和最终 submission 为准。
- 15–20：第一段 hold 后来 failed／terminated，如实保留，不计为正常停止；随后点击产品明确重试。16／17／18 的短时审计均为同 PID 29412、同 epoch 正在运行，跨工作区与乙仓库再返回保持甲 cwd；再点击“停止本轮”，20 及最终 SQLite 确认为 aborted。19 是点击后的即时观察，不单凭它宣称终态。
- 20、22–24：原生深色全宽、实际 800px client（802×961 外窗）深色／浅色、长路径换行与刷新入口可用。21 的拖动尝试仍为宽窗，不充当窄窗证据。
- 25–28：文件菜单正常退出；同 data/profile 重启，打开甲会话恢复 cwd／仓库／分支和真实历史终态，没有内核或新 prompt，SDK JSONL 哈希不变；再次菜单正常退出，窗口消失、所属进程退出、4317／5173 已释放。

原生本地请求计数为夹具种子 2 次和 UI 明确发送／重试 3 次，真实提供商 0 次。配置及 canonical 预算哈希不变。277 文件与 clean 逐项哈希一致，原生阶段未改产品代码，复用既有 217／72、SDK 与 frozen clean 门禁；文档进度重建后另跑完整 check。

## 约束

pi 配置、canonical 预算与用户仓库不改；无真实提供商请求、无安装包、独立网页版暂缓。尚无 Git 写入／切换 UI，相关 Git 功能按后续条目验收。

下一步提示词：完成 INPUT-01：文本输入、中文输入法与草稿。优先 Electron，覆盖 Enter／Shift+Enter／真实中文 IME、空白拒绝、新会话与已有会话独立草稿，以及切换／刷新恢复正文、项目和模型、迟到隔离。默认离线，沿用验收与费用约束，不改 pi 配置、不额外调用模型、不制作安装包，网页版独立功能暂缓。完成测试和实际 Electron 验证，更新进度并给我下一步提示词；未改代码时复用已通过 CI／clean。
