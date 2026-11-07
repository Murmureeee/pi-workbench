# CHANGE-02 修改来源与混合变更、CHANGE-03 文件列表与 Diff 审查

两项功能的各两条验收已通过。CHANGE-02 依赖 CHANGE-01、OBS-03，CHANGE-03 依赖 CHANGE-01，均已 verified；本地完成数由 canonical backlog 计算为 42/133。OPS-08 保持 in_progress [true,false]，回滚及其余平台等跨阶段门未完成。CHANGE-01 的基线、持久版本与此前 80 条原生观察见[独立记录](../change-01-evidence/acceptance.md)，不重复计作本次新增证据。

## 运行规则与实现

复用 WS-04 物理目录身份、互斥及实际落稳／进程退出后的收尾生命周期。0016_change_tool_observations 在 SQLite 保存最终守卫的 session/epoch/turn/call/参数摘要及真实文件前后字节摘要；真实 SDK execute 完成后，通过私有握手等待宿主保存观察，再进入下一工具或收尾。每轮最多 128 项，重启将未完成观察标中断，不恢复许可或重放。

只有固定 write/edit 的可计算预期字节与实际连续观察一致，才标“工具观察一致”，关联工具及轮次。基线到首次调用、调用之间或末次调用到收尾的未解释差异保留为未知区段；与已确认区段共存时标混合。命令、排除项、缺失／中断／重叠／超限证据不作独占归属推断。预存 dirty/staged/untracked 属于基线；工具观察一致也不是 OS 排他证明。所有 automaticRollback=false。

文件列表和 Diff 只读取独立 Git 账本中经清单、对象和文件树校验的 baseline/final，不访问当前文件补造历史。GET 限配对 desktop，绑定 session/turn/不透明 file ID；每页最多 100 项。只对唯一且字节相同的一删一增标重命名，修改后改名保守为新增和删除。二进制／非 UTF-8 不造文本行数，超过 256 KiB 或 4000 行不截断伪装完整补丁；完整文本先统一脱敏，脱敏改变行结构时隐藏预览。

Electron 来源展开显示确认工具与未知区段，宽屏 aside／1200px 以下官方 Dialog 共用只读审查，关闭返回原会话，迟到请求绑定所属轮次和文件。Diff 使用惰性纯文本，不执行 HTML、Markdown、链接或命令。没有接受、恢复或回滚入口，不改用户 Git 提交历史。

## 验收映射

- [x] CHANGE-02：可确认修改关联工具和轮次，缺证显示未知／混合。实际 SDK write→edit、外部前／后编辑、被覆盖 post-image、实际命令、取消、硬杀／停止／退出、观察握手失败、SQLite 中断和 128 项上限均有服务回归。合成公开 tool.updated 无法建立正向来源。原生观察 24、61、143 分别展示一致、混合和重启后的来源。
- [x] CHANGE-02：不把混合内容整体宣称为 agent，外部变化在只读文件差异中可见，自动回滚始终禁用。原生实际 write 成功后，宿主外部改动并停止待审批 edit，最终保留已确认 write 区段和混合警告；外部新增／删除／改名／修改／二进制均标未知。这里验证审查可见性与来源边界，不宣称回滚已交付。
- [x] CHANGE-03：列表类型、行数、内容绑定选中轮次，当前编辑／删除及重启不替换历史。服务覆盖真实非 Git、dirty/index 不变、损坏对象、清单文件树不一致、跨会话身份、分页、重复改名歧义、大小及多行脱敏；4 项 Electron 流程覆盖真实来源、文件类型、迟到／失败恢复、后台和重启。原生 28→33→147 保持 baseline→second 的 +1/-1 Diff。
- [x] CHANGE-03：实际非 Git 项目使用独立账本，空轮次明确无文件变更。非 Git 来自服务和 Electron 自动测试；本次原生目录在主仓库内，不能计作非 Git 原生证据。原生观察 74 对实际空轮次展示 0 文件／本轮无文件变更。

## 自动门禁与保留的失败

[逐项结果](validation.json)。首次完整 [pnpm run ci](ci-first-failed.log) 的 check、54 文件／367 项 Vitest 和 SDK 冒烟通过；窗口阶段 127 过／3 失败，整条命令退出 1。修复后[定向 5/5](e2e-focused-final.log)、[完整 130/130](e2e-full-final.log) 通过，最终完整窗口命令退出 0。完整 CI 各阶段齐备，未声称第一轮 CI 退出 0，也未无因重复已经通过的非窗口阶段。

[frozen clean](frozen-clean-final.log)、[冻结工作区结果](clean-workspace.json)和[命令原文](clean-commands.json)证明新目录 frozen 安装／check／build／367 测试／SDK 冒烟／HTTP 启动和正常退出。SDK 冒烟为安装的 1.4.0 SDK＋本地 HTTP，两次本地请求，真实提供商 0。

最终窗口夹具修复同步到原 clean，补[源 check](check-window-final.log)和[clean check](clean-check-window-final.log)。[原生后源码审计](source-audit-final.json)核对 398 产品／测试／构建输入与补充后 clean 一致，5 保护文件不变。文档和 canonical 更新另运行 docs:build、docs:check、fix、check、git diff --check；复用未变 367／SDK／完整 frozen，不声称又完成了一次完整 frozen。

提交前额外核对暂存空白：源代码及手写验收／JSON 均通过。原始 Windows 日志保留 CRLF；按 CR-at-EOL 识别后仍有 116 项工具输出空格警告，全部位于 31 份原始日志或 Playwright 失败上下文。依 .gitattributes 和根指南保留这些证据原字节，没有格式化历史输出，也不把全量暂存空白检查记为通过。

