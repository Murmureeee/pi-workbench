# 规划工具验证记录

本文件保留验证历史。2026-10-31 的记录针对需求数据、生成器、规划看板和交互原型；2026-11-01 的 CORE-01 记录针对实际 SDK 验证工程，两者均不代表已交付 Workbench 应用。

- `node scripts/planning/build-roadmap.mjs` 成功校验并生成 HTML 与 Markdown；基线 revision 为 `47dbbed937cd`。
- `node scripts/planning/verify-roadmap.mjs` 的 12 项检查全部通过，覆盖依赖图、验收门槛、原子导入、生成数据一致性和脚本语法。
- 旧 PRD 与架构的内联脚本均通过语法解析，引用的本地 HTML 文件存在。
- 真实浏览器中验证了阶段筛选、文字与状态组合筛选、空结果、阶段页跳回清单、本地完整版 129 项与 M8 可选 13 项的范围切换。
- 验证了未勾验收或未填写证据时不能保存为已验收；临时进行中状态保存后刷新可恢复。
- 保存后详情关闭且地址 hash 清理；刷新不会再次弹出详情。核心 PRD 的章节链接能打开对应的功能详情页签。
- 通过本地文件选择器导入了磁盘基线，再从看板导出 JSON；导出文件的全部 feature 数据与磁盘源文件完全一致。临时测试状态已还原，已验收和进行中均为 0。
- 默认桌面及 390 px 窄屏检查中没有全页横向溢出；窄屏宽表在自身容器内滚动。测试结束已恢复默认视口。
- 浏览器未记录 warning 或 error。截图接口超时，未取得可用于逐像素视觉复核的截图；布局确认限于实际页面交互、可见内容及 DOM 尺寸。

当前范围：142 项、19 模块，M0–M7 为 129 项，M8 为 13 项。产品实现仍为 0 项已验收。pi 的 SDK 接口与类型已查阅，真实集成验证仍属于 M0。

## v1.1 会话与项目需求补充

- 新增 SESSION-10–13，细化 SESSION-01 / SESSION-07 / INPUT-01 / WS-06，并将基础项目管理和无项目会话提前到 M2。新增 D15 明确首次发送、命名及归属 / 执行目录边界。
- 最新基线 revision：`882fc9f1eeb0`；146 项、19 模块、54 项已有详细设计，M0–M7 为 133 项、M8 为 13 项；M2 共 32 项。产品已验收仍为 0。
- 生成器与 12 项检查再次全部通过，旧 HTML 的脚本语法和本地链接检查通过；本次涉及的七项基础会话 / 项目能力均位于 M2，状态仍为未开始。
- 浏览器发现原页面有缓存，以及 CORE-01 的实际负责人记录。先导出旧副本，再将该条原有进度完整保留到数据源；已验证与旧导出中的该条 progress 完全一致，没有用默认值覆盖。
- 以真实浏览器导入当前基线，验证版本变化后的显式导入可恢复浏览器保存，同时下载旧副本；刷新后显示 146 项、0/133，已有负责人保持。
- 会话模块筛选显示 13 项；SESSION-11 的 M2 阶段、三条验收与详细设计链接显示正确，关闭后刷新不重新打开；浏览器没有 warning 或 error。
- 以上验证的是需求看板和数据迁移，不是自动命名、搜索或项目迁移的产品实现。

## PRD v2 整体重设计与交互验证

日期：2026-10-31。最终 PRD revision：`d7ee7c78af5c`；需求基线 revision 保持 `882fc9f1eeb0`。

构建与数据：

- `node scripts/planning/build-prd.mjs` 成功生成自包含 HTML，输出 19 个模块、146 项需求、16 条旅程、11 组核心章节，已验收数为 0。
- 静态检查确认内嵌 backlog 与 canonical 数据完全一致，全部需求与 D01–D15 均有对应入口；235 个静态 DOM ID 无重复，章节锚点和本地文件链接存在，内联 JavaScript 可解析，没有外部脚本或样式依赖。
- `node scripts/planning/verify-roadmap.mjs` 的 12 项检查全部通过。未修改 backlog 定义或进度，`CORE-01` 的负责人 `murmure` 保持；完整本地产品仍为 0 / 133，M8 为独立的 13 项候选。

