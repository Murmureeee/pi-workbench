# OBS-02 运行阶段与中止结果

两项已勾选并 verified。完整离线门禁与 Windows 原生验收已完成，逐项来源与限制如下。

run-stage-v1 枚举观察覆盖启动、准备工具、执行工具、等待模型、接收文本、压缩与收尾；实际 SDK fetch／text_delta／compaction_start/end／tool_execution 与 prompt settled 提供来源，不从文本猜阶段。stage.updated 随 CORE-05 身份及顺序校验、持久检查点和统一脱敏；重启只恢复终态／中断观察，不恢复阶段计时或工作。无数据库迁移。生产工具、扩展、压缩和自动重试继续关闭。

Electron 当前阶段仅在输入区上方固定位置呈现，历史行只保留较早操作状态；同一操作提交／事件／模型错误只保留一处主反馈，原错误仍保留在历史来源。同请求身份消隐只修改本窗口状态，终态以外无消隐入口；未知停止、待审批与held输入保持未处理。等待期限仅显示宿主期限，不自动执行。

停止意图绑定 requestId／turnId，请求中、请求确认等待结果及失败未知分开；HTTP成功也不直接显示已停止。实际 SDK settled 或持久终态与运行观察一致后才确认，断线／不一致／内核连接丢失不冒充成功停止。KernelService 的失败回收先等待受管运行时退出，发出缺少SDK结果的fallback不按AbortSignal伪装确认。

首次新增服务测试误读检查点目录checkpoints，实际为inflight；修正后6项阶段／真实SDK测试通过。首次7项Electron定向5过2失败：合成夹具重置同epoch游标，真实客户端正确拒绝倒退快照。夹具替换后建立新只读观察，保留生产防倒退规则；失败上下文归档。最终结果见下文。

第一次完整 CI 在工具 TypeScript 检查中发现测试数组可能为空，已用明确守卫修正。随后完整 42 文件／270 项 Vitest 与 SDK 通过，102 项 E2E 为 90 过、12 失败：共用 Electron 驱动只把 HTTP 转发至隔离 daemon 4318，WebSocket 仍连接开发 daemon 4317；新状态区正确保持“运行状态待同步”。修正共用测试入口，使实际 TCP WS 和 HTTP 使用同一隔离服务，保留产品的同步与游标防倒退要求。失败日志和原上下文保留为 ci-before-isolated-ws-fix.log、session-before-isolated-ws-fix.md；最终重跑见下文。

共用连接修复后，11 项会话创建／执行空间定向回归通过；第二次完整 CI 为 270 项 Vitest／SDK 通过、101／102 项 E2E 通过。WS-07 失效目录的 800×760 窄窗暴露真实裁切：composer 上限 50% 时发送按钮仅约 43% 可见。恢复原有 60% 输入区上限，让阶段区在 36px 最小高度与 26vh 上限之间收缩、内部滚动；保留消息区至少 120px，不放宽原发送按钮完整可见断言，并增加当前阶段区完整可见断言。失败见 ci-before-narrow-status-fix.log／narrow-status-before-fix.md；11 项模型／思考／阶段／目录恢复定向回归全部通过，截图见 obs-02-directory-recovery-dark-800.png。最终完整重跑见下文。

布局修复版完整 270 项 Vitest／102 项 E2E／SDK 与 frozen clean 通过，记录保留为 before-terminal-read-hardening 文件。代码复核再补一条显式 HTTP 终态先到、WS 压缩观察迟到的实际 Electron 回归：修前确实显示“本轮已结束 · 压缩上下文”（terminal-read-before-fix.log／md）。简略文字现完全服从纯阶段选择，不再从原提交状态引入终态；同一测试修后通过（terminal-read-after-fix.log）。该用例的终态读取与压缩为明确合成传输顺序，不代表开启真实压缩；SDK 任务保持运行、恢复真实读取后再明确停止。首次用例导入包名在根 E2E 环境无法解析，修为既有公共编译入口，启动失败另存 terminal-read-fixture-import.log，不冒充缺陷复现。最终版本完整门禁见下文。

默认离线，真实提供商请求0，pi配置／canonical预算／锁未改，无安装包，网页独立功能暂缓。

