# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: session-creation.spec.ts >> SESSION-01 Electron drafts, composition Enter, durable first send and continuing the same session
- Location: e2e\session-creation.spec.ts:84:1

# Error details

```
Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=f1e3]:
  - banner "桌面控制栏" [ref=f1e4]:
    - generic [ref=f1e5]:
      - generic [ref=f1e6]:
        - button "后退" [ref=f1e7] [cursor=pointer]
        - button "前进" [disabled]
      - navigation "应用菜单" [ref=f1e8]:
        - button "文件" [ref=f1e9] [cursor=pointer]
        - button "编辑" [ref=f1e10] [cursor=pointer]
        - button "视图" [ref=f1e11] [cursor=pointer]
        - button "帮助" [ref=f1e12] [cursor=pointer]
      - generic [ref=f1e13]: Pi Workbench
  - generic [ref=f1e14]:
    - navigation "工作台导航" [ref=f1e15]:
      - link "打开工作台" [ref=f1e16] [cursor=pointer]:
        - /url: /
      - link "打开设置" [ref=f1e17] [cursor=pointer]:
        - /url: /?settings=appearance
    - generic [ref=f1e22]:
      - complementary "项目与会话" [ref=f1e23]:
        - generic [ref=f1e24]:
          - generic [ref=f1e25]: π
          - strong [ref=f1e26]: Pi Workbench
          - button "收起导航" [ref=f1e27] [cursor=pointer]
        - navigation [ref=f1e28]:
          - button "新会话" [ref=f1e29] [cursor=pointer]
          - link "打开工作区" [ref=f1e30] [cursor=pointer]:
            - /url: /?workspaces
        - generic [ref=f1e31]:
          - generic [ref=f1e32]:
            - generic [ref=f1e33]: 会话
            - button "已归档" [ref=f1e34] [cursor=pointer]
          - paragraph [ref=f1e35]: 项目
          - button "新建项目" [ref=f1e36] [cursor=pointer]
          - region "最近无项目会话" [ref=f1e37]:
            - paragraph [ref=f1e38]: 最近 · 无项目
            - generic [ref=f1e39]:
              - button "首次有效任务 未读" [ref=f1e40] [cursor=pointer]:
                - generic [ref=f1e41]: 首次有效任务
                - generic [ref=f1e42]: 未读
              - button "会话菜单：首次有效任务" [ref=f1e43] [cursor=pointer]
        - generic [ref=f1e44]:
          - link "旧 pi 历史 · 只读" [ref=f1e45] [cursor=pointer]:
            - /url: /?legacy
          - link "模型与提供商" [ref=f1e46] [cursor=pointer]:
            - /url: /?models
          - link "设置" [ref=f1e47] [cursor=pointer]:
            - /url: /?settings=appearance
          - link "离线状态样本" [ref=f1e48] [cursor=pointer]:
            - /url: /?samples
      - main [ref=f1e49]:
        - generic [ref=f1e51]:
          - strong [ref=f1e52]: 新会话
          - generic [ref=f1e53]: 无项目 · C:\Users\Murmure\AppData\Local\Temp\piw-session-ui-YKOP1s\draft-directory
        - generic [ref=f1e55]:
          - generic [ref=f1e56]:
            - heading "今天想完成什么？" [level=1] [ref=f1e57]
            - paragraph [ref=f1e58]: 先描述任务，项目可选。首次发送后才保存会话。
            - generic [ref=f1e59]: 默认离线 · 真实模型传输关闭
          - status "发送反馈" [ref=f1e61]: 任务已保存，运行状态由本地服务确认。
          - generic [ref=f1e62]:
            - generic [ref=f1e63]:
              - generic [ref=f1e64]:
                - generic [ref=f1e65]: 项目
                - combobox "项目 项目" [ref=f1e66] [cursor=pointer]:
                  - option "无项目" [selected]
              - generic [ref=f1e67]:
                - generic [ref=f1e68]: 模型
                - combobox "模型 模型" [ref=f1e69] [cursor=pointer]:
                  - option "离线验收模型 · pi SDK 本地夹具" [selected]
            - group [ref=f1e70]:
              - generic "执行目录：C:\\Users\\Murmure\\AppData\\Local\\Temp\\piw-session-ui-YKOP1s\\draft-directory" [ref=f1e71] [cursor=pointer]
              - generic [ref=f1e72]:
                - generic [ref=f1e74]:
                  - generic [ref=f1e75]: 目录绝对路径（可选）
                  - textbox "目录绝对路径（可选）" [ref=f1e76]
                - generic [ref=f1e77]:
                  - button "选择文件夹" [ref=f1e78] [cursor=pointer]
                  - button "校验此目录" [disabled]
                  - button "使用独立目录" [ref=f1e79] [cursor=pointer]
            - paragraph [ref=f1e80]: 离线验收：固定样本回复，思考关闭，不执行工具或扩展。
            - group [ref=f1e81]:
              - textbox "任务内容" [ref=f1e82]:
                - /placeholder: 描述任务，或提出一个问题…
                - text: 新会话独立草稿
              - group [ref=f1e83]:
                - generic [ref=f1e84]: 无项目
                - button "发送任务" [ref=f1e85] [cursor=pointer]
            - generic [ref=f1e86]:
              - generic [ref=f1e87]: Enter 发送 · Shift+Enter 换行
              - generic [ref=f1e88]: 费用未知 · 未调用真实提供商
        - generic [ref=f1e89]:
          - generic [ref=f1e90]: 桌面已授权
          - generic [ref=f1e91]: 真实传输关闭
```