# AGENTS.md 验收摘要迁移归档

迁移日期：2026-11-10。来源：当时根 AGENTS.md 第 1 节、文末验收条目和第 10 节的历史任务记录。以下保留原有文字，仅调整相对链接、标题层级和所在位置；对应原始证据目录保持原样。

这些记录反映各自交付时点，包含已经被后续功能覆盖的限制、完成数、测试数量和下一步建议。当前状态、依赖与证据以 [backlog](../product/backlog.json) 的 `features[].progress` 和对应验收说明为准；历史授权只适用原任务，不构成新会话执行提交、推送、关机或其他操作的授权，也不决定当前验证范围。

[验收与上下文恢复导航](README.md) · [当前功能清单](../product/feature-list.md) · [协作指南](../../AGENTS.md)

## 原第 1 节中的交付摘要

- 当前工程具有离线基础壳、CORE-04 受管 SDK 子进程、CORE-05 REST / WS 只读观察 / 重放、CORE-06 原生历史索引 / 检查点恢复、CORE-07 有界资源 / 受管冷恢复、SEC-06 原生凭证边界 / 统一输出脱敏、SEC-07 资源信任及 SEC-08 客户端配对；SDK 使用本地 HTTP 夹具，固定工具经最终守卫和明确单次审批；扩展与真实提供商仍关闭。`?observe=<sessionId>` 可观察受管运行时或重启后的最新轮次，`?history=<sessionId>` 可只读分页查看历史、恢复记录与诊断，`?resources` 可只读核对资源限额和排队，`?credentials` 仅展示凭证状态，`?clients` 管理本机客户端，侧栏设置区或 `?trust` 检查和管理资源信任；这些实际数据入口须先配对。WS-01 的 Electron 侧栏“打开工作区”或 Ctrl+O 进入 `?workspaces`，原生选择器 / 绝对路径经 daemon 校验，按物理目录复用身份，支持本窗口切换和诊断；不创建会话或自动信任资源。Electron 默认由 SESSION-01 接入真实 daemon / SDK 的本地夹具发送；浏览器首页及桌面 `?samples` 仍为带来源标记的假内核样本。真实产品能力以 backlog 各条验收为准。开发场景中的审批按钮、Diff、工具过程不自动代表真实执行。不要为了演示效果接入绕过 daemon 的模型请求。
- OPS-08 的 M1 契约基线、CORE-05 双客户端重放及 CORE-06 真实 SDK 本地硬杀 / 持久恢复已接入离线 CI；整体仍为进行中，CORE-07 配额 / 排队 / 取消 / 冷恢复及 SEC-06 凭证 / 分片脱敏、SEC-07 来源 / 指纹 / 撤销、SEC-08 配对 / 撤销、WS-01 目录身份 / Windows ACL / Electron 切换也已接入。SESSION-01 原子首发 / 幂等 / 失败恢复、真实 Windows 微软拼音及原生 Electron 草稿 / 设置返回 / 目录 / 主题已补证；SESSION-02 的 3 视图 / 草稿 / 阅读与面板恢复、后台同 PID / 重连及旧 pi 历史只读发现已接入；其余 M2 业务审批 / 双端交互与 M3 以后验收须随实现补齐。来源、阶段矩阵及证据见 [工具规范](../development/tooling.md)，不能用本地样本通过提前验收对应功能。
- MODEL-01 已接入 Electron 侧栏设置区 / 原生菜单的 `?models`：只读展示安装 SDK 静态目录、显式 PIW_PI_AGENT_DIR 的 auth / models / settings 元数据、模型能力 / 来源 / 默认匹配及本地认证状态，统一脱敏。已配置与未联网验证分开，工作台真实传输仍关闭；不改配置、不执行认证 / 请求头命令、不刷新 OAuth、不恢复动态目录缓存、不加载扩展，也不因其他产品账号推断权益。`GET /api/models` 仅向已配对 desktop 身份开放，网页版独立功能暂缓。模型发现的实际 SDK / HTTP / SQLite 及 Electron / 原生菜单验证已纳入 OPS-08，同一门禁继续保持进行中。
- SESSION-03 已验收：daemon SQLite 独占置顶 / 未读 / 归档，revision 与结果 / 阅读游标隔离迟到回执；新终态标未读，活动可见且有焦点的对话实际显示对应结果并读到最新才清除。原生已验证重启保持、恢复不启动内核、中段保留未读、取消归档同 PID 继续运行、明确停止后再次确认归档及正常退出。实际后台状态来自内核 / 队列 / 提交，归档在事务内阻止发送竞态；不把视图隐藏当成任务结束。完整 179 项 Vitest / 49 项 E2E、SDK 冒烟与 frozen clean 通过，最后提示文案补跑完整 CI；OPS-08 整体继续进行，来源与限制见 [验收记录](session-03-evidence/acceptance.md)。
- SESSION-11 已验收：Electron 重命名、Unicode 码点校验、失败保留、CAS 冲突、独立标题订阅与人工来源保护均通过。完整 185 项 Vitest / 53 项 E2E、SDK 冒烟与 frozen clean 通过；真实 Windows 微软拼音 Enter / Escape / 选词、原生预填 / 取消 / 写失败恢复 / 标题同步、同 data / profile 重启持久及两次正常退出已补齐。原生是 SendInput 操作真实 OS 输入法，与合成 composition 分开记录；230 个产品 / 测试 / 根配置文件与 clean 一致，按用户要求复用已通过门禁。本地完成数从 backlog 计算，OPS-08 继续进行；见 [验收记录](session-11-evidence/acceptance.md)。
- WS-02 已验收 Electron 持久最近列表 / 自定义名、明示排序、失效诊断、仅隐藏移除和同物理目录重新定位；既有会话 cwd 与后台任务不随整理改变。实际目录 / SQLite / HTTP / SDK 本地夹具、完整 192 项 Vitest / 57 项 E2E、frozen clean 和 25 步原生 Windows / IME / 选择器 / 重启证据见 docs/validation/ws-02-evidence。
- WS-06 已验收 Electron 项目创建 / 改名 / 置顶 / 组内排序持久、展开 / 检索 / 同名区分、新会话归属、单默认目录与独立空间。0008 迁移、CAS、创建原输入幂等 / 墓碑及解散分组的同事务归无项目由 daemon 独占；整理保留文件 / cwd / 模型 / 历史 / 权限和已运行任务。完整 201 项 Vitest / 63 项 E2E、SDK 冒烟、frozen clean、40 步实际 Windows IME / 选择器 / 同 PID 后台 / 原生重启与两次正常退出见 [验收记录](ws-06-evidence/acceptance.md)。249 个产品 / 测试 / 配置文件与 clean 一致，原生后复用门禁；OPS-08 继续进行中；SESSION-12 后续验收见下条。真实提供商请求 0、配置 / 预算未改，无安装包，网页独立功能暂缓。
- SESSION-12 已验收 Electron 中文标题 / 用户 / 助手正文、项目 / 状态 / 日期 / 归档筛选、200ms 防抖 / 迟到隔离、脱敏分页及原消息定位；0009 为可重建派生索引。完整 209 项 Vitest / 67 项浏览器及 Electron E2E、SDK 冒烟、frozen clean 与真实微软拼音 Enter / Escape / 数字及 Space 选词、原生失败恢复 / 后台同 PID / 明暗窄窗 / 重启搜索和两次正常菜单退出均通过。270 个产品 / 测试 / 脚本 / 配置文件与 clean 一致，原生后复用门禁，三项勾选，本地 20 / 133；OPS-08 继续进行。主动迁移 / 删除入口仍待后续功能，仅用明确 SQLite 夹具验证索引消费。真实提供商请求 0，配置 / 预算未改，无安装包，网页独立功能暂缓；见 [验收记录](session-12-evidence/acceptance.md)。
- WS-03 已验收：Electron cwd／仓库根／分支／detached、非 Git／子模块／多仓库、目标隔离与错误恢复进入 8 项服务／5 项 Electron 自动回归；完整 217 项 Vitest／72 项 E2E、SDK 冒烟及 frozen clean 通过。用户明确授权后补齐 28 步 Windows 原生操作：外部 HEAD 更新、非 Git 续发、切换同 PID／epoch 与原 cwd、明确停止、明暗 800px 窄窗、同 data/profile 重启及两次正常退出；重启零内核／零新请求、历史哈希不变。277 文件与 clean 一致，原生后复用门禁，两项勾选并 verified。第一段 hold terminated 与重试后明确停止分开记录；OPS-08 继续 in_progress，真实提供商请求 0、pi 配置／预算／锁文件未改，无安装包，网页独立功能暂缓；[验收记录](ws-03-evidence/acceptance.md)。
- INPUT-01 已验收两项：沿用既有产品实现，新增2项实际Electron自动回归，完成27条Windows原生观察；真实中文候选Enter/Escape/Space/数字、换行、独立草稿/项目/模型及所属续发通过。原生Ctrl+R/F5没有建立实际刷新证据，刷新仅据Electron page.reload测试；未独立重查IME厂商。两项新增测试已纳入SESSION-07本次完整223／78、SDK与frozen clean；见 docs/validation/input-01-evidence/acceptance.md。
- SESSION-07 已验收：0010不可变session_origins与membershipVersion CAS，Electron“执行空间与项目归属”显示保存cwd／创建来源／能力来源，整理不搬文件、不改cwd或授权，失败／冲突／迟到保持隔离。6项实际服务与4项Electron回归，最终27文件／223项Vitest、78项E2E、SDK和frozen clean通过，包含INPUT-01新增测试。29条实际Windows原生观察、同PID／epoch后台、明暗800px、同data/profile重启0内核／0重发及两次正常菜单退出补证；282文件与clean一致，原生后复用门禁。外部验收夹具产物非SDK生成，工具继续禁用。当前本地23 / 133；SESSION-13只交付整理子集、三项仍false，OPS-08继续in_progress。真实提供商0、pi配置／canonical预算／锁未改，无安装包，网页独立功能暂缓；[验收记录](session-07-evidence/acceptance.md)。
- OBS-03 已验收：完整 35 文件／251 项 Vitest、93 项浏览器及 Electron E2E、SDK 冒烟与 frozen clean 通过；Windows 原生工具身份／摘要／长输出脱敏与收起、跨会话及逐轮展开隔离、后台同 PID／epoch 和焦点、明暗 802px 窄窗、同 data/profile 只读重启 0 内核／0 新发送／0 注入、历史哈希不变及正常菜单退出已补证。316 文件与 CI／clean 一致，原生后复用门禁；仅文档模板另更新。两项勾选，当前本地 27 / 133，OPS-08 继续 in_progress。合成工具观察与真实 SDK 禁用工具错误分开，未开启生产工具／审批／MCP／回滚；真实提供商 0，配置／预算／锁未改。见 [验收记录](obs-03-evidence/acceptance.md)。
- OBS-06 已验收公开思考权限过滤、默认折叠、脱敏复制下载、本窗口隐藏与明确缺失状态。静态检查、257 项 Vitest／SDK通过；一次 CI 的既有 E2E 超时保留，随后完整95项E2E通过；最终边界加强经47项相关测试、2项Electron和完整frozen clean验证。56条Windows原生观察、明暗802px窄窗、同data/profile重启0发送／0内核、历史哈希不变及两次正常退出补证。319文件与clean一致，原生后复用门禁。本地28／133，OPS-08继续in_progress；真实提供商0，pi配置／预算／锁未改，无安装包，网页独立功能暂缓。见 [验收记录](obs-06-evidence/acceptance.md)。
- SEC-02 已验收：daemon 独占无倒计时的最终参数单次审批，首个有效多端决定生效，保存先于许可；取消、停止、IPC／内核／策略及退出失效，重启不恢复旧授权。完整45文件／292项Vitest、107项E2E、SDK与frozen clean通过；56条Windows原生观察（含中间态，另排除1张非产品截图）、两次正常退出、同data/profile重启0发送／0内核／0待审批，3份JSONL哈希不变。347文件与clean一致，原生后复用门禁；此前两次完整失败与安装命令记录分别保留。原生命令仅核对／取消，实际执行由自动Electron覆盖；没有新增真实IME证据。当前本地33／133，OPS-08继续in_progress；真实提供商0，pi配置／canonical预算／锁未改，无安装包，网页独立功能暂缓。见 [验收记录](sec-02-evidence/acceptance.md)。
- SEC-03 已验收：daemon 独占显式完整参数／物理目录会话授权，L3与嵌套始终单次；单条／全部撤销先同步失效，最终异步检查后重查，重启不恢复授权。无CHANGE基线时每次仍须单独确认本次不可回滚执行，撤销不停止已运行动作。完整46文件／300项Vitest、111项E2E、SDK与frozen clean通过；102条Windows原生观察含802px审批遮挡缺陷及修复、三次正常菜单退出、同data/profile重启0授权／0待审批／0内核／0发送，JSONL哈希不变。353文件与clean一致；三轮CI失败与定向受干扰失败、HTTP500夹具及原生IME／焦点限制见证据。当前本地34／133，OPS-08继续in_progress；真实提供商0，pi配置／canonical预算／锁未改，无安装包，网页独立功能暂缓。见 [验收记录](sec-03-evidence/acceptance.md)。

