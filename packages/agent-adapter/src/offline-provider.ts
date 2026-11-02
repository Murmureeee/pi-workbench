import type { FixtureMode } from './kernel-protocol.js'

import { createServer } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'

import { z } from 'zod'

function frame(delta: unknown, finishReason: string | null = null) {
  return `data: ${JSON.stringify({ id: 'piw-offline', object: 'chat.completion.chunk', created: 0, model: 'fixture', choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`
}

/** Local, deterministic SSE provider. Never accepts a remote endpoint or credentials. */
export async function createOfflineProvider() {
  let mode: FixtureMode = 'reply'
  let requests = 0
  let blockedNetworkAttempts = 0
  const server = createServer((request, response) => {
    requests += 1
    if (mode === 'error' || requests > requestLimit) {
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Offline fixture error; no retry' } }))
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
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    response.write(frame({ role: 'assistant', content: '' }))
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
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
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
      // Unknown tool completion may cause a second SDK model round. Bound it locally.
      requestLimit = requests + 1
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
