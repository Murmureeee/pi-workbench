import type { Scene } from '@pi-workbench/shared'

export const sceneNames: Record<Scene, string> = {
  new: '新会话',
  running: '正在运行',
  approval: '等待审批',
  denied: '已拒绝',
  stopping: '正在停止',
  stopped: '已停止',
  settling: '变更收尾',
  review: '修改审查',
  error: '请求失败',
  offline: '连接中断',
}
