# OBS-03：工具时间线与嵌套调用

Electron 工具时间线的自动与 Windows 原生验收已完成，状态 **verified**，两项验收勾选；OPS-08 继续 in_progress。

## 验收对应与实现

| 验收项 | 实现与自动验证 | 原生证据 |
| --- | --- | --- |
| 拒绝、失败、取消、嵌套及乱序关联 | session＋epoch＋turn＋call 身份；最终参数、父调用、cwd、来源不可重绑。终态先到时补缺失元数据，不覆盖结果。缺父、循环、深层嵌套安全保留；未确认终态标“结果未知”，不猜取消或成功。真实 HTTP／TCP 的 snapshot、live、replay 与 SQLite 重启验证；Electron 检查文字状态、键盘、跨会话及同会话不同轮次的相同调用 ID。 | 实际点击／键盘追溯、后台同 PID、重启不重发均通过；见 native-validation.json。 |
| 脱敏长输出、可验证摘要及安全降级 | 文件／命令／变更根据工具名和经过 Zod 验证的结构生成摘要；MCP 仅用显式服务／工具元数据，不从名称猜测。参数／结果／Diff 经同一脱敏边界后以纯文本显示。16k 预览可明确展开完整已捕获内容，未知／超限／无效 JSON 保留安全文本；上游截断单独说明。耗时／退出码缺失显示“未知”；Diff 明示仅观察、未关联回滚账本，无回滚动作。 | 原生展开／收起、明暗 802px 窄窗、重启历史与菜单退出通过。 |

复用官方 Base UI / base-nova TraceCollapsible、TraceLine、Badge 和现有 MessageBody，未增加依赖或公共 primitive。展开书签按会话中的 turn＋call 保存，最多 3 视图淘汰和本窗口 renderer 刷新可恢复；不承诺完整应用重启恢复窗口书签。布局缩进最多显示 4 层，文本保留实际层级；迭代遍历验证 3000 层，不递归执行。打开卡片不启动工具、模型或审批，也不跳到其他会话。

## 来源、权限及数据边界

- 已安装 pi 1.4.0 的 `tool_execution_start/update/end` 提供调用 ID、最终参数、`parentToolCallId` 和可选 `durationMs`。参数在每轮首次事件保存，只读映射，不猜退出码、不从结果文字判断拒绝／取消。真实 SDK 的禁用 write 请求沿用现有本地 HTTP 用例，断言 IPC 参数、调用身份、错误和零落地文件；不增加这条用例的模型请求。
- 嵌套、拒绝、取消、MCP、Diff、乱序和长输出使用[显式合成工具观察](../../../e2e/helpers/tools.ts)，每张卡显示“合成观察 · 未执行”。服务测试用合成 v3 文件及实际 SQLite／HTTP／TCP；Electron 用真实 daemon／SDK 本地 hold 任务承载观察，工具／扩展仍关闭。这些记录不证明生产审批、MCP 调用、文件写入或回滚已经接入。
- SDK 原生 JSONL 与执行参数保持原文，工具索引复用现有 tools JSON 列，无迁移。历史仅返回本页相关 turn 的时间线，展示与重放统一脱敏；原始观察和文件哈希在自动验证中保持不变。运行中工具索引随检查点持久，重启恢复为结果未知，0 内核、0 自动重发。
- 结构摘要解析限参数 64 KiB、结果 256 KiB；超限仍能展开纯文本。已捕获长文展开满足“展开或下载”，本轮不新增下载接口、不自动读取工具输出文件。文件读取范围标为“请求范围”，不冒充实际读到的行数；变更摘要标为替换请求，结果与最终执行结论分别显示。
- `tool-timeline-v1` 为必需观察能力；缺失时沿用 CORE-05 不兼容阻止与匹配版本指引。旧持久化记录没有新增字段时可读取，并明确显示元数据未知。网页仍复用已有只读观察／历史，不新增独立功能。

## 自动门禁与修复记录

<!-- OBS03-GATES-START -->
OBS-03 已验收：完整 35 文件／251 项 Vitest、93 项浏览器及 Electron E2E、SDK 冒烟与 frozen clean 通过；Windows 原生工具身份／摘要／长输出脱敏与收起、跨会话及逐轮展开隔离、后台同 PID／epoch 和焦点、明暗 802px 窄窗、同 data/profile 只读重启 0 内核／0 新发送／0 注入、历史哈希不变及正常菜单退出已补证。316 文件与 CI／clean 一致，原生后复用门禁；仅文档模板另更新。两项勾选，当前本地 27 / 133，OPS-08 继续 in_progress。合成工具观察与真实 SDK 禁用工具错误分开，未开启生产工具／审批／MCP／回滚；真实提供商 0，配置／预算／锁未改。

