import { useInfiniteQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { changeSourcesSchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button } from '@pi-workbench/ui/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@pi-workbench/ui/components/collapsible'

import { sessionJson } from '../../services/session-client.js'
import { sourceLabel } from '../changes/change-labels.js'

/** Sources are read-only observations of this turn. Closing the disclosure only releases
 * presentation queries; it never settles, cancels or assigns authorship to an active task. */
export function ChangeSources({ sessionId, turnId }: { sessionId: string; turnId: string }) {
  const [open, setOpen] = useState(false)
  const query = useInfiniteQuery({
    queryKey: ['change-sources', sessionId, turnId],
    enabled: open,
    retry: false,
    gcTime: 0,
    initialPageParam: 0,
    queryFn: async ({ signal, pageParam }) => {
      const result = changeSourcesSchema.parse(
        await sessionJson(
          `/api/changes/sources?${new URLSearchParams({ sessionId, turnId, offset: String(pageParam) })}`,
          signal,
        ),
      )
      if (result.sessionId !== sessionId || result.turnId !== turnId) {
        throw new Error('文件来源身份不一致，请重新核对。')
      }
      return result
    },
    getNextPageParam: (page) => page.next,
  })
  const pages = query.data?.pages ?? []
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger render={<Button variant="outline" size="sm" />}>
        核对修改来源
      </CollapsibleTrigger>
      <CollapsibleContent className="flex min-w-0 flex-col gap-2 pt-2">
        <p>工具观察一致只确认对应调用及字节链，不代表独占修改；所有文件均禁止自动回滚。</p>
        {query.isPending ? <output>正在核对本轮文件来源…</output> : null}
        {query.isError ? (
          <Alert variant="destructive">
            <AlertTitle>来源记录未同步</AlertTitle>
            <AlertDescription>{query.error.message}</AlertDescription>
          </Alert>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          刷新修改来源
        </Button>
        {pages[0]?.diagnostic ? <p>{pages[0].diagnostic}</p> : null}
        {pages[0]?.total === 0 ? (
          <p>
            {pages[0].complete
              ? '本轮未观察到文件变更或受管文件工具触及。'
              : '尚无完整来源记录，不能据此断言无变更。'}
          </p>
        ) : null}
        {pages
          .flatMap((p) => p.files)
          .map((file) => (
            <article
              key={file.fileId}
              aria-label={`文件来源 ${file.path}`}
              className="flex min-w-0 flex-col gap-1 border-t pt-2"
            >
              <strong className="break-all">{file.path}</strong>
              <Badge variant={file.source === 'tool-observed' ? 'outline' : 'secondary'}>
                {sourceLabel[file.source]}
              </Badge>
              {!file.netChanged ? <p>本轮没有净字节差异，保留工具触及记录。</p> : null}
              {!file.inSnapshot ? <p>未进入受支持轮次快照，不能提供完整历史文件差异。</p> : null}
              {file.reasons.map((reason) => (
                <p key={reason}>{reason}</p>
              ))}
              {file.tools.map((tool) => (
                <p className="break-all" key={tool.id}>
                  工具 {tool.tool} · 调用 {tool.callId} · {tool.status} ·{' '}
                  {tool.confirmed ? '已确认对应工具字节区段' : '未确认工具独占修改'}
                </p>
              ))}
            </article>
          ))}
        {query.hasNextPage ? (
          <Button
            variant="outline"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            加载更多文件来源
          </Button>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  )
}
