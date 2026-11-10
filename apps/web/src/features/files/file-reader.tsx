import type { OpenFile } from './file-reader-context.js'
/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The bounded code table needs keyboard scrolling in both axes. */
import type { FileReadInput, WorkspaceEnvironmentTarget } from '@pi-workbench/shared'
import type { ReactNode } from 'react'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

import { fileReadingSchema } from '@pi-workbench/shared'
import { Button } from '@pi-workbench/ui/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@pi-workbench/ui/components/dialog'
import { Field, FieldLabel } from '@pi-workbench/ui/components/field'
import { Input } from '@pi-workbench/ui/components/input'

import { sessionJson } from '../../services/session-client.js'
import { hasUnsavedFiles, useFileEditDrafts } from '../../stores/file-edit-drafts.js'
import { ExternalFileActions } from './external-file-actions.js'
import { FileEditor } from './file-editor.js'
import { FilePreview } from './file-preview.js'
import { ReaderContext, useFileReader } from './file-reader-context.js'

type Source = FileReadInput['source']
type PrepareAdd = () =>
  | ((
      selection: {
        path: string
        from: number
        to: number
        version: string
      },
      signal: AbortSignal,
    ) => Promise<string | null>)
  | null

/** The active pane owns navigation and a separate current-file Dialog. Historical Diff
 * and messages stay mounted and immutable. The callback reserves a draft revision only
 * at explicit Add, then revalidates file bytes and that same draft before appending. */
export function FileReaderProvider({
  target,
  csrf,
  enabled,
  prepareAdd,
  children,
}: {
  target: WorkspaceEnvironmentTarget | null
  csrf: string
  enabled: boolean
  prepareAdd: PrepareAdd
  children: ReactNode
}) {
  const [request, setRequest] = useState<{
    source: Source
    line: number
    token: string
    target: string
    edit?: boolean
  } | null>(null)
  const drafts = useFileEditDrafts((s) => s.drafts)
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (hasUnsavedFiles()) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])
  const scope = JSON.stringify(target)
  const open = useMemo<OpenFile | null>(
    () =>
      enabled && target
        ? (source, line = 1) =>
            setRequest({ source, line, token: crypto.randomUUID(), target: scope })
        : null,
    [enabled, target, scope],
  )
  return (
    <ReaderContext value={open}>
      {children}
      {enabled && target && request?.target === scope ? (
        <Dialog
          open
          onOpenChange={(value) => {
            if (!value) {
              setRequest(null)
            }
          }}
        >
          <DialogContent className="flex max-h-[90dvh] min-h-0 flex-col sm:max-w-5xl">
            <DialogHeader className="pr-8">
              <DialogTitle>当前文件 · 只读代码</DialogTitle>
              <DialogDescription>
                当前磁盘读取快照；历史 Diff 和消息不改变，浏览不会加入上下文。
              </DialogDescription>
            </DialogHeader>
            {Object.entries(drafts)
              .filter(([, d]) => JSON.stringify(d.snapshot.target) === scope)
              .map(([id, d]) => (
                <Button
                  key={id}
                  variant="outline"
                  size="sm"
                  className="min-w-0 shrink-0 justify-start"
                  title={d.snapshot.absolutePath}
                  onClick={() =>
                    setRequest({
                      source: { path: d.snapshot.absolutePath },
                      line: 1,
                      token: crypto.randomUUID(),
                      target: scope,
                      edit: true,
                    })
                  }
                >
                  <span className="truncate">恢复文件编辑稿：{d.snapshot.path}</span>
                </Button>
              ))}
            <FileReader
              key={request.token}
              target={target}
              source={request.source}
              line={request.line}
              prepareAdd={prepareAdd}
              csrf={csrf}
              initialEdit={Boolean(request.edit)}
              refresh={(path) =>
                setRequest({
                  ...request,
                  ...(path ? { source: { path } } : {}),
                  token: crypto.randomUUID(),
                })
              }
            />
            <DialogClose render={<Button variant="outline" />}>关闭代码阅读</DialogClose>
          </DialogContent>
        </Dialog>
      ) : null}
    </ReaderContext>
  )
}

