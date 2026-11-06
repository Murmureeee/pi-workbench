import type {
  ManagedSession,
  SessionReceipt,
  SessionSubmission,
  SessionSubmit,
  StopIntent,
} from '@pi-workbench/shared'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpIcon,
  ChevronDownIcon,
  FolderIcon,
  MessageSquarePlusIcon,
  PanelLeftIcon,
  PencilIcon,
  RefreshCwIcon,
  SearchIcon,
  SettingsIcon,
  SquareIcon,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import {
  accessSnapshotSchema,
  directorySelectionSchema,
  sessionActivitySchema,
  sessionListSchema,
  sessionModelSchema,
  sessionOptionsSchema,
  submissionListSchema,
} from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button, buttonVariants } from '@pi-workbench/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@pi-workbench/ui/components/dropdown-menu'
import { Field, FieldGroup, FieldLabel } from '@pi-workbench/ui/components/field'
import { Input } from '@pi-workbench/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from '@pi-workbench/ui/components/input-group'

import { getModelCatalog } from '../../services/model-client.js'
import { navigate, useNavigation } from '../../services/navigation.js'
import {
  findSubmission,
  sessionJson,
  SessionRequestError,
  submitSession,
} from '../../services/session-client.js'
import { mergeSessions } from '../../services/session-title-cache.js'
import { workspaceCommand } from '../../services/workspace-client.js'
import { sessionDraft, useSessionDrafts } from '../../stores/session-drafts.js'
import { retainSessionView, sessionView, useSessionViews } from '../../stores/session-views.js'
import { useWorkbench } from '../../stores/workbench.js'
import { useWorkspaceAvailability } from '../workspaces/use-workspace-availability.js'
import { WorkspaceEnvironment } from '../workspaces/workspace-environment.js'
import { WorkspaceSafety } from '../workspaces/workspace-safety.js'
import { ManagedThread } from './managed-thread.js'
import { SessionAuthorizations } from './session-authorizations.js'
import { SessionHistory } from './session-history.js'
import { SessionInputQueue } from './session-input-queue.js'
import { SessionLibrary } from './session-library.js'
import { SessionRenameDialog } from './session-rename-dialog.js'
import { SessionSearchDialog } from './session-search-dialog.js'
import { SessionSpaceDialog } from './session-space-dialog.js'
import { useInputQueue } from './use-input-queue.js'
import { useSessionOrganization } from './use-session-organization.js'
import './session-workbench.css'

/** Real first-send UI, independent of the public offline scene viewer. Drafts and pending
 * request IDs belong to their original view; late responses never navigate a newer view.
 */
export function SessionWorkbench() {
  const { search } = useNavigation(),
    query = new URLSearchParams(search)
  const primaryView = search === '' || query.has('session'),
    routeSession = query.get('session')
  const rememberedSession = useRef(routeSession)
  const sessionId = primaryView ? routeSession : rememberedSession.current
  const [retained, setRetained] = useState<string[]>([])
  const selected = sessionId ?? 'new'
  const ids = retainSessionView(retained, selected)
  useEffect(() => {
    if (primaryView) {
      rememberedSession.current = routeSession
    }
  }, [primaryView, routeSession])
  useEffect(() => {
    setRetained((prior) => retainSessionView(prior, selected))
  }, [selected])
  return ids.map((id) => (
    <div className="retained-session" key={id} data-session-view={id} hidden={id !== selected}>
      <SessionPane
        sessionId={id === 'new' ? null : id}
        active={id === selected && primaryView}
        targetMessage={id === selected ? query.get('message') : null}
      />
    </div>
  ))
}

/** Each cached pane owns its transient errors, request locks and observers. Eviction only
 * disposes presentation; accepted tasks and pending request identities remain untouched. */
