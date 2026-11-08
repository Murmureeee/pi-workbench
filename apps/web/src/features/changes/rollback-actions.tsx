import type { RollbackRecord } from '@pi-workbench/shared'

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import {
  accessSnapshotSchema,
  rollbackPlanSchema,
  rollbackRecordSchema,
} from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Button } from '@pi-workbench/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pi-workbench/ui/components/dialog'

import { sessionJson } from '../../services/session-client.js'
import { rollbackStateLabel } from './rollback-labels.js'

/** Explicit host-owned file/round rollback. No mutation retries, optimistic success or
 * persisted permits. A lost response is reconciled by operation ID; switching views never
 * cancels an executing operation or lets its response replace another selected target. */
export function RollbackActions({
  sessionId,
  turnId,
  fileId,
}: {
  sessionId: string
  turnId: string
  fileId: string | null
}) {
  const cache = useQueryClient(),
    access = accessSnapshotSchema.parse(cache.getQueryData(['client-access']))
  const [record, setRecord] = useState<RollbackRecord | null>(null),
    [confirmationId, setConfirmationId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [open, setOpen] = useState(false),
    [external, setExternal] = useState(false)
  const alive = useRef(true),
    attempt = useRef(0)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const key = `piw.rollback:${sessionId}:${turnId}:${fileId ?? 'round'}`
  const store = (value: RollbackRecord) => {
    sessionStorage.setItem(key, value.id)
    setRecord(value)
  }
  const prepare = async () => {
    const version = ++attempt.current
    setBusy(true)
    setError('')
    try {
      const value = rollbackPlanSchema.parse(
        await sessionJson(
          '/api/changes/rollback/prepare',
          undefined,
          { sessionId, turnId, fileId },
          access.csrf ?? '',
        ),
      )
      if (!alive.current || version !== attempt.current) {
        return
      }
      if (
        value.record.sessionId !== sessionId ||
        value.record.turnId !== turnId ||
        value.record.fileId !== fileId
      ) {
        throw new Error('回滚目标身份不一致。')
      }
      store(value.record)
      setConfirmationId(value.confirmationId)
      setExternal(false)
      setOpen(true)
    } catch (e) {
      if (alive.current && version === attempt.current) {
        setError(e instanceof Error ? e.message : '预检失败，未执行。')
      }
    } finally {
      if (alive.current && version === attempt.current) {
        setBusy(false)
      }
    }
  }
  const command = async (action: 'confirm' | 'confirm-external' | 'cancel') => {
    if (!record || !confirmationId) {
      return
    }
    const version = ++attempt.current
    setBusy(true)
    setError('')
    try {
      const value = rollbackRecordSchema.parse(
        await sessionJson(
          '/api/changes/rollback/command',
          undefined,
          { sessionId, operationId: record.id, confirmationId, action },
          access.csrf ?? '',
        ),
      )
      if (!alive.current || version !== attempt.current) {
        return
      }
      if (value.sessionId !== sessionId || value.id !== record.id) {
        throw new Error('回滚结果身份不一致。')
      }
      store(value)
      setConfirmationId(null)
      setOpen(false)
      void cache.invalidateQueries({ queryKey: ['change-rollback', sessionId] })
      void cache.invalidateQueries({ queryKey: ['change-availability'] })
      void cache.invalidateQueries({ queryKey: ['change-decisions', sessionId, turnId] })
    } catch (e) {
      if (alive.current && version === attempt.current) {
        setError(e instanceof Error ? e.message : '回滚结果未知，请核对操作状态。')
        setConfirmationId(null)
        setOpen(false)
      }
    } finally {
      if (alive.current && version === attempt.current) {
        setBusy(false)
      }
    }
  }
  const reconcile = async () => {
    const operationId = record?.id ?? sessionStorage.getItem(key)
    if (!operationId) {
      setError('本窗口尚无回滚操作，请先预检。')
      return
    }
    const version = ++attempt.current
    setBusy(true)
    setError('')
    try {
      const value = rollbackRecordSchema.parse(
        await sessionJson(
          `/api/changes/rollback/record?${new URLSearchParams({ sessionId, operationId })}`,
        ),
      )
      if (alive.current && version === attempt.current) {
        if (value.id !== operationId || value.turnId !== turnId || value.fileId !== fileId) {
          throw new Error('回滚记录目标不一致。')
        }
        store(value)
        void cache.invalidateQueries({ queryKey: ['change-availability'] })
        void cache.invalidateQueries({ queryKey: ['change-decisions', sessionId, turnId] })
      }
    } catch (e) {
      if (alive.current && version === attempt.current) {
        setError(e instanceof Error ? e.message : '操作记录未同步。')
      }
    } finally {
      if (alive.current && version === attempt.current) {
        setBusy(false)
      }
    }
  }
  const conflict = record?.files.some((f) => f.conflict) ?? false
  return (
    <section aria-label={fileId ? '整文件回滚' : '整轮回滚'} className="rollback-actions">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void prepare()}>
          {fileId ? '预检整文件回滚' : '预检整轮回滚'}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void reconcile()}>
          核对回滚结果
        </Button>
      </div>
      {busy ? <output>正在核对回滚操作…</output> : null}
      {record ? (
        <output>
          {rollbackStateLabel[record.state]} · 操作 {record.id}
        </output>
      ) : null}
      {record?.diagnostic ? <p>{record.diagnostic}</p> : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>回滚未确认成功</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value && !busy) {
            void command('cancel')
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="rollback-confirmation"
          initialFocus={false}
        >
          <DialogHeader>
            <DialogTitle>
              {external ? '单独确认覆盖外部内容' : conflict ? '整批预检存在冲突' : '确认本次回滚'}
            </DialogTitle>
            <DialogDescription>
              轮次 {turnId} · {fileId ? '所选整文件' : '整轮文件'}
              。恢复到该轮写入前基线，消息历史保留。目录占用及文件版本会再次核对。
            </DialogDescription>
          </DialogHeader>
          <div className="rollback-targets">
            {record?.files.map((f) => (
              <section key={f.path}>
                <strong>{f.path}</strong>
                <p>
                  {f.conflict ? '冲突／来源不确定，普通确认不会写入' : '当前字节匹配所选收尾版本'}
                </p>
                <p>当前 {f.current ?? '不存在'}</p>
                <p>恢复到 {f.target ?? '删除文件'}</p>
              </section>
            ))}
          </div>
          {external ? (
            <Alert variant="destructive">
              <AlertTitle>本次将覆盖所列外部或未知来源内容</AlertTitle>
              <AlertDescription>
                这些内容不能当作 agent
                独占修改。本次确认仅绑定以上当前版本；变化后必须重新预检。运行失败按条件补偿，冲突保留现场。
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => void command('cancel')}>
              取消本次回滚
            </Button>
            {external ? (
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => void command('confirm-external')}
              >
                明确覆盖以上外部或未知内容并回滚
              </Button>
            ) : conflict ? (
              <Button variant="outline" disabled={busy} onClick={() => setExternal(true)}>
                单独确认覆盖…
              </Button>
            ) : (
              <Button variant="destructive" disabled={busy} onClick={() => void command('confirm')}>
                确认回到本轮基线
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
