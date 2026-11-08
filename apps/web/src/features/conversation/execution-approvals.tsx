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
  return (
    <>
      {approvals.length || list.isError ? (
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
      ) : null}
    </>
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
    [confirm, setConfirm] = useState<'once' | 'session' | 'reuse' | null>(null),
    [confirmGrant, setConfirmGrant] = useState<string | null>(null)
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
      setConfirm(null)
    }
  }, [active])
  const decide = async (
    action: 'allow-once' | 'allow-session' | 'use-grant' | 'deny' | 'cancel',
  ) => {
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
          acceptIrreversible: ['allow-once', 'allow-session', 'use-grant'].includes(action),
          ...(action === 'use-grant' && confirmGrant ? { grantId: confirmGrant } : {}),
        },
        csrf,
      )
      if (live.current) {
        setConfirm(null)
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
        {approval.tool === 'bash' || approval.tool === 'powershell' ? (
          <p>
            目录边界仅约束受管文件工具；Shell
            可访问系统权限允许的其他目录与网络。网络目标未验证，当前没有 OS
            网络沙箱；附加根目录授权未开放。
          </p>
        ) : (
          <p>文件工具仅限当前物理 cwd，附加根目录授权未开放；目录可用不等于执行许可。</p>
        )}
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
          <Button disabled={!available || busy} onClick={() => setConfirm('once')}>
            允许本次…
          </Button>
          {approval.sessionPermission.eligible ? (
            <Button
              variant="outline"
              disabled={!available || busy}
              onClick={() => {
                setConfirmGrant(approval.sessionPermission.matchingGrantId)
                setConfirm(approval.sessionPermission.matchingGrantId ? 'reuse' : 'session')
              }}
            >
              {approval.sessionPermission.matchingGrantId ? '使用会话授权…' : '授权此会话相同参数…'}
            </Button>
          ) : (
            <p>L3 或未验证能力仅单次确认，不能生成会话授权。</p>
          )}
        </div>
        <p>
          文件版本保存不保证本次调用可整轮回滚。每次允许仍须明确接受本次不可回滚执行；会话授权只匹配所展示的完整参数，不授予系统沙箱权限。
        </p>
      </AlertDescription>
      <AlertDialog
        open={Boolean(confirm) && active}
        onOpenChange={(open) => {
          if (!open) {
            setConfirm(null)
          }
        }}
      >
        <AlertDialogContent initialFocus={cancel} className="execution-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'session'
                ? '授予此会话相同参数的授权？'
                : confirm === 'reuse'
                  ? '使用已有会话授权并确认本次执行？'
                  : '允许本次不可回滚调用？'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              文件回滚只覆盖账本可恢复的文件字节，本次调用及外部副作用不保证可回滚。
              {approval.tool} 可能修改文件或产生外部副作用。
              {confirm === 'once'
                ? '仅允许指纹对应的这一次调用。'
                : '会话授权仅匹配此工具、物理目录、目标路径和完整最终参数；不包括其他参数或嵌套调用。撤销不停止已执行动作。'}
              请先核对目录与参数；本次不可回滚确认不能用于后续动作。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="approval-path">{approval.cwd}</p>
          <pre className="approval-parameters">{approval.parameters}</pre>
          {confirm !== 'once' ? (
            <>
              <p className="approval-path">
                物理目录指纹 {approval.sessionPermission.physicalIdentity}
              </p>
              <p className="approval-path">
                目标：{approval.sessionPermission.targetPath ?? '此完整命令及工作目录'}
              </p>
              <p className="approval-path">
                最终参数指纹 {approval.sessionPermission.parameterDigest}
              </p>
              <p>服务重启／策略变化即失效；每次仍需确认本次不可回滚风险。不会自动批准 L3。</p>
            </>
          ) : null}
          {error ? <output>{error}</output> : null}
          <AlertDialogFooter>
            <AlertDialogCancel ref={cancel} disabled={busy}>
              返回核对
            </AlertDialogCancel>
            <Button
              disabled={!available || busy}
              onClick={() =>
                void decide(
                  confirm === 'session'
                    ? 'allow-session'
                    : confirm === 'reuse'
                      ? 'use-grant'
                      : 'allow-once',
                )
              }
            >
              {confirm === 'session'
                ? '明确授予授权并允许本次不可回滚执行'
                : confirm === 'reuse'
                  ? '确认本次不可回滚执行并使用授权'
                  : '明确允许本次不可回滚执行'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Alert>
  )
}
