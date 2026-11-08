/* oxlint-disable no-await-in-loop -- Sequential descriptor checks bound IO and preserve identity checks around each read. */
import type { FileSnapshot, LedgerCapacity } from '@pi-workbench/shared'
import type { BigIntStats } from 'node:fs'

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, opendir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

import { z } from 'zod'

import { fileLedgerPolicy, ledgerCapacitySchema } from '@pi-workbench/shared'

const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
const blobId = (bytes: Buffer) =>
  createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
const fileSchema = z.strictObject({
  path: z.string().min(1),
  size: z.number().int().min(0).max(fileLedgerPolicy.fileBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  blob: z.string().regex(/^[a-f0-9]{40}$/),
})
const manifestSchema = z.strictObject({
  version: z.literal(1),
  directory: z.string().regex(/^[a-f0-9]{64}$/),
  turnId: z.uuid(),
  phase: z.enum(['baseline', 'final']),
  files: z.array(fileSchema).max(fileLedgerPolicy.entries),
})
type Identity = { directoryKey: string; canonicalPath: string }
type Captured = {
  files: { path: string; bytes: Buffer }[]
  fingerprint: string
  exclusions: FileSnapshot['exclusions']
  excluded: number
}
const contained = (root: string, path: string) => {
  const sub = relative(root, path)
  return sub === '' || (!sub.startsWith(`..${sep}`) && sub !== '..' && !isAbsolute(sub))
}
const stamp = (stat: BigIntStats) =>
  `${stat.dev}:${stat.ino}:${stat.birthtimeNs}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.nlink}`

/** Private raw-byte object store. Every Git command targets our bare repository; no checkout,
 * index, user config, hooks, filters, project process, or user history participates. Limits
 * bound traversal, memory and subprocesses. Observed stable bytes still prove no authorship. */
export class FileLedger {
  private readonly scanning = new Set<string>()
  private readonly capacityBytes: number
  constructor(
    private readonly dataDir: string,
    capacityBytes: number = fileLedgerPolicy.capacityBytes,
  ) {
    this.capacityBytes = z
      .number()
      .int()
      .min(65536)
      .max(fileLedgerPolicy.capacityBytes)
      .parse(capacityBytes)
  }

  private repo(identity: Identity): string {
    return join(this.dataDir, 'ledger', digest(identity.directoryKey), 'objects.git')
  }

  /** Reject linked private storage components, including a data directory redirected after
   * startup. Same-user arbitrary filesystem mutation remains outside an OS sandbox. */
  private async storage(identity: Identity, create: boolean): Promise<string> {
    const root = await realpath(this.dataDir)
    if (root !== this.dataDir) {
      throw new Error('账本数据目录身份已改变。')
    }
    const repo = this.repo(identity)
    for (const part of [
      join(root, 'ledger'),
      join(root, 'ledger', digest(identity.directoryKey)),
      repo,
    ]) {
      if (create) {
        await mkdir(part, { recursive: false }).catch((error: unknown) => {
          if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
            throw error
          }
        })
      }
      const stat = await lstat(part)
      if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(part)) !== part) {
        throw new Error('账本存储路径不是独立普通目录。')
      }
    }
    return repo
  }

  private git(
    repo: string,
    args: string[],
    input: Buffer = Buffer.alloc(0),
    codes = [0],
    maxOutput = 8 * 1024 * 1024,
  ): Promise<Buffer> {
    const env = { ...process.env }
    for (const key of Object.keys(env)) {
      if (key.toUpperCase().startsWith('GIT_')) {
        delete env[key]
      }
    }
    Object.assign(env, {
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_SYSTEM: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_ATTR_NOSYSTEM: '1',
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_OPTIONAL_LOCKS: '0',
    })
    return new Promise((resolve, reject) => {
      const child = spawn(
        'git',
        [
          '--no-pager',
          '--git-dir',
          repo,
          '-c',
          'core.fsync=all',
          '-c',
          'core.fsyncMethod=fsync',
          '-c',
          'core.logAllRefUpdates=false',
          '-c',
          'core.quotePath=false',
          '-c',
          'gc.auto=0',
          '-c',
          'maintenance.auto=false',
          ...args,
        ],
        { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      )
      const chunks: Buffer[] = []
      let size = 0,
        failed: Error | undefined
      const fail = (error: Error) => {
        failed ??= error
        child.kill()
      }
      const timer = setTimeout(() => fail(new Error('独立账本操作超时。')), 10000)
      timer.unref()
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > maxOutput) {
          fail(new Error('独立账本输出超过限额。'))
        } else {
          chunks.push(chunk)
        }
      })
      // Git diagnostics may contain private paths. Do not forward raw stderr to clients/logs.
      child.stderr.resume()
      child.stdin.on('error', () => fail(new Error('独立账本输入失败。')))
      child.on('close', (code) => {
        clearTimeout(timer)
        if (failed || code === null || !codes.includes(code)) {
          reject(
            failed ??
              new Error(
                `独立账本 ${args.find((arg) => ['init', 'check-ignore', 'fast-import', 'rev-parse', 'cat-file'].includes(arg)) ?? '操作'} 失败（${code}）。`,
              ),
          )
        } else {
          resolve(Buffer.concat(chunks))
        }
      })
      child.stdin.end(input)
    })
  }

  /** Read actual Git object disk estimates, including garbage, without creating storage,
   * following linked object roots or collecting anything. Failed inspection is unknown,
   * never zero. Existing refs remain pinned regardless of decisions or current capacity. */
  async capacity(identity: Identity): Promise<LedgerCapacity> {
    let usedBytes: number | null = null,
      diagnostic: string | null = null
    try {
      // A never-created per-directory store is empty; a missing host data root is unknown.
      if ((await realpath(this.dataDir)) !== this.dataDir) {
        throw new Error('账本数据目录身份已改变。')
      }
      let repo: string | null = null
      try {
        repo = await this.storage(identity, false)
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
          throw error
        }
      }
      if (repo) {
        const objects = join(repo, 'objects'),
          stat = await lstat(objects)
        if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(objects)) !== objects) {
          throw new Error('账本对象目录身份不安全。')
        }
        const output = (await this.git(repo, ['count-objects', '-v'])).toString('ascii')
        usedBytes = ['size', 'size-pack', 'size-garbage'].reduce((total, key) => {
          const match = new RegExp(`^${key}: (\\d+)$`, 'm').exec(output)
          if (!match) {
            throw new Error('账本容量结果无效。')
          }
          return total + Number(match[1]) * 1024
        }, 0)
        if (!Number.isSafeInteger(usedBytes)) {
          throw new Error('账本容量超过可核对范围。')
        }
      } else {
        usedBytes = 0
      }
    } catch {
      usedBytes = null
      diagnostic = '账本容量无法核对；暂停新采集，已保存版本保留。'
    }
    return ledgerCapacitySchema.parse({
      state:
        usedBytes === null
          ? 'unavailable'
          : usedBytes >= this.capacityBytes
            ? 'full'
            : usedBytes >= this.capacityBytes * fileLedgerPolicy.warningRatio
              ? 'warning'
              : 'normal',
      usedBytes,
      limitBytes: this.capacityBytes,
      warningBytes: Math.ceil(this.capacityBytes * fileLedgerPolicy.warningRatio),
      measurement: 'git-object-kib',
      automaticCleanup: false,
      retention: 'keep-all-published',
      diagnostic,
    })
  }

  private async requireCapacity(identity: Identity, estimatedBytes: number): Promise<void> {
    const capacity = await this.capacity(identity)
    if (capacity.usedBytes === null) {
      throw new Error(capacity.diagnostic ?? '账本容量不可用。')
    }
    if (capacity.state === 'full' || capacity.usedBytes + estimatedBytes > capacity.limitBytes) {
      throw new Error(
        `账本容量不足，暂停新采集且保留所有旧版本；Git对象估算${capacity.usedBytes}字节，预计新增${estimatedBytes}字节，上限${capacity.limitBytes}字节。`,
      )
    }
  }

  private async scan(identity: Identity, repo: string): Promise<Captured> {
    if (contained(this.dataDir, identity.canonicalPath)) {
      throw new Error('不能采集工作台私有数据目录。')
    }
    if (this.scanning.has(identity.directoryKey)) {
      throw new Error('上次文件采集尚未结束，未叠加采集。')
    }
    this.scanning.add(identity.directoryKey)
    const deadline = Date.now() + 5000
    const result: Captured = { files: [], fingerprint: '', exclusions: [], excluded: 0 }
    const stamps: string[] = []
    let entries = 0,
      total = 0
    const check = () => {
      if (Date.now() > deadline) {
        throw new Error('文件采集超过时间限额。')
      }
    }
    const exclude = (path: string, reason: string) => {
      result.excluded++
      if (result.exclusions.length < 32) {
        result.exclusions.push({ path, reason })
      }
    }
    const walk = async (directory: string, depth: number): Promise<void> => {
      check()
      const before = await lstat(directory, { bigint: true })
      if (
        !before.isDirectory() ||
        before.isSymbolicLink() ||
        (await realpath(directory)) !== directory
      ) {
        throw new Error('采集目录身份变化。')
      }
      const dir = await opendir(directory)
      const names: string[] = []
      for await (const entry of dir) {
        check()
        if (++entries > fileLedgerPolicy.entries) {
          throw new Error('文件采集超过 2048 项限额。')
        }
        names.push(entry.name)
      }
      names.sort()
      const candidates: { full: string; path: string; stat: BigIntStats }[] = []
      for (const name of names) {
        check()
        const full = join(directory, name),
          path = relative(identity.canonicalPath, full).split(sep).join('/')
        if (name.startsWith('.pi-workbench-check-')) {
          continue
        }
        const stat = await lstat(full, { bigint: true })
        stamps.push(`${path}:${stamp(stat)}`)
        let reason: string | undefined
        if (['.git', 'node_modules', '.workbench'].includes(name.toLowerCase())) {
          reason = '固定排除目录'
        } else if (contained(this.dataDir, full)) {
          reason = '工作台私有数据'
        } else if (
          /^(?:\.env(?:\..*)?|\.ssh|\.aws|\.azure|\.pi|auth\.json|credentials(?:\..*)?)$/i.test(
            name,
          )
        ) {
          reason = '私密配置'
        } else if (
          Array.from(path).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
        ) {
          reason = '不支持的路径字符'
        } else if (
          stat.isSymbolicLink() ||
          (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1n))
        ) {
          reason = '链接或非普通独占文件'
        } else if (stat.isDirectory()) {
          try {
            await lstat(join(full, '.git'))
            reason = '嵌套仓库'
          } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
              throw error
            }
          }
        }
        if (reason) {
          exclude(path, reason)
        } else {
          candidates.push({ full, path, stat })
        }
      }
      // check-ignore only reads .gitignore via a private gitdir and explicit worktree;
      // --no-index avoids the user's staged/unstaged state and leaves its index untouched.
      const ignoredOutput = candidates.length
        ? await this.git(
            repo,
            ['--work-tree', identity.canonicalPath, 'check-ignore', '--no-index', '-z', '--stdin'],
            Buffer.from(candidates.map((entry) => `./${entry.path}`).join('\0') + '\0'),
            [0, 1],
          )
        : Buffer.alloc(0)
      const ignored = new Set(
        ignoredOutput
          .toString('utf8')
          .split('\0')
          .map((path) => path.replace(/^\.\//, '')),
      )
      for (const { full, path, stat } of candidates) {
        check()
        if (ignored.has(path)) {
          exclude(path, '.gitignore')
          continue
        }
        if (stat.isDirectory()) {
          if (depth >= fileLedgerPolicy.depth) {
            throw new Error('文件采集超过 8 层限额。')
          }
          await walk(full, depth + 1)
          continue
        }
        if (
          stat.size > BigInt(fileLedgerPolicy.fileBytes) ||
          total + Number(stat.size) > fileLedgerPolicy.snapshotBytes
        ) {
          throw new Error('文件超过 5 MiB 或总计 32 MiB 限额。')
        }
        if ((await realpath(full)) !== full) {
          throw new Error('文件路径身份变化。')
        }
        const handle = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
        let bytes: Buffer
        try {
          const opened = await handle.stat({ bigint: true })
          if (stamp(opened) !== stamp(stat) || !opened.isFile() || opened.nlink !== 1n) {
            throw new Error('打开的文件身份变化。')
          }
          // Fixed allocation prevents a concurrently growing file from causing unbounded IO.
          bytes = Buffer.alloc(Number(stat.size))
          let offset = 0
          while (offset < bytes.length) {
            check()
            const read = await handle.read(bytes, offset, bytes.length - offset, offset)
            if (!read.bytesRead) {
              throw new Error('文件读取不完整。')
            }
            offset += read.bytesRead
          }
          if (stamp(await handle.stat({ bigint: true })) !== stamp(stat)) {
            throw new Error('读取期间文件变化。')
          }
        } finally {
          await handle.close()
        }
        if (
          stamp(await lstat(full, { bigint: true })) !== stamp(stat) ||
          (await realpath(full)) !== full
        ) {
          throw new Error('读取后的文件身份变化。')
        }
        total += bytes.length
        result.files.push({ path, bytes })
      }
      if (
        stamp(await lstat(directory, { bigint: true })) !== stamp(before) ||
        (await realpath(directory)) !== directory
      ) {
        throw new Error('采集期间目录变化。')
      }
    }
    let expired = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const operation = walk(identity.canonicalPath, 0).finally(() =>
      this.scanning.delete(identity.directoryKey),
    )
    try {
      await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            expired = true
            reject(new Error('文件采集超过时间限额。'))
          }, 5100)
          timer.unref()
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
    if (expired) {
      throw new Error('文件采集已失效。')
    }
    result.fingerprint = digest(
      JSON.stringify([stamps, result.files.map((file) => [file.path, digest(file.bytes)])]),
    )
    return result
  }

  /** Validate historical restore targets against TODAY's exclusions, including missing
   * files and ancestors. Explicit human confirmation cannot bypass this boundary. */
  async assertRestoreTargets(identity: Identity, paths: string[]): Promise<void> {
    const repo = await this.storage(identity, false)
    for (const path of paths) {
      const parts = path.split('/')
      if (
        parts.length > 9 ||
        parts.some(
          (part) =>
            !part ||
            part === '.' ||
            part === '..' ||
            /[\\:]/.test(part) ||
            Array.from(part).some(
              (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
            ) ||
            /[. ]$/.test(part) ||
            /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) ||
            ['.git', 'node_modules', '.workbench'].includes(part.toLowerCase()) ||
            /^(?:\.env(?:\..*)?|\.ssh|\.aws|\.azure|\.pi|auth\.json|credentials(?:\..*)?)$/i.test(
              part,
            ),
        )
      ) {
        throw new Error('回滚目标包含排除或歧义路径。')
      }
      const full = join(identity.canonicalPath, ...parts)
      if (!contained(identity.canonicalPath, full) || contained(this.dataDir, full)) {
        throw new Error('回滚目标不属于可恢复目录。')
      }
      let missing = false
      for (let i = 0; i < parts.length; i++) {
        const parent = join(identity.canonicalPath, ...parts.slice(0, i))
        if (missing) {
          continue
        }
        try {
          const stat = await lstat(parent)
          if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(parent)) !== parent) {
            throw new Error('回滚目标父目录身份不安全。')
          }
          if (i > 0) {
            try {
              await lstat(join(parent, '.git'))
              throw new Error('回滚目标位于嵌套仓库。')
            } catch (error) {
              if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
                throw error
              }
            }
          }
        } catch (error) {
          if (i > 0 && error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            missing = true
          } else {
            throw error
          }
        }
      }
    }
    const ignored = await this.git(
      repo,
      ['--work-tree', identity.canonicalPath, 'check-ignore', '--no-index', '-z', '--stdin'],
      Buffer.from(paths.map((path) => `./${path}`).join('\0') + '\0'),
      [0, 1],
    )
    if (ignored.length) {
      throw new Error('回滚目标被当前忽略规则排除，未写入任何文件。')
    }
  }

  /** Capture two agreeing bounded traversals before publishing any reference. fsync-enabled
   * fast-import atomically installs an independent ref with immutable manifest/blob hashes. */
  async capture(
    identity: Identity,
    turnId: string,
    phase: 'baseline' | 'final',
  ): Promise<FileSnapshot> {
    const repo = await this.storage(identity, true)
    await this.git(repo, ['init', '--bare', '--object-format=sha1', repo])
    await this.requireCapacity(identity, 0)
    const before = await this.scan(identity, repo),
      after = await this.scan(identity, repo)
    if (before.fingerprint !== after.fingerprint) {
      throw new Error('两次采集不一致，未保存混合文件版本。')
    }
    const manifest = manifestSchema.parse({
      version: 1,
      directory: digest(identity.directoryKey),
      turnId,
      phase,
      files: after.files.map((file) => ({
        path: file.path,
        size: file.bytes.length,
        sha256: digest(file.bytes),
        blob: blobId(file.bytes),
      })),
    })
    // Conservative admission estimate includes raw bytes, manifests and tree/object overhead.
    // It is distinct from measured disk use and does not promise free OS disk space.
    await this.requireCapacity(
      identity,
      after.files.reduce((sum, file) => sum + file.bytes.length + 8192, 262144) +
        Buffer.byteLength(JSON.stringify(manifest)),
    )
    const chunks: Buffer[] = [
      Buffer.from(
        `commit refs/piw/${turnId}/${phase}\ncommitter Pi Workbench <local@piw.invalid> ${Math.floor(Date.now() / 1000)} +0000\ndata 0\n\ndeleteall\n`,
      ),
    ]
    const add = (path: string, bytes: Buffer) =>
      chunks.push(
        Buffer.from(`M 100644 inline ${JSON.stringify(path)}\ndata ${bytes.length}\n`),
        bytes,
        Buffer.from('\n'),
      )
    for (const file of after.files) {
      add(`files/${file.path}`, file.bytes)
    }
    add('manifest.json', Buffer.from(JSON.stringify(manifest)))
    chunks.push(Buffer.from('\ndone\n'))
    await this.git(repo, ['fast-import', '--quiet', '--done'], Buffer.concat(chunks))
    const reference = (
      await this.git(repo, ['rev-parse', '--verify', `refs/piw/${turnId}/${phase}`])
    )
      .toString('ascii')
      .trim()
    await this.verify(identity, turnId, phase, reference)
    return {
      status: 'ready',
      reference,
      capturedAt: Date.now(),
      files: after.files.length,
      bytes: after.files.reduce((sum, file) => sum + file.bytes.length, 0),
      excluded: after.excluded,
      exclusions: after.exclusions,
      diagnostic: null,
    }
  }

  /** Read immutable ledger objects, never current cwd. Also validates each raw blob and the
   * manifest binding; a missing/corrupt object cannot silently downgrade a saved baseline. */
  async verify(identity: Identity, turnId: string, phase: 'baseline' | 'final', reference: string) {
    if (!/^[a-f0-9]{40}$/.test(reference)) {
      throw new Error('文件版本引用无效。')
    }
    const repo = await this.storage(identity, false)
    const resolved = (
      await this.git(repo, ['rev-parse', '--verify', `refs/piw/${turnId}/${phase}`])
    )
      .toString('ascii')
      .trim()
    if (resolved !== reference) {
      throw new Error('文件版本引用已改变。')
    }
    const manifestBytes = await this.git(repo, ['cat-file', 'blob', `${reference}:manifest.json`])
    const manifest = manifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')))
    if (
      manifest.turnId !== turnId ||
      manifest.phase !== phase ||
      manifest.directory !== digest(identity.directoryKey)
    ) {
      throw new Error('文件版本归属不匹配。')
    }
    const paths = new Set<string>(),
      blobs = new Map<string, Buffer>()
    let total = 0
    for (const file of manifest.files) {
      if (
        paths.has(file.path) ||
        file.path.includes('\\') ||
        Array.from(file.path).some(
          (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
        ) ||
        file.path.split('/').some((part) => part === '..' || part === '') ||
        isAbsolute(file.path)
      ) {
        throw new Error('文件版本清单无效。')
      }
      paths.add(file.path)
      if ((total += file.size) > fileLedgerPolicy.snapshotBytes) {
        throw new Error('文件版本清单超过限额。')
      }
    }
    // Diff reads the files tree, whereas recovery reads manifest blobs. Require both to
    // describe exactly the same immutable bytes, including modes and the manifest itself.
    const tree = await this.git(repo, ['ls-tree', '-r', '-z', reference])
    const expected = new Map(manifest.files.map((file) => [`files/${file.path}`, file.blob]))
    expected.set('manifest.json', blobId(manifestBytes))
    for (const entry of tree.toString('utf8').split('\0').filter(Boolean)) {
      const match = /^100644 blob ([a-f0-9]{40})\t(.+)$/.exec(entry)
      if (!match || expected.get(match[2]!) !== match[1]) {
        throw new Error('文件版本树与清单不一致。')
      }
      expected.delete(match[2]!)
    }
    if (expected.size) {
      throw new Error('文件版本树缺失清单内容。')
    }
    const output = await this.git(
      repo,
      ['cat-file', '--batch'],
      Buffer.from(
        manifest.files.map((file) => file.blob).join('\n') + (manifest.files.length ? '\n' : ''),
      ),
      [0],
      34 * 1024 * 1024,
    )
    let offset = 0
    for (const file of manifest.files) {
      const end = output.indexOf(10, offset)
      if (
        end < offset ||
        output.subarray(offset, end).toString('ascii') !== `${file.blob} blob ${file.size}`
      ) {
        throw new Error('文件版本对象缺失或类型不匹配。')
      }
      offset = end + 1
      const bytes = output.subarray(offset, offset + file.size)
      offset += file.size
      if (output[offset++] !== 10) {
        throw new Error('文件版本对象读取不完整。')
      }
      if (
        bytes.length !== file.size ||
        digest(bytes) !== file.sha256 ||
        blobId(bytes) !== file.blob
      ) {
        throw new Error('文件版本内容损坏。')
      }
      blobs.set(file.path, bytes)
    }
    if (offset !== output.length) {
      throw new Error('文件版本对象包含额外内容。')
    }
    return blobs
  }
  /** Git reads only two already verified immutable commits in our bare ledger. No current
   * index/worktree, external diff command, textconv, color driver or user config is used. */
  async diffStats(identity: Identity, before: string, after: string) {
    const repo = await this.storage(identity, false)
    if (![before, after].every((ref) => /^[a-f0-9]{40}$/.test(ref))) {
      throw new Error('Diff版本引用无效。')
    }
    const output = await this.git(repo, [
      '--literal-pathspecs',
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--no-renames',
      '--numstat',
      '-z',
      before,
      after,
      '--',
      'files/',
    ])
    const result = new Map<string, { additions: number | null; deletions: number | null }>()
    for (const item of output.toString('utf8').split('\0').filter(Boolean)) {
      const match = /^(\d+|-)\t(\d+|-)\tfiles\/(.+)$/.exec(item)
      if (!match) {
        throw new Error('历史文件行数输出无效。')
      }
      result.set(match[3]!, {
        additions: match[1] === '-' ? null : Number(match[1]),
        deletions: match[2] === '-' ? null : Number(match[2]),
      })
    }
    return result
  }

  async diffPatch(
    identity: Identity,
    before: string,
    after: string,
    beforePath: string | null,
    afterPath: string | null,
  ): Promise<string> {
    const repo = await this.storage(identity, false)
    if (![before, after].every((ref) => /^[a-f0-9]{40}$/.test(ref))) {
      throw new Error('Diff版本引用无效。')
    }
    const paths = [...new Set([beforePath, afterPath].filter((p): p is string => p !== null))]
    return (
      await this.git(
        repo,
        [
          '--literal-pathspecs',
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--no-color',
          '--find-renames=100%',
          '--unified=3',
          before,
          after,
          '--',
          ...paths.map((p) => `files/${p}`),
        ],
        Buffer.alloc(0),
        [0],
        1024 * 1024,
      )
    ).toString('utf8')
  }
}
