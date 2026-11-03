import type { ManagedSession } from '@pi-workbench/shared'

import { useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'

import { sessionRenameSchema, sessionTitleSchema } from '@pi-workbench/shared'
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
import { applySessionTitle } from '../../services/session-title-cache.js'

/** Editing owns a fixed server version. A concurrent rename never replaces input or silently
 * rebases it. Saving is single-flight; failures retain input, and late receipts update only
 * their original session cache. IME confirmation/cancellation never saves/closes the dialog. */
export function SessionRenameDialog({
  session,
  latest,
  csrf,
  close,
}: {
  session: ManagedSession
  latest: ManagedSession | undefined
  csrf: string
  close: () => void
}) {
  const cache = useQueryClient()
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const composing = useRef(false)
  const busy = useRef(false)
  const [text, setText] = useState(session.title)
  const [version, setVersion] = useState(session.titleVersion)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const count = Array.from(text.trim()).length
  const valid = sessionRenameSchema.safeParse({ title: text, expectedVersion: version })
  const conflict = Boolean(latest && latest.titleVersion > version)
  const save = async () => {
    if (busy.current || composing.current || !valid.success || conflict) {
      return
    }
    busy.current = true
    setPending(true)
    setError('')
    setUncertain(false)
    try {
      const result = sessionTitleSchema.safeParse(
        await sessionJson(
          `/api/chat/sessions/${encodeURIComponent(session.id)}/title`,
          undefined,
          valid.data,
          csrf,
        ),
      )
      if (!result.success || result.data.sessionId !== session.id) {
        throw new SessionRequestError('保存回执无效，请核对原会话；编辑内容保留。', true)
      }
      applySessionTitle(cache, result.data)
      close()
    } catch (cause) {
      const unknownOutcome = cause instanceof SessionRequestError && cause.uncertain
      setUncertain(unknownOutcome)
      setError(
        unknownOutcome
          ? '保存结果待核对，编辑内容已保留。请检查最新标题；不会自动重试。'
          : cause instanceof Error
            ? cause.message
            : '标题未能保存。请核对后重试；编辑内容保留。',
      )
      void cache.invalidateQueries({ queryKey: ['chat-sessions'] })
      void cache.invalidateQueries({ queryKey: ['session-titles'] })
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (!open && (busy.current || composing.current)) {
          details.cancel()
          return
        }
        if (!open) {
          close()
        }
      }}
    >
      <DialogContent showCloseButton={false} initialFocus={input}>
        <DialogHeader>
          <DialogTitle>重命名会话</DialogTitle>
          <DialogDescription>修改列表和窗口标题；会话历史、目录与任务保持原样。</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field data-invalid={!valid.success || undefined}>
            <FieldLabel htmlFor={id}>会话名称</FieldLabel>
            <Input
              id={id}
              ref={input}
              value={text}
              readOnly={pending}
              aria-invalid={!valid.success}
              aria-describedby={`${id}-description`}
              autoComplete="off"
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setText(event.target.value)}
              onCompositionStart={() => {
                composing.current = true
              }}
              onCompositionEnd={() => {
                composing.current = false
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== 'Escape') {
                  return
                }
                if (
                  composing.current ||
                  event.nativeEvent.isComposing ||
                  event.nativeEvent.keyCode === 229
                ) {
                  event.preventDefault()
                  event.stopPropagation()
                  return
                }
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void save()
                }
              }}
            />
            <FieldDescription id={`${id}-description`}>
              去首尾空白后 1–80 个 Unicode 字符 · {count}/80
            </FieldDescription>
          </Field>
        </FieldGroup>
        {conflict ? (
          <Alert>
            <AlertTitle>标题已在其他客户端更新</AlertTitle>
            <AlertDescription>
              <p>最新标题：{latest?.title}。你的编辑已保留，请核对后继续。</p>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => {
                  if (latest) {
                    setVersion(latest.titleVersion)
                    setError('')
                    input.current?.focus()
                  }
                }}
              >
                使用最新版本继续编辑
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{uncertain ? '保存结果待核对' : '标题未保存'}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={close}>
            取消
          </Button>
          <Button disabled={pending || !valid.success || conflict} onClick={() => void save()}>
            {pending ? '正在保存…' : '保存名称'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
