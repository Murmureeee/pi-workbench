# INPUT-01 文本输入、中文输入法与草稿 · 验收记录

日期：2026-11-04。沿用 SESSION-01 / 02 的产品实现，新增两项实际 Electron 自动回归并完成 27 条原生观察；两项验收均通过。真实提供商请求 0，pi 配置和 canonical 预算未改，无安装包，独立网页版暂缓。

## 覆盖与证据

| 验收项 | 自动证据 | 原生证据 |
| --- | --- | --- |
| Enter / Shift+Enter / 中文组合态及纯空白拒绝 | session-creation.spec.ts 新增空白 / composition / isComposing / keyCode229 / 换行 / 单次发送 | native 04–15：空白不发、候选 Return 只提交拼音、Escape 取消、Space / 数字选中文、Shift+Return 换行，普通 Return 首发完成 |
| 新 / 旧独立草稿及正文 / 项目 / 模型切换与刷新恢复，不误发另一会话 | 第二项新测试覆盖 A / B 草稿、项目与已配置未联网模型、真实 Electron page.reload()、仅续发 B、源配置字节不变 | native 16–26：跨四个视图、导航后退和设置返回恢复新草稿配置；乙续发自身草稿完成，甲草稿未变 |

两项新增 Electron E2E 于 target.log 中通过（2 passed）。本轮未改产品代码；277 文件哈希核对仅 e2e/session-creation.spec.ts 与已通过 WS-03 clean 不同，所以只复用未变产品 / 运行时的 217 项 Vitest、72 项 E2E、SDK 冒烟和 frozen clean，不把新增测试冒充旧门禁内容。随后 SESSION-07 最终完整 CI 已包含这两项：223项Vitest／78项浏览器与Electron E2E及SDK冒烟通过，本次frozen clean通过，原始结果见[完整CI](../session-07-evidence/ci.log)和[clean](../session-07-evidence/clean-workspace.json)。

原生运行使用真实 main / sandbox preload / daemon / SQLite / SDK + 本地 HTTP 夹具，无 CDP、路由拦截或前端注入。两次种子任务与两次 UI 明确发送分开计数，最终仅 3 个会话 / 4 轮且全部 completed；甲仅种子、乙两轮、丙仅首发。配置 / 预算前后哈希相同，菜单正常退出、所属进程退出和端口释放见 native-final-closed.json / native-validation.json。

## 证据限制

本轮是实际 Windows 中文输入法，未独立重查厂商；文件名 microsoft-pinyin 不用作厂商结论。Unicode 直接输入第二行与真实键盘候选选词分开记录。原生 21 虽名为 reload，但 Ctrl+R / F5 没有建立真实刷新证据，仅证明配置保留；刷新由上述 Electron page.reload() 自动测试证明。最初两条无 PNG，不作为截图证据。草稿范围是当前窗口 sessionStorage 的刷新 / 淘汰恢复，不承诺整应用退出或跨窗口恢复；全局“新会话”仍明确默认无项目，项目入口才预选项目。

下一步提示词：完成 SESSION-07：无项目会话与独立执行空间。优先 Electron，覆盖无项目首发 / 续发 / 重启发现、实际独立目录、不继承项目能力、权限来源、产物持久及仅整理归属保留原始来源。默认离线，沿用验收与费用约束，不改 pi 配置、不额外调用模型、不制作安装包，网页版独立功能暂缓。完成测试和实际 Electron 验证，更新进度并给我下一步提示词。
