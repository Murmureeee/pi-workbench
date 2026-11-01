# 高保真方向稿与截图

日期：2026-11-01。第 4 轮已确认组合布局和字号；核心状态继续细化，不是可用应用或产品验收证据。

预览：[可点击设计评审](../../review.html)。方向与主题可通过参数复现，例如 `?direction=hybrid&theme=dark&scene=review`。新默认方向为 hybrid；a / b 保留参考，主题为 system / light / dark；18 个状态名与行为见 [核心规格](../../core-spec.md)。前 8 张 A / B 截图保留为第 4 轮选型记录，新增 hybrid 截图是选定组合后的页面样本。

| 文件 | 尺寸 | 内容 |
| --- | --- | --- |
| [a-dark-review.png](a-dark-review.png) | 1920×1080 | A 对话优先，暗色审查 |
| [a-light-review.png](a-light-review.png) | 1920×1080 | A 对话优先，亮色审查 |
| [b-dark-review.png](b-dark-review.png) | 1920×1080 | B 审查聚焦，暗色审查 |
| [b-light-review.png](b-light-review.png) | 1920×1080 | B 审查聚焦，亮色审查 |
| [a-light-new.png](a-light-new.png) | 1920×1080 | 无项目新会话，首次发送前 |
| [a-dark-approval.png](a-dark-approval.png) | 1920×1080 | 无倒计时的执行前审批 |
| [a-theme-comparison.png](a-theme-comparison.png) | 1920×1080 | 相同 1440×900 内嵌画布的明暗对照 |
| [a-dark-narrow-approval.png](a-dark-narrow-approval.png) | 390×844 | 窄窗审批与输入布局 |
| [hybrid-dark-review.png](hybrid-dark-review.png) | 1920×1080 | 已确认组合，暗色宽审查 |
| [hybrid-dark-conflict.png](hybrid-dark-conflict.png) | 1920×1080 | 当前文件有外部编辑，暂停回滚 |
| [hybrid-dark-running.png](hybrid-dark-running.png) | 1920×1080 | 日常 A 对话 / 内联工具，无常驻审查栏 |
| [hybrid-light-new.png](hybrid-light-new.png) | 1920×1080 | 组合方案的新会话输入 |
| [hybrid-dark-approval.png](hybrid-dark-approval.png) | 1920×1080 | 当前步骤中的待审批 |
| [hybrid-light-settling.png](hybrid-light-settling.png) | 1920×1080 | 回复结束后仍在等待收尾 |
| [hybrid-light-review.png](hybrid-light-review.png) | 1920×1080 | 组合方案亮色宽审查 |
| [hybrid-theme-comparison.png](hybrid-theme-comparison.png) | 1920×1080 | 已确认组合的明暗并排对照 |
| [hybrid-dark-narrow-conflict.png](hybrid-dark-narrow-conflict.png) | 390×844 | 窄窗冲突说明与禁用回滚 |
| [hybrid-dark-permission-settings.png](hybrid-dark-permission-settings.png) | 1920×1080 | R6 默认权限、授权范围与审批等待 |
| [hybrid-dark-narrow-permission-settings.png](hybrid-dark-narrow-permission-settings.png) | 390×844 | 窄窗权限与可滚动分类 |
| [hybrid-dark-window-settings.png](hybrid-dark-window-settings.png) | 1920×1080 | 托盘 / 退出 / 独立服务 / 自启 |
| [hybrid-light-window-settings.png](hybrid-light-window-settings.png) | 1920×1080 | 同一窗口规则，浅色 |
| [hybrid-dark-narrow-window-settings.png](hybrid-dark-narrow-window-settings.png) | 390×844 | 窄窗窗口生命周期 |
| [hybrid-light-narrow-window-settings.png](hybrid-light-narrow-window-settings.png) | 390×844 | 窄窗生命周期，浅色 |
| [hybrid-dark-data-settings.png](hybrid-dark-data-settings.png) | 1920×1080 | R7 默认目录、旧历史只读、仅升级前自动备份 |
| [hybrid-light-data-settings.png](hybrid-light-data-settings.png) | 1920×1080 | 同一数据规则，浅色 |
| [hybrid-dark-legacy-history.png](hybrid-dark-legacy-history.png) | 1920×1080 | 独立旧历史只读入口，禁用续聊 |

截图由本机 Chrome / Playwright 实际渲染，没有用图像生成冒充交互。所有项目、消息、文件、测试输出与状态均为模拟；未读取模型凭证、执行命令或调用提供商。设计评审使用独立浏览器存储；不读写真实 pi 数据或需求看板进度。

R6–R8 新增 9 张，共 26 张。新截图等待有限入场动画完成后采集；初次捕获到动画起始透明帧的截图已重渲染替换，并目视检查权限、数据与窄窗生命周期。设置中的迁移、备份与退出只是流程说明，未执行真实系统操作。

本轮验证包括布局、系统主题变化、首次发送创建、草稿、中文输入法组合态、搜索、改名、项目归属与 cwd 分离、审批、队列与停止、逐文件接受 / 回滚、显式终端上下文与明暗对照。详见 [验证记录](../../verification.md)。这些只能证明列出的设计交互可操作，不能代替对应功能的真实服务 / SDK / 故障测试。
