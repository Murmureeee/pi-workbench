# CHANGE-05／07／09／04 回滚与逐文件审查

四项按用户指定顺序交付，各两条验收均通过，canonical 为 verified；本地完成数从 backlog 计算为 46/133。基础依赖 CORE-03、WS-04、CHANGE-01／02／03、CORE-06、SEC-09 已核对为 verified；新功能仍复用其物理身份、互斥、不可变账本版本、来源判断和真实退出后的收尾。产品决定 D01–D15 与共同确认中的 M3 优先、脏改动保留、未知来源、分离运行／审查／适用性、重启不重放继续适用。没有修改用户 Git HEAD、index、提交或 pi 配置。

## 规则与实现

CHANGE-05 在独立 `0017_change_rollbacks` 保存操作身份、原 baseline/final、实际操作前后引用、逐路径哈希和执行／条件补偿结果。新增回滚删除，删除恢复，唯一字节一致改名恢复两条路径；整轮目标来自该轮完整历史清单，轮前 dirty/staged/untracked 属于基线。预检绑定物理目录、所选版本与当前字节，任一冲突普通确认整批零写。mixed/unknown 即使当前匹配 final 也须产品内单独确认覆盖；不能通过确认放行链接、越界、私有／忽略项或失效账本。

确认仅内存单次使用、无倒计时；操作前独立版本与持久意图／审计成功才开始写入。复用 WS-04 租约并在占用中重新检查；正常退出等待真正 IO 和结果保存。按顺序替换／删除，运行期失败逆序补偿，只补偿仍匹配本次写后字节的目标。外部改动冲突保留现场、操作前版本及 needs-recovery；保存失败保持目录隔离。重启 prepared/running 变 interrupted，不恢复确认、重放或自动补偿。

CHANGE-07 令历史 Diff 与当前回滚条件独立。后轮改不同代码块仍保留原 baseline/final 和 Diff，不做代码块合并推断。按物理目录跨会话追溯最近 20 后轮，逐路径展示 baseline／所需 final／当前 SHA256、后续会话／轮次与依赖引用；截断／缺证明确。最新轮成功回滚后使条件查询失效，重新读现场计算旧轮可用性。匹配只是时点观察，执行仍须重新预检和明确确认。

CHANGE-09 持久保存人工来源、目标、前后版本、最终结果与逐路径观察；失败／补偿后的实际现场和尝试版本分开，捕获失败明确 unavailable。列表每页 20 项、摘要最多 8 路径，详情含全目标；恢复会话不依赖旧窗口存储。每次物理目录准入后将最近 8 个执行事实经私有 IPC 注入既有 SDK system context，跨会话共享同物理目录、独立目录隔离，明确省略旧记录及重新读现场要求。不更改 SDK JSONL、不撤销消息历史、不额外调用模型。

CHANGE-04 在 `0018_change_decisions` 保存不可变人工接受事实；绑定原 session／turn／file ID／baseline／final。接受和审计同事务，重复返回原事实，失败不显示成功；接受不读取或修改当前工作文件。已处理是接受决定与相同原版本成功回滚文件 ID 的并集，全轮跨页计算，唯一改名计 1，空轮 0/0。失败、冲突、取消、补偿、中断不计成功。后轮／外部编辑不抹掉原决定，运行结果、审查进度、当前适用性独立展示。

桌面接口沿用配对／Host／Origin／JSON／CSRF／必需能力检查，shared 同步生产者、重放、客户端和夹具。Electron 复用官方组件，在原审查面板提供预检、独立覆盖确认、当前条件、持久记录及接受进度。异步回执绑定所属对象与版本，失败显式恢复，不自动重试副作用；关闭／切换视图保留真实后台任务。

## 验收映射

