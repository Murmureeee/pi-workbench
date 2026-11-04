# OBS-01：流式消息与安全内容渲染

Electron流式与安全内容展示已验收：每帧累计全部delta，非delta状态即时冲刷，权威终态替换去重；CommonMark/GFM安全Markdown、仅显式HTTP(S)链接、禁止自动图片和原始HTML执行、本地协议惰性。16k预览可展开，64k以上纯文本、12k以上代码不高亮，未知语言／未闭合围栏／可选模块失败回退；按需Shiki与异步身份保护。8项新增Vitest、4项新增Electron流程；完整238项Vitest／86项E2E、SDK和frozen clean通过。Windows原生富文本／纯文本切换、长内容展开／收起、明暗主题、同data/profile重启0请求及两次正常退出补证。图示仅惰性代码，未接入执行型图示。真实提供商0、pi配置／canonical预算未改，无安装包，网页独立功能暂缓；OPS-08继续in_progress。

## 实现与验收对应

| 验收 | 证据 |
| --- | --- |
| 帧内累计、即时冲刷和终态去重 | runtime-client.test.ts 的6项受控帧／传输测试；实际RuntimeClient与shared reducer，审批为合成观察，不冒充生产审批执行 |
| 安全Markdown与展开不改历史 | content-policy.test.ts两项；message-rendering.spec.ts四项实际Electron／SQLite／SDK／本地SSE流程；链接、HTML／SVG／图片、未知与未闭合围栏、64k超限及历史字节不变 |
| 可选渲染失败及迟到隔离 | 动态模块失败和高亮阻塞／卸载后失败为显式路由故障；保留纯文本，无模型额外请求；新源码和语言均核对，effect清理使旧承诺失效 |

## 工程与原生证据

[完整CI](ci.log)、[frozen clean](clean-workspace.json)、[命令及输出](clean-commands.json)、[最终定向11项](targeted-final.log)。首轮夹具枚举遗漏及旧历史二次截断／观察页需显式展开的失败，分别保留[夹具失败](fixture-schema-failure.log)与[修前CI](ci-before-preview-fix.log)；修正保留原文完整性与回归断言，不减少检查。另一次完整CI仅模型发现窗口5秒启动等待失败，保留[启动超时](ci-window-timeout.log)；上限调整为15秒，并修正渲染测试WS到隔离daemon，[7项定向](targeted-socket.log)通过后完整回归仍在创建首个CDP target时失败，保留[竞态记录](ci-cdp-race.log)。最终测试先接收真实Electron did-finish-load，再连接CDP，安装隔离路由后刷新，启动错误附有界stderr诊断；[两轮14项定向](targeted-ready.log)及完整CI重新验证。

[原生汇总](native-validation.json)与native内逐步UIA／截图记录，实际Electron的原生控制与Playwright分开，完整索引见[native/observations.json](native/observations.json)。部分点击后立即捕获的UIA尚未稳定，后续settled观察才用于确认；offscreen点击与未生效边框拖动不算通过。原生从输入框发送两次真实SDK本地SSE验收样本，无真实提供商调用；恶意文本为固定离线夹具，不执行。重启同data/profile不重发，原生历史SHA-256和用户配置／canonical预算哈希均不变，两次从菜单正常退出。

按需依赖react-markdown 10.1.0／remark-gfm 4.0.1／Shiki 4.6.0放apps/web，通过named catalog精确锁定；官方Base UI/base-nova CodeBlock经CLI取得源码，沿用本地cn，省略未用复制按钮，未引入第二套基础UI或AI transport。输入和历史保持daemon／SDK所有权；renderer仅渲染安全React文本节点。

[1920×1080明色](message-rendering-light.png)与[800×760暗色](message-rendering-dark-800.png)由实际Electron自动流程截取，原生另有明暗主题观察；原生边框拖动未改变尺寸，不计作窄窗通过。图示不接入，mermaid等保留代码文本；未知或编码秘密不承诺全部识别，继续沿用SEC-06统一脱敏。

## 下一步提示词

完成 OBS-04：滚动跟随与新消息提醒。优先 Electron，覆盖用户回看不强拉、流式新消息计数、返回最新、按消息锚点／偏移恢复、历史分页、3视图卸载重开、长消息展开位置及后台完成／审批不抢焦点或面板。默认离线，沿用验收与费用约束，不改pi配置、不额外调用模型、不制作安装包，网页独立功能暂缓。完成测试和实际Electron验证，更新进度并给出下一步提示词。
