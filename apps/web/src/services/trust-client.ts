import { trustSnapshotSchema } from '@pi-workbench/shared'

/** All trust mutations use paired identity + CSRF. No browser storage or direct SDK transport. */
export async function trustCommand(
  path: string,
  body: unknown,
  csrf: string,
  signal?: AbortSignal,
) {
  const response = await fetch(`/api/trust/${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
      : AbortSignal.timeout(10000),
    headers: { 'content-type': 'application/json', 'x-piw-csrf': csrf },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(
      response.status === 409
        ? '来源已变化或无法完整检查，请刷新后重新确认。'
        : response.status === 401
          ? '客户端授权失效，请重新配对。'
          : `资源操作失败（${response.status}），请刷新核对。`,
    )
  }
  const value: unknown = await response.json()
  return value
}

export async function readTrust(project: string, csrf: string, signal: AbortSignal) {
  if (project) {
    return trustSnapshotSchema.parse(await trustCommand('inspect', { project }, csrf, signal))
  }
  const response = await fetch('/api/trust', {
    signal,
    cache: 'no-store',
    credentials: 'same-origin',
  })
  if (!response.ok) {
    throw new Error(`信任记录读取失败（${response.status}），请刷新或重新配对。`)
  }
  const value: unknown = await response.json()
  return trustSnapshotSchema.parse(value)
}
