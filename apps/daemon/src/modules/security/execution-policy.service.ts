import type { ExecutionDecision, ExecutionRequest, ToolRisk } from '@pi-workbench/shared'
import type { Stats } from 'node:fs'

import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { z } from 'zod'

import { executionDigest, executionParameters } from '@pi-workbench/agent-adapter'
import { executionRequestSchema } from '@pi-workbench/shared'

type Binding = { sessionId: string; epoch: string; turnId: string; cwd: string }
const readInput = z.strictObject({
  path: z.string().min(1).max(4096),
  offset: z.number().int().min(1).max(1000000).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
})
const object = z.record(z.string(), z.unknown())
const credential =
  /(?:^|[\\/])(?:\.env(?:\..*)?|auth\.json|credentials?(?:\..*)?|id_(?:rsa|ed25519)|\.ssh|\.aws|\.gnupg|\.git)(?:$|[\\/])/i
const fingerprint = (s: Stats) =>
  [s.dev, s.ino, s.birthtimeMs, s.size, s.mtimeMs, s.ctimeMs, s.nlink].join(':')
const within = (root: string, target: string) => {
  const r = relative(root, target)
  return r !== '' && !r.startsWith('..' + sep) && r !== '..' && !isAbsolute(r)
}

/** Host-owned final-parameter policy. Only registered read is automatic and only after a
 * bounded physical file snapshot; read-only annotations never confer authority. Risk is the
 * maximum of all matching rules. This class owns no durable grants, shell or model transport.
 * Mutation/unknown calls fail closed until the separate approval/execution services exist.
 */
export class ExecutionPolicyService {
  private version = 1
  private readonly invalidation = new Set<() => void>()
  get policyVersion(): number {
    return this.version
  }
  onInvalidate(listener: () => void): () => void {
    this.invalidation.add(listener)
    return () => {
      this.invalidation.delete(listener)
    }
  }
  invalidate(): void {
    this.version++
    for (const listener of this.invalidation) {
      listener()
    }
  }

  /** Only the fixed mutation/command loadout can request a one-shot decision. A failed
   * bounded read cannot fall back to SDK IO, and unknown/linked/private paths stay blocked.
   * This validates the directory again after waiting, never grants an OS sandbox. */
  async explicitTarget(binding: Binding, request: ExecutionRequest): Promise<string> {
    if (
      !['write', 'edit', 'bash', 'powershell'].includes(request.tool) ||
      request.digest !== executionDigest(binding, request)
    ) {
      throw new Error('这个调用没有可批准的受管执行能力。')
    }
    const root = await realpath(binding.cwd),
      rootStat = await lstat(binding.cwd)
    if (root !== binding.cwd || !rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error('执行目录的物理身份已改变。')
    }
    const identities = [JSON.stringify([rootStat.dev, rootStat.ino, rootStat.birthtimeMs])]
    if (request.tool === 'bash' || request.tool === 'powershell') {
      return identities.join('|')
    }
    const fields = object.parse(JSON.parse(request.parameters))
    if (
      typeof fields.path !== 'string' ||
      credential.test(fields.path) ||
      Array.from(fields.path).some((c) => c.charCodeAt(0) < 32) ||
      /^\\\\|:[^\\/]/.test(fields.path.replace(/^[A-Za-z]:[\\/]/, ''))
    ) {
      throw new Error('私密、设备、网络或无效文件路径当前不开放执行。')
    }
    const target = resolve(root, fields.path)
    if (!within(root, target)) {
      throw new Error('附加目录授权尚未开放；不能批准 cwd 外的文件变更。')
    }
    const components = relative(root, target).split(sep)
    const paths = await Promise.all(
      components.map(async (_component, i) => {
        const path = resolve(root, ...components.slice(0, i + 1))
        let stat: Stats
        try {
          stat = await lstat(path)
        } catch (error) {
          if (
            i === components.length - 1 &&
            request.tool === 'write' &&
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          ) {
            return 'missing'
          }
          throw error
        }
        if (
          stat.isSymbolicLink() ||
          (await realpath(path)) !== path ||
          (i === components.length - 1 ? !stat.isFile() || stat.nlink !== 1 : !stat.isDirectory())
        ) {
          throw new Error('链接、硬链接或非普通文件当前不开放执行。')
        }
        return i === components.length - 1
          ? fingerprint(stat)
          : JSON.stringify([stat.dev, stat.ino, stat.birthtimeMs])
      }),
    )
    return [...identities, ...paths].join('|')
  }

