import type { Project, Workspace } from '@pi-workbench/shared'

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'

import {
  directorySelectionSchema,
  projectSchema,
  workspaceNameSchema,
  workspaceResultSchema,
} from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Button } from '@pi-workbench/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pi-workbench/ui/components/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@pi-workbench/ui/components/field'
import { Input } from '@pi-workbench/ui/components/input'

import { sessionJson, SessionRequestError } from '../../services/session-client.js'

/** Fixed project/revision editor. Choosing a directory only fills the input; explicit save
 * checks it through daemon. Errors/IME retain input. Late receipts only refresh metadata,
 * never navigate or assign a newer draft. The default affects future sessions exclusively. */
export function ProjectEditor({
  project,
  latest,
  initialWorkspace,
  csrf,
  close,
  created,
}: {
  project: Project | null
  latest: Project | undefined
  initialWorkspace: Workspace | null
  csrf: string
  close: () => void
  created: (project: Project) => void
}) {
  const cache = useQueryClient()
  const id = useId(),
    input = useRef<HTMLInputElement>(null)
  const composing = useRef(false),
    busy = useRef(false),
    mounted = useRef(true)
  const requestId = useRef(crypto.randomUUID())
  const [name, setName] = useState(project?.name ?? '')
  const [path, setPath] = useState(project?.directory ?? initialWorkspace?.canonicalPath ?? '')
  const [revision, setRevision] = useState(project?.revision ?? 1)
  const [pending, setPending] = useState(false),
    [picking, setPicking] = useState(false)
  const [error, setError] = useState(''),
    [uncertain, setUncertain] = useState(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const conflict = Boolean(project && latest && latest.revision > revision)
  const missing = Boolean(project && !latest)
  const valid = workspaceNameSchema.safeParse(name).success && path.length <= 4096
  const save = async () => {
    if (
      busy.current ||
      picking ||
      composing.current ||
      !valid ||
      conflict ||
      missing ||
      (!project && uncertain)
    ) {
      return
    }
    busy.current = true
    setPending(true)
    setError('')
    setUncertain(false)
    try {
      let workspaceId: string | null = null
      if (path.trim()) {
        const result = workspaceResultSchema.parse(
          await sessionJson(
            '/api/chat/projects/resolve-directory',
            undefined,
            { path: path.trim() },
            csrf,
          ),
        )
        if (!result.ok) {
          throw new Error(`${result.message} ${result.recovery}`)
        }
        workspaceId = result.workspace.id
      }
      if (!mounted.current) {
        return
      }
      const result = projectSchema.parse(
        await sessionJson(
          project ? `/api/chat/projects/${project.id}` : '/api/chat/projects',
          undefined,
          project
            ? { action: 'edit', expectedRevision: revision, name, workspaceId }
            : { requestId: requestId.current, name, workspaceId },
          csrf,
        ),
      )
      if (project && result.id !== project.id) {
        throw new SessionRequestError('回执身份无效，请核对项目列表。', true)
      }
      await cache.cancelQueries({ queryKey: ['chat-options'] })
      if (mounted.current) {
        if (!project) {
          created(result)
        }
        close()
      }
    } catch (cause) {
      if (mounted.current) {
        const unknownOutcome = cause instanceof SessionRequestError && cause.uncertain
        setUncertain(unknownOutcome)
        setError(
          unknownOutcome
            ? '保存结果待核对，编辑内容保留；请核对项目列表，不会自动重试。'
            : cause instanceof Error
              ? cause.message
              : '项目未能保存，编辑内容保留。',
        )
      }
    } finally {
      busy.current = false
      if (mounted.current) {
        setPending(false)
      }
      void cache.invalidateQueries({ queryKey: ['chat-options'] })
      void cache.invalidateQueries({ queryKey: ['recent-workspaces'] })
    }
  }
  const reconcile = async () => {
    if (busy.current) {
      return
    }
    busy.current = true
    setPending(true)
    try {
      const value = await sessionJson(`/api/chat/projects/requests/${requestId.current}`)
      if (!mounted.current) {
        return
      }
      if (!value || typeof value !== 'object' || !('project' in value)) {
        throw new Error('回执无效，请稍后核对。')
      }
      if (value.project === null) {
        setUncertain(false)
        setError('原请求尚未创建项目，可以保留原输入再次保存。')
      } else {
        created(projectSchema.parse(value.project))
        close()
      }
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : '核对失败，输入保留。')
      }
    } finally {
      busy.current = false
      if (mounted.current) {
        setPending(false)
      }
      void cache.invalidateQueries({ queryKey: ['chat-options'] })
    }
  }
  const choose = async () => {
    if (picking || busy.current) {
      return
    }
    setPicking(true)
    setError('')
    try {
      const result = directorySelectionSchema.parse(await window.piWorkbench?.selectDirectory())
      if (!mounted.current) {
        return
      }
      if (result.status === 'selected') {
        setPath(result.path)
        requestId.current = crypto.randomUUID()
      } else if (result.status === 'unavailable') {
        setError('选择器暂不可用，请输入目录绝对路径。')
      }
    } catch {
      if (mounted.current) {
        setError('选择器暂不可用，请输入目录绝对路径。')
      }
    } finally {
      if (mounted.current) {
        setPicking(false)
      }
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (!open && (busy.current || composing.current || picking)) {
          details.cancel()
        } else if (!open) {
          close()
        }
      }}
    >
      <DialogContent showCloseButton={false} initialFocus={input}>
        <DialogHeader>
          <DialogTitle>{project ? '编辑项目' : '新建项目'}</DialogTitle>
          <DialogDescription>
            项目用于组织会话。默认目录仅供新会话使用；保存不改变已有会话的执行目录或权限。
            {!project ? '新项目放在未置顶组末尾。' : ''}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={() => {
            composing.current = false
          }}
          onKeyDown={(event) => {
            if (
              ['Enter', 'Escape'].includes(event.key) &&
              (composing.current ||
                event.nativeEvent.isComposing ||
                event.nativeEvent.keyCode === 229)
            ) {
              event.preventDefault()
              event.stopPropagation()
            }
          }}
        >
          <Field data-invalid={!workspaceNameSchema.safeParse(name).success || undefined}>
            <FieldLabel htmlFor={`${id}-name`}>项目名称</FieldLabel>
            <Input
              ref={input}
              id={`${id}-name`}
              value={name}
              readOnly={pending || picking || (!project && uncertain)}
              autoComplete="off"
              aria-invalid={!workspaceNameSchema.safeParse(name).success}
              aria-describedby={`${id}-name-help`}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
                setName(event.target.value)
                requestId.current = crypto.randomUUID()
              }}
              onCompositionStart={() => {
                composing.current = true
              }}
              onCompositionEnd={() => {
                composing.current = false
              }}
              onKeyDown={(event) => {
                if (!['Enter', 'Escape'].includes(event.key)) {
                  return
                }
                if (
                  composing.current ||
                  event.nativeEvent.isComposing ||
                  event.nativeEvent.keyCode === 229
                ) {
                  event.preventDefault()
                  event.stopPropagation()
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  void save()
                }
              }}
            />
            <FieldDescription id={`${id}-name-help`}>
              去首尾空白后 1–80 个 Unicode 字符 · {Array.from(name.trim()).length}/80
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-path`}>默认目录（可选）</FieldLabel>
            <Input
              id={`${id}-path`}
              value={path}
              readOnly={pending || picking || (!project && uncertain)}
              autoComplete="off"
              onChange={(event) => {
                setPath(event.target.value)
                requestId.current = crypto.randomUUID()
              }}
            />
            <FieldDescription>
              留空仅作组织，新会话各用独立执行空间。保存时检查目录读写；不会授信或加载项目资源。
            </FieldDescription>
          </Field>
        </FieldGroup>
        <div className="directory-buttons">
          <Button
            variant="outline"
            disabled={pending || picking || (!project && uncertain)}
            onClick={() => void choose()}
          >
            {picking ? '选择中…' : '选择默认文件夹'}
          </Button>
          <Button
            variant="ghost"
            disabled={pending || picking || !path || (!project && uncertain)}
            onClick={() => {
              setPath('')
              requestId.current = crypto.randomUUID()
            }}
          >
            不绑定目录
          </Button>
        </div>
        {project ? <p className="text-xs text-muted-foreground">项目 ID：{project.id}</p> : null}
        {missing ? (
          <Alert variant="destructive">
            <AlertTitle>项目已移除</AlertTitle>
            <AlertDescription>编辑保留，请取消后重新选择；不会重新创建。</AlertDescription>
          </Alert>
        ) : null}
        {conflict && latest ? (
          <Alert>
            <AlertTitle>项目已更新</AlertTitle>
            <AlertDescription>
              最新：{latest.name} · {latest.directory ?? '独立目录'}。当前编辑保留。
              <Button
                variant="outline"
                size="sm"
                disabled={pending || picking}
                onClick={() => {
                  setRevision(latest.revision)
                  setUncertain(false)
                  setError('')
                }}
              >
                使用最新版本继续编辑
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{uncertain ? '保存结果待核对' : '项目未保存'}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {!project && uncertain ? (
          <Button variant="outline" disabled={pending} onClick={() => void reconcile()}>
            核对原创建
          </Button>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={pending || picking} onClick={close}>
            取消
          </Button>
          <Button
            disabled={
              pending || picking || !valid || conflict || missing || (!project && uncertain)
            }
            onClick={() => void save()}
          >
            {pending ? '正在保存…' : '保存项目'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
