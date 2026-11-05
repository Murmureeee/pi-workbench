import type { InputQueueCommand, InputQueueRecord } from '@pi-workbench/shared'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { inputQueueSchema } from '@pi-workbench/shared'
import { Button } from '@pi-workbench/ui/components/button'
import { InputGroup, InputGroupTextarea } from '@pi-workbench/ui/components/input-group'

import { sessionJson } from '../../services/session-client.js'

const statuses = {
  queued: '等待可用边界',
  held: '已暂停 · 不自动执行',
  sending: '送达确认中 · 不可编辑',
  uncertain: '送达未知 · 请核对历史',
  delivered: '已送达',
  cancelled: '已取消',
}

/** Presentation owns only editing buffers. The daemon owns ordering and claims; lost POST
 * replies are reconciled by polling, never automatically retried or resumed by the view. */
export function SessionInputQueue({
  sessionId,
  turnId,
  csrf,
  text,
  enabled,
  onQueued,
}: {
  sessionId: string
  turnId: string | null
  csrf: string
  text: string
  enabled: boolean
  onQueued: (text: string) => void
}) {
  const query = useQuery({
    queryKey: ['input-queue', sessionId],
    queryFn: async ({ signal }) =>
      inputQueueSchema.parse(await sessionJson(`/api/chat/sessions/${sessionId}/queue`, signal)),
    enabled,
    refetchInterval: 600,
    gcTime: 0,
  })
  const [pending, setPending] = useState(false),
    [error, setError] = useState('')
  const [editing, setEditing] = useState<{ record: InputQueueRecord; text: string } | null>(null)
  const generation = useRef(0),
    busy = useRef(false)
  const enqueue = useRef<{
    id: string
    kind: 'steer' | 'follow-up'
    text: string
    turnId: string
  } | null>(null)
  useEffect(
    () => () => {
      generation.current++
    },
    [sessionId],
  )
  const command = async (input: InputQueueCommand) => {
    if (busy.current) {
      return
    }
    const token = generation.current
    busy.current = true
    setPending(true)
    setError('')
    try {
      const result = inputQueueSchema.parse(
        await sessionJson(`/api/chat/sessions/${sessionId}/queue`, undefined, input, csrf),
      )
      if (generation.current !== token || result.sessionId !== sessionId) {
        return
      }
      await query.refetch()
      if (generation.current !== token) {
        return
      }
      if (input.action === 'enqueue') {
        onQueued(input.text)
        enqueue.current = null
      }
      if (input.action === 'edit') {
        setEditing(null)
      }
    } catch (cause) {
      if (generation.current === token) {
        setError(cause instanceof Error ? cause.message : '保存未确认；编辑保留。')
        // Refresh authority before enabling a new edit after a conflict. The separate
        // editing buffer stays intact until the user explicitly cancels or saves it.
        await query.refetch()
      }
    } finally {
      busy.current = false
      if (generation.current === token) {
        setPending(false)
      }
    }
  }
  const add = (kind: 'steer' | 'follow-up') => {
    if (!turnId || !text.trim()) {
      return
    }
    if (
      !enqueue.current ||
      enqueue.current.text !== text.trim() ||
      enqueue.current.kind !== kind ||
      enqueue.current.turnId !== turnId
    ) {
      enqueue.current = { id: crypto.randomUUID(), kind, text: text.trim(), turnId }
    }
    void command({ action: 'enqueue', ...enqueue.current })
  }
  const records = query.data?.records ?? []
  const canEnqueue = Boolean(turnId && query.data?.activeTurnId === turnId)
  if (!records.length && (!turnId || !text.trim()) && !query.isError && !error) {
    return null
  }
  return (
    <section
      aria-label="引导与追加队列"
      className="flex max-h-64 flex-col gap-2 overflow-y-auto text-xs"
    >
      <p className="text-muted-foreground">
        引导在当前轮的可用模型边界优先送达；追加等待本轮落稳后开启下一轮。两类各自先进先出。
      </p>
      {turnId ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !enabled || !canEnqueue || !text.trim() || query.isError}
            onClick={() => add('steer')}
          >
            引导当前轮
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !enabled || !canEnqueue || !text.trim() || query.isError}
            onClick={() => add('follow-up')}
          >
            追加下一轮
          </Button>
        </div>
      ) : null}
      {query.isError ? <p role="alert">队列未同步，暂停操作；正文与后台任务保留。</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {records.map((record) => (
        <div
          className="flex flex-col gap-2 rounded-md border p-2"
          key={record.id}
          data-queue-id={record.id}
        >
          <p>
            {record.kind === 'steer' ? '引导' : '追加'} · {statuses[record.status]}
          </p>
          <p className="break-words whitespace-pre-wrap">{record.text}</p>
          {record.error ? <p role="alert">{record.error}</p> : null}
          {editing?.record.id === record.id ? (
            <div className="flex flex-col gap-2">
              <InputGroup>
                <InputGroupTextarea
                  aria-label="编辑待发消息"
                  maxLength={16000}
                  value={editing.text}
                  onChange={(event) => setEditing({ ...editing, text: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
                      return
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setEditing(null)
                    }
                  }}
                />
              </InputGroup>
              <Button
                size="sm"
                disabled={pending || !editing.text.trim()}
                onClick={() =>
                  void command({
                    action: 'edit',
                    id: record.id,
                    revision: editing.record.revision,
                    text: editing.text,
                  })
                }
              >
                保存待发消息
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(null)}>
                取消编辑
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {['queued', 'held'].includes(record.status) ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending || !enabled}
                onClick={() => setEditing({ record, text: record.text })}
              >
                编辑待发消息
              </Button>
            ) : null}
            {['queued', 'held', 'uncertain'].includes(record.status) ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending || !enabled}
                onClick={() =>
                  void command({ action: 'cancel', id: record.id, revision: record.revision })
                }
              >
                取消待发消息
              </Button>
            ) : null}
            {record.status === 'held' ? (
              <Button
                size="sm"
                variant="outline"
                disabled={pending || !enabled || Boolean(turnId)}
                onClick={() =>
                  void command({ action: 'resume', id: record.id, revision: record.revision })
                }
              >
                明确恢复此消息为新轮次
              </Button>
            ) : null}
          </div>
        </div>
      ))}
      {records.some((record) => ['held', 'uncertain'].includes(record.status)) ? (
        <p>停止与重启保留输入，不自动恢复。送达未知的消息先核对历史，再取消记录或另行输入。</p>
      ) : null}
    </section>
  )
}