## 原文末的验收条目

### WS-07 已验收

WS-07 已接入 desktop-only availability／recover 身份接口、Electron 资源受限与恢复提示、同物理目录重定位。SessionService 保留准入前后探针，KernelService 每秒对排队／后台任务串行只读复核原 cwd，失效停止；未发送为 failed，已 dispatch 为 interrupted，进程退出后释放，历史／草稿保留，恢复不重放。异步检查绑定 Task 对象，迟到检查不能停止下一轮。监测是采样而非OS挂载通知，物理拔盘未验证。信任指纹增加项目及来源目录物理身份；旧路径指纹记录保留但需重新确认。重新定位仅改登记，原会话cwd不改；SESSION-13迁移未开放。原生验收已补齐，证据与后续门禁见 docs/validation/ws-07-evidence/acceptance.md；产品未改时复用本次通过的CI／clean。

WS-07 已验收：完整230项Vitest／82项浏览器及Electron E2E、SDK与frozen clean通过；68条原生观察补齐未信任资源、真实路径丢失与Windows ACL后台停止、原cwd／历史／草稿保留、同物理目录重新定位与明确恢复、明暗800px窄窗、同data/profile重启0内核／0新请求及两次正常菜单退出。288个代码文件与clean一致，原生后复用门禁；本地24／133，OPS-08继续in_progress。真实提供商0、pi配置／canonical预算／锁未改，无安装包，网页独立功能暂缓。


