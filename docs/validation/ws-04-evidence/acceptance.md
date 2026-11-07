# WS-04 同目录写入互斥与外部改动


WS-04 两项验收已通过并标为 `verified`。2026-11-07 用户明确授权电脑控制后，补齐最终完整 122 项浏览器／Electron E2E、Windows 原生排队／后台／外部改动／明暗窄窗、同 data/profile 重启及两次正常菜单退出。按用户要求复用源码未变的静态检查、51 文件／332 项 Vitest、SDK 冒烟和 frozen clean；完整 CI 各阶段已齐备，本轮没有重新执行单条 `pnpm run ci`。从 canonical backlog 重新计算本地为 39／133，OPS-08 继续 `in_progress`，CHANGE-01 仍未开始。

## 运行规则与实现

复用 WorkspaceService 的 realpath 与 platform／dev／inode／birthtime 物理身份；别名和父子重叠目录互斥。当前受管 SDK 轮次都具有请求固定写工具的能力，因此在模型／内核准入前保守占用目录；目录等待不消耗名额，重叠目录保持 FIFO，独立目录可越过阻塞继续执行。审批与不可回滚单次确认仍独立存在，目录占用不授予执行权限。

daemon 独占 DirectoryWriteService、0014 观察元数据和最终工具守卫；所属会话可以取消排队，旧 turnId 不能停止新任务。流式终态、停止请求或视图卸载不能释放占用，必须等 SDK prompt 落稳或实际进程退出，并成功保存最终观察。写入失败保留隔离；重启不接管运行时、不恢复授权或重发，旧 PID 仍存活只保留阻塞隔离。PID 复用可能保守延长隔离，不据旧 PID 杀死不明进程。

Electron 在既有工作区环境区展示占用会话、轮次、等待位置和原因，折叠详情及来源警告在原区域内部滚动。目录空闲但模型槽已满时显示等待模型名额。只读状态端点仅接受配对 desktop 的已登记身份；使用统一脱敏及 directory-write-v1 必需能力，旧能力夹具已相应更新。

元数据观察限 2048 目录项／8 层／约 1 秒，不读文件正文、不跟随链接，跳过 .git／node_modules／.workbench 并标记范围受限。每秒及收尾保存最多 32 个脱敏变化路径；未完成遍历不据缺失项推断删除。所有记录固定 `provenance=uncertain`、`automaticRollback=false`。外部编辑、工具、终端可能混合，不能把观察当作 agent 独占修改或整轮回滚资格；没有变化也不能证明没有外部编辑。恢复基线、持久文件版本、Diff、来源归属和回滚仍待 CHANGE 功能。

Windows 实际 IPC 断开揭示 SDK 进程已触发 exit 而 Node close 未结束的回收等待。现以 exit 作为进程退出证明，关闭仅供诊断的 stderr；close 保留为启动失败未产生 exit 的后备，结束处理幂等。该修复没有把 IPC 断开本身当作退出确认。

## 自动验证与来源

13 项服务测试使用实际 SQLite／文件系统／IPC／安装 SDK 1.4.0 和本地 HTTP 夹具，资源限额为 4 内核／3 模型任务，避免默认单模型槽掩盖竞争。[初次最终服务集](service-final.log)13 项通过；随后补强同文件混合编辑，最终版本进入下述全部 332 项门禁。覆盖别名、父子目录、不同会话 FIFO、独立目录同时运行、排队取消、迟到停止、待审批、真实批准写入、持久收尾前阻塞、内核硬杀、实际 IPC 断开、退出、SQLite 最终保存失败隔离、外部文件修改／创建／删除和重启零授权。

实际 IPC 测试只用 spy 捕获真实 SDK 宿主对象并断开其 ChildProcess 通道，不替换 prompt、守卫或业务生命周期。运行中的 PowerShell 命令写入 STARTED、等待 8 秒再写 FINISHED；分别注入 IPC 断开与 SDK 硬杀，继续观察 8.5 秒，确认后续轮次准入后没有旧动作的延迟写入。主动排队仅代表明确新请求，不是故障重放。

