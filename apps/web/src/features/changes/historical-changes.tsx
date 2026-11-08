/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The bounded Diff scroll surface needs keyboard focus for horizontal and vertical scrolling. */
import type { ChangeFile } from '@pi-workbench/shared'

import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { XIcon } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'

import { changeDiffSchema, changeReviewSchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button } from '@pi-workbench/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@pi-workbench/ui/components/dialog'

import { sessionJson } from '../../services/session-client.js'
import { ChangeCoveragePanel } from './change-coverage.js'
import { sourceLabel } from './change-labels.js'
import { ReviewDecisions } from './review-decisions.js'
import { RollbackActions } from './rollback-actions.js'
import { RollbackAvailability } from './rollback-availability.js'
import './historical-changes.css'

const kindLabel = {
  added: '新增',
  modified: '修改',
  deleted: '删除',
  renamed: '重命名（字节一致）',
}
const counts = (file: ChangeFile) =>
  file.binary
    ? '二进制／非UTF-8 · 行数未知'
    : `+${file.additions ?? '未知'} −${file.deletions ?? '未知'}`

/** Actual session-owned historical review. Wide layout shares conversation space; narrow
 * layout uses the existing accessible Dialog as a closable drawer. */
export function HistoricalChanges({
  sessionId,
  turnId,
  fileId,
  close,
  selectFile,
}: {
  sessionId: string
  turnId: string
  fileId: string | null
  close: () => void
  selectFile: (id: string) => void
}) {
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 1200px)').matches)
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const media = matchMedia('(max-width: 1200px)')
    const update = () => setNarrow(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (!narrow) {
      closeButton.current?.focus()
    }
  }, [narrow, turnId])
  useEffect(() => {
    if (narrow) {
      return undefined
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [narrow, close])
  const header = (
    <>
      {narrow ? <DialogTitle>轮次修改审查</DialogTitle> : <strong>轮次修改审查</strong>}
      <Button
        ref={closeButton}
        size="icon-sm"
        variant="ghost"
        aria-label="关闭修改审查"
        onClick={close}
      >
        <XIcon />
      </Button>
    </>
  )
  const body = (
    <ReviewBody
      key={`${sessionId}:${turnId}`}
      sessionId={sessionId}
      turnId={turnId}
      fileId={fileId}
      selectFile={selectFile}
    />
  )
  return narrow ? (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          close()
        }
      }}
    >
      <DialogContent
        className="historical-change-drawer"
        showCloseButton={false}
        initialFocus={closeButton}
        finalFocus={false}
      >
        <header>{header}</header>
        <DialogDescription>历史文件版本与明确回滚；关闭后返回原对话，任务继续。</DialogDescription>
        {body}
      </DialogContent>
    </Dialog>
  ) : (
    <aside aria-label="轮次修改审查" className="historical-change-panel">
      <header>{header}</header>
      {body}
    </aside>
  )
}

