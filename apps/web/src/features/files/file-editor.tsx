import type { FileReadInput } from '@pi-workbench/shared'

import { useEffect, useRef, useState } from 'react'

import {
  fileEditOpenSchema,
  fileEditResultSchema,
  fileEditSnapshotSchema,
} from '@pi-workbench/shared'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@pi-workbench/ui/components/alert-dialog'
import { Button } from '@pi-workbench/ui/components/button'
import { Field, FieldLabel } from '@pi-workbench/ui/components/field'
import { Textarea } from '@pi-workbench/ui/components/textarea'

import { sessionJson } from '../../services/session-client.js'
import { fileDraftKey, useFileEditDrafts } from '../../stores/file-edit-drafts.js'

/** Independent file draft; late saves reconcile only their still-owned draft revision.
 * Closing this view retains it. Explicit discard and overwrite use separate dialogs. */
export function FileEditor({ input, csrf }: { input: FileReadInput; csrf: string }) {
  const drafts = useFileEditDrafts((s) => s.drafts),
    storageFailed = useFileEditDrafts((s) => s.storageFailed)
  const [key, setKey] = useState<string | null>(null),
    [notice, setNotice] = useState('正在核对完整文件与编辑格式…'),
    [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<
    { kind: 'overwrite'; id: string; draftText: string } | { kind: 'discard' } | null
  >(null)
  const alive = useRef(true)
  const encodedInput = JSON.stringify(input)
  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    const request = fileEditOpenSchema.parse(JSON.parse(encodedInput))
    if ('path' in request.source) {
      const path = request.source.path
      const existing = Object.entries(useFileEditDrafts.getState().drafts).find(
        ([, d]) =>
          d.snapshot.absolutePath === path &&
          JSON.stringify(d.snapshot.target) === JSON.stringify(request.target),
      )
      if (existing) {
        setKey(existing[0])
      }
    }
    void (async () => {
      try {
        const snapshot = fileEditSnapshotSchema.parse(
          await sessionJson('/api/files/edit/open', controller.signal, request, csrf),
        )
        if (!alive.current) {
          return
        }
        const id = fileDraftKey(snapshot),
          store = useFileEditDrafts.getState()
        if (!store.drafts[id]) {
          const clean = Object.entries(store.drafts).filter(
            ([, d]) => d.text === d.snapshot.text && !d.uncertain,
          )
          for (const [k] of clean) {
            store.remove(k)
          }
          if (Object.keys(useFileEditDrafts.getState().drafts).length >= 4) {
            throw new Error('已有 4 份编辑稿；请先保存或明确丢弃其中一份。')
          }
          store.put(id, { snapshot, text: snapshot.text, undo: [], uncertain: false })
        }
        setKey(id)
        setNotice('编辑稿属于本窗口；关闭、切换或刷新保留，退出或重启不保证恢复。')
      } catch (error) {
        if (alive.current && !controller.signal.aborted) {
          setNotice(error instanceof Error ? error.message : '无法编辑。')
        }
      }
    })()
    return () => {
      alive.current = false
      controller.abort()
    }
  }, [encodedInput, csrf])
  const draft = key ? drafts[key] : undefined
  const change = (text: string) => {
    if (!key || !draft || busy) {
      return
    }
    let undo = [...draft.undo, draft.text].slice(-20)
    while (undo.reduce((n, t) => n + t.length * 2, 0) > 1024 * 1024) {
      undo = undo.slice(1)
    }
    useFileEditDrafts.getState().put(key, { ...draft, text, undo })
    setConfirm(null)
  }
  const save = async (confirmationId?: string) => {
    if (!key || !draft || busy) {
      return
    }
    const original = draft,
      id = key,
      pending = { ...draft, uncertain: true }
    useFileEditDrafts.getState().put(id, pending)
    setBusy(true)
    setConfirm(null)
    try {
      const result = fileEditResultSchema.parse(
        await sessionJson(
          '/api/files/edit/save',
          undefined,
          {
            editId: draft.snapshot.editId,
            text: draft.text,
            ...(confirmationId ? { confirmationId } : {}),
          },
          csrf,
        ),
      )
      const store = useFileEditDrafts.getState()
      if (store.drafts[id] !== pending) {
        return
      }
      if (result.status === 'saved') {
        store.put(id, {
          ...pending,
          uncertain: false,
          snapshot: { ...original.snapshot, text: original.text, version: result.version },
        })
      } else {
        store.put(id, { ...original, uncertain: false })
        if (alive.current && result.confirmationId) {
          setConfirm({ kind: 'overwrite', id: result.confirmationId, draftText: original.text })
        }
      }
      if (alive.current) {
        setNotice(result.diagnostic)
      }
    } catch (error) {
      if (alive.current) {
        setNotice(
          (error instanceof Error ? error.message : '保存失败。') +
            ' 编辑稿保留；结果未知时先核对磁盘，不自动重发。',
        )
      }
    } finally {
      if (alive.current) {
        setBusy(false)
      }
    }
  }
  return (
    <section aria-label="手动文件编辑" className="flex shrink-0 flex-col gap-2">
      <output>{notice}</output>
      {storageFailed ? (
        <p role="alert">窗口暂存失败，当前仅在内存中；刷新或退出会丢失，请先保存或复制编辑稿。</p>
      ) : null}
      {draft ? (
        <>
          <p className="text-xs break-all">
            编辑版本：{draft.snapshot.version} · UTF-8{draft.snapshot.bom ? ' BOM' : ''} ·{' '}
            {draft.snapshot.newline === 'crlf' ? 'CRLF' : 'LF（无原换行时新增为 LF）'} ·{' '}
            {draft.text !== draft.snapshot.text ? '未保存' : '与保存基线相同'}
            {draft.uncertain ? ' · 保存结果待核对' : ''}
          </p>
          <Field>
            <FieldLabel htmlFor="manual-file-editor">文件编辑稿</FieldLabel>
            <Textarea
              id="manual-file-editor"
              maxLength={262144}
              className="min-h-44 font-mono"
              value={draft.text}
              disabled={busy}
              spellCheck={false}
              onChange={(e) => change(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) {
                  return
                }
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
                  e.preventDefault()
                  const prev = draft.undo.at(-1)
                  if (prev !== undefined && key) {
                    useFileEditDrafts
                      .getState()
                      .put(key, { ...draft, text: prev, undo: draft.undo.slice(0, -1) })
                  }
                }
              }}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || (draft.text === draft.snapshot.text && !draft.uncertain)}
              onClick={() => void save()}
            >
              保存文件
            </Button>
            <Button
              variant="outline"
              disabled={busy || !draft.undo.length}
              onClick={() => {
                const prev = draft.undo.at(-1)
                if (prev !== undefined && key) {
                  useFileEditDrafts
                    .getState()
                    .put(key, { ...draft, text: prev, undo: draft.undo.slice(0, -1) })
                }
              }}
            >
              撤销编辑
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirm({ kind: 'discard' })}
            >
              丢弃编辑稿
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            最多 256 KiB／10,000 行；保留
            BOM、统一换行和末尾换行，不自动格式化。保存计为用户／外部修改，不改变历史 Diff
            或接受决定。
          </p>
        </>
      ) : null}
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(v) => {
          if (!v) {
            setConfirm(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            {confirm?.kind === 'overwrite' ? '单独确认覆盖外部修改' : '丢弃本文件编辑稿'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirm?.kind === 'overwrite'
              ? '当前磁盘内容或权限已变化。确认仅允许用本次编辑稿覆盖刚才检测的版本；若文件再次变化仍会拒绝。取消保留稿件。'
              : '仅丢弃这份本窗口稿件；磁盘和历史保持原状。退出或应用重启不保证恢复。'}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>返回保留稿件</AlertDialogCancel>
            <Button
              onClick={() => {
                if (confirm?.kind === 'overwrite' && draft?.text === confirm.draftText) {
                  void save(confirm.id)
                }
                if (confirm?.kind === 'discard' && key) {
                  useFileEditDrafts.getState().remove(key)
                  setKey(null)
                  setNotice('已明确丢弃稿件；重新打开编辑会读取当前磁盘。')
                  setConfirm(null)
                }
              }}
            >
              {confirm?.kind === 'overwrite' ? '明确覆盖本次磁盘版本' : '明确丢弃稿件'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
