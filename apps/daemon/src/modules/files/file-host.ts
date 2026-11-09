import type { AccessService } from '../security/access.service.js'
import type { FileService } from './file.service.js'
import type { HostFileResult, Redactor } from '@pi-workbench/shared'

import { hostFileRequestSchema } from '@pi-workbench/shared'

/** Host-only parent IPC handler. Authentication is rechecked after actual IO so expiry
 * or daemon restart cannot inherit the desktop's old cookie. Never log raw payloads. */
export async function resolveHostFile(
  access: AccessService,
  files: FileService,
  redactor: Redactor,
  value: unknown,
): Promise<HostFileResult | null> {
  const request = hostFileRequestSchema.safeParse(value)
  if (!request.success) {
    return null
  }
  const q = request.data
  const denied = (message: string): HostFileResult => ({
    type: 'host-file-result',
    id: q.id,
    ok: false,
    message: redactor.text(message),
  })
  if (access.authenticate(q.cookie)?.info.kind !== 'desktop') {
    return denied('桌面身份已失效，请重新连接应用后重试；未打开目标。')
  }
  try {
    const target = await files.externalTarget(q.input)
    if (access.authenticate(q.cookie)?.info.kind !== 'desktop') {
      return denied('桌面身份在检查期间失效，请重新连接后重试。')
    }
    return { type: 'host-file-result', id: q.id, ok: true, target }
  } catch (error) {
    return denied(error instanceof Error ? error.message : '文件检查失败，请刷新后重试。')
  }
}
