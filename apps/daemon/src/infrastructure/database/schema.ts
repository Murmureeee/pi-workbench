import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const workspaceMeta = sqliteTable('workspace_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  version: integer('version').notNull().default(1),
})

// Directory registry only: opening a workspace never creates a session or loads project code.
export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  directoryKey: text('directory_key').notNull().unique(),
  canonicalPath: text('canonical_path').notNull(),
  name: text('name').notNull(),
})

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

// Minimal project identity/binding for first-send selection; organization follows WS-06.
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull().unique(),
  name: text('name').notNull(),
  workspaceId: text('workspace_id').references(() => workspaces.id),
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
