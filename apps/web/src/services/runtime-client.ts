// @env browser
import type { RuntimeFrame, RuntimeSnapshot } from '@pi-workbench/shared'

import {
  applyRuntimeEvent,
  compatibleRuntime,
  runtimeCapabilities,
  runtimeFrameSchema,
  runtimeHelloSchema,
  runtimeSnapshotSchema,
} from '@pi-workbench/shared'

export interface RuntimeView {
  status: 'connecting' | 'syncing' | 'connected' | 'disconnected' | 'incompatible' | 'error'
  snapshot: RuntimeSnapshot | null
  message: string
  canMutate: false
}

/** Read-only session observer. Owns its socket, request generation, reconnect timer and fetch.
 * Disconnect/view disposal never cancels daemon work. Reconnect sends only a cursor, never a
 * prompt/approval. Failed resync keeps visible content but cannot mark it current.
 */
export class RuntimeClient {
  private view: RuntimeView = {
    status: 'connecting',
    snapshot: null,
    message: '',
    canMutate: false,
  }
  private socket: WebSocket | undefined
  private request: AbortController | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private generation = 0
  private attempts = 0
  private paused = true
  private paint: number | undefined

  constructor(
    private readonly sessionId: string,
    private readonly changed: (view: RuntimeView) => void,
  ) {}

  connect(): void {
    this.paused = false
    void this.open()
  }

  disconnect(): void {
    this.paused = true
    this.generation += 1
    this.request?.abort()
    clearTimeout(this.timer)
    this.timer = undefined
    this.socket?.close()
    this.update('disconnected', '观察已断开；后台任务继续')
  }

  private update(status: RuntimeView['status'], message = '') {
    this.view = { ...this.view, status, message }
    this.publish()
  }

  /** The authoritative cursor consumes every event immediately. Only presentation deltas
   * wait for a frame; state/approval/errors/replacements flush and cancel that frame. */
  private publish(delta = false): void {
    if (delta) {
      this.paint ??= requestAnimationFrame(() => {
        this.paint = undefined
        this.changed(this.view)
      })
      return
    }
    if (this.paint !== undefined) {
      cancelAnimationFrame(this.paint)
      this.paint = undefined
    }
    this.changed(this.view)
  }

  private async json(path: string, signal: AbortSignal): Promise<unknown> {
    const response = await fetch(path, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      credentials: 'same-origin',
      cache: 'no-store',
    })
    if (!response.ok) {
      throw new Error(`本地服务返回 ${response.status}`)
    }
    return response.json()
  }

  private incompatible() {
    this.update(
      'incompatible',
      '客户端与服务版本或能力不兼容。请匹配版本、重启后重新同步；变更请求已禁用。',
    )
    this.paused = true
    this.socket?.close()
  }

  private async open(forceSnapshot = false): Promise<void> {
    const generation = ++this.generation
    clearTimeout(this.timer)
    this.timer = undefined
    this.request?.abort()
    this.socket?.close()
    const request = new AbortController()
    this.request = request
    const current = () => !this.paused && generation === this.generation
    this.update('connecting', '正在连接本地会话')
    try {
      const parsedHello = runtimeHelloSchema.safeParse(
        await this.json('/api/protocol', request.signal),
      )
      if (!current()) {
        return
      }
      if (!parsedHello.success) {
        this.incompatible()
        return
      }
      const hello = parsedHello.data
      if (!compatibleRuntime(hello)) {
        this.incompatible()
        return
      }
      const previous = this.view.snapshot
      if (forceSnapshot || !previous || previous.daemonId !== hello.daemonId) {
        this.update('syncing', '正在读取完整快照')
        const parsedSnapshot = runtimeSnapshotSchema.safeParse(
          await this.json(
            `/api/sessions/${encodeURIComponent(this.sessionId)}/snapshot`,
            request.signal,
          ),
        )
        if (!current()) {
          return
        }
        if (!parsedSnapshot.success) {
          this.incompatible()
          return
        }
        const snapshot = parsedSnapshot.data
        if (snapshot.sessionId !== this.sessionId || snapshot.daemonId !== hello.daemonId) {
          throw new Error('快照身份不一致')
        }
        if (
          previous?.epoch === snapshot.epoch &&
          previous.daemonId === snapshot.daemonId &&
          snapshot.seq < previous.seq
        ) {
          throw new Error('快照游标倒退，保留现有内容')
        }
        this.view = { ...this.view, snapshot }
        this.publish()
      }
      const socket = new WebSocket(
        `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/events`,
      )
      this.socket = socket
      socket.addEventListener('message', (message: MessageEvent<unknown>) => {
        if (!current()) {
          return
        }
        try {
          const frame = runtimeFrameSchema.parse(JSON.parse(String(message.data)))
          this.frame(frame, generation, socket)
        } catch {
          // An unparseable frame cannot be used as a cursor or silently appended.
          this.incompatible()
        }
      })
      socket.addEventListener('close', (event) => {
        if (current() && event.code === 1008 && event.reason === 'Client authorization ended') {
          this.paused = true
          this.update('disconnected', '客户端授权已失效，请重新配对；后台任务继续')
          window.dispatchEvent(new Event('piw-auth-required'))
          return
        }
        if (current()) {
          this.retry()
        }
      })
      socket.addEventListener('error', () => {
        if (current()) {
          socket.close()
          this.retry()
        }
      })
    } catch (error) {
      if (!current()) {
        return
      }
      this.update('error', error instanceof Error ? error.message : '无法同步本地会话')
      this.retry()
    }
  }

  private frame(frame: RuntimeFrame, generation: number, socket: WebSocket) {
    const snapshot = this.view.snapshot
    if (!snapshot) {
      return
    }
    if (frame.type === 'hello') {
      if (!compatibleRuntime(frame)) {
        this.incompatible()
        return
      }
      if (frame.daemonId !== snapshot.daemonId) {
        void this.open(true)
        return
      }
      this.update('syncing', '正在重放缺失事件')
      socket.send(
        JSON.stringify({
          type: 'subscribe',
          protocolVersion: 1,
          requiredCapabilities: [...runtimeCapabilities],
          sessionId: this.sessionId,
          daemonId: snapshot.daemonId,
          epoch: snapshot.epoch,
          since: snapshot.seq,
        }),
      )
    } else if (frame.type === 'incompatible') {
      this.incompatible()
    } else if (frame.type === 'resync-required') {
      this.update('syncing', '重放不足，正在重新同步完整快照')
      void this.open(true)
    } else if (frame.type === 'caught-up') {
      if (frame.epoch !== snapshot.epoch || frame.seq !== snapshot.seq) {
        void this.open(true)
        return
      }
      this.attempts = 0
      this.update('connected', '已同步')
    } else {
      if (
        frame.event.sessionId !== snapshot.sessionId ||
        frame.event.daemonId !== snapshot.daemonId
      ) {
        this.incompatible()
        return
      }
      try {
        const next = applyRuntimeEvent(snapshot, frame.event)
        if (next === snapshot && frame.event.epoch !== snapshot.epoch) {
          void this.open(true)
          return
        }
        if (generation !== this.generation) {
          return
        }
        this.view = { ...this.view, snapshot: next }
        this.publish(frame.event.payload.type === 'message.delta')
      } catch {
        this.update('syncing', '事件缺口，正在重新同步完整快照')
        void this.open(true)
      }
    }
  }

  private retry() {
    if (this.paused || this.timer) {
      return
    }
    this.update('disconnected', '连接中断，正在重连；现有内容保留')
    const delay = Math.min(1000 * 2 ** this.attempts++, 30000)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.open()
    }, delay)
  }
}
