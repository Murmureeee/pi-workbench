import type { TrustResource } from '@pi-workbench/shared'

import { createHash } from 'node:crypto'
import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
} from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'

import { z } from 'zod'

const maxFile = 65536,
  maxTree = 2 * 1024 * 1024,
  maxEntries = 512
const contexts = ['AGENTS.override.md', 'AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD']
const settingsSchema = z.object({
  extensions: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  prompts: z.array(z.string()).optional(),
  themes: z.array(z.string()).optional(),
  packages: z.array(z.union([z.string(), z.looseObject({ source: z.string() })])).optional(),
})
const impacts = {
  context: '确认后，当前内容可作为后续轮次的模型参考文本；其中的指令不能授予工具权限。',
  extension: '原生扩展 import 即可执行本地 Node 代码并访问文件或网络；当前运行时禁止加载。',
  script: '脚本或安装动作可执行命令并修改系统；信任不等于命令审批，当前不会执行。',
  skill: '技能文本及附带脚本可能影响模型或触发工具；技能加载与显式调用尚未启用。',
  prompt: '提示模板可能改变模型输入；模板调用尚未启用。',
  theme: '主题资源影响显示；外部主题加载尚未启用。',
  settings: '设置可能声明扩展、包、命令或权限；仅发现来源，不合并进宿主配置。',
  package: '第三方包可能安装依赖、执行安装脚本和加载原生扩展；不解析、下载或安装。',
}
const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex')
/** Canonical scope identity. Resolves aliases but never conflates a sibling path prefix. */
function canonicalProject(project: string): string {
  if (!isAbsolute(project)) {
    throw new Error('请选择本机绝对目录。')
  }
  const path = realpathSync(project)
  if (!lstatSync(path).isDirectory()) {
    throw new Error('资源来源必须是目录。')
  }
  return path
}
function key(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}
/** Bounds reads and rejects links in every component. Open file identity is rechecked, so a
 * concurrent replacement cannot substitute an unreviewed byte stream for the fingerprint.
 * This is a loader policy, not isolation from malicious processes running as the same OS user.
 */
function read(root: string, path: string): Buffer {
  const rel = relative(root, path)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error('来源在已选择目录之外；未读取或执行。')
  }
  let cursor = root
  for (const part of rel.split(sep).filter(Boolean)) {
    cursor = join(cursor, part)
    if (lstatSync(cursor).isSymbolicLink()) {
      throw new Error('符号链接或目录联接未被跟随；请单独检查真实来源。')
    }
  }
  if (key(realpathSync(path)) !== key(resolve(path))) {
    throw new Error('来源身份已改变，请重新检查。')
  }
  const descriptor = openSync(path, 'r')
  try {
    const before = fstatSync(descriptor)
    if (!before.isFile() || before.size > maxFile || before.nlink > 1) {
      throw new Error('仅检查不超过 64 KiB 的普通单链接文件；此资源保持禁用。')
    }
    const buffer = Buffer.alloc(before.size + 1)
    const size = readSync(descriptor, buffer, 0, buffer.length, 0)
    const after = fstatSync(descriptor),
      current = lstatSync(path)
    if (
      size !== before.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ino !== current.ino ||
      before.dev !== current.dev ||
      current.isSymbolicLink() ||
      current.nlink > 1
    ) {
      throw new Error('检查期间资源发生变化，请刷新。')
    }
    return buffer.subarray(0, size)
  } finally {
    closeSync(descriptor)
  }
}
function exists(path: string) {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}
interface DiscoveredResource {
  view: TrustResource
  content?: string
}
/** Metadata-only discovery: no imports, shell, package resolution, network or settings merge.
 * Explicit project scope and optionally host-selected user scope. Ancestor discovery is off.
 * Unknown, linked, oversized or incompletely inspected resources always fail closed.
 */
