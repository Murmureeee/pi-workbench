# SESSION-11 验收记录

2026-11-03：实现、离线门禁与真实 Windows 中文 IME / 原生 Electron 验收均已完成，**三条验收全部通过**。用户明确允许继续控制后补齐证据；SESSION-11 标为 `verified`，验收勾选为 `[true, true, true]`。前置 SESSION-01 / CORE-06 已验收；canonical backlog 的本地完成数为 **17 / 133**，OPS-08 继续进行中。

来源为实际 SQLite、daemon、pi SDK 子进程 + 本地 HTTP 夹具、原生 TCP WS 和实际 Electron main / preload / renderer。真实提供商、工具与扩展仍关闭，新增真实提供商请求 **0**；未修改用户 pi 配置或 canonical 预算，未制作安装包。已有配对浏览器的历史标题只读同步，不开放独立网页改名。

## 逐项结果

| 验收项 | 已通过的实现与自动验证 | 原生补验结果 |
| --- | --- | --- |
| 预填、Enter / Escape、去首尾空白后 1–80 个 Unicode 字符、允许同名，ID / 历史不变 | Electron 侧栏与标题菜单共享官方 Dialog，预填并选中。Unicode 按码点计数，80 个 emoji 可保存、81 个及纯空白拒绝。SQLite 不设标题唯一约束，双同名保留身份；重启后标题 / 来源 / 版本持久，原 SDK JSONL 字节相同。Enter 保存、Escape 取消、编辑期间会话草稿保留。 | 标题与侧栏入口均预填全选；非组合态 Enter 保存、Escape 取消。草稿保留，同 data / profile 重启后人工标题及版本 3 保持，两个原生历史文件字节不变。 |
| 失败保留、版本冲突、其他客户端与索引同步 | 实际 SQLite trigger 注入写失败，旧标题 / 版本保持且输入保留；回执丢失显示“保存结果待核对”，不自动重试。两独立 Electron 和配对浏览器历史同步；并发 CAS 只有一方成功，另一方保留编辑并显示新标题，明确采用最新版本后仍须再次保存。标题索引立即更新，断线后补读真值，旧列表 / 续发回执不倒退标题。 | 原生点击保存触发隔离 SQLite 测试写失败，保留编辑，原名 / 版本 2 不变；移除夹具后再次明确保存成功，侧栏 / 标题 / 只读历史一致。多客户端与冲突复用已通过的实际双 Electron / TCP 门禁。 |
| 用户来源、后台命名保护、取消与中文 IME 不误保存 | 人工保存置为 user 并递增版本；本地候选必须匹配创建请求 / 版本且仍为 local，迟到旧版本及匹配新版本的后台候选均不能覆盖人工标题；续发不重新命名。Electron 合成 composition / Enter / Escape 已验证不会误保存 / 关框。 | 真实微软拼音候选面板中，Enter 提交字面 ni、Escape 取消组合输入、Space 选入中文“你”均不误保存或关框；之后明确 Enter 才保存为 user / 2。原生输入证据与合成 composition 分开记录。 |

人工编辑固定打开时的版本；其他客户端更新不会改写输入或静默 rebase。保存互斥由同步 ref 保证，回执只更新所属会话；隐藏 / 淘汰视图关闭其弹框，旧实例的迟到保存不会关闭新实例的编辑框。活动窗口 / 页签标题及侧栏版本合并来自同一权威，重命名不导航、不改变运行、组织 / 未读、cwd 或会话草稿。

## 实现与协议

