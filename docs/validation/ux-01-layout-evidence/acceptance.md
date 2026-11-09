# UX-01 首批工作包：工作台信息层级与默认布局整理

日期：2026-11-09。主归 UX-01 / M4，配套 UX-03；完整分屏、可调面板及 PTY 布局恢复不在本次范围。保留原功能 ID、里程碑、依赖与验收项。

## 范围与来源

现有 Electron / React 工作台整理，数据继续来自原 daemon / SDK 观察。环境与配置默认收起，正常元数据合并，文件与变更保留入口；异常、审批、停止与风险信息不以详情折叠隐藏。新书签仅保存当前窗口展示状态，旧书签默认兼容。

## 已实现的行为

- “环境与权限”和“会话配置”默认收起；新会话显示项目／模型／思考摘要，已有会话保留当前模型及待生效状态，创建配置按需核对。
- 文件浏览与轮次文件版本保持直接入口；Git、资源信任和正常目录占用按需查看。设置常驻，旧 pi 历史、模型目录和离线样本移入“更多入口”。
- 底栏集中显示离线来源及真实传输关闭，展开可核对 SDK／HTTP 夹具、费用未知与能力边界。合成观察仍有独立来源标记。
- 审批、停止、目录失效、观察失败、竞争排队、隔离、来源不确定与文件版本失败保持可达；目录恢复反馈与版本详情分别滚动，打开长详情不会把故障提示推到视野外。
- 展开状态复用本窗口的会话书签，兼容旧值；不改变 daemon、执行守卫、原 cwd、模型选择、草稿、审批或后台生命周期。

## 最终验证

`pnpm fix` 后以以下环境执行完整 `pnpm run ci`，退出 0：check、63 文件／426 项 Vitest、真实 SDK 子进程本地夹具冒烟、构建以及全部 159 项浏览器／Electron E2E 通过。完整窗口阶段耗时 21.5 分钟。原始输出见 [最终 CI](logs/ci-accepted.log) 与 [格式整理](logs/fix-accepted.log)。前两轮 CI 窗口结果分别为 151／159 和 158／159，失败与修正完整保留。

```powershell
$env:VITEST_MAX_WORKERS='4'
$env:PIW_EVIDENCE_DIR='D:\Project\pi-workbench\.workbench\ux-01-layout\ci-accepted-screenshots'
pnpm run ci
```

新增 3 项实际 Electron 流程覆盖默认收起／键盘／合成 composition／设置返回、1920×1080 明色与 800×760 暗色、4 会话视图淘汰／renderer reload 的草稿与展开隔离、后台同 PID／epoch／cwd 且不重发、真实 SDK 本地夹具最终审批、拒绝、文件浏览／历史审查以及收起环境时的目录状态失败；定向 3 项全部通过。合成 composition 的 Enter 在 Chromium 中产生换行，不能冒充真实输入法候选确认。

原生前后 [447 项门禁输入](gate-inputs-accepted.json) 的 SHA-256 全部一致，之后只更新需求／证据文档并运行文档生成、`pnpm fix` 和 `pnpm check`，复用这次完整 CI。未变更工程、依赖、运行时或构建配置，本轮未运行 `pnpm verify:clean`，不声称新增 frozen 安装证据。

精选 [1920×1080 明色首屏](screenshots/layout-new-light-1920.png)、[800×760 暗色首屏](screenshots/layout-new-dark-800.png)、[最终参数审批](screenshots/layout-approval-light-1920.png)、[目录故障仍可见](screenshots/layout-recovery-light-1920.png) 和 [历史审查入口](screenshots/layout-review-light-1920.png)。审查截图处于历史版本／容量加载中，只证明面板打开；完整 Diff 功能依据本次套件中既有 CHANGE／FILE 回归，不把该截图当作已加载的 Diff。

## Windows 原生观察

