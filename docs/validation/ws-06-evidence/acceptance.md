# WS-06 项目管理、分组与侧栏组织验收

2026-11-03。四项验收通过，状态 `verified`；前置 WS-02 / CORE-06 均已验收。canonical 实际计算为 **19 / 133**；OPS-08 保持 `in_progress`，第二项继续等待生产业务审批 / 双端审批、M3 回滚及后续平台门禁。

## 逐项结果

| 验收 | 实现与结果 | 证据 |
| --- | --- | --- |
| 创建、改名、置顶、排序重启持久；展开会话及名称 / 路径检索 | 0008 显式迁移保留旧项目身份 / 默认目录，初始化顺序。ProjectService 独占 pinned / position / revision；置顶优先、组内上下移、新建放未置顶末尾，切换置顶进入目标组末尾。搜索按未过滤完整组移动，收折不影响真实运行。原生新建、改名、上移、置顶、检索、收折和同 data/profile 重启保持通过。 | 服务测试第 1 / 2 / 3 / 7 项；Electron 第 1 / 2 / 4 项；native-steps.json、native-first-closed.json、native-restarted-audit.json |
| 项目新建预选、全局无项目、实际归属及同名区分 | 项目和会话主按钮 / 菜单独立，侧栏与选择器显示目录或独立目录及短 ID，编辑框显示完整 ID。创建不建立空会话；创建请求绑定原输入，未知结果可查询原请求，移除墓碑防止迟到重试复活。卸载后的迟到创建仅刷新元数据，不抢新草稿。 | 服务第 2 / 8 / 9 项；Electron第 1 / 3 / 6 项；native-created、native-global-new、native-restart-new-project |
| 单默认目录校验；无目录项目独立空间 | 复用工作区物理身份与真实读写 / 探针清理校验；原生选择器只填路径，明确保存。失效输入保留并诊断；项目保存用 remember:false，不更新最近工作区。未绑定的两个会话使用不同持久 standalone cwd。目录异步 IO 后复核项目默认及归属，拒绝旧结果准入。 | 服务第 3 / 4 / 5 / 9 项；Electron第 2 / 3 / 5 项；native-path-ime-*、native-invalid-directory、native-real-picker-beta、native-picker-fills-only、native-standalone-* |
| 整理或移除不移动文件、删除会话、切换 cwd 或授予权限 | 默认修改仅供未来会话，旧会话继续原 cwd / 模型。确认移除在同一 SQLite 事务内解散分组并将所属会话归无项目；写失败整体回滚。已运行任务保持同 PID / epoch / turn，文件与 JSONL 哈希不变，信任记录不增。之后明确停止；移除后续发在自动流程中仍复用原会话及 cwd。 | 服务第 4 / 8 / 9 项；Electron第 5 项；native-remove-before.json / native-remove-after.json、native-unassigned-running-cwd、native-stop-confirmed |

产品实现位于 `apps/daemon/src/modules/workspaces/project.service.ts`、SessionService / SessionStore、`apps/daemon/migrations/0008_project_organization.sql`，以及 `apps/web/src/features/workspaces/project-editor.tsx` / `project-groups.tsx`。共享 Zod 契约、desktop-only HTTP、SQLite 与客户端同时更新。权限边界沿用 Host / Origin / CSRF / 配对 / 协议检查，测试第 6 项覆盖拒绝路径；无新增依赖或锁变更。

## 自动门禁与复用

- `pnpm fix`、完整 `pnpm run ci` 退出 **0**：**24 文件 / 201 项 Vitest**、SDK 本地冒烟、构建及 **63 项浏览器 / Electron E2E**。新增 9 项实际服务测试与 6 项 Electron 流程；原始输出 [ci.log](ci.log)。
- `pnpm verify:clean` 退出 **0**：`D:\Project\.piw-clean-STDNaT` frozen 安装、check、build、201 项测试、SDK 冒烟、HTTP 健康、原生模块及正常服务退出；锁文件一致。clean 不执行 E2E，E2E 已在主 CI 全量通过。通用 clean 工具的历史 `feature: OPS-01` 标识不代表仅验证 OPS-01；[clean-workspace.json](clean-workspace.json)、[clean-commands.json](clean-commands.json)、[clean.log](clean.log)。
- 原生验收后产品 / 测试 / 根配置未改：**249 个输入文件**与通过的 clean 副本完全一致；[native-code-reuse-audit.json](native-code-reuse-audit.json)。后续仅同步文档 / canonical 进度 / PRD，执行 `pnpm docs:build`、`pnpm fix`、完整 `pnpm check` 和 `git diff --check`，输出归档于 docs-build.log、fix-final.log、check-final.log、diff-check.log。

初轮 CI 因新增迁移后 bootstrap 仍期望 8 条而失败（实际 9 条）；更新迁移总数断言后完整通过，保留 [ci-initial-migration-count.log](ci-initial-migration-count.log)。[ci-before-path-ime.log](ci-before-path-ime.log) 是目录字段 IME 防护扩展前一轮通过结果，最终以 ci.log 为准。