真实浏览器中的原型验证：

- 新会话输入与刷新不创建会话；草稿、项目、模型和模式可恢复；首次发送双击只新增一个会话和一条用户消息。异步自动命名没有覆盖随后保存的人工标题。
- 标题 / 正文搜索可定位消息；无结果有清除筛选入口，Escape 关闭后焦点返回搜索按钮。移出项目仅改变归属，示例执行目录保持原值。未知斜杠命令显示错误、保留草稿且没有新增会话。
- 计划场景未回答澄清问题时不能转执行；回答后出现范围确认，确认后仍等待工具审批；运行或待审批时不能再次启动计划。允许一次、拒绝、本会话授权及撤销均有对应记录；拒绝没有产生示例文件变更。
- 待审批时追加消息，再停止并保留队列：审批取消、会话中断，队列等待显式恢复。
- 一个文件接受、另一个文件回滚后显示 2 / 2 全部已处理；整轮回滚出现冲突时预检阻止整个批次写入，保留现有内容。
- 模拟终端的测试输出明确标注未真实执行；附加输出只增加草稿引用，不发送消息。终端 `git status` 显示当前模拟分支 `pi/fix-auth`，与环境及 PR 预览一致。展开终端时正在跟随的对话保持在最新位置。
- 提交预览只包含选中的暂存文件；PR 预览显示源分支和目标分支，示例记录不调用 Git / GitHub，CI 保持未运行。
- 子任务详情展示父任务、独立 Worktree、继承权限和待验证证据；自动化演示可创建、修改时区预览及暂停，均未启动后台调度。
- 旅程可跳到对应需求，需求显示原始验收与进度；核心规格可从原型定位并跳回。需求锚点刷新可恢复，全部 146 项需求可筛选查看。
- 检查原型 / 规格 / 对照、明暗主题、面板键盘调宽以及 390 × 844 窄屏。修正抽屉模式下主工作区的网格列位置，并复验输入、审批、停止及抽屉关闭；页面宽度保持 390 px，没有整页横向溢出。测试结束已恢复默认视口。
- 最终浏览器控制台 warning / error 均为空。已保存并实际查看桌面截图 [prd-workbench-v2.jpg](screenshots/prd-workbench-v2.jpg) 和窄屏截图 [prd-mobile-v2.jpg](screenshots/prd-mobile-v2.jpg)。

验证用会话、自动化与草稿已通过原型的数据重置入口清理，最终保留默认的四个示例会话，打开示例变更审查供评审。原型使用独立存储，不改动需求看板的本地进度副本。

以上证明文档、数据映射与列出的模拟交互可用，不证明真实模型、文件写入、审批拦截、Git、终端、子 Agent 或调度已经实现，也不代表 146 项功能都已完成详细设计或产品验收。

## CORE-01 首轮 SDK 实测

日期：2026-11-01（Asia/Shanghai）。关联功能：CORE-01；实际工程及复现说明见 `spikes/core-01/README.md`。SDK 1.4.0，Node v26.13.0；未安装新依赖，沿用现有提供商 / 模型。

