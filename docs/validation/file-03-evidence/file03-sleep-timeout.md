# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: file-editing.spec.ts >> FILE-03 Electron external rewrite separate overwrite cancellation, another racing version, permission failure and deletion all preserve the draft
- Location: e2e\file-editing.spec.ts:60:1

# Error details

```
Error: Test timeout of 120000ms exceeded
```

# Test source

```ts
  182 |       browser
  183 |         ?.contexts()
  184 |         .flatMap((context) => context.pages().map((page) => page.goto('about:blank'))) ?? [],
  185 |     )
  186 |     releaseProofs()
  187 |     // Polling can still be inside route.fetch when the renderer closes. Drain those
  188 |     // callbacks before Electron disposes its request context; keep their errors visible.
  189 |     await Promise.all(
  190 |       browser
  191 |         ?.contexts()
  192 |         .flatMap((context) =>
  193 |           context.pages().map((page) => page.unrouteAll({ behavior: 'wait' })),
  194 |         ) ?? [],
  195 |     )
  196 |     await Promise.all(
  197 |       browser?.contexts().map((context) => context.unrouteAll({ behavior: 'wait' })) ?? [],
  198 |     )
  199 |     if (child.connected) {
  200 |       child.send('quit')
  201 |     }
  202 |     const timer = setTimeout(() => child.kill(), 5000)
  203 |     await exited
  204 |     clearTimeout(timer)
  205 |     await browser?.close()
  206 |   }
  207 |   try {
  208 |     await expect.poll(() => endpoint).not.toBe('')
  209 |     // Connecting CDP while Electron is creating its first target can miss that page.
  210 |     // Observe actual native load before attaching; reload after the isolated routes exist.
  211 |     await expect.poll(() => rendererReady, { timeout: 15000 }).toBe(true)
  212 |     browser = await chromium.connectOverCDP(endpoint)
  213 |     const context = browser.contexts()[0]
  214 |     if (!context) {
  215 |       throw new Error('Missing Electron context')
  216 |     }
  217 |     // REST and the real TCP observation stream must share this fixture's daemon.
  218 |     // HTTP routing alone leaves WebSocket on the unrelated development instance.
  219 |     await context.addInitScript(() => {
  220 |       const NativeWebSocket = window.WebSocket
  221 |       window.WebSocket = class extends NativeWebSocket {
  222 |         constructor(url: string | URL, protocols?: string | string[]) {
  223 |           const streamUrl = new URL(url)
  224 |           if (streamUrl.pathname === '/api/events') {
  225 |             streamUrl.port = '4318'
  226 |           }
  227 |           super(streamUrl, protocols)
  228 |         }
  229 |       }
  230 |     })
  231 |     await context.route('**/api/**', async (route) => {
  232 |       const url = new URL(route.request().url())
  233 |       try {
  234 |         const response = await route.fetch({
  235 |           url: `http://127.0.0.1:4318${url.pathname}${url.search}`,
  236 |           headers: {
  237 |             ...route.request().headers(),
  238 |             host: '127.0.0.1:4318',
  239 |             origin: 'http://127.0.0.1:5173',
  240 |           },
  241 |         })
  242 |         await route.fulfill({ response })
  243 |       } catch (error) {
  244 |         // Chromium can have already completed an aborted poll while the detached fetch
  245 |         // returns. Only that already-handled cancellation/fixture-exit case is expected;
  246 |         // live request failures and every other transport error still fail the test.
  247 |         if (
  248 |           error instanceof Error &&
  249 |           error.message.includes('Route is already handled') &&
  250 |           (closing || route.request().failure()?.errorText.includes('ERR_ABORTED'))
  251 |         ) {
  252 |           // The server has continued the cancelled request, but the client handler
  253 |           // still needs to complete its handling promise so unrouteAll(wait) drains.
  254 |           await route.fallback()
  255 |           return
  256 |         }
  257 |         throw error
  258 |       }
  259 |     })
  260 |     await expect.poll(() => context.pages().length, { timeout: 15000 }).toBeGreaterThan(0)
  261 |     const page = context.pages()[0]
  262 |     if (!page) {
  263 |       throw new Error('Missing Electron page')
  264 |     }
  265 |     await page.reload()
  266 |     await expect(page.getByRole('heading', { name: '今天想完成什么？' })).toBeVisible()
  267 |     return {
  268 |       page,
  269 |       context,
  270 |       close,
  271 |       shellCalls,
  272 |       unloadPrompts,
  273 |       requestQuit: () => {
  274 |         child.send('quit')
  275 |       },
  276 |       setUnloadChoice: async (value: 0 | 1) => {
  277 |         if (!unloadFixture) {
  278 |           throw new Error('Unload result fixture was not explicitly enabled')
  279 |         }
  280 |         unloadReady = false
  281 |         child.send({ type: 'unload-choice', value })
> 282 |         await expect.poll(() => unloadReady).toBe(true)
      |                                              ^ Error: Test timeout of 120000ms exceeded
  283 |       },
  284 |       holdExternal: () => {
  285 |         proofHeld = true
  286 |       },
  287 |       releaseExternal: releaseProofs,
  288 |       proofCount: () => proofCount,
  289 |       setShellFailure: async (value: string) => {
  290 |         shellReady = false
  291 |         child.send({ type: 'shell-failure', value })
  292 |         await expect.poll(() => shellReady).toBe(true)
  293 |       },
  294 |       wrongWindow: async (id: string) => {
  295 |         wrongWindowResult = undefined
  296 |         child.send({ type: 'wrong-window', id })
  297 |         await expect.poll(() => wrongWindowResult).not.toBeUndefined()
  298 |         return wrongWindowResult
  299 |       },
  300 |       setSelection: async (path: string | null) => {
  301 |         selected = undefined
  302 |         child.send({ type: 'selection', path })
  303 |         await expect.poll(() => selected).toBe(path)
  304 |       },
  305 |     }
  306 |   } catch (error) {
  307 |     await close()
  308 |     throw new Error(`Electron fixture failed (rendererReady=${rendererReady}): ${diagnostics}`, {
  309 |       cause: error,
  310 |     })
  311 |   }
  312 | }
  313 | 
```