function SessionPane({
  sessionId,
  active,
  targetMessage,
}: {
  sessionId: string | null
  active: boolean
  targetMessage: string | null
}) {
  const key = sessionId ?? 'new'
  const activeView = useRef(active)
  activeView.current = active
  useEffect(() => {
    activeView.current = active
    return () => {
      activeView.current = false
    }
  }, [active])
  const cache = useQueryClient()
  const drafts = useSessionDrafts((state) => state.drafts),
    update = useSessionDrafts((state) => state.update)
  const storageFailed = useSessionDrafts((state) => state.storageFailed)
  const view = useSessionViews((state) => state.views[key])
  const historyVisible = view?.panel === 'history' || Boolean(targetMessage)
  const viewStorageFailed = useSessionViews((state) => state.storageFailed)
  const updateView = useSessionViews((state) => state.update)
  const draft = drafts[key] ?? sessionDraft(key)
  const navOpen = useWorkbench((state) => state.navOpen),
    toggleNav = useWorkbench((state) => state.toggleNav)
  const textarea = useRef<HTMLTextAreaElement>(null),
    composing = useRef(false),
    busy = useRef(false)
  const activeKey = useRef(key)
  useLayoutEffect(() => {
    activeKey.current = key
    return () => {
      // Eviction invalidates presentation requests even if a new pane reuses this draft key.
      activeKey.current = ''
    }
  }, [key])
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [stopping, setStopping] = useState<StopIntent | null>(null)
  const [requestError, setRequestError] = useState<{ requestId: string; message: string } | null>(
    null,
  )
  const [renaming, setRenaming] = useState<{ session: ManagedSession; token: string } | null>(null)
  const beginRenaming = (session: ManagedSession) =>
    setRenaming({ session, token: crypto.randomUUID() })
  const [titleMenuOpen, setTitleMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [spaceToken, setSpaceToken] = useState<string | null>(null)
  useEffect(() => {
    if (!active) {
      return undefined
    }
    const openSearch = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'k' &&
        !event.isComposing
      ) {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', openSearch)
    return () => window.removeEventListener('keydown', openSearch)
  }, [active])
  useEffect(() => {
    if (!active) {
      setSearchOpen(false)
      setRenaming(null)
      setTitleMenuOpen(false)
      setSpaceToken(null)
    }
  }, [active])
  const [directoryPath, setDirectoryPath] = useState(''),
    [directoryPending, setDirectoryPending] = useState(false)
  const access = useQuery({
    queryKey: ['client-access'],
    queryFn: async ({ signal }) =>
      accessSnapshotSchema.parse(await sessionJson('/api/access', signal)),
    refetchInterval: 2000,
  })
  const authorized =
    access.data?.authenticated && access.data.client?.kind === 'desktop' && !access.isError
  const csrf = access.data?.csrf ?? ''
  const inputQueue = useInputQueue(sessionId, Boolean(authorized))
  const options = useQuery({
    queryKey: ['chat-options'],
    queryFn: async ({ signal }) =>
      sessionOptionsSchema.parse(await sessionJson('/api/chat/options', signal)),
    enabled: Boolean(authorized),
    refetchInterval: 2000,
  })
  const sessions = useQuery({
    queryKey: ['chat-sessions'],
    queryFn: async ({ signal }) =>
      sessionListSchema.parse(await sessionJson('/api/chat/sessions', signal)),
    structuralSharing: (old, next) =>
      mergeSessions(old, next, cache.getQueryData(['session-titles'])),
    enabled: Boolean(authorized),
    refetchInterval: 2000,
  })
  const catalog = useQuery({
    queryKey: ['chat-models'],
    queryFn: ({ signal }) => getModelCatalog(signal),
    enabled: Boolean(authorized),
  })
  const activity = useQuery({
    queryKey: ['chat-activity'],
    queryFn: async ({ signal }) =>
      sessionActivitySchema.parse(await sessionJson('/api/chat/activity', signal)),
    enabled: Boolean(authorized),
    refetchInterval: 1000,
  })
  const organization = useSessionOrganization(Boolean(authorized), csrf)
  const currentOrganization = organization.data?.organizations.find(
    (item) => item.sessionId === sessionId,
  )
  const current = authorized
    ? sessions.data?.sessions.find((item) => item.id === sessionId)
    : undefined
  const submissions = useQuery({
    queryKey: ['chat-submissions', sessionId],
    queryFn: async ({ signal }) =>
      submissionListSchema.parse(
        await sessionJson(
          `/api/chat/sessions/${encodeURIComponent(sessionId ?? '')}/submissions`,
          signal,
        ),
      ),
    enabled: Boolean(authorized && sessionId),
    refetchInterval: 700,
    gcTime: 0,
  })
  const activeSubmission = submissions.data?.submissions.findLast((item) =>
    ['pending', 'executing'].includes(item.status),
  )
  const project = options.data?.projects.find((item) => item.id === draft.projectId)
  const configuration = current?.configuration ?? {
    projectId: draft.projectId,
    workspaceId: project ? project.workspaceId : (draft.workspace?.id ?? null),
    model: draft.model,
    thinking: 'off' as const,
  }
  const directoryTarget = sessionId
    ? { sessionId }
    : configuration.workspaceId
      ? { workspaceId: configuration.workspaceId }
      : null
  const availability = useWorkspaceAvailability(directoryTarget, Boolean(authorized && active))
  const directoryBlocked = Boolean(
    directoryTarget && (availability.isError || availability.data?.state !== 'available'),
  )
  const locked = Boolean(
    currentOrganization?.archived ||
    organization.isError ||
    (sessionId && !currentOrganization) ||
    draft.pending ||
    pending ||
    activeSubmission ||
    directoryPending ||
    !authorized ||
    !options.isSuccess ||
    options.isError ||
    (!sessionId && Boolean(draft.projectId) && !project) ||
    (sessionId && (!current || !submissions.isSuccess)),
  )
  const providerBlocked = configuration.model.kind === 'provider'
  const sendBlocked = directoryBlocked || providerBlocked || !options.data?.localFixtureEnabled
  const refetchAccess = access.refetch
  useEffect(() => {
    if (active) {
      textarea.current?.focus()
    }
  }, [key, active])
  useEffect(() => {
    const refresh = () => {
      void refetchAccess()
    }
    window.addEventListener('piw-auth-required', refresh)
    return () => window.removeEventListener('piw-auth-required', refresh)
  }, [refetchAccess])

  const showReceipt = async (
    receipt: SessionReceipt,
    input: SessionSubmit,
    originKey: string,
    originSearch: string,
  ) => {
    const latest = sessionDraft(originKey)
    if (latest.pending?.requestId === input.requestId) {
      update(originKey, {
        pending: null,
        lastAttempt: null,
        ...(latest.text.trim() === input.text ? { text: '' } : {}),
      })
    }
    await cache.cancelQueries({ queryKey: ['chat-sessions'] })
    cache.setQueryData(['chat-sessions'], (old: unknown) => {
      const parsed = sessionListSchema.safeParse(old)
      const known = parsed.success
        ? parsed.data.sessions.find((item) => item.id === receipt.session.id)
        : undefined
      return mergeSessions(
        old,
        {
          sessions: [
            ...(parsed.success
              ? parsed.data.sessions.filter((item) => item.id !== receipt.session.id)
              : []),
            // An accepted input receipt may predate project removal. Existing index
            // metadata owns attribution; reconciling that input must not restore it.
            known && known.membershipVersion >= receipt.session.membershipVersion
              ? {
                  ...receipt.session,
                  configuration: known.configuration,
                  workspaceId: known.workspaceId,
                  cwd: known.cwd,
                  membershipVersion: known.membershipVersion,
                }
              : receipt.session,
          ],
        },
        cache.getQueryData(['session-titles']),
      )
    })
    void cache.invalidateQueries({ queryKey: ['chat-submissions', receipt.session.id] })
    if (activeView.current && activeKey.current === originKey && location.search === originSearch) {
      setNotice('任务已保存，运行状态由本地服务确认。')
      setError('')
      if (!input.sessionId) {
        navigate(`/?session=${receipt.session.id}`)
      }
    }
  }
  const send = async (retry?: SessionSubmission) => {
    if (
      busy.current ||
      (!draft.pending && (locked || sendBlocked || !(retry?.text ?? draft.text).trim()))
    ) {
      return
    }
    const originKey = key,
      originSearch = location.search
    const candidate: SessionSubmit = {
      requestId: crypto.randomUUID(),
      sessionId,
      configuration,
      text: (retry?.text ?? draft.text).trim(),
      retryOf: retry?.requestId ?? null,
    }
    const prior = draft.lastAttempt
    const input =
      draft.pending ??
      (prior &&
      JSON.stringify({ ...prior, requestId: candidate.requestId }) === JSON.stringify(candidate)
        ? prior
        : candidate)
    busy.current = true
    setPending(true)
    setError('')
    setNotice('正在保存任务…')
    setRequestError(null)
    update(originKey, { pending: input, lastAttempt: input })
    try {
      await showReceipt(await submitSession(input, csrf), input, originKey, originSearch)
    } catch (cause) {
      if (!(cause instanceof SessionRequestError) || !cause.uncertain) {
        update(originKey, { pending: null })
      }
      if (activeKey.current === originKey) {
        setRequestError({
          requestId: input.requestId,
          message: cause instanceof Error ? cause.message : '保存失败，草稿保留。',
        })
        setNotice('')
      }
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  const reconcile = async () => {
    const input = draft.pending
    if (!input || busy.current) {
      return
    }
    const originKey = key,
      originSearch = location.search
    busy.current = true
    setPending(true)
    try {
      const receipt = await findSubmission(input.requestId)
      if (receipt) {
        await showReceipt(receipt, input, originKey, originSearch)
      } else if (activeKey.current === originKey) {
        setNotice('尚未找到已保存结果。可使用原请求重试保存，不会重复创建。')
      }
    } catch (cause) {
      if (activeKey.current === originKey) {
        setError(cause instanceof Error ? cause.message : '核对失败。')
      }
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  const chooseDirectory = async (picker: boolean) => {
    if (directoryPending) {
      return
    }
    const originKey = key
    setDirectoryPending(true)
    setError('')
    try {
      const selection = picker
        ? directorySelectionSchema.parse(await window.piWorkbench?.selectDirectory())
        : { status: 'selected' as const, path: directoryPath }
      if (selection.status === 'cancelled') {
        return
      }
      if (selection.status === 'unavailable') {
        throw new Error('目录选择器不可用，请输入完整路径。')
      }
      if (!selection.path) {
        throw new Error('请输入完整目录路径。')
      }
      const result = await workspaceCommand('open', { path: selection.path }, csrf)
      if (!result.ok) {
        throw new Error(`${result.message} ${result.recovery}`)
      }
      const latest = sessionDraft(originKey)
      if (
        activeKey.current === originKey &&
        latest.projectId === draft.projectId &&
        !latest.pending
      ) {
        update(originKey, { workspace: result.workspace })
      }
    } catch (cause) {
      if (activeKey.current === originKey) {
        setError(cause instanceof Error ? cause.message : '目录校验失败。')
      }
    } finally {
      setDirectoryPending(false)
    }
  }
  const newSession = (projectId: string | null = null) => {
    useSessionDrafts.getState().newDraft(projectId)
    navigate('/')
    setError('')
    setNotice('')
    if (navOpen) {
      toggleNav()
    }
    textarea.current?.focus()
  }
  const modelOptions =
    catalog.data?.providers
      .filter(
        (provider) =>
          provider.origins.some((origin) => origin !== 'pi-sdk') ||
          provider.id === draft.model.provider,
      )
      .flatMap((provider) =>
        provider.models
          .filter((model) => model.type === 'chat')
          .map((model) => ({
            key: JSON.stringify({ kind: 'provider', provider: provider.id, model: model.id }),
            label: `${provider.name} / ${model.name} · ${provider.authentication.status === 'configured' ? '已配置' : '配置待检查'} · 未联网验证`,
          })),
      ) ?? []
  const selectedModel = JSON.stringify(configuration.model)
  const missingModel = providerBlocked && !modelOptions.some((item) => item.key === selectedModel)
  return (
    <div className="workbench-root session-workbench">
      <div className={`workspace ${navOpen ? 'nav-open' : ''}`}>
        <aside className="sidebar" aria-label="项目与会话">
          <div className="sidebar-brand">
            <span className="pi-mark">π</span>
            <strong>Pi Workbench</strong>
            <Button variant="ghost" size="icon-sm" aria-label="收起导航" onClick={toggleNav}>
              <PanelLeftIcon />
            </Button>
          </div>
          <nav className="sidebar-actions">
            <Button variant="ghost" onClick={() => newSession()}>
              <MessageSquarePlusIcon data-icon="inline-start" />
              新会话
            </Button>
            <Button variant="ghost" disabled={!authorized} onClick={() => setSearchOpen(true)}>
              <SearchIcon data-icon="inline-start" />
              搜索会话<span className="ml-auto text-xs text-muted-foreground">Ctrl+K</span>
            </Button>
            <a className={buttonVariants({ variant: 'ghost' })} href="/?workspaces">
              <FolderIcon data-icon="inline-start" />
              打开工作区
            </a>
          </nav>
          <div className="sidebar-list">
            <SessionLibrary
              sessions={authorized ? (sessions.data?.sessions ?? []) : []}
              organizations={organization.data?.organizations ?? []}
              projects={authorized ? (options.data?.projects ?? []) : []}
              activity={activity.data?.sessions ?? []}
              currentId={sessionId}
              active={active}
              available={Boolean(
                authorized &&
                options.isSuccess &&
                !options.isError &&
                sessions.isSuccess &&
                !sessions.isError &&
                organization.isSuccess &&
                !organization.isError &&
                activity.isSuccess &&
                !activity.isError,
              )}
              change={organization.change}
              rename={beginRenaming}
              csrf={csrf}
              initialWorkspace={draft.workspace}
              createdProject={(result) => {
                const latest = sessionDraft('new')
                if (
                  activeKey.current === 'new' &&
                  activeView.current &&
                  latest.projectId === draft.projectId &&
                  latest.workspace?.id === draft.workspace?.id &&
                  !latest.pending
                ) {
                  update('new', { projectId: result.id, workspace: null })
                }
              }}
              newSession={(id) => newSession(id)}
              select={(id) => {
                navigate(`/?session=${id}`)
                if (navOpen) {
                  toggleNav()
                }
              }}
            />
          </div>
          <div className="sidebar-footer">
            <a className={buttonVariants({ variant: 'ghost', size: 'sm' })} href="/?legacy">
              旧 pi 历史 · 只读
            </a>
            <a className={buttonVariants({ variant: 'ghost', size: 'sm' })} href="/?models">
              模型与提供商
            </a>
            <a
              className={buttonVariants({ variant: 'ghost' })}
              href="/?settings=appearance"
              data-settings-trigger
            >
              <SettingsIcon data-icon="inline-start" />
              设置
            </a>
            <a href="/?samples" className="sample-link">
              离线状态样本
            </a>
          </div>
        </aside>
        {navOpen ? (
          <button className="nav-scrim" aria-label="关闭导航遮罩" onClick={toggleNav} />
        ) : null}
        <main className="main-area">
          <header className="thread-header">
            <Button
              className="mobile-nav"
              variant="ghost"
              size="icon-sm"
              aria-label="展开导航"
              onClick={toggleNav}
            >
              <PanelLeftIcon />
            </Button>
            <div className="thread-identity">
              {current ? (
                <DropdownMenu open={titleMenuOpen && active} onOpenChange={setTitleMenuOpen}>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        className="thread-title-menu"
                        aria-label={`标题菜单：${current.title}`}
                      />
                    }
                  >
                    <strong>{current.title}</strong>
                    <ChevronDownIcon data-icon="inline-end" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuGroup>
                      <DropdownMenuItem onClick={() => beginRenaming(current)}>
                        <PencilIcon />
                        重命名会话
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setSpaceToken(crypto.randomUUID())}>
                        <FolderIcon />
                        执行空间与项目归属
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <strong>新会话</strong>
              )}
              <span>
                {current
                  ? `${options.data?.projects.find((item) => item.id === current.configuration.projectId)?.name ?? '无项目'} · ${current.configuration.workspaceId ? '' : '独立目录 · '}${current.cwd}`
                  : `${project?.name ?? '无项目'} · ${project?.directory ?? draft.workspace?.canonicalPath ?? '独立目录（首次发送时创建）'}`}
              </span>
            </div>
            {current && authorized ? (
              <SessionAuthorizations sessionId={current.id} csrf={csrf} active={active} />
            ) : null}
            {current ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  updateView(key, { panel: historyVisible ? 'conversation' : 'history' })
                  if (targetMessage) {
                    navigate(`/?session=${encodeURIComponent(key)}`)
                  }
                }}
              >
                {historyVisible ? '返回对话' : '历史记录'}
              </Button>
            ) : null}
          </header>
          {authorized ? (
            <section aria-label="工作区环境与恢复" className="workspace-context">
              <WorkspaceEnvironment
                recoveryHandled={directoryBlocked}
                active={active}
                cwd={
                  current?.cwd ??
                  (project ? (project.directory ?? undefined) : draft.workspace?.canonicalPath)
                }
                planned={!sessionId}
                target={
                  sessionId
                    ? { sessionId }
                    : configuration.workspaceId
                      ? { workspaceId: configuration.workspaceId }
                      : null
                }
              />
              {active ? (
                <WorkspaceSafety
                  key={JSON.stringify(directoryTarget)}
                  target={directoryTarget}
                  data={availability.data}
                  failed={availability.isError}
                  fetching={availability.isFetching}
                  csrf={csrf}
                />
              ) : null}
            </section>
          ) : null}
          <div className="conversation-workspace">
            <div className="conversation-column">
              {current && authorized && historyVisible ? (
                <SessionHistory
                  sessionId={current.id}
                  embedded
                  active={active}
                  targetMessage={targetMessage}
                />
              ) : current && authorized ? (
                <ManagedThread
                  key={current.id}
                  sessionId={current.id}
                  submissions={submissions.data?.submissions ?? []}
                  retry={(submission) => void send(submission)}
                  retryDisabled={locked || sendBlocked || submissions.isError}
                  active={active}
                  organization={currentOrganization}
                  changeOrganization={organization.change}
                  organizationAvailable={authorized && !organization.isError}
                  queue={inputQueue}
                  stop={stopping}
                  submissionsSynchronized={submissions.isSuccess && !submissions.isError}
                  csrf={csrf}
                />
              ) : (
                <div className="new-conversation new-session">
                  <h1>今天想完成什么？</h1>
                  <p>先描述任务，项目可选。首次发送后才保存会话。</p>
                  <Badge variant="outline">默认离线 · 真实模型传输关闭</Badge>
                </div>
              )}
              <div className="session-feedback" aria-live="polite">
                {!authorized ? (
                  <p>正在确认桌面授权；如未连接，请通过受管桌面入口启动。草稿可继续编辑。</p>
                ) : null}
                {sessions.isError ||
                options.isError ||
                submissions.isError ||
                organization.isError ||
                activity.isError ? (
                  <Alert>
                    <AlertTitle>本地状态未同步</AlertTitle>
                    <AlertDescription>
                      草稿保留；恢复连接后刷新核对。
                      <Button
                        variant="outline"
                        onClick={() => {
                          void sessions.refetch()
                          void options.refetch()
                          void organization.refetch()
                          void activity.refetch()
                          if (sessionId) {
                            void submissions.refetch()
                          }
                        }}
                      >
                        <RefreshCwIcon data-icon="inline-start" />
                        刷新状态
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : null}
                {currentOrganization?.archived ? (
                  <Alert>
                    <AlertTitle>此会话已归档</AlertTitle>
                    <AlertDescription>
                      历史和草稿保留；请从已归档列表恢复后继续发送。
                    </AlertDescription>
                  </Alert>
                ) : null}
                {error ||
                (requestError &&
                  !submissions.data?.submissions.some(
                    (item) => item.requestId === requestError.requestId,
                  )) ? (
                  <Alert variant="destructive">
                    <AlertTitle>任务尚未完成</AlertTitle>
                    <AlertDescription>{error || requestError?.message}</AlertDescription>
                  </Alert>
                ) : null}
                {notice ? <output aria-label="发送反馈">{notice}</output> : null}
                {storageFailed || viewStorageFailed ? (
                  <p>草稿或阅读位置存储不可用，目前仅保留在此窗口中。</p>
                ) : null}
                {draft.pending ? (
                  <div className="pending-request">
                    <p>原提交待核对，正文和配置暂时锁定。不会自动重发。</p>
                    <Button variant="outline" disabled={pending} onClick={() => void reconcile()}>
                      核对原提交
                    </Button>
                    <Button disabled={pending || !authorized} onClick={() => void send()}>
                      使用原请求重试保存
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="composer-area">
                <FieldGroup className="session-options">
                  <Field>
                    <FieldLabel htmlFor="session-project">项目</FieldLabel>
                    <select
                      id="session-project"
                      value={configuration.projectId ?? ''}
                      disabled={locked || Boolean(current)}
                      onChange={(event) =>
                        update(key, { projectId: event.target.value || null, workspace: null })
                      }
                    >
                      <option value="">无项目</option>
                      {configuration.projectId &&
                      !options.data?.projects.some(
                        (item) => item.id === configuration.projectId,
                      ) ? (
                        <option value={configuration.projectId}>
                          项目已移除或未同步 · 请重新选择
                        </option>
                      ) : null}
                      {options.data?.projects.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {item.directory ?? '独立目录'} · {item.id.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="session-model">模型</FieldLabel>
                    <select
                      id="session-model"
                      value={selectedModel}
                      disabled={locked || Boolean(current)}
                      onChange={(event) => {
                        const option = modelOptions.find((item) => item.key === event.target.value)
                        if (option) {
                          const parsed: unknown = JSON.parse(option.key)
                          const model = sessionOptionsModel(parsed)
                          update(key, { model })
                        } else {
                          update(key, {
                            model: {
                              kind: 'local-fixture',
                              provider: 'piw-offline',
                              model: 'fixture',
                            },
                          })
                        }
                      }}
                    >
                      <option
                        disabled={!options.data?.localFixtureEnabled}
                        value={JSON.stringify({
                          kind: 'local-fixture',
                          provider: 'piw-offline',
                          model: 'fixture',
                        })}
                      >
                        离线验收模型 · pi SDK 本地夹具
                      </option>
                      {missingModel ? (
                        <option value={selectedModel}>
                          所选模型当前不可用 · {configuration.model.provider} /{' '}
                          {configuration.model.model} · 未联网验证
                        </option>
                      ) : null}
                      {modelOptions.map((item) => (
                        <option key={item.key} value={item.key}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </FieldGroup>
                {!current && !project ? (
                  <details className="directory-options">
                    <summary>执行目录：{draft.workspace?.canonicalPath ?? '独立目录'}</summary>
                    <div>
                      <FieldGroup>
                        <Field>
                          <FieldLabel htmlFor="execution-path">目录绝对路径（可选）</FieldLabel>
                          <Input
                            id="execution-path"
                            value={directoryPath}
                            disabled={locked}
                            onChange={(event) => setDirectoryPath(event.target.value)}
                          />
                        </Field>
                      </FieldGroup>
                      <div className="directory-buttons">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={locked}
                          onClick={() => void chooseDirectory(true)}
                        >
                          选择文件夹
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={locked || !directoryPath.trim()}
                          onClick={() => void chooseDirectory(false)}
                        >
                          校验此目录
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={locked}
                          onClick={() => update(key, { workspace: null })}
                        >
                          使用独立目录
                        </Button>
                      </div>
                    </div>
                  </details>
                ) : null}
                {providerBlocked ? (
                  <p className="phase-note">
                    所选 pi
                    模型未联网验证，真实传输关闭；选择已保留，未调用提供商。可在模型设置中检查来源。
                  </p>
                ) : options.data?.localFixtureEnabled ? (
                  <p className="phase-note">
                    离线验收：固定样本回复，思考关闭；受限读取经宿主守卫，写入与命令未批准不执行。
                  </p>
                ) : (
                  <p className="phase-note">当前环境未启用离线验收模型；草稿保留，发送关闭。</p>
                )}
                <InputGroup className="composer-box">
                  <InputGroupTextarea
                    ref={textarea}
                    aria-label="任务内容"
                    maxLength={16000}
                    placeholder={current ? '继续当前会话…' : '描述任务，或提出一个问题…'}
                    value={draft.text}
                    readOnly={Boolean(draft.pending)}
                    onChange={(event) => update(key, { text: event.target.value })}
                    onCompositionStart={() => {
                      composing.current = true
                    }}
                    onCompositionEnd={() => {
                      composing.current = false
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Enter' &&
                        !event.shiftKey &&
                        !composing.current &&
                        !event.nativeEvent.isComposing &&
                        event.nativeEvent.keyCode !== 229
                      ) {
                        event.preventDefault()
                        if (!locked && !sendBlocked) {
                          void send()
                        }
                      }
                    }}
                  />
                  <InputGroupAddon align="block-end">
                    <span className="composer-option">
                      {current ? '当前会话' : (project?.name ?? '无项目')}
                    </span>
                    <span className="flex-1" />
                    {activeSubmission ? (
                      <Button
                        size="icon-sm"
                        variant="secondary"
                        aria-label="停止本轮"
                        disabled={
                          stopping?.requestId === activeSubmission.requestId &&
                          stopping.state === 'sending'
                        }
                        onClick={() => {
                          const originKey = key
                          setError('')
                          setRequestError(null)
                          setNotice('')
                          const intent: StopIntent = {
                            requestId: activeSubmission.requestId,
                            turnId: activeSubmission.turnId,
                            state: 'sending',
                            error: null,
                          }
                          setStopping(intent)
                          void sessionJson(
                            `/api/chat/sessions/${sessionId}/abort`,
                            undefined,
                            { requestId: activeSubmission.requestId },
                            csrf,
                          )
                            .then(() => {
                              if (activeKey.current === originKey) {
                                setStopping((prior) =>
                                  prior?.requestId === intent.requestId
                                    ? { ...intent, state: 'requested' }
                                    : prior,
                                )
                              }
                              return undefined
                            })
                            .catch((cause: unknown) => {
                              if (activeKey.current === originKey) {
                                setStopping((prior) =>
                                  prior?.requestId === intent.requestId
                                    ? {
                                        ...intent,
                                        state: 'unknown',
                                        error:
                                          cause instanceof Error
                                            ? cause.message
                                            : '停止结果待确认。',
                                      }
                                    : prior,
                                )
                              }
                            })
                        }}
                      >
                        <SquareIcon />
                      </Button>
                    ) : null}
                    <Button
                      size="icon-sm"
                      aria-label="发送任务"
                      disabled={
                        locked ||
                        sendBlocked ||
                        !draft.text.trim() ||
                        submissions.isError ||
                        sessions.isError
                      }
                      onClick={() => void send()}
                    >
                      <ArrowUpIcon />
                    </Button>
                  </InputGroupAddon>
                </InputGroup>
                {current ? (
                  <SessionInputQueue
                    query={inputQueue}
                    sessionId={current.id}
                    turnId={activeSubmission?.turnId ?? null}
                    csrf={csrf}
                    text={draft.text}
                    enabled={Boolean(
                      authorized &&
                      !directoryBlocked &&
                      !currentOrganization?.archived &&
                      !draft.pending,
                    )}
                    onQueued={(text) => {
                      // Immutable draft identity also protects A→B→A edits while a queue
                      // receipt is delayed; matching text alone is not a request version.
                      if (sessionDraft(key) === draft && draft.text.trim() === text) {
                        update(key, { text: '' })
                      }
                    }}
                  />
                ) : null}
                <div className="composer-hint">
                  <span>Enter 发送 · Shift+Enter 换行</span>
                  <span>{pending ? '正在保存…' : '费用未知 · 未调用真实提供商'}</span>
                </div>
              </div>
            </div>
          </div>
          <footer className="status-bar">
            <span>{authorized ? '桌面已授权' : '桌面授权待确认'}</span>
            <span>真实传输关闭</span>
          </footer>
        </main>
      </div>
      {renaming && active ? (
        <SessionRenameDialog
          key={renaming.token}
          session={renaming.session}
          latest={sessions.data?.sessions.find((row) => row.id === renaming.session.id)}
          csrf={csrf}
          close={() => setRenaming((row) => (row?.token === renaming.token ? null : row))}
        />
      ) : null}
      {searchOpen && active && authorized ? (
        <SessionSearchDialog
          projects={options.data?.projects ?? []}
          close={() => setSearchOpen(false)}
          select={(result) => {
            const prior = sessionView(result.sessionId)
            updateView(result.sessionId, {
              panel: result.messageId ? 'history' : 'conversation',
              cursor: null,
              historyTrail: [],
              reading: result.messageId
                ? prior.reading
                : {
                    ...prior.reading,
                    conversation: { anchor: null, offset: 0, top: 0, follow: true },
                  },
            })
            setSearchOpen(false)
            navigate(
              `/?session=${encodeURIComponent(result.sessionId)}${result.messageId ? `&message=${encodeURIComponent(result.messageId)}` : ''}`,
            )
            if (navOpen) {
              toggleNav()
            }
          }}
        />
      ) : null}
      {spaceToken && active && authorized && current ? (
        <SessionSpaceDialog
          key={spaceToken}
          sessionId={current.id}
          projects={options.data?.projects ?? []}
          projectsAvailable={Boolean(options.data) && !options.isError}
          refreshProjects={() => void options.refetch()}
          csrf={csrf}
          close={() => setSpaceToken((prior) => (prior === spaceToken ? null : prior))}
        />
      ) : null}
    </div>
  )
}

function sessionOptionsModel(value: unknown) {
  return sessionModelSchema.parse(value)
}
