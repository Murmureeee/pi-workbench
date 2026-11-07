import type { ChangeRound, FileSnapshot } from '@pi-workbench/shared'

import { useInfiniteQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { changeHistorySchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button } from '@pi-workbench/ui/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@pi-workbench/ui/components/collapsible'

import { sessionJson } from '../../services/session-client.js'
import { ChangeSources } from './change-sources.js'

const outcome = {
  active: '本轮进行中',
  completed: '本轮成功',
  failed: '本轮失败',
  aborted: '本轮已中止',
  interrupted: '本轮已中断',
}
const snapshotLabel = (snapshot: FileSnapshot) =>
  ({ pending: '等待保存', ready: '已保存', failed: '保存失败', unavailable: '不可用' })[
    snapshot.status
  ]

/** Session-scoped metadata only. Polling/unmounting never starts, stops or restores a task;
 * stale responses cannot replace another session, including after view-cache eviction. */
export function ChangeSnapshots({
  sessionId,
  review,
}: {
  sessionId: string
  review: (turnId: string, trigger: HTMLButtonElement) => void
}) {
  return <SnapshotHistory key={sessionId} sessionId={sessionId} review={review} />
}

function SnapshotHistory({
  sessionId,
  review,
}: {
  sessionId: string
  review: (turnId: string, trigger: HTMLButtonElement) => void
}) {
  const [visibleSince] = useState(() => Date.now())
  const query = useInfiniteQuery({
    queryKey: ['change-rounds', sessionId],
    initialPageParam: null as number | null,
    queryFn: async ({ signal, pageParam }) =>
      changeHistorySchema.parse(
        await sessionJson(
          `/api/changes/rounds?${new URLSearchParams({ sessionId, ...(pageParam ? { before: String(pageParam) } : {}) })}`,
          signal,
        ),
      ),
    getNextPageParam: (page, pages) => (pages.length < 5 ? page.next : null),
    refetchInterval: 1000,
    refetchOnMount: 'always',
    retry: false,
    staleTime: 0,
  })
  const pages =
    !query.isError &&
    query.dataUpdatedAt >= visibleSince &&
    query.data?.pages.every((page) => page.sessionId === sessionId)
      ? query.data.pages
      : []
  const rounds = pages.flatMap((page) => page.rounds),
    latest = rounds[0]
  return (
    <section
      aria-label="轮次文件版本"
      className="flex min-w-0 flex-col gap-2 border-b bg-background px-5 py-2 text-xs"
    >
      <Collapsible>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={latest?.baseline.status === 'failed' ? 'destructive' : 'outline'}>
            {query.isError
              ? '文件版本待同步'
              : !pages.length
                ? '正在核对文件版本…'
                : latest
                  ? `基线${snapshotLabel(latest.baseline)}`
                  : '尚无轮次文件版本'}
          </Badge>
          {latest ? (
            <span>
              {outcome[latest.outcome]} · 收尾{snapshotLabel(latest.final)}
            </span>
          ) : null}
          <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
            查看轮次文件版本
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="flex flex-col gap-3 pt-2">
          <p>
            文件版本保存不等于可整轮回滚。可只读审查历史差异与来源；接受和回滚入口尚未交付，禁止自动回滚。
          </p>
          {query.isError ? (
            <Alert>
              <AlertTitle>文件版本记录未同步</AlertTitle>
              <AlertDescription>
                现场与任务保留，请重新核对。
                <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                  刷新文件版本
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {pages.length && !rounds.length ? (
            <p>尚未准入的排队任务不创建基线；本次未恢复旧授权或自动重放。</p>
          ) : null}
          {rounds.map((round) => (
            <RoundVersion key={round.turnId} round={round} review={review} />
          ))}
          {query.hasNextPage ? (
            <Button
              variant="outline"
              size="sm"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              加载更早轮次文件版本
            </Button>
          ) : null}
          {pages.length >= 5 && pages.at(-1)?.next ? (
            <p>当前最多展示 100 轮，原记录保留。</p>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}

function RoundVersion({
  round,
  review,
}: {
  round: ChangeRound
  review: (turnId: string, trigger: HTMLButtonElement) => void
}) {
  return (
    <article
      aria-label={`文件版本轮次 ${round.turnId}`}
      className="flex min-w-0 flex-col gap-2 border-t pt-2"
    >
      <p className="break-all">
        {outcome[round.outcome]} · 轮次 {round.turnId} ·{' '}
        {new Date(round.startedAt).toLocaleString()}
        <br />
        执行目录：{round.cwd}
      </p>
      {(['baseline', 'final'] as const).map((phase) => {
        const snapshot = round[phase],
          label = phase === 'baseline' ? '写入前基线' : '收尾版本'
        return (
          <div key={phase} className="flex min-w-0 flex-col gap-1">
            <p>
              {label}：{snapshotLabel(snapshot)}
              {snapshot.status === 'ready'
                ? ` · ${snapshot.files} 个文件 · ${snapshot.bytes} 字节 · ${snapshot.excluded} 项排除`
                : ''}
            </p>
            {snapshot.reference ? (
              <p className="break-all">版本引用：{snapshot.reference}</p>
            ) : null}
            {snapshot.diagnostic ? (
              <Alert variant="destructive">
                <AlertTitle>
                  {label}
                  {snapshotLabel(snapshot)}
                </AlertTitle>
                <AlertDescription className="break-all">
                  {snapshot.diagnostic}
                  {phase === 'baseline'
                    ? ' 写入暂停；仅最终参数的本次明确确认可接受不可回滚执行，会话授权不能替代。'
                    : ' 未以当前目录补造历史文件。'}
                </AlertDescription>
              </Alert>
            ) : null}
            {snapshot.exclusions.length ? (
              <Collapsible>
                <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
                  查看{label}排除范围
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul className="flex flex-col gap-1">
                    {snapshot.exclusions.map((item) => (
                      <li key={item.path} className="break-all">
                        {item.path}：{item.reason}
                      </li>
                    ))}
                  </ul>
                  {snapshot.excluded > snapshot.exclusions.length ? (
                    <p>仅展示前 32 项，另有排除项。</p>
                  ) : null}
                </CollapsibleContent>
              </Collapsible>
            ) : null}
          </div>
        )
      })}
      <p>
        来源不确定：文件工具、命令与外部编辑可能混合；文件字节不覆盖
        ACL、空目录、排除项或外部副作用。
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={(event) => review(round.turnId, event.currentTarget)}
        >
          审查本轮文件差异
        </Button>
        <ChangeSources sessionId={round.sessionId} turnId={round.turnId} />
      </div>
    </article>
  )
}
