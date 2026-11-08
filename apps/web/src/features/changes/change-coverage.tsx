import type { ChangeCoverage } from '@pi-workbench/shared'

import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button } from '@pi-workbench/ui/components/button'

import { useChangeCoverage } from '../../services/change-coverage.js'

const mib = (bytes: number) =>
  (bytes / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 2 })
const labels = { full: '可回滚', partial: '部分可回滚', none: '不可回滚' }

/** Approval and historical detail use identical terminology and host limits. Scope describes
 * file bytes only; authorship, current conflicts and single-use approvals remain independent. */
export function CoverageSummary({ value }: { value: ChangeCoverage | null }) {
  if (!value) {
    return <p>回滚范围未知；本次调用仍须明确确认不可回滚执行。</p>
  }
  const storage = value.storage
  return (
    <section aria-label="回滚范围说明" className="flex min-w-0 flex-col gap-2 break-words">
      <div>
        <Badge variant={value.state === 'none' ? 'destructive' : 'outline'}>
          {labels[value.state]}
        </Badge>{' '}
        · {value.basis === 'baseline' ? '写入前观察，收尾尚未保证' : '所选轮次版本'}
      </div>
      <p>
        仅普通文件字节，含限额内二进制；Diff
        能力另行判断。来源不确定时须单独确认覆盖，范围说明不授予权限。
      </p>
      {[...new Set(value.reasons)].map((reason) => (
        <p key={reason}>{reason}</p>
      ))}
      <p>
        限制：单文件 {mib(value.limits.fileBytes)} MiB，单阶段 {mib(value.limits.snapshotBytes)}{' '}
        MiB，{value.limits.entries} 项／{value.limits.depth}{' '}
        层。忽略项、超限大文件、链接／硬链接、目录外路径、ACL、空目录及命令外部副作用不受保护。
      </p>
      <p>
        账本 Git 对象磁盘估算：
        {storage.usedBytes === null ? '未知' : `${mib(storage.usedBytes)} MiB`}／
        {mib(storage.limitBytes)}{' '}
        MiB；80%预警。保留所有已发布版本，自动清理关闭；接受或重启不会回收必要版本。
      </p>
      {storage.state !== 'normal' ? (
        <Alert variant={storage.state === 'warning' ? 'default' : 'destructive'}>
          <AlertTitle>
            {storage.state === 'warning'
              ? '账本容量预警'
              : storage.state === 'full'
                ? '账本容量已满'
                : '账本容量未知'}
          </AlertTitle>
          <AlertDescription>
            {storage.diagnostic ?? '旧版本保留；新采集按容量检查，不能通过静默清理放行。'}
          </AlertDescription>
        </Alert>
      ) : null}
      {value.baselineExcluded || value.finalExcluded ? (
        <details>
          <summary>
            排除范围：基线 {value.baselineExcluded} 条／收尾 {value.finalExcluded} 条
          </summary>
          <p>每阶段最多列举32条原因，目录项可代表其整个子树。</p>
          <ul>
            {value.exclusions.map((entry) => (
              <li key={JSON.stringify([entry.path, entry.reason])}>
                {entry.path}：{entry.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}

export function ChangeCoveragePanel({ sessionId, turnId }: { sessionId: string; turnId: string }) {
  const query = useChangeCoverage(sessionId, turnId)
  return (
    <section aria-label="范围、容量与版本保留" className="flex min-w-0 flex-col gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
      >
        重新核对回滚范围
      </Button>
      {query.isPending ? <output>正在验证回滚范围与容量…</output> : null}
      {query.isError ? (
        <Alert variant="destructive">
          <AlertTitle>回滚范围未同步，回滚已禁用</AlertTitle>
          <AlertDescription>{query.error.message}</AlertDescription>
        </Alert>
      ) : query.data ? (
        <CoverageSummary value={query.data} />
      ) : null}
      {query.data && !query.isError && !query.data.rollbackAvailable ? (
        <p>当前回滚已禁用；请核对上述版本、轮次与容量原因。</p>
      ) : null}
    </section>
  )
}
