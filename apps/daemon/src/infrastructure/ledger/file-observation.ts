/* oxlint-disable no-await-in-loop -- Each bounded descriptor read advances a single file offset. */
import type { FileObservation } from '@pi-workbench/shared'

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export const fileKey = (path: string) => createHash('sha256').update(path).digest('hex')
const stamp = (s: Awaited<ReturnType<typeof lstat>>) =>
  [s.dev, s.ino, s.birthtimeMs, s.size, s.mtimeMs, s.ctimeMs, s.nlink].join(':')

/** Observation only: never grants permission, follows links, changes files or reads an
 * arbitrary client path. Call strictly after final-policy physical-target validation.
 * Exact descriptors and bounded allocation detect unstable reads; OS races remain possible. */
async function observeFileNow(
  cwd: string,
  path: string,
): Promise<{
  observation: FileObservation
  bytes: Buffer | null
}> {
  const full = resolve(cwd, path),
    sub = relative(cwd, full)
  if (!sub || sub === '..' || sub.startsWith(`..${sep}`) || isAbsolute(sub)) {
    throw new Error('文件观察目标不属于轮次目录。')
  }
  const components = sub.split(sep)
  const ancestors = [
    cwd,
    ...components.slice(0, -1).map((_part, i) => resolve(cwd, ...components.slice(0, i + 1))),
  ]
  const identities = await Promise.all(
    ancestors.map(async (p) => {
      const s = await lstat(p)
      if (!s.isDirectory() || s.isSymbolicLink() || (await realpath(p)) !== p) {
        throw new Error('文件观察目录身份变化。')
      }
      return [p, s.dev, s.ino, s.birthtimeMs] as const
    }),
  )
  const recheck = () =>
    Promise.all(
      identities.map(async ([p, dev, ino, birth]) => {
        const s = await lstat(p)
        if (
          !s.isDirectory() ||
          s.isSymbolicLink() ||
          s.dev !== dev ||
          s.ino !== ino ||
          s.birthtimeMs !== birth ||
          (await realpath(p)) !== p
        ) {
          throw new Error('文件观察后目录身份变化。')
        }
      }),
    )
  let before
  try {
    before = await lstat(full)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      await recheck()
      return { observation: { status: 'missing', sha256: null }, bytes: null }
    }
    throw error
  }
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size > 5 * 1024 * 1024 ||
    (await realpath(full)) !== full
  ) {
    throw new Error('文件观察排除链接、非普通文件或超过5 MiB的内容。')
  }
  const handle = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  const bytes = Buffer.alloc(before.size)
  try {
    if (stamp(await handle.stat()) !== stamp(before)) {
      throw new Error('文件观察身份已变化。')
    }
    let offset = 0
    while (offset < bytes.length) {
      const chunk = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!chunk.bytesRead) {
        throw new Error('文件观察读取不完整。')
      }
      offset += chunk.bytesRead
    }
    if (stamp(await handle.stat()) !== stamp(before)) {
      throw new Error('文件观察期间内容变化。')
    }
  } finally {
    await handle.close()
  }
  if ((await realpath(full)) !== full || stamp(await lstat(full)) !== stamp(before)) {
    throw new Error('文件观察后身份变化。')
  }
  await recheck()
  return {
    observation: { status: 'ready', sha256: createHash('sha256').update(bytes).digest('hex') },
    bytes,
  }
}

const reading = new Set<string>()
/** A timed-out OS read keeps its slot until it actually finishes. Its late result never
 * replaces the unavailable observation, and another probe cannot accumulate behind it. */
export async function observeFile(cwd: string, path: string) {
  const key = `${cwd}\0${path}`
  if (reading.has(key)) {
    throw new Error('旧文件观察尚未结束。')
  }
  reading.add(key)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      observeFileNow(cwd, path).finally(() => reading.delete(key)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('文件观察超过3秒限额。')), 3000)
        timer.unref()
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
