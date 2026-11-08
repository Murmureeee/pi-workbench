import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import {
  accessSnapshotSchema,
  changeDecisionSchema,
  changeDecisionsSchema,
} from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Button } from '@pi-workbench/ui/components/button'

import { sessionJson } from '../../services/session-client.js'

const outcomes = {
  active: '运行中',
  completed: '成功',
  failed: '失败',
  aborted: '已中止',
  interrupted: '已中断',
}

/** Durable review is independent of runtime outcome and today's file applicability.
 * The keyed parent and abortable query isolate late replies; mutations never retry. */
export function ReviewDecisions({
  sessionId,
  turnId,
  fileId,
  baselineReference,
  finalReference,
}: {
  sessionId: string
  turnId: string
  fileId: string | null
  baselineReference: string
  finalReference: string
}) {
  const cache = useQueryClient(),
    access = accessSnapshotSchema.parse(cache.getQueryData(['client-access']))
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const status = useQuery({
    queryKey: ['change-decisions', sessionId, turnId],
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const value = changeDecisionsSchema.parse(
        await sessionJson(
          `/api/changes/decisions?${new URLSearchParams({ sessionId, turnId })}`,
          signal,
        ),
      )
      if (
        value.sessionId !== sessionId ||
        value.turnId !== turnId ||
        value.baselineReference !== baselineReference ||
        value.finalReference !== finalReference
      ) {
        throw new Error('审查决定身份或版本不一致。')
      }
      return value
    },
  })
  const data = status.isError ? undefined : status.data,
    selected = data?.files.find((f) => f.fileId === fileId)
  const accept = async () => {
    if (!fileId || busy) {
      return
    }
    setBusy(true)
    setError('')
    const input = { sessionId, turnId, fileId, baselineReference, finalReference }
    try {
      const value = changeDecisionSchema.parse(
        await sessionJson('/api/changes/decisions/accept', undefined, input, access.csrf ?? ''),
      )
      if (
        value.sessionId !== sessionId ||
        value.turnId !== turnId ||
        value.fileId !== fileId ||
        value.baselineReference !== baselineReference ||
        value.finalReference !== finalReference
      ) {
        throw new Error('接受回执身份或版本不一致。')
      }
      // Reconcile daemon truth even if the originating pane has since unmounted.
      await cache.invalidateQueries({ queryKey: ['change-decisions', sessionId, turnId] })
    } catch (e) {
      if (alive.current) {
        setError(e instanceof Error ? e.message : '接受未确认保存，请先刷新决定。')
      }
    } finally {
      if (alive.current) {
        setBusy(false)
      }
    }
  }
  return (
    <section aria-label="逐文件审查进度" className="rollback-actions">
      {data ? (
        <>
          <p>
            运行结果：{outcomes[data.outcome]} · 已处理 {data.processed}/{data.total}
            {data.total === 0 ? ' · 无需处理' : ''}
          </p>
          <p>接受只记录保留决定，不改文件。后续修改不抹掉原决定；当前适用性见独立核对。</p>
          {selected ? (
            <>
              <p>
                所选文件：{selected.accepted ? '已接受保留' : '尚未接受'} ·{' '}
                {selected.rollbackId ? '曾成功回滚' : '尚无成功回滚'}
              </p>
              {selected.accepted ? (
                <p>
                  保留决定 {selected.accepted.id} ·{' '}
                  {new Date(selected.accepted.at).toLocaleString()}
                </p>
              ) : null}
              {selected.rollbackId ? <p>成功回滚 {selected.rollbackId}</p> : null}
            </>
          ) : (
            <p>选择一个文件记录保留决定。</p>
          )}
        </>
      ) : null}
      {status.isPending ? <output>正在核对审查决定…</output> : null}
      {status.isError ? (
        <Alert variant="destructive">
          <AlertTitle>审查进度未同步</AlertTitle>
          <AlertDescription>{status.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>接受未确认保存</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!selected || Boolean(selected.accepted) || busy || status.isFetching}
          onClick={() => void accept()}
        >
          接受并保留所选文件
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || status.isFetching}
          onClick={() => void status.refetch()}
        >
          刷新审查决定
        </Button>
      </div>
      {busy ? <output>正在保存保留决定…</output> : null}
    </section>
  )
}
