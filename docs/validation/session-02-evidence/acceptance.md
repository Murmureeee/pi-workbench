# SESSION-02 验收 · 2026-11-03

SESSION-02「恢复与切换会话」两项验收通过，前置 SESSION-01 / CORE-06 已验收。Electron 优先，默认离线，真实提供商传输与工具 / 扩展继续关闭；新增真实提供商请求 **0**，canonical 预算和 pi 配置未修改，未制作安装包。网页版独立功能继续暂缓。

## 逐项结果

| 验收 | 实现与验证 |
| --- | --- |
| 切换仅改变查看对象，后台运行 / 审批可找到且不抢焦点；独立草稿、阅读锚点 / 偏移、工具展开和面板，最多 3 视图；迟到隔离和订阅清理 | 每窗口小型视图书签与草稿分开保存；MRU 保留最多 3 个 pane，新会话草稿也占一个视图。MessageScroller 公共滚动 API 还原首个可见消息及像素偏移，隐藏几何不覆盖书签。侧栏读取 daemon 的运行 / 待审批 / held 索引。四会话轮换、缓存淘汰、甲乙独立草稿、阅读位置、工具展开和所选变更引用经实际 Electron 回归；A → B → A 延迟旧请求不覆盖新对象。原生 Windows 操作另确认阅读中段、草稿及深色设置返回。 |
| 重连 / 卸载恢复位置和最新权威状态，不重复启动任务；后台更新不换面板；旧 pi 历史只读发现和并发诊断 | 卸载只断开观察与释放查询，后台内核由 daemon 保有；重开获取 CORE-05 快照及 CORE-06 历史。实际 SDK 本地 hold 请求经淘汰、TCP WS 重连和 renderer reload 保持同一 PID / 轮次，无二次 prompt，显式停止才 abort。旧历史使用实际文件 / descriptor 的有界稳定快照与版本绑定分页 / 全文；CLI 同写或替换拒绝混合快照，半行待刷新、损坏可诊断，源文件 / DB / 内核数量不变。 |

## 实现与来源

- `apps/web/src/stores/session-views.ts`、`features/conversation/remembered-viewport.tsx`、`session-workbench.tsx`、`managed-thread.tsx`、`session-history.tsx`：视图与权威执行状态独立；查询绑定 session / 对象 / cursor / 请求代际，监听由所属视图清理。
- `apps/daemon/src/modules/sessions/session.store.ts` 与 `session-command.transport.ts`：只读活动索引；不是第二套执行权威，不扫描正文或启动内核。
- `legacy-history.service.ts`、shared `legacy-history-contracts.ts`、web `legacy-history.tsx`：显式 `PIW_PI_AGENT_DIR/sessions` 来源，SEC-08 + desktop-only HTTP；默认关闭，客户端不能传任意路径。拒绝链接、不兼容 v1 / v2 不迁移，不调用 SDK SessionManager，不修改配置 / 历史 / 授权或创建会话。
- 实际 SDK / HTTP / SQLite / TCP WS / Electron 是真实运行；模型是本地 HTTP 夹具。工具、待审批、队列和变更引用用明确标记的合成记录验证恢复；延迟和断线是故障注入，旧 CLI 文件是合成 v3 JSONL。这些证据不代表生产文件 / Diff、审批执行、回滚或旧历史续聊已经交付。

## 命令与证据

| 检查 | 结果与证据 |
| --- | --- |
| `pnpm fix`、`pnpm run ci` | 退出 0；19 文件 / **170 项 Vitest**、SDK 本地流式 / 中止 / dispose、**44 项浏览器 / Electron E2E** 全过。[初次完整输出](ci.log)、[标题状态布局与草稿回执隔离修改后最终输出](ci-final.log)。其中 SESSION-02 新增 5 项实际文件 / HTTP / SQLite 服务测试、1 项不可信历史循环 parent 防护测试及 4 项 Electron 流程。 |
| `pnpm verify:clean` | 退出 0；新目录 frozen 安装、check、build、170 项测试、SDK 冒烟及 daemon / Vite 启停通过；源与新目录锁 SHA-256 一致。[结果](clean-workspace.json)、[逐命令输出](clean-commands.json)、[启动日志](clean.log)。报告工具沿用 OPS-01 标识；源码复制发生在标题状态布局、草稿回执隔离修正及文档回填前，依赖 / 原生模块 / 构建与服务启停配置未变，复用其基础设施证据，不将该副本称为最终源码。E2E 在主工作区完整 CI 执行。 |
| 原生 Windows Electron | 未拦截 HTTP / WS / 系统对话框的 main / preload / 宿主配对实际运行，使用隔离数据根与合成旧历史。[操作记录](native-validation.json)、[最终审计](native-final-audit.json)。后台任务淘汰前 / 后 / 重开分别见 [before](native-running-before.json)、[evicted](native-running-evicted.json)、[reopened](native-running-reopened.json)。 |
| 文档与进度回填 | 随本次交付运行 `pnpm docs:build`、`pnpm docs:check`、`pnpm fix`，输出另存 [docs-final.log](docs-final.log)；最终完整 CI 中的 `pnpm check` 同时覆盖生成文档及进度校验。 |

