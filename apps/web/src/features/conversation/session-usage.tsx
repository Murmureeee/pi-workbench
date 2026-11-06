import type { ModelTokens } from '@pi-workbench/shared'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { sessionUsageSchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Button } from '@pi-workbench/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@pi-workbench/ui/components/dialog'

import { sessionJson } from '../../services/session-client.js'

const fields: { key: keyof ModelTokens; label: string }[] = [
  { key: 'input', label: '输入' },
  { key: 'output', label: '输出' },
  { key: 'cacheRead', label: '缓存读取' },
  { key: 'cacheWrite', label: '缓存写入' },
  { key: 'total', label: '总计' },
]
const value = (count: number | null | undefined) =>
  count === null || count === undefined ? '未知' : count.toLocaleString('zh-CN')

/** On-demand, session-keyed read queries. A late page cannot replace a different session;
 * closing the dialog drops observation only, never stops or restarts SDK work. */
export function SessionUsage({ sessionId, active }: { sessionId: string; active: boolean }) {
  const [open, setOpen] = useState(false),
    [cursor, setCursor] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!active) {
      setOpen(false)
    }
  }, [active])
  const query = useQuery({
    queryKey: ['session-usage', sessionId, cursor],
    enabled: open && active,
    refetchInterval: cursor ? false : 1500,
    queryFn: async ({ signal }) => {
      const result = sessionUsageSchema.parse(
        await sessionJson(
          `/api/chat/sessions/${sessionId}/usage${cursor ? `?cursor=${cursor}` : ''}`,
          signal,
        ),
      )
      if (result.sessionId !== sessionId) {
        throw new Error('用量响应身份不匹配。')
      }
      return result
    },
  })
  const data = query.data
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setCursor(null)
        }
      }}
    >
      <DialogTrigger
        ref={trigger}
        render={
          <Button variant="ghost" size="sm">
            上下文与用量
          </Button>
        }
      />
      <DialogContent
        finalFocus={trigger}
        className="max-h-[calc(100dvh-32px)] overflow-y-auto sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>上下文与用量</DialogTitle>
          <DialogDescription>
            只读 SDK
            原生历史。最近请求供上下文参考，不包含尚未发送的草稿或后续工具；不额外调用模型。
          </DialogDescription>
        </DialogHeader>
        <p className="phase-note">
          计数来自 SDK 记录；缺失或无法区分 SDK
          默认零值时显示未知。费用与价格未知：没有可核验的价格来源和生效时间，不估算账单。离线夹具计数不是实际提供商用量。
        </p>
        {query.isPending ? <output>正在读取用量…</output> : null}
        {query.isError ? (
          <Alert variant="destructive">
            <AlertTitle>用量未同步</AlertTitle>
            <AlertDescription>
              当前数据可能过期；{query.error.message}
              <Button variant="outline" onClick={() => void query.refetch()}>
                重新读取用量
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {data ? (
          <>
            <section aria-label="会话用量汇总" className="flex flex-col gap-2">
              <h3>会话记录 · {data.totalTurns} 轮</h3>
              <p>
                上下文参考：最近已提交请求总计 {value(data.latest?.tokens.total)} Token；配置窗口{' '}
                {value(data.latest?.contextWindow)} Token
                {data.latest?.contextWindow ? '（宿主离线模型元数据）' : '（无可核验来源）'}
                。这不是当前精确上下文。
              </p>
              <dl className="grid grid-cols-2 gap-2">
                {fields.map((field) => (
                  <div key={field.key}>
                    <dt>{field.label}</dt>
                    <dd>
                      已记录 {value(data.totals[field.key].known)} · 未知{' '}
                      {data.totals[field.key].unknown} 次
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="phase-note">
                只累计已提交助手记录，不以字符数估算
                Token。已记录部分不代表完整总量；失败或中断也可能缺少报告。
              </p>
              <p className="phase-note">
                读取时间：{new Date(data.observedAt).toLocaleString('zh-CN')} · 来源 SDK JSONL
              </p>
            </section>
            {data.diagnostics.length ? (
              <Alert>
                <AlertTitle>历史不完整</AlertTitle>
                <AlertDescription>
                  统计仅包含可读记录：{data.diagnostics.join('、')}。原件保留。
                </AlertDescription>
              </Alert>
            ) : null}
            {data.turns.length ? (
              data.turns.toReversed().map((turn) => (
                <section
                  key={turn.turnId}
                  aria-label={`轮次用量 ${turn.turnId}`}
                  className="flex min-w-0 flex-col gap-2 border-t pt-3"
                >
                  <h3 className="break-all">轮次 {turn.turnId}</h3>
                  <p>
                    {new Date(turn.createdAt).toLocaleString('zh-CN')} · 状态 {turn.status} ·
                    已提交模型记录 {turn.totalRequests} 条
                  </p>
                  {turn.requests.length ? (
                    turn.requests.map((request) => (
                      <details key={request.messageId}>
                        <summary className="cursor-pointer break-all">
                          {request.provider ?? '未知提供商'} / {request.model ?? '未知模型'} · 总计{' '}
                          {value(request.tokens.total)} Token
                        </summary>
                        <p className="phase-note break-all">
                          消息 {request.messageId} · 代际 {request.epoch} · 记录时间{' '}
                          {request.at ? new Date(request.at).toLocaleString('zh-CN') : '未知'}
                        </p>
                        <dl className="grid grid-cols-2 gap-2">
                          {fields.map((field) => (
                            <div key={field.key}>
                              <dt>{field.label}</dt>
                              <dd>{value(request.tokens[field.key])}</dd>
                            </div>
                          ))}
                        </dl>
                        <p>费用未知 · 价格来源未知 · 价格时间未知</p>
                      </details>
                    ))
                  ) : (
                    <p>无已提交用量报告；不推断零用量。</p>
                  )}
                  {turn.totalRequests > turn.requests.length ? (
                    <p>仅展示最近 100 条模型记录；会话合计包含可读记录。</p>
                  ) : null}
                </section>
              ))
            ) : (
              <p>尚无轮次记录。</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={!data.nextCursor}
                onClick={() => setCursor(data.nextCursor)}
              >
                更早轮次
              </Button>
              <Button variant="outline" disabled={!cursor} onClick={() => setCursor(null)}>
                最新用量
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