同文件混合场景先通过真实 SDK 工具写入 APPROVED.txt，宿主在最终观察保存前用明确测试门保持占用，再实际改写同一文件为包含 SDK 字节和外部字节的混合内容；最终保留全部混合内容，来源仍为 uncertain，automaticRollback=false。门只延迟收尾，不替换 SDK 写入或文件 IO，也不代表已交付回滚 API。

旧 PID 隔离使用实际存活 Node 辅助进程及明确合成的旧占用记录，不能冒充 SDK 历史或旧授权；读取身份失败为显式注入，SQLite 保存失败为实际触发器拒绝。外部文件由测试宿主实际改写，不冒充 SDK 工具产物；原生历史／配置和 canonical 预算没有被替换。

[暂停电脑控制前的 6 项相关 Electron／浏览器验证](electron-final.log)通过，其中新增 WS-04 4 项，既有 CORE-07 资源 2 项。实际 main／preload／配对 IPC／renderer／daemon／SDK，经隔离 HTTP／WS 路由连接测试服务；503 是明确路由故障夹具。覆盖排队归属、取消零 dispatch、独立目录同时运行、审批后的真实文件写入与交接、外部编辑、目标隔离、失败恢复、800px 明暗和停止／输入可达、完整同 data/profile 重启与历史不变。资源 FIFO 夹具改用独立目录，保持其原本的模型槽验证目的。其后资源夹具类型与 SDK 退出／回执竞态修正，均已由本轮[最终完整 122 项 E2E](e2e-authorized-recheck.log)覆盖，含上述 4＋2 项；该最终运行退出 0。自动路由、合成观察和自动截图不作为 Windows 原生证据。

[最终非窗口门禁](non-ui-gates-terminal-final.log)的 `pnpm check`、全部 **51 文件／332 项 Vitest** 及 `pnpm smoke:sdk` 均退出 0；SDK 冒烟为实际 1.4.0 子进程＋本地 HTTP，两次本地请求、真实提供商 0。`pnpm fix` 已完成。[frozen clean](clean-workspace.json)及[完整命令输出](clean-commands.json)确认新目录 frozen 安装、check、完整 build、332 项测试、SDK 冒烟与服务正常启停均通过，锁哈希一致。clean 的 HTTP 页面／模块 200 是服务检查，没有启动窗口或进行视觉验收；工具保留通用 OPS-01 报告标识，验证的是本次源码副本。补强前的[非窗口门禁](non-ui-gates.log)和[clean 结果](clean-before-mixed.json)／[命令](clean-commands-before-mixed.json)仍保留；后续重跑由同文件混合内容断言及实际退出竞态修复触发。

本轮完整窗口阶段首轮为[121 过／1 失败](e2e-authorized-final.log)：SESSION-07 的业务断言完成后，夹具退出时仍有 `route.fetch`，请求上下文先关闭。仅在 E2E helper 退出前等待 `unrouteAll({ behavior: 'wait' })` 排空正在转发的回调，保持错误可见；[原用例连续 3 次](window-teardown-recheck.log)、[本地 fix／check](window-helper-fix-check.log)及最终完整 122 项通过。失败日志只脱敏临时夹具 Cookie 头，原始日志与 trace 留在忽略的 `.workbench/ws04-window-failure`，失败事实和业务断言完成后的时序保留。

[代码一致性审计](code-reuse-audit.json)的 363 个产品／测试／脚本／根配置文件与补充后的 clean 副本逐字节一致。[helper 改动前审计](code-reuse-before-window-teardown.json)保留原 frozen 状态；之后只有 `e2e/helpers/desktop.ts` 改动，产品源码、构建输入与依赖未变。将 helper 同步到既有 clean 副本后执行[完整 clean check](clean-window-helper-check.log)通过；原 frozen 安装／构建／332 项测试／SDK／服务启停按用户要求复用，不能称本轮重新执行了一次完整 frozen clean。文档及进度回填后另执行 `docs:build → fix → check`，见[最终文档门禁](docs-authorized-final.log)。

