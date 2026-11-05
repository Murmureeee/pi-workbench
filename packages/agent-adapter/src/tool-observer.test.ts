import { expect, test } from 'vitest'

import { mergeToolObservation } from '@pi-workbench/shared'

import { ToolObserver } from './tool-observer.js'

test('installed SDK event shape preserves final parameters, nested identity, cumulative output and measured duration', () => {
  const observer = new ToolObserver('cwd')
  const start = observer.observe({
    type: 'tool_execution_start',
    toolCallId: 'child',
    toolName: 'read',
    args: { path: '中文.txt' },
    parentToolCallId: 'parent',
  })
  const update = observer.observe({
    type: 'tool_execution_update',
    toolCallId: 'child',
    toolName: 'read',
    args: { path: '中文.txt' },
    partialResult: { content: [{ type: 'text', text: '部分🙂' }] },
    parentToolCallId: 'parent',
  })
  const end = observer.observe({
    type: 'tool_execution_end',
    toolCallId: 'child',
    toolName: 'read',
    result: { content: [{ type: 'text', text: '完成🙂' }] },
    isError: false,
    durationMs: 12.5,
    parentToolCallId: 'parent',
  })
  expect(start).toMatchObject({
    id: 'child',
    parentId: 'parent',
    parameters: '{"path":"中文.txt"}',
    status: 'running',
    origin: 'sdk',
  })
  expect(update?.summary).toContain('部分🙂')
  expect(end).toMatchObject({
    parameters: start?.parameters,
    status: 'completed',
    durationMs: 12.5,
    cwd: 'cwd',
  })
  expect(end?.summary).toContain('完成🙂')
  expect(end?.exitCode).toBeUndefined()
})

test('missing starts, opaque results and a fresh turn do not invent metadata or classify errors by prose', () => {
  const observer = new ToolObserver('cwd')
  const cyclic: { self?: unknown } = {}
  cyclic.self = cyclic
  const end = observer.observe({
    type: 'tool_execution_end',
    toolCallId: 'same',
    toolName: 'custom',
    result: cyclic,
    isError: true,
  })
  expect(end?.status).toBe('error')
  expect(end?.summary).toContain('无法序列化')
  expect(end?.parameters).toBeUndefined()
  expect(end?.durationMs).toBeUndefined()
  expect(end?.parentId).toBeUndefined()
  const late = observer.observe({
    type: 'tool_execution_start',
    toolCallId: 'same',
    toolName: 'custom',
    args: { late: true },
    parentToolCallId: 'parent',
  })
  if (!end || !late) {
    throw new Error('Missing observation')
  }
  expect(mergeToolObservation(end, late)).toMatchObject({
    status: 'error',
    parentId: 'parent',
    parameters: '{"late":true}',
  })
  observer.observe({
    type: 'tool_execution_start',
    toolCallId: 'same',
    toolName: 'custom',
    args: { first: true },
  })
  observer.reset()
  expect(
    observer.observe({
      type: 'tool_execution_end',
      toolCallId: 'same',
      toolName: 'custom',
      result: 'cancelled denied',
      isError: true,
    })?.parameters,
  ).toBeUndefined()
})
