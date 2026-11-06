import type { InputQueueRecord } from './input-queue.js'
import type { RuntimeSnapshot } from './runtime-contracts.js'
import type { SessionSubmission } from './session-contracts.js'

import { z } from 'zod'

/** Bounded SDK lifecycle observations; neither instructions nor estimated progress. */
export const runStageSchema = z.enum([
  'starting',
  'preparing-tools',
  'executing-tools',
  'waiting-model',
  'streaming',
  'compacting',
  'settling',
])
export type RunStage = z.infer<typeof runStageSchema>
export type StopIntent = {
  requestId: string
  turnId: string
  state: 'sending' | 'requested' | 'unknown'
  error: string | null
}
export type RunActivity = {
  code: string
  label: string
  detail: string
  dismissible: boolean
  error: string | null
  stamp: string
}
const stages: Record<RunStage, string> = {
  starting: '启动运行时',
  'preparing-tools': '准备工具参数',
  'executing-tools': '执行工具',
  'waiting-model': '等待模型响应',
  streaming: '接收模型回复',
  compacting: '压缩上下文',
  settling: '收尾与保存',
}
export const submissionStatusNames = {
  pending: '等待执行资源',
  executing: '已保存 · 等待运行时确认',
  completed: '本轮已结束',
  failed: '本轮失败',
  aborted: '本轮已停止',
  interrupted: '已中断 · 未自动重发',
} as const

/** Selects one immutable product operation's feedback. Durable terminal plus no outstanding
 * lifecycle/queue work is required for completion. Tokens use identity, never error text.
 * No IO, timers, authority writes or permission decisions occur here.
 */
export function selectRunActivity({
  submission,
  turn,
  records,
  knownTurnIds,
  synchronized,
  stop,
}: {
  submission: SessionSubmission
  turn: RuntimeSnapshot['turns'][number] | undefined
  records: InputQueueRecord[]
  knownTurnIds: string[]
  synchronized: boolean
  stop: StopIntent | null
}): RunActivity {
  const current = turn?.id === submission.turnId ? turn : undefined
  const terminal = !['pending', 'executing'].includes(submission.status)
  const intent =
    stop?.requestId === submission.requestId && stop.turnId === submission.turnId ? stop : null
  const operationError =
    submission.status === 'interrupted'
      ? (submission.error ?? current?.error ?? null)
      : submission.status === 'failed' || (!terminal && current?.phase === 'error')
        ? (current?.error ?? submission.error ?? current?.modelRequest?.error ?? null)
        : null
  const result = (
    code: string,
    label: string,
    detail = '',
    dismissible = false,
    error: string | null = operationError,
  ): RunActivity => ({
    code,
    label,
    detail,
    dismissible,
    error,
    stamp: `${submission.sessionId}:${submission.requestId}:${submission.status}:${code}`,
  })
  if (!terminal && intent) {
    return result(
      intent.state === 'unknown' ? 'stop-unknown' : 'stopping',
      intent.state === 'unknown'
        ? '停止结果未知'
        : intent.state === 'sending'
          ? '正在请求停止'
          : '停止请求已确认 · 等待停止结果',
      '收到本轮权威终态前不视为已停止；后台任务和待发输入须继续核对。',
      false,
      intent.error,
    )
  }
  if (!terminal && current?.phase === 'stopping') {
    return result('stopping', '停止请求已确认 · 等待停止结果')
  }
  if (!synchronized) {
    return result('syncing', '运行状态待同步', '已保存结果保留；断线或队列未同步不代表完成或停止。')
  }
  if (current?.approval) {
    return result('approval', '等待审批', '未裁决，不设倒计时；离开页面不自动执行。')
  }
  if (current?.stage === 'compacting' && ['running', 'stopping'].includes(current.phase)) {
    return result('compacting', stages.compacting)
  }
  if (current?.tools.some((t) => t.status === 'running')) {
    return result('executing-tools', stages['executing-tools'])
  }
  if (current?.tools.some((t) => t.status === 'pending')) {
    return result('preparing-tools', stages['preparing-tools'])
  }
  if (submission.status === 'completed' && current?.tools.some((t) => t.status === 'interrupted')) {
    return result('unconfirmed', '工具结果待核对', '存在缺少确认结果的工具调用，不能视为任务完成。')
  }
  if (current?.modelRequest?.state === 'waiting') {
    return result(
      'retry',
      '等待重试',
      '等待宿主事件；计时到点不会自行执行。',
      false,
      current.modelRequest.error,
    )
  }
  const queue = records.filter((r) => r.sessionId === submission.sessionId)
  if (
    terminal &&
    queue.some(
      (r) =>
        ['queued', 'sending'].includes(r.status) ||
        (r.status === 'delivered' &&
          r.deliveredTurnId &&
          !knownTurnIds.includes(r.deliveredTurnId)),
    )
  ) {
    return result('continuing', '队列延续中', '上一轮已落稳，正在确认后续轮次。')
  }
  if (terminal && queue.some((r) => ['held', 'uncertain'].includes(r.status))) {
    return result(
      'held',
      '待发输入需要处理',
      '已暂停或送达未知；核对队列并明确恢复或取消，不自动执行。',
    )
  }
  if (terminal && current && ['running', 'stopping'].includes(current.phase)) {
    return result('unconfirmed', '运行结果待确认', '提交结果与运行时尚未一致，不视为完成。')
  }
  if (!terminal) {
    if (submission.status === 'pending') {
      return result('queued', submissionStatusNames.pending)
    }
    if (current && ['completed', 'error', 'aborted', 'interrupted'].includes(current.phase)) {
      return result('settling', stages.settling)
    }
    const stage = current?.stage ?? 'starting'
    return result(stage, stages[stage])
  }
  return result(
    submission.status,
    submissionStatusNames[submission.status],
    submission.status === 'interrupted' ? '执行结果与停止状态待核对；未自动重发。' : '',
    submission.status !== 'interrupted',
    operationError,
  )
}