[机器可读验证状态](validation.json)、[原生汇总](native-validation.json)、[保护文件哈希核对](protected-audit.json)与[依赖核对](dependency-check.json)分别记录。真实提供商请求始终为 0，pi 配置、canonical 预算、依赖和锁文件未改；无安装包，网页独立业务暂缓。WS-04 的通过不代表后续 M3 回滚及平台阶段门通过，OPS-08 继续 `in_progress`。

## 失败与修复记录

- [初次服务测试](targeted-initial-failure.log)3 项失败：Windows 活动 cwd 移动触发 EBUSY，以及两项既有模型队列断言被新的目录互斥先挡住。读取不可用改为明示身份 IO 故障，模型并发夹具使用独立目录；[后续 20 项](targeted-second.log)通过，后续新增测试继续进入最终 13 项服务集。
- [初次 lint](lint-initial-failure.log)、[中间格式检查](format-intermediate-failure.log)保留，修正测试断言消息、类型和格式。新增 IPC 测试的 [lint 失败](ipc-test-lint-failure.log)来自 unbound-method／this-alias，改为只观察 spy 的真实调用上下文，不禁用规则。
- [首轮 Electron](electron-initial-failure.log)3 过／1 超时，轨迹证明窄窗收起侧栏后测试直接寻找新会话。测试先展开导航，随后 [4 项](electron-second.log)及最终相关 6 项通过。
- [首轮完整 CI](ci-first.log)310 过／17 失败：9 项迁移计数或旧库回退夹具未移除新表，7 项协议能力夹具未更新，另 1 项宿主退出前未报告 SDK PID。补齐迁移／协议后 [40 项协议与内核](contracts-recheck.log)通过；宿主退出的单次瞬时失败未推定已定位，原断言保留。
- [第二轮 CI](ci-second.log)327 项测试和 SDK 冒烟通过；E2E 的旧资源队列夹具因同目录先被挡住而失败。该轮在已有失败及新 IPC 问题需要构建修复后主动终止，不作为完整通过证据。资源夹具改用独立目录，原模型槽断言保留，已进入最终 6 项回归。
- [IPC 初次超时](ipc-disconnect-initial-failure.log)及[退出轨迹](ipc-disconnect-diagnostic-failure.log)分别保留。实际退出已发生，close 未完成；回收修复后 [3 项 IPC／运行中命令](ipc-command-recheck.log)通过，最终完整 13 项服务集继续通过。
- [第三轮 CI 的类型失败](ci-pre-window-type-failure.log)发生在窗口阶段之前：旧资源夹具 roots 数组索引为 `string | undefined`。改用具名对象后当时 check、330 项测试和 frozen clean 通过；当时用户要求所有窗口操作等待明确指令，因此该轮没有继续窗口阶段，也不记为完整通过。授权后的最终窗口阶段结果另见上文。
- 补强混合编辑断言后的首次[文档检查失败](docs-generation-order-failure.log)来自 backlog 说明先更新、生成 PRD／看板尚未重建；该轮未进入测试。按顺序先生成文档后再执行最终非窗口门禁，没有改动规划校验断言或降低检查。

- [补强后的 clean 失败](clean-mixed-failure.log)为 329 过／1 失败，[命令原文](clean-commands-mixed-failure.json)保留。实际 SDK 已退出且 exit(0)，有效 disposed 回执随后才由 IPC 投递，原宿主过早标为 failed。[真实 Windows 子进程轨迹](shutdown-diagnostic-failure.json)及[原始诊断](shutdown-diagnostic.log)独立保留；此为命令行进程证据，不是原生界面验收。
- 新的[受控顺序红回归](exit-before-ack-red.log)证明旧代码在有效回执投递前提前完成 dispose；只延迟真实 SDK 消息至实际 OS exit 后，不伪造消息或退出。修复分别等待实际退出与有效回执，缺少回执的明确合成 IPC 夹具仍为 failed。最终[相关 46 项](exit-before-ack-green.log)、[10 次实际 SDK 退出复核](shutdown-repeated-green.log)及全部 332 项／frozen clean 通过；10 次复核不改消息投递顺序。
- 首次[相关 45 项](exit-before-ack-targeted-failure.log)44 过／1 失败，独立目录流式等待未在原 20 秒夹具期限内建立观察。增加失败时的实际内核／队列／原错误诊断，未改等待期限或放宽断言；后续 46 项及完整门禁通过，单次失败的确切原因证据不足，不宣称已定位。
- 诊断回归的[lint 失败](diagnostic-lint-failure.log)来自仓库只接受单参数 expect，改为失败时补充 Error cause；[类型失败](exit-event-test-type-failure.log)来自 ChildProcess.emit 重载将 mock 参数推断为 spawn，显式声明事件联合与 unknown 参数后通过。初次[诊断脚本设置失败](shutdown-diagnostic-setup-failure.log)将只读句柄误当内核对象，修正只读捕获后才取得上述实际轨迹；不计作产品失败或成功。

