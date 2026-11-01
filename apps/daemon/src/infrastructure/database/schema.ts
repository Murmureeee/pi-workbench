import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const workspaceMeta = sqliteTable('workspace_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  version: integer('version').notNull().default(1),
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
