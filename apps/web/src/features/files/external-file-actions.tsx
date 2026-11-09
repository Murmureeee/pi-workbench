import type { ExternalFileInput, ExternalResult, IdeAdapter } from '@pi-workbench/shared'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'

import { editorStatusSchema, externalResultSchema } from '@pi-workbench/shared'
import { Button } from '@pi-workbench/ui/components/button'
import { Field, FieldGroup, FieldLabel } from '@pi-workbench/ui/components/field'

type Props = Omit<ExternalFileInput, 'action' | 'line'> & {
  line?: number
  disabled?: boolean
  directory?: boolean
}

/** Requests remain bound to this exact view/target/version/line. Unmount cancels only
 * pending external handoff, never the daemon conversation or an already opened app. */
export function ExternalFileActions(props: Props) {
  return window.piWorkbench?.openFileExternally ? (
    <ExternalControls
      key={JSON.stringify([props.target, props.source, props.version, props.line])}
      {...props}
    />
  ) : null
}
function ExternalControls({
  target,
  source,
  version,
  line = 1,
  disabled = false,
  directory = false,
}: Props) {
  const bridge = window.piWorkbench!
  const id = useId(),
    alive = useRef(true),
    operation = useRef<string | null>(null)
  const [queryId] = useState(() => crypto.randomUUID())
  const [adapter, setAdapter] = useState<IdeAdapter>('vscode'),
    [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<ExternalResult | null>(null)
  const editor = useQuery({
    queryKey: ['external-editor-status', queryId],
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => editorStatusSchema.parse(await bridge.editorStatus()),
  })
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (operation.current) {
        void bridge.cancelExternal(operation.current).catch(() => undefined)
      }
    }
  }, [bridge])
  const perform = async (action: ExternalFileInput['action'] | 'select' | 'auto') => {
    if (operation.current) {
      return
    }
    const requestId = crypto.randomUUID()
    operation.current = requestId
    setPending(true)
    setNotice(null)
    try {
      const result = externalResultSchema.parse(
        action === 'select' || action === 'auto'
          ? await bridge.configureEditor({
              id: requestId,
              adapter: action === 'auto' ? 'auto' : adapter,
            })
          : await bridge.openFileExternally({
              id: requestId,
              input: {
                target,
                source,
                action,
                line: action === 'ide' ? line : 1,
                ...(version ? { version } : {}),
              },
            }),
      )
      if (alive.current && operation.current === requestId) {
        setNotice(result)
        if (result.status === 'saved') {
          void editor.refetch()
        }
      }
    } catch {
      if (alive.current && operation.current === requestId) {
        setNotice({ status: 'failed', message: '桌面连接或返回结果不可用；请重新连接后刷新目标。' })
      }
    } finally {
      if (operation.current === requestId) {
        operation.current = null
        if (alive.current) {
          setPending(false)
        }
      }
    }
  }
  const cancel = async () => {
    if (!operation.current) {
      return
    }
    try {
      const confirmed = await bridge.cancelExternal(operation.current)
      if (alive.current) {
        setNotice({
          status: confirmed ? 'cancelled' : 'failed',
          message: confirmed
            ? '已请求取消尚未交付的动作；已交付外部应用的请求无法撤回。'
            : '取消尚未确认，请核对外部应用；不要重复打开。',
        })
      }
    } catch {
      if (alive.current) {
        setNotice({ status: 'failed', message: '取消未确认；请核对外部应用或重新连接。' })
      }
    }
  }
  return (
    <section
      aria-label="外部文件操作"
      aria-busy={pending}
      className="flex flex-col gap-2 rounded-md border p-2"
    >
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || pending || editor.data?.state !== 'ready'}
          onClick={() => void perform('ide')}
        >
          在 IDE 中打开{directory ? '目录' : ''}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || pending}
          onClick={() => void perform('reveal')}
        >
          在文件管理器定位
        </Button>
        {!directory ? (
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || pending}
            onClick={() => void perform('system')}
          >
            使用系统程序打开
          </Button>
        ) : null}
        {pending ? (
          <Button variant="outline" size="sm" onClick={() => void cancel()}>
            取消外部打开
          </Button>
        ) : null}
      </div>
      {editor.isPending ? <output>正在发现编辑器…</output> : null}
      {editor.isError ? <p role="alert">编辑器状态未同步，请刷新或重新选择程序。</p> : null}
      {editor.data ? (
        <p className="text-xs text-muted-foreground">
          {editor.data.label} · {editor.data.diagnostic}
        </p>
      ) : null}
      <details>
        <summary className="cursor-pointer text-sm">编辑器设置</summary>
        <FieldGroup className="gap-2 py-2">
          <Field>
            <FieldLabel htmlFor={`${id}-adapter`}>选择程序时采用的参数格式</FieldLabel>
            <select
              id={`${id}-adapter`}
              value={adapter}
              disabled={pending}
              onChange={(event) =>
                setAdapter(
                  event.target.value === 'jetbrains'
                    ? 'jetbrains'
                    : event.target.value === 'path'
                      ? 'path'
                      : 'vscode',
                )
              }
            >
              <option value="vscode">VS Code（路径与行号）</option>
              <option value="jetbrains">JetBrains（路径与行号）</option>
              <option value="path">其它程序（仅路径，不传行号）</option>
            </select>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => void perform('select')}
            >
              选择其它编辑器…
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => void perform('auto')}
            >
              恢复 VS Code 自动发现
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending || editor.isFetching}
              onClick={() => void editor.refetch()}
            >
              刷新编辑器状态
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            选择仅保存到本桌面 profile，不打开文件、不安装程序。外部应用自行管理其文件与权限。
          </p>
        </FieldGroup>
      </details>
      {pending ? <output>正在核对或等待外部操作…</output> : null}
      {notice ? (
        <output
          aria-live="polite"
          role={notice.status === 'failed' ? 'alert' : undefined}
          className="text-xs wrap-anywhere"
        >
          {notice.message}
        </output>
      ) : null}
    </section>
  )
}