- [x] CHANGE-05 新增删除、删除恢复、改名恢复和轮前脏改动保留：`change-rollback.test.ts` 的真实 SDK write/edit 链、非 Git 实际文件批次及用户 HEAD/index/config 哈希；Electron 整文件／整轮流程；原生 05 实际外部新增／删除／改名／二进制后明确停止并恢复。[原生文件证明](change-05/restored-file-proof.json)。
- [x] CHANGE-05 整轮冲突整批不写，覆盖单独确认：服务覆盖 stale preflight、即使覆盖已确认后新变化仍零写、顺序失败条件补偿／补偿冲突、意图／审计／结果保存故障、实际多槽同目录阻塞和独立目录并行、退出等待 IO；Electron 和原生分别执行取消及独立确认。[取消前后哈希](change-05/cancel-proof.json)。
- [x] CHANGE-07 不同块后续修改保留历史：服务跨会话／物理别名／独立目录和不可用后轮证据，Electron 及原生旧 Diff 始终对应旧版本；当前文件改变不替换原行块。[原生历史与后轮引用](change-07/step-13.jpg)。
- [x] CHANGE-07 旧轮可用性／依赖明确并在最新回滚后重算：旧轮由 changed 变 matches-final、最新变 at-baseline；SDK／SQLite 服务、Electron 重启和原生实际文件均覆盖。[原生重算](change-07/step-32.jpg)。
- [x] CHANGE-09 持久目标／版本／结果／来源：服务覆盖分页、脱敏、中断、条件补偿及捕获失败；Electron／原生详情和同 data/profile 重启保留事实。[原生首次及恢复](change-09/first-closed.json)、[恢复退出](change-09/restart-closed.json)。
- [x] CHANGE-09 后续 SDK 获简明环境变化且消息保留：实际 SDK 本地 HTTP echo 的原生 assistant JSONL 含操作 ID 与“文件回滚未撤销消息历史”；一次明确发送只有一次本地请求。服务另查跨会话／daemon 重启后的新轮／独立目录隔离与旧 JSONL 未变；本条不另称做过同一旧会话冷续聊的新增验收。[独立断言](native-final-audit.json)。
- [x] CHANGE-04 接受只记录保留、后续变更不抹掉：真实 SQLite 接受／审计事务故障、幂等、不可变触发器、错误身份、后轮／外部编辑和重启；Electron 迟到回执隔离及原生后续文件改变均覆盖。[原决定不变](change-04/later-edit-decision.json)。
- [x] CHANGE-04 接受＋成功回滚显示 2/2：服务覆盖失败／冲突／补偿不计数、分页／改名；Electron／原生实际先接受一文件，再独立确认另一文件回滚，重启仍 2/2，重复接受禁用。[实际 2/2](change-04/step-19.jpg)、[重启 2/2](change-04/step-59.jpg)。

## 验证与失败记录

最终完整CI各阶段齐备：[第五轮](ci-all-fifth.log)的check、58文件／385项Vitest及SDK通过；窗口139/140，因一条测试在流式回复可见后立即要求持久轮次已完成而退出1，[退出结果](ci-all-fifth-result.json)如实保留。改为等待真实持久终态，定向2/2后，[完整窗口重跑](e2e-all-final.log)140/140退出0；不称第五次ci退出0。随后首次clean有一条旧PID探测断言失败，增强实际进程实例的退出顺序验证后，定向13/13通过；第二次clean在类型感知lint停止，有意捕获原prototype方法的两处unbound-method告警已用精准说明标注，实际转发继续使用实例.call(this,input)。重新fix和完整check通过后，第三次完整frozen clean五条命令均通过。第五轮之后只有这两份测试文件改变，产品／SDK／构建输入未变；最终140窗口之后仅WS-04服务测试改变，全部385测试由最终clean重新验证。本次完整frozen clean的frozen安装、check、build、385测试、SDK、服务启动与正常退出通过，锁哈希一致。[frozen日志](frozen-clean-final.log)、[结果](clean-workspace.json)、[命令](clean-commands.json)和[最终输入审计](source-audit-final.json)可核对。最终文档／canonical另运行生成、fix和check，不为纯文档更新重跑产品门禁。定向新增服务共 18 项（05:9、07:2、09:3、04:4）、Electron 共 10 项（3／2／2／3）已分别通过，原始通过与失败日志同时保存。完整门禁还包含其余既有业务回归。

早期失败保留并定位，没有跳过断言或改生产安全保护：

