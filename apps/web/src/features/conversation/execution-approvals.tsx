import type { ExecutionApproval } from '@pi-workbench/shared'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { executionApprovalListSchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@pi-workbench/ui/components/alert-dialog'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button } from '@pi-workbench/ui/components/button'
import { Field, FieldGroup, FieldLabel } from '@pi-workbench/ui/components/field'
import { Input } from '@pi-workbench/ui/components/input'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceLine,
  TraceTitle,
} from '@pi-workbench/ui/components/trace'

import { sessionJson } from '../../services/session-client.js'

/** Live authority is always fetched, never rebuilt from historical approvals. Unloading this
 * view releases only its query; no decision, timeout or execution follows from losing a UI. */
export function ExecutionApprovals({
  sessionId,
  csrf,
  active,
  synchronized,
}: {
  sessionId: string
  csrf: string
  active: boolean
  synchronized: boolean
}) {
  const list = useQuery({
    queryKey: ['execution-approvals', sessionId],
    enabled: active,
    queryFn: async ({ signal }) =>
      executionApprovalListSchema.parse(await sessionJson('/api/chat/approvals', signal)),
    refetchInterval: 1000,
    gcTime: 0,
    retry: false,
  })
  const approvals = list.data?.approvals.filter((a) => a.sessionId === sessionId) ?? []
  if (!approvals.length && !list.isError) {
    return null
  }
  return (
    <section className="execution-approvals" aria-label="执行前审批">
      {list.isError ? (
        <Alert>
          <AlertTitle>审批状态待同步</AlertTitle>
          <AlertDescription>
            连接中断不会执行工具；请恢复连接后核对当前请求。
            <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
              刷新审批状态
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {approvals.map((approval) => (
        <ApprovalCard
          key={approval.id}
          approval={approval}
          csrf={csrf}
          available={active && synchronized && !list.isError && list.isSuccess}
          active={active}
          refresh={() => void list.refetch()}
        />
      ))}
    </section>
  )
}

/** An allow action is a separate explicit confirmation of this one unrecoverable call.
 * Responses are tied to this mounted request; late saves cannot close another object's UI. */
function ApprovalCard({
  approval,
  csrf,
  available,
  active,
  refresh,
}: {
  approval: ExecutionApproval
  csrf: string
  available: boolean
  active: boolean
  refresh: () => void
}) {
  const [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false)
  const live = useRef(true),
    cancel = useRef<HTMLButtonElement>(null),
    lock = useRef(false)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  useEffect(() => {
    if (!active) {
      setConfirm(false)
    }
  }, [active])
  const decide = async (action: 'allow-once' | 'deny' | 'cancel') => {
    if (lock.current || !available) {
      return
    }
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await sessionJson(
        `/api/chat/approvals/${approval.id}/decision`,
        undefined,
        {
          sessionId: approval.sessionId,
          epoch: approval.epoch,
          turnId: approval.turnId,
          digest: approval.risk.digest,
          policyVersion: approval.risk.policyVersion,
          action,
          reason,
          acceptIrreversible: action === 'allow-once',
        },
        csrf,
      )
      if (live.current) {
        setConfirm(false)
        refresh()
      }
    } catch (cause) {
      if (live.current) {
        setError(cause instanceof Error ? cause.message : '决定结果待确认，请同步审批状态。')
        refresh()
      }
    } finally {
      lock.current = false
      if (live.current) {
        setBusy(false)
      }
    }
  }
  return (
    <Alert data-approval-id={approval.id}>
      <AlertTitle>
        等待审批{' '}
        <Badge variant="outline">
          {approval.risk.level} · {approval.tool}
        </Badge>
      </AlertTitle>
      <AlertDescription>
        <p>尚未执行 · 无倒计时 · 来源：受管 SDK 最终调用</p>
        <p className="approval-path">执行目录：{approval.cwd}</p>
        <p>{approval.risk.reasons.join(' ')}</p>
        <Trace>
          <TraceCollapsible>
            <TraceCollapsibleTrigger>
              <TraceLine>
                <TraceTitle>查看最终参数与调用身份</TraceTitle>
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent>
              <p className="approval-path">
                调用 {approval.callId} · 父调用 {approval.parentId ?? '无'}
              </p>
              <p className="approval-path">
                参数指纹 {approval.risk.digest} · 策略版本 {approval.risk.policyVersion}
              </p>
              <pre className="approval-parameters">{approval.parameters}</pre>
              <p>参数展示统一脱敏；指纹绑定原始最终参数。参数或目录改变后旧批准不能执行。</p>
            </TraceCollapsibleContent>
          </TraceCollapsible>
        </Trace>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`approval-reason-${approval.id}`}>决定说明（可选）</FieldLabel>
            <Input
              id={`approval-reason-${approval.id}`}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
            />
          </Field>
        </FieldGroup>
        {error ? <output>{error} 未自动重新提交决定；请核对后明确操作。</output> : null}
        <div className="approval-actions">
          <Button
            variant="outline"
            disabled={!available || busy}
            onClick={() => void decide('deny')}
          >
            拒绝本次调用
          </Button>
          <Button
            variant="outline"
            disabled={!available || busy}
            onClick={() => void decide('cancel')}
          >
            取消本次调用
          </Button>
          <Button disabled={!available || busy} onClick={() => setConfirm(true)}>
            允许本次…
          </Button>
        </div>
        <p>
          当前未建立可回滚基线。允许需再次明确接受本次不可回滚执行；不生成会话授权，也不授予系统沙箱权限。
        </p>
      </AlertDescription>
      <AlertDialog open={confirm && active} onOpenChange={setConfirm}>
        <AlertDialogContent initialFocus={cancel}>
          <AlertDialogHeader>
            <AlertDialogTitle>允许本次不可回滚调用？</AlertDialogTitle>
            <AlertDialogDescription>
              尚无可回滚基线。{approval.tool}{' '}
              可能修改文件或产生外部副作用；仅允许指纹对应的这一次调用，不允许后续或嵌套调用。请先核对目录与参数。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="approval-path">{approval.cwd}</p>
          <pre className="approval-parameters">{approval.parameters}</pre>
          {error ? <output>{error}</output> : null}
          <AlertDialogFooter>
            <AlertDialogCancel ref={cancel} disabled={busy}>
              返回核对
            </AlertDialogCancel>
            <Button disabled={!available || busy} onClick={() => void decide('allow-once')}>
              明确允许本次不可回滚执行
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Alert>
  )
}
