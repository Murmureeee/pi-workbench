import type { SessionReceipt, SessionSubmission, SessionSubmit } from '@pi-workbench/shared'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpIcon,
  FolderIcon,
  MessageSquarePlusIcon,
  PanelLeftIcon,
  RefreshCwIcon,
  SettingsIcon,
  SquareIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import {
  accessSnapshotSchema,
  directorySelectionSchema,
  projectSchema,
  sessionListSchema,
  sessionModelSchema,
  sessionOptionsSchema,
  submissionListSchema,
} from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button, buttonVariants } from '@pi-workbench/ui/components/button'
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
import { workspaceCommand } from '../../services/workspace-client.js'
import { sessionDraft, useSessionDrafts } from '../../stores/session-drafts.js'
import { useWorkbench } from '../../stores/workbench.js'
import { ManagedThread } from './managed-thread.js'
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
  const sessionId = primaryView ? routeSession : rememberedSession.current,
    key = sessionId ?? 'new'
  useEffect(() => {
    if (primaryView) {
      rememberedSession.current = routeSession
    }
  }, [primaryView, routeSession])
  const cache = useQueryClient()
  const drafts = useSessionDrafts((state) => state.drafts),
    update = useSessionDrafts((state) => state.update)
  const storageFailed = useSessionDrafts((state) => state.storageFailed)
  const draft = drafts[key] ?? sessionDraft(key)
  const navOpen = useWorkbench((state) => state.navOpen),
    toggleNav = useWorkbench((state) => state.toggleNav)
  const textarea = useRef<HTMLTextAreaElement>(null),
    composing = useRef(false),
    busy = useRef(false)
  const activeKey = useRef(key)
  activeKey.current = key
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [stopping, setStopping] = useState<string | null>(null)
  const [directoryPath, setDirectoryPath] = useState(''),
    [directoryPending, setDirectoryPending] = useState(false)
  const [projectName, setProjectName] = useState(''),
    [projectOpen, setProjectOpen] = useState(false),
    [projectPending, setProjectPending] = useState(false)
  const projectRequest = useRef<string | null>(null)
  const access = useQuery({
    queryKey: ['client-access'],
    queryFn: async ({ signal }) =>
      accessSnapshotSchema.parse(await sessionJson('/api/access', signal)),
    refetchInterval: 2000,
  })
  const authorized =
    access.data?.authenticated && access.data.client?.kind === 'desktop' && !access.isError
  const csrf = access.data?.csrf ?? ''
  const options = useQuery({
    queryKey: ['chat-options'],
    queryFn: async ({ signal }) =>
      sessionOptionsSchema.parse(await sessionJson('/api/chat/options', signal)),
    enabled: Boolean(authorized),
  })
  const sessions = useQuery({
    queryKey: ['chat-sessions'],
    queryFn: async ({ signal }) =>
      sessionListSchema.parse(await sessionJson('/api/chat/sessions', signal)),
    enabled: Boolean(authorized),
    refetchInterval: 2000,
  })
  const catalog = useQuery({
    queryKey: ['chat-models'],
    queryFn: ({ signal }) => getModelCatalog(signal),
    enabled: Boolean(authorized),
  })
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
  const locked = Boolean(
    draft.pending ||
    pending ||
    activeSubmission ||
    directoryPending ||
    !authorized ||
    !options.isSuccess ||
    (sessionId && (!current || !submissions.isSuccess)),
  )
  const providerBlocked = configuration.model.kind === 'provider'
  const sendBlocked = providerBlocked || !options.data?.localFixtureEnabled
  const refetchAccess = access.refetch
  useEffect(() => {
    if (primaryView) {
      textarea.current?.focus()
    }
  }, [key, primaryView])
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
      return {
        sessions: [
          ...(parsed.success
            ? parsed.data.sessions.filter((item) => item.id !== receipt.session.id)
            : []),
          receipt.session,
        ],
      }
    })
    void cache.invalidateQueries({ queryKey: ['chat-submissions', receipt.session.id] })
    if (activeKey.current === originKey && location.search === originSearch) {
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
    update(originKey, { pending: input, lastAttempt: input })
    try {
      await showReceipt(await submitSession(input, csrf), input, originKey, originSearch)
    } catch (cause) {
      if (!(cause instanceof SessionRequestError) || !cause.uncertain) {
        update(originKey, { pending: null })
      }
      if (activeKey.current === originKey) {
        setError(cause instanceof Error ? cause.message : '保存失败，草稿保留。')
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
      if (activeKey.current === originKey && !sessionDraft(originKey).pending) {
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
  const createProject = async () => {
    if (projectPending || !projectName.trim()) {
      return
    }
    setProjectPending(true)
    setError('')
    projectRequest.current ??= crypto.randomUUID()
    try {
      const result = projectSchema.parse(
        await sessionJson(
          '/api/chat/projects',
          undefined,
          {
            requestId: projectRequest.current,
            name: projectName.trim(),
            workspaceId: draft.workspace?.id ?? null,
          },
          csrf,
        ),
      )
      await options.refetch()
      setProjectOpen(false)
      setProjectName('')
      projectRequest.current = null
      if (key === 'new' && !sessionDraft('new').pending) {
        update('new', { projectId: result.id, workspace: null })
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '项目未能保存。')
    } finally {
      setProjectPending(false)
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
            <a className={buttonVariants({ variant: 'ghost' })} href="/?workspaces">
              <FolderIcon data-icon="inline-start" />
              打开工作区
            </a>
          </nav>
          <div className="sidebar-list">
            <p className="sidebar-label">项目</p>
            {authorized
              ? options.data?.projects.map((item) => (
                  <div key={item.id}>
                    <Button
                      variant="ghost"
                      title={`${item.name} · ${item.directory ?? '独立目录'} · ${item.id}`}
                      onClick={() => newSession(item.id)}
                    >
                      {item.name}
                      <MessageSquarePlusIcon data-icon="inline-end" />
                    </Button>
                    {sessions.data?.sessions
                      .filter((session) => session.configuration.projectId === item.id)
                      .map((session) => (
                        <Button
                          key={session.id}
                          variant="ghost"
                          className="session-item"
                          aria-current={session.id === sessionId ? 'page' : undefined}
                          onClick={() => {
                            navigate(`/?session=${session.id}`)
                            if (navOpen) {
                              toggleNav()
                            }
                          }}
                        >
                          {session.title}
                        </Button>
                      ))}
                  </div>
                ))
              : null}
            <Button
              variant="ghost"
              disabled={!authorized || Boolean(draft.pending)}
              onClick={() => setProjectOpen(!projectOpen)}
            >
              新建项目
            </Button>
            {projectOpen ? (
              <div className="project-create">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="project-name">项目名称</FieldLabel>
                    <Input
                      id="project-name"
                      value={projectName}
                      disabled={projectPending}
                      maxLength={80}
                      onChange={(event) => {
                        setProjectName(event.target.value)
                        projectRequest.current = null
                      }}
                    />
                  </Field>
                </FieldGroup>
                <p>默认目录：{draft.workspace?.canonicalPath ?? '独立目录'}</p>
                <Button
                  size="sm"
                  disabled={projectPending || !projectName.trim()}
                  onClick={() => void createProject()}
                >
                  {projectPending ? '正在保存…' : '保存项目'}
                </Button>
              </div>
            ) : null}
            <p className="sidebar-label">最近 · 无项目</p>
            {authorized
              ? sessions.data?.sessions
                  .filter((item) => !item.configuration.projectId)
                  .toReversed()
                  .map((session) => (
                    <Button
                      key={session.id}
                      variant="ghost"
                      title={session.title}
                      aria-current={session.id === sessionId ? 'page' : undefined}
                      onClick={() => {
                        navigate(`/?session=${session.id}`)
                        if (navOpen) {
                          toggleNav()
                        }
                      }}
                    >
                      {session.title}
                    </Button>
                  ))
              : null}
          </div>
          <div className="sidebar-footer">
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
              <strong>{current?.title ?? '新会话'}</strong>
              <span>
                {current
                  ? `${options.data?.projects.find((item) => item.id === current.configuration.projectId)?.name ?? '无项目'} · ${current.cwd}`
                  : `${project?.name ?? '无项目'} · ${project?.directory ?? draft.workspace?.canonicalPath ?? '独立目录（首次发送时创建）'}`}
              </span>
            </div>
            {current ? (
              <a
                className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                href={`/?history=${current.id}`}
              >
                历史记录
              </a>
            ) : null}
          </header>
          <div className="conversation-workspace">
            <div className="conversation-column">
              {current && authorized ? (
                <ManagedThread
                  key={current.id}
                  sessionId={current.id}
                  submissions={submissions.data?.submissions ?? []}
                  retry={(submission) => void send(submission)}
                  retryDisabled={locked || submissions.isError}
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
                {sessions.isError || options.isError || submissions.isError ? (
                  <Alert>
                    <AlertTitle>本地状态未同步</AlertTitle>
                    <AlertDescription>
                      草稿保留；恢复连接后刷新核对。
                      <Button
                        variant="outline"
                        onClick={() => {
                          void sessions.refetch()
                          void options.refetch()
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
                {error ? (
                  <Alert variant="destructive">
                    <AlertTitle>任务尚未完成</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
                {notice ? <output aria-label="发送反馈">{notice}</output> : null}
                {storageFailed ? <p>草稿存储不可用，目前仅保留在此窗口中。</p> : null}
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
                  <p className="phase-note">离线验收：固定样本回复，思考关闭，不执行工具或扩展。</p>
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
                        disabled={stopping === activeSubmission.requestId}
                        onClick={() => {
                          const originKey = key
                          setStopping(activeSubmission.requestId)
                          void sessionJson(
                            `/api/chat/sessions/${sessionId}/abort`,
                            undefined,
                            { requestId: activeSubmission.requestId },
                            csrf,
                          )
                            .catch((cause: unknown) => {
                              if (activeKey.current === originKey) {
                                setError(
                                  cause instanceof Error ? cause.message : '停止结果待确认。',
                                )
                              }
                            })
                            .finally(() => setStopping(null))
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
    </div>
  )
}

function sessionOptionsModel(value: unknown) {
  return sessionModelSchema.parse(value)
}
