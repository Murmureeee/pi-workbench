/* oxlint-disable no-await-in-loop -- Bounded per-file evidence reads keep at most one descriptor active per inspection. */
import type { ChangeProvenanceService } from '../changes/change-provenance.service.js'
import type { ChangeService } from '../changes/change.service.js'
import type { WorkspaceEnvironmentService } from './workspace-environment.service.js'
import type { WorkspaceService } from './workspace.service.js'
import type { GitStatus, Redactor, WorkspaceEnvironmentTarget } from '@pi-workbench/shared'

import { createHash } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { gitStatusSchema } from '@pi-workbench/shared'

import { observeFile } from '../../infrastructure/ledger/file-observation.js'
import { readGitCommand } from './git-environment.js'

type Entry = GitStatus['entries'][number] & { head: string | null; staged: string | null }
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const oid = (bytes: Buffer, length: number) =>
  createHash(length === 64 ? 'sha256' : 'sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex')
const unknown = {
  source: 'unknown' as const,
  baselinePresent: null,
  baselineDiffersFromGit: null,
  turnId: null,
  reason: '没有可核对的轮次字节证据；来源不确定，不推断作者。',
}

/** Porcelain v2 is NUL delimited. Names, including spaces/newlines, never become shell
 * arguments. Only current-cwd descendants are admitted, even when cwd is below repo root. */
function parse(output: string, cwd: string, root: string): { entries: Entry[]; complete: boolean } {
  const tokens = output.split('\0'),
    entries: Entry[] = []
  let complete = true
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (!token || token.startsWith('# ')) {
      continue
    }
    const fields = token.split(' '),
      kind = fields[0]
    if (!['1', '2', 'u', '?'].includes(kind ?? '')) {
      throw new Error('Git状态格式不可识别。')
    }
    const start = kind === '?' ? 1 : kind === '1' ? 8 : kind === '2' ? 9 : 10
    if (fields.length <= start) {
      throw new Error('Git状态记录不完整。')
    }
    const path = relative(cwd, resolve(root, fields.slice(start).join(' ')))
      .split(sep)
      .join('/')
    const previous = kind === '2' ? tokens[++i] : null
    const previousRelative = previous
      ? relative(cwd, resolve(root, previous)).split(sep).join('/')
      : null
    const previousPath = previousRelative?.startsWith('../')
      ? '（原路径在当前执行目录外）'
      : previousRelative
    if (
      previous === undefined ||
      !path ||
      path === '..' ||
      path.startsWith('../') ||
      isAbsolute(path)
    ) {
      throw new Error('Git状态路径不属于当前执行目录。')
    }
    if (entries.length === 500) {
      complete = false
      continue
    }
    const xy = kind === '?' ? '??' : fields[1]!
    if (!/^[.MADRCUT?!]{2}$/.test(xy)) {
      throw new Error('Git状态标记不可识别。')
    }
    entries.push({
      path,
      previousPath: previousPath ?? null,
      index: xy[0]!,
      worktree: xy[1]!,
      untracked: kind === '?',
      conflict: kind === 'u',
      head: ['1', '2'].includes(kind!) ? fields[6]! : null,
      staged: ['1', '2'].includes(kind!) ? fields[7]! : null,
      ...unknown,
    })
  }
  return { entries, complete }
}

/** Desktop-only, bounded, read-only observation. Git optional locks, fsmonitor and automatic
 * maintenance are disabled; executable filters cause an explicit diagnostic. No index,
 * HEAD/config/reflog writes, network, hooks, or permission decisions occur here. */
export class GitStatusService {
  private active = 0
  constructor(
    private readonly environment: WorkspaceEnvironmentService,
    private readonly workspaces: WorkspaceService,
    private readonly changes: ChangeService,
    private readonly provenance: ChangeProvenanceService,
    private readonly redactor: Redactor,
  ) {}

