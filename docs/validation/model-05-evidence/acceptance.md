# MODEL-05 上下文、Token 与费用

已验收，原新增批次中的第7项。用户最新要求完成本项即推送并结束，INPUT-10、UX-02、UX-03暂缓，未实施。

只读复用受管SDK v3 JSONL的身份／分支／代际校验，按消息、轮次及会话汇总已提交助手计数；20轮分页／单轮100条展示，合计包含全部可读助手记录，文件竞争拒绝混合统计。SDK规范化零值不能区分未报告，零／缺失／无效值均未知，部分和与未知次数同时显示；失败、停止不推断零用量。没有新增数据库或第二个统计权威。

上下文显示最近已提交请求总计和该请求模型的配置窗口，明确不含新草稿／后续工具且不是当前精确上下文；未知模型窗口未知，不做字符推算。SDK 1.4.0的getSessionStats包含额外usage／压缩等记录，getContextUsage会估算投影上下文，本次未调用这些API或冒充其完整统计；当前未开放的压缩／分支计费留待对应需求。价格没有可核验来源和时间，费用／价格来源／价格时间明确未知，不把离线SDK的0费率当账单。

自动验证使用actual SDK／SQLite和本地SSE usage夹具，原始prompt128（含cache32）／completion16／total144经SDK归一化为input96／cacheRead32／output16／total144；它不是实际提供商用量。普通reply夹具未提供usage，SDK0显示未知。Electron自动测试的CDP／路由故障注入与实际Windows原生分开记录。默认离线、真实提供商0，pi配置／canonical预算／锁不改，无安装包，网页独立暂缓。


## 验证与失败记录

最终[CI](ci.log)退出0：50文件／317项Vitest、118项浏览器与Electron E2E、SDK和静态门禁通过。[frozen clean](clean-workspace.json)冻结安装／check／build／test／SDK、HTTP200与正常关闭通过；通用报告保留OPS-01来源。[代码复用审计](native-code-reuse-audit.json)371文件字节一致，原生后仅补文档，复用上述门禁。

保留[初次定向失败](targeted-initial-failure.log)：新usage夹具尚未加入daemon输入枚举，补齐后2项定向测试通过；[首次类型失败](ci-initial-type-failure.log)及[修复位置错误后的再次失败](ci-type-retry-failure.log)来自测试configuration的provider字面量推宽，修复该实际声明后重跑。随后完整CI的既有CORE-07进程PID存在性断言失败，316项通过，见[原始记录](ci-resource-failure.log)；未修改资源实现或原断言，独立[12项资源回归](resources-recheck.log)和最终完整CI均通过。此瞬时失败保留为验证限制，不冒充已经定位或修复的产品缺陷。

## Windows 原生

[原生观察](native/observations.json)54条，实际Windows UIA／SendInput + Electron／daemon／SQLite／SDK本地HTTP，无CDP或renderer路由替换。实际首次发送使用明确的本地SSE usage夹具，原生展开核对input96／output16／cacheRead32／total144、消息／代际／轮次及未知价格来源与时间；第二轮未提供usage，SDK默认0显示未知，会话合计保留已记录144和未知1次。宿主注入只读服务异常后显示未同步与过期数据提示，在故障仍存在时点击重新读取保留错误及旧数据，恢复后由定时刷新重新同步，不冒充实际磁盘故障或恢复后手动重试，不新增模型请求。同一内核的localRequests累计从1到2，每轮各一次。草稿与设置返回保留，明暗802px窄窗可展开消息，深色双展开后内部滚动至底并以Escape关闭，浅色单展开通过关闭按钮返回；同data/profile重启保留两轮统计、历史哈希不变且0发送／0内核。两次文件菜单正常退出；Unicode注入不冒充真实IME，UIA慢一帧通过后续只读观察确认，RootWebArea焦点不等同具体DOM焦点。窗口第一次右边缘拖动未改变宽度，调整至实际边缘后截图确认802px。

同data/profile重启0发送／0内核，JSONL哈希与pi配置／canonical预算／锁保持；两次从原生文件菜单正常退出。Unicode文本注入不冒充真实IME；RootWebArea焦点不证明具体DOM元素焦点。真实提供商请求0，离线usage是确定性SSE夹具计数而非实际账单。

## 逐项验收

- [x] 会话／轮次／消息／代际与模型身份可追溯，输入输出缓存计数区分可读部分及未知；未知上下文上限和价格明确未知。
- [x] 没有可核验价格来源和时间时只展示记录计数，不计算费用或推断0元；上下文参考范围明确，不额外调用模型、改写历史或配置。

## 批次结束

依用户最新指令，本项完成后与MODEL-03提交一起推送。后续INPUT-10／UX-02／UX-03暂缓，不继续执行；OPS-08整体仍进行中。

收尾已重建 PRD／路线图并执行 `pnpm fix`；[最终 check](final-check.log)退出 0，文档结构、链接与 canonical 进度通过。再次比对 371 个产品／测试／配置文件与 frozen clean 字节一致，未重跑已通过的完整 CI／clean。
