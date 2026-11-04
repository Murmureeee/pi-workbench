# SESSION-07 无项目会话与独立执行空间 · 验收记录

日期：2026-11-04。三项验收通过，状态 verified。本轮按用户授权完成 WS-03、INPUT-01、SESSION-07 共三项；本地进度由 canonical backlog 计算为 **23 / 133**，OPS-08 整体继续 in_progress。真实提供商请求 0，pi 配置、canonical 预算及锁文件未改，无安装包，独立网页版暂缓。

## 结果与逐项验收

| 验收项 | 实现与自动证据 | 实际 Windows Electron |
| --- | --- | --- |
| 不选项目也能创建、运行、重启恢复，在最近／无项目找到，不继承上个项目 | 真实 daemon／SDK 首发及续发、全局新建、实际 daemon／Electron 重启，搜索无项目；session-spaces.test.ts 与 session-spaces.spec.ts | native 05–08：离开旧项目后全局新建，明确无项目首发；26–28：同 data/profile 重启、最近无项目发现、历史与独立 cwd 恢复 |
| 显示实际独立目录与能力／权限来源，不扩大权限 | 绑定保存 cwd 的只读检查；实际信任授予／撤销验证仅精确 cwd／指纹的显式上下文能进入本地 SDK，不继承旧项目资源或其他 cwd 的全局信任；HTTP／脱敏／身份替换检查 | native 09、13–14、19–24、28：持久独立目录、创建时无项目、全局资源未确认／未加载，settings 能力关闭，本轮0项文本快照；工具／命令／扩展／真实传输仍关闭 |
| 产物退出后保留，关联项目不移动或丢失来源 | 0010 不可变来源与 membershipVersion CAS，归属／解散只改元数据；真实文件／JSONL／接受输入摘要／后台PID保持、ABA与失败回滚、旧库迁移及迟到回执 | native 10–18：写失败保留选择，明确再次保存成功、后台移出项目／切换／返回保持同PID／epoch与cwd，明确停止才aborted；两次退出及重启保留文件哈希和来源 |

标题菜单“执行空间与项目归属”复用官方 Dialog／DropdownMenu／Field／Button／Alert／Badge。来源检查前后校验物理身份，项目列表失败单独提示并禁保存，保留已选目标、明确重试；冲突须核对最新版本。仅整理归属不改 cwd／模型／原始来源／已接受输入／SDK历史／文件或授权，关闭观察不停止真实任务。旧记录诚实显示 legacy-observed，不根据当前项目伪造创建来源。

## 自动门禁与来源

新增 **6项**实际目录／SQLite／HTTP／SDK本地服务测试及 **4项**实际 Electron 回归；已进入 test:contracts／完整 CI。最终 pnpm fix、pnpm run ci 均退出0：**27文件／223项 Vitest、78项浏览器与Electron E2E、SDK冒烟通过**；其中已包含 INPUT-01 两项新增测试。pnpm verify:clean 在新目录 frozen 安装／check／build／223测试／SDK／HTTP健康／正常退出均通过，锁SHA256一致。见 [CI](ci.log)、[clean](clean-workspace.json)、[clean命令](clean-commands.json)及[验证汇总](validation.json)。

自动 Electron 使用真实 main／sandbox preload／renderer 与 daemon，部分迟到和读故障由 route 延迟或失败注入，写失败用真实 SQLite trigger；不冒充原生输入。原生阶段未改产品／测试／运行脚本／根配置，282文件与本次clean逐项哈希一致，按用户要求复用已通过门禁，见 [复用审计](native-code-reuse-audit.json)。最后文档／进度／PRD生成另运行 docs:build、fix 和完整 check，结果见 documentation-commands.json。282文件一致的比较发生在原生结束、文档模板回填之前；最终复核281项保持一致，唯一差异为PRD文档模板的一段说明文字，无产品／测试／运行脚本／生成器改动，逐项哈希见post-documentation-audit.json。

保留初轮失败事实：[服务夹具失败](tests-before-fixture-fix.log)包含续发夹具错误使用空配置被产品拒绝、Windows活动进程占用目录；后改为保存配置并先正常释放SDK后再移动目录。菜单未收起导致交互失败的[初轮Electron日志](e2e-before-menu-fix.log)与最终修复区分。[后续尝试](e2e-before-final-target.log)有一次目标页面关闭和后继启动失败／异常时长，原因未独立证实，不将其当作通过证据。[prop误置类型失败](ci-before-prop-fix.log)已纠正后执行上述完整CI及clean；不删除失败测试或降低断言。

## 原生 Windows 证据

[29条观察](native-observations.json)、[原生汇总](native-validation.json)、[首次正常退出](native-first-closed.json)、[重启后正常退出](native-restart-closed.json)及 native/ 保存真实 SendInput／UI Automation／截图。原生使用 production Electron main／preload、真实 daemon／SQLite／SDK + 本地HTTP夹具，无 CDP、route拦截、DOM注入或系统对话框覆盖。

- 01–09：实际1920×1032最大化、旧项目目录、全局新建、首发 completed、独立目录与能力来源。02是窗口动画中间态；04无PNG且是导航即时旧状态，不用于证明切换完成，以05等稳定观察为准。
- 10–18：外部SQLite trigger注入保存失败，选择保留；撤销trigger后用户明确再次保存。移入目标项目保留原cwd和“创建时无项目”；明确续发本地hold，后台移出项目、切换旧项目再返回均保持 PID 32288／epoch dcb54e17-5d28-4db7-9a89-7de77f7562d3。点击停止后提交 aborted，与视图隐藏分开。各审计快照在 native/background-*.json。
- 19–24：深色全宽、实际802px外窗（约800px client）、降低高度后的内部滚动和固定页脚；项目下拉Escape关闭、Tab可达返回并Enter返回；浅色窄窗来源、路径换行和操作可达。
- 25–29：两次文件菜单正常退出，同data/profile重启。首段1个种子prompt、2个UI明确prompt（completed／aborted）；重启0内核／0prompt，JSONL哈希与来源不变，所属进程退出且4317／5173可重新绑定。

持久文件“外部验收夹具产物.txt”由验收宿主明确写入，用于核对整理和退出不搬移／清理；**不是模型或SDK工具生成**。SHA256为 6b8e09399b5aedb6f25f2d45a6225ae00176ead4dfb24c238bd1422cba1fdec3，目标项目目录未出现副本。工具仍禁用，本轮不声称已验收工具写文件能力。原生IME证据沿用 INPUT-01，本轮未重复或推断输入法厂商。

## 剩余边界与下一步

SESSION-13 只交付“整理归属”支撑子集，仍 in_progress、三项未勾选；显式环境差异预览、忙碌检查、cwd迁移及撤销旧目录授权继续留待该条与SEC-03。OPS-08第二项仍待生产业务审批／双端审批、M3回滚和后续平台门禁，不因本次离线通过提前完成。真实提供商请求0，配置及费用边界保持。

下一步提示词：完成 WS-07：工作区信任与不可用恢复。优先 Electron，覆盖未信任项目资源不自动执行、目录移动／卸载／删除后的执行阻止与明确恢复、历史保留和同物理目录重新关联；不隐式切换已有会话 cwd 或扩大权限。默认离线，沿用现有验收与费用约束，不改 pi 配置、不额外调用模型、不制作安装包，网页版独立功能暂缓。完成测试和实际 Electron 验证，更新进度并给我下一步提示词；原生电脑控制等我明确允许后再进行，未改代码时复用已通过的 CI／clean。
