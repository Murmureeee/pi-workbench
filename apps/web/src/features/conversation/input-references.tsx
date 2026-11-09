import type { InputReference, WorkspaceEnvironmentTarget } from '@pi-workbench/shared'

import { useEffect, useRef, useState } from 'react'

import { Button } from '@pi-workbench/ui/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@pi-workbench/ui/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@pi-workbench/ui/components/dropdown-menu'
import { Field, FieldGroup, FieldLabel } from '@pi-workbench/ui/components/field'
import { Input } from '@pi-workbench/ui/components/input'
import { Textarea } from '@pi-workbench/ui/components/textarea'

import { saveInputReference } from '../../services/input-reference-client.js'
import { sessionDraft, useSessionDrafts } from '../../stores/session-drafts.js'

const labels = { file: '文件', range: '代码范围', directory: '目录路径', paste: '长粘贴' } as const

/** Explicit bounded input attachments. Removing is local and reversible; editing creates
 * a new immutable host version. Dialog closure never sends or cancels an SDK task. */
export function InputReferences({
  draftKey,
  target,
  csrf,
  disabled,
  request,
  dismiss,
}: {
  draftKey: string
  target: WorkspaceEnvironmentTarget | null
  csrf: string
  disabled: boolean
  request: { token: string; text?: string } | null
  dismiss: () => void
}) {
  const draft = useSessionDrafts((state) => state.drafts[draftKey])
  const [open, setOpen] = useState(false),
    [kind, setKind] = useState<keyof typeof labels>('file')
  const [path, setPath] = useState(''),
    [from, setFrom] = useState('1'),
    [to, setTo] = useState('1')
  const [text, setText] = useState(''),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false)
  const [preview, setPreview] = useState<InputReference | null>(null),
    [editing, setEditing] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ before: InputReference[]; after: InputReference[] } | null>(
    null,
  )
  const alive = useRef(true)
  const action = useRef<AbortController | null>(null)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      action.current?.abort()
    }
  }, [])
  useEffect(() => {
    if (request) {
      setOpen(true)
      setPreview(null)
      setEditing(null)
      setError('')
      if (request.text !== undefined) {
        setKind('paste')
        setText(request.text)
      }
    }
  }, [request])
  const change = (references: InputReference[]) => {
    if (!draft || disabled) {
      return
    }
    setUndo({ before: draft.references, after: references })
    useSessionDrafts.getState().update(draftKey, { references })
  }
  const save = async () => {
    if (!draft || pending || disabled) {
      return
    }
    const origin = draft
    const controller = new AbortController()
    action.current = controller
    setPending(true)
    setError('')
    try {
      if (kind !== 'paste' && !target) {
        throw Error('请先选择执行目录；不会自动扩大目录授权。')
      }
      const item = await saveInputReference(
        draftKey,
        csrf,
        kind === 'paste'
          ? { kind, text }
          : {
              kind,
              target: target!,
              path,
              ...(kind === 'range' ? { from: Number(from), to: Number(to) } : {}),
            },
        origin,
        editing,
        controller.signal,
      )
      if (alive.current && action.current === controller) {
        setUndo({ before: origin.references, after: sessionDraft(draftKey).references })
        setPreview(item)
        setEditing(null)
        setText('')
        dismiss()
      }
    } catch (cause) {
      if (alive.current && action.current === controller && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : '引用未保存；原草稿保留。')
      }
    } finally {
      if (alive.current && action.current === controller) {
        action.current = null
        setPending(false)
      }
    }
  }
  return (
    <section aria-label="输入引用" className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => {
            setOpen(true)
            setPreview(null)
            setEditing(null)
            setError('')
          }}
        >
          @ 添加引用
        </Button>
        {undo ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              const current = sessionDraft(draftKey)
              if (current.references === undo.after) {
                useSessionDrafts.getState().update(draftKey, { references: undo.before })
                setUndo(null)
              } else {
                setError('引用已变化，未覆盖；请核对当前列表。')
              }
            }}
          >
            撤销引用操作
          </Button>
        ) : null}
        {draft?.references.length ? (
          <span>
            {draft.references.length}/8 项 · {draft.references.reduce((n, r) => n + r.bytes, 0)}{' '}
            UTF-8 字节
          </span>
        ) : null}
      </div>
      <div className="flex max-h-[min(10rem,15dvh)] flex-col gap-2 overflow-y-auto">
        {draft?.references.map((r) => (
          <div
            key={r.id}
            className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border p-2"
            data-reference-id={r.id}
          >
            <span className="min-w-0 flex-1 break-all">
              {labels[r.kind]} · {r.path}
              {r.from ? `:${r.from}-${r.to}` : ''} · {r.bytes} 字节
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPreview(r)
                setOpen(true)
              }}
            >
              预览引用
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => {
                setKind(r.kind)
                setPath(r.path)
                setFrom(String(r.from ?? 1))
                setTo(String(r.to ?? 1))
                setEditing(r.id)
                setText('')
                setPreview(null)
                setOpen(true)
                setError('')
              }}
            >
              修改引用
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => change(draft.references.filter((item) => item.id !== r.id))}
            >
              移除引用
            </Button>
          </div>
        ))}
      </div>
      {error && !open ? <p role="alert">{error}</p> : null}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value)
          if (!value) {
            action.current?.abort()
            action.current = null
            setPending(false)
            dismiss()
          }
        }}
      >
        <DialogContent className="flex max-h-[85dvh] min-h-0 flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {preview ? '引用预览' : editing ? '修改引用' : '添加输入引用'}
            </DialogTitle>
            <DialogDescription>
              每项 256 KiB，合计 512 KiB。目录只发送路径；文件发送前重验。引用不保证节省
              token，预览已经脱敏。
            </DialogDescription>
          </DialogHeader>
          {preview ? (
            <div className="min-h-0 overflow-auto">
              <p className="break-all">
                {preview.path}
                {preview.from ? `:${preview.from}-${preview.to}` : ''} · {preview.bytes} 字节 · 版本{' '}
                {preview.version}
              </p>
              <pre className="break-all whitespace-pre-wrap">
                {preview.preview || '仅目录路径，没有附加目录内容。'}
              </pre>
            </div>
          ) : (
            <FieldGroup className="min-h-0 overflow-auto">
              <Field>
                <FieldLabel>引用类型</FieldLabel>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="outline" />}>
                    {labels[kind]}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuGroup>
                      {Object.entries(labels).map(([value, label]) => (
                        <DropdownMenuItem
                          key={value}
                          onClick={() => {
                            if (
                              value === 'file' ||
                              value === 'range' ||
                              value === 'directory' ||
                              value === 'paste'
                            ) {
                              setKind(value)
                            }
                          }}
                        >
                          {label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </Field>
              {kind === 'paste' ? (
                <Field>
                  <FieldLabel htmlFor="reference-paste">原始粘贴内容</FieldLabel>
                  <Textarea
                    id="reference-paste"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={262144}
                  />
                  <p>精确保留收到的 UTF-8 字节；修改时请重新粘贴原文，脱敏预览不会充当原文。</p>
                </Field>
              ) : (
                <Field>
                  <FieldLabel htmlFor="reference-path">引用路径</FieldLabel>
                  <Input
                    id="reference-path"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                  />
                </Field>
              )}
              {kind === 'range' ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="reference-from">开始行</FieldLabel>
                    <Input
                      id="reference-from"
                      type="number"
                      min={1}
                      max={10000}
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="reference-to">结束行</FieldLabel>
                    <Input
                      id="reference-to"
                      type="number"
                      min={1}
                      max={10000}
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </Field>
                </>
              ) : null}
              {error ? <p role="alert">{error}</p> : null}
              <Button disabled={pending || disabled} onClick={() => void save()}>
                {pending ? '核对并保存中…' : '保存引用'}
              </Button>
            </FieldGroup>
          )}
          <DialogClose render={<Button variant="outline" />}>关闭引用</DialogClose>
        </DialogContent>
      </Dialog>
    </section>
  )
}