- `packages/shared/src/session-titles.ts`：Unicode 输入、CAS、标题元数据及独立观察帧契约。
- `apps/daemon/migrations/0006_session_titles.sql`：新增来源 / 版本，已有标题保留为 local / 1；由 Drizzle 生成并审查 migration / snapshot。
- `SessionStore.rename` 单语句 SQLite CAS；`SessionService.rename` 统一脱敏、提交后通知。`POST /api/chat/sessions/:id/title` 继续要求 desktop 身份、Host / Origin / JSON / CSRF / 协议能力，不启动 SDK 或修改 JSONL。
- `GET /api/session-titles` 是已配对客户端的只读标题索引，可作标题字面查询；完整正文搜索、分页、项目与归档筛选仍属 SESSION-12，未提前验收。
- `/api/events` 的 `subscribe-titles` 与运行订阅分开，沿用认证撤销、订阅时限、心跳和有界缓冲。标题通知不进入模型 epoch / seq；重连确认后重读索引，不重放改名命令。
- 官方 shadcn Base UI / base-nova Dialog 源码经 CLI docs / view / dry-run 审查后加入，沿用已有 Button / cn / Lucide；无新依赖或锁文件变化。业务交互在 conversation feature，版本合并在客户端服务。

## 自动门禁

- `pnpm fix` 退出 0；最终完整 `pnpm run ci` 退出 **0**，见 [ci-complete.log](ci-complete.log)：**22 文件 / 185 项 Vitest、53 项浏览器与 Electron E2E、SDK 冒烟**全部通过。
- 新增 **6 项** `apps/daemon/test/session-titles.test.ts`：Unicode / 同名 / 持久化、两端 CAS / 认证、写失败、人工保护 / 续发、双 TCP 观察 / 脱敏 / 撤销 / 重连、旧库迁移。已加入 `test:contracts`，完整 test / CI 本来就运行同一批测试。
- 新增 **4 项** `e2e/session-titles.spec.ts`：实际 Electron 预填 / Unicode / Enter / Escape / 草稿 / 主题，故障与合成 IME，两 Electron + 只读浏览器同步 / 冲突 / 重连，旧列表 / 回执隔离。
- 本次 `pnpm verify:clean` 退出 **0**：[结果](clean-workspace.json)、[命令全文](clean-commands.json)、[日志](clean.log)。独立 `D:/Project/.piw-clean-eb7L6v` 的 frozen 安装、check、build、185 项测试、SDK 冒烟、健康检查及服务正常退出通过。工具报告保留 OPS-01 标识，不代表安装包验收。后续仅更新本任务文档 / 进度；产品、依赖、构建与迁移未再改变。
- 锁文件 SHA-256：`d9d46d301907ef4d86e5c53de3eca57433f5978ebf1e6547f8d094f50a60b40a`，与 frozen 副本相同。预算 SHA-256：`cbc52551a5e083e17dd8f1f2343a67ebab8b05a199b53ecb5d48be48f25f1251`，前后不变。

[1080p 亮色](session-title-light.png)、[深色](session-title-dark.png)和[860px 窄窗](session-title-narrow.png)均经实际截图复核。专项包含 pageerror 检查。故意注入的 SQLite / renderer 故障是测试输入，不能据此掩盖门禁失败。

首轮 [ci.log](ci.log) 如实保留：185 项测试通过，E2E 为 51/53，失败是旧测试将所有连接限制为 3，以及标题观察在无标题网页启动导致隔离 trust 夹具连接错误。现在明确保持最多 3 个会话视图 / 运行观察，另有 1 个应用级只读标题观察；无标题网页不建立标题观察。修正后两项在最终完整回归通过，未删测试或过滤控制台错误。

第二轮 [ci-final.log](ci-final.log) 的 check / test / SDK 冒烟通过，E2E 启动被旧测试数据目录的进程租约拒绝。当时产品端口未占用，随后核对原 PID 已退出；不据此无证据推断 PID 复用的确切时刻。测试服务现使用每次运行独立的 `.workbench/e2e-<UUID>`；未删除旧租约、停止无关进程或放宽产品租约，最终完整 CI 与 clean 均通过。

## 原生 Electron 与真实微软拼音验收

[原生结果](native-validation.json)与[逐步时间线](native-steps.json)记录本轮 17 个检查点、18 张产品截图。使用 `computer-use` 的 `@oai/sky` SendInput 操作真实 Windows 微软拼音和 Electron；不是 DOM 合成事件，也不冒充人工逐字手测。先前暂停记录保留为 [native-paused.json](native-paused.json)，当时无原生输入且无关全屏截图未归档。本轮每次重新发现唯一任务窗口，实际原生工作区最大为 1920×1032；1920×1080、深色及窄窗继续复用前述实际 Electron E2E。

