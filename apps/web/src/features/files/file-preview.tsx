import type { FileReadInput } from '@pi-workbench/shared'

import { useEffect, useRef, useState } from 'react'

import { externalResultSchema } from '@pi-workbench/shared'
import { Button } from '@pi-workbench/ui/components/button'

/** View-owned request identity isolates late results. Cancellation only abandons a
 * pending preview, never the conversation or an already opened independent window. */
export function FilePreview({ input }: { input: FileReadInput }) {
  const alive = useRef(true),
    pending = useRef<string | null>(null)
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('')
  const bridge = window.piWorkbench
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (pending.current) {
        void bridge?.cancelPreview(pending.current).catch(() => undefined)
      }
    }
  }, [bridge])
  if (!bridge?.previewFile) {
    return null
  }
  const open = async () => {
    if (pending.current) {
      return
    }
    const id = crypto.randomUUID()
    pending.current = id
    setBusy(true)
    setNotice('正在核对隔离快照…')
    try {
      const result = externalResultSchema.parse(await bridge.previewFile({ id, input }))
      if (alive.current && pending.current === id) {
        setNotice(result.message)
      }
    } catch {
      if (alive.current) {
        setNotice('桌面预览未确认；请重新连接后重试。')
      }
    } finally {
      if (pending.current === id) {
        pending.current = null
        if (alive.current) {
          setBusy(false)
        }
      }
    }
  }
  return (
    <section aria-label="隔离文件预览" className="shrink-0 space-y-1">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void open()}>
          隔离 HTML 预览
        </Button>
        {busy ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (pending.current) {
                void bridge.cancelPreview(pending.current)
              }
            }}
          >
            取消预览
          </Button>
        ) : null}
      </div>
      {notice ? (
        <output aria-live="polite" className="block text-xs wrap-anywhere">
          {notice}
        </output>
      ) : null}
    </section>
  )
}
