import type { useInputQueue } from './use-input-queue.js'
import type { RuntimeSnapshot, SessionSubmission, StopIntent } from '@pi-workbench/shared'

import { useState } from 'react'

import { selectRunActivity } from '@pi-workbench/shared'
import { Button } from '@pi-workbench/ui/components/button'
import { Trace, TraceLine, TraceTitle } from '@pi-workbench/ui/components/trace'

import { ModelRequestStatus } from './model-request-status.js'

/** Window-local terminal dismissal never mutates tasks, unread cursors, queues or decisions.
 * Only the selected activity may introduce a terminal label; HTTP can precede WS updates. */
export function CurrentRunStatus({
  submission,
  turn,
  submissions,
  queue,
  synchronized,
  stop,
}: {
  submission: SessionSubmission
  turn: RuntimeSnapshot['turns'][number] | undefined
  submissions: SessionSubmission[]
  queue: ReturnType<typeof useInputQueue>
  synchronized: boolean
  stop: StopIntent | null
}) {
  const [dismissed, setDismissed] = useState('')
  const activity = selectRunActivity({
    submission,
    turn,
    records: queue.data?.records ?? [],
    knownTurnIds: submissions.map((s) => s.turnId),
    synchronized: synchronized && queue.isSuccess && !queue.isError,
    stop,
  })
  if (activity.dismissible && dismissed === activity.stamp) {
    return null
  }
  const coarse = [
    'continuing',
    'held',
    'unconfirmed',
    'syncing',
    'stop-unknown',
    'stopping',
  ].includes(activity.code)
    ? activity.label
    : submission.status === 'executing' && turn?.phase === 'running'
      ? '运行中'
      : activity.label
  return (
    <section
      aria-label="当前运行阶段"
      aria-live="polite"
      className="current-run-status"
      data-operation-id={submission.requestId}
      data-stage={activity.code}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Trace>
          <TraceLine>
            <TraceTitle>
              <output aria-label="任务状态">{coarse}</output>
              {coarse !== activity.label ? ` · ${activity.label}` : ''}
            </TraceTitle>
          </TraceLine>
        </Trace>
        {activity.dismissible ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => setDismissed(activity.stamp)}
          >
            隐藏状态提示
          </Button>
        ) : null}
      </div>
      {activity.detail ? <p className="phase-note">{activity.detail}</p> : null}
      {activity.error || activity.code === 'retry' ? (
        <ModelRequestStatus
          key={submission.requestId}
          request={activity.code === 'retry' ? turn?.modelRequest : undefined}
          error={activity.error}
          metrics={false}
        />
      ) : null}
    </section>
  )
}
