import type { WorkspaceAvailability, WorkspaceEnvironmentTarget } from '@pi-workbench/shared'

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { workspaceAvailabilitySchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button, buttonVariants } from '@pi-workbench/ui/components/button'

import { sessionJson } from '../../services/session-client.js'
import { WorkspaceRecordDialog } from './workspace-record-dialog.js'

/** Recovery checks and relocation remain explicit and separate from sending. A remounted
 * target owns new feedback; late checks only invalidate their original query key. Existing
 * dialogs retain revision/CAS, native picker, IME and cancellation behavior. */
export function WorkspaceSafety({
  target,
  data,
  failed,
  fetching,
  csrf,
}: {
  target: WorkspaceEnvironmentTarget | null
  data: WorkspaceAvailability | undefined
  failed: boolean
  fetching: boolean
  csrf: string
}) {
  const cache = useQueryClient()
  const mounted = useRef(true)
  const busy = useRef(false)
  const [checking, setChecking] = useState(false)
  const [relocating, setRelocating] = useState<WorkspaceAvailability['workspace'] | null>(null)
  const [feedback, setFeedback] = useState('')
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const recheck = async () => {
    if (!target || busy.current) {
      return
    }
    busy.current = true
    setChecking(true)
    setFeedback('')
    try {
      const result = workspaceAvailabilitySchema.parse(
        await sessionJson('/api/workspaces/recover', undefined, target, csrf),
      )
      if (JSON.stringify(result.target) !== JSON.stringify(target)) {
        throw new Error('目录检查对象不匹配，请重新校验。')
      }
      if (mounted.current) {
        setFeedback(
          result.state === 'available'
            ? result.recovery
            : `${result.diagnostic} ${result.recovery}`,
        )
      }
    } catch (error) {
      if (mounted.current) {
        setFeedback(error instanceof Error ? error.message : '校验未完成，请恢复本地连接后重试。')
      }
    } finally {
      void cache.invalidateQueries({ queryKey: ['workspace-availability', target] })
      void cache.invalidateQueries({ queryKey: ['workspace-environment', target] })
      busy.current = false
      if (mounted.current) {
        setChecking(false)
      }
    }
  }
  const current =
    !failed && data && JSON.stringify(data.target) === JSON.stringify(target) ? data : undefined
  const blocked = target && current?.state !== 'available'
  return (
    <section
      aria-label="工作区信任与恢复"
      className="flex min-w-0 shrink-0 flex-col gap-2 border-b px-5 py-2 text-xs"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant="outline">项目资源受限</Badge>
        <span className="min-w-0 flex-1 text-muted-foreground">
          {current?.resources
            ? `已确认文本 ${current.resources.trusted} 项 · 未确认 ${current.resources.untrusted} 项 · 无法检查 ${current.resources.blocked} 项。仅已确认文本可在下轮加载。`
            : '项目资源需逐项确认。'}
          扩展、脚本与安装动作保持禁用。
        </span>
        {current?.state === 'available' ? (
          <a
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            href={`/?trust&project=${encodeURIComponent(current.cwd)}`}
          >
            检查资源信任
          </a>
        ) : null}
        {target ? (
          <Button variant="ghost" size="sm" disabled={checking} onClick={() => void recheck()}>
            {checking ? '正在校验…' : '重新校验执行目录'}
          </Button>
        ) : null}
      </div>
      {blocked ? (
        <Alert>
          <AlertTitle>
            {failed
              ? '目录状态未同步，发送暂不可用'
              : current
                ? '执行目录不可用，发送已阻止'
                : '正在核对执行目录'}
          </AlertTitle>
          <AlertDescription>
            <p>
              {failed
                ? '请恢复本地连接并重新校验；断线不能证明后台任务已停止。'
                : current
                  ? `${current.diagnostic} ${current.recovery}`
                  : '核对完成前保留草稿与历史。'}
            </p>
            {current ? (
              <p className="break-all">
                会话 cwd：{current.cwd}
                {current.cwd !== current.workspace.canonicalPath
                  ? `；工作区登记：${current.workspace.canonicalPath}`
                  : ''}
              </p>
            ) : null}
            {current ? (
              <Button
                className="self-start"
                variant="outline"
                size="sm"
                disabled={checking}
                onClick={() => setRelocating(current.workspace)}
              >
                重新定位同一目录
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {feedback ? <output>{feedback}</output> : null}
      {fetching && current ? <span className="sr-only">正在核对目录，上次观察供参考。</span> : null}
      {relocating ? (
        <WorkspaceRecordDialog
          record={relocating}
          latest={data?.workspace}
          operation="relocate"
          csrf={csrf}
          close={() => setRelocating(null)}
          saved={() => {
            void cache.invalidateQueries({ queryKey: ['workspace-availability', target] })
            void cache.invalidateQueries({ queryKey: ['workspace-environment', target] })
            setRelocating(null)
            setFeedback('工作区登记已更新。已有会话保留原 cwd；没有恢复或重发任务。')
          }}
        />
      ) : null}
    </section>
  )
}