用户明确授权自动回归和原生隔离窗口检查后，使用 Computer Use 的 `@oai/sky` 操作实际 Electron main／preload、私有 IPC 配对、daemon 和已安装 SDK；仅本地 HTTP `reply` 夹具，无 CDP、renderer 注入或原生对话框替代。分别以 `pnpm exec node .workbench/ux-01-layout/native.mjs` 和同路径 `--restart` 启动；复用隔离 data/profile，不调用真实提供商。

[步骤记录](native/steps.jsonl) 共 57 条，包含中间态和两次退出请求。其中第 01 条被无关窗口遮挡，图片已删除，归档省略其 UI 内容，仅保留排除说明。其余截图为实际产品窗口；归档仅保留精选图片，记录标明未归档图片，不补造缺失帧。

| 步骤 | 观察及证据 |
| --- | --- |
| 02–07 | 浅色 1442×962 默认首屏，配置／环境仍可展开，实际 Space 关闭环境；见[首屏](native/screenshots/02-active-initial.png)。 |
| 08–16 | 焦点位于任务输入框，实际 OS 拼音候选可见。Enter 关闭候选并保留 `ni`，Escape 取消候选，Space 选词产生 `ni你`，全部零发送；见[候选](native/screenshots/10-ime-ni.png)、[Enter 后](native/screenshots/11-ime-enter-no-submit.png)、[Escape 后](native/screenshots/13-ime-escape-no-submit.png)与[空格选词](native/screenshots/15-ime-space-committed.png)。本轮未独立重查 IME 厂商。 |
| 17–24 | 后续两行中文草稿通过 Unicode 字面输入、实际 Shift+Enter 换行，不能全算作拼音输入证据；Ctrl+逗号进入设置，改深色再返回，草稿保留、环境与配置收起；见[草稿及换行](native/screenshots/19-second-line.png)、[深色返回](native/screenshots/24-return-settled.png)。 |
| 25–29 | “更多入口”保留旧 pi 历史／模型与提供商／离线样本；底栏可展开核对来源、费用未知和能力边界；见[更多入口](native/screenshots/25-more-open.png)、[来源详情](native/screenshots/28-source-open.png)。 |
| 30–40 | 用实际边框拖动到 802×762 外尺寸，深色默认输入与发送在视野内；环境与完整配置都可展开。主动展开完整配置时使用输入区内部滚动到达发送，收起后恢复默认布局；见[深色窄窗](native/screenshots/30-narrow-dark.png)、[环境](native/screenshots/32-narrow-environment-settled.png)、[内部滚动到底](native/screenshots/35-narrow-configuration-bottom.png)及[收起](native/screenshots/40-configuration-coordinate-close.png)。第 37 条索引点击未形成关闭结果，第 39 条重新观察后通过坐标操作第 40 条关闭，不将未生效点击记为成功。 |
| 41–50 | 同一窄窗改浅色再返回，两行草稿仍在，点击发送一次，真实 SDK 本地夹具回复 `OFFLINE_OK`，实际新增发送 1、自动重试 0。独立 cwd 在隔离 data/standalone 内，写入前／收尾版本被私有数据目录保护拒绝；本轮无工具调用，文本轮次成功。失败徽标在环境收起时仍显示，展开详情明确“不能采集工作台私有数据目录”，未补造快照；见[浅色草稿](native/screenshots/45-light-return-settled.png)、[回复及失败徽标](native/screenshots/47-local-result.png)和[版本详情](native/screenshots/48-version-diagnostic.png)。原因全文见第 49 条记录。这不作为版本保存／原生 Diff 成功证据，本轮没有修改这项保护或其目录策略。 |
| 51–57 | 两次均用“文件 → 退出应用”，Electron 和宿主各退出 0。同 data/profile 重启保持浅色，已保存会话可只读打开；新增发送 0、内核 0、待审批 0，原生 JSONL SHA-256 不变；见[重启首屏](native/screenshots/53-restart-initial.png)与[历史回复](native/screenshots/55-restart-history-settled.png)。完整应用重启不承诺恢复未发送草稿或窗口书签。 |

