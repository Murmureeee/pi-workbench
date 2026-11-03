import type { DesktopBridge } from '@pi-workbench/shared'

declare global {
  interface Window {
    piWorkbench?: DesktopBridge
  }
}
