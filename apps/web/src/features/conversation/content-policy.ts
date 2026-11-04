/** Only explicit web links are navigable. Relative/local/custom schemes and all source
 * URLs are inert; Markdown images never fetch, including loopback and data URLs. */
export function messageUrl(value: string, key = 'href'): string {
  if (
    key !== 'href' ||
    !/^https?:\/\//i.test(value) ||
    Array.from(value).some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)
  ) {
    return ''
  }
  try {
    const url = new URL(value)
    return url.username || url.password ? '' : url.href
  } catch {
    return ''
  }
}

export const messagePreview = 16000
export const markdownLimit = 64000

/** Avoid splitting a UTF-16 surrogate pair at the visual preview boundary. */
export function messagePrefix(text: string, limit = messagePreview): string {
  return text.slice(0, /[\uD800-\uDBFF]/.test(text.charAt(limit - 1)) ? limit - 1 : limit)
}

/** This is a highlighting gate over a parser-provided source range, not a Markdown parser.
 * CommonMark remains responsible for the visible safe-text fallback of unfinished fences. */
export function closedFence(source: string): boolean {
  const lines = source.trimEnd().split('\n')
  const opening = /^ {0,3}(`{3,}|~{3,})/.exec(lines[0] ?? '')?.[1]
  const closing = lines.at(-1)?.trim()
  return Boolean(
    opening &&
    lines.length > 1 &&
    closing &&
    closing.length >= opening.length &&
    closing.replaceAll(opening[0] ?? '', '') === '',
  )
}
