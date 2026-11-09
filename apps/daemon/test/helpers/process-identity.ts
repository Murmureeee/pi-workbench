import { execFileSync } from 'node:child_process'
import process from 'node:process'

/** Windows may reuse a reaped SDK PID while another fixture starts. Compare OS
 * creation time to prove the original child exited without targeting its successor. */
export function processBirth(pid: number): string {
  if (process.platform !== 'win32') {
    try {
      process.kill(pid, 0)
      return String(pid)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
        return ''
      }
      throw error
    }
  }
  return execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-Process | Where-Object Id -EQ ${pid} | ForEach-Object { $_.StartTime.ToUniversalTime().Ticks }`,
    ],
    { encoding: 'utf8', windowsHide: true },
  ).trim()
}