编辑项目曾因沿用显式打开接口而改变最近工作区时间；改为不记最近的 resolve-directory。Electron 第 2 项比较编辑前后完整最近列表；定向调试已见修复前失败，早期定向输出仅留任务工具记录，未伪造为归档日志；最终通过证据在 ci.log。标题 / 输入与路径容器统一捕获 composition，避免仅名称字段受保护。

## 原生 Windows Electron

[native-validation.json](native-validation.json) 汇总 **40 步**实际原生操作，完整 UIA / 截图引用见 [native-steps.json](native-steps.json)。来源为实际 daemon SQLite、真实 SDK + 本地 HTTP 夹具，无路由拦截或选择器 stub；宿主经实际 main / preload 和私有父子 IPC 配对。隔离宿主脚本保留为 [native-host.mjs](native-host.mjs)，复现时放回仓库 `.workbench/` 再运行，不直接从证据目录运行其相对 import。

真实微软拼音由物理按键打开 n 候选（你 / 呢 / 那）；Enter 提交组合而不保存、Escape 取消组合不关框、Space 选择“你”。后缀“的项目🧪”是直接输入，和真实 IME 部分分别记录；目录字段也验证了真实组合 Enter / Escape。自动合成 composition 不冒充真实输入法。

原生新建不产生空会话；编辑预填全选、Escape 取消保留旧名；SQLite trigger 实际拒绝写入后显示“保存结果待核对”并保留输入，解除故障后明确保存成功。不存在的目录诊断保留文本；未拦截 Windows 选择器取消不保存，选中 Beta 仅填值，随后点击保存才更新默认。

显示器为 1920×1080 / 100%，最大化截图覆盖 **1920×1032 工作区**；原生拖动至 **802×962 含边框**，约 800px 内容宽。检查明暗布局、窄窗导航 / 菜单 / 编辑框 / 键盘，自动 E2E 另含 1920×1080 和 800×800。查看的稳定截图包括 native-maximized-settled.jpg、native-dark-maximized.jpg、native-dark-narrow.jpg、native-dark-narrow-editor.jpg 及三张 ws-06-project-groups-*.png。最大化动画中带后台窗口的过渡截图已移除。

首段本地 hold 约 300 秒后 `terminated`；移除验证另起一轮，前后 PID **21960**、epoch、turn ID 相同且运行中，cwd 仍为甲目录，会话归属为 null，文件 / JSONL 哈希与信任记录相同。不能把多轮说成一轮贯穿；取消移除的原生步骤恰逢首段结束，不用于证明取消时仍运行，取消保持后台任务另有自动 E2E 证据。随后通过产品“停止本轮”等待 daemon 确认 aborted，未点击重试。

两次从原生“文件 → 退出应用”正常退出，宿主命令均退出 **0**，日志记录 `NATIVE_CLOSED_OK`。同 data/profile 重启后项目名称 / 默认 / 置顶 / position / revision / 墓碑、会话 / cwd、文件及三个 JSONL 哈希全等；无内核、无队列、无重发，深色偏好保持。退出审计见 [native-first-closed.json](native-first-closed.json)、[native-final-closed.json](native-final-closed.json)，重启见 [native-restarted-audit.json](native-restarted-audit.json)。本任务 4317 / 5173 与自有进程已退出，不影响独立文档预览。

原生定位曾遇到选择器过期 UIA 索引及主题原生浮层的目标窗口错误，刷新观察后以键盘 / 当前截图恢复；这是自动化定位错误，不记作产品故障。CI 日志内合成 renderer fault、注入 SQLite 拒绝和 abort 为预期失败路径，最终用例均通过。

## 范围与费用

真实提供商新增请求 **0**。原生首次运行 3 次本地 SDK seed + 2 次本地后台 hold，UI prompt 为 0；同数据重启的 seed / 后台 / UI 均为 0。真实传输关闭，工具 / 扩展禁用。隔离 pi 元数据与 canonical 预算哈希不变；不读取或改写真实 pi 凭证，不制作安装包。原生证据不证明真实提供商可用或生产工具权限已交付。

网页版独立功能继续暂缓。完整会话标题 / 正文搜索为 SESSION-12；任意会话主动移入 / 移出项目及明确环境迁移为 SESSION-13；多根目录为 WS-05。未扩大这些条目的完成状态。

## 下一步提示词

> 完成 SESSION-12：基础会话搜索与项目筛选。优先 Electron，覆盖中文标题与用户／助手正文、全部／指定／无项目、状态／时间／归档筛选、分页脱敏片段与消息定位、200ms 防抖、迟到隔离、键盘和索引更新。默认离线，沿用现有验收与费用约束，不自动改 pi 配置、不额外调用模型、不制作安装包，网页版独立功能暂缓。完成测试和实际 Electron 验证，更新进度，并给我下一步提示词。
