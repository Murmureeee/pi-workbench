# clean 验证副本生命周期：审查与验收

2026-11-10。工程维护关联 OPS-01 / OPS-08，不新增功能 ID，不修改 canonical backlog 或产品完成数。按用户要求审查 `D:/Project/pi-workbench` 的 7 项未提交改动，在包含最新 FILE-03 / FILE-07 / FILE-04 的 `110bd4fd8113c987f4cffe067faff222490440e5` 上保留有用代码；工作分支为 `codex/clean-workspace-lifecycle`。

## 原改动的去留

| 路径 | 结论与依据 |
| --- | --- |
| `.oxlintrc.json` | 保留；使 `.test.mjs` 同样受 Vitest 规则约束。 |
| `vitest.config.ts` | 保留；将脚本测试纳入正式 Vitest / CI。 |
| `scripts/clean-workspace.mjs` | 保留；集中管理本次 clean 副本、身份核对、证据与有条件清理。 |
| `scripts/clean-workspace.test.mjs` | 保留；9 项实际文件系统 / 子进程测试覆盖删除与保留边界。 |
| `scripts/verify-clean.mjs` | 保留；接入生命周期，等待子进程 `close` 及输出排空后收尾，隐藏本任务子进程窗口。 |
| `docs/development/tooling.md` | 保留；说明默认清理、显式保留、失败现场和证据位置。 |
| `apps/daemon/test/file-reading.test.ts` | 撤回旧补丁；最新实现已有双遍实际字节校验，强制推进 mtime 会削弱相同时间戳变化的回归覆盖。当前最新测试保持原样，8 项实际文件读取测试通过。 |

原目录的 7 文件有逐项 SHA-256 与本地备份；有用改动提交、推送并核对远端后，才按原始 SHA 和 HEAD 再核对原目录，精确撤去重复改动及过时补丁。若发现后续用户改动则保留，不用批量 reset 或 clean。原始 SHA 与决定见 [validation.json](validation.json)。

## 运行规则与实现

每次在仓库同级创建一个专用 `.piw-clean-*`，记录创建时物理身份和父目录身份，只管理本次创建的副本。全部验证、服务正常退出、输出流关闭、锁文件一致与证据保存完成后，默认删除本次副本。`PIW_KEEP_CLEAN=1` 显式保留成功副本；验证失败或中断保留现场。

递归删除前核对绝对路径、同级父目录、专用名称、父目录和目标目录物理身份、realpath 及非链接属性；拒绝删除被替换的目录、根 junction 或包含源目录 / 证据目录的副本。依赖内 junction 仅移除链接，外部目标保持。Windows 占用错误最多重试 3 次，清理失败使命令失败并报告路径，不批量清理旧副本。

`clean-commands.json`、`clean-workspace.json`、`clean-cleanup.json` 写入源项目证据目录。初始状态 `kept-incomplete`、失败 `kept-failed`、显式保留 `kept-requested`、通过待清理 `pending-cleanup`、已删除 `removed` 与清理失败 `cleanup-failed` 分开记录。强制终止可能保留初始状态，不将其误标为通过。

9 项 Windows 实际测试覆盖成功仅删本次副本、失败保留及原错误、显式保留、真实子进程被终止、证据初始化失败、目录被替换、根 junction、嵌套依赖 junction，以及证据被重定向到副本内部。没有用合成文件系统替代这些测试；实际完整 frozen 安装也验证了真实依赖副本的清理。

## 验证结果与失败记录

| 阶段 | 实际结果 | 证据 |
| --- | --- | --- |
| 定向服务 / 工具测试 | 2 文件 / 17 项通过：9 项清理测试、8 项文件读取测试 | [validation.json](validation.json) |
| 首次完整 `pnpm run ci` | check、71 文件 / 480 项 Vitest、真实 SDK 本地 HTTP 冒烟通过；窗口 187/188，整体退出 1 | [ci-initial.log](ci-initial.log) |
| 修正后的相关 Electron 文件 | `workspace-recovery.spec.ts` 4/4 通过，退出 0 | [window-followup.log](window-followup.log) |
| 原失败场景额外重复 | 2/2 通过，退出 0；连同上一行，该场景连续 3 次通过 | [window-repeat.log](window-repeat.log) |
| 最新源码完整 `pnpm verify:clean` | frozen 安装、check、build、71 文件 / 480 项测试、SDK 冒烟全部退出 0；HTTP health / UI / module 为 200，服务正常退出，锁 SHA 一致 | [clean-commands.json](clean-commands.json)、[clean-workspace.json](clean-workspace.json) |
| 成功副本清理 | `.piw-clean-1gqAYR` 实际不存在，状态 `removed` | [clean-cleanup.json](clean-cleanup.json)、[validation.json](validation.json) |
| 输入一致性 | 最终 496 个产品 / 测试 / 脚本 / 根文件在验证后无 SHA 变化，锁与 canonical 预算保持 | [source-audit.json](source-audit.json) |

首次窗口失败是 WS-07 用例连续发送方向键时尚未结束原生平滑滚动，几何轮询短暂满足后又移出视口。测试修正为最多 12 次真实键盘手势，每次等待滚动位置稳定至少 200ms，再决定方向；最终 `toBeInViewport({ ratio: 1 })` 完整可视断言与失败诊断保持。没有修改产品源码或直接写入 scrollTop。

修正后仅该测试文件变化：最终窗口覆盖由首次完整执行中未变的 184 项与修改文件重新验证的 4 项共同支持；没有再次运行一条退出 0 的完整 CI 命令，也不将首次失败记为通过。最新完整 frozen clean 已覆盖修正后的所有测试 / 工程输入。后续仅增加本验收说明与工具文档链接；收尾 `pnpm fix` / `pnpm check` 结果记入 [validation.json](validation.json) 的 `docOnlyFinalChecks`，源码 SHA 不变时复用上述测试与窗口证据。

## 边界与后续

本次没有新增人工 Windows 窗口 / 真实 IME 证据。来源为实际 Windows 文件系统、本地子进程、SQLite / 文件读取服务、真实 SDK + 本地 HTTP 夹具及自动浏览器 / Electron 回归。故障注入、首次失败及后续通过分别记录；真实提供商请求 0，不读取或修改用户 pi 配置，不改 canonical 预算或锁文件。

清理前的身份核对不构成 OS 沙箱或对任意恶意并发替换的原子删除保证；仅用于本任务创建的专用验证副本。强制结束验证会留下现场及初始报告，历史副本继续由人工按归属检查。

OPS-08 继续按跨阶段门为 `in_progress`、`[true, false]`。下一批按 canonical 依赖推荐 EXEC-04 → EXEC-05 → FILE-05：CORE-06、WS-01、WS-04、FILE-07 已 verified；EXEC-04 / EXEC-05 / FILE-05 仍未开始。推荐不代表本轮已执行或已验收这些功能。
