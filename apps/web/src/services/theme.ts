import type { DesktopTheme } from '@pi-workbench/shared'

const key = 'piw-appearance-theme'

/** Only a non-sensitive display preference is stored. Restricted browser storage falls
 * back to the current window; no private configuration or client identity is persisted.
 */
export function readTheme(): DesktopTheme {
  try {
    const value = localStorage.getItem(key)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

export function saveTheme(theme: DesktopTheme): void {
  try {
    localStorage.setItem(key, theme)
  } catch {
    /* Keep the current window preference. */
  }
}

export function applyTheme(theme: DesktopTheme): void {
  const dark =
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}
