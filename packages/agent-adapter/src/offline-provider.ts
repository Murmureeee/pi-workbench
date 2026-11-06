import type { FixtureMode } from './kernel-protocol.js'

import { randomInt } from 'node:crypto'
import { createServer } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'

import { z } from 'zod'

import { renderingFixture } from './rendering-fixture.js'

function frame(delta: unknown, finishReason: string | null = null) {
  return `data: ${JSON.stringify({ id: 'piw-offline', object: 'chat.completion.chunk', created: 0, model: 'fixture', choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`
}

/** Local, deterministic SSE provider. Never accepts a remote endpoint or credentials. */
export async function createOfflineProvider() {
  let mode: FixtureMode = 'reply'
  let requests = 0
  let blockedNetworkAttempts = 0
  let turnRequests = 0
  const server = createServer((request, response) => {
    requests += 1
    turnRequests++
    if (mode === 'error' || requests > requestLimit) {
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          error: { message: 'Offline fixture error; no retry; api_key=fixture-model-error-secret' },
        }),
      )
      return
    }
    if (mode === 'context' || mode === 'trust-context') {
      // Explicit test fixture: echo the actual SDK request context, not a synthetic SDK event.
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => {
        body += chunk
      })
      request.on('end', () => {
        try {
          const context = z
            .object({ messages: z.array(z.object({ role: z.string(), content: z.unknown() })) })
            .parse(JSON.parse(body))
          const content = JSON.stringify(
            context.messages.filter((message) =>
              mode === 'trust-context'
                ? message.role === 'system'
                : ['user', 'assistant'].includes(message.role),
            ),
          )
          response.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
          })
          response.end(
            frame({ role: 'assistant', content: content.slice(0, 8192) }) +
              frame({}, 'stop') +
              'data: [DONE]\n\n',
          )
        } catch {
          response.writeHead(400)
          response.end('Invalid context fixture request')
        }
      })
      return
    }
    if (mode === 'queue' || mode === 'queue-fast') {
      // Explicit, bounded local multi-request fixture for steering order. No remote transport.
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => {
        body += chunk
      })
      request.on('end', () => {
        const value = z
          .object({ messages: z.array(z.object({ role: z.string(), content: z.unknown() })) })
          .safeParse(JSON.parse(body))
        const users = value.success
          ? value.data.messages.filter((message) => message.role === 'user')
          : []
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        })
        response.write(frame({ role: 'assistant', content: 'INPUT06_REQUEST\n' }))
        const timer = setTimeout(
          () => {
            if (!response.destroyed) {
              response.end(
                frame({ content: JSON.stringify(users).slice(-12000) }) +
                  frame({}, 'stop') +
                  'data: [DONE]\n\n',
              )
            }
          },
          mode === 'queue' && users.length === 1 ? 45000 : 1800,
        )
        response.once('close', () => clearTimeout(timer))
      })
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    response.write(frame({ role: 'assistant', content: '' }))
    if (
      [
        'guard-read',
        'guard-denied',
        'approval-write',
        'approval-command',
        'approval-running',
        'approval-boundary',
      ].includes(mode)
    ) {
      if (turnRequests === 1) {
        const calls =
          mode === 'approval-write'
            ? [{ name: 'write', args: { path: 'APPROVED.txt', content: 'SEC02_APPROVED_ONCE' } }]
            : mode === 'approval-command' ||
                mode === 'approval-running' ||
                mode === 'approval-boundary'
              ? [
                  {
                    name: 'powershell',
                    args: {
                      command:
                        mode === 'approval-boundary'
                          ? 'Write-Output SEC10_CONTROL > MUST-NOT-EXIST'
                          : mode === 'approval-running'
                            ? 'Start-Sleep -Seconds 8'
                            : 'Set-Content -LiteralPath APPROVAL-COMMAND.txt -Value SEC02_COMMAND_ONCE',
                    },
                  },
                ]
              : mode === 'guard-read'
                ? [{ name: 'read', args: { path: 'readme.txt', limit: 20 } }]
                : [
                    { name: 'write', args: { path: 'MUST-NOT-EXIST', content: 'denied' } },
                    {
                      name: 'powershell',
                      args: {
                        command: 'Get-Content readme.txt; Set-Content MUST-NOT-EXIST denied',
                      },
                    },
                    { name: 'read', args: { path: '.env' } },
                    { name: 'read', args: { path: '../outside.txt' } },
                  ]
        response.end(
          frame({
            tool_calls: calls.map((call, index) => ({
              index,
              id: `guard-${index}`,
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.args) },
            })),
          }) +
            frame({}, 'tool_calls') +
            'data: [DONE]\n\n',
        )
      } else {
        response.end(
          frame({ content: 'GUARD_FIXTURE_DONE' }) + frame({}, 'stop') + 'data: [DONE]\n\n',
        )
      }
      return
    }
    if (mode === 'reasoning') {
      // Explicit upstream public-text fixture, parsed and persisted by the real installed SDK.
      response.write(
        frame({
          reasoning_content:
            '本地公开思考样本：先核对输入，再整理回答。api_key=fixture-only-secret',
        }),
      )
      response.write(frame({ content: 'OBS06_PUBLIC_REPLY：这是公开回答。' }))
      response.end(frame({}, 'stop') + 'data: [DONE]\n\n')
      return
    }
    if (mode === 'scrolling') {
      // Paced, fixed offline SSE for actual SDK/Electron reading-position acceptance.
      // The response owns the timer; abort/dispose closes it without another request.
      const content =
        Array.from(
          { length: 180 },
          (_, index) =>
            `离线流式第${String(index + 1).padStart(3, '0')}段：中文🙂。` +
            '回看保留当前消息与偏移，点击返回最新后继续跟随。'.repeat(2) +
            '\n\n',
        ).join('') + 'OBS04_STREAM_END'
      let offset = 0
      const timer = setInterval(() => {
        if (response.destroyed) {
          clearInterval(timer)
          return
        }
        response.write(frame({ content: content.slice(offset, offset + 97) }))
        offset += 97
        if (offset >= content.length) {
          clearInterval(timer)
          response.end(frame({}, 'stop') + 'data: [DONE]\n\n')
        }
      }, 500)
      response.once('close', () => clearInterval(timer))
      return
    }
    if (mode === 'rendering' || mode === 'rendering-long') {
      const content = renderingFixture(mode === 'rendering-long')
      for (let offset = 0; offset < content.length; offset += 97) {
        response.write(frame({ content: content.slice(offset, offset + 97) }))
      }
      response.end(frame({}, 'stop') + 'data: [DONE]\n\n')
      return
    }
    if (mode === 'unknown-tool') {
      response.write(
        frame({
          tool_calls: [
            {
              index: 0,
              id: 'offline-untrusted',
              type: 'function',
              function: {
                name: 'write',
                arguments: '{"path":"MUST-NOT-EXIST","content":"denied"}',
              },
            },
          ],
        }),
      )
      response.end(frame({}, 'tool_calls') + 'data: [DONE]\n\n')
      return
    }
    response.write(frame({ content: 'OFFLINE_' }))
    if (mode === 'hold') {
      // The response stays open until SDK abort or process disposal closes it.
      return
    }
    void delay(20).then(() => {
      if (!response.destroyed) {
        response.end(frame({ content: 'OK' }) + frame({}, 'stop') + 'data: [DONE]\n\n')
      }
      return undefined
    })
  })
  let requestLimit = 0
  // Some Windows hosts configure low ephemeral ports, including fetch-forbidden 6000.
  // Bind in the high range; only address collisions retry, before any model request exists.
  const bind = (attempt: number): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const ready = () => {
        server.off('error', failed)
        resolve()
      }
      const failed = (error: Error) => {
        server.off('listening', ready)
        reject(error)
      }
      server.once('error', failed)
      server.once('listening', ready)
      server.listen(randomInt(49152, 65536), '127.0.0.1')
    }).catch((error: unknown) => {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'EADDRINUSE') ||
        attempt === 15
      ) {
        throw error
      }
      return bind(attempt + 1)
    })
  await bind(0)
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Offline provider failed to bind loopback')
  }
  const baseUrl = `http://127.0.0.1:${address.port}/v1`
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    if (url.href !== `${baseUrl}/chat/completions`) {
      blockedNetworkAttempts += 1
      throw new Error('External provider transport disabled')
    }
    return originalFetch(input, init)
  }
  return {
    baseUrl,
    prepare(fixture: FixtureMode) {
      mode = fixture
      turnRequests = 0
      // Unknown tool completion may cause a second SDK model round. Bound it locally.
      requestLimit =
        requests +
        (fixture === 'queue' || fixture === 'queue-fast'
          ? 32
          : fixture.startsWith('guard-') || fixture.startsWith('approval-')
            ? 2
            : 1)
    },
    stats: () => ({ localRequests: requests, blockedNetworkAttempts }),
    async close() {
      globalThis.fetch = originalFetch
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    },
  }
}
