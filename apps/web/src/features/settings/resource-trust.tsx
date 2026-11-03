import type { TrustResource } from '@pi-workbench/shared'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { accessSnapshotSchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button } from '@pi-workbench/ui/components/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@pi-workbench/ui/components/field'
import { Input } from '@pi-workbench/ui/components/input'
import { Separator } from '@pi-workbench/ui/components/separator'

import { readTrust, trustCommand } from '../../services/trust-client.js'

const origins = { project: '项目目录', user: '宿主指定的用户配置', 'third-party': '第三方声明' }
const kinds = {
  context: '上下文文本',
  extension: '原生扩展',
  skill: '技能资源',
  prompt: '提示模板',
  theme: '主题',
  script: '脚本 / 安装动作',
  settings: '资源设置',
  package: '第三方包',
}
const statuses = {
  untrusted: '未信任',
  trusted: '已信任此版本',
  changed: '内容已变化',
  revoked: '已撤销',
  blocked: '无法安全检查',
}

/** Source review and consent remain explicit host actions. Inspection never opens a project,
 * starts a model, installs resources or grants tools. Query keys bind late results to scope;
 * an old/error result disables consent until the current source is successfully refreshed.
 */
export function ResourceTrust() {
  const queryClient = useQueryClient()
  const access = accessSnapshotSchema.parse(queryClient.getQueryData(['client-access']))
  const csrf = access.csrf ?? ''
  const [draft, setDraft] = useState(
      () => new URLSearchParams(location.search).get('project') ?? '',
    ),
    [project, setProject] = useState(
      () => new URLSearchParams(location.search).get('project') ?? '',
    ),
    [resource, setResource] = useState<TrustResource | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [recordCount, setRecordCount] = useState(50)
  const generation = useRef(0)
  const reviewPanel = useRef<HTMLElement>(null),
    reviewTrigger = useRef<HTMLButtonElement>(null),
    operationStatus = useRef<HTMLOutputElement>(null)
  const trust = useQuery({
    queryKey: ['resource-trust', project],
    queryFn: ({ signal }) => readTrust(project, csrf, signal),
    refetchInterval: 5000,
    retry: false,
  })
  useEffect(() => {
    if (resource) {
      reviewPanel.current?.focus()
    }
  }, [resource])
  useEffect(
    () => () => {
      generation.current += 1
    },
    [],
  )
  const data = trust.data
  const canDecide = !pending && !trust.isFetching && !trust.isError
  const matchesPreview =
    resource &&
    data?.resources.some(
      (item) =>
        item.id === resource.id &&
        item.fingerprint === resource.fingerprint &&
        !item.diagnostic &&
        item.trust !== 'trusted',
    )
  const mutate = async (operation: 'grant' | 'revoke', body: unknown) => {
    const version = generation.current
    setPending(true)
    setError('')
    setNotice('')
    try {
      await trustCommand(operation, body, csrf)
      await queryClient.invalidateQueries({ queryKey: ['resource-trust'] })
      if (generation.current === version) {
        setResource(null)
        setNotice(
          operation === 'grant'
            ? '已保存此版本的资源信任；工具权限没有改变。'
            : '已撤销。后续轮次不再复用；当前轮次保留原快照，停止任务需单独操作。',
        )
        operationStatus.current?.focus()
      }
    } catch (cause) {
      if (generation.current === version) {
        setResource(null)
        setError(cause instanceof Error ? cause.message : '结果未确认，请刷新核对记录。')
      }
    } finally {
      if (generation.current === version) {
        setPending(false)
      }
    }
  }
  return (
    <main className="settings-page">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">项目与资源信任</h1>
        <p className="text-muted-foreground">先看清来源和影响，再决定是否信任这一份内容。</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={pending || trust.isFetching}
          onClick={() => {
            setResource(null)
            void trust.refetch()
          }}
        >
          刷新来源与记录
        </Button>
      </div>
      <Alert>
        <AlertTitle>资源信任与执行权限分开</AlertTitle>
        <AlertDescription>
          未信任的内容不自动加载。当前仅支持把确认后的上下文文本用于后续轮次；原生扩展、脚本、包安装及外部设置仍禁用。信任不会授予写文件、命令或网络权限。
        </AlertDescription>
      </Alert>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (pending || !draft.trim()) {
            return
          }
          generation.current += 1
          setResource(null)
          setNotice('')
          setError('')
          if (project === draft.trim()) {
            void trust.refetch()
          } else {
            setProject(draft.trim())
          }
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="trust-directory">待检查的本机目录</FieldLabel>
            <Input
              id="trust-directory"
              value={draft}
              maxLength={4096}
              disabled={pending}
              placeholder="例如 D:\Projects\my-app"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.nativeEvent.isComposing) {
                  event.preventDefault()
                }
              }}
            />
            <FieldDescription>
              只检查选定目录及 .pi 资源，不向上继承祖先目录。用户资源仅来自宿主明确指定的 pi
              配置目录；第三方引用只显示声明，不下载。
            </FieldDescription>
          </Field>
        </FieldGroup>
        <Button type="submit" disabled={pending || !draft.trim()}>
          检查资源来源
        </Button>
      </form>
      <output ref={operationStatus} tabIndex={-1} aria-label="信任同步状态" aria-live="polite">
        {trust.isError ? '信任信息同步失败' : trust.isFetching ? '正在检查资源' : '信任信息已同步'}
        {notice ? ` · ${notice}` : ''}
      </output>
      {trust.isError || error ? (
        <Alert variant="destructive">
          <AlertTitle>请先核对当前状态</AlertTitle>
          <AlertDescription>
            {error || trust.error?.message} {data ? '以下为上次信息，当前不能据此授予信任。' : ''}
          </AlertDescription>
        </Alert>
      ) : null}
      {data?.diagnostics.map((item) => (
        <Alert key={item}>
          <AlertTitle>来源检查提示</AlertTitle>
          <AlertDescription>{item}</AlertDescription>
        </Alert>
      ))}
      {data?.project ? (
        <section aria-label="发现的资源" className="flex flex-col gap-4">
          <h2 className="font-semibold">资源来源与影响</h2>
          <p className="wrap-anywhere">实际目录：{data.project}</p>
          {!data.resources.length ? (
            <p>未发现受支持的自动加载资源；未启动会话或安装动作。</p>
          ) : null}
          {data.resources.map((item) => (
            <article
              key={item.id}
              className="flex flex-col gap-3 rounded-lg border p-4 wrap-anywhere"
            >
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{origins[item.origin]}</Badge>
                <Badge variant="secondary">{kinds[item.kind]}</Badge>
                <Badge variant="outline">{statuses[item.trust]}</Badge>
              </div>
              <strong>{item.path}</strong>
              <p className="text-muted-foreground">来源：{item.source}</p>
              <p>{item.impact}</p>
              <p>
                {item.capability === 'context-only' && item.trust === 'trusted'
                  ? '下轮可加载 · 不表示当前轮次已加载'
                  : item.capability === 'context-only'
                    ? '尚未允许加载此版本'
                    : '加载与执行未启用'}
              </p>
              {item.diagnostic ? <p>{item.diagnostic}</p> : null}
              <Button
                variant="outline"
                disabled={!canDecide || !item.fingerprint || item.trust === 'trusted'}
                onClick={(event) => {
                  reviewTrigger.current = event.currentTarget
                  setResource(item)
                  setError('')
                  setNotice('')
                }}
              >
                查看并确认 · {kinds[item.kind]}
              </Button>
            </article>
          ))}
        </section>
      ) : (
        <p>输入目录查看资源，或在下方管理已保存的信任记录。</p>
      )}
      {resource ? (
        <section
          ref={reviewPanel}
          tabIndex={-1}
          aria-label="资源信任确认"
          className="flex flex-col gap-3 rounded-lg border p-4 wrap-anywhere"
        >
          <h2 className="font-semibold">确认信任这一份资源</h2>
          <p>{resource.source}</p>
          <p>{resource.impact}</p>
          <p className="font-mono text-xs">SHA-256：{resource.fingerprint}</p>
          <pre className="max-h-64 overflow-auto text-xs wrap-anywhere whitespace-pre-wrap">
            {resource.preview || '目录资源仅展示清单与摘要；不会 import 或运行内容。'}
          </pre>
          <p className="text-xs text-muted-foreground">
            预览最多 12000 字符，目录显示文件清单；指纹覆盖完整已检查内容。确认前可在本机审查全文。
          </p>
          <p>
            信任绑定实际目录、单项来源与内容指纹，重启可复用；内容或来源变化后重新确认。撤销从下一轮生效。
            {resource.capability === 'disabled'
              ? '此项只保存信任记录，当前加载和执行能力仍未启用。'
              : ''}
          </p>
          {!matchesPreview ? <p>来源已更新，请重新查看并确认；旧预览不能批准新内容。</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!canDecide || !resource.fingerprint || !matchesPreview}
              onClick={() => {
                void mutate('grant', {
                  project: data?.project,
                  id: resource.id,
                  fingerprint: resource.fingerprint,
                  confirmed: true,
                })
              }}
            >
              确认信任此版本
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                setResource(null)
                reviewTrigger.current?.focus()
              }}
            >
              取消确认
            </Button>
          </div>
        </section>
      ) : null}
      <Separator />
      <section aria-label="信任记录" className="flex flex-col gap-4">
        <h2 className="font-semibold">已保存的信任记录</h2>
        <p>记录跨重启保存，仅匹配相同目录与内容；旧记录不代表资源仍存在或当前正在加载。</p>
        {data && !data.records.length ? <p>尚无信任记录。</p> : null}
        {data?.records
          .toReversed()
          .slice(0, recordCount)
          .map((record) => (
            <article
              key={record.recordId}
              className="flex flex-col gap-2 rounded-lg border p-4 wrap-anywhere"
            >
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{origins[record.origin]}</Badge>
                <Badge variant="secondary">
                  {record.revokedAt ? '已撤销' : '已记录 · 每轮核验'}
                </Badge>
              </div>
              <strong>{record.source}</strong>
              <p>所属目录：{record.project}</p>
              <p className="font-mono text-xs">SHA-256：{record.fingerprint}</p>
              <p className="text-xs text-muted-foreground">
                确认：{new Date(record.grantedAt).toLocaleString('zh-CN')} · 客户端{' '}
                {record.grantedBy}
              </p>
              {record.revokedAt ? (
                <p>撤销：{new Date(record.revokedAt).toLocaleString('zh-CN')}</p>
              ) : (
                <Button
                  variant="outline"
                  disabled={!canDecide}
                  onClick={() => {
                    void mutate('revoke', { recordId: record.recordId })
                  }}
                >
                  撤销此项信任
                </Button>
              )}
            </article>
          ))}
        {data && data.records.length > recordCount ? (
          <Button variant="outline" onClick={() => setRecordCount((value) => value + 50)}>
            查看更多记录
          </Button>
        ) : null}
      </section>
      {data?.activeTurns.length ? (
        <section aria-label="当前轮次资源快照" className="flex flex-col gap-2">
          <h2>当前轮次保留的资源快照</h2>
          {data.activeTurns.map((turn) => (
            <p key={turn.turnId} className="wrap-anywhere">
              会话 {turn.sessionId} · 本轮 {turn.resources.length}{' '}
              项文本。撤销影响下一轮；当前任务需单独停止。
            </p>
          ))}
        </section>
      ) : null}
    </main>
  )
}