export function OpenFileButton({
  path,
  line = 1,
  children,
}: {
  path: string
  line?: number
  children: ReactNode
}) {
  const open = useFileReader()
  return open ? (
    <Button variant="outline" size="sm" onClick={() => open({ path }, line)}>
      {children}
    </Button>
  ) : null
}

function FileReader({
  target,
  source,
  line,
  prepareAdd,
  refresh,
  csrf,
  initialEdit,
}: {
  target: WorkspaceEnvironmentTarget
  source: Source
  line: number
  prepareAdd: PrepareAdd
  refresh: (path?: string) => void
  csrf: string
  initialEdit: boolean
}) {
  const [editPath, setEditPath] = useState<string | null>(() =>
    initialEdit && 'path' in source ? source.path : null,
  )
  const editInput = useMemo(
    () => ({ target, source: { path: editPath ?? '' } }),
    [target, editPath],
  )
  const [queryId] = useState(() => crypto.randomUUID())
  const version = useRef<string | undefined>(undefined),
    alive = useRef(true),
    action = useRef<AbortController | null>(null)
  const [start, setStart] = useState(String(line)),
    [end, setEnd] = useState(String(line)),
    [page, setPage] = useState(Math.floor((line - 1) / 200)),
    [adding, setAdding] = useState(false),
    [notice, setNotice] = useState(''),
    [invalid, setInvalid] = useState(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      action.current?.abort()
    }
  }, [])
  const read = async (signal: AbortSignal, expected?: string) => {
    const data = fileReadingSchema.parse(
      await sessionJson(
        '/api/files/read?' +
          new URLSearchParams({ ...target, ...source, ...(expected ? { version: expected } : {}) }),
        signal,
      ),
    )
    if (JSON.stringify(data.target) !== JSON.stringify(target)) {
      throw Error('文件阅读目标不一致。')
    }
    return data
  }
  const query = useQuery({
    queryKey: ['file-reading', target, source, queryId],
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchInterval: 2000,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      const data = await read(signal, version.current)
      version.current ??= data.version ?? undefined
      return data
    },
  })
  const data = !query.isError ? query.data : undefined
  const ready = data?.status === 'ready' && !invalid ? data : undefined
  const currentPage = Math.min(page, Math.floor(((ready?.lines.length ?? 1) - 1) / 200))
  const from = Number(start),
    to = Number(end)
  const valid = Boolean(
    ready &&
    Number.isInteger(from) &&
    Number.isInteger(to) &&
    from >= 1 &&
    to >= from &&
    to <= ready.lines.length &&
    to - from < 200,
  )
  const add = async () => {
    if (!ready || !valid || adding || !ready.version) {
      return
    }
    const commit = prepareAdd()
    if (!commit) {
      setNotice('所属草稿正在提交或已不可用，未加入输入。')
      return
    }
    const controller = new AbortController()
    action.current = controller
    setAdding(true)
    setNotice('正在重验文件与所属草稿…')
    try {
      const current = await read(controller.signal, ready.version)
      if (!alive.current) {
        return
      }
      if (current.status !== 'ready' || current.version !== ready.version) {
        setInvalid(true)
        setNotice(current.diagnostic)
        return
      }
      const text = current.lines.slice(from - 1, to).join('\n')
      if (new TextEncoder().encode(text).length > 32768) {
        setNotice('选区超过 32 KiB，请缩小范围。')
        return
      }
      const resultNotice = await commit(
        { path: current.absolutePath, from, to, version: current.version },
        controller.signal,
      )
      if (alive.current && !controller.signal.aborted) {
        setNotice(resultNotice ?? '选区已加入所属草稿，尚未发送。')
      }
    } catch (error) {
      if (alive.current && !controller.signal.aborted) {
        setInvalid(true)
        setNotice(error instanceof Error ? error.message : '文件检查失败，未加入输入。')
      }
    } finally {
      if (alive.current) {
        setAdding(false)
      }
    }
  }
  return (
    <section aria-label="只读代码阅读" className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
      <Button variant="outline" size="sm" onClick={() => refresh(query.data?.absolutePath)}>
        刷新读取当前版本
      </Button>
      {query.isPending ? <output>正在读取文件快照…</output> : null}
      {query.isError ? <p role="alert">{query.error.message} 旧正文已隐藏，请刷新。</p> : null}
      {data ? (
        <>
          <p className="text-xs break-all">真实路径：{data.absolutePath}</p>
          <p className="text-xs break-all">
            读取版本：{data.version ?? '无'} · {data.bytes} 字节 · 核对时间{' '}
            {new Date(data.checkedAt).toLocaleTimeString()}
          </p>
          <p className="text-xs text-muted-foreground">{data.diagnostic}</p>
        </>
      ) : null}
      <FilePreview
        input={{ target, source, ...(data?.version ? { version: data.version } : {}) }}
      />
      <ExternalFileActions
        target={target}
        source={source}
        line={Number(start)}
        {...(data?.version ? { version: data.version } : {})}
        disabled={
          !data ||
          data.status === 'changed' ||
          invalid ||
          !Number.isInteger(Number(start)) ||
          Number(start) < 1 ||
          Number(start) > 10000
        }
      />
      {ready && !editPath ? (
        <Button variant="outline" size="sm" onClick={() => setEditPath(ready.absolutePath)}>
          手动编辑文件
        </Button>
      ) : null}
      {editPath ? <FileEditor input={editInput} csrf={csrf} /> : null}
      {ready ? (
        <>
          {line > ready.lines.length ? (
            <p role="note">
              目标第 {line} 行超出当前文件的 {ready.lines.length} 行；历史行号不保证对应当前代码。
            </p>
          ) : null}
          <p>
            共 {ready.lines.length} 行 · 第 {currentPage * 200 + 1}–
            {Math.min((currentPage + 1) * 200, ready.lines.length)} 行 · 点击行号选行，Shift
            点击扩展选区。
          </p>
          <section
            className="min-h-24 overflow-auto rounded-md border"
            aria-label="代码行"
            tabIndex={0}
          >
            <table className="w-full text-left font-mono text-xs">
              <tbody>
                {ready.lines.slice(currentPage * 200, (currentPage + 1) * 200).map((text, i) => {
                  const n = currentPage * 200 + i + 1
                  return (
                    <tr key={n} className={n >= from && n <= to ? 'bg-muted' : ''}>
                      <td className="sticky left-0 w-12 bg-background align-top">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`选择第 ${n} 行`}
                          aria-pressed={n >= from && n <= to}
                          onClick={(event) => {
                            if (event.shiftKey) {
                              setStart(String(Math.min(from, n)))
                              setEnd(String(Math.max(from, n)))
                            } else {
                              setStart(String(n))
                              setEnd(String(n))
                            }
                          }}
                        >
                          {n}
                        </Button>
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <code className="whitespace-pre">{text || ' '}</code>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
          <div className="flex flex-wrap items-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              上一页代码
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={(currentPage + 1) * 200 >= ready.lines.length}
              onClick={() => setPage(currentPage + 1)}
            >
              下一页代码
            </Button>
            <Field className="w-28">
              <FieldLabel htmlFor="code-from">选区起始行</FieldLabel>
              <Input
                id="code-from"
                type="number"
                min={1}
                max={ready.lines.length}
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field className="w-28">
              <FieldLabel htmlFor="code-to">选区结束行</FieldLabel>
              <Input
                id="code-to"
                type="number"
                min={1}
                max={ready.lines.length}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
            <Button
              variant="outline"
              size="sm"
              disabled={!valid}
              onClick={() => setPage(Math.floor((from - 1) / 200))}
            >
              定位选区
            </Button>
            <Button size="sm" disabled={!valid || adding} onClick={() => void add()}>
              选区加入输入
            </Button>
          </div>
        </>
      ) : null}
      {notice ? <output>{notice}</output> : null}
    </section>
  )
}