- [完整 CI](ci.log)、[fix](fix.log)、[验证汇总](validation.json)；SDK 冒烟为已安装 1.4.0＋本地 HTTP，2 次本地请求、真实提供商 0、blockedNetworkAttempts 0。
- 文档／进度回填后，[重新生成](docs-build.log)、[格式修复](fix-docs.log)和[完整静态检查](check-docs.log)退出 0；产品代码未变，复用以上 CI／clean。
- [clean 汇总](clean-workspace.json)与[逐命令输出](clean-commands.json)，不重复 E2E；完整 E2E 由主 CI 执行。
- [CI 代码清单](ci-code-manifest.json)记录 316 个产品／测试／脚本／配置文件，文档回填后按字节确认未变；[一致性审计](code-reuse-audit.json)同时与本次 clean 副本比较，无差异，后续未改代码时复用这组门禁。
- [重启修前](service-before.log)／[修后](service-after.log)、[48 项定向 Vitest](targeted-vitest.log)、[Electron 首轮失败](electron-before.log)／[夹具修正](electron-fixture-fix.log)／[7 项定向通过](targeted-electron.log)、[展开身份反向控制](identity-negative-control.log)与[按字节恢复结果](negative-control-result.log)。
- 明暗截图由实际 Electron Playwright 生成：[1920×1080 明色](tool-timeline-light.png)、[800×760 暗色](tool-timeline-dark-800.png)；[Windows 原生验收](native-validation.json)与这些截图分开。
<!-- OBS03-GATES-END -->

- 首轮实际服务回归发现运行中 tools 没有进入恢复索引；修前重启断言失败，修后通过。另一个失败是测试端口和既有事件用例重复，改用独立端口，不放开 Host／Origin 校验。
- 首轮 Electron 发现参数第二次脱敏去掉 JSON 值的引号，导致可解析文件参数降级；修后保留引号及转义值边界，重复过滤仍为合法 JSON。字段／已知值／分片后缀、上游截断后缀继续保护，原件不变。
- 展开时阅读锚点恢复引起 ResizeObserver 同周期布局循环；改为下一帧恢复并清理所属帧，工具与既有 OBS-04 回归均验证。首次定向日志的告警保留，不算最终成功证据。
- 首次完整 CI 为 91／93，两处既有阅读回归失败，见 [修前 CI](ci-before-reading-fix.log)：Home 后迟到布局把顶部推到 59px；返回最新后距底部停在 856px。禁用浏览器独立锚定后，Home／视图恢复通过；[滚动诊断](scroll-diagnostic-before.log)进一步记录到按钮先到达底部，随后自动布局滚动把 follow 从 true 错记为 false。现先提交显式跟随，再保留自动滚动期间的跟随意图，滚轮／滚动键／滚动条手势仍优先接管；[同一慢流用例修后](scroll-follow-after.log)通过，不放宽原来的位置断言。最终完整回归另见 ci.log。
- 第二次完整 CI 仍为 91／93，慢流返回最新已通过，但 Home 偶发停在 112px，另一个 SESSION-07 用例没有处理核对期间归属改变的预期 409，见 [该次完整日志](ci-before-home-and-inspection-fix.log)。[Home 诊断](home-key-diagnostic.log)的 3 次带采样运行均通过，同时记录到约 200ms 的浏览器键盘滚动动画；不把这 3 次通过冒充失败复现。消息区 Home 改经 MessageScroller 公共即时接口，避免原生动画与迟到布局竞争；原有 0px、900px 及跨缓存恢复断言保持。归属服务和产品界面未改，测试遇到明确“执行空间未同步”时验证保存禁用和选择保留，再点击“重新核对执行空间”，最后仍须通过版本冲突和显式协调断言。[两条用例各重复 3 次的结果](home-inspection-after.log)单独记录。
- 缓存测试首次用同 epoch、倒退 seq 替换快照，修正为明确的新代际合成观察；后续修正保留视图中的侧栏定位范围。这两处属于夹具修正，不宣称产品修复。
- 反向控制临时退回仅 call ID 的展开键，同会话下一轮复用 ID 时断言按预期失败；finally 按字节恢复源码，再由最终完整门禁验证。

## 原生验收与下一步提示词

详见 [Windows 原生记录](native/acceptance.md)、[原始观察](native/observations.json)与[结果汇总](native-validation.json)。初次重启夹具误注入合成观察、前三轮 hold 超时与成功后台任务明确停止分别保留，不合并成一轮持续成功。应用重启不承诺窗口草稿或展开书签；只读复验无新 prompt／内核／注入，历史原件哈希保持。

> 完成 OBS-06：可用的思考信息展示。优先 Electron，覆盖已提供内容折叠、未提供／不支持／不可展示的明确状态、统一脱敏及复制／导出权限，绝不伪造隐藏推理。默认离线，沿用验收与费用约束，不改 pi 配置、不额外调用模型、不制作安装包，网页版独立功能暂缓。完成测试和实际 Electron 验证，更新进度，并给出下一步提示词。当前连续五轮授权内继续推进。
