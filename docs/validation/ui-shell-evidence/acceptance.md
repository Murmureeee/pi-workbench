# Electron 控制栏、设置与 PRD 布局验证

2026-11-02。关联 UX-03 / UX-05 的部分实现与 OPS-08 回归；MODEL-01 保持已验收。用户要求参照所附 Codex Windows 截图调整布局，并同步可点击 PRD。未制作安装包；网页独立模型功能仍暂缓。

实际应用采用 40 px 桌面控制栏、原生 Windows 窗口按钮、48 px 导航轨道、内嵌圆角面板及统一设置。设置左侧分类与搜索、右侧限宽正文独立滚动，窄窗可达；主题跨页同步，返回保留工作台草稿和审查上下文。原有敏感页面继续配对，模型目录只读，renderer 未获得通用 IPC 或配置写入权限。

## 命令与来源

| 检查 | 实际结果与证据 |
| --- | --- |
| `pnpm fix`、`pnpm run ci` | 退出 0；155 项 Vitest / 17 文件、35 项浏览器与 Electron E2E、SDK 冒烟通过，见 [ci.log](ci.log)。 |
| `pnpm verify:clean` | 退出 0；新目录 frozen 安装、check、build、155 项测试、SDK 冒烟及服务启动 / 退出通过，见 [结果](clean-workspace.json)、[命令输出](clean-commands.json)、[入口输出](clean.log)。 |
| 锁文件 | 主目录与干净副本 SHA-256 均为 `d9d46d301907ef4d86e5c53de3eca57433f5978ebf1e6547f8d094f50a60b40a`。安装下载数 0，未替换系统 Node。 |
| PRD 交互 | 本机 Chrome / Playwright、1920×1080 与 390px；五类设置、搜索空态、子对话框、返回草稿 / 阅读 / 工具展开 / 审查、键盘、主题和三种评审视图通过。无页面错误或外部请求，见 [prd-layout.json](prd-layout.json)。 |
| Windows Electron | 使用实际 `scripts/dev.mjs --desktop`、sandbox preload、私有宿主配对与真实本机 HTTP，由 Sky 操作原生菜单 / 快捷键 / 主题 / 窗口按钮；见 [native-validation.json](native-validation.json)。 |
| 最终文档回填 | `pnpm docs:build`、`pnpm fix`、`pnpm check` 退出 0，见 [最终 fix](final-fix.log)与[最终 check](final-check.log)。PRD 检查记录中的 revision 与最终生成页一致。 |

CI 使用固定 SDK 录制、真实 pi 1.4.0 SDK + 本地模型夹具、合成配置 / 凭证及明确的故障注入；普通工作台仍为标明来源的 fake 样本。PRD 是独立静态模拟，不调用 daemon。真实 Windows 操作没有连接 PIW_PI_AGENT_DIR，只显示未连接配置 / 未联网验证。新增真实提供商请求 **0**；canonical 预算和固定录制未改。

clean 工具保留 OPS-01 报告标识，E2E 在主工作区完整 CI 中执行。产品 CI / clean 通过后只有 PRD 模板、文档与进度回填；最终另行生成文档并运行 fix / 完整 check，不将其称为重跑产品 CI。构建仍有 Vite 主 chunk 大于 500 kB 的体积提示，构建成功，未放宽门禁。

## 截图与实际边界

- [Electron 1080p 明色 renderer](settings-electron-light.png)、[800px 深色 renderer](settings-electron-dark-800.png)、[390px 分类布局](settings-narrow.png)来自实际运行应用。Playwright 页面截图不包含原生 caption buttons。
- [Windows 最大化明色](native-settings-maximized.jpg)、[Windows 深色](native-settings-dark.jpg)由 Sky 捕获实际窗口，包含原生按钮。
- [PRD 1080p 明色](prd-settings-light.png)、[PRD 390px 深色](prd-settings-dark-narrow.png)、[PRD 对照视图](prd-settings-compare.png)只证明原型布局 / 交互，不证明真实业务完成。

原生文件菜单、Ctrl+逗号、明暗、最大化 / 还原、标题栏空白双击、最小化 / 恢复及 × 后服务继续运行已实际观察。显式文件菜单“退出应用”使开发启动器退出 0、释放 5173 / 4317，原有 8765 文档服务保留。Sky 拖动未观察到位置变化，真实拖动仍待人工确认；托盘菜单没有可供自动化选取的目标，未完成实际托盘菜单恢复。恢复另由 Electron E2E 的真实窗口关闭 / activate 事件覆盖。没有把自动化限制记为人工通过，也没有改变 Windows 设置或操作用户的真实凭证。

真实中文输入法手动验收未执行；合成 composition Enter 未发送、Shift Enter 与键盘回归通过。系统主题实时切换通过 Electron nativeTheme 信号与浏览器媒体信号验证，不等于切换 Windows 系统设置的人工测试。完整字号 / 密度、真实多窗口 / 深链接、真实会话 / 审批 / 终端退出等仍未验收，UX-03 / UX-05 和 OPS-08 保持进行中；已验收数由 backlog 计算，仍为 13 / 133，M8 另列。

临时目录清理被自动审批审查拒绝，批量命令与已核对绝对路径的单目录命令都只返回 `blocked by policy`。干净副本 `D:\Project\.piw-clean-LLmayq` 与本轮 `.workbench` 临时样本 / 日志保留；已确认无对应运行进程。正式证据已独立归档，本任务产品服务已退出。未改用其他工具绕过删除限制。