### OBS-01 已验收

Electron流式与安全内容展示已验收：每帧累计全部delta，非delta状态即时冲刷，权威终态替换去重；CommonMark/GFM安全Markdown、仅显式HTTP(S)链接、禁止自动图片和原始HTML执行、本地协议惰性。16k预览可展开，64k以上纯文本、12k以上代码不高亮，未知语言／未闭合围栏／可选模块失败回退；按需Shiki与异步身份保护。8项新增Vitest、4项新增Electron流程；完整238项Vitest／86项E2E、SDK和frozen clean通过。Windows原生富文本／纯文本切换、长内容展开／收起、明暗主题、同data/profile重启0请求及两次正常退出补证。图示仅惰性代码，未接入执行型图示。真实提供商0、pi配置／canonical预算未改，无安装包，网页独立功能暂缓；OPS-08继续in_progress。[逐项证据与下一步提示词](obs-01-evidence/acceptance.md)。

### OBS-04 已验收

OBS-04 已验收：Electron 回看不强拉、按消息计数、显式／键盘返回最新、消息锚点与偏移跨分页／3 视图淘汰／renderer 刷新恢复；长文展开保持现场、收起不留空白，后台完成或合成审批观察不抢当前焦点与面板。新增 2 项 Vitest／4 项实际 Electron 回归，完整 31 文件／240 项 Vitest、90 项 E2E、SDK 和 frozen clean 通过；60 条 Windows 原生观察、明暗窄窗、后台同 PID／epoch、同 data/profile 重启 0 内核／0 新请求及两次正常菜单退出补证。304 文件与 clean 一致，原生后复用门禁；当前本地 26 / 133，OPS-08 继续 in_progress。分页行／审批观察均明确为合成样本，完整应用重启不承诺窗口书签；真实提供商 0，配置／canonical 预算／锁未改，无安装包，网页独立功能暂缓。[逐项证据与下一步提示词](obs-04-evidence/acceptance.md)。


