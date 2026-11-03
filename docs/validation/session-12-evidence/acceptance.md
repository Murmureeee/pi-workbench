# SESSION-12 基础会话搜索与项目筛选

状态：**verified**，三项验收通过。日期：2026-11-04。依赖 SESSION-02、WS-06、SEC-06 均已验收；canonical backlog 本地 **20 / 133**，OPS-08 继续 `in_progress`，生产业务审批 / 双端审批、M3 回滚及后续平台门禁仍待实现。独立网页功能暂缓，无安装包，真实提供商新增请求 **0**。

## 实现与逐项验收

| 验收 | 结果与证据 |
| --- | --- |
| 中文标题 / 用户 / 助手正文、全部 / 指定 / 无项目、归档与原消息定位 | 通过。Electron 侧栏或 Ctrl+K 打开共用搜索 Dialog；默认全部项目且不含归档，可包含或仅看归档。标题打开最新对话；正文按原 epoch / 消息 ID 读取所在历史页并高亮，失效目标明确报错。132 条合成历史的 entry-4 / entry-5 位于默认最新 100 条之外，实际 Electron 自动与原生操作均可见目标。 |
| 分页归属 / 时间 / 脱敏片段、200ms 防抖、迟到隔离与键盘 | 通过。20 会话 / 页，按最近任务活动时间降序、同毫秒按稳定 ID；本地日期含当日起止边界。每会话一个结果，标题优先，否则取最新正文命中。查询及筛选 200ms 防抖；条件 / 页码、AbortSignal 与 Dialog 生命周期隔离 A→B→A 和关闭后的回执，新条件立即隐藏旧结果。↑↓ 选择、Enter 打开、Escape 关闭；真实微软拼音候选 Enter / Escape / 数字及 Space 选词与合成 composition 分开验证。 |
| 元数据及正文变化后的索引更新、空查询 / 空态、不启动运行 | 通过。重命名、归属、归档及状态读取各自权威服务；受管记录移除清理派生正文。首发 / 续发、凭证脱敏登记及历史版本变化更新索引；重启首次搜索重建，历史缺失清旧片段并提示诊断。空查询显示最近、无结果可清除、失败保留条件且不自动重试。搜索 UI prompt 计数始终 0；真实 SDK 本地后台任务经搜索切换保持同 PID / epoch。主动移入移出与删除的产品入口尚未交付，明确 SQLite 夹具只验证搜索消费更新，不提前验收 SESSION-13 或删除能力。 |

Unicode 查询按 NFKC / 小写作字面匹配，最多 160 个码点，不作为 SQL / FTS 表达式。完整正文先经 SEC-06 脱敏，再索引、匹配及生成至多 180 码点的片段（另含首尾省略号）。只索引用户 / 助手正文，不含工具、文件或旧 CLI 历史。普通诊断不记录原始查询；查询只在当前 Dialog 内存保存，不写浏览器存储。

0009 迁移增加可重建的 SQLite 搜索投影；原生 JSONL / 检查点保持权威原文，不把索引片段写回历史或模型。索引事务失败回滚，读取前后来源摘要变化时拒绝混合版本。`GET /api/chat/search` 仅接受已配对 desktop 身份。复用官方 Dialog / Field / Input / Button / Badge 及既有 MessageScroller，无新依赖或第二套传输。

## 自动门禁与复用

