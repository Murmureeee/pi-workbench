export const redacted = '«redacted»'

const secretField =
  /(?:^|[_\-.])(?:api[_-]?key|key|token|secret|password|passwd|authorization|proxy[_-]?authorization|cookie|set[_-]?cookie|access|refresh|credential)(?:$|[_\-.])/i
const camelSecret =
  /(?:apiKey|accessToken|refreshToken|clientSecret|privateKey|password|authorization|credentials?|thinkingSignature|reasoningSignature|encrypted[_-]?content)/i
function secretName(name: string): boolean {
  return secretField.test(name) || camelSecret.test(name)
}

/** One policy for presentation, diagnostics, approval summaries and exports. Known values stay
 * host-side; a renderer must never receive the registry. This is a best-effort content filter,
 * not a guarantee that arbitrary user prose or encoded/unknown secrets can be identified.
 */
export class Redactor {
  private readonly secrets = new Set<string>()
  /** Host-only invalidation token for derived presentation indexes; contains no credential. */
  get revision(): number {
    return this.secrets.size
  }

  remember(value: string): void {
    if (value && value !== redacted) {
      this.secrets.add(value)
      try {
        this.secrets.add(encodeURIComponent(value))
      } catch {
        // Invalid Unicode has no URI form; raw/JSON forms are still registered below.
      }
      this.secrets.add(JSON.stringify(value).slice(1, -1))
    }
  }

  /** Field names are inspected before values. Never call on authoritative execution parameters. */
  value(input: unknown, streaming = false): unknown {
    const seen = new WeakSet<object>()
    const visit = (value: unknown, depth: number): unknown => {
      if (typeof value === 'string') {
        return this.text(value, streaming)
      }
      if (value instanceof Error) {
        return { name: this.text(value.name), message: this.text(value.message) }
      }
      if (value === null || typeof value !== 'object') {
        return value
      }
      if (depth > 40 || seen.has(value)) {
        return '[unavailable]'
      }
      seen.add(value)
      if (
        'type' in value &&
        typeof value.type === 'string' &&
        ['thinking', 'redacted_thinking', 'reasoning', 'redacted_reasoning'].includes(value.type) &&
        (value.type !== 'thinking' ||
          !('thinking' in value) ||
          typeof value.thinking !== 'string' ||
          ('redacted' in value && value.redacted !== false))
      ) {
        seen.delete(value)
        return { type: 'thinking', redacted: true }
      }
      const output = Array.isArray(value)
        ? value.map((item: unknown) => visit(item, depth + 1))
        : Object.fromEntries(
            Object.entries(value).map(([key, item]: [string, unknown]) => [
              this.text(key),
              secretName(key)
                ? redacted
                : key === 'content' &&
                    'role' in value &&
                    value.role === 'assistant' &&
                    Array.isArray(item)
                  ? item.map((part: unknown) =>
                      typeof part === 'object' &&
                      part !== null &&
                      'type' in part &&
                      ['text', 'thinking', 'toolCall'].includes(String(part.type))
                        ? visit(part, depth + 1)
                        : '[unsupported content]',
                    )
                  : visit(item, depth + 1),
            ]),
          )
      seen.delete(value)
      return output
    }
    return visit(input, 0)
  }

  private values(input: string, prefixes: RegExp, nameGroup: number): string {
    let cursor = 0,
      output = ''
    // Match only the assignment prefix, so an innocent value (for example an entire URL)
    // cannot consume and conceal a later api_key= assignment from the scanner.
    for (const match of input.matchAll(prefixes)) {
      const name = match[nameGroup]
      if (!name || !secretName(name) || match.index < cursor) {
        continue
      }
      const start = match.index + match[0].length
      const value = input
        .slice(start)
        .match(/^(?:"(?:\\.|[^"\\\r\n])*(?:"|$)|'(?:\\.|[^'\\\r\n])*(?:'|$)|[^\s,;&}\]<>]+)/)?.[0]
      if (value) {
        // Preserve surrounding quotes so repeated filtering of a JSON parameter/result
        // string stays parseable. Values are masked as a whole, including escaped quotes.
        const quote = value[0] === '"' || value[0] === "'" ? value[0] : ''
        output +=
          input.slice(cursor, start) +
          quote +
          redacted +
          (quote && value.length > 1 && value.endsWith(quote) ? quote : '')
        cursor = start + value.length
      }
    }
    return output + input.slice(cursor)
  }

  /** Active streams withhold suffixes matching a known secret or recognizable token prefix.
   * The caller replaces the visible cumulative text; it must not append independently scrubbed
   * chunks (which could reveal a credential split across events). Finish with streaming=false.
   */
  text(input: string, streaming = false): string {
    let value = input
    if (streaming) {
      let end = value.length
      for (const secret of this.secrets) {
        for (let length = Math.min(secret.length, value.length); length > 0; length--) {
          if (value.endsWith(secret.slice(0, length))) {
            end = Math.min(end, value.length - length)
            break
          }
        }
      }
      const tail = value.match(/[A-Za-z0-9_.-]+$/)?.[0]
      if (
        tail &&
        ['sk-', 'ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_', 'eyJ'].some(
          (prefix) => prefix.startsWith(tail) || tail.startsWith(prefix),
        )
      ) {
        end = Math.min(end, value.length - tail.length)
      }
      value = value.slice(0, end)
    }
    // Longest first prevents one registered value from exposing a suffix of another.
    for (const secret of [...this.secrets].toSorted((a, b) => b.length - a.length)) {
      value = value.split(secret).join(redacted)
    }
    value = value
      .replace(
        /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z]+ )?PRIVATE KEY-----|$)/g,
        redacted,
      )
      .replace(
        /\b(?:sk-[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g,
        redacted,
      )
      .replace(/\b(Bearer|Basic)\s+[^\s"'`,;<>]+/gi, `$1 ${redacted}`)
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, `$1${redacted}@`)
    value = this.values(value, /(["']?)([A-Za-z_][\w.-]*)\1\s*[:=]\s*/g, 2)
    value = this.values(value, /--([\w-]+)(?:=|\s+)/g, 1)
    return value
  }
}
