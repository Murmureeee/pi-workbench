import type { WorkspaceEnvironmentTarget } from '@pi-workbench/shared'

import { useQuery } from '@tanstack/react-query'
import { FolderGit2Icon, GitBranchIcon, RefreshCwIcon } from 'lucide-react'
import { useState } from 'react'

import { workspaceEnvironmentSchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button } from '@pi-workbench/ui/components/button'

import { sessionJson } from '../../services/session-client.js'

/** Only the visible identity is observed. Target-keyed requests consume cancellation;
 * no previous-target placeholder or branch survives a switch or failed inspection.
 * Remount the observer when its identity becomes visible; old cached HEAD is hidden until
 * a fresh check. Same-target polling retains layout and explicitly labels the observation. */
export function WorkspaceEnvironment(props: {
  target: WorkspaceEnvironmentTarget | null
  cwd?: string
  active?: boolean
  planned?: boolean
  recoveryHandled?: boolean
}) {
  return props.active === false ? null : (
    <EnvironmentObservation key={JSON.stringify(props.target)} {...props} />
  )
}

function EnvironmentObservation({
  target,
  cwd,
  active = true,
  planned = false,
  recoveryHandled = false,
}: {
  target: WorkspaceEnvironmentTarget | null
  cwd?: string
  active?: boolean
  planned?: boolean
  recoveryHandled?: boolean
}) {
  const [visibleSince] = useState(() => Date.now())
  const query = useQuery({
    queryKey: ['workspace-environment', target],
    queryFn: async ({ signal }) =>
      workspaceEnvironmentSchema.parse(
        await sessionJson(
          `/api/workspaces/environment?${new URLSearchParams(target ?? {})}`,
          signal,
        ),
      ),
    enabled: active && Boolean(target),
    refetchInterval: 2000,
    refetchOnMount: 'always',
    staleTime: 0,
    retry: false,
  })
  // Previous identity caches never appear; background refresh is visibly an observation.
  const current =
    active &&
    !query.isError &&
    query.dataUpdatedAt >= visibleSince &&
    JSON.stringify(query.data?.target) === JSON.stringify(target)
      ? query.data
      : undefined
  const git = current?.git
  const error = query.isError
    ? '环境检查未完成。请恢复本地连接后刷新；已有会话目录与后台任务保留。'
    : git?.status === 'unavailable'
      ? git.message
      : ''
  return (
    <section
      aria-label="工作区与 Git 环境"
      aria-busy={query.isFetching}
      className="workspace-environment flex min-w-0 shrink-0 flex-col gap-2 border-b bg-background px-5 py-2 text-xs"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-muted-foreground">{planned ? '待用目录' : '实际 cwd'}</span>
        <span aria-label="环境执行目录" className="min-w-0 flex-1 basis-60 break-all">
          {current?.cwd ?? cwd ?? (target ? '正在核对目录…' : '独立目录（首次发送时创建）')}
        </span>
        <Badge variant="outline" aria-label="Git 状态" className="max-w-full min-w-0">
          <GitBranchIcon aria-hidden="true" data-icon="inline-start" />
          <span
            className="min-w-0 truncate"
            title={
              git?.status === 'repository' && git.head.kind === 'branch' ? git.head.name : undefined
            }
          >
            {!target
              ? '尚未创建目录'
              : !current
                ? query.isError
                  ? '未同步'
                  : '检查中…'
                : git?.status === 'repository'
                  ? git.head.kind === 'branch'
                    ? `${git.head.name}${git.head.commit ? '' : ' · 尚无提交'}`
                    : `detached · ${git.head.commit.slice(0, 12)}`
                  : git?.status === 'not_repository'
                    ? '非 Git 目录'
                    : 'Git 未知'}
          </span>
        </Badge>
        {current ? (
          <span className="text-muted-foreground">
            {query.isFetching ? '正在核对（上次观察）' : '本地只读 · 自动更新'}
          </span>
        ) : null}
        {target ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={!active || query.isFetching}
            onClick={() => void query.refetch()}
            aria-label="刷新环境标识"
          >
            <RefreshCwIcon data-icon="inline-start" />
            刷新
          </Button>
        ) : null}
      </div>
      {current?.resolvedCwd && current.resolvedCwd !== current.cwd ? (
        <p className="break-all text-muted-foreground">物理目录：{current.resolvedCwd}</p>
      ) : null}
      {git?.status === 'repository' ? (
        <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
          <span className="flex min-w-0 items-start gap-1">
            <FolderGit2Icon className="size-3 shrink-0" aria-hidden="true" />
            <span className="break-all" aria-label="Git 仓库">
              仓库：{git.root}
            </span>
          </span>
          {git.superprojectRoot ? (
            <span className="break-all" aria-label="Git 子模块">
              子模块 · 主仓库：{git.superprojectRoot}
            </span>
          ) : null}
        </div>
      ) : null}
      {current && current.cwd !== current.workspacePath ? (
        <p className="break-all text-muted-foreground">
          工作区登记：{current.workspacePath}；会话保留原 cwd。
        </p>
      ) : null}
      {error &&
      !(
        recoveryHandled &&
        git?.status === 'unavailable' &&
        ['directory_unavailable', 'changed'].includes(git.code)
      ) ? (
        <Alert>
          <AlertTitle>环境信息暂不可用</AlertTitle>
          <AlertDescription>
            {error}
            {current?.directoryMessage ? ` ${current.directoryMessage}` : ''}
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}