| 检查 | 实际结果 |
| --- | --- |
| `pnpm fix`、完整 `pnpm run ci` | 退出 0；**25 文件 / 209 项 Vitest、67 项浏览器 / Electron E2E**，SDK 本地 prompt / abort / dispose 通过。[完整 CI](ci-complete.log)。新增 [8 项服务测试](../../../apps/daemon/test/session-search.test.ts)及 [4 项实际 Electron 流程](../../../e2e/session-search.spec.ts)，纳入 test:contracts 和完整门禁。 |
| `pnpm verify:clean` | 退出 0；新目录 frozen 安装、check、build、209 项测试、SDK 冒烟、HTTP 健康和正常服务退出；锁 SHA-256 一致，无新依赖。[结果](clean-workspace.json)、[逐命令输出](clean-commands.json)、[日志](clean.log)。报告沿用工具 OPS-01 标识；clean 不另跑 E2E，完整 E2E 已在主 CI 执行。 |
| 原生验收后代码一致性 | [270 文件 SHA-256 审计](native-code-reuse-audit.json)无差异，覆盖 apps / packages / scripts / e2e 及根工具配置，与成功 clean 输入相同；复用该 CI / clean，后续只更新文档 / 进度 / 证据。审计脚本见 [native-code-reuse.mjs](native-code-reuse.mjs)。 |
| 最终文档与进度 | `pnpm docs:build` 重建看板 / PRD / 清单，再 `pnpm fix`、完整 `pnpm check`；[生成日志](docs-build-final.log)、[最终 check 输出](check-final.log)。不手改生成页面。 |

历史定位起初虽加载正确页，却被默认滚动覆盖到最新，实际 viewport 断言[修复前失败](e2e-location-before.md)；改为定位页从起始位置加载并保留目标布局，同流程随后通过。首轮[工具类型检查失败](ci-before-types.log)和[旧迁移计数失败](ci-migration-before.log)均保留，最终完整 CI 已重新通过。早期另有一次 Electron 启动未出现页面，定向复测成功，未据此推断根因。

## Windows 原生 Electron

使用生产 main / sandbox preload / renderer、真实 Vite / daemon / SQLite、独立 data / profile；以 `@oai/sky` UIA / SendInput 操作真实窗口，无 CDP 或浏览器路由拦截。24 份历史是明确合成 v3 JSONL，另 1 份由真实 SDK + 本地 HTTP 夹具生成，不能据此声称真实提供商可用。[原生汇总](native-validation.json)、[41 条观察 / 41 张有效截图](native-observations.json)保留 UIA 文本与来源。

| 原生检查 | 观察与证据 |
| --- | --- |
| 首帧与 Ctrl+K | [首帧](native-02-0.png)、[搜索](native-04-0.png)显示实际项目 / 会话与最近列表。首次遮挡截图已弃用，不纳入有效截图。 |
| 真实微软拼音 | [ni 候选](native-05-0.png)、[Enter 提交 ni 且不打开会话](native-06-0.png)、[m 候选](native-07-0.png)、[Escape 只取消候选](native-08-0.png)、[数字选词得到中并返回 23 项](native-09-0.png)、[Space 选你后中你空态](native-10-0.png)。候选中结果隐藏、等待输入完成；Enter 候选提交的是字面 ni，不冒称中文选词。 |
| 中文 / 同名项目 / 原消息 | [中文标题两项](native-11-0.png)、[指定项目](native-12-0.png)、[用户原消息 entry-4](native-14-0.png)、[助手原消息 entry-5](native-16-0.png)；目录与短 ID 区分同名项目。 |
| 分页 / 无项目 / 归档 / 日期 | [第二页余 4 项](native-17-0.png)、[无项目 22 项](native-18-0.png)、[仅归档](native-19-0.png)、[原生日期选择排除前日历史](native-20-0.png)、[清除回默认](native-21-0.png)。 |
| 脱敏与失败恢复 | [片段 api_key=&lt;redacted&gt;](native-22-0.png)、[失败保留条件](native-23-0.png)、[宿主恢复仍保留失败态](native-24-0.png)、[显式重试](native-25-0.png)。[停止轮询审计](native-error-no-retry.json)与[恢复但未重试审计](native-error-recovered-host.json)的搜索调用记录完全相同；故障由宿主 SearchService 夹具注入，无浏览器拦截。 |
| 改名索引 | 宿主经 SessionService CAS 改名后，[旧查询变空](native-26-0.png)、[新标题可搜](native-27-0.png)，会话 ID / 项目不变。这里是公开服务调用，另一个 Electron 客户端同步已由 SESSION-11 单独验收。 |
| 草稿 / 设置 / 明暗 / 尺寸 | [搜索后草稿](native-28-0.png)、[深色设置](native-29-0.png)、[返回仍保留草稿](native-30-0.png)、[原生 800 宽搜索](native-31-0.png)、[最大化](native-32-0.png)。原生外窗 802×961（客户宽 800），最大化工作区 1920×1032；自动截图另覆盖 [1920×1080 浅色](search-light-1920.png)与 [800 深色](search-dark-800.png)。不把 390px 请求冒充原生窗口验收。 |
| 真实后台状态 | [运行筛选](native-33-0.png)与[打开会话](native-34-0.png)对应同一真实 SDK 本地 hold；[搜索时审计](native-background-during-search.json)和[打开后审计](native-background-after-open.json)均 PID 38028 / 同 epoch。随后通过产品“停止本轮”明确中止，[结果更新为已停止](native-36-0.png)、[权威 stopped 审计](native-background-stopped.json)一致；该轮是显式本地夹具，不计真实提供商请求。 |
| 正常退出与同数据重启 | [退出前](native-37-0.png)、[文件菜单](native-38-0.png)，[首次正常关闭审计](native-first-menu-closed.json)确认 SDK 子进程退出；[重启首帧](native-39-0.png)、[人工标题](native-40-0.png)、[脱敏正文](native-41-0.png)可搜索。重启搜索前后 prompt 均 0、kernels 为空、历史哈希不变。[最终正常关闭](native-final-closed.json)、[首次资源释放](native-first-menu-exit-resources.json)与[最终资源释放](native-final-menu-exit-resources.json)确认进程及 5173 / 4317 活跃连接清空；[首次日志](native-resumed-host.log)和[重启日志](native-final-restart-host.log)均有 NATIVE_CLOSED_OK。 |

