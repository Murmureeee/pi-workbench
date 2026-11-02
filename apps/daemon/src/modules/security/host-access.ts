// @env node
import type { AccessService } from './access.service.js'

import process from 'node:process'
import { createInterface } from 'node:readline'

/** Interactive local host authorization, never a request log. Non-TTY launchers cannot
 * obtain a ticket through stdout. The user explicitly types `pair`; only this one-time
 * link is displayed, not cookies, model credentials or persistent administrator tokens.
 */
export function pairingConsole(
  access: AccessService,
  webOrigin: string | null = 'http://127.0.0.1:5173',
): () => void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return () => undefined
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout })
  process.stdout.write('输入 pair 并回车，生成两分钟有效的一次性配对令牌。\n')
  terminal.on('line', (line) => {
    if (line.trim() !== 'pair') {
      return
    }
    try {
      const ticket = access.issueTicket()
      process.stdout.write(
        webOrigin
          ? `本次授权链接（勿分享）：${webOrigin}/?clients#pair=${ticket.code}\n`
          : `本次配对令牌（勿分享）：${ticket.code}\n`,
      )
    } catch {
      process.stdout.write('配对名额已满，请先撤销不用的客户端或等待令牌过期。\n')
    }
  })
  return () => terminal.close()
}
