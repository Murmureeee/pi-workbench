# MODEL-03 模型与思考级别切换

已验收，新增10项中的第6项；两项验收已勾选。

使用安装SDK 1.4.0的公开prepareRequest钩子，在每个对话模型请求前等待宿主配置，覆盖首次与工具后续请求。0013迁移保存请求／实际配置与CAS版本，已有会话cwd不变。空闲保存不启动模型；运行中当前响应不变，下次实际模型请求读取最新版本，SDK确认后更新实际配置。保存失败、无效能力与冲突保留原配置；不支持的思考选项禁选，附件入口未开放。

真实提供商仍关闭，提供商切换明确拒绝、不静默替换成本地夹具。两个离线模型仅供验证SDK切换与公开思考配置，不证明真实提供商授权或费用。SDK setModel／setThinkingLevel均persist:false，不改pi配置、不额外请求、不自动重发。无依赖或锁升级，无安装包，网页独立功能暂缓。

最终完整[CI](ci.log)退出0：48文件／315项Vitest、117项浏览器及Electron E2E、SDK冒烟与静态检查通过。[frozen clean](clean-workspace.json)完成新目录冻结安装、check、build、315项测试、SDK、HTTP200及正常退出；通用记录feature保留OPS-01来源。[365个代码／测试／配置文件](code-reuse-audit.json)与clean字节一致，原生后复用门禁。

## 自动验证来源

4项新增服务回归使用实际SQLite、迁移、SDK子进程和本地HTTP：空闲保存不改JSONL／PID、下一轮实际模型与思考字段、同一工具轮次第一／第二请求分别使用旧／新配置、迟到旧确认不能覆盖、配置写入触发器失败的事务回滚、CAS和desktop／CSRF／协议及附件字段拒绝。离线夹具不证明真实提供商效果。

2项新增Electron回归使用实际main／preload／daemon／SQLite与SDK。CDP和REST／WS转发仅在自动测试夹具中用于驱动、来源隔离及明确失败注入；保留草稿、支持级别、写失败、刷新、版本冲突、待生效、工具后续请求与明暗窄窗均检查。早期保存测试的GET错误使用route.continue绕过本实例转发，误到另一daemon，焦点断言失败；改用fallback保留同实例读取后两项通过。对话框另外保留关闭生命周期与明确焦点目标。此失败不能当作实际原生缺陷证据。

首次[完整CI](ci-initial-baseline-failure.log)18项失败／297项通过：旧schema反向夹具保留了新增表、复制协议样本缺新能力、旧迁移计数，以及旧取消断言期待已取消的网络续请求错误。补齐真实旧库夹具与能力声明；MODEL-03请求前边界拦截已取消的续请求，安装SDK实际返回aborted，继续检查原PID、单次请求、迟到许可无效与显式停止。重跑结果以最终ci.log为准，不重写原日志。


完整CI第二轮[布局失败](ci-layout-failure.log)保留：315项Vitest与116项E2E通过，新增模型设置行的额外上下留白使800×760目录失效场景中发送按钮部分被裁切。移除该留白，保留全部原断言；6项模型／目录恢复定向回归通过后从头重跑完整CI，不把失败当作通过。

## Windows 原生与边界

[原生观察](native/observations.json)共85条Windows UIA／SendInput记录，实际Electron／daemon／SQLite／SDK本地HTTP，无CDP或renderer路由替换。实际验证预填、fixture非off禁选、配置写失败保留high选项与原模型、明确重试恢复且不新增请求；运行中改为fixture/off显示待生效，拒绝写工具后同PID9860／epoch／cwd的后续模型请求使用新配置。两轮用户发送共3次本地HTTP请求，原生JSONL的assistant模型依次fixture/off、fixture-reasoning/high、fixture/off。最后空闲保存reasoning/medium为revision4，设置往返草稿保留，802px明暗窄窗对话框与操作可见、Escape取消不更改。首次内核在两轮之间被300秒空闲LRU正常回收，不声称两轮同PID。重启后预填reasoning/medium，0发送／0内核。部分UIA慢一帧按后续只读观察确认；非产品桌面UIA已省略；RootWebArea焦点不证明DOM元素焦点，Unicode注入不冒充真实IME。

同data/profile重启0次发送、0个内核，历史JSONL、pi配置、canonical预算与锁哈希不变。两次从原生文件菜单正常退出。中文文本是Unicode输入注入，不冒充新的真实IME证据。真实提供商请求0，无安装包，网页版独立功能暂缓。

## 逐项验收

- [x] 空闲保存立即生效且不启动模型；运行中显示requested与effective，含同一工具轮次的下一次实际请求消费新配置，PID／epoch／cwd保持。
- [x] 不支持的思考级别禁选、附件入口未开放且边界拒绝附件字段；真实提供商关闭。保存写失败／CAS冲突／迟到旧确认保留原模型与编辑，原生失败恢复及重启补证。

## 下一步提示词

完成 MODEL-05：上下文、Token与费用。优先Electron，覆盖会话与轮次追溯、上下文上限与输入／输出／缓存计数，未知明确未知；价格估算标来源与时间且不当账单。只使用已安装SDK与原生历史的可验证字段，默认离线、不改pi配置、不额外调用真实模型、不制作安装包，网页独立暂缓。完成测试、实际Electron验证、进度更新与独立提交后，再按顺序完成INPUT-10、UX-02、UX-03；第10项后推送第二批五项。
