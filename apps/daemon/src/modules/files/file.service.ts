/* oxlint-disable no-await-in-loop -- Bounded filesystem steps must observe cancellation, physical identity and scan order sequentially. */
import type { SessionStore } from '../sessions/session.store.js'
import type { WorkspaceService } from '../workspaces/workspace.service.js'
import type {
  ExternalFileInput,
  FileNode,
  FileReadInput,
  Redactor,
  WorkspaceEnvironmentTarget,
} from '@pi-workbench/shared'

import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, opendir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { HttpException } from '@nestjs/common'

import {
  externalFileInputSchema,
  externalTargetSchema,
  fileListingSchema,
  fileLocationSchema,
  fileReadingSchema,
  fileReadInputSchema,
  fileSearchSchema,
  gitEnvironmentSchema,
  systemOpenAllowed,
} from '@pi-workbench/shared'

import {
  fileIdentity,
  isAmbiguousPath,
  isCredentialPath,
  proveFilePath,
} from '../../infrastructure/file-boundary.js'
import { readGitCommand, readGitEnvironment } from '../workspaces/git-environment.js'
import { capturePreview } from './file-preview.js'
import { readFileBytes, readFileSnapshot } from './file-reading.js'

type Handle = {
  target: string
  root: string
  rootIdentity: string
  path: string
  identity: string
  expires: number
}
type Cursor = { directory: string; stamp: string; offset: number; expires: number }
type Scope = Awaited<ReturnType<FileService['scope']>>
const skipped = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.workbench',
  '.next',
  'vendor',
])
const failure = (message = '文件或目录已变化、不可访问或句柄已过期。请从根目录刷新重试。') =>
  new HttpException(message, 409)

/** Registered-root, desktop read-only browser. Four active IO operations; bounded scans
 * retain a slot until actual IO settles, even after client cancellation. No SDK, ledger,
 * registry writes, added roots or user Git mutation. Handles are volatile and target-bound. */
