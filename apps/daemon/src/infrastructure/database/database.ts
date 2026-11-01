// @env node
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import { acquireDataLease } from './data-lease.js'
import { workspaceMeta } from './schema.js'

export class WorkspaceDatabase {
  readonly sqlite: Database.Database
  readonly db: ReturnType<typeof drizzle>
  private readonly releaseLease: () => void
  private closed = false
  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true })
    this.releaseLease = acquireDataLease(dataDir)
    try {
      this.sqlite = new Database(join(dataDir, 'workbench.sqlite'))
    } catch (error) {
      this.releaseLease()
      throw error
    }
    this.db = drizzle(this.sqlite)
    try {
      this.sqlite.pragma('journal_mode = WAL')
      this.sqlite.pragma('synchronous = FULL')
      this.sqlite.pragma('foreign_keys = ON')
      this.sqlite.pragma('busy_timeout = 3000')
      migrate(this.db, {
        migrationsFolder: fileURLToPath(new URL('../../../migrations/', import.meta.url)),
      })
      this.db
        .insert(workspaceMeta)
        .values({ key: 'storage-format', value: 'core-06-index-v1' })
        .onConflictDoUpdate({ target: workspaceMeta.key, set: { value: 'core-06-index-v1' } })
        .run()
    } catch (error) {
      this.sqlite.close()
      this.releaseLease()
      throw error
    }
  }

  close(): void {
    if (!this.closed) {
      this.closed = true
      this.sqlite.close()
      this.releaseLease()
    }
  }
}
