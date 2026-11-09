import type { FileNode, WorkspaceEnvironmentTarget } from '@pi-workbench/shared'

import { useQuery } from '@tanstack/react-query'
import { FileIcon, FolderIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { fileListingSchema, fileLocationSchema, fileSearchSchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button } from '@pi-workbench/ui/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@pi-workbench/ui/components/dialog'
import { Field, FieldLabel } from '@pi-workbench/ui/components/field'
import { Input } from '@pi-workbench/ui/components/input'

import { sessionJson } from '../../services/session-client.js'
import { ExternalFileActions } from './external-file-actions.js'
import { useFileReader } from './file-reader-context.js'

const queryOptions = {
  retry: false,
  gcTime: 0,
  staleTime: 0,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const

/** Volatile, keyed dialog: opening reads on demand; closing, IME changes and switching
 * target cancel only observation. No draft mutation, SDK stop or authorization expansion. */
export function FileBrowser({ target }: { target: WorkspaceEnvironmentTarget | null }) {
  return target ? <BrowserDialog key={JSON.stringify(target)} target={target} /> : null
}
function BrowserDialog({ target }: { target: WorkspaceEnvironmentTarget }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>浏览与查找文件</DialogTrigger>
      <DialogContent className="flex max-h-[85dvh] min-h-0 flex-col sm:max-w-3xl">
        <DialogHeader className="pr-8">
          <DialogTitle>文件与快速定位</DialogTitle>
          <DialogDescription>
            只读当前授权目录；查看文件位置不会发送任务或加入上下文。
          </DialogDescription>
        </DialogHeader>
        {open ? <DirectoryBrowser target={target} /> : null}
        <DialogClose render={<Button variant="outline" />}>关闭文件浏览</DialogClose>
      </DialogContent>
    </Dialog>
  )
}
function DirectoryBrowser({ target }: { target: WorkspaceEnvironmentTarget }) {
  const [directory, setDirectory] = useState<string>(),
    [cursor, setCursor] = useState<string>()
  const [term, setTerm] = useState(''),
    [debounced, setDebounced] = useState(''),
    [composing, setComposing] = useState(false)
  const [revision, setRevision] = useState(0),
    [selected, setSelected] = useState<string>()
  useEffect(() => {
    if (composing) {
      return undefined
    }
    const timer = setTimeout(() => setDebounced(term.trim()), 200)
    return () => clearTimeout(timer)
  }, [term, composing])
  const searching = Boolean(term.trim()),
    settled = !composing && term.trim() === debounced
  const go = (id?: string) => {
    setDirectory(id)
    setCursor(undefined)
    setSelected(undefined)
    setTerm('')
    setDebounced('')
  }
  return (
    <section aria-label="授权文件浏览" className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <Field>
        <FieldLabel htmlFor="file-search">文件名或相对路径</FieldLabel>
        <Input
          id="file-search"
          maxLength={160}
          value={term}
          placeholder="输入文件名，或进入文件夹逐级查找"
          onChange={(e) => {
            setTerm(e.target.value)
            setSelected(undefined)
          }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
            }
          }}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => go()}>
          授权根目录
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setCursor(undefined)
            setSelected(undefined)
            setRevision((r) => r + 1)
          }}
        >
          刷新文件列表
        </Button>
        {searching ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTerm('')
              setDebounced('')
            }}
          >
            取消文件搜索
          </Button>
        ) : null}
      </div>
      {!settled ? (
        <output>等待文件搜索输入…</output>
      ) : (
        <FileResults
          key={JSON.stringify([target, directory, cursor, debounced, revision])}
          target={target}
          directory={directory}
          cursor={cursor}
          term={debounced}
          revision={revision}
          go={go}
          select={setSelected}
          next={(id, page) => {
            setDirectory(id)
            setCursor(page)
            setSelected(undefined)
          }}
        />
      )}
      {selected && settled ? (
        <Location key={selected} target={target} file={selected} locate={(id) => go(id)} />
      ) : null}
    </section>
  )
}
/** Mount a single observation per settled request. Unmounting synchronously invalidates
 * its identity and aborts fetch; disabled cached observers cannot expose a late old page. */