function ReviewBody({
  sessionId,
  turnId,
  fileId,
  selectFile,
}: {
  sessionId: string
  turnId: string
  fileId: string | null
  selectFile: (id: string) => void
}) {
  const list = useInfiniteQuery({
    queryKey: ['change-review', sessionId, turnId],
    retry: false,
    gcTime: 0,
    initialPageParam: 0,
    queryFn: async ({ signal, pageParam }) => {
      const page = changeReviewSchema.parse(
        await sessionJson(
          `/api/changes/review?${new URLSearchParams({ sessionId, turnId, offset: String(pageParam) })}`,
          signal,
        ),
      )
      if (page.sessionId !== sessionId || page.turnId !== turnId) {
        throw new Error('历史文件列表身份不一致。')
      }
      return page
    },
    getNextPageParam: (page) => page.next,
  })
  const page = !list.isError ? list.data?.pages[0] : undefined
  const diff = useQuery({
    queryKey: ['change-diff', sessionId, turnId, fileId],
    enabled: Boolean(fileId && page?.available),
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const value = changeDiffSchema.parse(
        await sessionJson(
          `/api/changes/diff?${new URLSearchParams({ sessionId, turnId, fileId: fileId ?? '' })}`,
          signal,
        ),
      )
      if (
        value.sessionId !== sessionId ||
        value.turnId !== turnId ||
        value.fileId !== fileId ||
        value.baselineReference !== page?.baselineReference ||
        value.finalReference !== page.finalReference
      ) {
        throw new Error('历史Diff身份或版本不一致；请重新核对。')
      }
      return value
    },
  })
  const files = list.data?.pages.flatMap((p) => p.files) ?? []
  const selected = !diff.isError && diff.data?.fileId === fileId ? diff.data : undefined
  return (
    <div className="historical-change-body">
      <section className="historical-change-scope" aria-label="审查轮次身份">
        <p>轮次 {turnId}</p>
        <p>写入前基线 → 该轮收尾；内容已脱敏。</p>
        {page?.baselineReference ? <p>基线 {page.baselineReference}</p> : null}
        {page?.finalReference ? <p>收尾 {page.finalReference}</p> : null}
        <p>
          仅处理文件字节；排除项、ACL、空目录及命令外部副作用不在此范围。回滚需要预检与本次明确确认。
        </p>
      </section>
      {list.isPending ? <output>正在核对历史文件版本…</output> : null}
      <ChangeCoveragePanel sessionId={sessionId} turnId={turnId} />
      {list.isError ? (
        <Alert variant="destructive">
          <AlertTitle>历史文件列表未同步</AlertTitle>
          <AlertDescription>
            {list.error.message}
            <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
              重试历史文件列表
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {page?.diagnostic ? (
        <Alert>
          <AlertTitle>本轮差异不可用</AlertTitle>
          <AlertDescription>{page.diagnostic}</AlertDescription>
        </Alert>
      ) : null}
      {page?.available && page.total === 0 ? <output>本轮无文件变更</output> : null}
      {page?.available ? <p>{page.total} 个文件变更</p> : null}
      {page?.available && page.baselineReference && page.finalReference ? (
        <ReviewDecisions
          sessionId={sessionId}
          turnId={turnId}
          fileId={fileId}
          baselineReference={page.baselineReference}
          finalReference={page.finalReference}
        />
      ) : null}
      {page?.available && page.total > 0 ? (
        <RollbackAvailability sessionId={sessionId} turnId={turnId} />
      ) : null}
      {page?.available && page.total > 0 ? (
        <RollbackActions
          key={`round:${sessionId}:${turnId}`}
          sessionId={sessionId}
          turnId={turnId}
          fileId={null}
        />
      ) : null}
      <ul aria-label="轮次文件列表" className="historical-change-files">
        {files.map((file) => (
          <li key={file.id}>
            <Button
              variant="ghost"
              className="historical-change-file"
              aria-pressed={fileId === file.id}
              onClick={() => selectFile(file.id)}
              aria-label={`审查文件 ${file.path}`}
            >
              <span>
                {file.previousPath ? `${file.previousPath} → ` : ''}
                {file.path}
              </span>
              <span>
                {kindLabel[file.kind]} · {counts(file)}
              </span>
              <Badge variant="outline">{sourceLabel[file.source]}</Badge>
            </Button>
          </li>
        ))}
      </ul>
      {list.hasNextPage ? (
        <Button
          variant="outline"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          加载更多轮次文件
        </Button>
      ) : null}
      {fileId && diff.isPending && page?.available ? <output>正在读取所选历史Diff…</output> : null}
      {diff.isError ? (
        <Alert variant="destructive">
          <AlertTitle>历史Diff未同步</AlertTitle>
          <AlertDescription>
            {diff.error.message}
            <Button size="sm" variant="outline" onClick={() => void diff.refetch()}>
              重试历史Diff
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {selected ? (
        <section aria-label="所选文件历史Diff" className="historical-file-diff">
          <strong>{selected.file.path}</strong>
          <RollbackActions
            key={`${sessionId}:${turnId}:${selected.file.id}`}
            sessionId={sessionId}
            turnId={turnId}
            fileId={selected.file.id}
          />
          <p>
            {kindLabel[selected.file.kind]} · {counts(selected.file)} · {selected.file.beforeBytes}{' '}
            → {selected.file.afterBytes} 字节
          </p>
          <Badge variant="secondary">{sourceLabel[selected.file.source]}</Badge>
          {selected.file.reasons.map((reason) => (
            <p key={reason}>{reason}</p>
          ))}
          {selected.file.tools.map((tool) => (
            <p key={tool.id}>
              工具 {tool.tool} · 调用 {tool.callId} ·{' '}
              {tool.confirmed ? '工具字节区段已确认' : '来源不确定'}
            </p>
          ))}
          {selected.diagnostic ? <output>{selected.diagnostic}</output> : null}
          <section tabIndex={0} aria-label="历史Diff正文" className="historical-diff-scroll">
            <table>
              <thead>
                <tr>
                  <th>旧行</th>
                  <th>新行</th>
                  <th>差异内容</th>
                </tr>
              </thead>
              <tbody>
                {selected.hunks.map((hunk) => (
                  <Fragment key={hunk.header}>
                    <tr>
                      <td colSpan={3}>{hunk.header}</td>
                    </tr>
                    {hunk.lines.map((line) => (
                      <tr key={line.id} data-change-line={line.kind}>
                        <td>{line.oldLine ?? ''}</td>
                        <td>{line.newLine ?? ''}</td>
                        <td>
                          <code>
                            {line.kind === 'add' ? '+' : line.kind === 'delete' ? '−' : ' '}
                            {line.text}
                          </code>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </section>
        </section>
      ) : page?.total ? (
        <p>选择文件查看该轮历史Diff。</p>
      ) : null}
    </div>
  )
}
