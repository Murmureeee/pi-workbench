import type { AccessService } from '../security/access.service.js'
import type { FileService } from './file.service.js'
import type { HostFileResult, HostPreviewResult, Redactor } from '@pi-workbench/shared'

import { hostFileRequestSchema, hostPreviewRequestSchema } from '@pi-workbench/shared'

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

/** Preview bytes use the same parent-only desktop identity, rechecked after IO. The
 * child receives a bounded immutable snapshot; no HTML endpoint or reusable URL exists. */
export async function resolveHostPreview(
  access: AccessService,
  files: FileService,
  redactor: Redactor,
  value: unknown,
): Promise<HostPreviewResult | null> {
  const parsed = hostPreviewRequestSchema.safeParse(value)
  if (!parsed.success) {
    return null
  }
  const q = parsed.data
  try {
    if (access.authenticate(q.cookie)?.info.kind !== 'desktop') {
      throw Error('桌面身份已失效，请重新连接后重试。')
    }
    const snapshot = await files.preview(q.input)
    if (access.authenticate(q.cookie)?.info.kind !== 'desktop') {
      throw Error('检查期间桌面身份已失效；未加载预览。')
    }
    return q.checkOnly
      ? {
          type: 'host-preview-result',
          id: q.id,
          ok: true,
          verification: { version: snapshot.version, checkedAt: snapshot.checkedAt },
        }
      : { type: 'host-preview-result', id: q.id, ok: true, snapshot }
  } catch (error) {
    return {
      type: 'host-preview-result',
      id: q.id,
      ok: false,
      message: redactor.text(
        error instanceof Error ? error.message : '预览检查失败；请刷新或使用原件入口。',
      ),
    }
  }
}