### MODEL-07 已验收

MODEL-07 已验收：实际 SDK 请求计数、零自动重试策略、脱敏原错误、权威等待期限／未知等待／到期不执行、终态清除等待、同操作错误合并及工具／审批阻止整任务重放。完整261项Vitest／97项E2E、SDK与frozen clean，55条Windows原生观察、同data/profile重启0请求／0内核及两次正常退出；真实提供商0。 当前本地29／133，OPS-08继续in_progress。pi配置／预算／锁未改，无安装包，网页独立功能暂缓。[逐项证据与下一步提示词](model-07-evidence/acceptance.md)。


### INPUT-06 已验收

INPUT-06 已验收：daemon持久有界引导／追加队列、实际SDK边界FIFO、settled后追加新轮、编辑CAS与失败保留、停止／重启held及单条明确恢复。完整40文件／264项Vitest、99项E2E、SDK与frozen clean通过；78条Windows原生观察、后台同PID／epoch／cwd、明暗802px窄窗及两次正常退出，同data/profile重启0发送／0内核且历史不变。329文件与clean一致，原生后复用门禁；短边界原生顺序未建立，SDK顺序和合成IME守卫以自动测试为证。当前本地30／133，OPS-08继续in_progress；真实提供商0，pi配置／预算／锁未改，无安装包，网页独立功能暂缓。[逐项证据与下一步提示词](input-06-evidence/acceptance.md)。


