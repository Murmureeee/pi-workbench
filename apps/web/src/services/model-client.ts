import { modelCatalogSchema } from '@pi-workbench/shared'

/** One cancellable metadata read; never sends a prompt, tests a connection or retries. */
export async function getModelCatalog(signal: AbortSignal) {
  const response = await fetch('/api/models', {
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    cache: 'no-store',
    credentials: 'same-origin',
  })
  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event('piw-auth-required'))
    }
    throw new Error(
      response.status === 403
        ? '模型发现目前仅向桌面宿主开放。'
        : `模型目录读取失败（${response.status}），请检查本地服务后刷新。`,
    )
  }
  const value: unknown = await response.json()
  const result = modelCatalogSchema.safeParse(value)
  if (!result.success) {
    throw new Error('模型目录协议不兼容，请匹配客户端与服务版本后刷新。')
  }
  return result.data
}
