import type { WorkspaceEnvironmentTarget } from '@pi-workbench/shared'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { directoryWriteStatusSchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button } from '@pi-workbench/ui/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@pi-workbench/ui/components/collapsible'

import { sessionJson } from '../../services/session-client.js'

/** A target-scoped, read-only view. Unloading cancels only this query; no old target's
 * owner or provenance is rendered and no observation can confer rollback authority. */
export function WorkspaceWriteStatus({ target }: { target: WorkspaceEnvironmentTarget | null }) {
  return target ? <WriteObservation key={JSON.stringify(target)} target={target} /> : null
}

function WriteObservation({ target }: { target: WorkspaceEnvironmentTarget }) {
  const [visibleSince] = useState(() => Date.now())
  const query = useQuery({
    queryKey: ['workspace-write-status', target],
    queryFn: async ({ signal }) =>
      directoryWriteStatusSchema.parse(
        await sessionJson(`/api/workspaces/write-status?${new URLSearchParams(target)}`, signal),
      ),
    refetchInterval: 1000,
    refetchOnMount: 'always',
    retry: false,
    staleTime: 0,
  })
  const data =
    !query.isError &&
    query.dataUpdatedAt >= visibleSince &&
    JSON.stringify(query.data?.target) === JSON.stringify(target)
      ? query.data
      : undefined
  const waiting = data?.queue.find(
    (item) => 'sessionId' in target && item.sessionId === target.sessionId,
  )
  const round = data?.latest
  return (
    <section
      aria-label="目录写入与来源"
      className="flex min-w-0 flex-col gap-2 border-b bg-background px-5 py-2 text-xs"
    >
      <Collapsible>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {query.isError
              ? '目录占用待同步'
              : !data
                ? '正在核对目录占用…'
                : !data.available
                  ? '原目录不可用'
                  : waiting && data.owner
                    ? `等待目录 · 第 ${waiting.position} 位`
                    : waiting
                      ? '等待模型名额'
                      : data.owner
                        ? data.owner.state === 'quarantined'
                          ? '目录隔离 · 等待进程退出'
                          : 'sessionId' in target && data.owner.sessionId === target.sessionId
                            ? '目录由本轮占用'
                            : '目录已被占用'
                        : '目录当前空闲'}
          </Badge>
          {data?.owner ? (
            <span className="min-w-0 break-all">
              占用会话 {data.owner.sessionId.slice(0, 8)} · 轮次 {data.owner.turnId.slice(0, 8)}
            </span>
          ) : null}
          <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
            查看目录占用与来源
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="flex flex-col gap-2 pt-2">
          {query.isError ? (
            <Alert>
              <AlertTitle>目录状态未同步</AlertTitle>
              <AlertDescription>
                占用状态未知，已有任务与草稿保留。
                <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
                  重新核对目录占用
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {data?.owner ? (
            <p className="break-all">
              占用会话：{data.owner.sessionId}；轮次：{data.owner.turnId}。
              {waiting
                ? '同一物理目录或父子目录重叠，等待前轮收尾确认；尚未发送本轮。'
                : '占用持续至轮次收尾或实际停止确认，切换页面不会释放。'}
            </p>
          ) : null}
          {data?.queue.length ? (
            <p>本目录待准入 {data.queue.length} 轮；可在所属会话通过“停止本轮”取消。</p>
          ) : null}
          {round ? (
            <p className="break-all">
              本会话最近轮次：{round.turnId} ·{' '}
              {round.state === 'released'
                ? '占用已释放'
                : round.state === 'interrupted'
                  ? '已中断，未恢复执行'
                  : round.state === 'quarantined'
                    ? '退出待确认'
                    : '仍在占用'}
              ；文件观察
              {round.coverage === 'unavailable'
                ? '不可用'
                : round.coverage === 'limited'
                  ? '范围受限'
                  : '为有界元数据采样'}
              。
            </p>
          ) : null}
          <p className="text-muted-foreground">
            受管轮次可能写入，因此先占用目录；审批仍单独确认。这里只观察文件元数据，不是恢复快照，未证明修改来源；不能自动回滚。
          </p>
        </CollapsibleContent>
      </Collapsible>
      {round?.changedPaths.length ? (
        <Alert>
          <AlertTitle>发现文件变化 · 来源不确定</AlertTitle>
          <AlertDescription>
            <p>可能混有工具、终端或外部编辑，禁止按 agent 独占改动自动回滚。</p>
            <p className="break-all">
              {round.changedPaths.slice(0, 3).join('、')}
              {round.changedPaths.length > 3 || round.changesTruncated ? ' 等（有界展示）' : ''}
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}