### OBS-02 已验收

OBS-02 已验收：单一主阶段、按操作合并错误、终态消隐及停止请求／确认／未知分开。完整42文件／270项Vitest、102项E2E、SDK与frozen clean通过；88条Windows原生观察补齐正常终态消隐、停止失败同PID后台、SDK aborted确认、held不能消隐、脱敏错误详情、设置返回与明暗802px窄窗。两次正常退出；同data/profile重启0发送／0内核，四份JSONL哈希不变。335文件与clean一致，原生后复用门禁；首发握手超时与明确重试分开记录。当前本地31／133，OPS-08继续in_progress；真实提供商0，pi配置／预算／锁未改，无安装包，网页独立功能暂缓。[逐项证据与下一步提示词](obs-02-evidence/acceptance.md)。

### SEC-01 已验收

SEC-01 已验收：固定工具在 SDK 最终 execute 处冻结参数并经宿主私有 IPC 裁决，多个规则取最高风险；仅实际 cwd 内核验后的有界 UTF-8 快照读取自动，写入与命令无有效审批拒绝，参数改写／嵌套不继承许可。完整44文件／281项Vitest、104项E2E、SDK与frozen clean通过；80条Windows原生观察（含中间态与重试）、后台同PID／epoch、明暗802px窄窗、同data/profile重启0发送／0内核、三份JSONL哈希不变及两次正常菜单退出补证。扩展、MCP、真实提供商关闭；审批交互、会话授权、写入基线仍属后续。当前本地32／133，OPS-08继续in_progress。真实提供商0，pi配置／canonical预算／锁未改，无安装包，网页独立功能暂缓。[逐项证据与下一步提示词](sec-01-evidence/acceptance.md)。


### SEC-09 已验收

SEC-09 已验收：daemon追加审计、审批与新授权同事务，撤销先失效且失败不复活。Electron设置及原生菜单只读筛选、固定快照分页和本页脱敏导出，原件保留无删除入口。完整47文件／307项Vitest、114项E2E、SDK与frozen clean通过；58条Windows原生观察中4条系统文件列表为隐私省略，明暗802px窄窗、两次正常退出和同data/profile重启0发送／0内核／0授权通过，JSONL与pi配置／预算／锁哈希不变。361文件与clean一致；原生保存框取消，实际导出文件由自动Electron验证。真实提供商0，无安装包，网页独立功能暂缓，OPS-08继续in_progress。 当前本地35／133。见[逐项证据与下一步提示词](sec-09-evidence/acceptance.md)。


