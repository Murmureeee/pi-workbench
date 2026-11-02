import type { ReactNode } from 'react'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { accessSnapshotSchema, clientListSchema, pairRequestSchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button, buttonVariants } from '@pi-workbench/ui/components/button'
import { Field, FieldGroup, FieldLabel } from '@pi-workbench/ui/components/field'
import { Input } from '@pi-workbench/ui/components/input'

import { readPairingFragment } from '../../services/client-access.js'

async function accessJson(path: string, signal?: AbortSignal, body?: unknown, csrf?: string) {
  const response = await fetch(path, {
    signal,
    credentials: 'same-origin',
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(csrf ? { 'x-piw-csrf': csrf } : {}) },
          body: JSON.stringify(body),
        }),
  })
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? '授权无效、已使用或已过期，请重新配对。'
        : `本地操作失败（${response.status}）。`,
    )
  }
  const result: unknown = await response.json()
  return result
}

/** Authentication gates sensitive views only; the clearly labelled offline sample remains
 * public. Changing identity unmounts views and removes their private request cache.
 */
export function ClientAccess({
  children,
  initialCode,
}: {
  children: ReactNode
  initialCode: string
}) {
  const queryClient = useQueryClient(),
    identity = useRef<string | null>(null)
  const [code, setCode] = useState(initialCode),
    [label, setLabel] = useState('本机浏览器')
  const [error, setError] = useState(''),
    [pending, setPending] = useState(false)
  useEffect(() => {
    const consume = () => {
      setCode(readPairingFragment())
    }
    window.addEventListener('hashchange', consume)
    return () => window.removeEventListener('hashchange', consume)
  }, [])
  const access = useQuery({
    queryKey: ['client-access'],
    queryFn: async ({ signal }) =>
      accessSnapshotSchema.parse(
        await accessJson('/api/access', AbortSignal.any([signal, AbortSignal.timeout(5000)])),
      ),
    refetchInterval: 2000,
    retry: false,
  })
  const clientId = access.data?.client?.id ?? null,
    { refetch } = access
  useEffect(() => {
    if (identity.current && identity.current !== clientId) {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'client-access' })
    }
    identity.current = clientId
  }, [clientId, queryClient])
  useEffect(() => {
    const refresh = () => {
      void refetch()
    }
    window.addEventListener('piw-auth-required', refresh)
    return () => window.removeEventListener('piw-auth-required', refresh)
  }, [refetch])
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => document.documentElement.classList.toggle('dark', media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])
  if (access.data?.authenticated && !access.isError) {
    return <div key={clientId}>{children}</div>
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">连接本机工作台</h1>
      <p>在桌面“工作台”或托盘菜单选择“连接本机浏览器”；网页开发时在宿主终端输入 pair。</p>
      <Alert>
        <AlertTitle>一次授权，仅限本机</AlertTitle>
        <AlertDescription>
          链接两分钟有效且只能使用一次。关闭页面不会停止后台任务；服务重启或授权撤销后需要重新配对。
        </AlertDescription>
      </Alert>
      {access.isError ? (
        <Alert variant="destructive">
          <AlertTitle>无法确认授权</AlertTitle>
          <AlertDescription>{access.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>连接失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <output aria-live="polite" aria-label="客户端连接状态">
        {access.isPending ? '正在确认授权' : '需要配对'}
      </output>
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          if (pending) {
            return
          }
          const parsed = pairRequestSchema.safeParse({ code, label })
          if (!parsed.success) {
            setError('请输入有效配对令牌及不超过 64 字的客户端名称。')
            return
          }
          setPending(true)
          setError('')
          void accessJson('/api/access/pair', AbortSignal.timeout(5000), parsed.data)
            .then(async () => {
              setCode('')
              await refetch()
              return undefined
            })
            .catch((cause: unknown) => {
              setError(cause instanceof Error ? cause.message : '连接失败')
            })
            .finally(() => setPending(false))
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="pair-code">配对令牌</FieldLabel>
            <Input
              id="pair-code"
              type="password"
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="client-label">客户端名称</FieldLabel>
            <Input
              id="client-label"
              maxLength={64}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.nativeEvent.isComposing) {
                  event.preventDefault()
                }
              }}
            />
          </Field>
        </FieldGroup>
        <Button type="submit" disabled={pending || access.isPending}>
          {pending ? '正在连接' : '连接此浏览器'}
        </Button>
      </form>
      <a className={buttonVariants({ variant: 'outline' })} href="/">
        返回离线工作台
      </a>
    </main>
  )
}