- `node --test spikes/core-01/probe.test.mjs`：9 / 9 通过，包括重试结束边界、取消触发、真实失败样本回放、手动压缩边界、预算持久化和日志脱敏。
- `node spikes/core-01/run.mjs --offline`：9 / 9 场景通过，使用实际 SDK 与回环 HTTP SSE 服务，外部模型请求为 0。证据：`spikes/core-01/artifacts/offline-2026-10-31T16-27-24-956Z/summary.json`。
- 本轮已完成 3 次真实 HTTP 请求，原始证据：`spikes/core-01/artifacts/live-2026-10-31T16-20-39-674Z/summary.json`。正常流式与手动压缩通过；第三次只有思考增量后上游异常断流，原测试等正文才取消，因此真实中止没有得到验证。原始失败记录保留。
- 修正取消钩子后，本地思考中止、快速缓冲流中止和异常断流场景通过；没有追加真实调用。`node spikes/core-01/analyze.mjs` 仅分析已有事件，生成派生结论，不能把失败改成通过。
- 三次真实请求均带输出上限及 `thinking.type=disabled`，无工具与项目上下文、无自动重试。第三次实际仍返回思考，因此记录服务端兼容差异。原 settings / models / auth 前后指纹一致。SDK 报告的 577 token 不含第三次错误流的完整用量，价格也未配置，费用保持未知。
- 实测修正架构与 PRD：手动压缩以操作 Promise、`compaction_end` 和 SDK 空闲结束，不产生新的 `agent_settled`；Agent 运行仍以 `agent_settled` 为稳定边界，错误与空闲分开。
- CORE-01 更新为进行中，负责人 `murmure` 保持，两条验收分别为未通过 / 通过；CORE-02 / CORE-03 保持未开始。完整本地产品为 0 / 133 已验收、1 项进行中，未放行 M0 阶段门。
- 已重建看板 / 功能清单与 PRD，revision 分别为 `ab5570eb19ad` / `275f79bd877b`；`node scripts/planning/verify-roadmap.mjs` 的 12 项检查通过。补充静态检查确认两份 HTML 内嵌进度与 canonical backlog 完全一致，脚本可解析；架构脚本也可解析。
- 直接读取并测试现有预算记录：第 4 次预占被拒绝，预算文件内容未改变，没有发送网络请求。真实额度已经用完，不能通过清空记录来重复运行。

## CORE-01 补齐真实中止并验收

日期：2026-11-01（Asia/Shanghai）。本段更新上一段的阶段性结论，原失败样本保留。

- 为补齐验收，使用独立的单次补充预算运行 `node spikes/core-01/live-abort-once.mjs`，仍是现有 `dli / deepseek-v4.1-flash`。首轮的 3 次限制是自定测试批次上限，并非用户指定额度或 SDK 限制；原预算文件未修改。
- 只新增 1 次真实 HTTP 请求，449 字节、输出上限 64 token、关闭工具和自动重试。首个 `text_delta` 后请求 abort，assistant 以 `stopReason=aborted` 结束，最终 `agent_settled(aborted=true)`；SDK 空闲、未流式输出、队列为 0。原有 pi 配置前后指纹一致。
- 新证据：`spikes/core-01/artifacts/live-abort-2026-10-31T16-53-38-523Z/summary.json`、`abort.events.jsonl`、`controls.jsonl`。累计真实请求为 4 次；取消流没有完整计费用量，费用仍未知。
- 修改中止钩子的控制日志后，`node --test spikes/core-01/probe.test.mjs` 的 9 项检查通过；`node spikes/core-01/run.mjs --offline` 的 9 类场景再次通过，证据为 `spikes/core-01/artifacts/offline-2026-10-31T16-54-04-629Z/summary.json`。
- 新增无网络验收器 `node spikes/core-01/verify-evidence.mjs`：逐条检查事件序号、来源、可见状态回放及边界，核对本地错误 / 重试 / 排队 / 压缩 / 中止与真实提供商流式 / 中止证据。两条验收均通过，报告为 `spikes/core-01/artifacts/acceptance.json`。
- CORE-01 标记已验收，负责人 `murmure` 保持；产品为 1 / 133 已验收，CORE-02 / CORE-03 尚未开始，M0 阶段门未通过。未放宽或删减验收条件。
- 已重建看板 / 功能清单与 PRD，revision 分别为 `ca35ac9625a4` / `112408ac58e0`；规划工具 12 项检查通过。两批次额度均已使用，后续重复执行相应真实验证入口会拒绝，不自动重跑。

## CORE-02 执行前拦截覆盖

日期：2026-11-01（Asia/Shanghai）。关联 CORE-02，前置 CORE-01 已验收。工程和适用边界见 `spikes/core-02/README.md`。

