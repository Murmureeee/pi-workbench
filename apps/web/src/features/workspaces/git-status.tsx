import type { GitStatus, WorkspaceEnvironmentTarget } from '@pi-workbench/shared'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { gitStatusSchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button } from '@pi-workbench/ui/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@pi-workbench/ui/components/collapsible'

import { sessionJson } from '../../services/session-client.js'

const sourceLabel = {
  'baseline-retained': '轮前内容一致 · 作者未证实',
  'tool-observed': '工具观察一致',
  mixed: '来源不确定（混合）',
  unknown: '来源不确定',
}

/** Keyed disclosure observes only the active identity. Closing/switching cancels its fetch,
 * never the SDK task. Failed reads hide old status; re-open requires a fresh observation. */
export function GitStatusPanel({ target }: { target: WorkspaceEnvironmentTarget | null }) {
  return target ? <StatusObservation key={JSON.stringify(target)} target={target} /> : null
}
function StatusObservation({ target }: { target: WorkspaceEnvironmentTarget }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
        {open ? '收起仓库状态' : '查看仓库状态'}
      </CollapsibleTrigger>
      <CollapsibleContent>{open ? <CurrentStatus target={target} /> : null}</CollapsibleContent>
    </Collapsible>
  )
}
function CurrentStatus({ target }: { target: WorkspaceEnvironmentTarget }) {
  const [visibleSince] = useState(Date.now)
  const query = useQuery({
    queryKey: ['git-status', target],
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      const result = gitStatusSchema.parse(
        await sessionJson(`/api/git/status?${new URLSearchParams(target)}`, signal),
      )
      if (JSON.stringify(result.target) !== JSON.stringify(target)) {
        throw new Error('仓库状态身份不匹配。')
      }
      return result
    },
  })
  const data =
    !query.isError && !query.isFetching && query.dataUpdatedAt >= visibleSince
      ? query.data
      : undefined
  return (
    <section
      aria-label="仓库状态与本地改动"
      className="flex max-h-80 min-w-0 flex-col gap-2 overflow-auto px-5 py-2 text-xs"
      aria-busy={query.isFetching}
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong>当前目录 Git 状态</strong>
        <Button
          size="sm"
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          刷新仓库状态
        </Button>
      </div>
      <p>
        只读当前执行目录子树；不暂存或提交。Git状态、轮前内容和工具观察分别列出，均不证明人类作者或agent独占修改。
      </p>
      {query.isFetching ? <output>正在读取仓库状态…</output> : null}
      {query.isError ? (
        <Alert>
          <AlertTitle>仓库状态未同步</AlertTitle>
          <AlertDescription>{query.error.message} 请刷新重试；后台任务保留。</AlertDescription>
        </Alert>
      ) : null}
      {data ? <StatusBody value={data} /> : null}
    </section>
  )
}
function StatusBody({ value }: { value: GitStatus }) {
  if (value.state !== 'ready') {
    return (
      <Alert>
        <AlertTitle>
          {value.state === 'not_repository' ? '非 Git 目录' : '仓库状态不可用'}
        </AlertTitle>
        <AlertDescription>{value.diagnostic}</AlertDescription>
      </Alert>
    )
  }
  const entries = value.entries
  const staged = entries.filter((e) => !e.untracked && e.index !== '.').length,
    unstaged = entries.filter((e) => !e.untracked && e.worktree !== '.').length,
    untracked = entries.filter((e) => e.untracked).length
  return (
    <>
      <p className="break-all">执行目录：{value.cwd}</p>
      <output>
        staged {staged} · unstaged {unstaged} · untracked {untracked}
        {value.complete ? '' : '（仅已显示项）'}
      </output>
      {value.git.status === 'repository' ? (
        <p className="break-all">
          仓库：{value.git.root} ·{' '}
          {value.git.head.kind === 'branch'
            ? value.git.head.name + (value.git.head.commit ? '' : ' · 尚无提交')
            : `detached · ${value.git.head.commit.slice(0, 12)}`}
        </p>
      ) : null}
      {value.diagnostic ? <p>{value.diagnostic}</p> : null}
      {entries.length === 0 ? (
        <p>
          {value.complete ? '当前目录没有本地改动。' : '已扫描范围内没有本地改动；未覆盖项见提示。'}
        </p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-2">
          {entries.map((entry, i) => (
            <li
              key={JSON.stringify([entry.path, i])}
              className="flex min-w-0 flex-col gap-1 border-b pb-2"
            >
              <span className="break-all">
                {entry.previousPath ? `${entry.previousPath} → ` : ''}
                {entry.path}
              </span>
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline">
                  {entry.untracked ? 'untracked' : `${entry.index}${entry.worktree}`}
                </Badge>
                {entry.conflict ? <Badge variant="destructive">合并冲突</Badge> : null}
                <Badge variant="secondary">{sourceLabel[entry.source]}</Badge>
                {entry.baselinePresent ? <Badge variant="outline">轮前已存在</Badge> : null}
              </div>
              {entry.baselineDiffersFromGit ? (
                <p>
                  轮前原始字节与当前Git基准不同（含换行规则差异）；不还原历史暂存状态或推断作者。
                </p>
              ) : null}
              <p className="text-muted-foreground">
                {entry.reason}
                {entry.turnId ? ` 依据轮次：${entry.turnId}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