## Windows 原生验收

早先隔离环境仅取得初始 UIA 只读观察，窗口激活两次返回 `failed to activate captured window`，没有发送任务或审批。被遮挡的非产品图像已排除；用户收回授权后停止操作，只清理本任务零请求夹具。[初始环境清理审计](setup-cleanup-audit.json)的 `normalMenuExit=false` 保留，不能计作本轮菜单退出。

本轮授权后在新的 `.workbench/ws04-native-I53KbY` 使用实际 Windows UIA／SendInput、真实 Electron／daemon／SQLite／SDK 1.4.0 与本地 HTTP，4 内核／3 模型槽；没有 CDP、renderer 路由或 fake kernel。夹具只明确选择 approval-write／hold，并通过宿主控制文件实际改写 `external.txt`。[82 条观察](native-authorized/observations.json)与同编号审计、14 张关键产品截图归档于 `native-authorized/`；82 条包含设置和中间态，不能称为 82 项独立成功验收。

| 场景 | 实际结果与证据 |
| --- | --- |
| 同目录占用和排队 | 甲 `ab3d3cca`／turn `edcb9f6f` 在 PID 39584 待审批；乙 `a6bc2ebc` 显示第 1 位、完整甲会话／轮次、同物理或父子重叠原因及尚未发送。乙没有 SDK 内核／观察，见观察 9、14–16 和[排队详情](native-authorized/queue-details-0.jpg)。 |
| 所属取消 | 原生停止乙后 submission 为 aborted，目录等待／停止按钮消失、侧栏不再运行；甲保持原 PID／epoch。乙从未 dispatch，见观察 18–19。它无 SDK runtime，运行时区仍显示等待重新连接／状态待同步，不能声称该处显示“本轮已停止”。 |
| 独立并行和后台 | 丙 `de8f59da` 在 PID 33016、独立 cwd 与甲同时运行，modelTasks=2。切设置再返回，两任务 PID／epoch／cwd 不变，丙草稿保留；明确停止丙后 aborted／released、界面显示本轮已停止，见观察 24、27、29、31。 |
| 实际外部编辑 | 甲待审批时宿主实际改写 external.txt，原生显示路径、来源不确定及禁止按 agent 独占回滚；记录 uncertain／automaticRollback=false，见观察 33 和[原生展示](native-authorized/external-edit-0.jpg)。实际同文件 SDK／外部字节混合由上述服务集成验证，本原生场景没有冒充同文件混写。 |
| 明暗窄窗 | 原生边框拖至 802×761，浅色跟随系统、深色由原生主题控件选择。工作区和审批内部滚动，输入／停止可达；见[浅色](native-authorized/light-802x761-0.jpg)、[深色](native-authorized/dark-802x761-0.jpg)。稳定最大化产品窗为 1920×1032。 |
| 审批与交接 | 丁 `138c47d0`／turn `15bf5af0` 等甲收尾，未提前建内核；展开甲完整 write 参数、允许本次并明确确认本次不可回滚后，真实 SDK 写入 APPROVED.txt=SEC02_APPROVED_ONCE。甲 completed／released 后丁才在 PID 18540 运行，甲保留两个变化路径和来源警告；丁随后明确停止，见观察 52、56、61、63、65、67。 |
| 退出及重启 | 退出前新建会话 `846d0496` 在 PID 31336 待审批，未批准；原生文件菜单选择退出，宿主正常关闭。使用同一 data/profile 重启后只读打开甲及退出前会话：来源警告仍在，旧 write 为 denied、没有允许按钮；0 新发送／0 内核／0 队列／0 待审批／0 授权，见观察 72、75、77、79。 |
| 两次正常退出 | 两次均原生文件菜单 → End → Return，之后确认无窗口、`NATIVE_CLOSED_OK`、宿主退出 0；见[首次菜单](native-authorized/first-menu-exit.json)、[再次菜单](native-authorized/second-menu-exit.json)、[首次日志](native-authorized-first.log)、[重启日志](native-authorized-restart.log)。最终本任务 8 个 PID 均不存活，4317／4318／5173 无监听，见[只读核对](native-authorized/final-process-inspection.json)。 |