- `node spikes/core-02/run.mjs`：28 / 28 场景通过。使用 SDK 1.4.0、原生 write / PowerShell、扩展工具、真实进程 IPC 和真实 stdio MCP；模型与裁决回复来自本地夹具，付费模型请求为 0。原 settings / models / auth / mcp 配置前后指纹一致。
- 覆盖内建与扩展的允许 / 拒绝正反例、外部请求的回环替身、MCP 分发、两层嵌套与嵌套 MCP、观察钩子缺失 / 移除 / 抛错、IPC 错误 / 断线 / 超时、请求 ID / 摘要失配、过期裁决及等待中撤销。拒绝后直接检查标记文件、请求计数和 MCP tools/call 日志，并核对预期阻断原因。
- 原 SDK 对照复现了“先批准旧参数、后续钩子改写路径”的缺陷。宿主候选方案通过公开工具定义工厂和扩展注册代理，统一包装内建 / 扩展 / 动态 MCP 的 execute；最终独立快照裁决通过后，只执行相同快照。等待期间原参数被修改也不能改变实际执行目标。
- 实测顺序是 `tool_execution_start → tool_call → execute`。已回填架构 ADR-005、状态映射、审批契约、时序图说明与旧测试断言，PRD 也明确准备状态与实际执行状态分开。
- 最新证据：`spikes/core-02/artifacts/offline-2026-10-31T17-28-38-496Z/summary.json` 与各场景 trace / 标记文件 / MCP 调用记录。首次 MCP 正例因测试允许列表未启用 MCP 而失败的历史目录保留，已纠正配置并完整重跑。
- `node spikes/core-02/verify-evidence.mjs`：检查全部事件来源、序号、可见状态回放、实际文件 / MCP 记录，对 13 次受控执行核对先有授权和相同参数快照，两条验收均通过。报告为 `spikes/core-02/artifacts/acceptance.json`。
- 共享 SSE 服务新增工具调用输出后，CORE-01 的 9 类本地场景、9 项边界测试及保存证据验收均通过回归，没有重跑真实模型请求。
- CORE-02 标记已验收，产品为 2 / 133 已验收；CORE-03 未开始，M0 阶段门未通过。该结果不建立生产审批 UI、完整风险引擎或约束任意扩展代码的 OS 沙箱。
- 看板 / 功能清单与 PRD 已重建，revision 为 `51adfbd9b93e` / `ffeac664d0fa`；规划工具 12 项检查通过。静态检查确认两份生成 HTML 的数据与 canonical 一致、CORE-02 已验收且 CORE-03 未开始；生成 HTML 和架构的脚本可解析、本地链接存在，错误时序断言已移除。
- 结束后确认没有遗留审批 worker 或 MCP fixture 的 Node 进程。

## CORE-03 变更快照与修改归属

日期：2026-11-01（Asia/Shanghai）。关联 CORE-03，前置 CORE-01 已验收；完整范围和限制见 `spikes/core-03/README.md`。

