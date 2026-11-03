import { useQuery } from '@tanstack/react-query'

import { securitySnapshotSchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button } from '@pi-workbench/ui/components/button'

const status = {
  configured: '已配置 · 未联网验证',
  missing: '凭证缺失',
  expired: '凭证已过期',
  'command-disabled': '命令型凭证未执行',
  invalid: '凭证格式无效',
}
const diagnostics = {
  disabled: '尚未连接现有 pi 配置。请在宿主启动环境指定 PIW_PI_AGENT_DIR，再重启服务。',
  ok: '已读取现有 pi 配置；不会联网校验或刷新认证。',
  missing: '配置中未发现凭证。请通过 pi 配置凭证后刷新。',
  invalid: '配置格式无法解析。原件已保留，请在本机修复后刷新。',
  unreadable: '配置无法读取。请检查目录和访问权限后刷新。',
  'save-failed': '凭证保存失败，原配置保留。请检查写权限和磁盘空间。',
  conflict: '配置已被其他操作修改，请重新读取后再更新。',
  locked: 'pi 配置正在被其他操作占用，请等待完成后重试。',
}

/** Reads credential metadata only. No secret input, reveal control, persistent client storage,
 * or write API is available before MODEL-02 configuration is implemented.
 */
export function CredentialStatus() {
  const credentials = useQuery({
    queryKey: ['credential-status'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/security/credentials', {
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        cache: 'no-store',
      })
      if (!response.ok) {
        throw new Error(`凭证状态读取失败（${response.status}）。`)
      }
      const value: unknown = await response.json()
      const parsed = securitySnapshotSchema.safeParse(value)
      if (!parsed.success) {
        throw new Error('凭证状态协议不兼容，请匹配客户端与服务版本后刷新。')
      }
      return parsed.data
    },
    retry: false,
  })
  const data = credentials.data
  return (
    <main className="settings-page">
      <header className="flex flex-col gap-2">
        <h1>凭证与隐私</h1>
        <p className="text-muted-foreground">沿用 pi 配置，仅显示凭证状态。</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={credentials.isFetching}
          onClick={() => {
            void credentials.refetch()
          }}
        >
          刷新凭证状态
        </Button>
      </div>
      <output aria-label="凭证同步状态" aria-live="polite">
        {credentials.isError ? '凭证状态同步失败' : data ? '凭证状态已同步' : '正在读取凭证状态'}
      </output>
      {credentials.isError ? (
        <Alert variant="destructive">
          <AlertTitle>暂时无法读取</AlertTitle>
          <AlertDescription>
            {credentials.error.message}{' '}
            {data ? '以下为上次状态，不能视为当前状态。' : '请检查本地服务后刷新。'}
          </AlertDescription>
        </Alert>
      ) : null}
      {data ? (
        <>
          <Alert>
            <AlertTitle>
              配置来源 · {data.source === 'pi-native' ? '现有 pi 原生配置' : '未连接'}
            </AlertTitle>
            <AlertDescription>{diagnostics[data.diagnostic]}</AlertDescription>
          </Alert>
          <section aria-label="提供商凭证状态" className="flex flex-col gap-3">
            <h2>提供商凭证</h2>
            {data.providers.length ? (
              <ul className="flex flex-col gap-4">
                {data.providers.map((provider) => (
                  <li
                    key={`${provider.origin}:${provider.id}`}
                    className="flex flex-wrap items-center gap-2 wrap-anywhere"
                  >
                    <strong>{provider.id}</strong>
                    <Badge variant="outline">
                      {provider.origin} · {provider.kind === 'oauth' ? 'OAuth' : 'API Key'}
                    </Badge>
                    <span>{status[provider.status]}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>尚无可展示的凭证状态。</p>
            )}
          </section>
          <section aria-label="凭证保护规则" className="flex flex-col gap-2">
            <h2>保护规则</h2>
            <p>本页不显示密钥，也不执行命令型凭证。缺失或过期时，请通过 pi 更新后刷新。</p>
            <p>
              诊断、审批摘要、历史展示与下载共用脱敏规则；下载只生成副本，不修改原件。无法安全解析的二进制内容不导出。
            </p>
            <p>工作台内凭证修改与连接诊断暂未开放；当前不会发起真实模型请求。</p>
          </section>
        </>
      ) : null}
    </main>
  )
}
