import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'

test('Electron isolates the renderer and close hides the window until explicit quit', async () => {
  const requireDesktop = createRequire(resolve('apps/desktop/package.json'))
  const electronPath: unknown = requireDesktop('electron')
  if (typeof electronPath !== 'string') {
    throw new Error('Electron executable path is unavailable')
  }
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  delete environment.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({
    executablePath: electronPath,
    args: [resolve('apps/desktop')],
    env: environment,
  })
  try {
    const page = await desktop.firstWindow()
    await expect(page.getByRole('heading', { name: '今天想完成什么？' })).toBeVisible()
    expect(await page.evaluate(() => 'require' in window)).toBe(false)
    expect(await page.evaluate(() => 'process' in window)).toBe(false)
    const renderer = await desktop.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) {
        throw new Error('Expected an Electron window')
      }
      const pid = window.webContents.getOSProcessId()
      return app.getAppMetrics().find((metric) => metric.pid === pid)
    })
    expect(renderer?.sandboxed).toBe(true)
    await desktop.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) {
        throw new Error('Expected an Electron window')
      }
      window.close()
    })
    expect(
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()),
    ).toBe(false)
    await desktop.evaluate(({ app }) => app.emit('activate'))
    expect(
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()),
    ).toBe(true)
    await page.screenshot({
      path: `${process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'}/desktop.png`,
      animations: 'disabled',
    })
  } finally {
    await desktop.close()
  }
})
