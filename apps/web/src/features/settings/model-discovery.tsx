import type { ModelProvider } from '@pi-workbench/shared'

import { useQuery } from '@tanstack/react-query'
import { RefreshCwIcon } from 'lucide-react'
import { useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button, buttonVariants } from '@pi-workbench/ui/components/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@pi-workbench/ui/components/field'
import { Input } from '@pi-workbench/ui/components/input'
import { Separator } from '@pi-workbench/ui/components/separator'

import { getModelCatalog } from '../../services/model-client.js'

const authStatus = {
  configured: '已配置 · 未联网验证',
  missing: '凭证缺失',
  expired: '凭证已过期',
  'command-disabled': '命令型凭证未执行',
  invalid: '凭证格式无效',
  unchecked: '环境 / 平台认证未检查',
}
const fileStatus = {
  disabled: '未连接',
  ok: '已读取',
  missing: '未找到',
  invalid: '格式无效',
  unreadable: '无法读取',
  'too-large': '超过 4 MiB 上限',
}
const issueText = {
  none: '',
  'config-error':
    '模型配置未通过 SDK 校验，当前显示的内置目录可能是回退值。请在 pi 的 models.json 修复后刷新。',
  'not-in-sdk':
    '当前 SDK 未注册此提供商。仅有凭证不会加载扩展或获得模型；请核对 pi 的 models.json。',
  'no-models':
    '离线目录没有模型。该提供商可能需要联网发现；本页不联网，请通过 pi 配置明确模型后刷新。',
}
const parametersText = {
  ok: '',
  missing: '请求头所需值缺失',
  'command-disabled': '命令型请求头未执行',
  invalid: '端点格式无效',
}

