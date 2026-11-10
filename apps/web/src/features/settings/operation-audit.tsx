import type { AuditKind, AuditQuery } from '@pi-workbench/shared'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import {
  auditExportSchema,
  auditPageSchema,
  auditQuerySchema,
  compatibleRuntime,
  runtimeHelloSchema,
} from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button } from '@pi-workbench/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@pi-workbench/ui/components/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@pi-workbench/ui/components/empty'
import { Field, FieldGroup, FieldLabel } from '@pi-workbench/ui/components/field'
import { Input } from '@pi-workbench/ui/components/input'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceLine,
  TraceTitle,
} from '@pi-workbench/ui/components/trace'

import { sessionJson } from '../../services/session-client.js'
import './operation-audit.css'

const kindNames: Record<AuditKind, string> = {
  approval: '工具审批',
  'session-grant': '会话授权',
  'resource-trust': '资源信任',
  'client-access': '客户端访问',
  rollback: '文件回滚',
  'change-review': '文件审查',
  'user-file-save': '用户文件保存',
}
const sourceNames = { human: '人类决定', host: '宿主记录', 'synthetic-fixture': '合成夹具' }
const decisions: Record<string, string> = {
  pending: '等待决定',
  allowed: '允许',
  denied: '拒绝',
  cancelled: '取消',
  invalidated: '失效',
  created: '授予',
  revoked: '撤销',
  granted: '信任',
  paired: '配对',
}
function queryString(query: AuditQuery): string {
  return new URLSearchParams(
    Object.entries(query).map(([key, value]) => [key, String(value)]),
  ).toString()
}

/** Read-only, bounded host audit. Every query and download is bound to the current filter
 * identity; late exports cannot create a file after navigation. Clearing the view never
 * clears originals or live authority, and no operation here invokes an agent/model.
 */
