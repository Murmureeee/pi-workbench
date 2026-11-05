import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { chromium, _electron as electron, expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { AccessService } from '../apps/daemon/dist/modules/security/access.service.js'
import { hostAccessRequestSchema } from '../packages/shared/dist/index.js'

test('Electron native chrome, settings navigation, theme and isolated renderer retain tray lifecycle', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-desktop-chrome-'))
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
    args: [resolve('apps/desktop'), `--user-data-dir=${join(directory, 'profile')}`],
    env: environment,
  })
  try {
    const page = await desktop.firstWindow()
    await expect(page.getByRole('heading', { name: '今天想完成什么？' })).toBeVisible()
    expect(
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()),
    ).toBe(true)
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
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.getByRole('banner', { name: '桌面控制栏' })).toBeVisible()
    await page.getByRole('textbox', { name: '任务内容' }).fill('原生菜单导航保留草稿')
    // CDP keyboard input does not dispatch Windows menu accelerators. Invoke the installed
    // native command here; the actual Ctrl+, shortcut is checked with Windows input separately.
    await desktop.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('open-settings')
      if (!item) {
        throw new Error('Missing native settings command')
      }
      Reflect.apply(item.click, item, [])
    })
    await expect(page.getByRole('heading', { name: '外观', exact: true })).toBeVisible()
    await page.getByLabel('外观主题').selectOption('system')
    await page.emulateMedia({ colorScheme: null })
    // Emulate the app's native system-theme signal without changing Windows settings.
    await desktop.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = 'light'
    })
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await desktop.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = 'dark'
    })
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect
      .poll(() =>
        desktop.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.getBackgroundColor(),
        ),
      )
      .toBe('#202020')
    await desktop.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = 'system'
    })
    await page.getByLabel('外观主题').selectOption('light')
    await expect
      .poll(() =>
        desktop.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.getBackgroundColor(),
        ),
      )
      .toBe('#F3F4F5')
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(1920, 1080),
    )
    await page.screenshot({
      path: `${process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'}/settings-electron-light.png`,
      animations: 'disabled',
    })
    await page.getByRole('button', { name: '后退', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '任务内容' })).toHaveValue(
      '原生菜单导航保留草稿',
    )
    await page.getByRole('button', { name: '前进', exact: true }).click()
    await expect(page.getByRole('heading', { name: '外观', exact: true })).toBeVisible()
    await page.getByLabel('外观主题').selectOption('dark')
    await expect
      .poll(() =>
        desktop.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.getBackgroundColor(),
        ),
      )
      .toBe('#202020')
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(800, 720),
    )
    await page.screenshot({
      path: `${process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'}/settings-electron-dark-800.png`,
      animations: 'disabled',
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(
      await page.evaluate(async () => {
        const bridge: unknown = Reflect.get(window, 'piWorkbench')
        const setTheme: unknown =
          bridge && typeof bridge === 'object' ? Reflect.get(bridge, 'setTheme') : null
        if (typeof setTheme !== 'function') {
          throw new Error('Missing fixed theme bridge')
        }
        const result: unknown = await Reflect.apply(setTheme, undefined, ['arbitrary-color'])
        return result
      }),
    ).toBe(false)
    // A second sandboxed window cannot control the original window, even at the same URL.
    expect(
      await desktop.evaluate(async ({ BrowserWindow }, preload) => {
        const original = BrowserWindow.getAllWindows()[0]
        if (!original) {
          throw new Error('Missing original window')
        }
        const other = new BrowserWindow({
          show: false,
          webPreferences: {
            preload,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        })
        try {
          await other.loadURL('http://127.0.0.1:5173')
          const result: unknown = await other.webContents.executeJavaScript(
            'window.piWorkbench.setTheme("light")',
          )
          return result
        } finally {
          other.destroy()
        }
      }, resolve('apps/desktop/dist/preload.cjs')),
    ).toBe(false)
    expect(errors).toEqual([])
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
    rmSync(directory, { recursive: true, force: true })
  }
})

