import type { WorkspaceDatabase } from '../../infrastructure/database/database.js'
import type { SecurityService } from '../security/security.service.js'
import type { SessionService } from '../sessions/session.service.js'
import type { SessionStore } from '../sessions/session.store.js'
import type { ProjectService } from '../workspaces/project.service.js'
import type {
  SessionSearchPage,
  SessionSearchQuery,
  SessionSearchResult,
} from '@pi-workbench/shared'

import { HttpException } from '@nestjs/common'
import { and, desc, eq, sql } from 'drizzle-orm'

import { sessionSearchDocuments } from '../../infrastructure/database/schema.js'

function fold(text: string) {
  return text.normalize('NFKC').toLowerCase()
}
function snippet(text: string, query: string) {
  // Redaction already ran on the entire text. Slice by code points after finding the literal
  // match, so a credential spanning the snippet edge can never become a visible suffix.
  const points = Array.from(text.replace(/\s+/gu, ' '))
  const found = fold(points.join('')).indexOf(query)
  const start = Math.max(0, Array.from(points.join('').slice(0, Math.max(0, found))).length - 45)
  return `${start ? '…' : ''}${points.slice(start, start + 180).join('')}${points.length > start + 180 ? '…' : ''}`
}

/** Rebuildable, redacted SQLite search projection; never an execution or message authority.
 * Refreshes changed native sources before querying, validates a second source stamp before
 * committing, and reads organization/title/project/activity directly from their owners.
 * Restart invalidates all source stamps. No queries are persisted or logged. */
export class SearchService {
  private readonly indexed = new Map<string, { stamp: string; incomplete: boolean }>()
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly store: SessionStore,
    private readonly sessions: SessionService,
    private readonly projects: ProjectService,
    private readonly security: SecurityService,
  ) {}

  search(input: SessionSearchQuery): SessionSearchPage {
    const managed = this.store.managedSessions()
    const ids = new Set(managed.map((row) => row.id))
    for (const row of this.database.db
      .select({ sessionId: sessionSearchDocuments.sessionId })
      .from(sessionSearchDocuments)
      .all()) {
      if (!ids.has(row.sessionId)) {
        this.database.db
          .delete(sessionSearchDocuments)
          .where(eq(sessionSearchDocuments.sessionId, row.sessionId))
          .run()
        this.indexed.delete(row.sessionId)
      }
    }
    for (const session of managed) {
      const stamp = `${this.security.redactor.revision}:${this.store.searchStamp(session.id)}`
      if (this.indexed.get(session.id)?.stamp === stamp) {
        continue
      }
      let source: ReturnType<SessionStore['searchSource']>
      try {
        source = this.store.searchSource(session.id)
      } catch {
        throw new HttpException('搜索索引暂不可用，请刷新后重试；历史原件保留。', 503)
      }
      if (stamp !== `${this.security.redactor.revision}:${this.store.searchStamp(session.id)}`) {
        throw new HttpException('历史正在变化，请刷新搜索；未返回混合版本结果。', 409)
      }
      this.database.db.transaction((tx) => {
        tx.delete(sessionSearchDocuments)
          .where(eq(sessionSearchDocuments.sessionId, session.id))
          .run()
        for (const message of source.messages) {
          const body = this.security.redactor.text(message.text, message.incomplete)
          tx.insert(sessionSearchDocuments)
            .values({
              id: `${session.id}/${message.id}`,
              sessionId: session.id,
              messageId: message.id,
              role: message.role,
              position: message.position,
              body,
              folded: fold(body),
            })
            .run()
        }
      })
      this.indexed.set(session.id, { stamp, incomplete: source.incomplete })
    }
    const query = fold(input.q)
    const organizations = this.store.organizations(),
      activity = this.sessions.activity(),
      projects = this.projects.list()
    const rows: SessionSearchResult[] = []
    for (const session of managed) {
      if (input.session && input.session !== session.id) {
        continue
      }
      const meta = organizations.find((row) => row.sessionId === session.id)
      const archived = meta?.archived ?? false
      const projectId = session.configuration.projectId
      if (
        (input.archive === 'active' && archived) ||
        (input.archive === 'archived' && !archived) ||
        (input.project === 'none' && projectId !== null) ||
        (input.project !== 'all' && input.project !== 'none' && projectId !== input.project)
      ) {
        continue
      }
      const live = activity.find((row) => row.id === session.id)
      const last = this.store.searchActivity(session.id)
      const state = live?.approvals
        ? 'approval'
        : live?.running
          ? 'running'
          : live?.held
            ? 'held'
            : last &&
                (last.status === 'completed' ||
                  last.status === 'failed' ||
                  last.status === 'aborted' ||
                  last.status === 'interrupted')
              ? last.status
              : 'idle'
      const updatedAt = Math.max(session.createdAt, meta?.updatedAt ?? 0, last?.createdAt ?? 0)
      if (
        (input.state !== 'all' && state !== input.state) ||
        (input.from !== undefined && updatedAt < input.from) ||
        (input.to !== undefined && updatedAt > input.to)
      ) {
        continue
      }
      const title = this.security.redactor.text(session.title)
      const titleHit = query && fold(title).includes(query)
      const bodyHits =
        (query && !titleHit) || input.mode === 'messages'
          ? this.database.db
              .select()
              .from(sessionSearchDocuments)
              .where(
                and(
                  eq(sessionSearchDocuments.sessionId, session.id),
                  sql`instr(${sessionSearchDocuments.folded}, ${query}) > 0`,
                ),
              )
              .orderBy(desc(sessionSearchDocuments.position))
              .all()
          : []
      if (
        (query && !titleHit && !bodyHits.length) ||
        (input.mode === 'messages' && !bodyHits.length)
      ) {
        continue
      }
      const project = projects.find((row) => row.id === projectId)
      for (const bodyHit of input.mode === 'messages' ? bodyHits : [bodyHits[0]]) {
        rows.push({
          sessionId: session.id,
          title,
          projectId,
          projectName: project?.name ?? '无项目',
          projectDirectory: project?.directory ?? null,
          updatedAt,
          state,
          archived,
          match:
            input.mode === 'messages'
              ? bodyHit!.role
              : !query
                ? 'recent'
                : titleHit
                  ? 'title'
                  : bodyHit!.role,
          messageId: bodyHit?.messageId ?? null,
          snippet: snippet(bodyHit?.body ?? title, query),
        })
      }
    }
    rows.sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId))
    return {
      results: rows.slice((input.page - 1) * input.limit, input.page * input.limit),
      total: rows.length,
      page: input.page,
      limit: input.limit,
      incompleteSessions: managed.filter((row) => this.indexed.get(row.id)?.incomplete).length,
    }
  }
}
