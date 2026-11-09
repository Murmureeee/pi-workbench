import type { EditorStatus, ExternalTarget, IdeAdapter } from '@pi-workbench/shared'

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

import { editorPreferenceSchema } from '@pi-workbench/shared'

import {
  externalFailure,
  ExternalOpenError,
  externalStamp,
  verifyExternalTarget,
} from './external-target.js'

const names = { vscode: 'VS Code 参数', jetbrains: 'JetBrains 参数', path: '仅路径，不传行号' }
type Preference = ReturnType<typeof editorPreferenceSchema.parse>

async function executable(path: string) {
  if (!isAbsolute(path) || !/\.exe$/i.test(path) || /[\p{Cc}\p{Cf}]/u.test(path)) {
    throw new ExternalOpenError('请选择真实的 .exe 程序；不执行命令脚本或快捷方式。')
  }
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink() || (await realpath(path)) !== path) {
    throw new ExternalOpenError('程序不是可核验的真实可执行文件；请重新选择。')
  }
  return { path, stamp: externalStamp(stat) }
}

/** Read-only discovery from known installations and absolute PATH entries. A code.cmd
 * entry is only an installation hint; it is never executed or interpreted by a shell. */
export function codeCandidates(environment: NodeJS.ProcessEnv): string[] {
  const bases = [
    environment.LOCALAPPDATA && join(environment.LOCALAPPDATA, 'Programs'),
    environment.ProgramFiles,
    environment['ProgramFiles(x86)'],
  ].filter((p): p is string => Boolean(p && isAbsolute(p)))
  const paths = (environment.PATH ?? '')
    .split(delimiter)
    .filter((p) => isAbsolute(p) && p.length <= 4096)
    .slice(0, 128)
  return [
    ...new Set([
      ...bases.map((p) => join(p, 'Microsoft VS Code', 'Code.exe')),
      ...paths.flatMap((p) => [join(p, 'Code.exe'), resolve(p, '..', 'Code.exe')]),
    ]),
  ]
}

/** Only fixed, documented adapters are supported. Path-only applications are explicitly
 * unable to promise a line position. No user-controlled shell/argument template exists. */
export function editorArguments(
  adapter: IdeAdapter,
  path: string,
  directory: boolean,
  line: number,
) {
  if (adapter === 'vscode') {
    return directory ? ['--new-window', path] : ['--new-window', '--goto', `${path}:${line}`]
  }
  if (adapter === 'jetbrains' && !directory) {
    return ['--line', String(line), path]
  }
  return [path]
}

/** Profile-local editor selection. Reads/discovery never launch; save is atomic and
 * keeps the previous preference on failure. External apps are never part of SDK teardown. */
export class ExternalEditor {
  private readonly preferencePath: string
  constructor(profile: string) {
    this.preferencePath = join(profile, 'external-editor.json')
  }

  private async preference(): Promise<Preference | null> {
    let observed = false
    try {
      const before = await lstat(this.preferencePath)
      observed = true
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.nlink !== 1 ||
        before.size > 16384
      ) {
        throw new ExternalOpenError('编辑器设置不可读取；请重新选择或恢复自动发现。')
      }
      const data: unknown = JSON.parse(await readFile(this.preferencePath, 'utf8'))
      if (externalStamp(before) !== externalStamp(await lstat(this.preferencePath))) {
        throw new ExternalOpenError('编辑器设置读取期间已变化；请重新核对。')
      }
      return editorPreferenceSchema.parse(data)
    } catch (error) {
      if (
        !observed &&
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return null
      }
      throw error
    }
  }
  private async program(preference: Preference | null) {
    if (preference) {
      const proof = await executable(preference.path)
      if (proof.stamp !== preference.stamp) {
        throw new ExternalOpenError('已选程序已变化；请重新选择确认，或恢复自动发现。')
      }
      return { ...proof, adapter: preference.adapter, source: 'selected' as const }
    }
    const available = await Promise.all(
      codeCandidates(process.env).map(async (path) => {
        try {
          return await executable(path)
        } catch {
          return null
        }
      }),
    )
    const found = available.find((p) => p !== null)
    if (!found) {
      throw new ExternalOpenError('未发现 VS Code；请选择已安装的编辑器，不会自动安装。')
    }
    return { ...found, adapter: 'vscode' as const, source: 'automatic' as const }
  }
  async status(): Promise<EditorStatus> {
    let source: EditorStatus['source'] = 'selected',
      adapter: IdeAdapter = 'vscode'
    try {
      const preference = await this.preference()
      source = preference ? 'selected' : 'automatic'
      adapter = preference?.adapter ?? 'vscode'
      const program = await this.program(preference)
      return {
        state: 'ready',
        source,
        adapter,
        label: source === 'automatic' ? 'VS Code（自动发现）' : `自选程序 · ${names[adapter]}`,
        diagnostic:
          program.adapter === 'path'
            ? '只传真实路径，不保证代码行号；点击打开才启动外部程序。'
            : '打开前重新核对目标和程序；外部应用独立运行。',
      }
    } catch (error) {
      return {
        state: source === 'automatic' ? 'missing' : 'invalid',
        source,
        adapter,
        label: source === 'automatic' ? 'VS Code 未就绪' : '自选编辑器不可用',
        diagnostic: externalFailure(error),
      }
    }
  }
  async select(path: string, adapter: IdeAdapter, active: () => boolean) {
    const proof = await executable(path)
    if (!active()) {
      return false
    }
    await mkdir(dirname(this.preferencePath), { recursive: true })
    const temporary = `${this.preferencePath}.${randomUUID()}.tmp`
    let created = false
    try {
      const descriptor = await open(temporary, 'wx', 0o600)
      created = true
      try {
        await descriptor.writeFile(JSON.stringify({ version: 1, ...proof, adapter }))
      } finally {
        await descriptor.close()
      }
      if (!active()) {
        return false
      }
      await rename(temporary, this.preferencePath)
      return true
    } finally {
      if (created) {
        await unlink(temporary).catch((error: unknown) => {
          if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
            throw error
          }
        })
      }
    }
  }
  async reset() {
    await unlink(this.preferencePath).catch((error: unknown) => {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
        throw error
      }
    })
  }
  /** Launch acknowledgement detects spawn/early exit failure; it cannot prove an external
   * application's later rendering. No process kill, shell interpolation or auto-replay. */
  async open(target: ExternalTarget, active: () => boolean): Promise<boolean> {
    const program = await this.program(await this.preference())
    const absolute = await verifyExternalTarget(target)
    if ((await executable(program.path)).stamp !== program.stamp) {
      throw new ExternalOpenError('程序在打开前变化；请重新选择。')
    }
    if (!active()) {
      return false
    }
    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    delete environment.NODE_OPTIONS
    const child = spawn(
      program.path,
      editorArguments(program.adapter, absolute, target.kind === 'directory', target.line),
      {
        shell: false,
        windowsHide: false,
        stdio: 'ignore',
        env: environment,
      },
    )
    await new Promise<void>((done, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      let settled = false
      const finish = (error?: Error) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        child.unref()
        if (error) {
          reject(error)
        } else {
          done()
        }
      }
      child.once('error', finish)
      child.once('exit', (code) =>
        finish(
          code === 0
            ? undefined
            : new ExternalOpenError('目标程序启动后报告失败；请检查程序或选择其它编辑器。'),
        ),
      )
      child.once('spawn', () => {
        timer = setTimeout(() => finish(), 750)
      })
    })
    return true
  }
}
