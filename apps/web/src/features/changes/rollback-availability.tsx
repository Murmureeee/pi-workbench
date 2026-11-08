import { useInfiniteQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { changeAvailabilitySchema } from '@pi-workbench/shared'
import { Button } from '@pi-workbench/ui/components/button'

import { sessionJson } from '../../services/session-client.js'

const labels = {
  'matches-final': '当前匹配该轮收尾，可重新预检',
  'at-baseline': '当前已在该轮基线',
  changed: '当前含后续或外部修改，普通回滚不可用',
  unavailable: '当前版本无法核对',
}

/** Applicability stays separate from immutable historical Diff and review decisions.
 * The observation is bounded and refreshed after rollback; it never grants permission. */
export function RollbackAvailability({ sessionId, turnId }: { sessionId: string; turnId: string }) {
  const [enabled, setEnabled] = useState(false)
  const query = useInfiniteQuery({
    queryKey: ['change-availability', sessionId, turnId],
    enabled,
    retry: false,
    gcTime: 0,
    initialPageParam: 0,
    queryFn: async ({ signal, pageParam }) => {
      const result = changeAvailabilitySchema.parse(
        await sessionJson(
          `/api/changes/availability?${new URLSearchParams({ sessionId, turnId, offset: String(pageParam) })}`,
          signal,
        ),
      )
      if (result.sessionId !== sessionId || result.turnId !== turnId) {
        throw new Error('当前条件的轮次身份不一致。')
      }
      return result
    },
    getNextPageParam: (p) => p.next,
  })
  const first = query.data?.pages[0]
  return (
    <section aria-label="当前回滚条件与后续版本" className="rollback-availability">
      <Button
        variant="outline"
        size="sm"
        disabled={query.isFetching}
        onClick={() => (enabled ? void query.refetch() : setEnabled(true))}
      >
        核对当前回滚条件
      </Button>
      {enabled && query.isPending ? <output>正在核对当前版本与后续轮次…</output> : null}
      {query.isError ? <p role="alert">当前回滚条件未同步：{query.error.message}</p> : null}
      {first && !query.isError ? (
        <>
          <p>
            历史差异保留；以下为 {new Date(first.checkedAt).toLocaleTimeString()}{' '}
            的现场观察，执行前仍须重新预检与明确确认。
          </p>
          {first.diagnostic ? <p role="alert">{first.diagnostic}</p> : null}
          {first.owner ? (
            <p>
              目录占用：会话 {first.owner.sessionId} · 轮次 {first.owner.turnId}，完成前不能回滚。
            </p>
          ) : null}
          {first.laterTruncated ? (
            <p>仅核对最近20个后续轮次；更早依赖未完整枚举，不能据此认定没有依赖。</p>
          ) : null}
          <div className="rollback-availability-files">
            {query.data?.pages
              .flatMap((p) => p.files)
              .map((f) => (
                <article key={f.fileId} aria-label={`当前条件 ${f.path}`}>
                  <strong>{f.path}</strong>
                  <p>{labels[f.state]}</p>
                  {f.requiresExternalConfirmation ? (
                    <p>来源不确定或版本不匹配；覆盖须产品内单独明确确认。</p>
                  ) : null}
                  {f.diagnostic ? <p>{f.diagnostic}</p> : null}
                  <details>
                    <summary>依赖版本与后续轮次（{f.later.length}）</summary>
                    {f.versions.map((v) => (
                      <div key={v.path}>
                        <p>{v.path}</p>
                        <p>基线 {v.baseline ?? '不存在'}</p>
                        <p>所需收尾 {v.final ?? '不存在'}</p>
                        <p>当前 {v.current ?? '不存在'}</p>
                      </div>
                    ))}
                    {f.later.map((l) => (
                      <p key={l.turnId}>
                        后续会话 {l.sessionId} · 轮次 {l.turnId} ·{' '}
                        {l.relation === 'changed-path'
                          ? '修改相同路径，未判断旧代码块消失'
                          : '版本缺失，依赖不确定'}
                        <br />
                        基线 {l.baselineReference ?? '不可用'} → 收尾 {l.finalReference ?? '不可用'}
                      </p>
                    ))}
                  </details>
                </article>
              ))}
          </div>
          {query.hasNextPage ? (
            <Button
              size="sm"
              variant="outline"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              加载更多当前条件
            </Button>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
