// @env browser
import type { SessionTitle } from '@pi-workbench/shared'

import {
  compatibleRuntime,
  runtimeHelloSchema,
  sessionTitleFrameSchema,
} from '@pi-workbench/shared'

/** One read-only metadata socket per app. Reconnect always requests a fresh index through
 * subscribed(); no mutation is replayed. Disposal invalidates callbacks and reconnect timers. */
export class SessionTitleClient {
  private socket: WebSocket | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = true
  private generation = 0
  private attempts = 0
  constructor(
    private readonly updated: (title: SessionTitle) => void,
    private readonly subscribed: () => void,
    private readonly disconnected: (incompatible: boolean) => void,
  ) {}

  connect(): void {
    this.stopped = false
    this.open()
  }
  disconnect(): void {
    this.stopped = true
    this.generation += 1
    clearTimeout(this.timer)
    this.socket?.close()
  }
  private open(): void {
    const generation = ++this.generation
    const current = () => !this.stopped && generation === this.generation
    const socket = new WebSocket(
      `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/events`,
    )
    this.socket = socket
    let daemonId: string | undefined
    const incompatible = () => {
      this.stopped = true
      this.disconnected(true)
      socket.close()
    }
    socket.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (!current()) {
        return
      }
      try {
        const value: unknown = JSON.parse(String(event.data))
        if (!daemonId) {
          const hello = runtimeHelloSchema.parse(value)
          if (!compatibleRuntime(hello)) {
            incompatible()
            return
          }
          daemonId = hello.daemonId
          socket.send(JSON.stringify({ type: 'subscribe-titles', protocolVersion: 1 }))
          return
        }
        const frame = sessionTitleFrameSchema.parse(value)
        if (frame.daemonId !== daemonId) {
          incompatible()
          return
        }
        if (frame.type === 'titles-subscribed') {
          this.attempts = 0
          this.subscribed()
        } else {
          this.updated(frame.title)
        }
      } catch {
        incompatible()
      }
    })
    socket.addEventListener('close', (event) => {
      if (!current()) {
        return
      }
      this.disconnected(event.code === 1008)
      if (event.code === 1008) {
        this.stopped = true
        return
      }
      this.timer = setTimeout(
        () => {
          if (current()) {
            this.open()
          }
        },
        Math.min(1000 * 2 ** this.attempts++, 10000),
      )
    })
    socket.addEventListener('error', () => socket.close())
  }
}
