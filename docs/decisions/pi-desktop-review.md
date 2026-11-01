# PI-Desktop 参考评估与采纳决定

查阅日期：2026-11-01（Asia/Shanghai）。对象：[vastsa/PI-Desktop](https://github.com/vastsa/PI-Desktop)，固定提交 [a21527e5c9ca272bb5e6714038c2d22a61fef68e](https://github.com/vastsa/PI-Desktop/tree/a21527e5c9ca272bb5e6714038c2d22a61fef68e)。该提交 package.json 版本为 0.21.0，README 标注 0.21.x Early Preview。

本次读取 README、架构、相关 ADR、关键源码、测试样例和仓库截图；未安装依赖、未运行应用或测试、未调用模型。因此下文的“已有实现”仅指观察到相应源码，不代表本机验证通过，也不改变 Pi Workbench 的功能进度。

## 最终决定（完整 spec 补充评估后）

已确定独立实现 React / Electron + Node daemon + pi SDK，不直接 fork。执行细节和 M1 工作包见 [实施方案](../architecture/implementation-plan.md)。采用按会话阅读 / 面板上下文、有界历史、inflight 检查点、本地零成本标题、统一搜索和真实输入测试；保留首次发送建会话、保护脏改动、PTY 及双端共享规则。下面的路线比较用于解释决定，不再是待用户选择的选项。

## 原始评估结论

这是高度相关的参考项目：同样以 pi 为 agent 基础，同样采用 Electron / React / TypeScript，本次提交的 agent-runtime 将 pi-agent-core、pi-ai、pi-coding-agent 固定为 1.4.0，与我们的 M0 验证版本相同。

最值得采纳的是会话隔离、可恢复流式展示、有界历史与缓存、低成本命名、工作面板上下文及真实输入交互测试。许多能力已在我们的范围内，应细化现有条目的实现和验收，不需要重复增加功能 ID。它的 Rust host、插件平台和多 Agent 能力不应直接成为我们首版的额外负担。

本项目目前只有规划、原型和 M0 spike；已在正式 OPS-01 前完成路线比较并选择独立实现。已有 M0 验证继续约束生产 SDK、权限和账本实现。

## 可以直接吸收的交互与工程设计

| 建议 | 仓库依据 | 我们的采纳方式与关联 ID | 时机 |
| --- | --- | --- | --- |
| 会话切回保留阅读现场 | ADR 0137；SessionPane.tsx；session-panes.ts | 每个会话维护独立滚动锚点、折叠状态和草稿；最近少量会话保持已挂载页面，使用有上限的淘汰策略。SESSION-02、OBS-04、OPS-07 | M2 建立基本隔离；更大规模性能在 M5 验收 |
| 工作面板归属具体会话 | ADR 0028 | 文件、Diff、预览 tab 记录 sessionId / workspaceId；后台任务的产物只更新所属会话，不能抢占当前面板或焦点。UX-01、FILE-02、CHANGE-03、SESSION-08 | M1 先定身份契约，按 M3/M4/M6 能力接入 |
| 全局搜索统一导航与命令 | ADR 0034；SearchDialog.tsx | Ctrl+K 提供会话 / 页面 / 设置 / 命令分组，Ctrl+Shift+P 可进入命令分组；M2 先交付会话检索，M4 扩充命令。SESSION-12、UX-02、SESSION-04 | M2/M4/M6，保留当前阶段范围 |
| 历史分页从服务端开始 | ADR 0120；session-slice.ts | 控制读取页大小和跨进程载荷；长消息展示可截断并显式展开，完整 JSONL 保留；不能把 UI 截断内容写回会话或当作模型完整上下文。CORE-05、CORE-06、OBS-01、OPS-07 | M1 设计协议，M2 接入 UI，M5 压测 |
| 流式更新按帧批处理 | ADR 0065；events-slice.ts | 只批处理可替代的展示更新，审批、停止和最终事件立即按序处理。若我们的输入是 text_delta，须先完整累积，不能照搬“只取最后一条”而丢字。CORE-05、OBS-01、OBS-02 | M1/M2 |
| 中途回复独立检查点 | ADR 0153；inflight-checkpoint.ts | 保存派生的在途展示检查点，正式 SDK 消息落盘后清理；恢复标明中断，不自动重跑工具。防止迟到写入覆盖下一轮或让已结束消息复活。CORE-06、CORE-05、OBS-02 | M1 的故障恢复设计 |
| 自动命名默认零额外请求 | ADR 0323；host sessions.rs | 首条消息立即生成本地摘要；titleSource / version / 条件更新保护人工改名。模型润色可选、单独计费，不影响主任务。SESSION-10、SESSION-11、MODEL-05 | M2；建议修改当前“默认模型命名”的候选规则 |
| 长粘贴保留为可检查引用 | ADR 0131 | 长日志可保存到宿主管理的会话附件空间，输入区显示可展开的引用，发送前说明实际携带内容；保留原字节与撤销，不写脏项目。不应把文件引用等同于必然减少模型用量。INPUT-01、INPUT-03、INPUT-05 | M4/M6；M2 先保证正常编辑和草稿 |
| 插件使用统一的能力声明 | plugin-development.md | 为未来工具、命令、面板预留注册接口和权限元数据；先验证一类能力，M6 再建设管理。独立进程加 host API 守卫不等于 OS 沙箱。EXT-04–08、SEC-05、SEC-07 | M1 约定边界，M6 实现平台 |
| 并行会话显式选择隔离目录 | ADR 0329 | 区分项目身份和执行根目录，展示 worktree 基线、同步、合并范围；Git 操作禁用不可信 hooks。继续遵守 D03 同物理目录受管写入互斥。GIT-02–06、MULTI-02、WS-04 | M3 先做好锁，M6/M7 扩展 |
| 行为测试覆盖真实交互 | composer IME / paste / session-switch / permission / persistence suites | 吸收输入法确认、compositionend 丢失、斜杠菜单、草稿切换、迟到事件、审批队列、长历史和关闭恢复的场景；同时保留真实浏览器 / 进程行为测试，不能只匹配源代码字符串。OPS-08、INPUT-01、SESSION-02、SEC-02、CORE-06 | M1 测试基线；后续按功能补齐 |

上表中的最近 3 个页面、100 条历史、64 KiB 展示预算和 1.5 秒检查点间隔，是参考项目的实现参数。本产品应根据实际机器和样本测量后选择，不能直接据此声称达到性能指标。

UI 截图显示了左侧会话 / 项目、中间对话与折叠工具、右侧多 tab 文件面板的组合，适合作为高保真设计的另一份参照。我们可沿用现有 PRD 的中性配色和信息架构，重点评审窄窗口、后台事件、审批、长内容等状态；无需引入截图中的全部插件和多 Agent 控件。

## 需要保留差异的产品选择

1. **新会话落库时机不同。** ADR 0084 曾选择首次发送才创建，但已被 ADR 0113 替代：显式 New Task 立即创建 / 复用可见空会话；仅启动首页仍可保持未落库草稿。当前 session-create.ts 与此一致。我们的 D15 保持“首次发送才创建”，草稿和附件应先有自己的 draftId，不能照搬其附件操作时提前 materialize session 的路径。
2. **默认自动命名有值得调整的地方。** 旧 ADR 0186 的内建一次性模型摘要已被 ADR 0323 替代；当前核心保留本地标题，模型命名交给可选插件。我们的 session-design 目前仍默认后台模型命名。考虑用户费用偏好，建议调整为默认本地摘要、用户启用后才模型润色；无需为了这个能力先完成插件平台。
3. **终端范围不同。** ADR 0108 删除内建交互 PTY，保留 Agent 的非交互 Bash 和外部终端。我们的完整本地范围仍包含 M4 PTY。可学习其降低原生依赖的取舍，但不能把命令输出面板算成交互终端，也不能静默删除 EXEC-01–03。M2 不依赖 PTY，M4 再实现既定范围。
4. **审批等待策略不同。** ADR 0310 将本地审批改为一直等待用户处理 / 中止 / 服务关闭；我们的 Q05 暂定 10 分钟拒绝。可以在 M2 用真实离开桌面场景再定，不直接替换为无限等待，也不照搬记住更宽松模式的默认行为。
5. **项目删除语义不同。** ADR 0251 删除项目同时删除它所属的会话和应用记录，保留用户项目文件。我们的规则要求移除项目 / 目录不顺带删除会话与文件。应提供解除归属 / 归档与独立删除动作，保持 D15。
6. **浏览器目标不同。** 当前架构优先 Electron IPC；它已有 pi-host / 远程协议相关模块，但架构文档仍将浏览器访问列为单独目标。不能把该项目的内嵌 Browser 预览误认为本机浏览器工作台客户端已经等价完成；我们的 M2 双端共享服务仍需要专项验证。
7. **运行时事实源不同。** 该项目区分 Desktop 自有 transcript 与 pi-native adapter。我们的主要路径是 SDK 会话文件为事实源。可学习它的原生会话租约、版本检查和不重写历史策略，但不直接引入另一套完整消息持久化。

## 对技术选型的影响

源码确认的组合为 Electron、React 19、TypeScript、Vite、Tailwind 4、Zustand，以及 Rust host-core + Node pi sidecar；SQLite / 权限 / 工具与部分平台服务由 Rust 承载。不能把它概括为纯 Electron + Node 应用。

对于我们当前独立实现路线，继续使用 Electron / React / TypeScript / Node 服务是合理候选。先吸收无特权 renderer、集中策略、明确 IPC、版本化契约和宿主管理资源等原则；Rust 是否引入，取决于实际隔离或性能需求及维护成本。编程语言本身不建立沙箱，也不会自动解决 CORE-03 已记录的 OS 竞态。

它使用 Electron 自带 Node 运行 sidecar；我们的草案是独立 Node sidecar。两条路线在 PTY / SQLite / 原生模块 ABI、无桌面 serve 和运行时版本上有差异。OPS-01 应建立最小构建与运行兼容样本后再锁定，不能仅因参考项目使用某个版本就直接复制。

若决定以 PI-Desktop 为基础二开，则应接受其现有 Rust / Electron / Node 分层，先测现有 Windows 版本与目标场景，而不是先把 host 重写为 TS。与独立开发比较的关键是持续维护量和我们必须保留的产品差异。

## 在正式投入前值得比较的实施路线

| 路线 | 优势 | 必须确认的成本 |
| --- | --- | --- |
| 使用 PI-Desktop，必要时通过插件扩展 | 对个人使用目标可能更快，已有大量界面和运行时能力 | 是否满足当前 pi 配置、Windows、审批、回滚与会话规则；所需差异能否由插件表达 |
| 基于固定版本二开 | 可以复用已有界面和基础能力，调整产品规则 | Rust 维护、上游跟进、Windows 测试、浏览器服务适配、数据迁移和许可证义务 |
| 独立 Pi Workbench | 对 D01–D15、双端和 pi 会话事实源控制更直接 | 完整 UI、协议、持久化、安装与可靠性仍需自己建设；不能只比较首屏开发速度 |

建议在 OPS-01 前先明确是否要以该仓库作为实现底座。若只是吸收设计，当前推荐不变；若用户更重视尽快拥有可用工具，应优先安排现有版本的隔离试用和差距验证，再决定是否从零实现。试用需要另行处理模型请求预算，本次未启动这一过程。

## 许可证与复用边界

仓库 [LICENSE](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/LICENSE) 是 LGPL-3.0。可以研究设计，也可以在遵守许可证的前提下复用代码；复制或修改代码时应保留来源和许可记录。若二开后对外分发，要按实际组合 / 修改方式处理通知、对应源码、替换或重新链接等相关义务；不能当成 MIT 代码直接搬入，也不能简单理解成禁止商业使用。本次仅形成分析，没有复制其产品源码到本工程。

## 建议下一步的产物

1. 技术选型记录：明确独立实现还是二开，确认桌面 / 浏览器服务边界与运行时打包方式。
2. 核心高保真原型：新会话、运行、审批、历史切换、Diff 五类状态，吸收有界阅读现场和后台不抢焦点的行为。
3. M1 契约补充：sessionId / turnId / toolCallId、历史读取窗口、派生在途检查点、事件批处理与迟到事件规则。
4. M2 验收补充：IME、草稿、后台消息、搜索跳转和人工标题优先；自动命名的费用默认作为待采纳变更明确记录。

初次评估没有改动 backlog。完整 spec 补充评估后，已将采纳规则回填 backlog 1.2、会话设计、架构及 PRD 源文件；146 个功能的 progress 对象、负责人和验收勾选未变。仍为 M0 三条已验收、M1 及后续未开始。

## 在线 spec 的补充核对

2026-11-01 访问用户提供的 [spec 索引](https://pi-docs.aiuo.net/zh-CN/spec/README)，抓取 23 个重点页，重点读取架构 / 技术栈并抽查长协议、数据、UI、权限、安全、插件及交付用例。范围与正文指纹见 [抽查清单](pi-desktop-spec-audit.json)。未安装 / 运行参考产品，没有逐条验证其全量验收。

在线技术栈页仍标 pi 0.86.1，固定提交的 agent-runtime 依赖实际为 1.4.0；基线与工具权限页仍标 120 秒审批，ADR 0310 已改无倒计时；基线版本与后续修订也有交错。中文页面明确要求歧义时以英文源为准，因此采用英文 ADR 和对应源码交叉核对，不能依据某页的已勾选状态宣称本产品支持。

本产品已选：独立 Node 24；默认本地标题、可选模型润色关闭；本地交互审批无倒计时但可取消并随运行时失效；Windows 首发，模型任务默认并发 1。Rust、市场、远程、语音等按本产品阶段保留边界。

## 固定版本来源

- [架构与打包](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/docs/spec/02-architecture/01-architecture.md)
- [桌面实际依赖](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/apps/desktop/package.json)；[agent-runtime 实际依赖](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/packages/agent-runtime/package.json)
- [ADR 0028：按会话保留工作面板](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/docs/adr/0028-session-scoped-work-panel-contexts.md)
- [ADR 0034：统一全局搜索](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/docs/adr/0034-merge-command-palette-into-global-search.md)
- [ADR 0065：布局与流式反馈](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/docs/adr/0065-smooth-shell-layout-and-stream-feedback.md)
- [ADR 0113：空会话创建规则（替代 ADR 0084）](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/docs/adr/0113-immediate-empty-session-slot-and-deduplication.md)
- [ADR 0120：有界历史](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/docs/adr/0120-bounded-session-history-windows.md)
- [ADR 0131：长文本粘贴引用](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/docs/adr/0131-large-text-paste-session-reference.md)
- [ADR 0137：有界保留会话页面](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/docs/adr/0137-retained-session-panes.md)
- [会话页面实现](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/apps/desktop/src/components/SessionPane.tsx)；[有界缓存实现](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/apps/desktop/src/lib/session-panes.ts)
- [ADR 0153：流式检查点](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/docs/adr/0153-inflight-reply-checkpoint.md)；[检查点实现](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/packages/host-runtime/src/inflight-checkpoint.ts)
- [ADR 0323：可选模型命名（替代 ADR 0186）](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/docs/adr/0323-plugin-owned-session-titles.md)
- [ADR 0108：移除内建交互终端](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/docs/adr/0108-remove-built-in-interactive-terminal.md)
- [ADR 0251：删除项目与所属会话](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/docs/adr/0251-project-delete-with-owned-sessions.md)
- [ADR 0254：原生 pi 会话](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/docs/adr/0254-native-pi-session-continuation.md)
- [ADR 0310：审批不自动到期](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/docs/adr/0310-local-permission-approvals-without-deadline.md)
- [ADR 0329：会话 Worktree 隔离](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/docs/adr/0329-session-worktree-isolation.md)
- [插件开发与实际隔离边界](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/docs/plugin-development.md)
- [真实 Chromium IME 测试样例](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/scripts/e2e-composer-ime-stack.mjs)
- [项目自带界面截图](https://github.com/vastsa/PI-Desktop/blob/a21527e5c9ca272bb5e6714038c2d22a61fef68e/docs/image/readme/home.webp)