阅读恢复回归最初发现直接写 scrollTop 会被 MessageScroller 的锚点模式拉回，并存在 36px content padding 偏移；修复使用公共 scrollToMessage 并扣除 padding。最终 Electron 回归比对消息身份、offset 与 900px 位置，淘汰 / 设置返回 / reload 后一致，见 [书签状态](session-reading-state.json)。

收尾复核发现长标题会将“运行中”挤出侧栏按钮；增加实际 Electron 几何可见性回归，[修复前失败](sidebar-before.log)、[修复后通过](sidebar-after.log)。标题改为独立可缩略文本，状态不收缩，见[最终侧栏截图](session-background-sidebar.png)。该修正晚于原生操作记录，由最终实际 Electron E2E 及完整 CI 补验。

旧草稿视图被淘汰后，新视图沿用同一草稿键，旧目录校验回执可能覆盖新目录；实际 Electron 先复现[旧回执覆盖新选择](directory-before.log)，再[通过隔离回归](directory-after.log)。卸载时同步失效原 pane 的展示请求身份，目录 / 项目选择还核对原草稿配置；已接受的后台任务和原请求核对不受影响。该场景合并到既有迟到用例，测试总数不变；最终完整 CI 同时验证标题与回执修正，[标题修正阶段的完整 CI](ci-sidebar.log)另保留。

目视复核：[原生切换前](native-reading-before.jpg)、[淘汰后恢复](native-reading-restored.jpg)、[深色设置返回](native-settings-return-dark.jpg)、[后台任务重开](native-background-recovered.jpg)、[旧历史只读与半行](native-legacy-readonly.jpg)、[旧历史早页](native-legacy-earlier.jpg)，以及自动 Electron 的 [明色](session-switch-restored-light.png)、[深色](session-switch-restored-dark.png)、[800px 窄窗](session-switch-dark-800.png)与[旧历史](session-legacy-readonly.png)。原生窗口覆盖 1440×960 与 1920px 最大化工作区；1920×1080 / 800px 明暗和控制台错误检查由实际 Electron E2E 补齐。

## 限制及证据问题

视图书签只存面板、分页、展开 ID、变更引用与阅读位置；消息正文、队列 / 执行状态及授权仍由 daemon / SDK 保有。sessionStorage 支持本窗口刷新和视图卸载恢复；不承诺关闭整个应用后恢复草稿或跨窗口同步。daemon 重启继续按 CORE-06 / SESSION-01 标记中断，不自动重发或恢复授权。

旧历史初始最多检查 2000 目录项、展示 200 文件，单文件 16 MiB，首行 64 KiB；支持 v3，只显示最新叶子分支；100 消息 / 页、64 KiB UTF-8 预览及按版本全文，统一 SEC-06 脱敏。超限 / 不兼容来源明确诊断并保留原件；未开放任意目录选择、自动监控或续聊。未指定来源时不猜测用户默认 pi 路径。

本次未改变组合态发送处理，复用 [SESSION-01 的真实 Windows 微软拼音证据](../session-01-evidence/acceptance.md)；CI 中程序生成的 composition 事件与本次 UIA 字面草稿输入均不称为新一次真实输入法验收。

原生验收临时宿主在应用菜单退出、Vite / daemon 关闭后又调用了一次 store 审计，因数据库已关闭而退出 1，见 [原始日志](native-host.log)。关闭前最终审计已保留，所有自有 PID 和活动端口连接均消失；该报错属于验收脚本收尾，不记为脚本成功。服务正常启停另由完整 CI 和本次 clean 的退出 0 证明；不覆盖或隐藏失败日志。

SESSION-02 标为 verified；OPS-08 保持 in_progress / `[true, false]`。OBS-04 / UX / FILE / CHANGE 等只记录本次支撑能力，不提前整条验收。下一项为 SESSION-03「会话列表、置顶、未读与归档」。

最终[只读复核记录](final-review.json)确认仅 SESSION-02 / OPS-08 进度变化，所有功能定义、依赖、负责人及目标日期保留；本地已验收 15 / 133，预算 / 锁文件未改，原生三次后台审计同 PID / epoch、原旧历史 SHA-256 一致。