- CHANGE-05 初轮服务把内部 `promise` 放入 strict target，8 项拒绝；夹具收窄为契约目标。第二轮并行断言错用不存在的 streaming 状态，改按实际 running；最终 9/9。两轮 Electron 分别为 0/3、1/3：确认 Dialog 未找到、一个总时限超时，以及外部编辑未稳定注入预检之后。修为同一官方 Dialog 的第二确认页、精确目标，并等待预检可见后才改文件；最终 3/3。日志没有定位首轮总时限的更细根因，不额外推断。
- CHANGE-07／09 重启后旧 page locator 改为新窗口；09 最初一轮总时限超时，后续流程明确停止、落稳后再核对，原日志未证明更细原因。09 服务重启中断夹具先经过正常 close 所以为 cancelled，改用持久运行意图故障夹具核对 interrupted；04 HTTP 的非法 UUID 得 400，修正夹具为合法但不匹配身份后测试 409。
- 最终完整 CI 第一轮 372/385：7 项旧库夹具未删除新增表，6 项流式测试仍使用旧必需能力清单；更新夹具并保留协议不兼容测试。第二轮 384/385 加一个未处理拒绝：WS-07 超时可在 SDK 发送前发生，会话无可读原生历史而被正确保护。使故障在 SDK 输出后触发，定向通过；第三轮 384/385 暴露全套负载下 SDK 启动超出原 5 秒等待。仅该两次 SDK 生命周期测试改为 15 秒轮次启动等待／40 秒总预算，生产超时和历史保护均不变。第四轮非窗口385/385与SDK通过；窗口138/140，两条旧CHANGE-01／02／03测试仍要求没有回滚入口。替换为显式入口／来源限制和查看不写当前文件，原版本、Diff与重启断言保留；同时清理审批／授权页及拒绝诊断中过时的“无基线／入口”文案，保留单次不可回滚确认规则，不提前实现CHANGE-08分类。两文件定向8/8后，因为新产品文案变更重跑第五轮完整CI：非窗口385／SDK通过，窗口139/140。唯一失败处为回复已显示但快照收尾仍active的即时断言；改为轮询实际completed后，完整文件2/2及完整窗口140/140通过。第四、五轮仍记录退出1，生产收尾没有修改。
- CHANGE-07 最初原生宿主误把项目数组当 `.projects`，启动失败保留于 native07-first.log；修正后使用新的隔离 root，完成两次正常退出。早期非产品遮挡图不归档。证据核对器原假设退出 PID 列表为空，修为断言 alive 全 false；原生 05 背景轮收尾在退出时才完成，单独记录该转换，不谎称退出前已有 final。
- 本次首次 frozen clean 的安装／check／build 通过，测试 384/385。WS-04 硬杀用例在后继轮启动后探测旧数字 PID，未得到 ESRCH；首轮没有记录该数字当时对应的进程身份，不能断言这一次已证实 PID 复用，也不据此宣称旧 SDK 仍运行。原用例在该 clean 副本单独运行通过 1/1（其余12项未选中）。随后将硬杀及IPC两条用例改为绑定实际 ChildProcess，断言原进程 exit 及终态字段，并验证 exit 先于后继 prompt；整份13/13通过，重新完成整套frozen clean。最初一次定向命令因日志相对路径指向clean副本未实际执行，改绝对路径后才运行，不计作一次通过。[首次clean命令](clean-first-failed-commands.json)、[首次失败](frozen-clean-first-failed.log)、[原用例定向](directory-death-diagnosis.log)、[增强后13项](directory-death-instance-fixed.log)均保留。产品源码未因此修改；最终窗口之后仅此服务测试文件变化，未无因重跑140项窗口。

## 门禁结果

完整门禁的退出与阶段结果分别保留，不能把修正后的阶段重跑改写成此前完整命令成功：

| 门禁 | 原始证据 | 结果 |
| --- | --- | --- |
| 完整 CI 第一轮 | [ci-all-final.log](ci-all-final.log) | 372/385，13 项失败 |
| 完整 CI 第二轮 | [ci-all-second.log](ci-all-second.log) | 384/385，另有未处理拒绝 |
| 完整 CI 第三轮 | [ci-all-third.log](ci-all-third.log) | 384/385 |
| 完整 CI 第四轮 | [ci-all-fourth.log](ci-all-fourth.log) | 385／SDK 通过，窗口 138/140，退出 1 |
| 完整 CI 第五轮 | [ci-all-fifth.log](ci-all-fifth.log) | 385／SDK 通过，窗口 139/140，退出 1 |
| 最终完整窗口 | [e2e-all-final.log](e2e-all-final.log) | 140/140，退出 0 |
| 本次首次 frozen clean | [clean-first-failed-commands.json](clean-first-failed-commands.json) | 安装／check／build通过，384/385，退出 1 |
| 本次第二次 frozen clean | [clean-second-failed-commands.json](clean-second-failed-commands.json) | 安装通过；两处有意捕获prototype方法触发unbound-method，check退出1；精准说明后fix／完整check通过 |
| 本次第三次完整 frozen clean | [clean-workspace.json](clean-workspace.json) | 五条命令退出 0、正常启停、锁哈希一致 |
| 最终文档与静态检查 | [final-documents.log](final-documents.log) | 生成、格式化、完整 check 退出 0 |

