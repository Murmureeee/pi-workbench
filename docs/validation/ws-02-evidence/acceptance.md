# WS-02 验收记录

2026-11-03：最近工作区与重命名的两项验收均通过，WS-02 标为 `verified`，勾选为 `[true, true]`。前置 WS-01 已验收；canonical backlog 本地完成数为 **18 / 133**，OPS-08 继续 `in_progress`，下一项为 WS-06。

来源为实际 Electron main / sandbox preload / React renderer、daemon HTTP、SQLite、文件系统及 pi SDK 子进程 + 本地 HTTP 夹具。新增真实提供商请求 **0**，工具 / 扩展和真实传输继续关闭；用户 pi 配置及 canonical 预算不变，无新增依赖或安装包，网页版独立工作区操作暂缓。

## 逐项结果

| 验收项 | 实现与自动门禁 | 原生 Electron 结果 |
| --- | --- | --- |
| 重启恢复最近工作区与名称，明示排序 | 0007 迁移在原 workspaces 增加自定义名、最近时间与 revision。成功显式打开 / 切换才更新时间，降序排列，同毫秒单调顺延、ID 次排序；重命名 / 刷新 / 校验 / 重新定位不更新时间。最多展示 100 项及总数，不删除更早登记；旧库不伪造最近，standalone 内部登记不加入最近。 | Ctrl+O 进入最近，乙先甲后；重命名与校验不重排，显式打开甲才到首位。同 data / profile 完整退出重启后，乙的新路径 / 时间、甲的隐藏状态及自定义名保持。显式重开甲恢复同 ID / 名称并更新排序，项目与会话保留。 |
| 失效目录诊断、移除与重新定位，不删除目录 / 会话 | 目录不存在 / 替换 / 权限及存储失败返回明确原因；CAS 冲突或失败不覆盖元数据。移除只将最近时间置空，保留目录、名称、身份及所有引用。重新定位只接受移动后的同一物理目录，另行显式保存，不重绑不同目录；既有会话 cwd 不改，旧 cwd 不匹配时续发拒绝且不启动模型。 | 隔离夹具移动乙后，原生打开显示不存在 / 已移动和不可用，当前甲保留。真实 Windows 选择器填入新路径时数据库未变；点击保存后乙路径更新但最近时间不变，随后显式打开才切换视图。移除甲、失效诊断、重新定位和显式切换期间的对应 SDK hold 仍 running / 同 PID 15848，甲会话 cwd 未变。文件、项目、会话和名称均保留。 |

工作区显示名与项目名、会话标题分别保存，不重命名真实文件夹。去首尾空白后 1–80 个 Unicode 码点，拒绝控制 / 格式字符；null 恢复目录默认名。编辑固定工作区 ID / revision，预填并选中；Enter 保存、Escape 取消，中文组合期间两键不保存或关框。保存失败保留输入，冲突显示最新记录，明确核对后仍需再次保存；结果未知不自动重试。取消、迟到响应和断线不改变当前选择或后台任务。

## 自动门禁

- `pnpm fix`、完整 `pnpm run ci` 均退出 **0**：[CI](ci.log)，**23 文件 / 192 项 Vitest、57 项浏览器与 Electron E2E**、SDK 本地流式 / 中止 / dispose 冒烟通过。无真实提供商请求或被阻止的联网尝试。
- 新增 `apps/daemon/test/workspace-recents.test.ts` **7 项**：实际目录 / SQLite 的排序持久、100 项边界、旧库 / 内部目录、Unicode / 写失败 / 并发 CAS、失效 / 替换 / 同身份重新定位、保留后台任务与不可变 cwd / JSONL、desktop / Host / Origin / CSRF 拒绝及真实迁移。加入既有 `test:contracts`，未新增提供商调用。
- 新增 `e2e/workspace-recents.spec.ts` **4 项**实际 Electron 流程：完整重启与明暗窄窗，预填 / 失败 / 冲突 / 合成 IME，失效诊断 / 真实 main-preload 选择桥 / 明确保存，移除 / 重命名 / 切换 / 断线保留实际 SDK 本地后台任务。
- 本次 `pnpm verify:clean` 退出 **0**：[结果](clean-workspace.json)、[命令全文](clean-commands.json)、[日志](clean.log)。新副本 `D:/Project/.piw-clean-ZaTZCz` 的 frozen 安装、check、build、192 项测试、SDK 冒烟、HTTP 健康检查及正常启停通过。工具保留 OPS-01 报告标识，E2E 在主工作区 CI 执行；不等于安装包验收。
- 产品代码之后只补原生证据、文档 / PRD 和进度；最终与该 clean 副本逐文件核对，见 [复用审计](native-code-reuse-audit.json)。文档回填另执行 `pnpm docs:build`、`pnpm fix`、完整 `pnpm check`，见 [生成](docs-build.log)、[格式修复](fix-docs.log)、[检查](check-docs.log)。

