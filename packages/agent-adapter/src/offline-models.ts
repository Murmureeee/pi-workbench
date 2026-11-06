/** Fixed host-owned fixture metadata, not a real provider capacity or tariff. */
export const offlineContextWindow = 8192
export function recordedContextWindow(
  provider: string | null,
  model: string | null,
): number | null {
  return provider === 'piw-offline' && (model === 'fixture' || model === 'fixture-reasoning')
    ? offlineContextWindow
    : null
}
