// @env node
import { fork } from 'node:child_process'
import { once } from 'node:events'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { withCleanWorkspace } from './clean-workspace.mjs'

let fixture = ''
let root = ''
let evidenceDirectory = ''

function cleanupReport() {
  /** @type {unknown} */
  const record = JSON.parse(readFileSync(join(evidenceDirectory, 'clean-cleanup.json'), 'utf8'))
  if (
    !record ||
    typeof record !== 'object' ||
    !('destination' in record) ||
    typeof record.destination !== 'string' ||
    !('startedAt' in record) ||
    typeof record.startedAt !== 'string' ||
    !('updatedAt' in record) ||
    typeof record.updatedAt !== 'string' ||
    !('verification' in record) ||
    typeof record.verification !== 'string' ||
    !('status' in record) ||
    typeof record.status !== 'string'
  ) {
    throw new Error('Invalid clean cleanup report')
  }
  const reason = 'reason' in record ? record.reason : undefined
  if (reason !== undefined && typeof reason !== 'string') {
    throw new Error('Invalid clean cleanup failure reason')
  }
  return {
    destination: record.destination,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    verification: record.verification,
    status: record.status,
    ...(reason === undefined ? {} : { reason }),
  }
}

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'piw-cleanup-test-'))
  root = join(fixture, 'project')
  evidenceDirectory = join(root, '.workbench', 'evidence')
  mkdirSync(root)
  writeFileSync(join(root, 'source.txt'), 'original source')
})