### SEC-10 已验收

SEC-10 已验收：受管文件工具按真实物理 cwd 逐级核验，统一拒绝设备／数据流／歧义路径、链接及目录外目标，不开放附加根。文件命令、bash、引用／展开／重定向／控制运算符和未知命令均单次；少量无文件目标的 PowerShell 字面量才可精确参数会话授权，界面明确没有 OS 文件／网络沙箱。完整47文件／311项Vitest、115项E2E、SDK与frozen clean通过；59条Windows原生观察、明暗窄窗、两次正常退出和同data/profile重启零发送／零内核／零待审批／零授权，JSONL与配置／预算／锁哈希不变。361文件与clean一致；真实提供商0，无安装包，网页独立暂缓，OPS-08继续in_progress。 当前本地36／133。见[逐项证据与下一步提示词](sec-10-evidence/acceptance.md)。


### MODEL-03 已验收

MODEL-03 已验收：0013会话模型CAS与安装SDK逐请求prepareRequest边界；空闲保存不请求，运行中对下一次模型请求（含工具续请求）生效并展示待生效，SDK确认后更新实际配置。固定离线模型按能力禁用思考选项，保存失败保留、版本冲突须明确核对，附件和真实提供商传输仍关闭。完整48文件／315项Vitest、117项E2E、SDK与frozen clean通过；85条Windows原生观察、明暗窄窗、两次正常退出及同data/profile重启0发送／0内核，JSONL与pi配置／预算／锁哈希不变。365文件与clean一致，原生后复用门禁；真实提供商0，无安装包，网页独立暂缓，OPS-08继续in_progress。 当前本地37／133。见[逐项证据与下一步提示词](model-03-evidence/acceptance.md)。


### MODEL-05 已验收

MODEL-05 已验收：只读SDK原生历史，按会话／轮次／模型消息追溯输入、输出、缓存与总量，部分和保留未知次数；SDK默认零值不冒充实际报告。最近请求只作上下文参考，窗口来自同源离线模型元数据，未知模型／价格来源／价格时间及费用明确未知，不造账单。完整50文件／317项Vitest、118项E2E、SDK及frozen clean通过；54条Windows原生观察、明暗802px窄窗、故障恢复、两次正常退出及同data/profile重启0发送／0内核，JSONL与pi配置／预算／锁哈希不变。371文件与clean一致，原生后复用门禁；真实提供商0，无安装包，网页独立暂缓，OPS-08继续in_progress。 当前本地38／133。见[逐项证据](model-05-evidence/acceptance.md)。

### WS-04 已验收

WS-04 已验收物理目录／父子重叠根互斥、所属排队取消及来源不确定观察；SDK 落稳或实际进程退出且最终观察保存后释放，切视图不停止、重启不恢复旧授权或重放。13 项真实服务测试以 4 内核／3 模型槽产生竞争，含实际 SDK 写同文件后外部混入保留、IPC／硬杀及保存失败隔离。复用最终静态检查、51 文件／332 项 Vitest、SDK 与 frozen clean；授权后完整窗口阶段最终 122 项 E2E 通过。首轮 121／122 的 route.fetch 夹具退出错误由等待在途回调修复，原用例连续 3 次及 clean 补充 check 通过，未冒充第二次完整 frozen；363 文件与补充后 clean 一致。82 条 Windows 原生观察含中间态，补齐排队／独立并行／同 PID 后台／实际外部编辑／明暗 802×761／同 data/profile 重启 0 发送／0 内核／0 待审批／0 授权及两次正常菜单退出，4 份 JSONL 哈希不变。未新增 IME 证据，排队取消的无 SDK 运行时面板仍保留等待连接文案；WS-04 本身不交付快照／Diff／回滚。该次两项勾选，本地 39／133，OPS-08 继续 in_progress；后续 CHANGE-01／02／03 已验收，见下文，回滚仍未交付。真实提供商 0，pi 配置／canonical 预算／锁未改；见[记录及下一步提示词](ws-04-evidence/acceptance.md)。


