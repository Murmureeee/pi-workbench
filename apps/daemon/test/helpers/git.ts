import { execFileSync } from 'node:child_process'

/** Local fixture setup only. No remote operation or user Git configuration is changed. */
export function fixtureGit(cwd: string, ...args: string[]) {
  return execFileSync(
    'git',
    [
      '-c',
      'core.autocrlf=false',
      '-c',
      'user.name=Offline Test',
      '-c',
      'user.email=offline@example.invalid',
      '-C',
      cwd,
      ...args,
    ],
    { encoding: 'utf8', windowsHide: true },
  ).trim()
}