afterEach(() => {
  // Only the absolute temp fixture created by this test owns its copies and junctions.
  if (resolve(fixture) !== fixture || !fixture.startsWith(join(tmpdir(), 'piw-cleanup-test-'))) {
    throw new Error(`Unexpected test fixture: ${fixture}`)
  }
  rmSync(fixture, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
})

describe('clean verification copy lifecycle', () => {
  it('removes only the successful copy after keeping its evidence in the original project', async () => {
    const olderCopy = mkdtempSync(join(fixture, '.piw-clean-'))
    writeFileSync(join(olderCopy, 'keep.txt'), 'older failure')
    const report = await withCleanWorkspace({ root, evidenceDirectory }, async (destination) => {
      expect(cleanupReport()).toMatchObject({ verification: 'running', status: 'kept-incomplete' })
      mkdirSync(join(destination, 'node_modules'))
      writeFileSync(join(destination, 'node_modules', 'installed.txt'), 'installed')
      writeFileSync(join(evidenceDirectory, 'clean-workspace.json'), 'verification evidence')
    })

    expect(report).toMatchObject({ verification: 'passed', status: 'removed' })
    expect(existsSync(report.destination)).toBe(false)
    expect(cleanupReport()).toEqual(report)
    expect(readFileSync(join(evidenceDirectory, 'clean-workspace.json'), 'utf8')).toBe(
      'verification evidence',
    )
    expect(readFileSync(join(root, 'source.txt'), 'utf8')).toBe('original source')
    expect(readFileSync(join(olderCopy, 'keep.txt'), 'utf8')).toBe('older failure')
    expect(readdirSync(fixture)).toHaveLength(2)
    expect(readdirSync(fixture)).toContain(basename(olderCopy))
  })

  it('keeps a failed copy and the original error with diagnostic evidence', async () => {
    const failure = new Error('frozen install failed')
    await expect(
      withCleanWorkspace({ root, evidenceDirectory }, async (destination) => {
        writeFileSync(join(destination, 'partial.txt'), 'failed install')
        throw failure
      }),
    ).rejects.toBe(failure)

    const report = cleanupReport()
    expect(report).toMatchObject({
      verification: 'failed',
      status: 'kept-failed',
      reason: 'frozen install failed',
    })
    expect(readFileSync(join(report.destination, 'partial.txt'), 'utf8')).toBe('failed install')
  })

  it('keeps a successful copy when explicitly requested', async () => {
    const report = await withCleanWorkspace(
      { root, evidenceDirectory, keep: true },
      async (destination) => {
        writeFileSync(join(destination, 'inspect.txt'), 'manual comparison')
      },
    )
    expect(report).toMatchObject({ verification: 'passed', status: 'kept-requested' })
    expect(readFileSync(join(report.destination, 'inspect.txt'), 'utf8')).toBe('manual comparison')
    expect(cleanupReport()).toEqual(report)
  })

  it('leaves the copy and initial report when the verification process is killed', async () => {
    const runner = join(root, 'interrupted.mjs')
    writeFileSync(
      runner,
      `import { withCleanWorkspace } from ${JSON.stringify(new URL('./clean-workspace.mjs', import.meta.url).href)}
import process from 'node:process'
process.on('message', () => {})
await withCleanWorkspace(${JSON.stringify({ root, evidenceDirectory })}, async (destination) => {
  process.send(destination)
  await new Promise(() => {})
})
`,
    )
    const child = fork(runner, { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true })
    let output = ''
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    const closed = once(child, 'close')
    try {
      /** @type {unknown[]} */
      const message = await Promise.race([
        once(child, 'message'),
        closed.then(() => {
          throw new Error(`Verification process exited before starting: ${output}`)
        }),
      ])
      const destination = message[0]
      expect(cleanupReport()).toMatchObject({
        destination,
        verification: 'running',
        status: 'kept-incomplete',
      })
    } finally {
      child.kill('SIGKILL')
      await closed
    }
    expect(existsSync(cleanupReport().destination)).toBe(true)
    expect(readFileSync(join(root, 'source.txt'), 'utf8')).toBe('original source')
  })

  it('does not create a copy when the evidence path cannot be initialized', async () => {
    writeFileSync(join(root, 'blocked'), 'a file cannot hold evidence')
    await expect(
      withCleanWorkspace(
        { root, evidenceDirectory: join(root, 'blocked', 'evidence') },
        async () => {
          throw new Error('verification must not start')
        },
      ),
    ).rejects.toThrow(/EEXIST|ENOTDIR/)
    expect(readdirSync(fixture)).toEqual(['project'])
  })

  it('refuses to remove a directory substituted at the same path', async () => {
    await expect(
      withCleanWorkspace({ root, evidenceDirectory }, async (destination) => {
        renameSync(destination, join(fixture, 'moved-copy'))
        mkdirSync(destination)
        writeFileSync(join(destination, 'foreign.txt'), 'replacement directory')
      }),
    ).rejects.toThrow('cleanup failed')

    const report = cleanupReport()
    expect(report).toMatchObject({
      verification: 'passed',
      status: 'cleanup-failed',
    })
    expect(report.reason).toContain('identity changed')
    expect(readFileSync(join(report.destination, 'foreign.txt'), 'utf8')).toBe(
      'replacement directory',
    )
    expect(existsSync(join(fixture, 'moved-copy'))).toBe(true)
  })

  it('refuses a root junction and preserves its external target', async () => {
    const target = join(fixture, 'external')
    mkdirSync(target)
    writeFileSync(join(target, 'keep.txt'), 'external files')
    await expect(
      withCleanWorkspace({ root, evidenceDirectory }, async (destination) => {
        renameSync(destination, join(fixture, 'moved-copy'))
        symlinkSync(target, destination, 'junction')
      }),
    ).rejects.toThrow('cleanup failed')

    expect(cleanupReport()).toMatchObject({
      status: 'cleanup-failed',
    })
    expect(cleanupReport().reason).toContain('linked or non-directory')
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('external files')
    expect(existsSync(join(fixture, 'moved-copy'))).toBe(true)
  })

  it('unlinks nested dependency junctions without deleting their targets', async () => {
    const store = join(fixture, 'dependency-store')
    mkdirSync(store)
    writeFileSync(join(store, 'package.txt'), 'shared dependency')
    const report = await withCleanWorkspace({ root, evidenceDirectory }, async (destination) => {
      mkdirSync(join(destination, 'node_modules'))
      symlinkSync(store, join(destination, 'node_modules', 'dependency'), 'junction')
    })

    expect(report.status).toBe('removed')
    expect(existsSync(report.destination)).toBe(false)
    expect(readFileSync(join(store, 'package.txt'), 'utf8')).toBe('shared dependency')
  })

  it('keeps the copy if evidence is redirected inside it during verification', async () => {
    await expect(
      withCleanWorkspace({ root, evidenceDirectory }, async (destination) => {
        mkdirSync(join(destination, 'evidence'))
        renameSync(evidenceDirectory, join(root, 'saved-evidence'))
        symlinkSync(join(destination, 'evidence'), evidenceDirectory, 'junction')
        writeFileSync(join(evidenceDirectory, 'result.txt'), 'preserve verification results')
      }),
    ).rejects.toThrow('cleanup failed')

    expect(cleanupReport()).toMatchObject({
      status: 'cleanup-failed',
    })
    expect(cleanupReport().reason).toContain('source or evidence directory is inside')
    expect(readFileSync(join(evidenceDirectory, 'result.txt'), 'utf8')).toBe(
      'preserve verification results',
    )
  })
})