### CHANGE-01 已验收

CHANGE-01已验收：独立bare Git原始字节账本、0015轮次基线/收尾和成功/失败/中止持久，基线失败暂停及单次明确不可回滚确认、ready引用失效拒绝、保存失败隔离。完整52文件/344项Vitest、SDK、frozen clean及最终126项E2E通过，首次窗口失败和修复保留。80条Windows原生观察含中间态，两次正常菜单退出、明暗802px、同data/profile重启0发送/0内核/0审批/0授权，2份JSONL与版本引用不变；385输入与clean一致后复用门禁。来源不确定，不含Diff/回滚；OPS-08继续跨阶段，真实提供商0，配置/预算/锁未改。

### CHANGE-02／03 已验收

CHANGE-02／03 已验收：0016 持久最终守卫的实际工具前后字节与调用身份，连续可证实链只称工具观察一致，混合／缺证／命令保守未知，automaticRollback 始终 false。文件列表与 Diff 只读独立账本 baseline/final，不被当前文件替换，不提供接受／恢复／回滚。最终 54 文件／367 项 Vitest、SDK、frozen clean 和 130 项 E2E 通过；首轮 CI 窗口 127/130 的三项失败和中间修复保留，修复后完整窗口及源／clean check 通过。149 条 Windows 原生观察含中间态，明暗 802×961、实际工具／外部混合、同 PID／epoch 后台、两次正常菜单退出与同 data/profile 重启 0 发送／内核／待审批／授权通过；4 份 JSONL 与 7 轮版本／来源／列表／Diff 不变，398 输入与 clean 一致，5 保护文件不变。后台期限 failed 与明确重试后 aborted 分开；本次不新增真实 IME 或非 Git 原生证据。当前本地 42/133，OPS-08 继续 in_progress，真实提供商 0，pi 配置／canonical 预算／锁未改，无安装包，网页独立业务暂缓。见[逐项验收与下一步提示词](change-02-03-evidence/acceptance.md)。

### CHANGE-05／07／09／04 已验收

CHANGE-05／07／09／04 已验收：整文件／整轮预检与单独覆盖确认、条件补偿、不可变历史与当前条件重算、持久回滚事实及 SDK 环境说明、接受和成功回滚的 2/2 处理进度。最终 58 文件／385 项 Vitest、SDK、140 项 E2E 与 frozen clean 通过；228 条 Windows 原生观察含中间态，四组同 data/profile 只读重启与八次正常菜单退出补证。真实提供商 0，配置／canonical 预算／锁未改，OPS-08 继续 in_progress；范围／容量／保留 CHANGE-08 和代码块 CHANGE-06 未交付。本地 46/133，历史完成数不作当前依据。来源、失败、逐项规则及经依赖核对的下一步提示词见[验收记录](change-04-05-07-09-evidence/acceptance.md)。

### CHANGE-08 已验收

CHANGE-08 已验收：审批与历史详情共用可回滚／部分／不可回滚范围，沿用 5 MiB／32 MiB／2048 项／8 层限制；每物理目录 512 MiB Git 对象估算、80% 预警，容量未知／不足暂停且保留所有已发布版本。失效诊断禁用回滚，执行在物理租约内重验原引用，预检后失效整批零写。最终 59 文件／398 项 Vitest、SDK、144 项 E2E 与完整 frozen clean 通过；78 条 Windows 原生观察含中间态，明暗 802×961、容量及引用故障、两次正常菜单退出和同 data/profile 重启零重放通过，5 份 JSONL 哈希不变。429 输入与 clean 一致，最终 CI 仅另有既有 SEC-08 测试等待修正，完整 clean 已覆盖，复用未变产品／窗口阶段。真实提供商 0，pi 配置／canonical 预算／锁未改；OPS-08 仍 in_progress [true,false]。代码块回滚和清理／删除版本未交付。 本地47/133、M3的9项均verified，历史完成数不作当前依据。原生后台期限终止与切视图同PID证据分开，无新增IME，原生命令仅核对／取消。所有历史段落按交付时点保留，最新范围、失败记录及经依赖核对的GIT-01下一步提示词见[验收记录](change-08-evidence/acceptance.md)。