[第一次退出审计](native/first-closed.json)、[重启退出审计](native/restart-closed.json)保存实际来源、退出状态、请求计数和哈希；不归档运行数据库、profile 或凭证内容。两个审计中的内核列表是各自退出前状态：第一次有已结束的 ready 内核，重启零内核。进程退出和最后 5173／4317／4318 无活跃归属另经命令行确认，不能把退出前快照冒充退出后状态。

## 发现与修正

1. 完整 Vitest 最初两次把复用的 Windows PID 误判为原故障子进程仍存活。测试改为比较 PID 与 OS 创建时间，实际原进程未退出仍失败，生产内核未改。7 项故障表定向通过；之后完整 426 项通过。
2. 默认高并发完整测试另出现一次 CHANGE-01 SDK 审批等待超时；以 `--maxWorkers=4` 完整执行 426 项通过，最终 CI 用已安装 Vitest 支持的 `VITEST_MAX_WORKERS=4`，没有跳过用例或修改仓库并发配置。
3. 新界面测试首轮 2／3：合成 composition 的换行预期有误，按既有 INPUT-01 的合成事件行为修正，未改变产品输入处理。
4. 截图复核发现长版本详情可能遮住目录错误。新增 `toBeInViewport` 修复前失败（viewport ratio 0），把恢复反馈移出详情滚动区域后 3 项全部通过。
5. 完整 CI 的进程身份查询在已退出进程的 StartTime 为空时有 PowerShell 诊断，426 项仍通过；补充空值守卫，后续两轮完整 426 项均已覆盖并通过。
6. 首次完整 CI 窗口阶段 151／159：7 项旧测试先读取了默认收起的详情，已补正常展开操作；另 1 项实际窄窗缺陷为展开环境与故障反馈叠加后发送按钮出屏。增加共同高度上限、内部滚动并优先显示目录故障，修正后新增布局与全部工作区恢复共 7 项通过；最终完整 159 项也通过。
7. 第二轮完整 CI 窗口阶段 158／159：思考卡片在窄窗 resize 后的程序滚动与既有展开阅读书签恢复竞争。临时加入祖先几何和失败截图，原测试重复三次为 2 通过／1 失败；失败时卡片标题 y=439.875，阅读区 y=162.1875、高 250.625、scrollTop=0。测试补实际阅读区 Home 键操作，明确释放阅读书签后再定位；保留 `toBeInViewport`，不改产品阅读策略。移除临时诊断代码后，两项思考流程各重复三次，6／6 通过。

原始日志位于 [logs](logs/)，包括完整 Vitest 的早期失败、限并发完整通过、前两轮失败 CI、最终通过 CI、目录故障修复前后和思考定位诊断／重复验证。最终候选使用 `VITEST_MAX_WORKERS=4 pnpm run ci`，不改仓库并发配置；完整套件没有过滤或跳过用例。定向命令按文件或名称选择用例，仅作为复现和修复证据，不计为完整门禁。

## 状态与限制

UX-01 仅第三项“现有工作台默认布局”勾选，整体继续 `in_progress`，完整分屏、可调面板和终端布局恢复保留前两项验收及原依赖。UX-03 的两项继续未勾选，完整字号／密度配置和全部放大场景仍未交付。当前本地 verified 50／133，从 canonical backlog 计算；本轮不增加整功能完成数，OPS-08 继续 `in_progress`。

真实提供商请求 0、传输保持关闭；pi 配置、canonical 预算与锁文件的 5 项 SHA-256 不变。没有修改数据库迁移或执行权限，没有制作安装包；截至界面验收结束尚未提交或推送，后续提交与推送状态以 Git 记录为准。网页独立业务继续暂缓。

下一步推荐顺序为 UX-05 → EXEC-01 → UX-01 完整布局。已核对 UX-05 的 CORE-05／CORE-06 依赖均 verified；EXEC-01 还依赖 UX-05，不能跳过其验收。可直接发送：

> 继续 UX-05：补齐多窗口、深链接和退出生命周期，沿用现有验收与离线费用约束，窗口操作放在命令行验证之后。
