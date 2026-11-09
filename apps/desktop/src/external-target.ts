/* oxlint-disable no-await-in-loop -- Physical ancestors are checked in order, without following a substituted directory. */
import type { ExternalTarget } from '@pi-workbench/shared'
import type { Stats } from 'node:fs'

import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { externalTargetSchema, systemOpenAllowed } from '@pi-workbench/shared'

export class ExternalOpenError extends Error {}
const identity = (s: Stats) => [s.dev, s.ino, s.birthtimeMs].join(':')
export const externalStamp = (s: Stats) =>
  [identity(s), s.size, s.mtimeMs, s.ctimeMs, s.nlink].join(':')

/** Main's final check of a short-lived, private daemon proof. This does not authorize a
 * new root or make opening by another application's pathname atomic against OS changes. */
export async function verifyExternalTarget(value: ExternalTarget): Promise<string> {
  const q = externalTargetSchema.parse(value)
  const validTime = () => q.expiresAt >= Date.now() && q.expiresAt <= Date.now() + 7000
  if (
    !validTime() ||
    !isAbsolute(q.root) ||
    isAbsolute(q.path) ||
    q.path.split(/[\\/]/).some((p) => p === '..') ||
    /[\p{Cc}\p{Cf}]/u.test(q.root + q.path)
  ) {
    throw new ExternalOpenError('打开目标证明无效或已过期；请刷新后重试。')
  }
  let current = q.root
  const parts = q.path ? q.path.split(/[\\/]/) : [],
    chain: string[] = []
  let stat = await lstat(current)
  for (let i = 0; i <= parts.length; i++) {
    if (i) {
      current = join(current, parts[i - 1]!)
      stat = await lstat(current)
    }
    if (
      stat.isSymbolicLink() ||
      (await realpath(current)) !== current ||
      (i < parts.length && !stat.isDirectory()) ||
      (!stat.isFile() && !stat.isDirectory()) ||
      (stat.isFile() && stat.nlink !== 1)
    ) {
      throw new ExternalOpenError('目标物理路径或链接状态已变化；请从授权目录重新选择。')
    }
    chain.push(identity(stat))
  }
  if (
    chain.join('|') !== q.chain ||
    externalStamp(stat) !== q.stamp ||
    stat.isDirectory() !== (q.kind === 'directory') ||
    !validTime()
  ) {
    throw new ExternalOpenError('目标文件或目录已变化；未打开旧目标，请刷新后重试。')
  }
  if (q.action === 'system' && (q.kind !== 'file' || !systemOpenAllowed(current))) {
    throw new ExternalOpenError('此类型不提供系统关联打开；可选择 IDE 或文件管理器。')
  }
  return current
}

/** Fixed recovery reasons only: native error strings may include unredacted paths or
 * full argv, so they never cross the sandbox or enter renderer diagnostics. */
export function externalFailure(error: unknown): string {
  if (error instanceof ExternalOpenError) {
    return error.message
  }
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'ENOENT') {
      return '文件、目录或目标程序不存在；请刷新或重新选择程序。'
    }
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      return '当前用户权限不足；请检查访问权限或选择其它程序。'
    }
  }
  return '外部打开未完成；请刷新目标、重新选择程序或恢复自动发现后重试。'
}