标题菜单和侧栏菜单均打开同一预填全选框。真实物理按键 n / i 显示微软拼音候选面板；候选态 Return 提交的是字面 `ni`，对话框保留，SQLite 标题仍为 local / 1，**不声称 Return 选中了中文**。已提交 ni 后再输入 n，候选态 Escape 仅取消该组合输入，ni 和对话框均保留；后续非组合态 Escape 才取消改名。另一次 n + Space 选择“你”，未误保存；再明确 Return 保存为 user / 2。见[候选面板](native-ime-ni-before-enter.jpg)、[Enter 后](native-ime-enter-not-saved.jpg)、[Escape 后](native-ime-escape-keeps-dialog.jpg)与[中文选词后](native-ime-selected-not-saved.jpg)。

隔离宿主用显式 SQLite trigger 注入标题写失败；原生点击保存后显示“保存结果待核对”，保留 `你 · 原生恢复验收 🧪` 编辑，数据库仍为“你”/ user / 2。恢复夹具后没有自动提交；再次明确点击保存成功，标题 / 侧栏 / 只读历史更新，未发送草稿全程保留。见[失败截图](native-save-failure-retains-edit.jpg)、[失败审计](native-failure-audit.json)、[恢复截图](native-save-recovered.jpg)及[历史标题](native-history-title-synced.jpg)。这是真实 SQLite 测试故障，不是实际磁盘损坏；恢复标题由 literal type_text 输入，不计作真实 IME。

从“文件 → 退出应用”正常退出，再以同一 `.workbench/session-11-native-32QyCq` data / profile 重启；侧栏、打开后的原会话与原生窗口标题均为 `你 · 原生恢复验收 🧪`，来源 user、版本 3、ID / cwd / 原有消息不变。重启无内核、无重发；两个 SDK JSONL 在退出 / 重启前后 SHA-256 相同。见[首轮正常关闭](native-first-closed.json)、[重启审计](native-restarted-audit.json)、[重启截图](native-restarted-session.jpg)、[历史前](native-history-hashes-before.json) / [历史后](native-history-hashes-after.json)及[最终关闭](native-final-closed.json)。两次宿主均退出 0 且输出 NATIVE_CLOSED_OK，隔离配置和 canonical 预算未变，原生输入期间 SDK prompt 为 0，真实提供商请求 0；验收环境已正常关闭。

本轮未修改产品代码。[230 个产品 / 测试 / 根配置文件比对](native-code-reuse-audit.json)与 clean 副本一致，锁与预算哈希不变，按用户要求复用已通过的完整 CI / clean。两独立 Electron + 只读浏览器、CAS、重连、人工保护和 1–80 边界由既有真实服务 / Electron 自动门禁证明；本轮原生只操作一个 Electron，不混淆来源。[宿主原日志](native.log)保留之前构建时的 Fast Refresh 失效 / WS ECONNABORTED 及本次预期 SQLite 夹具错误，[重启日志](native-restart.log)和持久审计记录正常结果，不以删日志消除错误。

进度回填后，[docs:build](docs-native-final-build.log)、[pnpm fix](docs-native-final-fix.log)和完整 [pnpm check](docs-native-final-check.log)退出 0，生成看板 / PRD / 功能清单与 canonical backlog 一致；`git diff --check` 通过。

下一步提示词：

> 完成 WS-02：最近工作区与重命名。优先 Electron，覆盖最近列表和自定义名称的重启持久、明确排序规则、失效目录诊断、移除记录与重新定位；不删除目录或会话，不隐式切换运行中会话目录。默认离线，沿用现有验收与费用约束，不自动改 pi 配置、不额外调用模型、不制作安装包。完成测试和实际 Electron 验证，更新进度，并给我下一步提示词。
