// @env node
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'

/** @param {string} path */
function directoryIdentity(path) {
  const stat = lstatSync(path, { bigint: true })
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Refusing cleanup of a linked or non-directory path: ${path}`)
  }
  return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`
}

/** @param {string} parent @param {string} path */
function contains(parent, path) {
  const child = relative(parent, path)
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))
}

/**
 * Own one sibling copy for a clean verification run. Only a successful callback may
 * remove it, after evidence is saved outside the copy. Failures keep the filesystem
 * and the original error; the initial report also identifies an interrupted run.
 *
 * @param {{root: string, evidenceDirectory: string, keep?: boolean}} options
 * @param {(destination: string) => Promise<void>} verify
 */
export async function withCleanWorkspace({ root, evidenceDirectory, keep = false }, verify) {
  const source = realpathSync(root)
  const parent = dirname(source)
  const parentIdentity = directoryIdentity(parent)
  mkdirSync(evidenceDirectory, { recursive: true })
  const evidence = realpathSync(evidenceDirectory)
  const destination = mkdtempSync(join(parent, '.piw-clean-'))
  const identity = directoryIdentity(destination)
  const reportPath = join(evidence, 'clean-cleanup.json')
  const startedAt = new Date().toISOString()

  /** @param {string} verification @param {string} status @param {unknown} [error] */
  function report(verification, status, error) {
    const record = {
      destination,
      startedAt,
      updatedAt: new Date().toISOString(),
      verification,
      status,
      ...(error === undefined
        ? {}
        : { reason: error instanceof Error ? error.message : JSON.stringify(error) }),
    }
    writeFileSync(reportPath, `${JSON.stringify(record, null, 2)}\n`)
    return record
  }

  try {
    report('running', 'kept-incomplete')
    await verify(destination)
  } catch (error) {
    try {
      report('failed', 'kept-failed', error)
    } catch (reportError) {
      throw new AggregateError(
        [error, reportError],
        `Clean verification failed; copy retained at ${destination}; unable to save cleanup report`,
        { cause: reportError },
      )
    }
    throw error
  }

  if (keep) {
    return report('passed', 'kept-requested')
  }

  // Persist verification success before removal. Do not delete if saving evidence fails.
  report('passed', 'pending-cleanup')
  try {
    // Validate absolute ownership immediately before recursive deletion. No search for
    // older copies: a replacement directory or junction must remain untouched.
    if (
      !isAbsolute(destination) ||
      dirname(destination) !== parent ||
      !/^\.piw-clean-[\w-]+$/.test(basename(destination)) ||
      realpathSync(parent) !== parent ||
      directoryIdentity(parent) !== parentIdentity ||
      directoryIdentity(destination) !== identity ||
      realpathSync(destination) !== destination
    ) {
      throw new Error(`Refusing cleanup: clean workspace identity changed: ${destination}`)
    }
    if (
      contains(destination, realpathSync(source)) ||
      contains(destination, realpathSync(evidence))
    ) {
      throw new Error(`Refusing cleanup: source or evidence directory is inside ${destination}`)
    }
    rmSync(destination, { recursive: true, maxRetries: 3, retryDelay: 200 })
  } catch (error) {
    report('passed', 'cleanup-failed', error)
    throw new Error(`Clean verification passed but cleanup failed; inspect ${destination}`, {
      cause: error,
    })
  }
  return report('passed', 'removed')
}
