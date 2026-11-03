import type { WorkspaceRecord } from '@pi-workbench/shared'

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'

import { directorySelectionSchema, workspaceNameSchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@pi-workbench/ui/components/alert-dialog'
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

import { SessionRequestError } from '../../services/session-client.js'
import { editWorkspace } from '../../services/workspace-client.js'

type Operation = 'rename' | 'relocate' | 'remove'
const titles: Record<Operation, string> = {
  rename: '重命名工作区',
  relocate: '重新定位工作区',
  remove: '从最近移除',
}

/** Each dialog owns a fixed metadata revision and its input. Native picker selection does
 * not submit. Errors and conflicts retain edits; IME Enter/Escape never confirms or closes.
 * Late receipts after unmount refresh the index without changing the current view. */
export function WorkspaceRecordDialog({
  record,
  latest,
  operation,
  csrf,
  saved,
  close,
}: {
  record: WorkspaceRecord
  latest: WorkspaceRecord | undefined
  operation: Operation
  csrf: string
  saved: (record: WorkspaceRecord) => void
  close: () => void
}) {
  const cache = useQueryClient()
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const composing = useRef(false)
  const busy = useRef(false)
  const mounted = useRef(true)
  const [text, setText] = useState(operation === 'relocate' ? record.canonicalPath : record.name)
  const [revision, setRevision] = useState(record.revision)
  const [pending, setPending] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const [conflicting, setConflicting] = useState<WorkspaceRecord | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const current =
    conflicting && (!latest || conflicting.revision > latest.revision) ? conflicting : latest
  const conflict = current && current.revision > revision
  const valid =
    operation === 'remove' ||
    (operation === 'rename'
      ? workspaceNameSchema.safeParse(text).success
      : text.length > 0 && text.length <= 4096)
  const save = async (reset = false) => {
    if (busy.current || composing.current || picking || conflict || (!valid && !reset)) {
      return
    }
    busy.current = true
    setPending(true)
    setError('')
    setUncertain(false)
    try {
      const result = await editWorkspace(
        operation,
        {
          id: record.id,
          expectedRevision: revision,
          ...(operation === 'rename' ? { name: reset ? null : text } : {}),
          ...(operation === 'relocate' ? { path: text } : {}),
        },
        csrf,
      )
      await cache.cancelQueries({ queryKey: ['recent-workspaces'] })
      if (!mounted.current) {
        return
      }
      if (result.ok) {
        if (result.record.id !== record.id) {
          throw new Error('回执不属于当前工作区，请核对记录。')
        }
        saved(result.record)
        close()
      } else {
        setError(`${result.message} ${result.recovery}`)
        setConflicting(result.current)
      }
    } catch (cause) {
      if (mounted.current) {
        setUncertain(cause instanceof SessionRequestError && cause.uncertain)
        setError(
          cause instanceof Error ? cause.message : '保存未确认，编辑内容保留，请核对后重试。',
        )
      }
    } finally {
      busy.current = false
      if (mounted.current) {
        setPending(false)
      }
      void cache.invalidateQueries({ queryKey: ['recent-workspaces'] })
    }
  }
  const choose = async () => {
    if (!window.piWorkbench || busy.current || picking) {
      return
    }
    setPicking(true)
    try {
      const selection = directorySelectionSchema.parse(await window.piWorkbench.selectDirectory())
      if (!mounted.current) {
        return
      }
      if (selection.status === 'selected') {
        setText(selection.path)
      } else if (selection.status === 'unavailable') {
        setError('选择器暂不可用，请输入完整路径。')
      }
    } catch {
      if (mounted.current) {
        setError('选择器暂不可用，请输入完整路径。')
      }
    } finally {
      if (mounted.current) {
        setPicking(false)
      }
    }
  }
  const feedback = (
    <>
      {conflict ? (
        <Alert>
          <AlertTitle>工作区记录已更新</AlertTitle>
          <AlertDescription>
            <p className="break-all">
              最新名称：{current.name}；目录：{current.canonicalPath}。你的编辑已保留。
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={pending || picking}
              onClick={() => {
                setRevision(current.revision)
                setError('')
                input.current?.focus()
              }}
            >
              核对最新记录后继续
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{uncertain ? '保存结果待核对' : '操作未完成'}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </>
  )
  const footer = (
    <>
      <Button variant="outline" disabled={pending || picking} onClick={close}>
        取消
      </Button>
      <Button
        disabled={pending || picking || !valid || Boolean(conflict)}
        onClick={() => void save()}
      >
        {pending
          ? '正在保存…'
          : operation === 'remove'
            ? '确认移除最近记录'
            : operation === 'rename'
              ? '保存名称'
              : '保存位置'}
      </Button>
    </>
  )
  if (operation === 'remove') {
    return (
      <AlertDialog
        open
        onOpenChange={(open, details) => {
          if (!open && busy.current) {
            details.cancel()
          } else if (!open) {
            close()
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>从最近移除</AlertDialogTitle>
            <AlertDialogDescription>
              仅隐藏“{record.name}
              ”的最近记录。目录、会话、自定义名称和当前窗口均保留；后台任务继续运行。重新打开后可再次出现在最近列表。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {feedback}
          <AlertDialogFooter>{footer}</AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
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
          <DialogTitle>{titles[operation]}</DialogTitle>
          <DialogDescription>
            {operation === 'rename'
              ? '只修改工作区显示名，不修改文件夹名称、项目名称或会话目录。'
              : '请选择移动后的同一物理目录。只更新登记路径；既有会话保持原执行目录，旧路径失效时续发会被阻止。'}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field data-invalid={!valid || undefined}>
            <FieldLabel htmlFor={id}>
              {operation === 'rename' ? '工作区显示名' : '新的目录位置'}
            </FieldLabel>
            <Input
              ref={input}
              id={id}
              value={text}
              readOnly={pending || picking}
              autoComplete="off"
              aria-invalid={!valid}
              aria-describedby={`${id}-help`}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setText(event.target.value)}
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
            <FieldDescription id={`${id}-help`}>
              {operation === 'rename'
                ? `去首尾空白后 1–80 个 Unicode 字符 · ${Array.from(text.trim()).length}/80`
                : '保存时校验身份及读写 / 清理能力；选择文件夹不会立即保存。'}
            </FieldDescription>
          </Field>
        </FieldGroup>
        {operation === 'rename' ? (
          <Button
            variant="ghost"
            className="self-start"
            disabled={pending || Boolean(conflict)}
            onClick={() => void save(true)}
          >
            恢复目录名称
          </Button>
        ) : (
          <Button variant="outline" disabled={pending || picking} onClick={() => void choose()}>
            {picking ? '选择中…' : '选择新的文件夹'}
          </Button>
        )}
        {feedback}
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
