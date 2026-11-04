# OBS-04：滚动跟随与新消息提醒

两项验收已通过，状态为 verified。本轮为连续三轮的第三项：WS-07 → OBS-01 → OBS-04；后续提示词只交付，不继续执行第四项。当前本地进度从 backlog 计算为 **26 / 133**，OPS-08 继续 in_progress。

## 验收对应与实现

| 验收项 | 实现与验证 |
| --- | --- |
| 回看不被流式强拉，切换／分页／卸载恢复 | 移除真实会话行的强制 scrollAnchor；沿用官方 MessageScroller，消息 ID＋像素偏移为主、scrollTop 后备；按分页 cursor 保存独立书签和最多 100 层返回栈。实际慢速 SSE、四会话／最多 3 视图淘汰、renderer reload、分页较新／较早与锚点偏移均由 Electron E2E 验证。原生回看第 115–120 段保持不动；淘汰后恢复同一段，历史较早页第 108 条在往返后保持可见位置。 |
| 计数、返回最新、长文与后台不抢焦点 | 最近 100 个提交、最多 200 个用户／助手指纹，不保存正文；同一回复的多个 delta 只算一条，首次发现历史不算新消息。活动有焦点且实际读到最新才更新窗口阅读基线，与 daemon 会话未读分开。显式点击或键盘激活才聚焦消息区并恢复跟随。原生 2／1／3 条计数、Shift+Tab／Enter 返回最新、历史 Tab／Enter 返回本页末尾；长文展开／收起、后台同 PID／epoch、当前面板与草稿保持均有证据。 |

关键文件：[ManagedThread](../../../apps/web/src/features/conversation/managed-thread.tsx)、[阅读书签](../../../apps/web/src/features/conversation/remembered-viewport.tsx)、[显式返回](../../../apps/web/src/features/conversation/latest-messages-button.tsx)、[历史分页](../../../apps/web/src/features/conversation/session-history.tsx)、[窗口视图契约](../../../packages/shared/src/session-contracts.ts)。兼容旧 sessionStorage 默认值，无数据库迁移；正文／执行仍归 daemon／SDK，切换与卸载不停止后台任务。

显式展开、收起或格式切换临时保持当前消息锚点与偏移，ResizeObserver 等待全文／惰性 Markdown 布局；用户滚动／触摸／键盘操作接管，显式返回解除保持。收起长文时限制过大的负偏移，避免全文末尾偏移形成空白。纯文本与 Markdown 布局不同，不承诺字符级位置完全一致。

## 自动门禁与修复证据

- pnpm fix、[完整 pnpm run ci](ci.log) 退出 0：**31 个测试文件／240 项 Vitest、90 项浏览器及 Electron E2E**；SDK 冒烟为真实 SDK＋本地 HTTP，2 次本地请求、真实提供商 0、blockedNetworkAttempts 0。
- [pnpm verify:clean](clean-workspace.json) 和[完整命令输出](clean-commands.json)退出 0：frozen 安装、check、构建、240 项测试、SDK 冒烟、服务健康和正常关闭。clean 不再重复 E2E；完整 E2E 已由主 CI 执行。原／clean 锁文件 SHA-256 均为 197aab68d34cad0c7e4956a63ff84bb088b9544d33885aa902e8443308047f5c。
- 新增[两项指纹单测](../../../apps/web/src/features/conversation/message-updates.test.ts)与[四项实际 Electron 流程](../../../e2e/scroll-reading.spec.ts)。[12 项定向](targeted-final.log)通过；随后新增收起后可见性断言，[修前失败](collapse-before.log)／[修后通过](collapse-after.log)，最终完整 CI 已包含该断言。
- 临时重新加入强制 scrollAnchor 的[反向控制](anchor-negative-control.log)按预期失败；源文件在 finally 按字节还原，最终完整 CI 通过。首次导出 helper 的私有 app 推断触发 TS2883，[失败日志](ci-before-helper-type.log)保留；改为仅返回公开服务，没有降低类型检查。
- 原生后[304 文件复用审计](code-reuse-audit.json)的 differences／cleanOnly 均为空；按用户要求复用上述 CI／clean。只更新证据、需求和文档，另运行 docs:build、fix、check；最终输出见[文档检查](docs-check.log)。

