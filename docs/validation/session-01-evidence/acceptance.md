# SESSION-01 验收记录

日期：2026-11-03。状态：**verified**；前置 WS-01 / MODEL-01 / CORE-06 已验收。四项验收均已通过，补齐了真实 Windows 中文输入法与原生 Electron 操作证据。真实提供商新增请求 **0**，canonical 预算、既有录制和用户 pi 配置未改；无安装包，网页版独立功能暂缓。

## 已实现

- Electron 默认进入实际会话工作台；全局新建默认无项目，最小项目入口可预选项目与单个默认目录。未发送只保存当前窗口草稿，无永久空会话；已有会话续发保留同一 sessionId 和已保存配置。
- SQLite FULL 事务先保存会话索引、配置、首消息与请求 / 轮次身份，再经 KernelService 调度真实 pi SDK 子进程和本地 HTTP 模型夹具。重复 / 并发 requestId 匹配不可变摘要，返回原结果；不执行第二次输入。已提交正文回源 SDK JSONL，outbox 在匹配的原生输入可读后清空。
- 落库前失败保留草稿和原请求 ID；响应丢失先核对原提交。落库后已知失败保留会话和原消息，明确重试生成新请求 / 轮次并关联失败任务。实际 SDK 被硬杀 / 服务重启时结果未知，标记中断，不自动重放或提供原任务直接重试。
- 模型和实际 cwd 明确显示；已有提供商选择保留且标注未联网验证，真实传输关闭时禁发；模型消失不改选夹具。无目录时使用持久专属目录，拒绝 standalone 基目录链接逃逸，排队后再次检查目录。现有 pi 配置只读发现，不自动改写。
- 每窗口 sessionStorage 分开保存新 / 旧会话草稿、模型、项目、目录与待核对请求；切换 / 刷新 / 设置返回保留，迟到回执不抢页面。同一项目入口重新打开新草稿保留显式目录；切换项目归属才清除目录覆盖并使用目标默认值。Enter / Shift+Enter / composing / keyCode 229 分别处理，纯空白不发送。关闭应用后的未发送草稿恢复不在本次范围。
- 本地脱敏标题不额外调用模型。最小项目、独立目录、标题和输入能力仅作为 SESSION-01 的支撑；WS-06、SESSION-02 / 07 / 10、INPUT-01 未据此整条验收。

## 原验收项复核

| 项 | 结论 | 证据 |
| --- | --- | --- |
| 全局 / 项目入口、未发送无空会话、已有会话续发 | 通过 | 服务与 Electron E2E 的真实 SQLite / 配置 / 原生 JSONL |
| 首发持久化、侧栏、双击与同请求幂等 | 通过 | 并发三请求、SQLite trigger 故障、真实 Electron 双击及响应丢失后刷新核对 |
| 前后失败恢复、不重放未知结果 | 通过 | 真实 SDK error / SIGKILL + 重启、原请求恢复、已知失败明确重试、排队后目录失效 |
| 无需名称 / 项目、创建反馈、不额外命名、真实 IME 不误发 | 通过 | 实际 Windows 微软拼音候选 / Enter 提交 / Space 选出“你”、原生 Shift+Enter、发送前 SQLite 为 0；普通 Enter 才创建会话，本地摘要不调用模型 |

## 命令与来源

原实现的 `pnpm fix`、完整 `pnpm run ci`、`pnpm verify:clean` 均退出 0。原生补验发现同项目新草稿重新进入时丢失显式目录，最小修复 `session-drafts.ts` 并扩充既有 Electron 用例后，重新执行 `pnpm fix` 和完整 `pnpm run ci`，均退出 0：**164 项 Vitest / 40 项浏览器与 Electron E2E**，含 **9 项会话服务集成 / 5 项实际 Electron 流程**，SDK 本地 prompt / abort / dispose 通过。依赖、锁文件、原生模块、服务与构建配置未变，复用修复前的 frozen 新目录安装 / 原生 SQLite / 构建 / 启停记录，不宣称该 clean 副本包含此次两文件修复。

- [原实现 CI](ci.log)、[目录修复后的完整 CI](ci-native-followup.log)、[fix 输出](fix-native-followup.log)、[复用的 clean 结果](clean-workspace.json)和[clean 命令](clean-commands.json)分别保留。clean 记录中的 feature 字段沿用通用工程验证脚本的 OPS-01 标签；不是本功能另一次产品验收。锁文件 SHA-256 始终为 `d9d46d301907ef4d86e5c53de3eca57433f5978ebf1e6547f8d094f50a60b40a`。
- 进度回填后的[文档生成](docs-build-native-followup.log)、[最后完整 check](check-native-followup.log)另行保留；原 `check.log` 不覆盖。
- [目录回归修复前失败](directory-regression-before.log)和[修复后通过](directory-regression-after.log)：既有首个 Electron 用例实际选择目录、切到旧会话再返回新草稿，并用 `page.reload()` 验证正文 / 目录恢复；保留不同项目入口重置目录的原用例。测试总数仍为 40。
- `apps/daemon/test/session-creation.test.ts`：真实 SQLite、文件系统、受管 SDK / 本地 HTTP；SQL trigger、fixture error、队列目录移动、junction 和 SIGKILL 明确为故障注入，不读取真实凭证或调用提供商。
- `e2e/session-creation.spec.ts`：真实 Electron main / sandbox preload / 父子私有 IPC 配对 / Cookie / React / daemon；HTTP 丢失、SQL trigger、已有模型来源变化与 SDK error 是明确夹具。目录对话框结果由既有 helper 固定，不能计为本轮真实 Windows 选择器操作。隔离 daemon 为 4318；helper 转发 HTTP，消息终态由实际 JSONL 轮询核对，不能称为该隔离链路的 WS 流式验收。既有 CORE-05 原生 WS 契约继续在完整 CI 中运行。
- 合成 compositionstart / compositionend + keyboard Enter 只验证应用组合态处理；本轮另有实际 Windows 微软拼音证据，二者分开记录。
- [1080p 明色](session-new-light.png)、[800px 深色](session-project-dark-800.png)、[390px renderer](session-new-dark-narrow.png) 已目视检查，无横向溢出；390px 是 renderer viewport，原生最小窗口仍为 800px。

