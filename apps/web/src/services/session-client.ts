import type { SessionSubmit } from '@pi-workbench/shared'

import {
  compatibleRuntime,
  runtimeCapabilities,
  runtimeHelloSchema,
  sessionReceiptSchema,
} from '@pi-workbench/shared'

export class SessionRequestError extends Error {
  constructor(
    message: string,
    readonly uncertain: boolean,
  ) {
    super(message)
  }
}

/** A bounded request without automatic mutations/retries. A lost POST response is explicitly
 * uncertain; callers must reconcile the immutable request ID before allowing another input.
 */
export async function sessionJson(
  path: string,
  signal?: AbortSignal,
  body?: unknown,
  csrf?: string,
): Promise<unknown> {
  if (body !== undefined) {
    let response: Response
    try {
      response = await fetch('/api/protocol', {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      })
    } catch {
      throw new SessionRequestError('未能连接本地服务，尚未发送任务；请恢复连接后重试。', false)
    }
    const hello = runtimeHelloSchema.safeParse(await response.json().catch(() => null))
    if (!response.ok || !hello.success || !compatibleRuntime(hello.data)) {
      throw new SessionRequestError('客户端与服务协议不兼容，请更新并重新同步。', false)
    }
  }
  let response: Response
  try {
    response = await fetch(path, {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
      cache: 'no-store',
      credentials: 'same-origin',
      ...(body === undefined
        ? {}
        : {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-piw-csrf': csrf ?? '',
              'x-piw-protocol': '1',
              'x-piw-capabilities': runtimeCapabilities.join(','),
            },
            body: JSON.stringify(body),
          }),
    })
  } catch {
    throw new SessionRequestError(
      '本地连接中断，提交结果待确认；请核对原请求。草稿仍保留。',
      body !== undefined,
    )
  }
  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event('piw-auth-required'))
    }
    const value: unknown = await response.json().catch(() => null)
    const message =
      value && typeof value === 'object' && 'message' in value && typeof value.message === 'string'
        ? value.message
        : `本地操作失败（${response.status}）。`
    throw new SessionRequestError(message, body !== undefined && response.status >= 500)
  }
  try {
    return await response.json()
  } catch {
    throw new SessionRequestError('响应未能读取，请核对原请求；不会自动重发。', body !== undefined)
  }
}

export async function findSubmission(requestId: string) {
  const response = await fetch(`/api/chat/submissions/${encodeURIComponent(requestId)}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    signal: AbortSignal.timeout(10000),
  })
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new SessionRequestError('未能确认原请求，请恢复连接后再次核对。', true)
  }
  return readReceipt(await response.json(), requestId)
}
function readReceipt(value: unknown, requestId: string) {
  const receipt = sessionReceiptSchema.parse(value)
  if (
    receipt.submission.requestId !== requestId ||
    receipt.submission.sessionId !== receipt.session.id
  ) {
    throw new SessionRequestError('提交结果身份不一致，请重新核对原请求。', true)
  }
  return receipt
}
export async function submitSession(input: SessionSubmit, csrf: string) {
  try {
    return readReceipt(
      await sessionJson('/api/chat/submit', undefined, input, csrf),
      input.requestId,
    )
  } catch (error) {
    if (!(error instanceof SessionRequestError) || error.uncertain) {
      const receipt = await findSubmission(input.requestId).catch(() => null)
      if (receipt) {
        return receipt
      }
      throw new SessionRequestError(
        error instanceof Error ? error.message : '提交结果待确认，请核对原请求。',
        true,
      )
    }
    throw error
  }
}