## Windows 原生与来源限制

[逐条件说明](native-validation.json)、[独立最终断言](native-final-audit.json)和各 `change-*/observations.json` 分开保存。总计 228 条观察（含中间态／无效动作，09 部分步骤号重复），精选 26 张未改字节截图按实际 JPEG magic 使用 .jpg。两张前景 Codex 遮挡的初始图排除，原始本地记录仍保留在 ignored 工作区。没有归档数据库、profile、一次性代码目录或凭证内容。

四组均为真实 Electron／daemon／SQLite／bare Git／安装 SDK＋本地 HTTP，UIA／SendInput 操作，无 CDP／renderer 注入。原生种子由隔离宿主 API 建立，类型／不同块／保留决定场景中的外部改动是实际 CLI 文件写入，不能称为 SDK 工具生成或原生键盘输入。真实工具修改和命令／IPC 故障分别由实际服务／Electron 自动测试覆盖；合成协议观察和故障注入单独标明。四组按逐项开发时点记录，早期 05／07 图不含 09／04 后加字段；最终组合源码由完整 CI 和 clean 核对。

原生 05 的 PID19904／epoch 在切换前后保持 running，最终菜单退出时收尾；04 原后台先期限失败，明确重试后 PID7660／epoch／cwd／新 turn 跨视图保持 running，随后明确停止得到 aborted。07／09 的 seed 后台期限失败如实保留，不能称全程持续运行。明暗 802px 窄窗、内部滚动／关闭、设置返回均观察；未新增真实 IME 证据，部分 UIA 只给 RootWebArea，逐控件焦点由实际 Electron 自动回归证明。

四组同 data/profile 只读重启均 0 发送／0 内核／0 待审批／0 会话授权；共八次文件菜单正常退出，受管进程均已退出。11 份 SDK JSONL 哈希及 11 个当时已收尾轮次的原 baseline/final／来源／列表／Diff 不变；另 1 个背景轮在初次退出时保存 final，和旧已完成版本分别记。5 条回滚事实与 1 条接受事实跨重启不变。5 保护文件哈希不变：pi auth/models/settings、canonical 预算和锁文件。

整批回滚是预检零写加条件补偿，不承诺 OS 跨文件原子事务或同用户外部进程绝对排他。范围仅普通文件字节；ACL／权限／空目录、排除项、大文件、链接及命令外部副作用不属于恢复承诺。mixed/unknown 从未改称 agent 独占，也不自动回滚。代码块回滚 CHANGE-06、范围／容量／快照保留 CHANGE-08、安装包和网页独立业务均未交付。本次真实提供商请求 0，用户配置／canonical 预算／锁未改，OPS-08 继续跨阶段 in_progress [true,false]。

## 下一步提示词

已核对 CHANGE-08「回滚范围、大小限制与快照保留」属于 M3，仅依赖已 verified 的 CHANGE-01；适合继续收齐首个 M3 闭环。CHANGE-06 属于 M6，即使前置 CHANGE-05／07 满足也不在本次扩大实现。

> 请在 D:\Project\pi-workbench 完成 CHANGE-08「回滚范围、大小限制与快照保留」。遵循根 AGENTS，核对 canonical backlog、产品决定、CHANGE-01／02／03／04／05／07／09 及 WS-04 的实现与证据，保留已有工作。先细化规则，再让审批与变更详情明确显示可回滚、部分可回滚和不可回滚范围，覆盖忽略项、大文件、链接、外部路径和命令外部副作用；容量达到限制先提示，未审查必要版本不得静默回收，版本失效禁用回滚并解释。复用物理身份、互斥、独立账本、不可变引用、审查事实与收尾，不改用户 Git 历史；仅 CHANGE-08，不扩展代码块回滚或其他需求。使用实际文件、SQLite、独立账本、SDK 本地夹具及故障注入，完成服务、Electron、Windows 原生、格式化、完整 CI、frozen clean 和证据文档；已通过后仅因新改动或未解问题重跑。按实际证据更新进度，未通过保持未勾选，OPS-08 继续跨阶段判断。真实提供商请求 0，不改用户 pi 配置、canonical 预算或锁文件。本提示词授权源码、隔离文件夹具、故障注入、自动及 Windows 原生窗口控制和完成后的 Git 提交，无需逐项再询问；每项窗口操作放在开发及命令行验证之后，开发授权不替代产品单次确认。完成后审查差异、暂存、敏感信息和证据体积，提交并说明结果、限制、提交号及下一步提示词。
