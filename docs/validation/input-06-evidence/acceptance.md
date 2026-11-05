# INPUT-06 引导、追加与可编辑队列

两项已勾选并 verified。完整离线门禁与 Windows 原生验收已完成，证据来源与限制如下。

daemon SQLite沿用session_queue有界记录（256条），新增版本、送达轮次和输入摘要。引导由实际SDK的awaited turn_end边界请求宿主选择一条FIFO输入，经物理cwd复核后进入同轮；SDK接收user事件才确认送达。追加不用SDK followUp自动续轮，等待prompt settled、终态检查点及资源释放，再经SessionService原配置／目录／信任准入，原子创建下一轮和更新队列回执。队列未解决时独立发送拒绝，避免超车。

待发编辑／取消用CAS；停止意图先暂停，失败／重启剩余输入held，已选未确认为uncertain，禁止盲目重发。明确恢复仅恢复所选输入为新轮次，不恢复旧审批。只读历史、REST输出统一脱敏，原始队列不作为已执行正文。input-queue-v1保护能力匹配，desktop-only／Host／Origin／JSON／CSRF继续生效。

早期原型没有区分daemon队列能力，直接SessionKernel测试等待不存在的边界回应；已加入显式私有能力标志，独立SDK调用保持原语义。首次HTTP测试误用未await的浏览器配对助手，修正为显式desktop身份。41项定向SDK／服务回归通过，完整最终结果待下文补充。

真实提供商0，不改pi配置／canonical预算／锁，无安装包，网页版独立功能暂缓。

Electron 初稿在 SDK 尚未启动时允许入队，服务正确拒绝轮次变化；现由服务返回 activeTurnId，匹配后开放操作。强化保存断言又暴露冲突后重新编辑仍可能读取旧版本；失败后先刷新权威记录，独立编辑文字继续保留。保存失败测试的 GET 路由原误用 continue 绕过隔离代理，已改 fallback；迟到 A→B→A 入队回执现在同时核对不可变草稿身份，不能清除新编辑。合成 IME Escape 与普通 Escape 分开验证。

第一轮完整 CI 的 264 项 Vitest／SDK 通过，99 项 E2E 为 97 过、2 超时；两项均是立即切走后未读徽标改变可访问名称，修正为当前可见 pane 内的原会话标题定位。随后保留原窄窗断言，捕获新增队列区压缩阅读空间的真实回归：空队列无输入时收起，输入区有高度上限和内部滚动。800×760 的消息区域至少 120px，思考卡键盘位置、模型等待与队列恢复三项定向 Electron 流程最终通过。早期失败日志与几何截图保留；最终完整门禁及原生结果待后文补齐。


最终门禁：pnpm fix、完整 pnpm run ci（40 文件／264 项 Vitest、SDK 冒烟、99 项浏览器及 Electron E2E，退出 0）与 pnpm verify:clean（frozen 安装／check／build／test／SDK／HTTP 健康／正常退出，退出 0）通过。第二次完整 CI 的 98／99 为既有 SEC-08 驱动首次 CDP target 就绪竞态；加入原生 renderer-ready 信号后两项定向及第三次完整 CI 通过。早期失败日志保留。329 个产品／测试／脚本／配置文件与 clean 字节一致，原生后复用门禁；文档另行生成与检查。

原生使用 @oai/sky 的真实 Windows SendInput／UIA，未使用 CDP、renderer 路由或合成观察注入，共 78 条观察（含中间与重试，详见 native/observations.json）。实际 Electron／daemon／SQLite／SDK 全部使用隔离 data/profile 与回环 HTTP 夹具。保持运行会话两条追加入队、切走保留前台草稿和焦点、后台 PID 3572／同 epoch／原 cwd 不变；明确停止后两条 held，修改第一条为“原生恢复已编辑”并单独恢复，实际 SDK 新轮完成，第二条保持 held。设置返回、普通 Escape 取消编辑、明暗约 802px 窄窗与内部滚动已观察。离屏保存按钮初次点击未生效，滚动后可见保存成功，未据此宣称产品故障。

原生短边界两次尝试均在手动追加前完成，不作为原生顺序成功证据。两类 FIFO、引导优先、追加 settled 后新轮、编辑冲突／失败保留／迟到 A→B→A 草稿隔离与合成 IME Escape 由真实 SDK 服务及 Electron 自动测试证明。此次 Unicode SendInput 不是新一轮微软拼音组合输入证据，原生只验证普通 Escape，历史真实 IME 证据不冒充本轮新增。

两次 File→退出应用均 NATIVE_CLOSED_OK／退出 0。首段共 4 次本地产品 prompt（两次边界尝试完成、hold 明确中止、单条恢复完成）；同 data/profile 重启 prompt 0、内核 0，已送达／held 与历史可见，三份原生 JSONL 哈希不变。两段受管进程退出，pi 配置／canonical 预算／锁文件前后哈希一致。native/audit-summary.json、first-closed.json、restart-closed.json 与后台审计记录提供逐项依据。

下一步提示词（本批第 5 轮，已授权顺序继续）：

> 完成 OBS-02：运行阶段与状态提示。优先 Electron，覆盖单一主状态位置、工具／重试／上下文压缩／追加期间不误报结束、按操作身份合并错误、等待模型与思考分开、终态消隐不改变实际任务，以及停止请求／确认／未知状态。默认离线，沿用验收与费用约束，不改 pi 配置、不额外调用模型、不制作安装包，网页版独立功能暂缓。完成测试和实际 Electron 验证，补齐证据并更新进度；未改代码时复用通过的 CI／clean。本批已有原生控制授权，完成后独立提交，再统一推送五轮代码。
