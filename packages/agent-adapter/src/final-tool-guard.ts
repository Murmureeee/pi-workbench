import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { ExecutionDecision, ExecutionRequest } from '@pi-workbench/shared'

import { createHash, randomUUID } from 'node:crypto'

import { executionDecisionSchema, executionRequestSchema } from '@pi-workbench/shared'

/** Canonical bounded JSON rejects non-JSON values instead of silently dropping parameters. */
export function executionParameters(value: unknown, depth = 0): string {
  if (depth > 20) {
    throw new Error('Tool parameters exceed nesting limit')
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length || Object.getOwnPropertySymbols(value).length) {
      throw new Error('Tool arrays must be plain JSON')
    }
    return `[${Array.from({ length: value.length }, (_unused, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || !('value' in descriptor)) {
        throw new Error('Executable array parameters rejected')
      }
      return executionParameters(descriptor.value, depth + 1)
    }).join(',')}]`
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    if (Object.getOwnPropertySymbols(value).length) {
      throw new Error('Tool parameters must be plain JSON')
    }
    return `{${Object.keys(value)
      .toSorted()
      .map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (!descriptor || !('value' in descriptor)) {
          throw new Error('Executable parameters rejected')
        }
        return `${JSON.stringify(key)}:${executionParameters(descriptor.value, depth + 1)}`
      })
      .join(',')}}`
  }
  throw new Error('Tool parameters must be plain JSON')
}

/** A permit binds both the actual runtime generation and the entire final invocation. */
export function executionDigest(
  binding: { sessionId: string; epoch: string; turnId: string; cwd: string },
  request: Omit<ExecutionRequest, 'digest'>,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        binding.sessionId,
        binding.epoch,
        binding.turnId,
        binding.cwd,
        request.id,
        request.callId,
        request.parentId,
        request.tool,
        request.parameters,
      ]),
    )
    .digest('hex')
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}

/** Wraps the final SDK execute entry, after all SDK preparation/hooks. The host decision is
 * bound to this invocation and frozen snapshot; it is never cached or inherited by children.
 * Cancellation, missing transport, mismatched replies and duplicate call IDs fail closed.
 * Native extension code is disabled separately; this is not an operating-system sandbox.
 */
export class FinalToolGuard {
  private readonly consumed = new Set<string>()
  private readonly parents = new Map<string, string | null>()
  private readonly reads = new Map<string, string>()
  constructor(
    private readonly binding: () => {
      sessionId: string
      epoch: string
      turnId: string
      cwd: string
    },
    private readonly decide: (
      request: ExecutionRequest,
      signal: AbortSignal | undefined,
    ) => Promise<ExecutionDecision>,
    private readonly final: (request: ExecutionRequest) => void = () => {},
    private readonly executing: (request: ExecutionRequest) => void = () => {},
    private readonly settled: (
      request: ExecutionRequest,
      succeeded: boolean,
    ) => Promise<void> = async () => {},
  ) {}

  observe(callId: string, parentId: string | null): void {
    this.parents.set(callId, parentId)
  }
  reset(): void {
    this.consumed.clear()
    this.parents.clear()
    this.reads.clear()
  }
  readSnapshot(callId: string): string {
    const text = this.reads.get(callId)
    if (text === undefined) {
      throw new Error('Verified read snapshot missing')
    }
    return text
  }

  wrap<P extends ToolDefinition['parameters'], D>(
    definition: ToolDefinition<P, D>,
  ): ToolDefinition<P, D> {
    const name = definition.name,
      execute = definition.execute.bind(definition)
    return {
      ...definition,
      execute: (callId, params, signal, onUpdate, context) =>
        this.execute(callId, name, params, signal, (snapshot) =>
          execute(callId, snapshot, signal, onUpdate, context),
        ),
    }
  }

  /** The sole final invocation boundary, shared by SDK definitions and nested adapters.
   * The operation receives the frozen approved snapshot. No parent permit is inherited. */
  async execute<P, R>(
    callId: string,
    tool: string,
    params: P,
    signal: AbortSignal | undefined,
    operation: (snapshot: P) => Promise<R>,
  ): Promise<R> {
    if (this.consumed.has(callId) || signal?.aborted) {
      throw new Error('Tool call is cancelled or already consumed')
    }
    this.consumed.add(callId)
    // Validate descriptors before cloning: structuredClone may evaluate accessors.
    const parameters = executionParameters(params)
    if (Buffer.byteLength(parameters) > 65536) {
      throw new Error('Final tool parameters exceed budget')
    }
    const snapshot = freeze(structuredClone(params))
    if (executionParameters(snapshot) !== parameters) {
      throw new Error('Final tool parameters changed while capturing')
    }
    const unsigned = {
      id: randomUUID(),
      callId,
      parentId: this.parents.get(callId) ?? null,
      tool,
      parameters,
    }
    const binding = { ...this.binding() }
    const request = executionRequestSchema.parse({
      ...unsigned,
      digest: executionDigest(binding, unsigned),
    })
    this.final(request)
    const decision = executionDecisionSchema.parse(await this.decide(request, signal))
    const current = this.binding()
    if (
      signal?.aborted ||
      binding.turnId !== current.turnId ||
      binding.epoch !== current.epoch ||
      binding.sessionId !== current.sessionId ||
      binding.cwd !== current.cwd ||
      decision.id !== request.id ||
      decision.digest !== request.digest ||
      decision.risk.digest !== request.digest ||
      executionParameters(snapshot) !== request.parameters
    ) {
      throw new Error('Final tool decision binding is invalid')
    }
    if (!decision.allowed) {
      throw new Error(decision.reason)
    }
    if (tool === 'read') {
      if (decision.readText === undefined) {
        throw new Error('Verified read snapshot missing')
      }
      this.reads.set(callId, decision.readText)
    }
    let succeeded = false
    try {
      this.executing(request)
      const result = await operation(snapshot)
      succeeded = true
      return result
    } finally {
      this.reads.delete(callId)
      await this.settled(request, succeeded)
    }
  }
}