  async inspect(target: WorkspaceEnvironmentTarget): Promise<GitStatus> {
    const env = await this.environment.inspect(target)
    const base = {
      target,
      cwd: env.cwd,
      checkedAt: Date.now(),
      git: env.git,
      limit: 500 as const,
      complete: false,
      entries: [],
      state: 'unavailable' as const,
      diagnostic: null as string | null,
    }
    if (env.git.status !== 'repository') {
      return gitStatusSchema.parse({
        ...base,
        state: env.git.status === 'not_repository' ? 'not_repository' : 'unavailable',
        complete: env.git.status === 'not_repository',
        diagnostic: env.git.status === 'unavailable' ? env.git.message : '当前目录不属于Git仓库。',
      })
    }
    if (this.active >= 4) {
      return { ...base, diagnostic: 'Git状态检查繁忙，请稍后刷新。' }
    }
    this.active++
    try {
      const cwd = env.resolvedCwd!
      const filters = await readGitCommand(cwd, [
        'config',
        '--name-only',
        '--get-regexp',
        '^filter\\..*\\.(clean|process|smudge)$',
      ])
      if (![0, 1].includes(Number(filters.code))) {
        throw new Error('Git配置无法安全核对，请恢复仓库后刷新。')
      }
      const filterKeys = filters.out.trim().split(/\r?\n/).filter(Boolean)
      const disabled = filterKeys.flatMap((key) => ['-c', `${key}=`])
      let hasSubmodules = false
      const attributes = async () => {
        const tracked = await readGitCommand(cwd, ['ls-files', '--stage', '-z', '--', '.'], {
          timeout: 4000,
          maxBuffer: 2 * 1024 * 1024,
        })
        if (tracked.code !== 0) {
          throw new Error('无法有界核对文件过滤器，请在外部Git检查。')
        }
        const records = tracked.out.split('\0').filter(Boolean)
        hasSubmodules = records.some((record) => record.startsWith('160000 '))
        const paths =
          records.map((record) => record.slice(record.indexOf('\t') + 1)).join('\0') +
          (records.length ? '\0' : '')
        const attrs = await readGitCommand(
          cwd,
          ['check-attr', '-z', '--stdin', 'filter'],
          { timeout: 4000, maxBuffer: 2 * 1024 * 1024 },
          paths,
        )
        if (attrs.code !== 0) {
          throw new Error('文件属性不可核对，请恢复仓库后刷新。')
        }
        const values = attrs.out.split('\0')
        const configured = new Set(
          filterKeys.map((key) =>
            key.replace(/^filter\./i, '').replace(/\.(clean|process|smudge)$/i, ''),
          ),
        )
        for (let i = 2; i < values.length; i += 3) {
          if (configured.has(values[i]!)) {
            throw new Error('当前文件使用可执行过滤器；为避免只读查看运行脚本，请在外部Git检查。')
          }
        }
        return tracked.out + '\0' + attrs.out
      }
      const attributeSnapshot = await attributes()
      const status = () =>
        readGitCommand(
          cwd,
          [
            ...disabled,
            '-c',
            'core.untrackedCache=false',
            '-c',
            'status.relativePaths=false',
            'status',
            '--porcelain=v2',
            '-z',
            '--branch',
            '--untracked-files=all',
            '--ignore-submodules=all',
            '--',
            '.',
          ],
          { timeout: 4000, maxBuffer: 2 * 1024 * 1024 },
        )
      const before = await status()
      if (before.code !== 0) {
        throw new Error('Git状态不可读、输出超过2 MiB或检查超时；请核对索引和仓库后刷新。')
      }
      const parsed = parse(before.out, cwd, env.git.root)
      const observed = await this.evidence(parsed.entries, cwd, env.git.head.commit)
      const [after, current, currentAttributes, currentFilters] = await Promise.all([
        status(),
        this.environment.inspect(target),
        attributes(),
        readGitCommand(cwd, [
          'config',
          '--name-only',
          '--get-regexp',
          '^filter\\..*\\.(clean|process|smudge)$',
        ]),
      ])
      if (
        after.code !== 0 ||
        before.out !== after.out ||
        current.resolvedCwd !== cwd ||
        currentFilters.code !== filters.code ||
        currentFilters.out !== filters.out ||
        currentAttributes !== attributeSnapshot ||
        JSON.stringify(current.git) !== JSON.stringify(env.git)
      ) {
        throw new Error('检查期间目录或Git状态已改变，请刷新；未展示混合观察。')
      }
      for (const [path, version] of observed) {
        if (JSON.stringify((await observeFile(cwd, path)).observation) !== version) {
          throw new Error('来源核对期间文件已改变，请刷新；未展示过期来源。')
        }
      }
      return gitStatusSchema.parse(
        this.redactor.value({
          ...base,
          ...parsed,
          complete: parsed.complete && !hasSubmodules,
          state: 'ready',
          entries: parsed.entries.map(({ head: _head, staged: _staged, ...entry }) => entry),
          diagnostic:
            [
              !parsed.complete ? '最多显示500项；计数仅含已显示项目，其余请在外部Git核对。' : null,
              hasSubmodules ? '子模块状态未扫描；包含子模块的结果不完整，请在外部Git核对。' : null,
            ]
              .filter(Boolean)
              .join(' ') || null,
        }),
      )
    } catch (error) {
      return {
        ...base,
        diagnostic: this.redactor.text(error instanceof Error ? error.message : 'Git状态未同步。'),
      }
    } finally {
      this.active--
    }
  }

