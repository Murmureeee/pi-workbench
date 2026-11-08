import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { sessionGrantListSchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button } from '@pi-workbench/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@pi-workbench/ui/components/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@pi-workbench/ui/components/empty'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceLine,
  TraceTitle,
} from '@pi-workbench/ui/components/trace'

import { sessionJson } from '../../services/session-client.js'

/** A session-scoped view of live host authority. Losing this dialog only stops observation;
 * revoking never stops an executing action. No grant is reconstructed from browser storage. */
export function SessionAuthorizations({
  sessionId,
  csrf,
  active,
}: {
  sessionId: string
  csrf: string
  active: boolean
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const live = useRef(true),
    lock = useRef(false)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  useEffect(() => {
    if (!active) {
      setOpen(false)
    }
  }, [active])
  const list = useQuery({
    queryKey: ['session-grants', sessionId],
    enabled: active,
    queryFn: async ({ signal }) =>
      sessionGrantListSchema.parse(
        await sessionJson(`/api/chat/grants?sessionId=${sessionId}`, signal),
      ),
    refetchInterval: 1000,
    gcTime: 0,
    retry: false,
  })
  const grants = list.data?.grants ?? []
  const revoke = async (grantId: string | null) => {
    if (lock.current || !active || list.isError) {
      return
    }
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await sessionJson('/api/chat/grants/revoke', undefined, { sessionId, grantId }, csrf)
      if (live.current) {
        await list.refetch()
      }
    } catch (cause) {
      if (live.current) {
        setError(cause instanceof Error ? cause.message : '撤销结果待同步，请刷新核对。')
        void list.refetch()
      }
    } finally {
      lock.current = false
      if (live.current) {
        setBusy(false)
      }
    }
  }
  return (
    <Dialog open={open && active} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        会话授权 · {list.isError ? '待同步' : grants.length}
      </DialogTrigger>
      <DialogContent className="session-grants-dialog">
        <DialogHeader>
          <DialogTitle>会话授权</DialogTitle>
          <DialogDescription>
            仅当前会话、相同工具、物理目录及完整最终参数。无通配符，不包含其他工具或子调用；服务重启或策略变化后失效。
          </DialogDescription>
        </DialogHeader>
        <p>
          撤销立即阻止后续复用，正在执行的动作需返回工作台单独停止。基线与回滚范围须逐轮核对，每次仍须明确确认不可回滚执行。
        </p>
        {list.isPending ? <output>正在同步授权…</output> : null}
        {list.isError ? (
          <Alert>
            <AlertTitle>授权状态待同步</AlertTitle>
            <AlertDescription>
              无法确认当前授权；恢复连接后刷新，未自动重新提交任何决定。
            </AlertDescription>
          </Alert>
        ) : null}
        {error || list.data?.auditWarning ? (
          <Alert>
            <AlertTitle>请核对撤销结果</AlertTitle>
            <AlertDescription>{error || list.data?.auditWarning}</AlertDescription>
          </Alert>
        ) : null}
        <div className="approval-actions">
          <Button variant="outline" disabled={busy} onClick={() => void list.refetch()}>
            刷新会话授权
          </Button>
          <Button
            variant="outline"
            disabled={busy || list.isError || !grants.length}
            onClick={() => void revoke(null)}
          >
            撤销本会话全部授权
          </Button>
        </div>
        {!list.isPending && !list.isError && !grants.length ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>尚无有效会话授权</EmptyTitle>
              <EmptyDescription>从当前普通调用的审批卡明确授予；L3 始终单次确认。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        <div className="session-grants-list">
          {grants.map((grant) => (
            <Alert key={grant.id} data-grant-id={grant.id}>
              <AlertTitle>
                <Badge variant="outline">{grant.tool}</Badge> · 相同最终参数
              </AlertTitle>
              <AlertDescription>
                <p className="approval-path">执行目录：{grant.cwd}</p>
                <p className="approval-path">
                  目标：{grant.targetPath ?? '仅此完整命令及工作目录'}
                </p>
                <Trace>
                  <TraceCollapsible>
                    <TraceCollapsibleTrigger>
                      <TraceLine>
                        <TraceTitle>查看授权范围与来源</TraceTitle>
                      </TraceLine>
                    </TraceCollapsibleTrigger>
                    <TraceCollapsibleContent>
                      <p className="approval-path">物理目录指纹 {grant.physicalIdentity}</p>
                      <p className="approval-path">最终参数指纹 {grant.parameterDigest}</p>
                      <pre className="approval-parameters">{grant.parameters}</pre>
                      <p className="approval-path">
                        来源：明确的人类决定 · {grant.actor} ·{' '}
                        {new Date(grant.createdAt).toLocaleString()} · 策略 {grant.policyVersion}
                      </p>
                      <p>
                        参数展示统一脱敏，匹配原始完整参数；新参数、其他会话、其他路径或不同物理目录均不在范围内。
                      </p>
                    </TraceCollapsibleContent>
                  </TraceCollapsible>
                </Trace>
                <Button
                  variant="outline"
                  disabled={busy || list.isError}
                  onClick={() => void revoke(grant.id)}
                >
                  撤销这条授权
                </Button>
              </AlertDescription>
            </Alert>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
