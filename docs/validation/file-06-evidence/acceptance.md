# FILE-06 外部 IDE、文件管理器与系统打开

## 运行规则

开始时核对 FILE-02 已 verified，R8-01 优先 VS Code 且可更换。INPUT-03、OBS-05 已各自验收提交；本项仅增加主动外部打开，不实现工作台文件编辑、终端、服务器预览或附加根。原目录未提交工作及 UX-01 保留。

- 仅配对桌面主 frame 的固定 preload 操作可请求。renderer 传所属会话／工作区、原文件句柄或路径提示及行号；不传任意程序、参数模板、URL、shell 或系统选项。daemon 每次复用 FileService 的物理 cwd、目标归属、链接／私密／歧义路径拒绝及 IO 收尾，再通过父子私有 IPC 返回短期路径证明；不新增返回原始路径的 REST。父进程在 IO 前后核对 desktop 身份，重启／过期授权失效。
- main 在实际交给外部程序前重新检查物理根、祖先身份、普通文件／目录与版本戳。代码阅读传原版本，已变化必须明确刷新；行号限定 1–10000，超过首行必须验证当前有界 UTF-8 的实际行数。目录只传真实目录路径。不把历史 Diff／消息行号天然视作当前行号。
- 默认只读发现标准安装和绝对 PATH 对应的 VS Code 可执行文件（可从 bin 推导上级 Code.exe，不运行 code.cmd）。用户可用原生选择器选择其它真实 .exe，明确选择 VS Code、JetBrains 或仅路径参数格式。选择只保存到该 Electron profile，单独点击才打开；选择取消／写失败保留原设置，不自动安装、不修改用户 pi 配置。已选程序变化／失效须重新选择或恢复自动发现。
- 使用 spawn(executable, argumentArray, {shell:false})，VS Code 以新窗口及 --goto 传真实路径与行号，JetBrains 使用 --line，通用程序仅路径并说明不传行号。文件管理器定位和适用文档／图片的系统打开仅接收重新核验的路径；脚本、可执行、快捷方式、HTML／SVG 等不走系统打开。不将外部应用视为受管 SDK 或 OS 沙箱。
- 窗口同一时间只执行一个外部动作。关闭／切换所属视图使尚未交付的请求失效；迟到证明不能打开另一个目标，重复请求 ID 不复用旧证明。已交付外部应用的请求不假装可撤回，不关闭用户其它应用。守护进程 IO 取消仍等真实 settle，窗口切换不停止对话任务。
- 说明“已请求打开／定位”与外部应用实际显示是不同证据。程序缺失、权限、启动失败、路径变化、宿主断开和不可用系统关联提供明确恢复动作。外部程序独立运行，应用重启只恢复编辑器选择，不自动打开文件、重放动作、恢复授权或启动内核。

## 验证方案与当前状态

使用实际文件、SQLite、独立账本及 SDK 本地 HTTP；服务验证物理范围、版本／行号、跨目标／链接／权限、身份失效、并发与关闭。实际子进程夹具核对精确 argv 与失败，Electron 自动回归覆盖主进程 sender/frame/Origin、固定契约、原生选择结果夹具、取消迟到、失败恢复、后台、明暗窄窗和同 data/profile 重启。开发与命令行验证之后，再做真实 VS Code／文件管理器／系统打开及正常退出的 Windows 原生观察，明确区分夹具和真实应用。

- [x] 路径与行号、IDE 发现／选择及失效恢复通过实际服务、自动与原生验证。
- [x] 缺失／失效／权限／启动失败和参数边界通过验证；完成格式化、完整 CI、frozen clean、源码及保护审计。

两项 canonical 验收均 verified。真实提供商 0，用户 pi 配置、canonical 预算、锁文件不改，OPS-08 保持跨阶段 in_progress [true,false]。

## 实现与验证结果

共享固定契约贯通 renderer／preload／main／父子私有 IPC／daemon。FileService 继续独占授权目录与 4 个文件 IO 槽，取消仍等真实 settle，关闭先 drain 再释放 SQLite。main 最后重验 5 秒物理证明，IDE 发现／程序选择／持久偏好与文件系统打开各有固定边界。原子保存失败保留旧选择；profile 只保存程序路径、身份戳与固定 adapter，不保存打开动作或授权。

- 9 项实际服务／Node 集成：真实文件、SQLite、授权根及跨目标、链接／硬链接、文件／祖先／版本／行号／期限变化、身份撤销、4 个并行 IO 与关闭 drain、精确 argv、原生程序权限、早退失败和 profile 变化。独立 Git 账本随既有真实会话夹具初始化，不操作用户 Git 历史。
- 5 项实际 Electron 回归：固定 bridge／sender／主 frame／Origin、原生选择结果夹具与真实无窗口子进程、中文路径和行号 argv、失败恢复、拒绝脚本系统打开、忙碌／重复／取消／迟到、视图切换与完整 navigation、后台同 PID、明暗窄窗及同 profile 零重放。自动测试中的 dialog 结果和 shell handoff 明确为替身；argv 由实际本地 C# 程序接收，该夹具不是 IDE。
- `pnpm fix`、最终完整 `pnpm run ci` 全部通过：67 文件／450 项 Vitest、真实 SDK 本地 HTTP 冒烟、175 项浏览器／Electron E2E，退出 0。`pnpm verify:clean` 在新目录 frozen 安装、完整 check／build／450 项测试／SDK、服务与 UI health 及正常关闭全部退出 0，锁哈希一致。
- Windows 原生之后 473 项产品／测试／脚本／根配置与最终 CI 和 clean 逐项 SHA-256 一致，复用通过门禁。之后只更新验收、canonical、生成文档及协作说明，再执行 docs:build、fix、check；不冒充另一次完整 CI／clean。

