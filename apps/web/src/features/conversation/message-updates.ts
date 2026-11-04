/** A bounded presentation fingerprint, never an identity, permission or secret hash.
 * It lets a reply count once across deltas and SDK/HTTP replacement without saving text. */
export function messageStamp(text: string, state: string): string {
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
  }
  return `${text.length}:${hash >>> 0}:${state}`
}

/** Count distinct messages updated since the latest visible reading receipt, not chunks.
 * A missing baseline represents first discovery, so existing history is not called new. */
export function updatedMessages(
  current: Readonly<Record<string, string>>,
  seen: Readonly<Record<string, string>> | null,
): number {
  return seen ? Object.entries(current).filter(([id, stamp]) => seen[id] !== stamp).length : 0
}
