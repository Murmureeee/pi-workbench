# CHANGE-01 轮次基线与持久快照

两条验收已通过，canonical依赖CORE-03、WS-04、CORE-06已verified。本地完成数按backlog计算为40/133，OPS-08继续in_progress [true,false]。CORE-03的M0原型只作设计依据，生产路径由本次重新验证。

## 运行规则与实现

复用WS-04物理身份、别名/父子根互斥与收尾证明。排队不建基线；SDK dispatch前持久登记和保存基线，SDK实际落稳或故障进程退出后保存收尾及completed/failed/aborted/interrupted，再释放目录。收尾采集失败有持久诊断；SQLite保存失败继续隔离。

原始字节位于daemon私有ledger/<身份摘要>/objects.git，0015只存引用/元数据。固定Git plumbing与隔离环境不操作用户HEAD/index/config/reflog或提交，不运行钩子/过滤器。两次稳定采集；2048项、8层、单文件5MiB、总32MiB，扫描和Git有时限；排除.git、依赖、私密配置、应用数据、嵌套仓库、链接/硬链接及.gitignore匹配项。不覆盖ACL、空目录、排除项和外部副作用，不宣称加密。

基线失败停在最终参数审批，必须单次明确接受本次不可回滚执行；会话授权不能替代。ready引用审批中损坏则拒绝，不以当前文件补造历史。重启只标中断，不恢复许可、内核或任务。Electron只读分页展示版本与诊断；provenance=uncertain、automaticRollback=false。CHANGE-01没有Diff、恢复写入或回滚。

## 验收映射

- [x] 写入前基线成功，失败暂停/取消/单次明确接受：12项实际服务回归覆盖限额、引用损坏、审批、真实写入与持久失败。原生B目录5MiB+1文件触发失败，取消后APPROVED.txt不存在，后续明确确认后真实SDK写入，版本仍标失败。取消工具后模型正常完成，不冒称整轮aborted。
- [x] 持久成功/失败/中止记录及独立历史：服务覆盖dirty/staged/untracked/二进制、旧文件删除后读历史、用户.git摘要不变、故障/退出/重启。原生A目录三种终态、同目录排队取消、外部编辑和同data/profile重启均保留版本。hold基线external.txt为original external file\n，收尾为actual host external edit during managed round\n；来源不确定。

## 自动验证

[完整check](check-cli.log)、[52文件/344项Vitest](test-full-final.log)、[SDK冒烟](sdk-smoke.log)、[frozen clean](clean-workspace.json)及[逐阶段原文](clean-commands.json)通过。clean完成冻结安装/check/build/344测试/SDK/HTTP启动与正常退出。SDK冒烟2次本地请求，真实提供商0。

[完整窗口最终126/126](e2e-final.log)，新增4项实际Electron回归。首轮[124过/2失败](e2e-first-failed.log)，既有reasoning/tool-timeline窄窗定位失效；调整滚入视口及Home进入回看后，[定向最终5/5](e2e-repaired.log)与完整126通过。第一次定向4/1及error-context保留。此前完整服务340/343的旧等待不足也保留[原文](test-full-first-failed.log)，等待包括持久收尾后344通过，未移除业务断言。

两项窗口测试修复同步原clean并补[源check](check-window-supplement.log)/[clean check](clean-window-supplement.log)。[原生后审计](source-audit-native.json)核对385输入与clean一致、5保护文件不变，git diff --check通过；复用未变344/SDK/完整frozen，不声称重跑第二次完整frozen。

## Windows原生证据

[逐条件结果](native-validation.json)、[80条观察](native-authorized/observations.json)、[首次退出](native-authorized/first-closed.json)、[同data/profile重启退出](native-authorized/restart-closed.json)。真实Electron/daemon/SQLite/SDK本地HTTP与独立Git，UIA/SendInput操作，无CDP或renderer注入。所属排队、同PID/epoch后台、实际外部改动、明确停止、失败、light/dark 802px、只读重启零发送/内核/审批/授权和两次菜单正常退出通过。两份JSONL哈希、版本引用及五保护文件不变。

观察含中间态及一次无效调整大小/离屏点击，不以数量替代验收。第66条意外附加非产品可访问树已排除，未操作该应用。中文使用Unicode输入/UIA，本次无新增真实IME证据；重启窗口尺寸不承诺持久。无SDK运行时的排队取消面板继续显示既有待同步文案。HTTP503、SQLite故障、分页附加历史为明确夹具；外部编辑是宿主控制文件改动，非SDK写入。

真实提供商0，pi配置/canonical预算/锁未改。无安装包，网页独立功能暂缓。

## 下一步提示词

> 请在D:\Project\pi-workbench完成CHANGE-02“修改来源与混合变更处理”，依赖CHANGE-01与OBS-03已verified。以最终守卫和真实工具前后字节关联轮次/调用，混合或未知来源保守标记，禁止独占自动回滚；不实现回滚。沿用本地SDK夹具、真实提供商0及配置/预算/锁不改，完成服务/Electron/Windows原生和完整CI/frozen clean，按证据更新canonical，OPS-08继续跨阶段判断。