  async decide(
    binding: Binding,
    value: ExecutionRequest,
    current: () => boolean = () => true,
  ): Promise<ExecutionDecision> {
    const request = executionRequestSchema.parse(value),
      version = this.version
    if (request.digest !== executionDigest(binding, request)) {
      throw new Error('Final parameters digest mismatch')
    }
    const parameters: unknown = JSON.parse(request.parameters)
    if (executionParameters(parameters) !== request.parameters) {
      throw new Error('Final parameters are not canonical JSON')
    }
    let level: ToolRisk['level'] = 'L0'
    const reasons: string[] = []
    const add = (next: ToolRisk['level'], reason: string) => {
      if (next > level) {
        level = next
      }
      reasons.push(reason)
    }
    const fields = object.safeParse(parameters)
    const filename =
      fields.success && typeof fields.data.path === 'string' ? fields.data.path : null
    const command =
      fields.success && typeof fields.data.command === 'string' ? fields.data.command : ''
    if (!['read', 'write', 'edit', 'bash', 'powershell'].includes(request.tool)) {
      add('L3', '未知或未验证工具；声明只读不能降低风险。')
    }
    if (['write', 'edit'].includes(request.tool)) {
      add('L2', '文件变更须先批准最终参数，并满足写入基线。')
    }
    if (['bash', 'powershell'].includes(request.tool)) {
      add('L2', '任意 Shell 命令须审批；不按命令名称推断只读。')
    }
    if (command && /[;\n\r|]|&&|\$\(|`|(?:rm|del|remove-item|format|shutdown)\b/i.test(command)) {
      add('L3', '组合、嵌套或破坏性命令按单次高风险裁决。')
    }
    if (/https?:\/\/|\b(?:curl|wget|invoke-webrequest|ssh|scp)\b/i.test(command)) {
      add('L3', '调用可能访问外部服务或传输数据。')
    }
    if (
      credential.test(filename ?? '') ||
      /\b(?:api[_-]?key|authorization|password|credential|token)\b/i.test(command)
    ) {
      add('L3', '涉及凭证、私密配置或仓库控制数据。')
    }
    let readText: string | undefined
    if (filename !== null) {
      const target = resolve(binding.cwd, filename)
      if (
        !within(binding.cwd, target) ||
        Array.from(filename).some((char) => char.charCodeAt(0) < 32) ||
        /^\\\\|:[^\\/]/.test(filename.replace(/^[A-Za-z]:[\\/]/, ''))
      ) {
        add('L3', '路径越出实际 cwd，或包含设备／网络／数据流形式。')
      }
    }
    if (request.tool === 'read' && level === 'L0') {
      const input = readInput.safeParse(parameters)
      if (!input.success) {
        add('L1', '读取参数未经受限读取契约验证。')
      } else {
        try {
          readText = await this.readSnapshot(binding.cwd, input.data)
        } catch {
          add('L1', '文件不可安全读取：路径、物理身份、类型、大小或内容发生变化；未自动执行。')
        }
      }
    }
    if (request.tool !== 'read' && level === 'L0') {
      add('L3', '缺少已验证的执行能力。')
    }
    if (version !== this.version || !current()) {
      add('L3', '运行代际、策略或任务已失效。')
      readText = undefined
    }
    const allowed = level === 'L0' && readText !== undefined
    if (allowed) {
      reasons.push('已核验 cwd 内普通文本文件；使用宿主捕获的只读快照。')
    }
    const risk: ToolRisk = {
      level,
      reasons,
      policyVersion: version,
      digest: request.digest,
      automatic: allowed,
    }
    return {
      id: request.id,
      digest: request.digest,
      allowed,
      reason: allowed
        ? '受限读取已核验'
        : `${level}：${reasons.join(' ')} 当前未取得有效审批，未执行。`,
      risk,
      ...(readText === undefined ? {} : { readText }),
    }
  }

  /** Opens bounded bytes once, rejects links/hardlinks/devices, validates descriptors and
   * ancestors before/after reading, and returns text only. SDK cannot reopen a checked path.
   * Another process running as this OS user remains outside this guard's sandbox claims.
   */
  private async readSnapshot(cwd: string, input: z.infer<typeof readInput>): Promise<string> {
    const root = await realpath(cwd),
      target = resolve(root, input.path)
    if (root !== cwd || !within(root, target)) {
      throw new Error('Physical root changed')
    }
    const rootBefore = await lstat(root)
    if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink()) {
      throw new Error('Root unavailable')
    }
    const components = relative(root, target).split(sep)
    const ancestors = await Promise.all(
      components.map(async (_component, index) => {
        const path = resolve(root, ...components.slice(0, index + 1))
        const stat = await lstat(path)
        if (stat.isSymbolicLink()) {
          throw new Error('Link rejected')
        }
        return { path, identity: fingerprint(stat) }
      }),
    )
    const before = await lstat(target)
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.size > 262144 ||
      (await realpath(target)) !== target
    ) {
      throw new Error('Not bounded regular file')
    }
    const descriptor = await open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    try {
      if (fingerprint(await descriptor.stat()) !== fingerprint(before)) {
        throw new Error('Descriptor changed')
      }
      const bytes = Buffer.alloc(before.size + 1)
      const { bytesRead } = await descriptor.read(bytes, 0, bytes.length, 0)
      if (
        bytesRead !== before.size ||
        fingerprint(await descriptor.stat()) !== fingerprint(before)
      ) {
        throw new Error('Read changed')
      }
      await Promise.all(
        ancestors.map(async (ancestor) => {
          if (fingerprint(await lstat(ancestor.path)) !== ancestor.identity) {
            throw new Error('Ancestor changed')
          }
        }),
      )
      if (fingerprint(await lstat(root)) !== fingerprint(rootBefore)) {
        throw new Error('Root changed')
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead))
      if (text.includes('\0')) {
        throw new Error('Binary rejected')
      }
      const lines = text.split('\n'),
        start = (input.offset ?? 1) - 1,
        limit = input.limit ?? 2000
      if (start >= lines.length) {
        throw new Error('Offset beyond file')
      }
      const excerpt = lines.slice(start, start + limit).join('\n'),
        notice = '\n[受限读取已截断；可明确指定 offset 和 limit 继续读取。]'
      return start + limit < lines.length
        ? excerpt.slice(0, 262144 - notice.length) + notice
        : excerpt
    } finally {
      await descriptor.close()
    }
  }
}
