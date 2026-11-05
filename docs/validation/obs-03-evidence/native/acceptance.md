# OBS-03 Windows 原生验收

用户在本轮明确允许电脑控制。使用真实 Windows SendInput／UIA 操作 Electron；宿主连接实际 daemon／SQLite／pi SDK 1.4.0 的本地 HTTP 夹具，未使用 CDP、renderer 路由拦截或 DOM 合成事件。所有工具卡是明确标记的合成观察，工具与扩展关闭，没有真实提供商请求。

原始 102 条观察见 [observations.json](observations.json)，编号保留操作和中间状态。截图是目标 Electron 窗口，不把立即返回的旧画面当作操作完成；下列采用后续稳定观察。

| 范围 | 实际观察与依据 |
| --- | --- |
| 调用关联与状态 | 02–11：read-child 的父调用、层级、cwd、最终参数、已完成结果一致；命令结果中的 exit0 文本不被猜成退出码。明确失败记录 12.5ms／退出码7；拒绝和取消有文字状态，Diff 标注仅观察、未关联回滚账本。 |
| 长输出与安全降级 | 13–21：16k 预览经原生点击展开到尾标，20 的末尾敏感测试值显示 «redacted»，21 收起没有大片空白。22–25：未知 JSON、script／img 标签为安全文本，缺父／循环有诊断，截断输出明确只展开已捕获内容、不读文件。 |
| 展开身份 | 36、42：甲会话旧轮 read 保持展开；下一轮同名调用及乙会话默认折叠，未串用调用 ID。 |
| 后台与焦点 | 48–54：乙明确重试后切甲，发布后台合成工具事件，甲输入仍可追加且不切页；[前](active-background-before.json)／[后](active-background-after.json)均为 PID19164、epoch f5b127f0-5b3f-49f4-8ba4-cee7af7e11bb。返回乙显示后台工具，再原生明确停止，宿主结果 aborted。 |
| 主题与窄窗 | 73 系统大小模式选择右边界并拖动，实际802×961；[80 暗色](80-dark-narrow-result-settled-0.png)／[87 浅色](87-light-narrow-tool-result-0.png)可读工具参数、结果和未知指标，无页面横向溢出。1920×1080与精确800px另由自动 Electron 截图覆盖。 |
| 重启与历史 | 92–102：同 data/profile 只读启动，打开甲及历史，原参数、Diff与来源仍可读取。应用重启不承诺窗口草稿／展开书签。 |
| 正常退出 | 首次文件→退出应用及最终103的同菜单退出均由宿主确认实际结束、ownedProcessesExited=true；4317／5173不再监听。[首次](first-closed.json)／[最终重启](restart-closed.json)记录可核对。最终重启 prompts=0、injections=0、kernels=0、SDK JSONL哈希不变。 |

前三个本地 hold 请求约300秒后返回 terminated，产品显示失败，不能算用户停止或任务完成。第四轮在有效运行期完成后台 PID／焦点验证，再明确停止；这四个结果在 first-closed.json 分开保存。

首次重启宿主夹具会对已恢复的 OFFLINE_ 文本补发合成观察，保留为 [夹具诊断](restart-fixture-diagnostic.json)，不用于零注入结论。该过程无 SDK prompt、无实际工具执行；随后禁止 existing-data 模式注入，再次同 data/profile 启动完成最终只读验收。原始历史保持哈希不变。

原生前重新核对316个产品／测试／脚本／配置文件与 CI 和 frozen clean 副本字节一致，复用已通过251项 Vitest／93项 E2E与 clean。收尾仅更新进度、证据及PRD文档模板，后续重新生成并完成静态检查。pi配置、canonical预算和锁哈希不变；没有安装包，网页独立功能暂缓。