初次定向 E2E 的重复清理 abort 导致 Unknown active turn，见 [原失败](e2e-targeted.log)，修正测试清理后完整 CI 通过。800px 下详情和最近区域重叠，几何断言修复前失败，见 [修复前](layout-before.log) / [修复后](layout-after.log)；改为纵向滚动并保留内容高度，最终完整 CI 重新通过。[旧图](workspace-recents-dark-before.png)与最终 [1080p 亮色](workspace-recents-light.png)、[800px 深色](workspace-recents-dark-800.png)、[保存失败](workspace-recents-failure.png)分别保留，最终截图已目视复核。未删测试、跳过失败或降低门禁。

## 原生 Windows / Electron

[原生汇总](native-validation.json)、[25 步时间 / UIA / 截图索引](native-steps.json)及同名 `*-audit.json` 保存实际状态。原生验收宿主见 [快照](native-harness.txt)，仅使用隔离工作区、空的本地 pi 配置及固定本地 HTTP 模型；页面与目录选择器没有路由拦截。自动化 E2E 的选择器返回值夹具与这次真实 Windows 选择器分别标记。

真实微软拼音通过物理 `n` 键显示候选面板：候选 Return 提交字面 `n`，不能称作选入中文；Escape 只取消组合、保留弹框，之后非组合 Escape 才取消。Space 选入中文“你”且不保存；后缀“ · 原生工作区 🧪”由 literal type_text 输入，不算真实 IME。SQLite trigger 实际拒绝保存后，编辑保留、原名 / revision 不变；移除故障夹具不自动保存，再次非组合 Enter 才成功。对应 [候选](native-ime-candidate.jpg)、[Enter](native-ime-enter-not-saved.jpg)、[Escape](native-ime-escape-keeps-dialog.jpg)、[中文选词](native-ime-selection-not-saved.jpg)、[失败](native-save-failure.jpg)及[明确保存](native-save-recovered.jpg)已归档。

[移除后](native-remove-background-kept.jpg)、[失效诊断](native-missing-directory.jpg)、[选择未保存](native-picker-not-saved.jpg)、[重新定位保存](native-relocate-saved.jpg)、[显式打开新位置](native-open-relocated-background-kept.jpg)、[重启最近](native-restart-recents.jpg)和[重开隐藏记录](native-reopen-hidden-record.jpg)与 SQLite / 任务审计逐项对应。原生首次 hold 在约 300 秒后返回 `terminated`，如实保留终态；后两段本地 hold 是宿主明确新建，最后显式停止并确认终态后退出，不能声称同一轮任务贯穿整个验收。上述对应步骤仍各自验证 running / 同 PID，费用始终为零新增真实请求。

两次原生文件菜单正常退出均输出 `NATIVE_CLOSED_OK`、退出 **0**：[首次日志](native.log) / [重启日志](native-restart.log)，[首次关闭审计](native-first-closed.json) / [最终关闭审计](native-final-closed.json)确认受管进程退出。重启没有内核、队列或 prompt，停止后的原生 JSONL SHA-256 在重启 / 重开 / 再退出间一致；项目、会话、cwd 和目录保留文件均保留，4317 / 5173 无本任务残留服务或活动连接。

首次隔离宿主因 `windowsHide:true` 没有可操作窗口、无 UI 输入，确认归属后关闭自有 Electron，不算作正常菜单退出；原 [日志](native-hidden-launch.log) / [关闭审计](native-hidden-closed.json)保留。其 1 次建样本及后续 3 次明确后台请求均为真实 SDK + 本地 HTTP 夹具，重启不重复 seed，UI 没有发起模型任务。

锁文件 SHA-256：`d9d46d301907ef4d86e5c53de3eca57433f5978ebf1e6547f8d094f50a60b40a`。预算 SHA-256：`cbc52551a5e083e17dd8f1f2343a67ebab8b05a199b53ecb5d48be48f25f1251`。原生隔离 pi 配置三个文件前后哈希相同，没有读取或改写用户真实凭证。

## 后续范围与提示词

WS-02 不提前验收项目管理、完整生命周期、目录迁移、跨端草稿或网页独立工作区。OPS-08 第二项仍待生产业务审批 / 双端审批、M3 回滚及后续平台门禁，整体继续进行中。依赖顺序为 WS-02 → WS-06 → SESSION-12。

> 完成 WS-06：项目管理、分组与侧栏组织。优先 Electron，覆盖项目创建、重命名、置顶、排序的重启持久，按项目展开会话、名称与路径检索、同名项目区分、全局与项目新会话归属，以及单默认目录校验和无目录项目的独立执行空间。整理或移除项目不移动文件、不删除会话、不隐式切换已有会话 cwd 或授予权限。默认离线，沿用现有验收与费用约束，不自动改 pi 配置、不额外调用模型、不制作安装包，网页版独立功能暂缓。完成测试和实际 Electron 验证，更新进度，并给我下一步提示词。