首次全量回归发现旧迁移模拟夹具遗漏新增表，以及无 preflight 的既有资源入口被额外 await 延迟；修正夹具边界和可选 preflight 分支后完整通过。迁移与 snapshot 由已安装 Drizzle CLI 生成。早期候选迁移曾用于本轮 `.workbench/e2e`，该临时测试目录保留到 `.workbench/session-01-prior-e2e`，全量 CI 从新目录验证；没有修改用户正式数据库。旧客户端 E2E 按统一设置中的资源信任入口更新，保留原授权断言。

## Windows 原生 Electron 补验

实际以 `pnpm exec node scripts/dev.mjs --desktop` 启动已构建入口（等同 dev:desktop 的运行阶段），数据根 `.workbench/session-01-native`，PIW_PI_AGENT_DIR 未设置。使用 Sky 对真实 Windows 窗口注入键鼠并观察系统候选框，没有用 DOM composition 事件替代输入法。目录修复与完整 CI 后再次启动最终实现复验。

| 操作 | 实际结果与证据 |
| --- | --- |
| 真实微软拼音 | 按 `n` / `i` 出现[系统候选框](native-ime-ni-candidates.jpg)；候选态 Return 提交原始拼音 `ni`，未发送（[提交后](native-ime-enter-no-send.jpg)）。`n` + Space 选出中文“你”，仍未发送（[中文提交后](native-ime-chinese-no-send.jpg)）。不声称 Return 选中了中文候选。 |
| 换行与首发 | Shift+Return 换行，补入验收正文；[发送前画面](native-multiline-before-first-send.jpg)与[只读计数](native-before-send.json)确认会话 / 提交 / 运行时均为 0。普通 Return 后[首发完成](native-first-send-completed.jpg)，SQLite 保存 1 会话 / 1 提交。 |
| 同会话续发 | [第二次发送完成](native-follow-up-completed.jpg)，仍为 `49fdca3a-98fa-41f7-9231-00ffb591774b`；[第一次运行审计](native-first-run-audit.json)为 1 会话 / 2 完成提交，原生 JSONL 保留两条用户输入和两条 `OFFLINE_OK`。 |
| 草稿与设置返回 | [已有会话草稿](native-existing-draft-after-settings.jpg)、[独立新草稿](native-new-draft-settings-return.jpg)经 Ctrl+逗号进入设置并返回后均保留，各自不串入其他会话。离开新草稿仍仅 1 个已保存会话，见 [计数](native-draft-counts.json)。 |
| 原生选择器与目录保留 | 未拦截的 Windows 文件夹对话框选择 `.workbench/session-01-native-workspace`，daemon 校验后显示真实路径；修复后[切换返回](native-directory-retained-after-switch.jpg)及[设置返回](native-new-draft-directory-dark-800.jpg)同时保留文本 / 目录。 |
| 指定目录首发 | [保存反馈](native-explicit-directory-saving.jpg)后生成 `436a6c3f-9efd-4b5a-b390-bd57205016e6`，回复 `OFFLINE_OK`；[最终只读审计](native-final-audit.json)确认真实 cwd 与所选路径一致，总计 2 会话 / 3 完成提交 / 3 完成轮次，均为 `real-sdk/local-fixture`，SQLite 审计前后哈希一致。 |
| 原生窄窗与主题 | 拖动真实窗口边框至原生最小宽度附近（截图外框 802×722，约 800×720），检查[浅色设置](native-settings-light-800.jpg)、[深色设置](native-settings-dark-800.jpg)、[深色会话](native-explicit-directory-completed-dark-800.jpg)及[浅色会话](native-explicit-directory-completed-light-800.jpg)。正文、目录、发送、设置返回和原生 caption 均可用；返回最新消息后终态可见。 |
| 最大化与退出 | [最终浅色最大化](native-session-light-maximized.jpg)为 1920×1032 屏幕工作区，保留原生窗口外框。两次实例均经 File → 退出应用正常退出，启动器退出 0；产品 / 测试端口无活跃绑定或连接。 |

完整操作与边界见 [原生验证清单](native-validation.json)。Ctrl+R 未注册为本应用刷新快捷键，因此该按键操作不算原生重载通过；真正重载由 Electron E2E 的 `page.reload()` 覆盖。未操作 Windows 系统主题设置，系统主题信号仍来自既有 Electron 自动测试。上述 IME 是实际系统输入法的键鼠自动化验证，不是人工逐键验收；真实提供商授权与联网发送未开放。

SESSION-01 四项验收勾选，OPS-08 仍 **in_progress**：完整会话视图恢复 / 旧 pi 历史、改名、业务审批 / 双端重连、M3 回滚和后续平台门禁按对应条目继续。下一项建议 SESSION-02；依赖 SESSION-01 / CORE-06 已满足。进度回填后重建看板 / PRD 并运行完整文档 check，不因仅文档更新再次运行已通过的产品 CI。
