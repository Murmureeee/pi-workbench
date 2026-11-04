import type { Workspace, WorkspaceRecord, WorkspaceResult } from '@pi-workbench/shared'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderIcon, FolderOpenIcon, MoreHorizontalIcon, RefreshCwIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { accessSnapshotSchema, directorySelectionSchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button, buttonVariants } from '@pi-workbench/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@pi-workbench/ui/components/dropdown-menu'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@pi-workbench/ui/components/field'
import { Input } from '@pi-workbench/ui/components/input'
import { Separator } from '@pi-workbench/ui/components/separator'

import { readRecentWorkspaces, workspaceCommand } from '../../services/workspace-client.js'
import { WorkspaceEnvironment } from './workspace-environment.js'
import { WorkspaceRecordDialog } from './workspace-record-dialog.js'

/** Real desktop workspace selection, separate from OPS-01 sample conversations. Each request
 * owns a view generation: late results can register metadata but cannot replace a newer view.
 * Unmounting or switching never sends abort/dispose and never creates an SDK session.
 */
export function WorkspaceManager() {
  const queryClient = useQueryClient()
  const access = accessSnapshotSchema.parse(queryClient.getQueryData(['client-access']))
  const [opened, setOpened] = useState<Workspace[]>([])
  const [active, setActive] = useState<Workspace | null>(null)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<Extract<WorkspaceResult, { ok: false }> | null>(null)
  const [connectionError, setConnectionError] = useState('')
  const [notice, setNotice] = useState('')
  const [invalidId, setInvalidId] = useState<string | null>(null)
  const [invalidRecords, setInvalidRecords] = useState<Record<string, boolean>>({})
  const [dialog, setDialog] = useState<{
    record: WorkspaceRecord
    operation: 'rename' | 'relocate' | 'remove'
  } | null>(null)
  const generation = useRef(0)
  const resultHeading = useRef<HTMLHeadingElement>(null)
  const pathInput = useRef<HTMLInputElement>(null)
  const desktop = Boolean(window.piWorkbench)
  const recent = useQuery({
    queryKey: ['recent-workspaces'],
    queryFn: ({ signal }) => readRecentWorkspaces(signal),
    enabled: desktop,
    retry: false,
  })
  useEffect(
    () => () => {
      generation.current += 1
    },
    [],
  )
  const run = async (
    operation: 'open' | 'validate' | 'activate',
    body: { path: string } | { id: string },
  ) => {
    const version = ++generation.current
    setPending(true)
    setError(null)
    setConnectionError('')
    setNotice('')
    try {
      const result = await workspaceCommand(operation, body, access.csrf ?? '')
      if (version !== generation.current) {
        return
      }
      if (result.ok) {
        const workspace = result.workspace
        setOpened((previous) =>
          previous.some((item) => item.id === workspace.id)
            ? previous.map((item) => (item.id === workspace.id ? workspace : item))
            : [...previous, workspace],
        )
        setActive(workspace)
        setInvalidId(null)
        setInvalidRecords((previous) => ({ ...previous, [workspace.id]: false }))
        void queryClient.invalidateQueries({ queryKey: ['recent-workspaces'] })
        setNotice(
          result.reused ? '已复用既有工作区；没有新建会话。' : '工作区已打开；尚未创建会话。',
        )
        resultHeading.current?.focus()
      } else {
        setError(result)
        if ('id' in body) {
          setInvalidId(body.id)
          setInvalidRecords((previous) => ({ ...previous, [body.id]: true }))
        }
        pathInput.current?.focus()
      }
    } catch (cause) {
      if (version !== generation.current) {
        return
      }
      setConnectionError(
        cause instanceof Error && cause.name !== 'TimeoutError'
          ? cause.message
          : '连接超时或服务不可用。请重新打开核对结果；没有创建会话，也不会停止后台任务。',
      )
      if ('id' in body) {
        setInvalidId(body.id)
      }
      pathInput.current?.focus()
    } finally {
      if (version === generation.current) {
        setPending(false)
      }
    }
  }
  const choose = async () => {
    if (!window.piWorkbench || picking) {
      return
    }
    const version = ++generation.current
    setPending(false)
    setPicking(true)
    setError(null)
    setConnectionError('')
    try {
      const result = directorySelectionSchema.parse(await window.piWorkbench.selectDirectory())
      if (version !== generation.current) {
        return
      }
      if (result.status === 'selected') {
        setDraft(result.path)
        setPicking(false)
        await run('open', { path: result.path })
      } else {
        setNotice(
          result.status === 'cancelled'
            ? '已取消选择，当前工作区保持不变。'
            : '目录选择器暂不可用，请输入绝对路径重试。',
        )
      }
    } catch {
      if (version === generation.current) {
        setConnectionError('目录选择器暂不可用，请输入绝对路径重试。')
      }
    } finally {
      if (version === generation.current) {
        setPicking(false)
      }
    }
  }
  return (
    <main className="mx-auto flex h-full max-w-6xl flex-col gap-5 overflow-y-auto p-5 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">工作区</h1>
          <p className="text-muted-foreground">选择代码所在目录，在工作区之间切换。</p>
        </div>
        <a className={buttonVariants({ variant: 'outline' })} href="/">
          返回工作台
        </a>
      </header>
      <Separator />
      {!desktop ? (
        <Alert>
          <AlertTitle>请从 Electron 桌面打开工作区</AlertTitle>
          <AlertDescription>本轮优先实现桌面目录选择；独立网页操作后续接入。</AlertDescription>
        </Alert>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (desktop && draft && !picking) {
            void run('open', { path: draft })
          }
        }}
      >
        <FieldGroup>
          <Field data-invalid={Boolean(error || connectionError)}>
            <FieldLabel htmlFor="workspace-path">工作区目录</FieldLabel>
            <div className="flex flex-wrap gap-2">
              <Input
                ref={pathInput}
                id="workspace-path"
                value={draft}
                maxLength={4096}
                className="min-w-0 flex-1 basis-64"
                disabled={!desktop || picking}
                placeholder="例如 D:\Projects\my-app"
                aria-invalid={Boolean(error || connectionError)}
                aria-describedby="workspace-path-help"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
                  ) {
                    event.preventDefault()
                  }
                }}
              />
              <Button type="submit" disabled={!desktop || !draft || picking}>
                打开路径
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!desktop || picking}
                onClick={() => {
                  void choose()
                }}
              >
                <FolderOpenIcon data-icon="inline-start" />
                {picking ? '选择中…' : '选择文件夹'}
              </Button>
            </div>
            <FieldDescription id="workspace-path-help">
              校验读取、写入与清理能力（创建后删除一个 4
              字节临时文件）；不会执行目录中的脚本或加载项目资源。
            </FieldDescription>
          </Field>
        </FieldGroup>
      </form>
      <output
        aria-label="工作区操作状态"
        aria-live="polite"
        aria-atomic="true"
        className="text-sm text-muted-foreground"
      >
        {pending ? '正在校验目录…' : notice || '打开目录不会创建会话；切换视图不会停止后台任务。'}
      </output>
      {error || connectionError ? (
        <Alert variant="destructive">
          <AlertTitle>{error?.message ?? '连接未确认'}</AlertTitle>
          <AlertDescription>{error?.recovery ?? connectionError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid shrink-0 gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="本窗口已打开工作区" className="flex min-w-0 flex-col gap-2">
          <h2 className="text-sm font-medium">本窗口已打开</h2>
          {opened.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有打开目录。</p>
          ) : null}
          {opened.map((workspace) => (
            <Button
              key={workspace.id}
              variant={workspace.id === active?.id ? 'secondary' : 'ghost'}
              className="justify-start"
              aria-pressed={workspace.id === active?.id}
              title={workspace.canonicalPath}
              disabled={picking}
              onClick={() => {
                void run('activate', { id: workspace.id })
              }}
            >
              <FolderIcon data-icon="inline-start" />
              <span className="truncate">{workspace.name}</span>
            </Button>
          ))}
        </nav>
        <section
          aria-label="当前工作区"
          className="flex min-w-0 flex-col gap-4 rounded-lg border p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 ref={resultHeading} tabIndex={-1} className="min-w-0 text-lg font-medium break-all">
              {active?.name ?? '选择一个工作区'}
            </h2>
            {active ? (
              <Badge variant="outline">
                {invalidId === active.id ? '需要重新校验' : '上次校验可读写'}
              </Badge>
            ) : null}
          </div>
          {active ? (
            <>
              <p className="text-sm break-all" aria-label="实际目录">
                {active.canonicalPath}
              </p>
              <WorkspaceEnvironment
                key={active.id}
                active={invalidId !== active.id}
                target={{ workspaceId: active.id }}
                cwd={active.canonicalPath}
              />
              <p className="text-xs break-all text-muted-foreground" aria-label="工作区标识">
                工作区 ID · {active.id}
              </p>
              <Button
                className="self-start"
                variant="outline"
                disabled={picking}
                onClick={() => {
                  void run('validate', { id: active.id })
                }}
              >
                <RefreshCwIcon data-icon="inline-start" />
                重新校验
              </Button>
              <Separator />
              <p className="text-sm text-muted-foreground">
                打开和整理工作区只改变目录记录；新任务请返回工作台发送。
              </p>
              <a
                className={buttonVariants({ variant: 'outline', className: 'self-start' })}
                href={`/?trust&project=${encodeURIComponent(active.canonicalPath)}`}
              >
                查看资源信任
              </a>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              使用上方选择器或输入绝对路径。相同物理目录会复用同一身份。
            </p>
          )}
        </section>
      </div>
      <Separator />
      <section aria-label="最近工作区" className="flex shrink-0 flex-col gap-3">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="font-medium">最近工作区</h2>
            <p className="text-xs text-muted-foreground">
              最近成功打开 / 切换优先；同毫秒顺延。重命名、重新校验和重新定位不改变排序。
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!desktop || recent.isFetching}
            onClick={() => void recent.refetch()}
          >
            <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
            {recent.isFetching ? '正在读取…' : '刷新最近列表'}
          </Button>
        </header>
        <p className="text-xs text-muted-foreground">
          最近记录跨重启保存，不代表目录当前可用；打开时重新校验。显示最近 100 项，移除只隐藏记录。
        </p>
        {recent.isPending && desktop ? <output>正在读取最近工作区…</output> : null}
        {recent.isError ? (
          <Alert variant="destructive">
            <AlertTitle>最近列表未能更新</AlertTitle>
            <AlertDescription>
              保留上次结果。请检查连接并刷新；不会自动重新打开目录或重试整理。
            </AlertDescription>
          </Alert>
        ) : null}
        {recent.data?.entries.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">
            还没有最近工作区。成功打开后会加入列表；升级前未记录打开时间的目录可重新打开添加。
          </p>
        ) : null}
        <nav aria-label="最近工作区列表" className="flex min-w-0 flex-col gap-1">
          {recent.data?.entries.map((record) => (
            <div
              key={record.id}
              data-recent-workspace={record.id}
              className="flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1"
            >
              <Button
                variant="ghost"
                className="h-auto min-w-0 flex-1 justify-start py-2"
                aria-label={`打开工作区：${record.name}`}
                disabled={picking || recent.isError}
                title={record.canonicalPath}
                onClick={() => void run('activate', { id: record.id })}
              >
                <FolderIcon data-icon="inline-start" aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left">
                  <span className="w-full truncate">{record.name}</span>
                  <span className="w-full truncate text-xs text-muted-foreground">
                    {record.canonicalPath}
                  </span>
                </span>
              </Button>
              <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground">
                <Badge variant="outline">
                  {invalidRecords[record.id] ? '目录不可用' : '打开时校验'}
                </Badge>
                <time
                  className="hidden sm:block"
                  dateTime={new Date(record.lastOpenedAt).toISOString()}
                >
                  {new Intl.DateTimeFormat('zh-CN', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }).format(record.lastOpenedAt)}
                </time>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`工作区菜单：${record.name}`}
                      disabled={picking || pending || recent.isFetching || recent.isError}
                    />
                  }
                >
                  <MoreHorizontalIcon aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    {(['rename', 'relocate', 'remove'] as const).map((operation) => (
                      <DropdownMenuItem
                        key={operation}
                        onClick={() => {
                          generation.current += 1
                          setPending(false)
                          setDialog({ record, operation })
                        }}
                      >
                        {
                          {
                            rename: '重命名工作区',
                            relocate: '重新定位工作区',
                            remove: '从最近移除',
                          }[operation]
                        }
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </nav>
        {recent.data && recent.data.total > recent.data.limit ? (
          <p className="text-xs text-muted-foreground">
            当前显示 {recent.data.entries.length} / {recent.data.total}{' '}
            项；其他登记保留，可通过路径重新打开。
          </p>
        ) : null}
      </section>
      {dialog ? (
        <WorkspaceRecordDialog
          key={`${dialog.record.id}:${dialog.operation}`}
          record={dialog.record}
          latest={recent.data?.entries.find((record) => record.id === dialog.record.id)}
          operation={dialog.operation}
          csrf={access.csrf ?? ''}
          close={() => setDialog(null)}
          saved={(record) => {
            generation.current += 1
            setOpened((previous) => previous.map((item) => (item.id === record.id ? record : item)))
            setActive((previous) => (previous?.id === record.id ? record : previous))
            if (dialog.operation === 'relocate') {
              setInvalidRecords((previous) => ({ ...previous, [record.id]: false }))
              setInvalidId((previous) => (previous === record.id ? null : previous))
              setError(null)
            }
            setNotice(
              dialog.operation === 'remove'
                ? '已从最近隐藏；目录、会话和当前窗口保留。'
                : dialog.operation === 'rename'
                  ? '显示名已保存；文件夹名称与会话目录未变。'
                  : '登记位置已更新；既有会话保持原执行目录。',
            )
          }}
        />
      ) : null}
    </main>
  )
}
