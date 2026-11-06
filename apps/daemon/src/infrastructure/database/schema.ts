import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const workspaceMeta = sqliteTable('workspace_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  version: integer('version').notNull().default(1),
})

// Immutable, redacted host records. Live permissions never read authority from this table.
export const operationAudit = sqliteTable(
  'operation_audit',
  {
    sequence: integer('sequence').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    kind: text('kind').notNull(),
    sessionId: text('session_id'),
    data: text('data').notNull(),
  },
  (table) => [index('operation_audit_session').on(table.sessionId, table.sequence)],
)

// Directory registry only: opening a workspace never creates a session or loads project code.
export const workspaces = sqliteTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    directoryKey: text('directory_key').notNull().unique(),
    canonicalPath: text('canonical_path').notNull(),
    name: text('name').notNull(),
    customName: text('custom_name'),
    lastOpenedAt: integer('last_opened_at'),
    revision: integer('revision').notNull().default(1),
  },
  (table) => [index('workspaces_recent_order').on(table.lastOpenedAt)],
)

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  cwd: text('cwd').notNull(),
  createdAt: integer('created_at').notNull(),
})
export const sessionRuntimes = sqliteTable('session_runtimes', {
  epoch: text('epoch').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id),
  nativeSessionId: text('native_session_id').notNull(),
  sessionFile: text('session_file').notNull(),
  source: text('source', { enum: ['real-sdk/local-fixture', 'synthetic-ipc-fixture'] }).notNull(),
  createdAt: integer('created_at').notNull(),
})
export const sessionTurns = sqliteTable('session_turns', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id),
  epoch: text('epoch')
    .notNull()
    .references(() => sessionRuntimes.epoch),
  messageId: text('message_id').notNull(),
  phase: text('phase', {
    enum: ['running', 'completed', 'aborted', 'error', 'interrupted'],
  }).notNull(),
  tools: text('tools').notNull().default('[]'),
  modelRequest: text('model_request'),
  createdAt: integer('created_at').notNull(),
})
// These are durable workbench records, not SDK message copies or active authorization grants.
export const sessionQueue = sqliteTable('session_queue', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id),
  data: text('data').notNull(),
})
export const sessionApprovals = sqliteTable('session_approvals', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id),
  data: text('data').notNull(),
})
export const sessionChanges = sqliteTable('session_changes', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id),
  data: text('data').notNull(),
})

// Resource consent is content-bound metadata, never an executable tool authorization.
export const resourceTrust = sqliteTable('resource_trust', {
  id: text('id').primaryKey(),
  data: text('data').notNull(),
})

// Organization metadata. Bindings are defaults for new sessions, never live cwd authority.
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull().unique(),
  name: text('name').notNull(),
  workspaceId: text('workspace_id').references(() => workspaces.id),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  position: integer('position').notNull().default(0),
  revision: integer('revision').notNull().default(1),
  removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
  creationInput: text('creation_input'),
})
export const sessionConfigurations = sqliteTable('session_configurations', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => sessions.id),
  creationRequestId: text('creation_request_id').notNull().unique(),
  projectId: text('project_id').references(() => projects.id),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  configuration: text('configuration').notNull(),
  title: text('title').notNull(),
  titleSource: text('title_source', { enum: ['local', 'user'] })
    .notNull()
    .default('local'),
  titleVersion: integer('title_version').notNull().default(1),
  membershipVersion: integer('membership_version').notNull().default(1),
})
// Immutable execution/artifact provenance. Project organization never rewrites this row.
export const sessionOrigins = sqliteTable('session_origins', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => sessions.id),
  kind: text('kind', { enum: ['standalone', 'workspace'] }).notNull(),
  cwd: text('cwd').notNull(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id'),
  recordedAt: integer('recorded_at').notNull(),
  provenance: text('provenance', { enum: ['created', 'legacy-observed'] }).notNull(),
})
// An outbox of accepted input, not a second committed message store. Text is cleared once
// the corresponding SDK user message has committed; its stable identity and digest remain.
export const sessionSubmissions = sqliteTable('session_submissions', {
  requestId: text('request_id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id),
  messageId: text('message_id').notNull().unique(),
  turnId: text('turn_id').notNull().unique(),
  digest: text('digest').notNull(),
  text: text('text'),
  status: text('status', {
    enum: ['pending', 'executing', 'completed', 'failed', 'aborted', 'interrupted'],
  }).notNull(),
  retryOf: text('retry_of'),
  error: text('error'),
  createdAt: integer('created_at').notNull(),
})

// Personal library metadata only; it never grants execution permission or copies messages.
export const sessionOrganization = sqliteTable('session_organization', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => sessions.id),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  manualUnread: integer('manual_unread', { mode: 'boolean' }).notNull().default(false),
  resultVersion: integer('result_version').notNull().default(0),
  readVersion: integer('read_version').notNull().default(0),
  resultRequestId: text('result_request_id'),
  revision: integer('revision').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
})

// Rebuildable presentation index only. Redaction precedes persistence; native IDs resolve
// through SessionStore, never through a caller-provided filesystem path.
export const sessionSearchDocuments = sqliteTable(
  'session_search_documents',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    messageId: text('message_id').notNull(),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    position: integer('position').notNull(),
    body: text('body').notNull(),
    folded: text('folded').notNull(),
  },
  (table) => [index('session_search_owner').on(table.sessionId)],
)