完整输出见 [ci-final.log](ci-final.log)、[clean-workspace.json](clean-workspace.json)、[clean-commands.json](clean-commands.json)、[validation.json](validation.json)及 [source-audit-final.json](source-audit-final.json)。

## Windows 原生与来源

123 条原生观察含过渡状态，使用 sky 原生输入，没有 selector／shell 替身。真实 VS Code 自动发现后从工作台选第 2 行打开中文文件，实际编辑器状态栏为 Ln 2, Col 1；没有额外手动跳行。真实 Explorer 选中 `中文打开.ts`。原生程序选择取消保留旧偏好；选择隔离本地程序只保存，未自动启动；CLI 删除该隔离 exe 后刷新显示缺失、IDE 按钮禁用，恢复自动发现及重新选择真实 Code 均可恢复。

802×961 明暗窄窗实际检查外部操作、文件阅读与设置返回，中文未发送草稿保留。后台任务由显式 CLI 启动真实 SDK 本地夹具，在跨会话与外部操作面板检查期间保持 PID 31760／epoch 1309deb5-ad0a-4c57-935b-86a35a6248ad；CLI 明确 abort 后才 stopped，不把切换视图当作停止。CLI 将实际文件从 61 字节改为 25 字节，原生观察到旧正文隐藏和外部操作禁用；明确刷新才显示 `export const 外部 = 9` 并恢复按钮。

两次实际文件菜单正常退出，Electron 与宿主均退出 0，受管 PID 已结束。同 data/profile 重启 0 prompt／0 内核／0 待审批／0 会话授权，两个 settled JSONL 哈希不变，保存的 Code 选择保持且没有自动外部窗口。五项配置／预算／锁保护哈希不变。审计见 [native-validation.json](native-validation.json)、[native-observations.json](native-observations.json)、[first-closed.json](first-closed.json)与 [restart-closed.json](restart-closed.json)。

系统 `.txt` 打开实际到达 Windows“选择一个应用以打开此 .txt 文件”。只证明操作系统接收请求和显示选择器，没有最终 Notepad／关联程序启动证据。随后“仅一次”尝试因激活 owner 而回到后方阅读入口，不能算成功打开；没有修改持久关联或安装软件。产品只承诺“系统已接收打开请求”。

20 条含原生文件列表或 Explorer 叠层的 accessibility 为隐私省略；原始截图／树保留 ignored，不入库。Explorer 截图只裁保留夹具选中区域，系统选择器只裁保留标题和默认项，裁剪坐标与原件哈希在 native-validation.json。其余精选截图为原始产品／Code 窗口，未伪造状态。中文草稿用 native set_value，没有新增真实 IME 候选证据；此前 INPUT-03 的真实 IME 验收独立保留。

## 失败记录与限制

首轮完整 CI 为 174／175：既有 WS-01 测试仍精确预期旧 4 个 bridge 方法，加入新方法后该白名单断言失败；修正为精确 8 个，继续断言不暴露 require／process。另清理两处新测试 AccessService 实例，随后最终完整 CI、clean 均通过。原文保留在 [ci-first-failed.log](ci-first-failed.log)。初轮新增 Electron 测试在仍打开的文件浏览遮罩下查主输入框失败，补齐关闭浏览后通过；见 [e2e-first-failed.log](e2e-first-failed.log)。原生程序 ACL 测试最初使用 SID 时缺少 icacls 数值 SID 的 `*` 前缀，修正后实际拒绝执行／恢复通过；日志中 SID 脱敏，见 [service-acl-first-failed.log](service-acl-first-failed.log)。临时从 e2e 目录直接类型诊断无法解析 shared 的错误保留 [type-diagnosis.log](type-diagnosis.log)，最终按根工具配置检查通过。

早期阅读句柄自然达到 300 秒期限，原生旧内容隐藏不算真实外部编辑；刷新文件列表取得新句柄后才继续。更晚的真实外部修改有独立字节和原生证据。主题原生组合框的一次 AX 点击遇 owner 弹出层遮挡，重新激活、截图核对后用键盘确认深色，未把报错当成成功。

外部程序通过路径接收操作；最后物理检查与外部程序自己打开之间仍存在 OS 路径竞争窗口，不宣称句柄级原子打开或 OS 沙箱。只在当前授权目录内重验，IDE 独立管理它自己的权限与行为；不承诺未知 IDE、任意文档类型或外部应用后续渲染成功。默认只发现 VS Code，JetBrains 参数通过实际 argv 夹具验证，未独立启动真实 JetBrains。当前 Windows `.exe` 选择规则，其他系统不以本次证据验收。外部应用已收到请求时取消不能撤回，不会杀外部程序。未发送窗口草稿不承诺跨完整应用重启。

## 下一步提示词

FILE-03「轻量文件编辑与保存冲突」的前置 FILE-02、CHANGE-02 已重新核对 verified；本批不实现该项。下一轮从当前 `codex/input-links-open` 工作树继续，保留原目录未提交工作与 UX-01。完整可复制提示词见本批交付记录；内容包含物理身份与写入互斥、读取版本冲突、撤销／编码／换行、未保存稿、用户来源及离线完整验收约束。