export function OperationAudit() {
  const [query, setQuery] = useState<AuditQuery>({}),
    [trail, setTrail] = useState<AuditQuery[]>([])
  const [kind, setKind] = useState<AuditKind | null>(null),
    [session, setSession] = useState('')
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [exporting, setExporting] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const live = useRef(true),
    owner = useRef(''),
    download = useRef(false)
  const identity = JSON.stringify([query, refresh])
  owner.current = identity
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const page = useQuery({
    queryKey: ['operation-audit', query],
    queryFn: async ({ signal }) => {
      const hello = runtimeHelloSchema.parse(await sessionJson('/api/protocol', signal))
      if (!compatibleRuntime(hello)) {
        throw new Error('客户端与本地服务版本不匹配，请更新后重新核对。')
      }
      return auditPageSchema.parse(await sessionJson(`/api/audit?${queryString(query)}`, signal))
    },
    retry: false,
    gcTime: 0,
  })
  const apply = (next: AuditQuery) => {
    setQuery(next)
    setTrail([])
    setError('')
    setNotice('')
    setRefresh((v) => v + 1)
    if (JSON.stringify(next) === JSON.stringify(query)) {
      void page.refetch()
    }
  }
  const exportPage = async () => {
    if (!page.data || page.isError || page.isFetching || download.current) {
      return
    }
    const captured = owner.current
    download.current = true
    setExporting(true)
    setError('')
    setNotice('')
    try {
      const selected = { ...query, snapshot: page.data.snapshot }
      const value = auditExportSchema.parse(
        await sessionJson(`/api/audit/export?${queryString(selected)}`),
      )
      if (!live.current || captured !== owner.current) {
        return
      }
      if (
        value.page.snapshot !== page.data.snapshot ||
        value.page.entries.map((e) => e.id).join(',') !==
          page.data.entries.map((e) => e.id).join(',')
      ) {
        throw new Error('导出范围与本页不一致，请重新核对后导出。')
      }
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
      )
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'piw-audit-redacted.json'
        link.click()
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      setNotice(
        `已生成本页 ${value.page.entries.length} 条脱敏副本；请在保存对话框确认位置。原件与权限未改变。`,
      )
    } catch (cause) {
      if (live.current && captured === owner.current) {
        setError(cause instanceof Error ? cause.message : '导出失败，请重新核对后重试。')
      }
    } finally {
      download.current = false
      if (live.current) {
        setExporting(false)
      }
    }
  }
  if (!window.piWorkbench) {
    return <p>操作审计目前仅向 Electron 开放。</p>
  }
  return (
    <main className="operation-audit">
      <header>
        <h1>操作审计</h1>
        <p>核对审批决定、会话授权、资源信任与客户端访问。历史决定不能重新执行。</p>
      </header>
      <Alert>
        <AlertTitle>原件保留 · 仅导出当前筛选页</AlertTitle>
        <AlertDescription>
          每页最多50条，按记录序号从新到旧。导出包含本页范围与时间，正文统一脱敏，不包含凭证、SDK消息全文或有效权限。
          清除筛选不删除记录；下载副本由你在下载目录自行管理。这里不自动清理审计原件或会话历史。
        </AlertDescription>
      </Alert>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const parsed = auditQuerySchema.safeParse({
            ...(kind ? { kind } : {}),
            ...(session.trim() ? { sessionId: session.trim() } : {}),
          })
          if (!parsed.success) {
            setError('请输入有效的会话 ID，或留空查看全部会话与全局设置。')
            return
          }
          apply(parsed.data)
        }}
      >
        <FieldGroup className="audit-filters">
          <Field>
            <FieldLabel htmlFor="audit-kind">事件类别</FieldLabel>
            <DropdownMenu>
              <DropdownMenuTrigger
                id="audit-kind"
                render={<Button variant="outline" />}
                aria-label="审计事件类别"
              >
                {kind ? kindNames[kind] : '全部类别'}
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuRadioGroup
                  value={kind ?? 'all'}
                  onValueChange={(value) => {
                    if (value === 'all') {
                      setKind(null)
                    } else {
                      const parsedKind = auditQuerySchema.shape.kind.safeParse(value)
                      if (parsedKind.success && parsedKind.data) {
                        setKind(parsedKind.data)
                      }
                    }
                  }}
                >
                  <DropdownMenuRadioItem value="all" closeOnClick>
                    全部类别
                  </DropdownMenuRadioItem>
                  {Object.entries(kindNames).map(([value, name]) => (
                    <DropdownMenuRadioItem value={value} key={value} closeOnClick>
                      {name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </Field>
          <Field>
            <FieldLabel htmlFor="audit-session">会话 ID（可选）</FieldLabel>
            <Input
              id="audit-session"
              value={session}
              onChange={(event) => setSession(event.target.value)}
              placeholder="留空包括全局设置"
            />
          </Field>
        </FieldGroup>
        <div className="audit-actions">
          <Button type="submit">应用筛选</Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setKind(null)
              setSession('')
              apply({})
            }}
          >
            清除筛选
          </Button>
        </div>
      </form>
      <div className="audit-actions">
        <Button
          variant="outline"
          onClick={() => {
            apply({
              ...(query.kind ? { kind: query.kind } : {}),
              ...(query.sessionId ? { sessionId: query.sessionId } : {}),
            })
          }}
          disabled={page.isFetching}
        >
          刷新最新记录
        </Button>
        <Button
          variant="outline"
          disabled={!page.data || page.isError || page.isFetching || exporting}
          onClick={() => void exportPage()}
        >
          {exporting ? '正在导出…' : '导出本页脱敏记录'}
        </Button>
      </div>
      {page.isPending ? <output>正在读取审计…</output> : null}
      {page.isError || error || page.data?.warning ? (
        <Alert variant="destructive">
          <AlertTitle>审计需要核对</AlertTitle>
          <AlertDescription>
            {error || page.error?.message || page.data?.warning}{' '}
            已加载内容保留；未自动重试决定或更改权限。
          </AlertDescription>
        </Alert>
      ) : null}
      {notice ? <output>{notice}</output> : null}
      {page.data ? (
        <>
          <p className="audit-caption">
            记录起点：{new Date(page.data.startedAt).toLocaleString()} · 核对：
            {new Date(page.data.checkedAt).toLocaleString()} · 快照序号 {page.data.snapshot} · 本页{' '}
            {page.data.entries.length} 条
          </p>
          <p className="audit-caption">
            功能启用前的审批仍在会话历史中只读查看。本页不虚构旧决定、回滚或缺失记录，也不证明操作系统层面的防篡改。
          </p>
          {!page.data.entries.length ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>没有匹配的审计记录</EmptyTitle>
                <EmptyDescription>
                  更换筛选或在明确操作后刷新；查看本页不会启动任务。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Trace>
              {page.data.entries.map((entry) => (
                <article key={entry.id} className="audit-record" data-audit-id={entry.id}>
                  <TraceCollapsible>
                    <TraceCollapsibleTrigger>
                      <TraceLine>
                        <TraceTitle>
                          {kindNames[entry.kind]} · {decisions[entry.decision] ?? entry.decision} ·
                          #{entry.sequence}
                        </TraceTitle>
                      </TraceLine>
                    </TraceCollapsibleTrigger>
                    <div className="audit-record-meta">
                      <Badge variant="outline">{sourceNames[entry.source]}</Badge>
                      <Badge variant="secondary">
                        风险 {entry.risk === 'unknown' ? '未知' : entry.risk}
                      </Badge>
                      <time dateTime={new Date(entry.at).toISOString()}>
                        {new Date(entry.at).toLocaleString()}
                      </time>
                    </div>
                    <TraceCollapsibleContent>
                      <dl>
                        <dt>对象</dt>
                        <dd>{entry.objectId}</dd>
                        <dt>会话</dt>
                        <dd>{entry.sessionId ?? '全局设置'}</dd>
                        <dt>决定来源</dt>
                        <dd>
                          {sourceNames[entry.source]} · {entry.actor ?? '宿主生命周期'}
                        </dd>
                        <dt>理由</dt>
                        <dd>{entry.reason}</dd>
                        <dt>范围（脱敏）</dt>
                        <dd>
                          <pre>{entry.scope}</pre>
                        </dd>
                      </dl>
                      {entry.sessionId ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSession(entry.sessionId ?? '')
                            apply({ sessionId: entry.sessionId ?? undefined })
                          }}
                        >
                          仅看此会话
                        </Button>
                      ) : null}
                    </TraceCollapsibleContent>
                  </TraceCollapsible>
                </article>
              ))}
            </Trace>
          )}
          <nav className="audit-actions" aria-label="审计分页">
            <Button
              variant="outline"
              disabled={!trail.length || page.isFetching}
              onClick={() => {
                const prior = trail.at(-1)
                if (prior) {
                  setQuery(prior)
                  setRefresh((v) => v + 1)
                  setTrail(trail.slice(0, -1))
                  setNotice('')
                }
              }}
            >
              上一页记录
            </Button>
            <Button
              variant="outline"
              disabled={!page.data.nextBefore || page.isFetching || page.isError}
              onClick={() => {
                if (page.data?.nextBefore) {
                  setTrail([...trail, { ...query, snapshot: page.data.snapshot }])
                  setQuery({ ...query, snapshot: page.data.snapshot, before: page.data.nextBefore })
                  setRefresh((v) => v + 1)
                  setNotice('')
                }
              }}
            >
              更早记录
            </Button>
          </nav>
        </>
      ) : null}
    </main>
  )
}
