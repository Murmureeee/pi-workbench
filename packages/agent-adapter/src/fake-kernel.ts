import type { Fixture, Scene, WorkbenchEvent } from '@pi-workbench/shared'

export function fixtureFor(scene: Scene): Fixture {
  const payloads: WorkbenchEvent['payload'][] = [
    {
      type: 'started',
      prompt: '修复登录过期后的重复跳转，并补充测试。先检查现有逻辑，保留当前页面的回跳地址。',
    },
    {
      type: 'delta',
      text: '我会先检查会话失效的处理入口，确认并发请求是否重复触发导航，再整理需要修改的边界。',
    },
  ]
  if (scene === 'new') {
    return { source: 'fake-kernel', scene, events: [] }
  }
  if (scene === 'approval' || scene === 'denied') {
    payloads.push({
      type: 'approval',
      command: 'pnpm test -- src/auth/session.test.ts',
      cwd: 'D:\\Projects\\atlas-console',
    })
  }
  if (scene === 'denied') {
    payloads.push({ type: 'denied' })
  }
  if (scene === 'stopping' || scene === 'stopped') {
    payloads.push({ type: 'stopping' })
  }
  if (scene === 'stopped') {
    payloads.push({ type: 'stopped' })
  }
  if (scene === 'settling' || scene === 'review') {
    payloads.push({ type: 'model-ended' })
  }
  if (scene === 'review') {
    payloads.push({ type: 'settled' })
  }
  if (scene === 'error') {
    payloads.push({ type: 'error', message: '离线错误样本：请求未完成，原任务与草稿保留。' })
  }
  return {
    source: 'fake-kernel',
    scene,
    events: payloads.map((payload, index) => ({
      version: 1,
      source: 'fake-kernel',
      sessionId: 'fixture-auth',
      turnId: 'fixture-turn',
      epoch: 'fixture-epoch',
      seq: index + 1,
      payload,
    })),
  }
}