草稿按既有 SESSION-01 / 02 边界存于本窗口 sessionStorage：搜索、切换及设置返回保留，不承诺关闭整个应用后恢复未发送草稿。重启验证的是持久会话 / 项目 / 人工标题 / 正文索引与主题，没有扩大草稿承诺。初次草稿写入的即时截图尚未重绘，完整草稿以之后返回的截图为证。

历史[原生暂停记录](native-pending.json)及[强制夹具清理](native-fixture-cleanup.json)保留当时事实；用户随后“控制吧”恢复操作，当前状态由以上最终证据取代。原先两次窗口激活失败、强制清理和一次遮挡观察均不计正常退出或通过的产品行为。24 份合成历史始终字节不变；仅真实 SDK 留档因显式后台轮次发生正常历史写入。配置三文件与 canonical 预算哈希始终不变。

可从仓库根运行 `pnpm exec node docs/validation/session-12-evidence/native-host.mjs` 重建隔离夹具；启动前核对 5173 / 4317 归属，不能与现有开发服务并行。具体服务 / Electron 自动流程由上文测试复现；原生 SendInput 证据不能由合成事件替代。没有新增真实模型验收，生产工具 / 权限能力仍按后续条目实施。

## 下一步提示词

建议 WS-03，其前置 WS-01 已验收。SESSION-13 还依赖部分实现的 SESSION-07 与尚未开始的 SEC-03，不能直接整条验收。

> 完成 WS-03：工作区与 Git 环境标识。优先 Electron，持续显示真实 cwd、仓库及当前分支或 detached 状态，覆盖工作区／分支切换后的更新与迟到隔离、非 Git 目录、子模块和多个仓库；不显示虚构分支、不阻止基础对话、不隐式切换已有会话 cwd。默认离线，沿用现有验收与费用约束，不自动改 pi 配置、不额外调用模型、不制作安装包，网页版独立功能暂缓。完成测试并准备实际 Electron 验收；原生电脑控制等我明确允许后再进行。更新需求进度，并给我下一步提示词。