- `node spikes/core-03/run.mjs`：34 / 34 场景通过，最新完整证据为 `spikes/core-03/artifacts/offline-2026-10-31T17-47-37-054Z/summary.json`。实际使用文件、独立 bare Git / index、真实 Node 子进程和 SDK 1.4.0 原生 write；不创建模型会话、不读取认证、不发送模型请求。
- 单文件恢复与整轮新增 / 删除 / 重命名恢复均保留 staged、unstaged 和原有未跟踪内容；用户 `.git` 全部文件 SHA256 映射前后相同，包括 HEAD / index / config。二进制、CRLF 和中文空格路径按原始字节恢复，不使用用户 index，不应用换行转换或 filters。
- 工具前后观察链连续时记 `agent-observed`；未观察变化为 `unknown`，链不一致或部分失败为 `mixed`。外部编辑发生在工具前 / 中 / 后、settled 后、两次预检之间及多文件应用期间均有记录；未知 / 混合来源阻止自动整轮回滚。
- 实际验证同账本的跨进程锁和 canonical junction 别名、>5 MiB、gitignore、内建排除、嵌套仓库、hardlink / junction 外逃、路径穿越 / ADS、根目录被替换、真实 Git index.lock 与对象缺失 / 损坏。文件 symlink 创建实际返回 EPERM，没有将未运行的执行验证算通过；产品保守排除，有权限的平台需补测。
- ENOSPC / EACCES / EIO 和竞态时点使用明确标记的本地注入。基线失败不调用工具；末态失败记录 snapshot-missing 并阻止回滚；元数据写入失败仍释放锁。回滚对象与全批末态在写入前检查；运行期失败条件补偿，补偿遇外部编辑时不覆盖并保留 needs-recovery journal。
- 首次运行 33 / 34 的失败记录原样保留：Windows Git loose object 为只读，损坏注入无法写入；仅调整新 fixture 对象属性后完整重跑通过。证据核验器处理 Git 可不落盘的标准空树；静态 HTML 检查排除脚本字符串中的伪 href，并在比较 canonical 时去除生成的 revision 字段，均未修改产品行为掩盖失败。
- `node spikes/core-03/verify-evidence.mjs`：独立只读核验 54 个文件状态、58 个用户 Git 元数据文件、54 个快照、185 次 Git 对象校验和 37 次工具操作的持锁 / 基线顺序，报告为 `spikes/core-03/artifacts/acceptance.json`。实现源文件指纹与录制时一致。
- CORE-01 / CORE-02 的保存证据验收器再次通过，未重跑真实模型。`node spikes/verify-m0.mjs` 综合核对三个 canonical M0 阶段门通过，报告为 `spikes/m0-acceptance.json` / `.md`。累计真实模型请求仍为 4，本次新增为 0，历史费用未知。
- CORE-03 两条验收勾选并标记 verified，负责人和目标日期保持空白。M0 技术可行性通过，产品为 3 / 133 已验收；M1 和后续 CHANGE / WS / SEC 功能仍未开始。下一项是 OPS-01 工程基线，再 CORE-04 内核。
- 已回填架构轮次算法 / 来源链 / 条件补偿 / 排除范围 / D12 保留规则，并校正旧 M0 阶段门；PRD F07、J07 与失败矩阵同步。看板 / 清单 revision 为 `8cfa156c529f`，PRD 为 `e27943e9c7e7`；`node scripts/planning/verify-roadmap.mjs` 的 12 项检查通过。额外检查三份 HTML 的内联脚本可解析、生成数据与 canonical 一致、全部静态本地链接存在；HTTP 8765 实际返回两个最新 revision。
- 生产限制明确保留：外部进程不遵守账本锁，双扫描不能消除 OS 写入竞态；多文件恢复不是系统事务；同物理目录须映射唯一账本，staging 当前要求同卷，崩溃恢复 / fsync / ACL / 空目录 / 仅大小写重命名 / 长路径 / 其他平台 / 大仓库性能仍待对应阶段验收。

## 2026-11-01：PI-Desktop 完整 spec 评估与实施路线确定

- 在线读取 spec 索引并抓取 23 个重点页面，架构 / 技术栈重点读取，其余长文定向抽查；与固定提交 a21527e5c9ca272bb5e6714038c2d22a61fef68e 的英文 ADR / 源码交叉核对。记录在线 pi 0.86.1 与源码 1.4.0、基线 120 秒与 ADR 0310 无倒计时的差异。抽查指纹见 docs/decisions/pi-desktop-spec-audit.json；未安装 / 运行 / 测试参考应用。
- 新增 docs/architecture/implementation-plan.md，确定独立 React / Vite + Node 24 daemon + pi SDK + Electron，保留原生历史与独立 Git 账本；记录双端、打包、UI 时点、低费用默认值、采纳矩阵和 M1 工作包。npm / Node 元数据查询不是实际兼容验收；OPS-01 仍需锁依赖、切到 Node 24 验证。
- backlog 1.2 细化既有功能验收，不新增功能 ID；146 个功能的进度对象、负责人、日期及验收勾选保持原状。Q01 / Q02 按 M0 证据标为 resolved，六项标为 decided（仍待生产验证），其他问题保持待细化。默认本地标题 / 可选模型润色关闭；本地交互审批无倒计时且生命周期失效关闭；模型任务默认并发 1。
- 同步总规划、会话设计、架构、README、PRD 规格 / 旅程与决定展示；M1 UI 壳不提前完成 M2 产品验收，M1 只预留终端预算，真实 PTY 在 M4 验收。
- 顺序运行 node scripts/planning/build-roadmap.mjs、node scripts/planning/build-prd.mjs、node scripts/planning/verify-roadmap.mjs；最终 12 项检查通过。看板 / 清单 revision df86ee17be73，PRD revision d48eb0681251。
- 独立核对 PRD 内嵌 JSON 与 canonical backlog 完全相同；三份 HTML 内联脚本可解析、静态本地链接存在，Markdown 本地链接存在。146 项总范围、133 项本地范围、仅 CORE-01–03 verified 均已断言，其余条目均 not_started 且未勾选。
- 用已安装 Chrome 的无头 Chromium / Playwright 实际打开最终页面（HTTP 200），检查路线和技术栈链接、Q05 已定待验证 / 无倒计时、Q01 / Q02 M0 标签、PRD 更新日期和看板无应用提示；768px 看板无横向溢出，两个页面无 pageerror。截图 [prd-implementation-route.png](screenshots/prd-implementation-route.png)、[roadmap-implementation-decisions.png](screenshots/roadmap-implementation-decisions.png) 已目视检查。IAB 控制返回 browser.user unavailable，默认 Playwright Chromium 未安装，因此改用现有 Chrome，没有下载依赖或浏览器。
- 本次只完成评估与规划校正，没有实现工作台、未重跑 M0 实验、未读取认证或新增付费模型请求；原四次调用预算 / 证据保持，产品仍为 3 / 133 已验收。下一步 OPS-01 → CORE-04 / OPS-08。