test('SEC-08 actual Electron parent IPC authorizes isolated renderer; native menu issues one-use browser link', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-electron-access-'))
  const app = await createApp({ dataDir: join(directory, 'data'), port: 4318, development: true })
  const requireDesktop = createRequire(resolve('apps/desktop/package.json'))
  const electronPath: unknown = requireDesktop('electron')
  if (typeof electronPath !== 'string') {
    throw new Error('Electron executable path is unavailable')
  }
  // The driver imports the real main. Only OS browser launching is intercepted; real native
  // menus, parent/child IPC, HTTP redemption, Electron cookies and sandbox remain in use.
  const driver = join(directory, 'driver.cjs')
  writeFileSync(
    driver,
    `const { app, Menu, shell } = require('electron');
shell.openExternal = async (url) => { process.send({ external: url }); };
app.on('web-contents-created', (_event, contents) => {
  contents.once('did-finish-load', () => process.send({type: 'renderer-ready'}));
});
process.on('message', (message) => {
  if (message === 'browser-menu') Menu.getApplicationMenu().items[0].submenu.items[0].click();
  if (message === 'quit') app.quit();
});
void import(${JSON.stringify(pathToFileURL(resolve('apps/desktop/dist/main.js')).href)});\n`,
  )
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  const child = spawn(
    electronPath,
    [driver, '--remote-debugging-port=0', `--user-data-dir=${join(directory, 'profile')}`],
    {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
      env: environment,
    },
  )
  const exited = new Promise<number | null>((done) => child.once('exit', done))
  let endpoint = '',
    external = '',
    rendererReady = false
  child.stderr?.on('data', (chunk: Buffer) => {
    endpoint ||=
      chunk.toString().match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/)?.[1] ?? ''
  })
  child.stdout?.resume()
  child.on('message', (message: unknown) => {
    const request = hostAccessRequestSchema.safeParse(message)
    if (request.success && child.connected) {
      child.send({
        type: 'host-access-result',
        id: request.data.id,
        apiOrigin: 'http://127.0.0.1:4318',
        ticket: app.get(AccessService).issueTicket(request.data.operation),
      })
    } else if (
      message &&
      typeof message === 'object' &&
      'type' in message &&
      message.type === 'renderer-ready'
    ) {
      rendererReady = true
    } else if (
      message &&
      typeof message === 'object' &&
      'external' in message &&
      typeof message.external === 'string'
    ) {
      external = message.external
    }
  })
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined
  try {
    await app.listen(4318, '127.0.0.1')
    await expect.poll(() => endpoint).not.toBe('')
    // Electron can create its first CDP target during connection. Follow the common
    // desktop helper and wait for native load before attaching to the target list.
    await expect.poll(() => rendererReady, { timeout: 15000 }).toBe(true)
    browser = await chromium.connectOverCDP(endpoint)
    const context = browser.contexts()[0]
    if (!context) {
      throw new Error('Missing Electron browser context')
    }
    await context.route('**/api/**', async (route) => {
      const url = new URL(route.request().url())
      const response = await route.fetch({
        url: `http://127.0.0.1:4318${url.pathname}${url.search}`,
        headers: {
          ...route.request().headers(),
          host: '127.0.0.1:4318',
          origin: 'http://127.0.0.1:5173',
        },
      })
      await route.fulfill({ response })
    })
    await expect.poll(() => context.pages().length).toBeGreaterThan(0)
    const page = context.pages()[0]
    if (!page) {
      throw new Error('Missing Electron renderer')
    }
    await expect.poll(() => app.get(AccessService).list().length).toBe(1)
    await expect(page.getByRole('heading', { name: '今天想完成什么？' })).toBeVisible()
    await page.goto('http://127.0.0.1:5173/?clients')
    await expect(page.getByLabel('客户端列表')).toContainText('Windows 桌面')
    await expect(page.getByLabel('客户端列表')).toContainText('桌面宿主')
    expect(await page.evaluate(() => 'require' in window || 'process' in window)).toBe(false)
    expect(
      (await context.cookies()).some(
        (cookie) => cookie.name === 'piw_client_4318' && cookie.httpOnly,
      ),
    ).toBe(true)
    child.send('browser-menu')
    await expect.poll(() => external).not.toBe('')
    const link = new URL(external)
    expect(link.origin).toBe('http://127.0.0.1:5173')
    expect(link.search).toBe('?clients')
    const code = new URLSearchParams(link.hash.slice(1)).get('pair') ?? ''
    const result = app.get(AccessService).redeem(code, 'Native menu browser')
    expect(result?.client.info.kind).toBe('browser')
    expect(app.get(AccessService).redeem(code, 'reused')).toBeUndefined()
    await page.screenshot({
      path: `${process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'}/clients-desktop.png`,
      animations: 'disabled',
    })
    await page.goto('http://127.0.0.1:5173/')
    await page.getByRole('link', { name: '设置', exact: true }).click()
    await page.getByRole('link', { name: '资源信任', exact: true }).click()
    await expect(page.getByRole('heading', { name: '项目与资源信任' })).toBeVisible()
    await expect(page.getByLabel('信任记录')).toContainText('尚无信任记录')
    await expect(page.getByLabel('信任同步状态')).toHaveText('信任信息已同步')
    expect(await page.evaluate(() => 'require' in window || 'process' in window)).toBe(false)
    await page.screenshot({
      path: `${process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'}/trust-desktop.png`,
      animations: 'disabled',
    })
  } finally {
    if (child.connected) {
      child.send('quit')
    }
    const timer = setTimeout(() => child.kill(), 5000)
    await exited
    clearTimeout(timer)
    await browser?.close()
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
