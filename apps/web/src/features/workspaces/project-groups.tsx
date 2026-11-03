import type { Project, ProjectCommand, Workspace } from '@pi-workbench/shared'
import type { ReactNode } from 'react'

import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  MessageSquarePlusIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  XIcon,
} from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { projectSchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@pi-workbench/ui/components/alert-dialog'
import { Button } from '@pi-workbench/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@pi-workbench/ui/components/dropdown-menu'
import { Field, FieldLabel } from '@pi-workbench/ui/components/field'
import { Input } from '@pi-workbench/ui/components/input'

import { sessionJson } from '../../services/session-client.js'
import { useWorkbench } from '../../stores/workbench.js'
import { ProjectEditor } from './project-editor.js'

/** Sidebar grouping is presentation only. Search matches project names/paths/IDs locally;
 * expanding a group never starts a session or changes execution state. */
export function ProjectGroups({
  projects,
  active,
  available,
  csrf,
  newSession,
  rows,
  initialWorkspace,
  created,
}: {
  projects: Project[]
  active: boolean
  available: boolean
  csrf: string
  newSession: (id: string) => void
  rows: (id: string) => ReactNode
  initialWorkspace: Workspace | null
  created: (project: Project) => void
}) {
  const groupId = useId()
  const cache = useQueryClient(),
    busy = useRef(false)
  const query = useWorkbench((state) => state.projectQuery),
    setQuery = useWorkbench((state) => state.setProjectQuery)
  const collapsed = useWorkbench((state) => state.collapsedProjects),
    toggle = useWorkbench((state) => state.toggleProject)
  const [editing, setEditing] = useState<{ project: Project | null; token: string } | null>(null)
  const [removing, setRemoving] = useState<Project | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (!active) {
      setEditing(null)
      setRemoving(null)
    }
  }, [active])
  const removeLatest = projects.find((item) => item.id === removing?.id)
  const removeConflict = Boolean(
    removing && removeLatest && removing.revision !== removeLatest.revision,
  )
  const change = async (project: Project, command: Exclude<ProjectCommand, { action: 'edit' }>) => {
    if (busy.current) {
      return
    }
    busy.current = true
    setPending(true)
    setError('')
    try {
      const saved = projectSchema.parse(
        await sessionJson(`/api/chat/projects/${project.id}`, undefined, command, csrf),
      )
      if (saved.id !== project.id) {
        throw new Error('项目回执身份无效，请核对最新列表。')
      }
      if (mounted.current && command.action === 'remove') {
        setRemoving(null)
      }
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : '项目整理结果待核对，请刷新列表。')
      }
    } finally {
      busy.current = false
      if (mounted.current) {
        setPending(false)
      }
      void cache.invalidateQueries({ queryKey: ['chat-options'] })
      void cache.invalidateQueries({ queryKey: ['chat-sessions'] })
    }
  }
  const term = query.trim().toLocaleLowerCase()
  const visible = projects.filter((project) =>
    `${project.name}\n${project.directory ?? ''}\n${project.id}`.toLocaleLowerCase().includes(term),
  )
  return (
    <section aria-label="项目分组">
      <div className="library-heading">
        <span className="sidebar-label">项目</span>
        <Button
          variant="ghost"
          size="sm"
          disabled={!available}
          onClick={() => setEditing({ project: null, token: crypto.randomUUID() })}
        >
          <PlusIcon data-icon="inline-start" />
          新建项目
        </Button>
      </div>
      <Field className="project-search">
        <FieldLabel className="sr-only" htmlFor={`${groupId}-search`}>
          检索项目名称或路径
        </FieldLabel>
        <Input
          id={`${groupId}-search`}
          value={query}
          placeholder="搜索项目名称或路径"
          onChange={(event) => setQuery(event.target.value)}
        />
      </Field>
      <p
        className="phase-note"
        title="新建在未置顶组末尾；切换置顶进入目标组末尾；检索不改变完整组的排序。"
      >
        置顶优先 · 组内手动排序
      </p>
      {error && !removing ? (
        <Alert variant="destructive">
          <AlertTitle>项目整理待核对</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {projects.length ? null : <p className="phase-note">项目用于整理会话，也可以不绑定目录。</p>}
      {projects.length && !visible.length ? (
        <p className="phase-note">
          没有匹配的项目。
          <Button variant="ghost" size="sm" onClick={() => setQuery('')}>
            清除检索
          </Button>
        </p>
      ) : null}
      {visible.map((project) => (
        <section
          key={project.id}
          data-project-id={project.id}
          aria-label={`项目 ${project.name} · ${project.id.slice(0, 8)}`}
        >
          <div className="project-group-heading">
            <Button
              variant="ghost"
              className="project-group-toggle"
              aria-expanded={!collapsed[project.id]}
              aria-controls={`${groupId}-${project.id}`}
              onClick={() => toggle(project.id)}
            >
              {collapsed[project.id] ? (
                <ChevronRightIcon data-icon="inline-start" />
              ) : (
                <ChevronDownIcon data-icon="inline-start" />
              )}
              <span className="truncate">{project.name}</span>
              {project.pinned ? <PinIcon data-icon="inline-end" aria-label="已置顶项目" /> : null}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`项目新会话：${project.name} · ${project.id.slice(0, 8)}`}
              disabled={!available}
              onClick={() => newSession(project.id)}
            >
              <MessageSquarePlusIcon />
            </Button>
            <ProjectMenu
              project={project}
              active={active}
              available={available && !pending}
              edit={() => setEditing({ project, token: crypto.randomUUID() })}
              canUp={projects.find((row) => row.pinned === project.pinned)?.id !== project.id}
              canDown={projects.findLast((row) => row.pinned === project.pinned)?.id !== project.id}
              change={(command) => void change(project, command)}
              remove={() => {
                setRemoving(project)
                setError('')
              }}
            />
          </div>
          <p
            className="project-location"
            title={`${project.directory ?? '独立目录'} · ${project.id}`}
          >
            <FolderIcon aria-hidden="true" />
            <span>
              {project.directory ?? '独立目录'} · {project.id.slice(0, 8)}
            </span>
          </p>
          <div id={`${groupId}-${project.id}`} hidden={Boolean(collapsed[project.id])}>
            {rows(project.id)}
          </div>
        </section>
      ))}
      {editing && active ? (
        <ProjectEditor
          key={editing.token}
          project={editing.project}
          latest={projects.find((project) => project.id === editing.project?.id)}
          initialWorkspace={initialWorkspace}
          csrf={csrf}
          close={() => setEditing(null)}
          created={created}
        />
      ) : null}
      {removing && active ? (
        <AlertDialog
          open
          onOpenChange={(open, details) => {
            if (!open && busy.current) {
              details.cancel()
            } else if (!open) {
              setRemoving(null)
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>移除项目分组</AlertDialogTitle>
              <AlertDialogDescription>
                “{removing.name}
                ”将解散，其会话回到“无项目”。文件、会话、实际执行目录和权限保留，后台任务继续运行。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <p className="text-xs text-muted-foreground">
              {removing.directory ?? '独立目录'} · {removing.id}
            </p>
            {removeConflict && removeLatest ? (
              <Alert>
                <AlertTitle>项目已更新</AlertTitle>
                <AlertDescription>
                  最新：{removeLatest.name} · {removeLatest.directory ?? '独立目录'}
                  。请核对后再确认。
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => setRemoving(removeLatest)}
                  >
                    使用最新版本继续移除
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>移除结果待核对</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <AlertDialogFooter>
              <Button variant="outline" disabled={pending} onClick={() => setRemoving(null)}>
                取消
              </Button>
              <Button
                disabled={!available || pending || removeConflict || !removeLatest}
                onClick={() =>
                  void change(removing, { action: 'remove', expectedRevision: removing.revision })
                }
              >
                {pending ? '正在保存…' : '确认移除分组'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </section>
  )
}

function ProjectMenu({
  project,
  active,
  available,
  edit,
  canUp,
  canDown,
  change,
  remove,
}: {
  project: Project
  active: boolean
  available: boolean
  edit: () => void
  canUp: boolean
  canDown: boolean
  change: (command: Exclude<ProjectCommand, { action: 'edit' }>) => void
  remove: () => void
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!active) {
      setOpen(false)
    }
  }, [active])
  return (
    <DropdownMenu open={open && active} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!available}
            aria-label={`项目菜单：${project.name} · ${project.id.slice(0, 8)}`}
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={edit}>
            <PencilIcon />
            编辑项目
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              change({ action: 'pin', pinned: !project.pinned, expectedRevision: project.revision })
            }
          >
            {project.pinned ? <PinOffIcon /> : <PinIcon />}
            {project.pinned ? '取消项目置顶' : '置顶项目'}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canUp}
            onClick={() =>
              change({ action: 'move', direction: 'up', expectedRevision: project.revision })
            }
          >
            <ArrowUpIcon />
            上移项目
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canDown}
            onClick={() =>
              change({ action: 'move', direction: 'down', expectedRevision: project.revision })
            }
          >
            <ArrowDownIcon />
            下移项目
          </DropdownMenuItem>
          <DropdownMenuItem onClick={remove}>
            <XIcon />
            移除项目分组
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