最终代码门禁：pnpm fix、完整 pnpm run ci（42 文件／270 项 Vitest、102 项浏览器及 Electron E2E、SDK 冒烟）及 pnpm verify:clean 全部退出 0。最终 frozen 安装／检查／构建／270 项测试／SDK／HTTP 健康与正常退出通过，锁哈希一致。335 个产品／测试／脚本／配置文件与 clean 字节一致，见 code-reuse-audit.json；未改产品代码时复用这些门禁。

首次原生控制被工具报告实体 Escape 中止，遵循规则停止输入，记录保留在 native/control-interrupted.json。用户随后明确恢复授权；窗口最小化和检测到用户输入导致还原受阻，用户手动还原后继续。未使用绕道输入或把中止记录算作原生通过。两张误捕获其他前台程序的截图已排除，仅保留观察元数据。

续验使用 @oai/sky 的真实 Windows SendInput／UIA，共 88 条观察（含中间、无效点击与重试），实际 Electron／daemon／SQLite／SDK 使用隔离 data/profile 与回环 HTTP reply／hold／error 夹具。原生阶段没有 CDP、renderer 路由或合成阶段注入；宿主仅明确注入一次 abort transport failure，以验证停止未知，SDK 本身保持运行。此次 Unicode SendInput 不是新增微软拼音 IME 证据。

正常首发遇到真实 SDK guard handshake 超时，失败提交保留、没有自动重试；明确点击重试后 OFFLINE_OK，当前主提示为“本轮已结束”。点击消隐后权威结果、队列、提交、快照、JSONL 哈希均不变。停止失败显示“停止结果未知”，无消隐入口；切到未发送草稿后后台同 PID 12584／同 epoch／原 cwd 继续，未抢焦点。再次明确停止先显示“停止请求已确认 · 等待停止结果”，SDK aborted 后才显示“本轮已停止”。

另一实际 hold 任务保存追加输入后停止，队列保持 held；当前显示“待发输入需要处理”，无消隐入口，不自动执行。实际 SDK 503 用例的错误仅一处主反馈，错误详情展开／收起可用，样本 api_key 脱敏。设置返回同会话，深浅主题约 802px 窄窗下阶段与错误详情、输入框及发送区可用。首次直接拖边未缩窗，随后用 Windows 原生“大小”菜单成功；不以无效拖动当作成功。明确重试后的普通发送反馈会跟随新草稿，作为既有提示范围问题记录，未把它当成运行阶段或新任务已成功的证据。

两次 File→退出应用均 NATIVE_CLOSED_OK／退出 0，受管进程已退出。首段共 5 次产品 prompt：启动失败一次、明确重试完成、两次 hold 明确中止、本地错误一次；实际 SDK 结果四条。使用同 data/profile 重启后 prompt 0、内核 0，held 队列、失败／停止／完成历史仍可见，四份原生 JSONL 哈希不变，未恢复旧阶段计时或执行。pi 配置／canonical 预算／锁文件前后哈希一致，真实提供商 0。归档宿主审计全部经过 shared Redactor；原始数据仅留忽略目录。详见 native/audit-summary.json、first-closed.json、restart-closed.json、各步骤审计与截图。

工具／压缩／重试非终态及传输乱序的覆盖来自明确标注的 SDK 服务／Electron 自动夹具，不能据此宣称已开放生产工具、压缩或真实重试。335 个产品／测试／脚本／配置文件仍与已通过 clean 字节一致，按用户要求复用最终 270／102／SDK／frozen clean，文档另生成并检查。OBS-02 两项 verified，本地完成数从 backlog 计算为 31 / 133，OPS-08 继续 in_progress。

下一步提示词（按用户最新要求：另起 10 项计数，本项不计入）：

> 完成 SEC-01：风险分类与最终参数裁决。优先 Electron，仅经验证的受限读取自动执行，写文件与命令先审批，未知／Shell／组合／嵌套按最高风险裁决；批准必须绑定最终不可变参数，改写后重查。显式有限授权与 L3 单次边界不能被只读注解绕过。默认离线，沿用验收与费用约束，不改 pi 配置、不额外调用真实模型、不制作安装包，网页版独立功能暂缓。完成测试和实际 Electron 验证，更新进度并独立提交。本批原生控制已授权；逐项推进新增 10 项，每完成 5 项推送一波。