[首次正常关闭后的 4 份 SDK JSONL](native-authorized/first-closed.json)与重启前、只读打开后和[第二次关闭](native-authorized/restart-closed.json)哈希一致，实际文件内容保留，配置／预算／锁哈希一致。first-closed 的大多数状态是退出前最后一帧，只有 closed／historyAtClose／protectedAfterClose 属于关闭后；重启零授权以重启审计另行证明，不能误读退出前 pending 字段。授权数按 `grants.grants.length` 核对。

中间态与工具限制保留：首次点击缺少坐标几何，重新激活和截图后继续；主题弹层鼠标目标报 Chrome Legacy Window 不匹配，重查后 End／Return 选深色；首次拖角选中文字，改为边框拖动成功；扩大窗口的越界拖动被工具拒绝，随后原生最大化。最大化动画一帧含背景 Codex，未归档图像、不作产品视觉证据。中文由 Windows UIA set_value 填入，没有新增真实微软拼音／IME 证据。IPC／硬杀／运行中命令故障清理由实际服务自动测试证明，本轮原生没有重复注入这些故障。

- [x] 排队归属、取消及独立目录并行，后台 PID／epoch／cwd 保持。
- [x] 实际外部编辑与来源不确定；明暗窄窗输入／停止可达。
- [x] 同 data/profile 重启零新发送／零内核／零待审批／零旧授权，4 份 SDK 历史哈希不变。
- [x] 两次原生文件菜单正常退出。

## 下一步提示词

[依赖核对](dependency-check.json)确认 CHANGE-01 的 CORE-03／WS-04／CORE-06 均为 verified；推荐只进入 CHANGE-01，不直接实施后续 Diff 或回滚。

请在 D:\Project\pi-workbench 完成 CHANGE-01「轮次基线与持久快照」。遵循根协作指南，先核对 canonical backlog、产品决定、CORE-03 证据、WS-04 运行规则与当前实现，保留已有工作。先细化写入前基线、持久文件版本及成功／失败／中止记录规则，再实现 daemon、共享契约与必要 Electron 展示；复用 WS-04 物理目录身份、互斥及实际落稳／进程退出后释放的生命周期，不改用户仓库提交历史。基线失败先暂停，只在用户单次明确接受后执行已说明的不可回滚动作；混合或无法证明来源的内容继续标来源不确定、禁止作为 agent 独占修改自动回滚。范围仅 CHANGE-01，不提前交付 Diff、文件或整轮回滚。用实际文件／独立账本／SQLite／SDK 本地夹具覆盖原有改动保留、基线失败、成功／失败／中止、外部混入、重启不恢复旧授权及不重放；补服务与 Electron 回归，完成格式化、完整 CI 与 frozen clean，只因新变更或未解问题重跑。按实际证据更新进度与生成文档，OPS-08 继续按跨阶段门判断。真实提供商请求 0，不改用户 pi 配置、canonical 预算或锁文件。所有启动或操作窗口的电脑控制留到开发和命令行验证最后，等待我再次明确授权后再做 Electron 窗口阶段与 Windows 原生验收；未通过的验收保持未勾选。完成后说明实现、验证、限制及经依赖核对的下一步提示词。