## 2026-11-01：共同确认第 1–2 轮技术栈与项目结构

- 用户确认 Windows 桌面优先且保留本机网页入口、首个重点交付目标 M3；随后确认 NestJS + Fastify 适配器、SQLite + pi 原生 JSONL、React / TS / Vite / Tailwind / shadcn（Zustand / Query）、pnpm 单仓库、Drizzle + better-sqlite3。第 3 轮视觉方向 / 主题 / 屏幕缩放已提问但尚未收到回答；未以推荐代替确认。
- 补充解释 Node 运行时与 Nest / Fastify 的不同层级。Node 官方发布页确认 24 / 26 当前均为 LTS；Nest npm 元数据确认适配 Fastify 5。SQLite、Drizzle、TypeORM 官方说明作为选型依据，未以文档或依赖元数据代替实际安装验证。
- 新增 docs/architecture/project-structure.md，记录应用 / 公共包目录、Nest 领域模块、数据所有权、Drizzle 显式迁移与目标命令；当前没有创建应用工程或安装依赖。共同确认记录、总规划、实施方案、架构和 PRD 源文件同步。
- canonical backlog 升为 1.3，只细化 D02、OPS-01 验收及资料关联，保留 146 个功能 ID 和全部 progress 对象、负责人、目标日期与验收勾选。正式前端 / 后端 / 数据库及运行时兼容仍待 OPS-01；设计确认不增加功能完成数。
- 顺序运行 build-roadmap、build-prd、verify-roadmap，12 项规划检查通过。最终看板 / 清单 revision b91594bec597，PRD revision 3c2d98a00ba9。独立确认 PRD 内嵌 JSON 与 canonical 完全相同，HTML 内联脚本可解析，本地 HTML / Markdown 链接存在。
- 使用本机 Chrome / Playwright 实际打开最终 PRD 和看板（HTTP 200），选型文字与项目结构链接可见，768px PRD 无横向溢出，两个页面无 pageerror。未重跑模型 / SDK 实验，新增付费提供商调用为 0。产品仍为 3 / 133 已验收，其余功能未开始。

## 2026-11-01：第 3 轮 UI 约束与第 4 轮高保真方向稿