## Windows 原生与样本来源

[原生汇总](native-validation.json)、[60 条归档观察索引](native-observations.json)和 native 内逐步 UIA／精选原始截图，与 Playwright 的 Electron 自动验证分开。原生捕获实际为 JPEG，按文件签名归档为 .jpg 并保留字节；自动截图为 PNG。实际窗口由 @oai/sky SendInput 操作，没有 CDP 或 renderer route；宿主使用真实 daemon／SQLite／SDK 和固定本地慢速 SSE，工具／扩展禁用。种子 4 次本地任务，UI 明确发送 2 次慢流，全部 completed；真实提供商 0。两次正常菜单退出见[首次关闭](native/first-closed.json)与[同 data/profile 重启关闭](native/restart-closed.json)。重启 0 prompt／0 内核，所有历史 SHA-256 与重启前相同，pi auth/models/settings、canonical 预算和锁哈希未变。后台切换前后 PID **22324** 与 epoch 相同。

原生宿主的[源文件副本](native-host.mjs)保留原导入关系；本次从仓库根运行 `pnpm exec node .workbench/obs04-native.mjs`，重启时追加原隔离目录参数。复现时先将副本放回 `.workbench/obs04-native.mjs`，确认端口归属后再启动；该脚本不修改用户 pi 配置。文件类型、受保护文件、进度和证据范围的最终核对见[本地复核](final-review.json)。

分页的 210 条文件行是在 SDK 停止后显式追加的合成历史样本，不是 SDK 输出；修改后旧受管轮次的观察绑定可诊断不一致，分页验证使用专用只读历史入口。审批为实际 TCP 观察中的合成 approval.requested，只验证后台不抢焦点／会话／面板；不代表生产工具或审批已经接入。原生文字是 literal SendInput，不额外宣称真实 IME 厂商验收；既有 IME 回归仍包含在完整 CI。

最初一次截图被其他程序遮挡，另一次切换截图尚未稳定，二者不归档、不计通过；部分即时 UIA 也存在延迟，以后续 settled 和稳定截图确认。首次边框拖动只选择了正文，未缩窗，不计通过；随后系统窗口菜单的大小操作实际产生 **802×961** 原生截图，明暗及键盘均在该尺寸核对。最大化原生截图为 **1920×1032**，不称为 1920×1080 全屏。自动流程截图为[1440×960 明色](scroll-reading-light.png)和[800×760 暗色](scroll-reading-dark-800.png)。完整 CI 同时覆盖 OBS-01 的 1920×1080 共享消息流程。

书签范围为本窗口 sessionStorage，支持切换、淘汰和 renderer 刷新；完整应用重启／跨窗口不承诺草稿或阅读位置保存，本次重启只验证历史持久和不重发。新计数仅覆盖受管对话中最近 100 个提交；完整历史使用分页查看。没有改 pi 配置／canonical 预算或扩大权限；未制作安装包，网页独立功能暂缓。

## 下一步提示词

完成 OBS-03：工具时间线与嵌套调用。优先 Electron，覆盖调用身份与参数／结果关联、拒绝／失败／取消／嵌套及乱序结果、脱敏长输出的展开或下载、文件／变更／命令／MCP 的可验证摘要和未知结构安全降级；缺失耗时／退出码明确未知，工具卡 Diff 不冒充可回滚账本。默认离线，沿用现有验收与费用约束，不改 pi 配置、不额外调用模型、不制作安装包，网页版独立功能暂缓。完成测试和实际 Electron 验证，更新进度并给我下一步提示词；原生控制等我明确允许，代码未改时复用已通过的 CI／clean。
