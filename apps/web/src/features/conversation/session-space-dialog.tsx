import type { Project, SessionSpace } from '@pi-workbench/shared'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDownIcon } from 'lucide-react'
import { type RefObject, useId, useRef, useState } from 'react'

import { managedSessionSchema, sessionListSchema, sessionSpaceSchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button } from '@pi-workbench/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pi-workbench/ui/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@pi-workbench/ui/components/dropdown-menu'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@pi-workbench/ui/components/field'

import { sessionJson, SessionRequestError } from '../../services/session-client.js'
import { mergeSessions } from '../../services/session-title-cache.js'

/** Session-keyed inspection owns no execution. Closing/eviction cancels only its query;
 * a late mutation may update its original cache but never navigate or alter another draft. */
export function SessionSpaceDialog({
  sessionId,
  projects,
  projectsAvailable,
  refreshProjects,
  csrf,
  close,
}: {
  sessionId: string
  projects: Project[]
  projectsAvailable: boolean
  refreshProjects: () => void
  csrf: string
  close: () => void
}) {
  const busy = useRef(false)
  const space = useQuery({
    queryKey: ['session-space', sessionId],
    queryFn: async ({ signal }) => {
      const result = sessionSpaceSchema.parse(
        await sessionJson(`/api/chat/sessions/${encodeURIComponent(sessionId)}/space`, signal),
      )
      if (result.sessionId !== sessionId) {
        throw new Error('执行空间身份不匹配，请重新核对。')
      }
      return result
    },
    gcTime: 0,
    retry: false,
    refetchInterval: (query) => (query.state.status === 'error' ? false : 2000),
  })
  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (!open && busy.current) {
          details.cancel()
        } else if (!open) {
          close()
        }
      }}
    >
      <DialogContent showCloseButton={false} className="session-space-dialog sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>执行空间与项目归属</DialogTitle>
          <DialogDescription>项目用于分组；实际执行目录与文件来源独立保存。</DialogDescription>
        </DialogHeader>
        {space.isError ? (
          <Alert variant="destructive">
            <AlertTitle>执行空间未同步</AlertTitle>
            <AlertDescription>
              <p>保留原会话与文件，请恢复连接后核对。</p>
              <Button variant="outline" onClick={() => void space.refetch()}>
                重新核对执行空间
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {!projectsAvailable ? (
          <Alert variant="destructive">
            <AlertTitle>项目列表未同步</AlertTitle>
            <AlertDescription>
              <p>归属选择已保留，核对项目列表后才能保存。</p>
              <Button variant="outline" onClick={refreshProjects}>
                重新核对项目列表
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {space.data ? (
          <SpaceDetails
            space={space.data}
            projects={projects}
            csrf={csrf}
            busy={busy}
            available={!space.isError && projectsAvailable}
            close={close}
          />
        ) : !space.isError ? (
          <output>正在核对执行空间…</output>
        ) : null}
        {!space.data ? (
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              返回会话
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/** Editing pins the initial membership version and selected target revision. Polls may show
 * newer state but never rebase a user's choice. Lost responses require explicit inspection. */
function SpaceDetails({
  space,
  projects,
  csrf,
  busy,
  available,
  close,
}: {
  space: SessionSpace
  projects: Project[]
  csrf: string
  busy: RefObject<boolean>
  available: boolean
  close: () => void
}) {
  const cache = useQueryClient(),
    id = useId()
  const [version, setVersion] = useState(space.membershipVersion)
  const [selected, setSelected] = useState<Project | null | undefined>(() =>
    space.projectId ? projects.find((row) => row.id === space.projectId) : null,
  )
  const [pending, setPending] = useState(false),
    [error, setError] = useState('')
  const [selectOpen, setSelectOpen] = useState(false)
  const conflict = version !== space.membershipVersion
  const targetChanged =
    selected &&
    !projects.some((row) => row.id === selected.id && row.revision === selected.revision)
  const changed = selected !== undefined && (selected?.id ?? null) !== space.projectId
  const save = async () => {
    if (busy.current || !available || conflict || targetChanged || !changed) {
      return
    }
    busy.current = true
    setPending(true)
    setError('')
    try {
      const result = managedSessionSchema.parse(
        await sessionJson(
          `/api/chat/sessions/${encodeURIComponent(space.sessionId)}/project`,
          undefined,
          {
            expectedVersion: version,
            project: selected ? { id: selected.id, revision: selected.revision } : null,
          },
          csrf,
        ),
      )
      if (result.id !== space.sessionId) {
        throw new SessionRequestError('归属回执身份无效，请核对原会话。', true)
      }
      await cache.cancelQueries({ queryKey: ['chat-sessions'] })
      cache.setQueryData(['chat-sessions'], (old: unknown) => {
        const list = sessionListSchema.safeParse(old)
        return mergeSessions(
          old,
          {
            sessions: [
              ...(list.success ? list.data.sessions.filter((row) => row.id !== result.id) : []),
              result,
            ],
          },
          cache.getQueryData(['session-titles']),
        )
      })
      void cache.invalidateQueries({ queryKey: ['chat-sessions'] })
      void cache.invalidateQueries({ queryKey: ['session-search'] })
      void cache.invalidateQueries({ queryKey: ['session-space', space.sessionId] })
      close()
    } catch (cause) {
      setError(
        cause instanceof SessionRequestError && cause.uncertain
          ? '保存结果待核对，选择已保留；不会自动重试。请重新核对执行空间。'
          : cause instanceof Error
            ? cause.message
            : '归属未能保存，选择保留。',
      )
      void cache.invalidateQueries({ queryKey: ['session-space', space.sessionId] })
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return (
    <>
      <div className="session-space-body">
        {!available ? <Badge variant="outline">上次核对 · 当前未同步</Badge> : null}
        <section aria-label="执行与来源">
          <Badge variant="outline">{space.standalone ? '持久独立目录' : '已绑定工作区'}</Badge>
          <dl>
            <dt>当前归属</dt>
            <dd>
              {space.projectId
                ? (projects.find((row) => row.id === space.projectId)?.name ??
                  `项目待核对 · ${space.projectId.slice(0, 8)}`)
                : '无项目'}
            </dd>
            <dt>实际执行目录</dt>
            <dd aria-label="执行空间实际目录">{space.cwd}</dd>
            <dt>{space.origin.provenance === 'created' ? '创建时来源' : '旧会话迁移时观察'}</dt>
            <dd aria-label="执行空间原始来源">
              {space.origin.cwd}
              <br />
              项目 ID：{space.origin.projectId ?? '无项目'}
            </dd>
          </dl>
          <p>
            目录和已有产物在退出后保留。仅调整项目归属不会搬移文件、改变
            cwd、载入目标项目指令或授予权限。
          </p>
          {space.origin.provenance === 'legacy-observed' ? (
            <p>旧记录缺少完整创建来源，以上仅为迁移时观察，不推断原始项目。</p>
          ) : null}
        </section>
        <section aria-label="会话能力来源">
          <strong>能力与权限来源</strong>
          <p>
            宿主离线策略：工具、命令和扩展关闭；未授予外部目录或网络工具权限，真实模型传输关闭。
          </p>
          <p>
            只检查实际 cwd 和显式全局 pi
            目录，不继承其他项目。资源信任仅允许匹配指纹的上下文文本，不授予执行权限。
          </p>
          <p>本轮已绑定 {space.activeContextCount} 项文本快照；修改或撤销从下一轮生效。</p>
          {space.resources.length ? (
            <ul>
              {space.resources.map((resource) => (
                <li key={resource.id}>
                  <span>
                    {resource.origin === 'user'
                      ? '显式全局来源'
                      : resource.origin === 'project'
                        ? '当前执行目录来源'
                        : '第三方声明来源'}{' '}
                    · {resource.kind}
                  </span>
                  <span>{resource.path}</span>
                  <span>{resource.source}</span>
                  <span>
                    {resource.loadedNow
                      ? '当前轮已加载'
                      : resource.enabledNextTurn
                        ? '已确认，下轮可加载（当前未加载）'
                        : resource.capability === 'disabled'
                          ? '能力关闭，未加载'
                          : '未确认或已变化，未加载'}
                  </span>
                  {resource.diagnostic ? <span>{resource.diagnostic}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>未发现当前目录或显式全局资源。</p>
          )}
          {space.diagnostics.map((diagnostic) => (
            <p key={diagnostic}>{diagnostic}</p>
          ))}
        </section>
        <FieldGroup>
          <Field>
            <FieldLabel id={id}>仅调整项目归属</FieldLabel>
            <DropdownMenu open={selectOpen} onOpenChange={setSelectOpen}>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" aria-labelledby={id} disabled={pending || !available} />
                }
              >
                {selected === undefined
                  ? '请选择项目归属'
                  : selected
                    ? `${selected.name} · ${selected.id.slice(0, 8)}`
                    : '无项目'}
                <ChevronDownIcon data-icon="inline-end" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup
                  value={selected?.id ?? ''}
                  onValueChange={(value) => {
                    setSelected(value ? projects.find((row) => row.id === value) : null)
                    setSelectOpen(false)
                  }}
                >
                  <DropdownMenuRadioItem value="">无项目</DropdownMenuRadioItem>
                  {projects.map((project) => (
                    <DropdownMenuRadioItem key={project.id} value={project.id}>
                      {project.name} · {project.directory ?? '独立目录'} · {project.id.slice(0, 8)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <FieldDescription>
              保存仅改变侧栏分组与搜索归属，后台任务继续使用原执行空间。
            </FieldDescription>
          </Field>
        </FieldGroup>
        {conflict || targetChanged ? (
          <Alert>
            <AlertTitle>归属或目标项目已更新</AlertTitle>
            <AlertDescription>
              <p>选择已保留；请核对当前归属和目标后明确继续。</p>
              <Button
                variant="outline"
                disabled={pending || !available}
                onClick={() => {
                  setVersion(space.membershipVersion)
                  setSelected((prior) =>
                    prior === null ? null : projects.find((row) => row.id === prior?.id),
                  )
                  setError('')
                }}
              >
                使用最新版本继续整理
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>归属保存待核对</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={pending} onClick={close}>
          返回会话
        </Button>
        <Button
          disabled={pending || !available || !changed || conflict || Boolean(targetChanged)}
          onClick={() => void save()}
        >
          {pending ? '正在保存…' : '确认仅调整归属'}
        </Button>
      </DialogFooter>
    </>
  )
}
