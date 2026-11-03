# shadcn/ui 组件来源与采用规则

关联 OPS-01 工程与 UI 基线。产品使用 React + Tailwind 4 + shadcn/ui，当前选择官方 Base UI 的 base-nova 风格，配置见 `packages/ui/components.json`。后续组件延续同一套基础与语义主题。

## 为什么组件源码里有 Tailwind

shadcn/ui 按源码分发：通过官方 CLI 将组件加入项目，由项目维护。`packages/ui/src/components` 中的 Tailwind 类、`cva` 变体、`cn`、Base UI primitive 都属于这种使用方式。业务界面从 `@pi-workbench/ui/components/*` 引入，组件集中放在公共包。

`@base-ui/react` 提供基础交互，`@shadcn/react/message-scroller` 提供消息滚动行为，本地组件提供样式和组合。选择 Base UI 是官方支持的路线。项目自己的中性灰、字号和面板尺寸是已确认的视觉设计，通过主题和布局实现。

2026-11-01 在 `packages/ui` 运行 `pnpm dlx shadcn@latest info --json`，实际识别 11 个组件：alert、badge、bubble、button、collapsible、input、input-group、message、message-scroller、textarea、trace。另通过官方 CLI 读取 button、message、bubble、message-scroller、trace、input-group 的 base-nova registry 源码，核对本地组件结构与函数组成。组件已经过 ESM 相对导入、格式化、主题和少量类型安全适配，后续更新须审查这些差异。

## 当前采用程度

| 区域                     | 当前代码                                              | 采用情况与后续要求                                                                                             |
| ------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 按钮、输入、徽标、提示   | Button、Input / Textarea、InputGroup、Badge、Alert    | 已采用官方组件源码                                                                                             |
| 消息与滚动               | Message、Bubble、MessageScroller                      | 已用于 Conversation；与官方 Chat 模式使用相同的核心组件，完整会话恢复仍按 OBS / SESSION 验收                   |
| 输入区                   | InputGroupTextarea、InputGroupAddon、InputGroupButton | 已采用 Prompt Input 的核心结构；附件、模型菜单等待对应功能接入                                                 |
| 过程展示                 | Trace / TraceLine                                     | 已用于离线样本；真实工具内容、展开与状态映射仍待实现                                                           |
| 执行前审批               | 自定义 section / dl / pre + 官方 Button               | 当前结构手写；应参照 Confirmation，以 Item / ItemActions / Button 组合，保留命令、目录、影响范围与授权绑定信息 |
| 项目与会话侧栏、窄窗导航 | 自定义 aside、布局 CSS、遮罩和 Button                 | 目前未采用 Sidebar / Sheet；正式导航应优先使用官方组件并复用其键盘、焦点和弹层行为                             |
| 开发场景 / 主题选择      | 原生 select + 自定义 CSS                              | 应优先采用官方 Native Select 或 Select，按原生选择框或自定义选择需求决定                                       |
| 新会话空状态、加载状态   | 页面 HTML 和布局样式                                  | 正式实现优先使用 Empty / Spinner / Skeleton，按真实状态选择                                                    |
| 命令与 Diff 样本         | 自定义 pre                                            | 应复用 CodeBlock；正式 Diff 的比较、定位和交互按 CHANGE 功能评估专用渲染器                                     |

2026-11-02 的 Electron 控制栏与统一设置复用现有 Button / buttonVariants、Field / FieldContent / FieldDescription、Input、Separator、Alert 与 Badge，未增加依赖或自制公共 primitive。设置分类是业务导航的普通链接，窄窗使用横向滚动；菜单使用 Electron 原生 Menu，窗口按钮由 Windows 原生 overlay 提供。外观主题沿用原生 select；后续按上表统一采用官方选择组件。布局与中性灰通过现有 tokens / 应用 CSS 调整，主题展示小图只作预览，不是可交互控件。设置仍调用原 daemon 服务，不接入示例 AI transport。

这些组件的存在或 UI 结构的调整不代表真实会话、权限、工具、快照或回滚已经完成。当前产品进度以 backlog 为准。

CORE-05 的 `?observe=<sessionId>` 是独立只读观察页，复用现有 Alert / Button / Bubble，展示实际 REST / WS 投影；工具结果暂用安全纯文本 `pre`，没有另造基础组件。普通 Conversation 的 Trace 仍为离线样本；完整 OBS 工具组合、历史滚动 / 分页与正式会话 UI 继续按各自功能验收，不能因观察通道完成提前勾选。

CORE-06 的 `?history=<sessionId>` 复用 MessageScroller / Message / Bubble、Alert、Badge 与 Button；导航链接复用官方 buttonVariants。分页、按需全文和记录导出均调用 daemon，只读读取 SDK 原件；SEC-06 已为展示与下载加入统一脱敏，无法安全解析的内容拒绝导出且保留原件。合成队列 / 审批 / 引用记录明确标注，按钮安装和此读取页不代表 M2 真实会话或审批执行已验收。

CORE-07 的 `?resources` 复用 Alert / Badge / Button / buttonVariants，显示 daemon 返回的限额、占用、队列顺序和原因。失败保留旧数据并标明不同步，支持键盘刷新、系统明暗与窄窗；没有新增基础 primitive。该页只读，取消通过内部任务入口验证；M2 业务入口、真实审批和 M4 PTY 不因资源页通过而提前验收。

