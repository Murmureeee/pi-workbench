import type { Workspace, WorkspaceResult } from '@pi-workbench/shared'

import { useQueryClient } from '@tanstack/react-query'
import { FolderIcon, FolderOpenIcon, RefreshCwIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { accessSnapshotSchema, directorySelectionSchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button, buttonVariants } from '@pi-workbench/ui/components/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@pi-workbench/ui/components/field'
import { Input } from '@pi-workbench/ui/components/input'
import { Separator } from '@pi-workbench/ui/components/separator'

import { workspaceCommand } from '../../services/workspace-client.js'

declare global {
  interface Window {
    piWorkbench?: { selectDirectory: () => Promise<unknown> }
  }
}

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
  const generation = useRef(0)
  const resultHeading = useRef<HTMLHeadingElement>(null)
  const pathInput = useRef<HTMLInputElement>(null)
  const desktop = Boolean(window.piWorkbench)
  useEffect(
    () => () => {
      generation.current += 1
    },
    [],
  )
  const run = async (operation: 'open' | 'validate', body: { path: string } | { id: string }) => {
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
        setNotice(
          result.reused ? '已复用既有工作区；没有新建会话。' : '工作区已打开；尚未创建会话。',
        )
        resultHeading.current?.focus()
      } else {
        setError(result)
        if ('id' in body) {
          setInvalidId(body.id)
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
    <main className="mx-auto flex h-dvh max-w-6xl flex-col gap-5 overflow-y-auto p-5 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">工作区</h1>
          <p className="text-muted-foreground">选择代码所在目录，在工作区之间切换。</p>
        </div>
        <a className={buttonVariants({ variant: 'outline' })} href="/">
          返回离线样本
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
      <div className="grid min-h-0 gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
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
                void run('validate', { id: workspace.id })
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
            <h2 ref={resultHeading} tabIndex={-1} className="text-lg font-medium">
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
                尚未创建会话。真实会话发送将在后续功能接入。
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
    </main>
  )
}
