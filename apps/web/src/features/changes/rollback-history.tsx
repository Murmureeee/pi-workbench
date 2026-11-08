import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { rollbackHistorySchema, rollbackRecordSchema } from '@pi-workbench/shared'
import { Button } from '@pi-workbench/ui/components/button'

import { sessionJson } from '../../services/session-client.js'
import { rollbackStateLabel } from './rollback-labels.js'

/** Durable facts can be reopened after profile restart without any remembered permit.
 * Queries bind session and operation; errors never show another operation's old details. */
export function RollbackHistory({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState<string | null>(null)
  const query = useInfiniteQuery({
    queryKey: ['change-rollback', sessionId],
    enabled: open,
    retry: false,
    gcTime: 0,
    initialPageParam: null as number | null,
    queryFn: async ({ signal, pageParam }) => {
      const r = rollbackHistorySchema.parse(
        await sessionJson(
          `/api/changes/rollback/history?${new URLSearchParams({ sessionId, ...(pageParam ? { before: String(pageParam) } : {}) })}`,
          signal,
        ),
      )
      if (r.sessionId !== sessionId) {
        throw new Error('回滚记录会话不一致。')
      }
      return r
    },
    getNextPageParam: (p) => p.next,
  })
  const detail = useQuery({
    queryKey: ['change-rollback-record', sessionId, selected],
    enabled: open && Boolean(selected),
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const r = rollbackRecordSchema.parse(
        await sessionJson(
          `/api/changes/rollback/record?${new URLSearchParams({ sessionId, operationId: selected ?? '' })}`,
          signal,
        ),
      )
      if (r.sessionId !== sessionId || r.id !== selected) {
        throw new Error('回滚详情身份不一致。')
      }
      return r
    },
  })
  const record = !detail.isError && detail.data?.id === selected ? detail.data : null
  return (
    <section aria-label="持久回滚记录" className="flex min-w-0 flex-col gap-2 break-all">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
          {open ? '收起持久回滚记录' : '查看持久回滚记录'}
        </Button>
        {open ? (
          <Button
            size="sm"
            variant="outline"
            disabled={query.isFetching}
            onClick={() => {
              void query.refetch()
              if (selected) {
                void detail.refetch()
              }
            }}
          >
            刷新回滚记录
          </Button>
        ) : null}
      </div>
      {open ? (
        <>
          <p>
            文件回滚保留消息历史。记录不恢复授权，不自动重放；下一次同目录运行会收到简明环境变更事实。
          </p>
          {query.isPending ? <output>正在读取持久回滚记录…</output> : null}
          {query.isError ? <p role="alert">持久回滚记录未同步：{query.error.message}</p> : null}
          {!query.isError && query.data?.pages[0]?.records.length === 0 ? (
            <p>尚无回滚记录</p>
          ) : null}
          <div className="max-h-72 overflow-auto">
            {!query.isError
              ? query.data?.pages
                  .flatMap((p) => p.records)
                  .map((r) => (
                    <article key={r.id} className="border-t py-2">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`回滚详情 ${r.id}`}
                        onClick={() => setSelected(r.id)}
                      >
                        查看操作详情
                      </Button>
                      <p>
                        {rollbackStateLabel[r.state]} · 操作 {r.id}
                      </p>
                      <p>
                        轮次 {r.turnId} · {r.fileId ? '整文件' : '整轮'} · {r.totalFiles} 个路径
                      </p>
                      <p>
                        人工发起 ·{' '}
                        {r.externalConfirmed ? '已单独确认覆盖外部或未知内容' : '普通确认或未执行'}{' '}
                        · {new Date(r.startedAt).toLocaleString()}
                      </p>
                      <p>
                        {r.paths.join('、')}
                        {r.totalFiles > r.paths.length ? '（部分路径，完整内容见详情）' : ''}
                      </p>
                    </article>
                  ))
              : null}
          </div>
          {query.hasNextPage ? (
            <Button
              size="sm"
              variant="outline"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              加载更早回滚记录
            </Button>
          ) : null}
          {selected && detail.isPending ? <output>正在读取操作详情…</output> : null}
          {detail.isError ? <p role="alert">回滚详情未同步：{detail.error.message}</p> : null}
          {record ? (
            <section aria-label="持久回滚详情" className="max-h-96 overflow-auto border-t pt-2">
              <p>
                {rollbackStateLabel[record.state]} · 操作 {record.id} · 人工来源 {record.actor}
              </p>
              <p>
                原轮基线 {record.baselineReference ?? '不可用'} → 收尾{' '}
                {record.finalReference ?? '不可用'}
              </p>
              <p>
                实际操作前 {record.beforeReference ?? '未采集'} → 最终现场{' '}
                {record.afterReference ?? '未采集或不可用'}
              </p>
              <p>
                最终现场快照：
                {record.afterStatus === 'ready'
                  ? '已保存'
                  : record.afterStatus === 'unavailable'
                    ? '不可用'
                    : '未执行采集'}{' '}
                · {record.afterSnapshotId ?? '无引用'}
              </p>
              {record.attemptReference ? <p>补偿前尝试版本 {record.attemptReference}</p> : null}
              {record.diagnostic ? <p>{record.diagnostic}</p> : null}
              {record.files.map((f) => (
                <div className="border-t py-2" key={f.path}>
                  <strong>{f.path}</strong>
                  <p>
                    操作前 {f.current ?? '不存在'} · 目标 {f.target ?? '删除文件'}
                  </p>
                  <p>
                    {f.written ? '已写入' : '未记为已写入'} ·{' '}
                    {f.compensated ? '已条件补偿' : '未条件补偿'} · 最终观察 {f.observation}{' '}
                    {f.observedAfter ?? ''}
                  </p>
                  <p>
                    来源 {f.source === 'tool-observed' ? '工具观察一致' : '不确定'}；历史消息保留。
                  </p>
                </div>
              ))}
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