- 用户确认 Codex 式克制、中等密度、按需面板、跟随系统且明暗两套同等设计；原话“1080 100%”记录为暂按 1920×1080 @100% 制稿的设计解释，未虚构窗口习惯。共同确认清单已同步，A / B 及字号仍待用户选择。
- 先写 docs/design/brief.md，沿用现有中性灰 tokens 与中文系统字体；A 内联工具 / 轻量 Diff，B 轮次摘要 / 宽审查面板。新增独立 docs/design/review.html、docs/design/assets/review.css / js，不覆盖完整 PRD，也未创建正式应用工程或安装依赖。
- canonical backlog 1.4 细化 UX-03 的系统主题、明暗同等设计、密度与响应条件，新增设计资料来源；修改过程断言全部 feature ID / progress 对象完全一致。146 项总范围、133 项本地范围不变，只有 CORE-01–03 verified，其余 not_started 且 acceptanceChecked 全 false。
- 顺序运行 build-roadmap、build-prd、verify-roadmap，12 项检查通过，最后再次执行 verify-roadmap 通过。看板 / 清单 revision 8a1c3d2f6385，PRD revision 4f31417efdb9。独立断言 PRD 内嵌 JSON 与 canonical 完全相同，内联脚本及新 JS 可解析，新入口 / README / brief 的本地链接存在。
- 本机 Chrome / Playwright 检查 1920、1280、960、768、390 CSS px × 两方向 × 六场景，共 60 组布局无整页横向溢出。960×540 仅作为放大后的有效布局空间检查，未冒充 Windows 实际缩放实测。窄窗发送栏改进后复测 390×844 下两方向 × 两主题 × 六场景，共 24 组通过，无 pageerror。
- 实际操作验证：系统明暗变化；独立草稿与首次发送建会话；本地标题；中文输入法组合态 Enter 不发送；改名；正文搜索及键盘打开；更改项目不改变 cwd；审批允许一次 / 拒绝 / 取消；追加队列 / 停止；逐文件接受与回滚各自独立、历史 Diff 保留；终端输出显式加入 / 移除上下文；侧栏折叠 / 恢复；两 iframe 明暗对照。浏览器记录为零外部请求、零 pageerror。
- 目视检查暗色 A、亮色 B、新会话、审批、明暗对照与窄窗审批。发现并修正审批动作初次展示被卷到下方、窄窗发送栏挤压的问题；补验审批按钮在桌面与 390px 初次展示处于消息可见区。8 张 PNG 的文件头尺寸已断言，索引见 docs/design/screenshots/ui/README.md。
- 原完整 PRD 新默认主题也改为 system；Chrome 验证默认跟随系统、实时主题变化、显式主题覆盖不被系统变化重置。已有浏览器中用户显式选择的主题不强制清除。
- 以上仅证明列出的模拟设计可操作。未读取 pi 认证、未执行真实命令、未调用提供商；原累计 4 次真实调用不变。没有以页面 / 截图增加产品完成数，仍为 3 / 133。完整冲突 / 恢复 / 设置、真实 SDK / Electron 和后续模块继续按 backlog 验收。

## 2026-11-01：第 4 轮确认与组合方案核心状态

