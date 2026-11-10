# FILE-07 · 预览隔离验收

状态：已验收，两项均通过。前置 SEC-08、SEC-10 已重新核对 verified；FILE-03 已独立提交 d550761。OPS-08 继续 in_progress [true,false]。本项独立提交后才进入 FILE-04。

运行规则：最小入口仅预览当前物理 cwd 中单链接普通 UTF-8 HTML，256 KiB／10,000 行，拒绝需要脱敏的正文。daemon 稳定 descriptor 检查完整字节、身份和版本，经桌面父子私有 IPC 交付冻结快照；renderer 不接收原件字节或宿主 Cookie。历史链接只是当前路径提示，来源未判定，不能冒充历史产物。

每次创建唯一非持久 session，最多四个在途或已打开预览；所有守卫在首次加载前安装。无 preload，sandbox／contextIsolation／webSecurity 开启、Node 与 JavaScript 关闭。固定单文档协议不解释磁盘路径、不提供任意 URL。CSP sandbox 与请求层共同禁止脚本、网络、file、WS、子 frame、对象、表单和外部协议。主进程拒绝权限、弹窗、导航、重定向、内容下载、文件选择交互及浏览器快捷键；只允许滚动。链接不跳转，不调用 shell.openExternal。宿主标题／独立顶部视图展示路径、来源、版本及边界；内容无法覆盖该区域。

取消或工作台导航使在途请求失效，迟到内容不加载；已打开窗口独立存在，关闭释放内容与协议并清空临时存储。正常退出关闭预览，不恢复预览或授权，不停止因切视图而继续的后台任务。隔离初始化／加载失败关闭窗口并拒绝内容；预览 renderer 崩溃只终止该内容，工作台及 daemon 任务独立。

验证方案：真实文件／路径／链接／硬链接及版本竞争、私有IPC身份撤销／重启；实际Electron攻击页面和测试控制面的隔离renderer探针，分别核对脚本、Cookie／存储／preload／Node、服务／文件／网络、导航／下载／协议／权限；初始化故障和实际renderer崩溃。开发和命令行检查后才执行窗口回归与Windows原生验收；包括取消迟到、恢复、长中文路径、明暗窄窗、实际SDK后台PID／epoch、同data/profile重启和正常退出。实际SDK本地夹具、合成观察、故障注入与原生证据分开；提供商0。

完整 pnpm run ci 退出0：69文件／464项Vitest、SDK本地HTTP冒烟和183项浏览器／Electron E2E通过。完整 pnpm verify:clean 退出0：新目录frozen安装、check、build、464项测试、SDK及HTTP200／正常启停通过。487个产品／测试／脚本／配置输入与CI及clean副本一致；原生阶段源码未改，按哈希复用门禁。

5项真实文件服务测试覆盖长中文路径／精确字节、版本竞争／替换／删除、越界／私密项／junction／硬链接、超限／编码／脱敏、desktop身份撤销／重启、四名额和shutdown drain。已有FILE-02同长度外部改写夹具暴露NTFS时间戳可能延迟；修前失败，增加同descriptor第二遍完整字节比较后22项相关服务测试通过，并进入完整CI／clean。

3项实际Electron回归使用静态恶意HTML及同一隔离renderer的测试控制面CDP Runtime.evaluate探针，确认无配对Cookie／storage／preload／Node／opener，file、HTTP、daemon、XHR、WS、worker、弹窗、导航、meta refresh、form、下载及协议均不能访问宿主。实际本地HTTP／WS upgrade陷阱请求0。sendBeacon返回true仅表示排队，实测未发送；不把API返回值当作网络放行。第二项覆盖取消／迟到／重复／初始化故障／四窗限额与关闭恢复；第三项实际forcefullyCrashRenderer后主窗口与真实SDK后台PID／epoch不变，同profile重启零预览／零重放。探针和故障注入不冒充产品脚本或原生动作。见[攻击结果](preview-attack-result.json)及[CI](ci.log)。

97条Windows原生观察含中间态：实际入口、静态脚本未运行、外链／下载／协议／文件选择点击拒绝、长中文路径可信顶部、关闭／重新打开、过期句柄拒绝和重新选择恢复、设置返回、明暗802px工作台、同data/profile重启0发送／0内核／0审批／0授权／0预览、两次正常菜单退出code0。实际本地陷阱0请求；3份settled JSONL重启不变，主会话历史贯穿预览不变，隔离用户Git及五保护哈希不变。后台证据按[native-validation.json](native-validation.json)的两个独立PID区间记录，两段随后均为failed/terminated，根因未建立，晚到的stop-background请求不作终止原因；不称全程仍运行。无新增真实IME；不声称原生Ctrl+R/F5刷新。预览顶部跟随系统明暗，不与工作台手选主题同步；不可信原件CSS可自行选择颜色。

初轮失败如实保留：Electron45不回报plugins字段，改以实际隔离能力验证；禁脚本页executeJavaScript无法使用，测试driver改CDP，仅测试可用，生产无debug／eval桥；异步XHR/WS探针等待导致超时，改发起后核对实际失败状态和请求计数；sendBeacon排队返回值误判修正，网络边界未放宽。旧teardown误导航已崩溃预览，改由主进程生命周期关闭预览并保留其他页面严格清理。原生首张无关前台截图排除，AX几何与popup owner问题改用已观察的键盘／坐标恢复；拖边和尺寸快捷键尝试未建立窄窗，最终原生菜单Size实际802px证据另列。没有降低门禁或跳过测试。

经依赖核对的下一步：FILE-04（FILE-02已verified，FILE-07须先独立提交）。复用此唯一临时session／无preload／静态隔离边界，支持明确列出的图片、PDF、HTML和文本类型；逐个显示真实路径、来源和完整版本，变化／删除隐藏旧内容并明确刷新，提供重验原件打开入口及不支持／损坏／超限替代。不上传原件，不接FILE-05。继续真实提供商0、配置／canonical预算／锁不改、原目录和UX-01保护、逐项完整门禁及原生验收。全部三项验收提交后普通推送本批分支，核对远程SHA，正常退出自有服务并请求Windows正常关机；任何未解阻塞保留现场、不关机。

提交审查：源码／配置／普通文档的 git diff --cached --check 通过；原始验收日志含工具输出的行尾空格、CRLF及末尾空行，整批diff检查因此退出2。按.gitattributes保留证据原始字节，不将其规范化或冒充检查通过；暂存52路径约2.51MiB，无运行数据库／Cookie／trace／配置密钥。
