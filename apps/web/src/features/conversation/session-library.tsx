import type {
  ManagedSession,
  Project,
  SessionOrganization,
  SessionOrganize,
  Workspace,
} from '@pi-workbench/shared'

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  MailIcon,
  MailOpenIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  SquareIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { submissionListSchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@pi-workbench/ui/components/alert-dialog'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button } from '@pi-workbench/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@pi-workbench/ui/components/dropdown-menu'

import { sessionJson } from '../../services/session-client.js'
import { useWorkbench } from '../../stores/workbench.js'
import { ProjectGroups } from '../workspaces/project-groups.js'

type Activity = { id: string; running: boolean; approvals: number; held: number }
type Change = (id: string, command: SessionOrganize) => Promise<SessionOrganization>

/** Library organization never owns execution state. Stopping and archive are two explicit
 * actions, with daemon confirmation between them; cached/hidden panes own no open portals. */
export function SessionLibrary({
  sessions,
  organizations,
  projects,
  activity,
  currentId,
  active,
  available,
  change,
  rename,
  select,
  newSession,
  initialWorkspace,
  createdProject,
  csrf,
}: {
  sessions: ManagedSession[]
  organizations: SessionOrganization[]
  projects: Project[]
  activity: Activity[]
  currentId: string | null
  active: boolean
  available: boolean
  change: Change
  rename: (session: ManagedSession) => void
  select: (id: string) => void
  newSession: (id: string) => void
  initialWorkspace: Workspace | null
  createdProject: (project: Project) => void
  csrf: string
}) {
  const filter = useWorkbench((state) => state.sessionListFilter)
  const setFilter = useWorkbench((state) => state.setSessionListFilter)
  const [archiveId, setArchiveId] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [stopped, setStopped] = useState(false)
  useEffect(() => {
    if (!active) {
      setArchiveId(null)
    }
  }, [active])
  const ordered = sessions.toSorted(
    (a, b) =>
      (organizations.find((row) => row.sessionId === b.id)?.updatedAt ?? b.createdAt) -
        (organizations.find((row) => row.sessionId === a.id)?.updatedAt ?? a.createdAt) ||
      a.id.localeCompare(b.id),
  )
  const meta = (id: string) => organizations.find((row) => row.sessionId === id)
  const visible = ordered.filter(
    (session) => Boolean(meta(session.id)?.archived) === (filter === 'archived'),
  )
  const target = archiveId ? sessions.find((row) => row.id === archiveId) : undefined
  const targetMeta = archiveId ? meta(archiveId) : undefined
  const targetActivity = activity.find((row) => row.id === archiveId)
  const busy = targetActivity?.running || targetActivity?.approvals || targetActivity?.held
  const apply = async (id: string, input: SessionOrganize) => {
    if (pending) {
      return
    }
    setPending(id)
    setError('')
    try {
      await change(id, input)
      if (input.action === 'archive') {
        setArchiveId(null)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '整理未保存，请刷新核对。')
    } finally {
      setPending(null)
    }
  }
  const rows = (items: ManagedSession[]) =>
    items.map((session) => (
      <SessionLibraryRow
        key={session.id}
        session={session}
        organization={meta(session.id)}
        activity={activity.find((row) => row.id === session.id)}
        selected={session.id === currentId}
        available={available && !pending}
        active={active}
        select={() => select(session.id)}
        change={(command) => void apply(session.id, command)}
        rename={() => rename(session)}
        archive={() => {
          setArchiveId(session.id)
          setStopped(false)
          setError('')
        }}
      />
    ))
  return (
    <>
      <div className="library-heading">
        <span className="sidebar-label">会话</span>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={filter === 'archived'}
          onClick={() => setFilter(filter === 'archived' ? 'active' : 'archived')}
        >
          <ArchiveIcon data-icon="inline-start" />
          {filter === 'archived' ? '返回会话' : '已归档'}
        </Button>
      </div>
      {!available ? (
        <output className="phase-note">列表状态待同步，整理操作暂不可用。</output>
      ) : null}
      {error && !archiveId ? (
        <Alert variant="destructive">
          <AlertTitle>整理未保存</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {filter === 'archived' ? (
        <section aria-label="已归档会话">
          <p className="sidebar-label">已归档 · 可恢复</p>
          {rows(visible)}
          {visible.length ? null : <p className="phase-note">没有已归档会话。</p>}
        </section>
      ) : (
        <>
          {visible.some((row) => meta(row.id)?.pinned) ? (
            <section aria-label="已置顶会话">
              <p className="sidebar-label">已置顶</p>
              {rows(visible.filter((row) => meta(row.id)?.pinned))}
            </section>
          ) : null}
          <ProjectGroups
            projects={projects}
            active={active}
            available={available}
            csrf={csrf}
            newSession={newSession}
            initialWorkspace={initialWorkspace}
            created={createdProject}
            rows={(id) =>
              rows(
                visible.filter(
                  (row) => !meta(row.id)?.pinned && row.configuration.projectId === id,
                ),
              )
            }
          />
          <section aria-label="最近无项目会话">
            <p className="sidebar-label">最近 · 无项目</p>
            {rows(visible.filter((row) => !meta(row.id)?.pinned && !row.configuration.projectId))}
            {visible.length ? null : <p className="phase-note">首次发送后，会话显示在这里。</p>}
          </section>
        </>
      )}
      <AlertDialog
        open={Boolean(archiveId && active)}
        onOpenChange={(open) => {
          if (!open && !pending) {
            setArchiveId(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {targetMeta?.archived ? '恢复会话' : busy ? '先处理任务，再归档' : '归档会话'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {target?.title}：
              {targetMeta?.archived
                ? '恢复到会话列表；不会启动任务或恢复旧审批。'
                : busy
                  ? '会话仍有真实运行或待处理任务。停止操作需要单独确认，等服务确认结束后才能归档；不会仅隐藏任务。'
                  : '将移到已归档列表，可随时恢复；历史、草稿和文件保留，不再接受新发送。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {targetActivity?.approvals || targetActivity?.held ? (
            <p className="phase-note">
              待审批 {targetActivity.approvals} · 待处理 {targetActivity.held}
              。请先在对应流程处理；本页不会自动裁决或丢弃。
            </p>
          ) : null}
          {stopped ? (
            <output>
              {busy
                ? '已请求停止，正在等待服务确认；确认归档需再次点击。'
                : '服务已确认任务结束；确认归档需再次点击。'}
            </output>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>操作待核对</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(pending)}>取消</AlertDialogCancel>
            {targetActivity?.running && target ? (
              <Button
                disabled={!available || Boolean(pending) || stopped}
                onClick={() => {
                  const id = target.id
                  setPending(id)
                  setError('')
                  void sessionJson(`/api/chat/sessions/${id}/submissions`)
                    .then(async (value) => {
                      const task = submissionListSchema
                        .parse(value)
                        .submissions.findLast((row) =>
                          ['pending', 'executing'].includes(row.status),
                        )
                      if (!task) {
                        throw new Error('没有可停止的当前任务，请刷新实际状态。')
                      }
                      await sessionJson(
                        `/api/chat/sessions/${id}/abort`,
                        undefined,
                        { requestId: task.requestId },
                        csrf,
                      )
                      setStopped(true)
                      return undefined
                    })
                    .catch((cause: unknown) =>
                      setError(cause instanceof Error ? cause.message : '停止结果待确认。'),
                    )
                    .finally(() => setPending(null))
                }}
              >
                <SquareIcon data-icon="inline-start" />
                停止当前任务
              </Button>
            ) : null}
            <Button
              disabled={
                !available ||
                Boolean(pending) ||
                !targetMeta ||
                (!targetMeta.archived && Boolean(busy))
              }
              onClick={() => {
                if (targetMeta) {
                  void apply(targetMeta.sessionId, {
                    action: 'archive',
                    archived: !targetMeta.archived,
                    expectedRevision: targetMeta.revision,
                  })
                }
              }}
            >
              {pending ? '正在保存…' : targetMeta?.archived ? '确认恢复' : '确认归档'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function SessionLibraryRow({
  session,
  organization,
  activity,
  selected,
  available,
  active,
  select,
  change,
  archive,
  rename,
}: {
  session: ManagedSession
  organization: SessionOrganization | undefined
  activity: Activity | undefined
  selected: boolean
  available: boolean
  active: boolean
  select: () => void
  change: (command: SessionOrganize) => void
  archive: () => void
  rename: () => void
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!active) {
      setOpen(false)
    }
  }, [active])
  const status = [
    activity?.running ? '运行中' : '',
    activity?.approvals ? `待审批 ${activity.approvals}` : '',
    activity?.held ? `待处理 ${activity.held}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="session-library-row" data-library-session={session.id}>
      <Button
        variant="ghost"
        className="session-library-select"
        title={session.title}
        aria-current={selected ? 'page' : undefined}
        onClick={select}
      >
        <span className="session-title">{session.title}</span>
        {status ? <span className="session-activity">{status}</span> : null}
        {organization?.unread ? <Badge variant="secondary">未读</Badge> : null}
      </Button>
      <DropdownMenu open={open && active} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`会话菜单：${session.title}`}
              disabled={!available || !organization}
            />
          }
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={rename}>
              <PencilIcon />
              重命名会话
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                organization &&
                change({
                  action: 'pin',
                  pinned: !organization.pinned,
                  expectedRevision: organization.revision,
                })
              }
            >
              {organization?.pinned ? <PinOffIcon /> : <PinIcon />}
              {organization?.pinned ? '取消置顶' : '置顶会话'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                organization &&
                change(
                  organization.unread
                    ? {
                        action: 'read',
                        throughVersion: organization.resultVersion,
                        expectedRevision: organization.revision,
                      }
                    : { action: 'unread', expectedRevision: organization.revision },
                )
              }
            >
              {organization?.unread ? <MailOpenIcon /> : <MailIcon />}
              {organization?.unread ? '标记已读' : '标记未读'}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={archive}>
              {organization?.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
              {organization?.archived ? '恢复会话' : '归档会话'}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
