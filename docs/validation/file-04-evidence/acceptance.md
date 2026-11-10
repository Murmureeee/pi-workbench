# FILE-04 · 图片、文档与产物预览

状态：已验收，两项均通过。FILE-02、FILE-07 均重新核对 verified；FILE-03 已独立提交 d550761，FILE-07 已验收并独立提交 247feba 后才开始本项。OPS-08 继续跨阶段 in_progress [true,false]，UX-01 不变。本批交付记录另列三项提交号及下一步提示词。

范围与运行规则见[实施方案](../../architecture/implementation-plan.md#file-04-有界文件与产物预览规则)。当前物理 cwd 的单链接普通 PNG／JPEG／PDF 与严格 UTF-8 HTML、TXT／MD／JSON／CSV／LOG；真实路径、来源未判定、完整身份／字节版本；历史链接明确只提示当前路径，不替代历史产物或 Diff。PNG／JPEG 8 MiB／8192 边长／1600 万像素；PDF 8 MiB／12 页，全部页本机静态渲染，每页最多1200×1800、总PNG16 MiB、30秒，失败整份拒绝；文本256 KiB／10000行，HTML无外部资源和脚本。二进制原件含可识别原始文本秘密时拒绝，图像不作OCR或承诺识别压缩／未知秘密；不上传原件。

窗口复用 FILE-07 非持久 session、无 preload／Node／JavaScript／配对身份、沙箱和固定协议；只有生成图像的精确资源请求可读取本窗口静态 PNG。PDF 原生助手只接收 stdin 内存字节，无原件路径／临时PDF／活动viewer。取消、超时等待自有进程退出，关闭清理内容／计时器／协议／存储；崩溃独立。可见两秒及聚焦复验，失效隐藏旧内容且需明确重开。原件原生菜单复用 FILE-06 单操作通道和版本／物理路径证明；不提供内容下载或外链。顶部可滚动、默认随系统，支持本预览的浅色／深色顶部选项；不改变原件CSS。

验证方案：真实文件与完整二进制版本／竞争、长中文路径、链接／硬链接／权限和来源边界；实际 Windows.Data.Pdf CLI 的全页渲染、损坏、页数上限、取消与恢复；实际隔离Electron内图片解码／PDF像素、攻击资源／跨窗口／宿主边界、原件菜单重验、改写替换删除、取消迟到和失败恢复。完成开发与命令行门禁后执行Electron和Windows原生，再核对同data/profile重启、零重放／后台PID、明暗窄窗、正常退出、Git／历史／五保护文件。真实SDK本地夹具、合成观察、故障注入、自动窗口与原生证据分别记载；真实提供商0。

## 验收与门禁

| 验收项 | 实际证据与结论 |
| --- | --- |
| 每个预览显示路径和来源，可打开原件或下载 | 可信顶部显示真实物理路径、当前磁盘／来源未判定、完整版本、大小及读取时间；PNG、JPEG、两页 PDF、HTML、纯文本及长中文路径均在实际 Electron 显示。原件菜单复用 FILE-06 版本证明，变化后不能交付旧版本。Windows 原生另证实 Explorer 选中正确原件、照片应用实际打开 640×400 PNG。本项提供原件打开，内容下载保持关闭。 |
| 不支持、超限时有替代入口，不上传 | SVG、损坏图片／PDF、像素／字节／页数超限完整拒绝，工作台保留 IDE／文件管理器及适用系统入口；不返回部分文档。实际本机监听器、隔离上下文及 PDF 动作夹具请求为 0，不使用远端转换服务。 |

新增 4 项实际文件／SQLite／SDK 服务测试及 3 项实际 Windows.Data.Pdf 测试，覆盖完整二进制版本、同长度外改、替换／删除、签名／超限／敏感文本拒绝、原件交付、重启后历史账本／Diff 不变、全部页静态渲染、损坏／页数限制／取消和恢复。前置 FILE-07 的路径／junction／硬链接／身份撤销及四名额边界继续复用。

新增 5 项 Electron 自动回归：真实图片／PDF 像素与纯文本、原件菜单和粘性失效、降级／取消／导航迟到、跨预览资源隔离／后台 PID／明暗窄窗／同 profile 重启，以及实际 PDF helper 运行中正常退出并等待子进程结束。前置 FILE-07 的 3 项实际攻击／故障／崩溃回归同时通过；[定向 8 项日志](electron-2.log)和[实际预览结果](artifact-preview-results.json)分别保留。

完整 `pnpm run ci` 退出 0：70 文件／471 项 Vitest、安装 SDK 的本地 HTTP 冒烟、188 项浏览器／Electron E2E 全部通过。完整 `pnpm verify:clean` 退出 0：新目录 frozen 安装、check、build、471 项测试、SDK、HTTP 200 及正常服务启停通过。492 个产品／测试／脚本／配置输入与 CI 快照及 clean 副本逐个 SHA-256 一致，原生后产品源码未变，按用户授权复用门禁。文档收尾另跑格式化、生成和完整 check。见[CI](ci.log)、[clean](clean.log)、[命令](clean-commands.json)、[clean 工作区](clean-workspace.json)和[源码核对](source-audit-final.json)。

## Windows 原生、历史与生命周期

150 条 Windows Computer Use 观察含中间态，未使用原生 CDP 或 renderer 注入。其中一条 Explorer 完整 AX 及截图因无关收藏夹隐私不公开；公开记录保留该步省略说明，其余 149 条 AX 和必要的 9 张截图归档。原件由显式 CLI 写入，不冒充 SDK 生成产物。

原生覆盖 PNG／JPEG 实际像素、PDF 全部两页并滚到第 2 页、外部改写后旧 PNG 隐藏和明确重开、PDF 删除后旧页隐藏／恢复不自动加载／明确重开、SVG 与损坏 PDF 拒绝、五层长中文物理路径、HTML 文件选择／外链／下载／vscode 协议点击无动作，以及含 `<script>` 的 MD 按字面纯文本显示。预览约 793px 浅色／深色顶部、工作台 802×961 明暗会话和设置均实际观察；原件图像像素不随主题改变。

后台实际 SDK PID 10388／epoch ccbab5c2-d146-4818-90ca-826ad4e6864e 在 6 条观察区间内保持，之后通过显式 CLI 停止，SQLite 最终为 aborted；不称全程运行或原生停止按钮证据。保留纯文本预览时菜单正常退出，预览随应用关闭；同 data/profile 重启只出现主窗口，0 预览／0 新发送／0 内核／0 待审批／0 授权，只读打开原会话正常。两次菜单退出均 code 0、自有子进程已退出，两份 settled JSONL、隔离用户 Git HEAD／index／日志及五保护文件哈希不变。原目录七项用户未提交文件继续逐哈希核对一致。见[原生汇总](native-validation.json)、[逐步记录](native-observations.json)、[第一次正常退出](first-closed.json)及[重启后退出](restart-closed.json)。

原生 HTML 恢复夹具保留了首段 trap URL，恢复后的监听端口不同，因此不将恢复段 0 请求用作实际网络隔离结论。活监听器下的 HTTP／WS、Cookie／storage／preload／Node、宿主文件／daemon、导航／下载／协议、跨窗资源及崩溃隔离由实际 Electron 自动测试证明；[攻击结果](preview-attack-result.json)中的 sendBeacon true 只表示排队，实测未发送。没有新增真实 IME 候选证据；刷新／取消迟到另据 Electron page.reload 自动测试。

## 失败、修复与限制

初轮 WinRT AsTask 重载选择及 void 标记输出使 PDF 安全拒绝，修正后 CLI 两页渲染与视觉检查通过。一次服务夹具重启后仍引用已关闭 app，导致数据库未打开，改为使用重启后的 app。初轮类型／lint 和测试标题大小写失败均保留；修正后完整 CI 通过。初轮 Electron 失效窗口关闭触发 `view.webContents` 已清空异常，保留稳定 contents 对象与 ID 后定向 8 项、完整 CI／clean 通过，没有放宽隔离或跳过用例。见[初轮 Electron](electron-initial.log)、[异常定位](electron-error-diagnostic.log)、[初轮服务](service-2.log)、[PDF 初轮](pdf-cli-initial.log)及[CI 初轮 lint](ci-first-lint-failed.log)。

原生首段在关闭照片后请求 PNG 外改时，夹具宿主和 Electron 退出，未得到 first-closed.json，不能计作正常退出。PowerShell 报 CLIXML Error 流解析失败，外改未记录成功，PNG 仍为原 4839 字节；Windows Application 日志没有对应错误。根因未建立，不能归因为文件锁或已修复的产品崩溃。[原始失败日志](native-first-failed.log)和[放弃首段审计](native-initial-abandoned.json)保留。随后仅对 ignored 夹具增加 uncaughtExceptionMonitor，不吞异常、不改产品；同 data/profile 恢复重复 PNG 改写、PDF 删除恢复、关闭失效预览均成功，无 native-errors.log，且完成上述两次正常退出。该首段作为未复现的夹具异常及诊断限制保留，验收结论依据完整自动门禁与恢复后的完整原生场景。

PDF 为 Windows 原生全部页静态像素，支持有界文档；没有选择文字、活动表单、附件、签名验证或跨平台原生解码。未知／压缩内容秘密与图像秘密不承诺识别，未做 OCR。文件变化检测为采样，非 OS 锁；外部应用打开路径后自行读取，不宣称原子快照交付。完整退出不恢复预览，FILE-03 的草稿退出规则仍适用。真实提供商请求 0，pi 配置／canonical 预算／锁未改；不接 FILE-05 开发服务器，不改历史 Diff、接受决定或用户 Git 提交历史。

## 经依赖核对的下一步

推荐 GIT-02「创建独立 Worktree」，GIT-01 与 WS-04 已 verified；只保存提示词，不在本任务继续实现。FILE-05 的 EXEC-04 尚未开始，不能因 FILE-07 已通过而直接验收或开始 FILE-05。完整下一步提示词及三项提交号见本批交付记录。

提交审查：暂存 64 个本项路径，其中 35 个必要证据文件约 2.2 MiB；没有运行数据库、Cookie、trace、依赖或用户配置密钥。源码／配置／普通文档的 `git diff --cached --check` 退出 0；包含原始日志的完整检查退出 2，来自原样保留的 CRLF／输出尾空格等证据字节，按 .gitattributes 不规范化，也不冒充完整检查通过。原目录与 UX-01 的实际内容／状态没有混入本项暂存。