  private async evidence(entries: Entry[], cwd: string, commit: string | null) {
    const observations = new Map<string, string>()
    // The root has already been resolved by the registered physical-identity observer.
    const workspace = this.workspaces.executionIdentity(cwd)
    const round = this.changes.latestDirectoryRound(workspace.directoryKey)
    if (!round) {
      return observations
    }
    try {
      const baseline = await this.changes.snapshotFiles(round.turnId, 'baseline')
      const final =
        round.outcome === 'active' ? null : await this.changes.snapshotFiles(round.turnId, 'final')
      const sources = final
        ? await this.provenance.analyze(round.turnId, { baseline, final })
        : null
      for (const entry of entries.slice(0, 50)) {
        const excluded = [...round.baseline.exclusions, ...round.final.exclusions].some(
          (e) => entry.path === e.path || entry.path.startsWith(e.path + '/'),
        )
        if (excluded || (!baseline.has(entry.path) && !final?.has(entry.path))) {
          entry.turnId = round.turnId
          entry.reason =
            '该文件未被版本收录或属于排除范围；不能把缺失版本当作轮前不存在，来源不确定。'
          continue
        }
        const observed = await observeFile(cwd, entry.path)
        observations.set(entry.path, JSON.stringify(observed.observation))
        if (observed.observation.status === 'unavailable') {
          continue
        }
        const before = baseline.get(entry.path) ?? null,
          after = final?.get(entry.path) ?? null
        const current = observed.observation.sha256,
          source = sources?.files.find((f) => f.path === entry.path)
        entry.turnId = round.turnId
        entry.baselinePresent = before !== null
        const gitBase = entry.staged && !/^0+$/.test(entry.staged) ? entry.staged : entry.head
        entry.baselineDiffersFromGit =
          before && gitBase && !/^0+$/.test(gitBase)
            ? oid(before, gitBase.length) !== gitBase
            : before && (entry.untracked || !commit)
              ? true
              : null
        if (before && digest(before) === current && !source?.netChanged) {
          entry.source = 'baseline-retained'
          entry.reason = '当前原始字节与最近轮前内容一致；作者未证实，Git状态以当前观察为准。'
        } else if (
          final &&
          (after ? digest(after) : null) === current &&
          source?.source === 'tool-observed'
        ) {
          entry.source = 'tool-observed'
          entry.reason = '与最终守卫的工具字节链及收尾一致；不是agent独占或人类作者证明。'
        } else {
          entry.source = source && source.source !== 'unknown' ? 'mixed' : 'unknown'
          entry.reason = '轮前、工具、收尾或当前内容存在未解释区段；来源不确定。'
        }
      }
    } catch {
      for (const entry of entries) {
        Object.assign(entry, unknown, {
          reason: '轮次版本或文件证据不可核对；Git状态仍是当前只读观察，来源不确定。',
        })
      }
    }
    return observations
  }
}