function ProviderDetails({ provider, search }: { provider: ModelProvider; search: string }) {
  const [limit, setLimit] = useState(10)
  const matchProvider = `${provider.name} ${provider.id}`.toLowerCase().includes(search)
  const models = matchProvider
    ? provider.models
    : provider.models.filter((model) => `${model.id} ${model.name}`.toLowerCase().includes(search))
  return (
    <section
      aria-label={`提供商 ${provider.id}`}
      className="model-provider flex min-w-0 flex-col gap-3 wrap-anywhere"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">{provider.name}</h2>
          <p className="text-xs text-muted-foreground">{provider.id}</p>
        </div>
        <Badge variant={provider.authentication.status === 'configured' ? 'secondary' : 'outline'}>
          {authStatus[provider.authentication.status]}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        来源：
        {provider.origins
          .map((origin) => (origin === 'pi-sdk' ? 'pi SDK 内置目录' : origin))
          .join(' + ')}{' '}
        · 认证：
        {provider.authentication.origin === 'none'
          ? '未读取环境或平台凭证'
          : `${provider.authentication.origin} / ${provider.authentication.kind === 'oauth' ? 'OAuth' : provider.authentication.kind === 'api_key' ? 'API Key' : '未知类型'}`}
      </p>
      {provider.issue !== 'none' ? <p>{issueText[provider.issue]}</p> : null}
      {provider.authentication.status !== 'configured' ? (
        <p className="text-muted-foreground">
          {provider.authentication.status === 'unchecked'
            ? '仅列出 SDK 已知模型；环境变量、系统凭证和账号权益尚未验证。'
            : '请通过 pi 检查或更新凭证后刷新；本页不会执行凭证命令或刷新 OAuth。'}
        </p>
      ) : null}
      {models.length ? (
        <ul aria-label={`${provider.id} 模型列表`} className="flex flex-col gap-3">
          {models.slice(0, limit).map((model) => (
            <li key={`${model.type}:${model.id}`} className="model-entry flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <strong>{model.name}</strong>
                <Badge variant="outline">
                  {model.type === 'chat' ? '对话' : model.type === 'image' ? '图像生成' : '分类'}
                </Badge>
                <Badge variant="outline">
                  {model.origin === 'pi-sdk' ? 'SDK 内置' : 'models.json'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {model.id} · {model.api}
              </p>
              <p className="text-xs text-muted-foreground">
                输入 {model.input.join(' / ')}
                {model.reasoning ? ' · 支持推理' : ''}
                {model.contextWindow
                  ? ` · 上下文 ${model.contextWindow.toLocaleString()} token`
                  : ''}
                {model.maxTokens ? ` · 最大输出 ${model.maxTokens.toLocaleString()} token` : ''}
              </p>
              {!model.sdkSupported ? (
                <p>当前 SDK 未提供此 API 的实现；请在 pi 的 models.json 核对 API 类型后刷新。</p>
              ) : null}
              {model.parameters !== 'ok' ? (
                <p>{parametersText[model.parameters]}；请在 pi 配置中检查后刷新。</p>
              ) : null}
              <span className="text-xs">工作台真实传输未开放 · 未联网验证</span>
            </li>
          ))}
        </ul>
      ) : null}
      {models.length > limit ? (
        <Button variant="outline" onClick={() => setLimit((current) => current + 20)}>
          显示更多 {provider.id} 模型（{limit} / {models.length}）
        </Button>
      ) : null}
    </section>
  )
}

/** Desktop-first, read-only catalog. Query cancellation belongs to this view; leaving it
 * never stops daemon work. Refresh failure retains its previous snapshot explicitly stale.
 */
export function ModelDiscovery() {
  const desktop = Boolean(window.piWorkbench)
  const [search, setSearch] = useState('')
  const [configuredOnly, setConfiguredOnly] = useState(true)
  const [providerLimit, setProviderLimit] = useState(10)
  const catalog = useQuery({
    queryKey: ['model-catalog'],
    queryFn: ({ signal }) => getModelCatalog(signal),
    enabled: desktop,
    retry: false,
  })
  const data = catalog.data,
    term = search.trim().toLowerCase()
  const providers =
    data?.providers.filter(
      (provider) =>
        (!configuredOnly ||
          provider.origins.includes('auth.json') ||
          provider.origins.includes('models.json')) &&
        (!term ||
          `${provider.id} ${provider.name}`.toLowerCase().includes(term) ||
          provider.models.some((model) =>
            `${model.id} ${model.name}`.toLowerCase().includes(term),
          )),
    ) ?? []
  return (
    <main className="settings-page">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">模型与提供商</h1>
          <p className="text-muted-foreground">读取现有 pi 配置，核对模型来源与本地能力。</p>
        </div>
      </header>
      <Separator />
      {!desktop ? (
        <Alert>
          <AlertTitle>请在桌面查看模型</AlertTitle>
          <AlertDescription>
            网页版独立模型发现暂缓。请从 Electron 的“文件 → 模型与提供商”进入。
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <Alert>
            <AlertTitle>本地发现 · 未联网验证</AlertTitle>
            <AlertDescription>
              已配置仅表示本地存在凭证，不代表连接可用、模型授权或订阅权益。工作台真实传输仍关闭；本页不测试连接、不发起模型请求，也不改写配置。其他产品账号不会自动赋予
              pi API 或订阅权限。
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              disabled={catalog.isFetching}
              onClick={() => {
                void catalog.refetch()
              }}
            >
              <RefreshCwIcon data-icon="inline-start" />
              {catalog.isFetching ? '正在读取…' : '刷新模型目录'}
            </Button>
            <a className={buttonVariants({ variant: 'ghost' })} href="/?credentials">
              凭证状态与配置指引
            </a>
            <output aria-label="模型同步状态" aria-live="polite">
              {catalog.isError
                ? '模型目录同步失败'
                : catalog.isFetching
                  ? '正在读取本地模型目录'
                  : data
                    ? '模型目录已同步'
                    : '等待本地服务'}
            </output>
          </div>
          {catalog.isError ? (
            <Alert variant="destructive">
              <AlertTitle>暂时无法读取模型目录</AlertTitle>
              <AlertDescription>
                {catalog.error.message}{' '}
                {data ? '以下为上次状态，不能视为当前状态。' : '请检查本地服务后刷新。'}
              </AlertDescription>
            </Alert>
          ) : null}
          {data ? (
            <>
              <section aria-label="模型配置来源" className="flex flex-col gap-2">
                <h2 className="font-semibold">配置来源</h2>
                <p className="wrap-anywhere">
                  {data.sourceDirectory ??
                    '尚未连接现有 pi 配置。请在宿主启动环境指定 PIW_PI_AGENT_DIR，重启后再查看。'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">pi SDK {data.sdkVersion}</Badge>
                  {data.files.map((file) => (
                    <Badge key={file.name} variant="outline">
                      {file.name} · {fileStatus[file.state]}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  通过 pi 管理 auth.json、models.json 和
                  settings.json，然后刷新本页。工作台内编辑配置与连接诊断暂未开放。
                </p>
                {data.defaultModel ? (
                  <p>
                    pi 默认模型：{data.defaultModel.provider} / {data.defaultModel.model} ·{' '}
                    {data.defaultModel.found
                      ? '已在本地目录找到'
                      : '当前目录未找到，请核对 settings.json'}
                    ；不会自动改选。
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    settings.json 未指定完整默认模型；本页不会自动选择。
                  </p>
                )}
              </section>
              {data.diagnostic === 'config-error' ? (
                <Alert variant="destructive">
                  <AlertTitle>部分配置不可用</AlertTitle>
                  <AlertDescription>
                    请检查上方文件状态与提供商提示。SDK
                    校验失败时可能仅显示内置回退目录，不能视为有效自定义配置；原件保留，修复后刷新。
                  </AlertDescription>
                </Alert>
              ) : null}
              <FieldGroup className="gap-3">
                <Field>
                  <FieldLabel htmlFor="model-search">搜索提供商或模型</FieldLabel>
                  <Input
                    id="model-search"
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="输入名称或模型 ID"
                  />
                  <FieldDescription>搜索仅筛选本地目录，不访问提供商。</FieldDescription>
                </Field>
              </FieldGroup>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant={configuredOnly ? 'secondary' : 'outline'}
                  aria-pressed={configuredOnly}
                  onClick={() => setConfiguredOnly((current) => !current)}
                >
                  仅看已有配置
                </Button>
                <output aria-live="polite">
                  {configuredOnly ? '已有配置' : '全部 SDK 目录'} · {providers.length} 个提供商
                </output>
              </div>
              <div aria-label="提供商与模型目录" className="flex flex-col gap-4 pb-4">
                {providers.length ? (
                  providers
                    .slice(0, providerLimit)
                    .map((provider) => (
                      <ProviderDetails
                        key={`${provider.id}:${term}`}
                        provider={provider}
                        search={term}
                      />
                    ))
                ) : (
                  <Alert>
                    <AlertTitle>
                      {term ? '没有匹配的模型或提供商' : '尚无已有提供商配置'}
                    </AlertTitle>
                    <AlertDescription>
                      {term
                        ? '请调整搜索词或切换为全部 SDK 提供商。'
                        : '连接 pi 配置目录后刷新，或切换查看 SDK 内置目录；内置目录不表示已获得访问权限。'}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
              {providers.length > providerLimit ? (
                <Button
                  variant="outline"
                  onClick={() => setProviderLimit((current) => current + 10)}
                >
                  显示更多提供商（{providerLimit} / {providers.length}）
                </Button>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </main>
  )
}