export function discoverTrust(project: string, userDirectory?: string) {
  const root = canonicalProject(project)
  const resources: DiscoveredResource[] = [],
    diagnostics: string[] = []
  const seen = new Set<string>()
  let inspectedEntries = 0,
    inspectedBytes = 0
  const add = (
    base: string,
    origin: TrustResource['origin'],
    kind: TrustResource['kind'],
    path: string,
    source = path,
    declaration?: string,
  ) => {
    const id = hash(JSON.stringify([key(root), origin, kind, key(path), declaration ?? '']))
    if (seen.has(id)) {
      return
    }
    if (resources.length >= 256) {
      throw new Error('资源数量超过 256；停止发现，未加载其余内容。')
    }
    seen.add(id)
    let fingerprint: string | null = null,
      preview = '',
      content: string | undefined,
      diagnostic: string | null = null
    try {
      const bytes: Buffer[] = []
      let total = 0,
        entries = 0
      const visit = (target: string, depth: number) => {
        if (++entries > maxEntries || ++inspectedEntries > 2048 || depth > 8) {
          throw new Error('资源树超过检查上限（512 项 / 8 层）；保持禁用。')
        }
        const rel = relative(base, target)
        if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
          throw new Error('来源在已选择目录之外；未读取或执行。')
        }
        const stat = lstatSync(target)
        if (stat.isSymbolicLink()) {
          throw new Error('符号链接或目录联接未被跟随。')
        }
        // Validate directory ancestors too, before enumeration (not just before file reads).
        let cursor = base
        for (const part of rel.split(sep).filter(Boolean)) {
          cursor = join(cursor, part)
          if (lstatSync(cursor).isSymbolicLink()) {
            throw new Error('链接来源保持禁用。')
          }
        }
        if (stat.isDirectory()) {
          const names = readdirSync(target).toSorted()
          if (names.length > maxEntries) {
            throw new Error('资源树条目过多；保持禁用。')
          }
          bytes.push(Buffer.from(JSON.stringify([relative(path, target), 'directory', names])))
          for (const name of names) {
            visit(join(target, name), depth + 1)
          }
        } else {
          const value = read(base, target)
          total += value.length
          inspectedBytes += value.length
          if (total > maxTree || inspectedBytes > 8 * 1024 * 1024) {
            throw new Error('资源树超过 2 MiB 或单次检查超过 8 MiB；保持禁用。')
          }
          bytes.push(Buffer.from(JSON.stringify([relative(path, target), value.length])), value)
          if (target === path) {
            const text = new TextDecoder('utf-8', { fatal: true }).decode(value)
            if (text.includes('\0')) {
              throw new Error('二进制资源不提供文本预览。')
            }
            preview = text.slice(0, 12000)
            if (kind === 'context') {
              content = text
            }
          } else if (preview.length < 12000) {
            preview += `${relative(path, target)} · SHA-256 ${hash(value)}\n`
          }
        }
      }
      if (declaration !== undefined) {
        // Remote/local package references are labels only; never resolve their targets.
        fingerprint = hash(JSON.stringify([source, declaration]))
        preview = declaration.slice(0, 12000)
      } else {
        if (kind === 'context' && !lstatSync(path).isFile()) {
          throw new Error('上下文来源必须是普通文本文件；目录不会作为模型文本加载。')
        }
        visit(path, 0)
        fingerprint = hash(Buffer.concat([Buffer.from(JSON.stringify([source, kind])), ...bytes]))
      }
    } catch (error) {
      content = undefined
      diagnostic = error instanceof Error ? error.message : '资源无法完整检查；保持禁用。'
    }
    resources.push({
      view: {
        id,
        project: root,
        origin,
        kind,
        path,
        source,
        fingerprint,
        impact: impacts[kind],
        preview,
        diagnostic,
        capability: kind === 'context' ? 'context-only' : 'disabled',
        trust: diagnostic ? 'blocked' : 'untrusted',
      },
      ...(content === undefined ? {} : { content }),
    })
  }
  const scope = (base: string, origin: 'project' | 'user') => {
    const config = origin === 'project' ? join(base, '.pi') : base
    for (const name of contexts) {
      if (exists(join(base, name))) {
        add(base, origin, 'context', join(base, name))
        break
      }
    }
    for (const name of ['SYSTEM.md', 'APPEND_SYSTEM.md']) {
      if (exists(join(config, name))) {
        add(base, origin, 'context', join(config, name))
      }
    }
    for (const [folder, kind] of [
      ['extensions', 'extension'],
      ['skills', 'skill'],
      ['prompts', 'prompt'],
      ['themes', 'theme'],
      ['scripts', 'script'],
    ] as const) {
      const directory = join(config, folder)
      if (exists(directory)) {
        add(base, origin, kind, directory)
      }
    }
    const settings = join(config, 'settings.json')
    if (exists(settings)) {
      add(base, origin, 'settings', settings)
      try {
        const data = settingsSchema.parse(JSON.parse(read(base, settings).toString('utf8')))
        for (const [field, kind] of [
          ['extensions', 'extension'],
          ['skills', 'skill'],
          ['prompts', 'prompt'],
          ['themes', 'theme'],
        ] as const) {
          for (const entry of data[field] ?? []) {
            const target = resolve(base, entry)
            add(base, origin, kind, target, `${settings} → ${field}: ${entry}`)
          }
        }
        for (const entry of data.packages ?? []) {
          const reference = typeof entry === 'string' ? entry : entry.source
          const declaration = typeof entry === 'string' ? entry : JSON.stringify(entry)
          add(
            base,
            'third-party',
            'package',
            settings,
            `${settings} → packages: ${reference}`,
            declaration,
          )
        }
      } catch {
        diagnostics.push(`${settings}：设置声明无法完整读取，所有设置保持禁用。`)
      }
    }
    if (origin === 'project' && exists(join(base, 'package.json'))) {
      const manifest = join(base, 'package.json')
      try {
        const data = z
          .object({ scripts: z.record(z.string(), z.string()).optional() })
          .parse(JSON.parse(read(base, manifest).toString('utf8')))
        for (const [name, command] of Object.entries(data.scripts ?? {})) {
          add(
            base,
            origin,
            'script',
            manifest,
            `${manifest} → scripts.${name}`,
            JSON.stringify([name, command]),
          )
        }
      } catch {
        diagnostics.push(`${manifest}：脚本声明无法读取；未执行安装或脚本。`)
      }
    }
  }
  scope(root, 'project')
  if (userDirectory) {
    try {
      scope(canonicalProject(userDirectory), 'user')
    } catch {
      diagnostics.push('宿主指定的用户资源目录无法完整检查，未加载其内容。')
    }
  }
  return { project: root, resources, diagnostics }
}
