/* oxlint-disable no-await-in-loop -- Each physical ancestor must be proven before descending into the next. */
import type { Stats } from 'node:fs'

import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

/** The same private-path and portable-spelling rules used by the final tool guard.
 * These predicates alone do not prove physical containment or grant another root. */
export const isCredentialPath = (path: string) =>
  /(?:^|[\\/])(?:\.env(?:\..*)?|auth\.json|credentials?(?:\..*)?|id_(?:rsa|ed25519)|\.ssh|\.aws|\.gnupg|\.git)(?:$|[\\/])/i.test(
    path,
  )
export const isStrictlyWithin = (root: string, target: string) => {
  const r = relative(root, target)
  return r !== '' && !r.startsWith('..' + sep) && r !== '..' && !isAbsolute(r)
}
export const isAmbiguousPath = (path: string) =>
  path.length === 0 ||
  /[\p{Cc}\p{Cf}]/u.test(path) ||
  /^(?:\\\\|\/\/)|^[A-Za-z]:(?![\\/])/.test(path) ||
  /[:<>"|?*]/.test(path.replace(/^[A-Za-z]:[\\/]/, '')) ||
  path
    .split(/[\\/]/)
    .some(
      (part) =>
        /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:[ .]|$)/i.test(part) ||
        (part !== '.' && part !== '..' && /[ .]$/.test(part)),
    )
export const fileIdentity = (s: Stats) => [s.dev, s.ino, s.birthtimeMs].join(':')
const fileStamp = (s: Stats) => [fileIdentity(s), s.size, s.mtimeMs, s.ctimeMs, s.nlink].join(':')

/** Async ancestor proof for registered canonical roots. No links, hard-linked files,
 * special files, private names or alternate Win32 spellings. Call again after IO and
 * compare stamps; this is a conservative observation, not an OS sandbox or path lock. */
export async function proveFilePath(root: string, path: string) {
  if (
    isCredentialPath(root) ||
    (path && (isCredentialPath(path) || isAmbiguousPath(path))) ||
    isAbsolute(path) ||
    path.split(/[\\/]/).some((p) => p === '..')
  ) {
    throw new Error('文件路径超出已授权范围，或属于私密／歧义路径。')
  }
  const parts = path ? path.split(/[\\/]/) : []
  let current = root
  const chain: string[] = []
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
      throw new Error('链接、非普通文件或目录身份无法核验；未读取目标。')
    }
    chain.push(fileIdentity(stat))
  }
  return { absolute: current, stat, chain: chain.join('|'), stamp: fileStamp(stat) }
}