失败按实际保留，不删业务断言、不跳过测试：

- [首次服务](service-first-failed.log) 12/13：Windows 活跃 SDK cwd 不能直接删除（EPERM）；验证历史前先正确关闭实际内核。[再次服务](service-second.log) 20/21：文件树损坏夹具的 fast-import 被已有 ref 拒绝，仅该造损坏夹具增加 --force；[最终服务／纯来源 21/21](service-final.log)通过。
- [首次 frozen](frozen-first-failed.log) 365/366：新增必需能力使订阅超过原 max16，原协议能力列表测试[先失败](subscription-before.log)。有界上限改为 64，新增完整能力通过／65 项拒绝回归，[相关 12/12](subscription-after.log)和最终 367/frozen 通过。
- [重启旧 locator](restart-locator-first-failed.md)修复为当前 f.page；[route.continue 失败](e2e-route-continue-failed.log)和[退出等待失败](e2e-teardown-wait-failed.log)保留。最终 helper 先卸载 poller，再等待 page/context 在途 route，只有已处理的关闭／ERR_ABORTED 才结束 fallback；正常失败仍抛出。曾尝试的 catch-return 死锁和 continue 破坏配对均已撤回，最终完整 130 通过。
- 原生证据整理器首次把扩展名 .png 当作 PNG 解析尺寸失败；截图实际保留 Sky 返回的 JPEG 字节。修正证据读取器后核对 802×961，不是产品／窗口回归失败，未修改截图内容。

## Windows 原生证据与限制

[原生逐条件核对](native-validation.json)、[149 条观察](native-authorized/observations.json)、[首次正常退出](native-authorized/first-closed.json)、[同 data/profile 重启退出](native-authorized/restart-closed.json)；宿主日志 [首次](native-first.log)／[重启](native-restart.log)均正常关闭，进程命令均退出 0。真实 Electron／daemon／SQLite／独立 Git／安装 SDK＋本地 HTTP，UIA/SendInput 操作，无 CDP／renderer 注入。宿主受控外部改动是实际文件写入，不是 SDK 写入或合成观察。

原生一致工具链两次明确单次不可回滚确认，write 和 edit 都真实完成。混合场景第一轮因审批中外部改动被最终守卫拒绝，后续 edit 取消；其 completed 只代表模型轮次结束，不算成功写入。第二轮真实 write 完成后外部混入，再明确停止，aborted 的收尾保存且来源 mixed。自动测试另覆盖合成观察、故障注入、命令和 IPC 的边界；不将这些记作原生操作。

独立后台会话 PID22784／epoch 保持：观察 80、89 在切换／审查期间仍 running。之后五分钟本地夹具期限到达，原 hold 轮次记 failed；观察 130 明确重试为新轮次，132 停止，133 aborted 并保存。不能把期限失败记成主动停止，或把后来 ready 状态记成持续运行。

原生 93、95、97 显示五文件、二进制与脱敏惰性 HTML；103、123 是实际明／暗 802×961 Dialog，列表可内部滚动，Escape 关闭，设置往返保留会话。98 的首次拖动只是选中文本，不计缩窗成功。UIA 多次只报告 RootWebArea，不声称逐控件原生焦点证明；焦点归还由实际 Electron 自动检查。没有新增真实 IME 证据。

两次经“文件→退出应用”正常退出；初次隐藏启动后被中断，不计正常退出。重启只读打开旧来源／Diff，0 prompt／0 内核／0 待审批／0 授权，4 份 SDK JSONL 哈希与 7 轮全部 baseline/final／来源／列表／Diff 相同，5 保护文件不变，受管 PID 已退出。149 条含中间态／无效动作，不以数量代替断言；观察 1 非产品截图已排除，保留注明原因的元数据。

真实提供商请求 0，用户 pi 配置／canonical 预算／锁未改。文件观察不是 OS 沙箱或绝对作者证明；排除项、ACL、空目录、外部副作用及大内容不作完整可回滚承诺。没有安装包，网页独立业务暂缓，接受／回滚尚未交付。

## 下一步提示词

已核对 CHANGE-05 依赖 CHANGE-02、CHANGE-03、SEC-09 均 verified。CHANGE-04 虽依赖已满足，但其第二条验收需要实际回滚，故先推荐 CHANGE-05；本次不继续实现第三个需求。

> 请在 D:\Project\pi-workbench 完成 CHANGE-05「整文件与整轮回滚」。遵循根 AGENTS，核对 canonical backlog、产品决定、CORE-03 及 CHANGE-01／02／03、SEC-09 实现与验收，保留已有工作。先细化规则，再复用物理目录身份、互斥、独立账本及不可变来源／版本，完成新增删除、删除恢复、重命名恢复与整文件／整轮回滚，保留轮次前已有脏改动，不改用户 Git 提交历史。整轮冲突须预检整批不写，覆盖外部修改必须单独明确确认，运行期失败按条件补偿并保留现场；未知／混合来源不可静默覆盖。仅 CHANGE-05，不提前完成 CHANGE-04／07／08／09 或代码块回滚。使用实际文件、SQLite、独立账本、SDK 本地夹具及故障注入，完成服务／Electron 回归、Windows 原生、格式化、完整 CI 和 frozen clean，按证据更新进度，OPS-08 继续跨阶段门。真实提供商请求 0，不改 pi 配置、canonical 预算或锁文件；窗口操作在开发和命令行验证最后，待本任务明确授权。已通过门禁仅因新改动或未解问题重跑，未通过验收保持未勾选。
