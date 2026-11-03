import type {
  Project,
  SessionSearchPage,
  SessionSearchQuery,
  SessionSearchResult,
} from '@pi-workbench/shared'

import { useQuery } from '@tanstack/react-query'
import { SearchIcon } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { sessionSearchPageSchema, sessionSearchQuerySchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button } from '@pi-workbench/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@pi-workbench/ui/components/dialog'
import { Field, FieldGroup, FieldLabel } from '@pi-workbench/ui/components/field'
import { Input } from '@pi-workbench/ui/components/input'

import { sessionJson } from '../../services/session-client.js'

const states = {
  all: '全部状态',
  running: '运行中',
  approval: '待审批',
  held: '待处理',
  completed: '已完成',
  failed: '失败',
  aborted: '已停止',
  interrupted: '已中断',
  idle: '空闲',
}
const defaults = {
  q: '',
  project: 'all',
  state: 'all',
  archive: 'active',
  page: 1,
  limit: 20,
} as const

/** Each open dialog owns its query, debounce and requests. Input changes hide old results
 * immediately; query identity + AbortSignal isolate A→B→A and pagination/close races.
 * IME selection keys never open a result or close the dialog. No query is stored on disk. */
export function SessionSearchDialog({
  projects,
  close,
  select,
}: {
  projects: Project[]
  close: () => void
  select: (result: SessionSearchResult) => void
}) {
  const id = useId(),
    input = useRef<HTMLInputElement>(null),
    composing = useRef(false)
  const [query, setQuery] = useState<SessionSearchQuery>(defaults)
  const [from, setFrom] = useState(''),
    [to, setTo] = useState('')
  const [composition, setComposition] = useState(false)
  const [debounced, setDebounced] = useState(JSON.stringify(defaults))
  const [selected, setSelected] = useState(0)
  const token = JSON.stringify(query)
  const valid = sessionSearchQuerySchema.safeParse(query).success
  const changing = token !== debounced || composition
  useEffect(() => {
    if (composition) {
      return undefined
    }
    const timer = setTimeout(() => {
      setDebounced(token)
      setSelected(0)
    }, 200)
    return () => clearTimeout(timer)
  }, [token, composition])
  const results = useQuery<SessionSearchPage>({
    queryKey: ['session-search', debounced],
    enabled: valid && !changing,
    gcTime: 0,
    retry: false,
    refetchInterval: (current) => (current.state.status === 'error' ? false : 2000),
    queryFn: async ({ signal }) => {
      const value = sessionSearchQuerySchema.parse(JSON.parse(debounced))
      const params = new URLSearchParams(
        Object.entries(value).map(([key, item]) => [key, String(item)]),
      )
      return sessionSearchPageSchema.parse(await sessionJson(`/api/chat/search?${params}`, signal))
    },
  })
  const page = !changing && valid && !results.isError ? results.data : undefined
  const rows = page?.results ?? []
  const update = (patch: Partial<SessionSearchQuery>) =>
    setQuery((prior) => ({ ...prior, ...patch, page: 1 }))
  const clear = () => {
    setQuery(defaults)
    setFrom('')
    setTo('')
    input.current?.focus()
  }
  const chosen = rows[Math.min(selected, Math.max(0, rows.length - 1))]
  useEffect(() => {
    document.getElementById(`${id}-result-${selected}`)?.scrollIntoView({ block: 'nearest' })
  }, [selected, id])
  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (!open && composing.current) {
          details.cancel()
          return
        }
        if (!open) {
          close()
        }
      }}
    >
      <DialogContent className="session-search-dialog" showCloseButton={false} initialFocus={input}>
        <DialogHeader>
          <DialogTitle>搜索会话</DialogTitle>
          <DialogDescription>
            搜索标题和已保存的用户／助手消息。正文结果可定位消息，默认不含归档。
          </DialogDescription>
        </DialogHeader>
        <FieldGroup
          onCompositionStart={() => {
            composing.current = true
            setComposition(true)
          }}
          onCompositionEnd={() => {
            composing.current = false
            setComposition(false)
          }}
        >
          <Field data-invalid={!valid || undefined}>
            <FieldLabel htmlFor={`${id}-query`}>标题或消息正文</FieldLabel>
            <Input
              ref={input}
              id={`${id}-query`}
              value={query.q}
              autoComplete="off"
              aria-invalid={!valid}
              aria-describedby={`${id}-help`}
              aria-controls={`${id}-results`}
              onChange={(event) => update({ q: event.target.value })}
              onKeyDown={(event) => {
                if (
                  composing.current ||
                  event.nativeEvent.isComposing ||
                  event.nativeEvent.keyCode === 229
                ) {
                  if (['Enter', 'Escape', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
                    event.stopPropagation()
                  }
                  return
                }
                if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && rows.length) {
                  event.preventDefault()
                  const next = event.key === 'ArrowDown' ? 0 : rows.length - 1
                  setSelected(next)
                  document.getElementById(`${id}-result-${next}`)?.focus()
                }
                if (event.key === 'Enter') {
                  event.preventDefault()
                  if (chosen) {
                    select(chosen)
                  }
                }
              }}
            />
            <p id={`${id}-help`} className="text-xs text-muted-foreground">
              留空查看最近会话 · ↑↓ 选择 · Enter 打开 · Escape 关闭
            </p>
          </Field>
          <div className="search-filter-grid">
            <Field>
              <FieldLabel htmlFor={`${id}-project`}>项目范围</FieldLabel>
              <select
                id={`${id}-project`}
                value={query.project}
                onChange={(event) => update({ project: event.target.value })}
              >
                <option value="all">全部项目</option>
                <option value="none">无项目</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} · {project.directory ?? '独立目录'} · {project.id.slice(0, 8)}
                  </option>
                ))}
                {query.project !== 'all' &&
                query.project !== 'none' &&
                !projects.some((row) => row.id === query.project) ? (
                  <option value={query.project}>项目已移除，请清除筛选</option>
                ) : null}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-state`}>会话状态</FieldLabel>
              <select
                id={`${id}-state`}
                value={query.state}
                onChange={(event) =>
                  update({
                    state: sessionSearchQuerySchema.parse({ state: event.target.value }).state,
                  })
                }
              >
                {Object.entries(states).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-archive`}>归档范围</FieldLabel>
              <select
                id={`${id}-archive`}
                value={query.archive}
                onChange={(event) =>
                  update({
                    archive: sessionSearchQuerySchema.parse({ archive: event.target.value })
                      .archive,
                  })
                }
              >
                <option value="active">不含归档</option>
                <option value="all">包含归档</option>
                <option value="archived">仅已归档</option>
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-from`}>更新时间起始</FieldLabel>
              <Input
                type="date"
                id={`${id}-from`}
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value)
                  update({
                    from: event.target.value
                      ? new Date(`${event.target.value}T00:00:00`).getTime()
                      : undefined,
                  })
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-to`}>更新时间截止</FieldLabel>
              <Input
                type="date"
                id={`${id}-to`}
                value={to}
                onChange={(event) => {
                  setTo(event.target.value)
                  update({
                    to: event.target.value
                      ? new Date(`${event.target.value}T23:59:59.999`).getTime()
                      : undefined,
                  })
                }}
              />
            </Field>
          </div>
        </FieldGroup>
        <div className="search-summary">
          <output aria-live="polite" aria-label="搜索状态">
            {!valid
              ? '查询最多 160 个 Unicode 字符，起始日期不能晚于截止日期。'
              : changing
                ? '等待输入完成…'
                : results.isError
                  ? '搜索失败，条件已保留'
                  : page
                    ? `共 ${page.total} 个会话 · 第 ${page.page} 页`
                    : '正在搜索…'}
          </output>
          <Button variant="ghost" size="sm" onClick={clear}>
            清除筛选
          </Button>
        </div>
        {results.isError && !changing ? (
          <Alert variant="destructive">
            <AlertTitle>搜索暂不可用</AlertTitle>
            <AlertDescription>
              {results.error.message}
              <Button variant="outline" onClick={() => void results.refetch()}>
                重试搜索
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {page?.incompleteSessions ? (
          <output>
            {page.incompleteSessions}{' '}
            个会话存在历史诊断，结果可能不完整；可在会话历史查看，原件保留。
          </output>
        ) : null}
        <ul
          className="session-search-results"
          id={`${id}-results`}
          aria-label="搜索结果"
          aria-busy={changing || results.isFetching}
        >
          {rows.map((row, index) => (
            <li key={row.sessionId}>
              <Button
                id={`${id}-result-${index}`}
                variant="ghost"
                className="session-search-result"
                data-selected={chosen?.sessionId === row.sessionId || undefined}
                aria-label={`${row.title} · ${row.projectName} · ${row.match === 'user' ? '用户正文命中' : row.match === 'assistant' ? '助手正文命中' : row.match === 'title' ? '标题命中' : '最近会话'}`}
                onFocus={() => setSelected(index)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault()
                    const next =
                      (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
                    setSelected(next)
                    document.getElementById(`${id}-result-${next}`)?.focus()
                  }
                }}
                onClick={() => select(row)}
              >
                <span className="search-result-heading">
                  <strong>{row.title}</strong>
                  <Badge variant="outline">
                    {states[row.state]}
                    {row.archived ? ' · 已归档' : ''}
                  </Badge>
                </span>
                <span className="search-result-meta">
                  {row.projectName}
                  {row.projectId
                    ? ` · ${row.projectDirectory ?? '独立目录'} · ${row.projectId.slice(0, 8)}`
                    : ''}{' '}
                  · {new Date(row.updatedAt).toLocaleString()}
                </span>
                <span className="search-result-snippet">
                  {row.match === 'user' ? '你：' : row.match === 'assistant' ? 'Pi：' : ''}
                  {row.snippet}
                </span>
              </Button>
            </li>
          ))}
          {page && rows.length === 0 ? (
            <li className="search-empty">
              <SearchIcon aria-hidden="true" />
              <p>没有匹配的会话</p>
              <p>可调整条件或清除筛选查看最近会话。</p>
            </li>
          ) : null}
        </ul>
        <div className="search-pagination">
          <Button
            variant="outline"
            disabled={!page || page.page <= 1 || results.isFetching}
            onClick={() => setQuery((prior) => ({ ...prior, page: prior.page - 1 }))}
          >
            上一页
          </Button>
          <Button
            variant="outline"
            disabled={!page || page.page * page.limit >= page.total || results.isFetching}
            onClick={() => setQuery((prior) => ({ ...prior, page: prior.page + 1 }))}
          >
            下一页
          </Button>
          <Button variant="ghost" onClick={close}>
            关闭搜索
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