- 用户明确选择“A 日常对话 + B 展开审查”的组合，并保留界面 14 px / 消息 15 px / 辅助 12 px 基线。共同确认清单与 UI brief 已记录原意；新默认预览为组合，打开变更为宽审查、关闭恢复日常对话；A / B 仅保留比较入口。旧版浏览器的 A / B 研究偏好不冒充已选产品方案，主题偏好继续保留。
- 新增 docs/design/core-spec.md，列出页面、布局尺寸、组件、阶段边界及 18 个状态。补充创建保存中 / 失败、资源排队、审批失效、收尾、停止确认、已停止、重试、压缩、同步、回滚冲突与快照失败。创建成功、回复结束、收尾完成、停止确认等由外部评审栏手动推进；没有调用真实服务或用短定时器伪造确认。
- backlog 1.5 细化 UX-01 的组合布局与现场保留、UX-03 的用户确认字号，新增核心设计来源。修改过程断言全部功能 ID / progress 对象不变；146 项 / 133 项本地范围不变，仍只有 CORE-01–03 verified，其余全部 not_started 且验收未勾选。
- 顺序构建 roadmap / PRD 并运行 12 项规划校验，通过。看板 / 清单 revision 528b135bbcb8，PRD revision 31ca95c69dca。独立检查新 JS 语法、PRD 与 canonical JSON 完全一致及本地链接有效。
- Chrome / Playwright 实际验证：组合开关与草稿保留；创建中禁发、不产生空项或重复会话、完成后本地命名；创建失败保留正文；回复结束保持收尾直至宿主确认；停止先等待确认且残留队列暂停 / 不可绕过；失效请求不可批准，重新检查后才产生可批准请求；冲突文件禁用决定，另一文件独立处理；无快照显式继续后保留不可回滚标记；断线先同步再恢复，没有重放命令。该交互检查零 pageerror、零外部请求。
- 18 个状态 × 两主题 × 1920 / 1280 / 960 / 768 / 390 CSS px，共 180 组组合布局通过；无整页横向溢出，工作区高度适配实际评审栏，创建 / 断线 / 同步等禁用发送，初次进入审批时决定动作可见。960×540 仅验证有效布局空间，未宣称 Windows 缩放实测。
- 发现复用浏览器的历史阅读现场会影响直接状态样本的初始定位；明确 URL 场景为新样本并清除旧阅读锚点，普通会话切换仍保留现场；增加视口大小变化时的底部跟随。另行验证回看旧消息、打开终端后不强拉到最新，以及旧主题偏好 / 系统变化 / 显式覆盖。
- 生成 9 张当前组合截图，保留前 8 张方向稿为历史选型记录。目视检查宽审查、收尾及窄窗冲突；将冲突原因固定于代码区上方，补验桌面 / 窄窗初次可见。截图与尺寸索引在 docs/design/screenshots/ui/README.md；文件仅证明模拟页面可渲染。
- 已主动询问新会话默认权限、开发真实测试预算和关闭窗口行为，记录为待回答推荐；本轮没有按推荐执行模型请求或修改系统设置。原累计 4 次真实提供商调用不变，工作台产品仍为 3 / 133 已验收；完整设置、真实协议 / SDK、长历史和高级模块继续按阶段验收。

## R6–R8 默认规则与设置设计（2026-11-01）

- canonical 更新至 1.7，保留 146 个功能 ID 与全部 progress 的逐项原值；产品仍仅 CORE-01 / 02 / 03 verified，即 3 / 133。用户明确选择仅升级前自动备份，其余手动，未把原推荐每日 / 7 份轮转当作确认。
- 细化 SEC-01 / 02 / 03、UX-05、OPS-01 默认权限 / 生命周期 / 开发预算；R7 / R8 回填 CORE / SESSION、EXEC、FILE、OPS、UX 相关既有功能，数据目录迁移与备份在 M5 验收，旧历史只读 M2、后续受保护续聊 SESSION-06。技术方案、会话设计、数据规格、确认记录和 PRD 源同步，不因设计增加验收勾选。
- 新增 `live-validation-policy.md` 与 `live-validation-budget.json`：每里程碑新增最多 2 次底层请求、输出最多 512 token、失败不自动重试。记录明确 enforcement 未实现，OPS-01 待验证；原两份预算文件 SHA-256 与修改前一致，历史累计 4 次不变，新记录 0 次。当前轮未读凭证、修改 pi 配置或发出提供商请求。
- 顺序执行 `node scripts/planning/build-roadmap.mjs`、`node scripts/planning/build-prd.mjs`、`node scripts/planning/verify-roadmap.mjs`：12 项规划检查通过。roadmap revision `52a2dd4e9e6c`；PRD revision `bdb540674c4d`。两个 JS 源的 `node --check` 通过。
- 本机 Chrome / Playwright 122 项针对性断言通过：1920×1080 / 390×844、light / dark、六个设置分类无横向溢出；托盘 / 退出、迁移 / 备份 / 恢复说明往返、旧历史禁用续聊、嵌套浮层关闭焦点回原入口、草稿和待审批保留、允许后推进运行样本。pageerror 0，外部请求 0。宽 / 窄为 CSS 视口，未声称真实系统缩放或辅助技术全量验收。
- 生成的完整 PRD 浏览器复查通过：默认权限、默认数据路径、仅升级前自动备份、托盘生命周期文案与入口一致，无 pageerror。新增 9 张截图，等待入场动画结束并确认 opacity=1 后采集；目视检查暗色权限、浅色数据和暗色窄窗生命周期。仍为模拟与设计验证，不代表托盘 / 备份 / 迁移 / SDK / 预算守卫的产品实现。
