import type { ModelSelection, SessionModelState } from '@pi-workbench/shared'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { sessionModelStateSchema, thinkingLevelSchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Button } from '@pi-workbench/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@pi-workbench/ui/components/dialog'
import { Field, FieldLabel } from '@pi-workbench/ui/components/field'

import { getModelCatalog } from '../../services/model-client.js'
import { sessionJson } from '../../services/session-client.js'

/** A fixed edit version survives polls/failures. POST results only invalidate this session;
 * leaving a view never cancels a daemon task or applies a late receipt to another pane. */
export function SessionModelControl({
  sessionId,
  csrf,
  enabled,
  active,
}: {
  sessionId: string
  csrf: string
  enabled: boolean
  active: boolean
}) {
  const cache = useQueryClient()
  const trigger = useRef<HTMLButtonElement>(null)
  const catalog = useQuery({
    queryKey: ['chat-models'],
    queryFn: ({ signal }) => getModelCatalog(signal),
    enabled,
  })
  const [open, setOpen] = useState(false)
  const state = useQuery({
    queryKey: ['session-model', sessionId],
    enabled,
    refetchInterval: 700,
    queryFn: async ({ signal }) => {
      const result = sessionModelStateSchema.parse(
        await sessionJson(`/api/chat/sessions/${sessionId}/model`, signal),
      )
      if (result.sessionId !== sessionId) {
        throw new Error('模型状态身份不匹配。')
      }
      return result
    },
  })
  const [edit, setEdit] = useState<SessionModelState | null>(null)
  const [selection, setSelection] = useState<ModelSelection | null>(null)
  const [pending, setPending] = useState(false),
    [error, setError] = useState('')
  const busy = useRef(false),
    mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (!active) {
      setOpen(false)
    }
  }, [active])
  const save = async () => {
    if (!edit || !selection || busy.current) {
      return
    }
    busy.current = true
    setPending(true)
    setError('')
    try {
      const result = sessionModelStateSchema.parse(
        await sessionJson(
          `/api/chat/sessions/${sessionId}/model`,
          undefined,
          { ...selection, expectedRevision: edit.revision },
          csrf,
        ),
      )
      if (result.sessionId !== sessionId) {
        throw new Error('保存回执身份不匹配，请刷新核对。')
      }
      if (mounted.current) {
        setOpen(false)
      }
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : '切换失败；原配置与编辑保留。')
      }
    } finally {
      busy.current = false
      if (mounted.current) {
        setPending(false)
      }
      void cache.invalidateQueries({ queryKey: ['session-model', sessionId] })
      void cache.invalidateQueries({ queryKey: ['chat-sessions'] })
    }
  }
  const deferred = state.data && state.data.effectiveRevision !== state.data.revision
  return (
    <div className="session-model-control">
      <Dialog
        open={open}
        onOpenChangeComplete={(nextOpen) => {
          if (!nextOpen && active) {
            trigger.current?.focus()
          }
        }}
        onOpenChange={(nextOpen, details) => {
          if (busy.current) {
            details.cancel()
            return
          }
          if (nextOpen && state.data) {
            setEdit(state.data)
            setSelection(state.data.requested)
            setError('')
            setOpen(true)
          } else {
            setOpen(false)
          }
        }}
      >
        <DialogTrigger
          ref={trigger}
          render={
            <Button variant="outline" size="sm" disabled={!enabled || state.isError || !state.data}>
              模型与思考设置
            </Button>
          }
        />
        {edit && selection ? (
          <DialogContent
            showCloseButton={false}
            finalFocus={trigger}
            className="max-h-[calc(100dvh-32px)] overflow-y-auto"
          >
            <DialogHeader>
              <DialogTitle>模型与思考设置</DialogTitle>
              <DialogDescription>
                空闲时立即保存生效；运行中从下一次模型请求生效，包括工具后的请求。不会重发当前任务。
              </DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor={`model-choice-${sessionId}`}>切换模型</FieldLabel>
              <select
                id={`model-choice-${sessionId}`}
                disabled={pending}
                value={selection.model.model}
                onChange={(event) =>
                  setSelection({
                    model: {
                      kind: 'local-fixture',
                      provider: 'piw-offline',
                      model:
                        event.target.value === 'fixture-reasoning'
                          ? 'fixture-reasoning'
                          : 'fixture',
                    },
                    thinking: 'off',
                  })
                }
              >
                <option value="fixture">离线验收模型 · 仅文本</option>
                <option value="fixture-reasoning">离线思考夹具 · 仅文本</option>
                {catalog.data?.providers
                  .filter((provider) => provider.origins.some((origin) => origin !== 'pi-sdk'))
                  .flatMap((provider) =>
                    provider.models
                      .filter((model) => model.type === 'chat')
                      .map((model) => (
                        <option
                          key={`${provider.id}:${model.id}`}
                          value={`${provider.id}:${model.id}`}
                          disabled
                        >
                          {provider.name} / {model.name} · {model.input.join(' / ')} ·
                          真实传输关闭，未联网验证
                        </option>
                      )),
                  )}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`thinking-choice-${sessionId}`}>思考级别</FieldLabel>
              <select
                id={`thinking-choice-${sessionId}`}
                value={selection.thinking}
                disabled={pending}
                onChange={(event) =>
                  setSelection({
                    ...selection,
                    thinking: thinkingLevelSchema.parse(event.target.value),
                  })
                }
              >
                {thinkingLevelSchema.options.map((level) => (
                  <option
                    key={level}
                    value={level}
                    disabled={
                      selection.model.model === 'fixture'
                        ? level !== 'off'
                        : !['off', 'low', 'medium', 'high'].includes(level)
                    }
                  >
                    {level}
                  </option>
                ))}
              </select>
            </Field>
            <p className="phase-note">
              能力来自宿主固定离线模型。附件尚未开放，不能选择；真实提供商传输关闭。更换模型先回到
              off，再显式选择其支持的级别。不修改 pi 全局配置。
            </p>
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>切换未确认</AlertTitle>
                <AlertDescription>{error} 编辑已保留；刷新核对后可明确重试。</AlertDescription>
              </Alert>
            ) : null}
            {state.data && state.data.revision !== edit.revision ? (
              <Alert>
                <AlertTitle>配置版本已变化</AlertTitle>
                <AlertDescription>
                  当前版本 {state.data.revision}。编辑保留，确认最新版本后再保存。
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      if (state.data) {
                        setEdit(state.data)
                      }
                    }}
                  >
                    使用最新版本继续编辑
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter>
              <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button
                disabled={pending || state.data?.revision !== edit.revision}
                onClick={() => void save()}
              >
                保存模型配置
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
      <output aria-label="模型生效状态" aria-live="polite">
        {state.isError
          ? '模型状态未同步，原配置保留'
          : deferred
            ? `待生效：${state.data?.requested.model.model} / ${state.data?.requested.thinking} · 下一次模型请求；当前 ${state.data?.effective.model.model} / ${state.data?.effective.thinking}`
            : state.data
              ? `已生效：${state.data.effective.model.model} / ${state.data.effective.thinking}`
              : '正在读取模型状态'}
      </output>
    </div>
  )
}