function FileResults({
  target,
  directory,
  cursor,
  term,
  revision,
  go,
  select,
  next,
}: {
  target: WorkspaceEnvironmentTarget
  directory: string | undefined
  cursor: string | undefined
  term: string
  revision: number
  go: (id?: string) => void
  select: (id: string) => void
  next: (directory: string, cursor: string) => void
}) {
  const searching = Boolean(term)
  const result = useQuery({
    ...queryOptions,
    queryKey: ['file-results', target, directory, cursor, term, revision],
    queryFn: async ({ signal }) =>
      searching
        ? fileSearchSchema.parse(
            await sessionJson(
              '/api/files/search?' + new URLSearchParams({ ...target, query: term }),
              signal,
            ),
          )
        : fileListingSchema.parse(
            await sessionJson(
              '/api/files/list?' +
                new URLSearchParams({
                  ...target,
                  ...(directory ? { directory } : {}),
                  ...(cursor ? { cursor } : {}),
                }),
              signal,
            ),
          ),
  })
  const data = !result.isFetching && !result.isError ? result.data : undefined
  const valid = data && JSON.stringify(data.target) === JSON.stringify(target) ? data : undefined
  const list = valid && 'directory' in valid ? valid : undefined
  return (
    <>
      {result.isError ? (
        <Alert>
          <AlertTitle>文件列表未同步</AlertTitle>
          <AlertDescription>
            {result.error.message} 可返回根目录刷新；后台任务保留。
          </AlertDescription>
        </Alert>
      ) : null}
      {result.isFetching ? <output>正在查找文件…</output> : null}
      {valid ? (
        <>
          <p className="text-xs break-all">已授权目录：{valid.root}</p>
          <p className="text-xs break-all">
            {valid.git.status === 'repository'
              ? `仓库根（仅信息）：${valid.git.root}`
              : valid.git.status === 'not_repository'
                ? '非 Git 目录'
                : valid.git.message}{' '}
            · 附加目录：未开放
          </p>
          {list ? (
            <p className="text-xs break-all">
              当前目录：{list.directory.path} · 按文件系统顺序分页，每页最多 100 项
            </p>
          ) : null}
          {list ? (
            <ExternalFileActions target={target} source={{ file: list.directory.id }} directory />
          ) : null}
          {list?.parent ? (
            <Button variant="outline" size="sm" onClick={() => go(list.parent!.id)}>
              上级目录
            </Button>
          ) : null}
          {valid.diagnostic ? (
            <p className="text-xs text-muted-foreground">{valid.diagnostic}</p>
          ) : null}
          {valid.entries.length ? (
            <ul aria-label="文件列表" className="flex min-h-20 flex-col gap-1">
              {valid.entries.map((node) => (
                <li
                  key={node.id}
                  className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border px-2 py-1"
                >
                  <Button
                    variant="ghost"
                    className="h-auto min-h-8 min-w-0 flex-1 justify-start text-left"
                    disabled={node.availability !== 'available'}
                    onClick={() => (node.kind === 'directory' ? go(node.id) : select(node.id))}
                  >
                    {node.kind === 'directory' ? (
                      <FolderIcon className="shrink-0" />
                    ) : (
                      <FileIcon className="shrink-0" />
                    )}
                    <span className="min-w-0 break-all whitespace-normal">
                      {searching ? node.path : node.name}
                    </span>
                  </Button>
                  <NodeLabels node={node} />
                </li>
              ))}
            </ul>
          ) : (
            <p>当前范围没有匹配项。</p>
          )}
          {list?.cursor ? (
            <Button variant="outline" onClick={() => next(list.directory.id, list.cursor!)}>
              加载下一页文件
            </Button>
          ) : null}
        </>
      ) : null}
    </>
  )
}
function NodeLabels({ node }: { node: FileNode }) {
  return (
    <>
      {node.ignored === 'yes' ? <Badge variant="secondary">Git 忽略</Badge> : null}
      {node.ignored === 'unknown' ? <Badge variant="outline">忽略状态未知</Badge> : null}
      {node.scanSkipped ? <Badge variant="outline">搜索跳过</Badge> : null}
      {node.reason ? (
        <span className="w-full text-xs text-muted-foreground">{node.reason}</span>
      ) : null}
    </>
  )
}
function Location({
  target,
  file,
  locate,
}: {
  target: WorkspaceEnvironmentTarget
  file: string
  locate: (id: string) => void
}) {
  const read = useFileReader()
  const query = useQuery({
    ...queryOptions,
    queryKey: ['file-location', target, file],
    queryFn: async ({ signal }) =>
      fileLocationSchema.parse(
        await sessionJson('/api/files/locate?' + new URLSearchParams({ ...target, file }), signal),
      ),
  })
  return (
    <section aria-label="文件位置" className="flex flex-col gap-2 rounded-lg border p-3">
      {query.isFetching ? <p>正在核对文件位置…</p> : null}
      {query.isError ? <p role="alert">{query.error.message}</p> : null}
      {!query.isFetching && !query.isError && query.data ? (
        <>
          <p className="break-all">{query.data.absolutePath}</p>
          <p>
            {query.data.file.kind === 'file'
              ? `文件 · ${query.data.file.size ?? '未知'} 字节`
              : '目录'}
          </p>
          <NodeLabels node={query.data.file} />
          {query.data.file.availability === 'available' ? (
            <ExternalFileActions
              target={target}
              source={{ file: query.data.file.id }}
              directory={query.data.file.kind === 'directory'}
            />
          ) : null}
          {read &&
          query.data.file.kind === 'file' &&
          query.data.file.availability === 'available' ? (
            <Button variant="outline" size="sm" onClick={() => read({ file: query.data.file.id })}>
              只读查看代码
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => locate(query.data.directory.id)}>
            定位所在目录
          </Button>
        </>
      ) : null}
    </section>
  )
}