SEC-06 的 `?credentials` 复用 Alert / Badge / Button / buttonVariants，读取经 Zod 校验的提供商凭证元数据；无明文密钥输入、回显或持久浏览器存储。加载、空态、读取失败保留旧值、键盘刷新、明暗与 390px 均由实际页面验证。没有新增基础 primitive，凭证修改 UI 留待配对 / 配置功能；审批展示脱敏不改变宿主执行参数。

SEC-08 的 `?clients` 及 ClientAccess 复用官方 Field / FieldLabel、Input、Alert、Badge 和 Button。Field（及所依赖的 Label / Separator）由当前 Base UI / base-nova 官方 CLI 加入，复用已有 cn、相对 ESM 导入；Label 显式传递 htmlFor，Field 不附加冗余 group role，错误列表按去重消息作 key，无新增第三方运行依赖。配对与客户端裁决均来自 daemon；fragment 仅在内存，授权失效卸载私有视图。明暗、1080p / 390px、键盘和程序 IME 防误提交在真实页面检验；Electron 保留隔离、托盘和宿主授权，不用示例 AI transport。

SEC-07 的 `?trust` 从侧栏设置区进入，复用既有官方 Field / FieldLabel、Input、Alert、Badge、Button 和 Separator，没有新 primitive 或依赖。资源来源、影响、指纹、不可执行状态和逐项预览 / 确认 / 撤销由业务 feature 组合；同一 daemon 决定实际加载。确认面板保留打开时的版本，旧预览不能确认新内容；请求失败保留旧数据并禁用决定，跨目录迟到结果不串页。实际 Chrome / Electron 检查明暗、1080p / 390px、纯文本预览、键盘焦点恢复及长列表滚动。保存信任不表示扩展、脚本或生产审批已开放。

WS-01 的 Electron 工作区页复用上述 Field / FieldLabel、Input、Alert、Badge、Button、Separator 和既有 Lucide 图标，没有增加自制 primitive 或依赖。目录输入、可取消的原生选择器、本窗口切换、诊断与信任入口属于 feature 组合；规范化和身份去重由 daemon 决定。工作区模块按需加载，不加重初始离线对话包；迟到请求按视图版本隔离。原生选择器经固定 preload 桥调用，独立网页显示桌面入口提示并禁用操作。

MODEL-01 的 Electron `?models` 页复用现有 Field / FieldGroup / FieldLabel、Input、Alert、Badge、Button / buttonVariants、Separator 和 Lucide，未新增 primitive 或 UI 依赖。已通过官方 CLI 查询并读取 Base UI 的上述组件文档，沿用本地 base-nova 源码与语义 tokens。来源 / 本地认证 / 未联网验证分开展示；SDK 能力和诊断由 daemon 提供，不接入示例 AI transport。本地搜索、单个“仅看已有配置”切换、提供商及模型分批展开属于 feature 组合；刷新失败保留旧值并标明失效。实际 Electron 验证明暗、1920×1080 / 800px、键盘焦点、长列表与迟到响应，原生菜单另经 Windows 实际操作。模型选择与会话发送仍由对应功能接入，网页独立功能暂缓。

## AI Elements 如何接入

以用户提供的 [AI Elements 官方文档](https://ui.shadcn.com/docs/ai-elements) 为准：当前 AI Elements 是组合模式，可以把组合源码放进项目；没有必须安装的独立 AI Elements 包。

| 模式                                                                                   | 官方基础组件                         | 本项目的接入方式                                                     |
| -------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------- |
| [Chat](https://ui.shadcn.com/docs/ai-elements/base/chat) / Message                     | MessageScroller、Message、Bubble     | 展示 shared 投影和历史，按消息 ID 维护滚动与锚点                     |
| [Prompt Input](https://ui.shadcn.com/docs/ai-elements/base/prompt-input)               | InputGroup、Attachment、DropdownMenu | 保留中文 IME、草稿、发送 / 排队 / 停止规则，逐阶段补齐附件和模型选择 |
| [Confirmation](https://ui.shadcn.com/docs/ai-elements/base/confirmation)               | Item、Button                         | 用户决定交给 daemon 裁决；界面不自行执行工具                         |
| [Tool](https://ui.shadcn.com/docs/ai-elements/base/tool) / Reasoning / Plan / Subagent | Trace、CodeBlock 等                  | 把 pi / daemon 事件映射到展示状态，按各自里程碑接入                  |

官方示例中的 AI SDK transport、`useChat`、模拟消息和自动续聊属于示例数据接法。本项目保留 pi SDK + daemon + shared 契约，复用展示组合，并遵循自己的审批、费用与轮次规则。

## 后续实现约束

1. 新界面先查官方组件与 AI Elements 模式；已有组件能满足需求时优先组合。只有业务状态和领域交互需要额外封装；新增基础交互要说明官方组件的不足。
2. 公共组件集中在 `packages/ui`，项目 / 会话 / 审批等业务组合放在前端 feature 目录。主题通过语义 tokens 与 variants 配置，布局样式表达工作台结构和响应关系。
3. 增加组件通过官方 shadcn CLI；预览依赖和源码变化，保留 named catalogs、ESM 相对导入及现有组件适配。升级不直接覆盖本地修改。
4. 不为了让 UI 看起来像使用了组件库而改变已确认的 Codex 式信息架构；复用组件的交互能力，并保持明暗主题和可达性。
5. `8765` 服务展示的 PRD / 方向稿是静态 HTML 原型；`5173` 是 React 运行壳。原型用于设计评审，组件复用与行为验收在实际应用代码中核对。

官方参考：[组件目录](https://ui.shadcn.com/docs/components)、[AI Elements](https://ui.shadcn.com/docs/ai-elements)。