### GIT-01 已验收

GIT-01 已验收：当前 cwd 子树真实 staged／unstaged／untracked／分支只读观察，来源独立标识，混合／未知不冒充 agent 独占。完整 60 文件／407 项 Vitest、SDK、147 项 E2E，完整 frozen clean 及布局／测试判据后续补充检查通过；71 条 Windows 原生观察、802px 明暗、两次正常退出、同 data/profile 重启零发送／内核／审批／授权，3 份 JSONL 与 Git 元数据及 5 保护文件不变。435 输入与 clean 一致，原生后复用门禁；无新增 IME，子模块内部未扫描且明确不完整。真实提供商 0，配置／预算／锁未改，OPS-08 继续 in_progress [true,false]。本地 48/133；范围、失败与来源见[验收记录](git-01-evidence/acceptance.md)。

### FILE-01 已验收

FILE-01 已验收：当前授权 cwd 的异步目录分页、字面文件名／路径搜索、实时位置与忽略／权限／链接诊断，仓库根仅信息、附加根未开放。9 项实际服务与 4 项 Electron 回归；完整 61 文件／416 项 Vitest、SDK、151 项 E2E 通过。其后仅修正搜索结果上限及既有 CORE-07 PID 身份的测试判据，新的完整 frozen clean 覆盖最新 416 项测试；复用未变产品／窗口阶段。111 条 Windows 原生观察、明暗窄窗、同 PID 后台、同 data/profile 重启零发送／内核／审批／授权及两次正常菜单退出补证；3 份 settled JSONL、Git 元数据与 5 保护文件不变。最新 442 输入与 clean 一致，原生后复用门禁。真实提供商 0，pi 配置／canonical 预算／锁未改；OPS-08 继续 in_progress [true,false]。当前本地 49/133。来源与失败见[验收记录](file-01-evidence/acceptance.md)。

### FILE-02 已验收

FILE-02 已验收：稳定有界 UTF-8 只读代码快照、真实行号分页及工具／历史 Diff／明确消息路径定位；选区重验后只加入仍未变化的所属草稿，不自动发送。外部变化、删除、二进制、编码及脱敏行数异常准确降级，历史 Diff 保持独立账本版本。8 项实际服务、2 项共享契约／路径测试和 5 项 Electron 回归；完整 63 文件／426 项 Vitest、SDK、156 项 E2E 与新目录完整 frozen clean 通过。191 条 Windows 原生观察、明暗窄窗、后台同 PID／epoch、同 data/profile 重启零发送／内核／审批／授权及两次正常菜单退出补证；3 份 settled JSONL、Git 元数据和 5 保护文件不变。448 输入与 CI／clean 一致，原生后复用未变源码门禁。合成助手路径观察及 CLI 磁盘故障单独标注。真实提供商 0，pi 配置／canonical 预算／锁未改；OPS-08 继续 in_progress [true,false]。当前本地 50/133。具体限制、失败与来源见[验收记录](file-02-evidence/acceptance.md)。

## 原第 10 节中的历史任务记录

- 电脑控制统一留到开发和命令行验证最后，等用户明确要求控制后再操作；会启动或操作实际窗口的回归与 Windows 原生验收也遵循此顺序。2026-11-09 最新任务依次授权 GIT-01、FILE-01、FILE-02 的源码、隔离文件／Git／SQLite／SDK 本地夹具、故障注入、Electron 自动回归、Windows 原生控制及逐项独立 Git 提交；每项窗口操作在其开发和命令行验证之后，无需再次请求。三项均验收且提交后保存交付记录、正常退出本任务服务，最后正常 Windows 关机，不强制关闭其他应用；任何未解验收或提交阻塞均保留现场、不关机。不推送或扩大其他需求。开发授权不替代产品单次审批及外部覆盖确认，未通过不冒充完整 CI 或原生通过。