export class FileService {
  private active = 0
  private closing = false
  private disposal: Promise<void> | undefined
  private readonly running = new Set<Promise<unknown>>()
  private readonly handles = new Map<string, Handle>()
  private readonly cursors = new Map<string, Cursor>()
  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly sessions: SessionStore,
    private readonly redactor: Redactor,
  ) {}

  private async scope(target: WorkspaceEnvironmentTarget) {
    const session =
      'sessionId' in target ? this.sessions.executionEnvironment(target.sessionId) : null
    if ('sessionId' in target && !session) {
      throw failure('会话不存在，请刷新会话列表。')
    }
    const workspaceId = session?.workspaceId ?? ('workspaceId' in target ? target.workspaceId : '')
    const registered = this.workspaces.lookup(workspaceId)
    if (!registered) {
      throw failure('工作区不存在，请重新打开目录。')
    }
    const result = await this.workspaces.environmentDirectory(workspaceId, session?.cwd)
    if (!result.ok) {
      throw failure(`${result.message} ${result.recovery}`)
    }
    const proof = await proveFilePath(result.canonicalPath, '')
    return {
      target,
      workspaceId,
      cwd: session?.cwd,
      root: result.canonicalPath,
      rootIdentity: fileIdentity(proof.stat),
      key: JSON.stringify(target),
    }
  }

  private async verify(scope: Scope, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const current = await this.scope(scope.target)
    if (current.root !== scope.root || current.rootIdentity !== scope.rootIdentity) {
      throw failure()
    }
  }
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) {
      throw failure('文件浏览正在关闭，请在重新连接后刷新。')
    }
    if (this.active >= 4) {
      throw new HttpException('文件检查繁忙，请稍后重试；后台对话保留。', 429)
    }
    this.active++
    const task = operation()
    this.running.add(task)
    try {
      return await task
    } catch (error) {
      if (error instanceof HttpException) {
        throw error
      }
      throw failure()
    } finally {
      this.running.delete(task)
      this.active--
    }
  }

  /** KernelService alone coordinates shutdown: reject new observations, drain actual
   * IO before SQLite closes, then discard volatile handles. No parallel Nest destroy hook. */
  close(): Promise<void> {
    this.closing = true
    this.disposal ??= (async () => {
      await Promise.allSettled(this.running)
      this.handles.clear()
      this.cursors.clear()
    })()
    return this.disposal
  }
  private prune() {
    const now = Date.now()
    for (const [id, h] of this.handles) {
      if (h.expires < now || this.handles.size >= 2000) {
        this.handles.delete(id)
      }
    }
    for (const [id, c] of this.cursors) {
      if (c.expires < now || this.cursors.size >= 200) {
        this.cursors.delete(id)
      }
    }
  }
  private handle(scope: Scope, id: string) {
    const h = this.handles.get(id)
    if (
      !h ||
      h.expires < Date.now() ||
      h.target !== scope.key ||
      h.root !== scope.root ||
      h.rootIdentity !== scope.rootIdentity
    ) {
      throw failure()
    }
    return h
  }
  private async resolve(scope: Scope, id?: string) {
    const h = id ? this.handle(scope, id) : undefined
    const proof = await proveFilePath(scope.root, h?.path ?? '')
    if (h && h.identity !== fileIdentity(proof.stat)) {
      throw failure()
    }
    return { ...proof, path: h?.path ?? '' }
  }
  private async node(scope: Scope, path: string, ignored: FileNode['ignored']): Promise<FileNode> {
    const id = randomUUID(),
      absolute = join(scope.root, path)
    let kind: FileNode['kind'] = 'other',
      availability: FileNode['availability'] = 'inaccessible'
    let reason: string | null = '无法检查此项；不会自动访问。',
      size: number | null = null
    try {
      const stat = await lstat(absolute)
      kind = stat.isSymbolicLink()
        ? 'link'
        : stat.isDirectory()
          ? 'directory'
          : stat.isFile()
            ? 'file'
            : 'other'
      size = stat.isFile() ? stat.size : null
      if (isCredentialPath(path)) {
        availability = 'private'
        reason = '私密或 Git 元数据目录，不开放浏览。'
      } else if (path && isAmbiguousPath(path)) {
        availability = 'invalid'
        reason = '歧义路径，不开放访问。'
      } else if (kind === 'link') {
        availability = 'link'
        reason = '链接不跟随，不扩大授权目录。'
      } else if (kind === 'other' || (stat.isFile() && stat.nlink !== 1)) {
        availability = 'unsupported'
        reason = '非普通文件或多硬链接，不开放访问。'
      } else {
        // Windows access(R_OK) does not establish directory-list permission. Use real
        // read-only descriptors, without returning a probed child or reading file bytes.
        const before = await proveFilePath(scope.root, path)
        if (kind === 'directory') {
          const probe = await opendir(absolute, { bufferSize: 1 })
          try {
            await probe.read()
          } finally {
            await probe.close()
          }
        } else {
          const probe = await open(absolute, constants.O_RDONLY)
          try {
            if (fileIdentity(await probe.stat()) !== fileIdentity(stat)) {
              throw failure()
            }
          } finally {
            await probe.close()
          }
        }
        const after = await proveFilePath(scope.root, path)
        if (before.chain !== after.chain || before.stamp !== after.stamp) {
          throw failure()
        }
        availability = 'available'
        reason = null
        this.prune()
        this.handles.set(id, {
          target: scope.key,
          root: scope.root,
          rootIdentity: scope.rootIdentity,
          path,
          identity: fileIdentity(stat),
          expires: Date.now() + 300000,
        })
      }
    } catch {
      // Individual inaccessible/disappeared entries remain explicit; never follow them.
    }
    return {
      id,
      name: this.redactor.text(path ? basename(path) : basename(scope.root)),
      path: this.redactor.text(path || '.'),
      kind,
      availability,
      ignored,
      scanSkipped: skipped.has(basename(path).toLowerCase()),
      reason,
      size,
    }
  }
  private async ignored(
    scope: Scope,
    paths: string[],
    git: Awaited<ReturnType<typeof readGitEnvironment>>,
  ) {
    if (!paths.length || git.status === 'not_repository') {
      return new Set<string>()
    }
    if (git.status !== 'repository') {
      return null
    }
    const result = await readGitCommand(
      scope.root,
      ['check-ignore', '--no-index', '-z', '--stdin'],
      { timeout: 1000, maxBuffer: 512 * 1024 },
      paths.map((p) => p.replaceAll('\\', '/')).join('\0') + '\0',
    )
    return result.code === 0 || result.code === 1
      ? new Set(result.out.split('\0').map((p) => p.replaceAll('\\', '/')))
      : null
  }
  private async publicScope(scope: Scope) {
    return {
      target: scope.target,
      root: this.redactor.text(scope.root),
      git: gitEnvironmentSchema.parse(this.redactor.value(await readGitEnvironment(scope.root))),
      additionalRoots: 0 as const,
      checkedAt: Date.now(),
    }
  }

  /** Each page reopens the directory asynchronously, bounded to 5,000 entries. Cursor
   * offset is tied to its directory stamp; changing a directory rejects the whole page.
   * Explicit browsing can enter ignored directories, but no recursive scan is implied. */
  list(
    target: WorkspaceEnvironmentTarget,
    directory?: string,
    cursor?: string,
    signal?: AbortSignal,
  ) {
    return this.run(async () => {
      const scope = await this.scope(target),
        proof = await this.resolve(scope, directory)
      if (!proof.stat.isDirectory()) {
        throw failure('此项不是目录。')
      }
      const c = cursor ? this.cursors.get(cursor) : undefined
      if (
        cursor &&
        (!c || c.expires < Date.now() || c.directory !== directory || c.stamp !== proof.stamp)
      ) {
        throw failure('目录分页已变化或过期，请刷新目录；不拼接旧页。')
      }
      const offset = c?.offset ?? 0,
        paths: string[] = []
      const deadline = Date.now() + 2000
      let visited = 0,
        end = true
      const stream = await opendir(proof.absolute, { bufferSize: 32 })
      for await (const entry of stream) {
        signal?.throwIfAborted()
        if (Date.now() > deadline || visited >= 5000) {
          end = false
          break
        }
        visited++
        if (visited <= offset) {
          continue
        }
        if (paths.length === 100) {
          end = false
          break
        }
        paths.push(proof.path ? join(proof.path, entry.name) : entry.name)
      }
      const pub = await this.publicScope(scope),
        ignores = await this.ignored(scope, paths, pub.git)
      const entries: FileNode[] = []
      for (const path of paths) {
        signal?.throwIfAborted()
        entries.push(
          await this.node(
            scope,
            path,
            ignores ? (ignores.has(path.replaceAll('\\', '/')) ? 'yes' : 'no') : 'unknown',
          ),
        )
      }
      const after = await proveFilePath(scope.root, proof.path)
      if (proof.stamp !== after.stamp || proof.chain !== after.chain) {
        throw failure()
      }
      await this.verify(scope, signal)
      const current = await this.node(scope, proof.path, 'unknown')
      let next: string | null = null
      if (!end && offset + paths.length < 5000 && paths.length === 100) {
        next = randomUUID()
        this.cursors.set(next, {
          directory: current.id,
          stamp: after.stamp,
          offset: offset + paths.length,
          expires: Date.now() + 300000,
        })
      }
      return fileListingSchema.parse({
        ...pub,
        directory: current,
        parent: proof.path
          ? await this.node(
              scope,
              dirname(proof.path) === '.' ? '' : dirname(proof.path),
              'unknown',
            )
          : null,
        entries,
        cursor: next,
        complete: end,
        order: 'filesystem',
        diagnostic:
          !end && !next
            ? '达到目录 5,000 项或时间限额，请使用更具体的子目录。'
            : ignores
              ? null
              : 'Git 忽略规则暂不可核验，相关项标为未知。',
      })
    })
  }

  /** Literal filename/relative-path search; no content reads. Bounded breadth-first walk
   * skips ignored, dependency/output, private, inaccessible and linked directories.
   * Partial coverage is reported honestly, cancellation never frees an unsettled IO slot. */
  search(target: WorkspaceEnvironmentTarget, query: string, signal?: AbortSignal) {
    return this.run(async () => {
      const scope = await this.scope(target),
        root = await proveFilePath(scope.root, '')
      const pub = await this.publicScope(scope),
        pending = [{ path: '', depth: 0 }]
      const entries: FileNode[] = [],
        deadline = Date.now() + 2000
      let visited = 0,
        complete = true
      const needle = query.trim().toLocaleLowerCase().replaceAll('\\', '/')
      while (pending.length) {
        signal?.throwIfAborted()
        const next = pending.shift()!
        try {
          const proof = await proveFilePath(scope.root, next.path)
          const stream = await opendir(proof.absolute, { bufferSize: 32 }),
            paths: string[] = []
          for await (const entry of stream) {
            signal?.throwIfAborted()
            if (visited >= 5000 || Date.now() > deadline || entries.length >= 100) {
              complete = false
              break
            }
            visited++
            paths.push(next.path ? join(next.path, entry.name) : entry.name)
            // Small batches bound pending work as well as memory, including huge flat dirs.
            if (paths.length === 100) {
              complete =
                (await this.searchBatch(
                  scope,
                  paths,
                  pub.git,
                  next.depth,
                  needle,
                  entries,
                  pending,
                  deadline,
                  signal,
                )) && complete
              paths.length = 0
            }
          }
          if (paths.length) {
            complete =
              (await this.searchBatch(
                scope,
                paths,
                pub.git,
                next.depth,
                needle,
                entries,
                pending,
                deadline,
                signal,
              )) && complete
          }
          const after = await proveFilePath(scope.root, next.path)
          if (after.stamp !== proof.stamp || after.chain !== proof.chain) {
            throw failure()
          }
        } catch (error) {
          if (signal?.aborted || error instanceof HttpException) {
            throw error
          }
          complete = false
        }
        if (visited >= 5000 || Date.now() > deadline || entries.length >= 100) {
          complete = false
          break
        }
      }
      const after = await proveFilePath(scope.root, '')
      if (after.stamp !== root.stamp || after.chain !== root.chain) {
        throw failure()
      }
      await this.verify(scope, signal)
      return fileSearchSchema.parse({
        ...pub,
        query: this.redactor.text(query),
        entries,
        visited,
        complete,
        diagnostic:
          '仅文件名／相对路径；跳过忽略项、依赖／输出目录、私密项、链接及不可访问项。' +
          (complete ? '' : ' 部分目录未覆盖或达到 5,000 项／100 结果／2 秒限额，请缩小范围。'),
      })
    })
  }
  private async searchBatch(
    scope: Scope,
    paths: string[],
    git: Awaited<ReturnType<typeof readGitEnvironment>>,
    depth: number,
    needle: string,
    entries: FileNode[],
    pending: { path: string; depth: number }[],
    deadline: number,
    signal?: AbortSignal,
  ) {
    const ignores = await this.ignored(scope, paths, git)
    let complete = ignores !== null
    for (const path of paths) {
      signal?.throwIfAborted()
      if (Date.now() > deadline) {
        return false
      }
      // If Git rules are unknown, avoid automatically descending or disclosing results.
      if (
        !ignores ||
        ignores.has(path.replaceAll('\\', '/')) ||
        isCredentialPath(path) ||
        skipped.has(basename(path).toLowerCase())
      ) {
        continue
      }
      const matches =
        entries.length < 100 && path.replaceAll('\\', '/').toLocaleLowerCase().includes(needle)
      const stat = await lstat(join(scope.root, path))
      if (stat.isSymbolicLink()) {
        continue
      }
      if (matches) {
        const n = await this.node(scope, path, 'no')
        if (n.availability !== 'available') {
          continue
        }
        entries.push(n)
      }
      // Nonmatching files need no descriptor probe or retained handle. Directories are
      // proven again before descent; a link swap cannot inherit this metadata result.
      if (stat.isDirectory()) {
        if (depth < 12) {
          pending.push({ path, depth: depth + 1 })
        } else {
          complete = false
        }
      }
    }
    return complete
  }

  /** Fresh metadata and containing-directory handle, never file contents. An expired,
   * replaced or cross-target handle cannot locate another root. */
  locate(target: WorkspaceEnvironmentTarget, file: string, signal?: AbortSignal) {
    return this.run(async () => {
      const scope = await this.scope(target),
        proof = await this.resolve(scope, file)
      const parent = proof.stat.isDirectory() ? proof.path : dirname(proof.path)
      const pub = await this.publicScope(scope)
      await this.verify(scope, signal)
      return fileLocationSchema.parse({
        ...pub,
        file: await this.node(scope, proof.path, 'unknown'),
        absolutePath: this.redactor.text(proof.absolute),
        directory: await this.node(scope, parent === '.' ? '' : parent, 'unknown'),
      })
    })
  }

  /** Path links are untrusted hints, resolved only inside the existing physical cwd.
   * Reuse the same IO admission, identity recheck and lifecycle as metadata browsing. */
  read(input: FileReadInput, signal?: AbortSignal) {
    return this.run(async () => {
      const q = fileReadInputSchema.parse(input),
        scope = await this.scope(q.target)
      let path: string
      if ('file' in q.source) {
        path = (await this.resolve(scope, q.source.file)).path
      } else {
        if (isAmbiguousPath(q.source.path) || isCredentialPath(q.source.path)) {
          throw failure('文件路径无效或超出当前授权范围。')
        }
        path = isAbsolute(q.source.path)
          ? relative(scope.root, resolve(q.source.path))
          : q.source.path
      }
      const data = await readFileSnapshot(scope.root, path, this.redactor, q.version, signal)
      await this.verify(scope, signal)
      return fileReadingSchema.parse({ ...data, target: q.target })
    })
  }

  /** Private host capture for INPUT-03. Exact bytes never cross the read transport.
   * Registered physical roots, IO admission and descriptor cleanup are shared with reads. */
  capture(target: WorkspaceEnvironmentTarget, hint: string, directory = false, expected?: string) {
    return this.run(async () => {
      const scope = await this.scope(target)
      if (isAmbiguousPath(hint) || isCredentialPath(hint)) {
        throw failure('引用路径无效或属于私密项。')
      }
      const path = isAbsolute(hint) ? relative(scope.root, resolve(hint)) : hint
      let bytes: Buffer = Buffer.alloc(0),
        version: string
      if (directory) {
        const proof = await proveFilePath(scope.root, path)
        if (!proof.stat.isDirectory()) {
          throw failure('引用目标不是目录。')
        }
        version = createHash('sha256').update(proof.chain).digest('hex')
        if (expected && expected !== version) {
          throw failure('目录身份已变化，请重新添加引用。')
        }
      } else {
        const snapshot = await readFileSnapshot(
          scope.root,
          path,
          this.redactor,
          expected,
          undefined,
          (raw) => {
            bytes = raw
          },
        )
        if (snapshot.status !== 'ready' || !snapshot.version) {
          throw failure(snapshot.diagnostic)
        }
        version = snapshot.version
      }
      await this.verify(scope)
      return { path, root: scope.root, workspaceId: scope.workspaceId, version, bytes }
    })
  }

  /** Host-only frozen preview. Physical scope and all actual IO share the file admission
   * and shutdown drain; caller cancellation never releases an in-flight descriptor. */
  preview(input: FileReadInput) {
    return this.run(async () => {
      const q = fileReadInputSchema.parse(input),
        scope = await this.scope(q.target)
      const path = await this.inputPath(scope, q)
      const snapshot = await capturePreview(scope.root, path, q, this.redactor).catch(
        (error: unknown) => {
          throw failure(
            error instanceof Error
              ? this.redactor.text(error.message)
              : '预览读取失败，请刷新后重试。',
          )
        },
      )
      await this.verify(scope)
      return snapshot
    })
  }

  private async inputPath(scope: Scope, q: FileReadInput) {
    if ('path' in q.source && (isAmbiguousPath(q.source.path) || isCredentialPath(q.source.path))) {
      throw failure('文件路径无效或属于私密项。')
    }
    return 'file' in q.source
      ? (await this.resolve(scope, q.source.file)).path
      : isAbsolute(q.source.path)
        ? relative(scope.root, resolve(q.source.path))
        : q.source.path
  }

  /** Host editor uses the same scope/opaque handle resolver without receiving authority
   * from a display path. The caller must re-prove this root and path around its IO. */
  editTarget(input: FileReadInput) {
    return this.run(async () => {
      const q = fileReadInputSchema.parse(input),
        scope = await this.scope(q.target)
      const path = await this.inputPath(scope, q)
      const proof = await proveFilePath(scope.root, path)
      if (!proof.stat.isFile()) {
        throw failure('编辑目标不是普通文件。')
      }
      await this.verify(scope)
      return { root: scope.root, path, chain: proof.chain, absolute: proof.absolute }
    })
  }

  /** Private desktop handoff, sharing registered physical identity and IO draining.
   * Returns no permission beyond this checked target. Main must recheck immediately;
   * external applications reopen paths, so this is not an OS lock or sandbox. */
  externalTarget(input: ExternalFileInput) {
    return this.run(async () => {
      const q = externalFileInputSchema.parse(input),
        scope = await this.scope(q.target)
      let path: string
      if ('file' in q.source) {
        path = (await this.resolve(scope, q.source.file)).path
      } else {
        if (isAmbiguousPath(q.source.path) || isCredentialPath(q.source.path)) {
          throw failure('打开路径无效或属于私密项；请从授权文件列表重新选择。')
        }
        path = isAbsolute(q.source.path)
          ? relative(scope.root, resolve(q.source.path))
          : q.source.path
      }
      const before = await proveFilePath(scope.root, path)
      if (before.stat.isDirectory() && (q.line !== 1 || q.action === 'system')) {
        throw failure('目录不接收代码行号或文档关联打开；请使用 IDE 或文件管理器定位。')
      }
      if (q.action === 'system' && !systemOpenAllowed(path)) {
        throw failure('此类型不提供系统关联打开；请明确选择 IDE，或在文件管理器定位。')
      }
      if (before.stat.isFile() && (q.version || q.line > 1)) {
        const binary =
          q.version && q.line === 1 && before.stat.size > 256 * 1024
            ? await readFileBytes(scope.root, path, 8 * 1024 * 1024)
            : null
        const data = binary
          ? null
          : await readFileSnapshot(scope.root, path, this.redactor, q.version)
        if (
          data?.status === 'changed' ||
          (q.version && (binary?.version ?? data?.version) !== q.version)
        ) {
          throw failure('文件版本已变化；请明确刷新当前文件后重新打开。')
        }
        if (q.line > 1 && (!data || data.status !== 'ready' || q.line > data.lines.length)) {
          throw failure('无法核对当前代码行号；请使用可阅读的当前版本与实际行号，或从第 1 行打开。')
        }
      }
      const after = await proveFilePath(scope.root, path)
      if (before.chain !== after.chain || before.stamp !== after.stamp) {
        throw failure('打开前文件或目录已变化，请刷新后重试。')
      }
      await this.verify(scope)
      return externalTargetSchema.parse({
        root: scope.root,
        path,
        chain: after.chain,
        stamp: after.stamp,
        kind: after.stat.isDirectory() ? 'directory' : 'file',
        action: q.action,
        line: q.line,
        expiresAt: Date.now() + 5000,
      })
    })
  }
}
