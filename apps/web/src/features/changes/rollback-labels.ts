import type { RollbackRecord } from '@pi-workbench/shared'

export const rollbackStateLabel: Record<RollbackRecord['state'], string> = {
  prepared: '等待本次确认',
  running: '回滚处理中',
  succeeded: '回滚成功',
  cancelled: '已取消',
  conflict: '预检冲突，未写入',
  failed: '回滚失败',
  compensated: '执行失败，已条件补偿',
  'needs-recovery': '补偿冲突，现场保留',
  interrupted: '操作中断，需核对现场',
}
