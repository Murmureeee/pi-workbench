import { useQuery } from '@tanstack/react-query'

import { resourceSnapshotSchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button } from '@pi-workbench/ui/components/button'

const reasons = {
  'kernel-limit': '内核名额已满，等待空闲内核释放',
  'model-limit': '模型任务名额已满',
  'directory-busy': '同一物理目录或重叠目录仍被另一轮占用',
  'starting-kernel': '正在等待或启动内核',
  running: '运行中',
}
const states: Record<string, string> = {
  starting: '启动中',
  ready: '空闲',
  running: '运行中',
  stopping: '停止中',
  stopped: '已停止',
  disposing: '回收中',
  disposed: '已回收',
  failed: '内核失败',
}

/** CORE-07 read-only resource diagnostics. Query ownership cancels only HTTP observation;
 * leaving this view never cancels daemon work or restores queued tasks.
 */
export function ResourceObserver() {
  const resources = useQuery({
    queryKey: ['kernel-resources'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/kernels/resources', {
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (!response.ok) {
        throw new Error(`本地服务返回 ${response.status}`)
      }
      const data: unknown = await response.json()
      const parsed = resourceSnapshotSchema.safeParse(data)
      if (!parsed.success) {
        throw new Error('资源协议不兼容，请匹配客户端与服务版本后刷新。')
      }
      return parsed.data
    },
    retry: false,
    refetchInterval: 1000,
  })
  const data = resources.data
  const queued = data?.queue.filter((item) => item.stage === 'queued') ?? []
  return (
    <main className="settings-page">
      <h1>资源运行状态 · 只读</h1>
      <p>真实 SDK + 本地模型夹具；受限读取经宿主核验，写入和命令未批准不执行，真实提供商关闭。</p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={resources.isFetching}
          onClick={() => {
            void resources.refetch()
          }}
        >
          刷新资源状态
        </Button>
      </div>
      <output aria-label="资源同步状态" aria-live="polite">
        {resources.isError ? '资源同步失败' : data ? '资源已同步' : '正在读取资源状态'}
      </output>
      {resources.isError ? (
        <Alert variant="destructive">
          <AlertTitle>资源状态暂不可用</AlertTitle>
          <AlertDescription>
            {resources.error.message}{' '}
            {data ? '以下保留上次读取的状态，不能视为当前状态。' : '请检查本地服务后刷新。'}
          </AlertDescription>
        </Alert>
      ) : null}
      {data ? (
        <>
          <section aria-label="资源限额" className="flex flex-col gap-2">
            <h2>当前占用与限额</h2>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                内核 {data.kernels.length} / {data.limits.kernels}
              </Badge>
              <Badge variant="outline">
                模型任务 {data.modelTasks} / {data.limits.modelTasks}
              </Badge>
              <Badge variant="secondary">终端预算 {data.limits.terminals} · 待接入</Badge>
            </div>
            <p>
              空闲 {data.limits.idleMs / 1000} 秒后回收；运行与待审批内核保留。界面缓存独立管理。
            </p>
          </section>
          <section aria-label="资源等待队列" className="flex flex-col gap-2">
            <h2>等待队列 · {queued.length}</h2>
            <p>
              内核和模型各自按先后顺序排队。目录等待不占用名额，独立目录可继续执行。取消由任务入口处理；本页仅观察。
            </p>
            {queued.length ? (
              <ul className="flex flex-col gap-3">
                {queued.map((item) => (
                  <li key={item.id} className="flex flex-col gap-1 wrap-anywhere">
                    <span>
                      {item.reason === 'directory-busy'
                        ? '目录'
                        : item.kind === 'kernel'
                          ? '内核'
                          : '模型'}
                      队列 · 第 {item.position} 位 · {reasons[item.reason]}
                    </span>
                    <span className="text-muted-foreground">会话 {item.sessionId}</span>
                    {item.directoryOwner ? (
                      <span className="text-muted-foreground">
                        占用会话 {item.directoryOwner.sessionId} · 轮次 {item.directoryOwner.turnId}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p>当前没有等待请求。</p>
            )}
          </section>
          <section aria-label="活跃内核" className="flex flex-col gap-2">
            <h2>活跃内核 · {data.kernels.length}</h2>
            <ul className="flex flex-col gap-3">
              {data.kernels.map((kernel) => (
                <li key={kernel.epoch} className="flex flex-col gap-1 wrap-anywhere">
                  <span>
                    {kernel.waitingApproval
                      ? '等待审批 · 不回收'
                      : kernel.retiring
                        ? '正在回收'
                        : (states[kernel.state] ?? kernel.state)}{' '}
                    · PID {kernel.pid ?? '尚未就绪'}
                  </span>
                  <a
                    className="underline underline-offset-4"
                    href={`/?observe=${encodeURIComponent(kernel.sessionId)}`}
                  >
                    会话 {kernel.sessionId}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </main>
  )
}
