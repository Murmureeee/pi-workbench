import type { GitEnvironment } from '@pi-workbench/shared'

import { execFile } from 'node:child_process'
import { lstat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

type CommandResult = { code: number | string | null; out: string; error: string }
const unavailable = (
  code: Extract<GitEnvironment, { status: 'unavailable' }>['code'],
  message: string,
): GitEnvironment => ({ status: 'unavailable', code, message })

/** Fixed, read-only Git plumbing only: no shell, status/index refresh, hooks, filters,
 * repository scripts, network or safe.directory override. Ignore inherited GIT_* routing.
 * Each child has bounded output/time and is reaped by execFile before its promise settles. */
function run(cwd: string, args: string[]): Promise<CommandResult> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)))
  return new Promise((done) => {
    execFile(
      'git',
      ['--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', cwd, ...args],
      {
        env: { ...env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
        encoding: 'utf8',
        timeout: 1500,
        maxBuffer: 64 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) =>
        done({
          code: error ? (error.code ?? null) : 0,
          out: stdout.replace(/\r\n/g, '\n'),
          error: stderr,
        }),
    )
  })
}

async function snapshot(cwd: string): Promise<GitEnvironment> {
  const [paths, symbolic, revision] = await Promise.all([
    run(cwd, [
      'rev-parse',
      '--show-toplevel',
      '--absolute-git-dir',
      '--show-superproject-working-tree',
    ]),
    run(cwd, ['symbolic-ref', '--quiet', 'HEAD']),
    run(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']),
  ])
  if ([paths, symbolic, revision].some((result) => result.code === 'ENOENT')) {
    return unavailable('git_missing', '未找到 Git。目录与基础对话仍可使用；安装或恢复 Git 后刷新。')
  }
  if (paths.code === 128 && /not a git repository/i.test(paths.error)) {
    return unavailable('git_failed', '发现 Git 登记但无法读取，请核对仓库元数据或权限后刷新。')
  }
  if (paths.code !== 0) {
    return unavailable(
      'git_failed',
      'Git 信息无法读取或检查超时。请核对 Git 安装、目录权限及仓库信任后刷新。',
    )
  }
  const lines = paths.out.replace(/\n$/, '').split('\n'),
    [root, gitDirectory, superprojectRoot] = lines
  const oid = revision.out.trim(),
    branch = symbolic.out.trim().replace(/^refs\/heads\//, '')
  if (
    lines.length > 3 ||
    !root ||
    !gitDirectory ||
    ![root, gitDirectory, ...(superprojectRoot ? [superprojectRoot] : [])].every(
      (path) => isAbsolute(path) && !/[\p{Cc}]/u.test(path),
    )
  ) {
    return unavailable('git_failed', 'Git 路径格式无法安全识别，请在外部 Git 核对后刷新。')
  }
  const validOid = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid)
  if (
    symbolic.code === 0 &&
    branch &&
    branch.length <= 1024 &&
    !/[\p{Cc}]/u.test(branch) &&
    (validOid || revision.code === 1)
  ) {
    return {
      status: 'repository',
      root: resolve(root),
      gitDirectory: resolve(gitDirectory),
      superprojectRoot: superprojectRoot ? resolve(superprojectRoot) : null,
      head: { kind: 'branch', name: branch, commit: validOid ? oid : null },
    }
  }
  if (symbolic.code === 1 && validOid) {
    return {
      status: 'repository',
      root: resolve(root),
      gitDirectory: resolve(gitDirectory),
      superprojectRoot: superprojectRoot ? resolve(superprojectRoot) : null,
      head: { kind: 'detached', commit: oid },
    }
  }
  return unavailable('git_failed', 'Git HEAD 暂不可读，请核对仓库后刷新；不会使用上次分支。')
}

/** Distinguish absent Git from a broken/unreadable .git marker without parsing it or
 * descending into child repositories. An incomplete ancestor check remains unknown. */
async function repositoryMarker(
  cwd: string,
  remaining = 64,
): Promise<'found' | 'absent' | 'unknown'> {
  if (!remaining) {
    return 'unknown'
  }
  try {
    await lstat(join(cwd, '.git'))
    return 'found'
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
      return 'unknown'
    }
  }
  const parent = dirname(cwd)
  return parent === cwd ? 'absent' : repositoryMarker(parent, remaining - 1)
}

/** Two matching snapshots reject changes during inspection, including commits on the same
 * branch. This is a point-in-time observation, never a branch lock or execution permission. */
export async function readGitEnvironment(cwd: string): Promise<GitEnvironment> {
  // On Windows even a short-lived `git -C` holds its working directory. Never launch
  // those children just to establish that an ordinary non-Git directory has no marker.
  const marker = await repositoryMarker(cwd)
  if (marker === 'absent') {
    return (await repositoryMarker(cwd)) === 'absent'
      ? { status: 'not_repository' }
      : unavailable('changed', '检查期间 Git 登记已改变，请刷新后核对。')
  }
  if (marker === 'unknown') {
    return unavailable('git_failed', '无法完整检查 Git 来源，请核对目录权限后刷新。')
  }
  const first = await snapshot(cwd)
  if (first.status === 'unavailable') {
    return first
  }
  const second = await snapshot(cwd)
  return JSON.stringify(first) === JSON.stringify(second)
    ? second
    : unavailable('changed', '检查期间 Git 环境已改变，请刷新后核对。')
}
