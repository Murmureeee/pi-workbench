import { FileCodeIcon, XIcon } from 'lucide-react'

import { Badge } from '@pi-workbench/ui/components/badge'
import { Button } from '@pi-workbench/ui/components/button'

import { useWorkbench } from '../../stores/workbench.js'

export function ChangesPanel() {
  const toggle = useWorkbench((state) => state.toggleChanges)
  return (
    <aside className="changes-panel" aria-label="修改审查面板">
      <header>
        <strong>审查工作区</strong>
        <Badge variant="secondary">本轮</Badge>
        <Button variant="ghost" size="icon-sm" aria-label="关闭审查面板" onClick={toggle}>
          <XIcon />
        </Button>
      </header>
      <div className="changes-scope">
        <strong>2 个文件变更</strong>
        <p>本轮开始前 → 本轮结束时</p>
      </div>
      <div className="changes-files">
        <FileCodeIcon />
        <span>src/auth/session.ts</span>
        <span className="diff-add">+5 −1</span>
      </div>
      <pre className="diff-code">{`  export function handleExpired() {\n-   navigateToLogin();\n+   if (redirecting) return;\n+   redirecting = true;\n+   navigateToLogin(returnUrl);\n  }`}</pre>
      <p className="changes-description">接受记录审查决定，回滚需要可靠快照与冲突预检。</p>
      <footer>
        <span>0 / 2 个文件已处理</span>
        <div className="flex gap-2">
          <Button variant="outline" disabled title="M3 接入真实快照后开放">
            回滚此文件
          </Button>
          <Button disabled title="M3 接入审查记录后开放">
            接受此文件
          </Button>
        </div>
      </footer>
    </aside>
  )
}
