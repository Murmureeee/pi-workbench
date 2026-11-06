# SEC-09 审批与操作审计

已验收，新增十项中的第4项；两项验收勾选。本地35／133，OPS-08继续进行。

0012新增daemon独占追加审计表，普通UPDATE／DELETE触发器拒绝；没有HTTP／工具写入或删除入口。审批决定和新会话授权、资源信任授予同数据库短事务提交，保存失败不放行；撤销先失效，审计失败不恢复权限并显示缺失警告。客户端配对先记录再授予；不保存票据、Cookie或CSRF。SQLite触发器不代表抵抗同用户任意程序的OS隔离。

Electron设置及原生文件菜单进入操作审计，核对对象、风险、人工／宿主／合成来源、决定、范围与时间。类别及会话UUID筛选，固定高水位序号分页，每页最多50条，仅显式导出当前筛选页。写入、读取和导出共用Redactor；新识别秘密再次过滤，不改写原件。原件保留，无删除或自动清理入口，清除筛选不删除记录；下载副本由用户管理。功能启用前记录仍在会话历史，未实现的回滚不虚构记录，历史决定不恢复授权。

## 测试与失败记录

7项新增实际SQLite／SDK／本地HTTP服务测试覆盖审批／授权审计、事务失败不执行、撤销审计失败仍失效、配对失败无客户端、资源信任事务、稳定分页／新识别秘密脱敏、无变更端点及普通SQL拒绝改写。3项新增实际Electron测试覆盖真实审批审计、导出文件JSON与脱敏／范围解析、筛选／分页、未知文本安全展示、读取／导出失败保留、导航后迟到下载隔离、重启不重发和dark 800px。

初轮服务等待不足及文件内容预期已按实际SDK启动和既有夹具修正，不降低断言。初轮Electron3项失败见[electron-initial-failure.log](electron-initial-failure.log)：相对CDP URL、原生accelerator合成方式及脱敏文本预期错误；修正测试。随后[菜单缺陷](electron-menu-failure.log)中2／3通过，类别RadioItem默认未收起阻挡应用筛选，增加closeOnClick后3／3通过。原生harness初次在Fastify启动后注册hook报AVV_ERR_ROOT_PLG_BOOTED，未进入产品验证，改为包装AuditService.page的隔离夹具。

第二轮完整[迁移夹具失败](ci-upgrade-fixtures.log)为298／307通过：八处旧schema重建漏移除新审计表，使迁移重复CREATE失败，另迁移计数仍为12。仅在隔离测试旧库重建SQL加入移除新表，并更新已审查迁移数为13，保留所有业务断言；未将生产迁移改成IF NOT EXISTS掩盖损坏。

另在第三轮CI通过307项Vitest并进入E2E后，复查发现首屏上一页书签未保存snapshot，主动中止该轮，不计完整通过。[并发追加回归](pagination-before-fix.log)先证实返回首屏会纳入新记录；书签保存高水位后，[三项审计Electron](pagination-after-fix.log)全部通过，显式刷新才包含新记录。随后完整门禁从头运行。

最终完整门禁前，pnpm ci被pnpm12当作安装命令，[安装输出](install-command.log)单独保存，不计测试成功。改用pnpm run ci，首轮[Knip失败](ci-unused-export.log)指出未用auditKindSchema导出，移除无用export后重跑。最终[CI](ci.log)退出0：47文件／307项Vitest、114项E2E、SDK冒烟及静态检查全部通过。[frozen clean](clean-workspace.json)冻结安装、check、build、307项测试、SDK、HTTP200和正常退出通过；通用报告保持feature=OPS-01，不改来源。[361文件字节核对](code-reuse-audit.json)无差异。

## Windows 原生证据与限制

[58条观察](native/observations.json)中4条系统保存框目录列表为隐私省略，保留54条（含中间态）；非产品前台截图另排除。[宿主审计](native/summary.json)来自Windows UIA／SendInput、实际Electron／daemon／SQLite／SDK本地HTTP，无CDP、renderer路由或合成工具事件。真实审批明确确认不可回滚后写出APPROVED.txt，设置返回保留草稿，人工／宿主来源、范围详情及脱敏可见；一次明确导出存储失败保留页面，重试打开Save As后Escape取消，未声称原生文件保存成功。实际下载内容由Electron自动测试解析。

文件菜单操作审计、明暗1442px与802px窄窗、退出前保留一条授权、两次正常菜单退出均实际观察。首次边框drag没有改变尺寸，后用系统大小模式及单击确认得到802px，不把早期尝试记成功。同data/profile重启审计6条保持、退出撤销记录可见；0发送／0内核／0待审批／0授权，SDK JSONL哈希不变。pi配置、canonical预算和锁文件哈希不变，真实提供商请求0。

原生输入使用UIA set_value，无新增真实IME或跨端焦点证据；后台隔离、分页／类别空态、失败及迟到下载以实际Electron自动测试为证。无安装包，网页独立功能暂缓。

## 逐项验收

- [x] 记录对象／风险／来源／决定／范围／时间，agent无改写入口；实际SQLite拒绝UPDATE／DELETE、真实审批同事务与失败关闭、原生详情和重启审计为证。
- [x] 明确原件保留与本页导出／清除筛选的范围，写入和导出统一脱敏；JSON文件解析、新识别秘密再次过滤、失败与迟到隔离及原生保存框取消分开记录。

## 下一步提示词

完成 SEC-10：目录与网络访问规则。优先 Electron，覆盖路径穿越／前缀近似／链接／大小写的批准边界，命令授权的实际cwd／参数／控制运算符，无法判定时单次审批及网络风险的明确说明；不冒充OS网络沙箱。默认离线，不改pi配置、不额外调用模型、无安装包，网页独立功能暂缓；逐项测试与实际Electron验收后更新进度，完成新增第5项后推送。
