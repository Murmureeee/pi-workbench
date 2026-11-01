# PRD v2 参考依据

查阅日期：2026-10-31。官方文档仅支持设计取舍，不证明 pi 集成已实现。

- [Codex Projects and chats](https://learn.chatgpt.com/docs/projects)：项目 / 会话组织、搜索、命名与无项目工作入口。
- [Codex Code review](https://learn.chatgpt.com/docs/code-review)：按分支、未提交内容、指定提交或自定义标准发起审查，意见可定位，默认只读。
- [Codex Integrated terminal](https://learn.chatgpt.com/docs/integrated-terminal)：终端在对话下方独立打开，执行环境与项目 / Worktree 关联。
- [Codex Worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)：用独立物理目录隔离并行代码修改。
- [Claude Code Desktop application](https://code.claude.com/docs/en/desktop)：实际获取官方 `.md` 正文，重点读取 Start a session、Use the prompt box、Choose a permission mode、Arrange your workspace、Run commands in the terminal、Manage sessions、Worktrees、Context。

Claude Code 文档把 Plan 描述为调查后提出方案、不编辑源代码；面板可按需打开和调整；工具默认可折叠为摘要；终端与文件共享当前会话的实际执行环境；Worktree 用于隔离修改。这些支持本产品的“先计划后明确转执行”“环境可见”“折叠过程”和“按需工作面板”。

Pi Workbench 的具体产品决定仍优先：项目归属不等于目录；首次发送才持久建会话；终端结果显式附加；真实工具权限由宿主落实；整轮回滚先全批预检；归档保护必要修改；自动化无变化保持安静。其他产品的自动接受、云端服务、账户权益、执行沙箱与自动清理规则不直接沿用。

Claude 桌面页面最初在浏览器访问失败，随后通过公开官方 Markdown 地址成功获取并阅读相关正文。未使用搜索摘要替代正文，未据此推断未读取功能的精确行为。