export function ClientSettings() {
  const [armed, setArmed] = useState(''),
    [pending, setPending] = useState(''),
    [error, setError] = useState('')
  const queryClient = useQueryClient()
  const access = useQuery({
    queryKey: ['client-access'],
    queryFn: async ({ signal }) =>
      accessSnapshotSchema.parse(await accessJson('/api/access', signal)),
  })
  const clients = useQuery({
    queryKey: ['authorized-clients'],
    queryFn: async ({ signal }) =>
      clientListSchema.parse(await accessJson('/api/access/clients', signal)),
    refetchInterval: 2000,
  })
  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">已连接的客户端</h1>
      <p>当前客户端：{access.data?.client?.label}。服务重启后全部重新授权；本次授权最长八小时。</p>
      <a className={buttonVariants({ variant: 'outline' })} href="/">
        返回工作台
      </a>
      <Button
        variant="outline"
        disabled={clients.isFetching}
        onClick={() => {
          void clients.refetch()
        }}
      >
        刷新客户端
      </Button>
      {clients.isError || error ? (
        <Alert variant="destructive">
          <AlertTitle>客户端状态需确认</AlertTitle>
          <AlertDescription>
            {error || clients.error?.message} 旧数据不能视为当前授权。
          </AlertDescription>
        </Alert>
      ) : null}
      <section aria-label="客户端列表" className="flex flex-col gap-4">
        {clients.isPending ? <p>正在读取客户端…</p> : null}
        {clients.data?.clients.map((client) => (
          <article
            key={client.id}
            className="flex flex-col gap-3 rounded-lg border p-4 wrap-anywhere"
          >
            <strong>{client.label}</strong>
            <span className="font-mono text-xs text-muted-foreground">{client.id}</span>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{client.kind === 'desktop' ? '桌面宿主' : '浏览器'}</Badge>
              {client.id === access.data?.client?.id ? <Badge>当前客户端</Badge> : null}
            </div>
            <span>授权截止：{new Date(client.expiresAt).toLocaleString('zh-CN')}</span>
            {client.kind === 'browser' ? (
              armed === client.id ? (
                <div className="flex flex-wrap gap-2">
                  <span>撤销将立即断开此客户端，后台任务继续。</span>
                  <Button
                    variant="destructive"
                    disabled={Boolean(pending)}
                    onClick={() => {
                      setPending(client.id)
                      setError('')
                      void accessJson(
                        `/api/access/clients/${client.id}/revoke`,
                        AbortSignal.timeout(5000),
                        {},
                        access.data?.csrf ?? undefined,
                      )
                        .then(async () => {
                          setArmed('')
                          await Promise.all([
                            clients.refetch(),
                            queryClient.invalidateQueries({ queryKey: ['client-access'] }),
                          ])
                          return undefined
                        })
                        .catch((cause: unknown) =>
                          setError(cause instanceof Error ? cause.message : '撤销失败'),
                        )
                        .finally(() => setPending(''))
                    }}
                  >
                    确认撤销
                  </Button>
                  <Button
                    variant="outline"
                    disabled={Boolean(pending)}
                    onClick={() => setArmed('')}
                  >
                    取消
                  </Button>
                </div>
              ) : (
                <Button variant="outline" onClick={() => setArmed(client.id)}>
                  撤销 {client.label}
                </Button>
              )
            ) : (
              <p>桌面身份由宿主管理，退出或重启时失效。</p>
            )}
          </article>
        ))}
      </section>
    </main>
  )
}
