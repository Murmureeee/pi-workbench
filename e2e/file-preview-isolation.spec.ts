/* oxlint-disable no-await-in-loop -- Attack probes, renderer crashes and restart share one real Electron/daemon fixture. */
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { setupChanges } from './helpers/change-fixture.js'

type Fixture = Awaited<ReturnType<typeof setupChanges>>
const open = (f: Fixture, sessionId: string, path = '攻击.html', id = randomUUID()) =>
  f.page.evaluate(
    (q) =>
      window.piWorkbench!.previewFile({
        id: q.id,
        input: { target: { sessionId: q.sessionId }, source: { path: q.path } },
      }),
    { sessionId, path, id },
  )
const inspect = (f: Fixture, code: string) => f.desktop.previewControl('js', code)

test('FILE-07 actual isolated static HTML and active renderer probes cannot access host identity, files, services, navigation or downloads', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  let requests = 0
  const trap = createServer((_q, r) => {
    requests++
    r.end('unexpected remote access')
  })
  trap.on('upgrade', (_request, socket) => {
    requests++
    socket.destroy()
  })
  await new Promise<void>((r) => trap.listen(0, '127.0.0.1', r))
  const address = trap.address()
  if (!address || typeof address === 'string') {
    throw Error('local attack trap failed')
  }
  const destination = `http://127.0.0.1:${address.port}`
  try {
    // Authored external attack fixture, not SDK-generated content. All attack paths
    // point at local traps; this test makes no real provider or remote request.
    writeFileSync(
      join(f.cwd, '攻击.html'),
      `<!doctype html><meta charset="utf-8">
      <meta http-equiv="refresh" content="1;url=${destination}/redirect">
      <title>伪造工作台标题</title><h1>攻击夹具静态正文</h1>
      <script>window.attackExecuted=true;document.querySelector('h1').textContent='SCRIPT RAN';fetch('${destination}/script')</script>
      <script src="${destination}/code.js"></script><style>@import url('${destination}/sheet');body{background-image:url('${destination}/background')}</style>
      <img src="${destination}/image" onerror="window.attackExecuted=true">
      <iframe src="http://127.0.0.1:5173"></iframe><iframe srcdoc="<script>parent.attackExecuted=true</script>"></iframe>
      <object data="file:///C:/Windows/win.ini"></object><embed src="${destination}/object">
      <form action="${destination}/form"><input type="file"><button>窃取文件</button></form>
      <a id="external" href="${destination}/link">外链</a><a id="download" download href="data:text/plain,forbidden">下载</a>
      <a id="protocol" href="vscode://file/C:/Windows/win.ini">外部协议</a><a id="file" href="file:///C:/Windows/win.ini">文件</a>`,
    )
    const s = await f.send('预览攻击本地主会话')
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    expect(await open(f, s.id)).toMatchObject({ status: 'requested' })
    const states = await f.desktop.previewControl('list')
    expect(states).toEqual([
      expect.objectContaining({
        persistent: false,
        cookies: 0,
        preferences: expect.objectContaining({
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          javascript: false,
          webSecurity: true,
        }),
      }),
    ])
    expect(
      await inspect(
        f,
        `({script:typeof window.attackExecuted,heading:document.querySelector('h1').textContent,bridge:typeof window.piWorkbench,node:typeof process,require:typeof require,opener:window.opener===null})`,
      ),
    ).toEqual({
      script: 'undefined',
      heading: '攻击夹具静态正文',
      bridge: 'undefined',
      node: 'undefined',
      require: 'undefined',
      opener: true,
    })
    const capabilities = await inspect(
      f,
      `(()=>{
      const attempt=fn=>{try{fn();return 'allowed'}catch{return 'denied'}};
      window.probeResults={};
      for(const [name,url] of [['file','file:///C:/Windows/win.ini'],['network','${destination}/fetch'],['daemon','http://127.0.0.1:4318/api/chat']]){
        window.probeResults[name]='pending';
        try{fetch(url,{credentials:'include'}).then(()=>window.probeResults[name]='unexpected',()=>window.probeResults[name]='denied')}catch{window.probeResults[name]='denied'}
      }
      window.probeXHR=new XMLHttpRequest();window.probeXHR.open('GET','${destination}/xhr');window.probeXHR.send();
      window.probeSocket=new WebSocket('ws://127.0.0.1:${address.port}/socket');
      return {cookie:attempt(()=>document.cookie),storage:attempt(()=>localStorage.setItem('probe','yes')),
        popup:window.open('${destination}/popup')===null,beacon:navigator.sendBeacon('${destination}/beacon','probe'),
        worker:attempt(()=>new Worker('${destination}/worker'))};
    })()`,
    )
    expect(capabilities).toMatchObject({
      cookie: 'denied',
      storage: 'denied',
      popup: true,
      worker: 'denied',
    })
    await new Promise<void>((r) => setTimeout(r, 300))
    const blocked = await inspect(
      f,
      `({results:window.probeResults,xhrStatus:window.probeXHR.status,socketState:window.probeSocket.readyState})`,
    )
    expect(blocked).toMatchObject({
      results: { file: 'denied', network: 'denied', daemon: 'denied' },
      xhrStatus: 0,
      socketState: 3,
    })
    for (const selector of ['external', 'download', 'protocol', 'file']) {
      await inspect(f, `document.getElementById('${selector}').click();true`)
    }
    await inspect(f, `try{document.querySelector('form').submit()}catch{};true`)
    await inspect(f, `location.href='${destination}/navigate';true`)
    await expect.poll(() => requests).toBe(0)
    expect(await inspect(f, 'location.protocol')).toBe('piw-preview:')
    expect(f.sends()).toBe(1)
    expect(f.desktop.shellCalls).toEqual([])
    writeFileSync(
      join(
        process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest',
        'preview-attack-result.json',
      ),
      JSON.stringify(
        {
          source:
            'actual Electron static document and CDP Runtime.evaluate in its isolated renderer; external files authored by CLI',
          states,
          capabilities,
          blocked,
          trapRequests: requests,
          providerRequests: 0,
        },
        null,
        2,
      ),
    )
    await expect(f.page.getByRole('textbox', { name: '任务内容' })).toBeVisible()
  } finally {
    await f.close()
    await new Promise<void>((r, j) => trap.close((e) => (e ? j(e) : r())))
  }
})

test('FILE-07 cancellation, late results, repeated requests, initialization failure and four-window limit fail closed and recover', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  try {
    writeFileSync(join(f.cwd, '攻击.html'), '<h1>有界静态预览</h1>')
    const s = await f.send('预览取消与恢复')
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    f.desktop.holdExternal()
    const id = randomUUID(),
      result = open(f, s.id, '攻击.html', id)
    await expect.poll(() => f.desktop.proofCount()).toBe(1)
    expect(
      await f.page.evaluate((requestId) => window.piWorkbench!.cancelPreview(requestId), id),
    ).toBe(true)
    f.desktop.releaseExternal()
    expect(await result).toMatchObject({ status: 'cancelled' })
    expect(await f.desktop.previewControl('list')).toEqual([])
    expect(await open(f, s.id, '攻击.html', id)).toMatchObject({ status: 'failed' })
    await f.desktop.previewControl('fault')
    expect(await open(f, s.id)).toMatchObject({ status: 'failed' })
    expect(await f.desktop.previewControl('list')).toEqual([])
    for (let i = 0; i < 4; i++) {
      expect(await open(f, s.id)).toMatchObject({ status: 'requested' })
    }
    expect(await open(f, s.id)).toMatchObject({ status: 'failed' })
    await f.desktop.previewControl('close')
    expect(await open(f, s.id)).toMatchObject({ status: 'requested' })
    expect(
      await f.page.evaluate(async () => {
        const method: unknown = Reflect.get(window.piWorkbench!, 'previewFile')
        if (typeof method !== 'function') {
          throw Error('fixed preview bridge missing')
        }
        const malformed: unknown = await Reflect.apply(method, window.piWorkbench, [
          { id: crypto.randomUUID(), input: { url: 'file:///' } },
        ])
        return malformed
      }),
    ).toMatchObject({ status: 'failed' })
    expect(f.sends()).toBe(1)
  } finally {
    await f.close()
  }
})

test('FILE-07 real preview renderer crash leaves workbench and actual SDK background PID/epoch intact; same profile restart restores no preview', async () => {
  test.setTimeout(150000)
  const f = await setupChanges()
  try {
    writeFileSync(join(f.cwd, '攻击.html'), '<h1>崩溃隔离</h1>')
    const s = await f.send('预览主会话')
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    const background = await f.send('保持后台任务', true)
    await f.ready(background.id)
    const before = f.kernels.list().find((k) => k.sessionId === background.id)
    expect(before?.pid).toBeGreaterThan(0)
    await f.open(s.id)
    expect(await open(f, s.id)).toMatchObject({ status: 'requested' })
    await f.desktop.previewControl('crash')
    await expect(f.page.getByRole('textbox', { name: '任务内容' })).toBeVisible()
    expect(f.kernels.list().find((k) => k.sessionId === background.id)).toMatchObject({
      pid: before?.pid,
      epoch: before?.epoch,
      state: 'running',
    })
    expect(await open(f, s.id)).toMatchObject({ status: 'requested' })
    await f.stop(background.id)
    await f.restart()
    expect(await f.desktop.previewControl('list')).toEqual([])
    expect(f.sends()).toBe(0)
    expect(f.kernels.list()).toEqual([])
    await f.open(s.id)
    expect(await open(f, s.id)).toMatchObject({ status: 'requested' })
  } finally {
    await f.close()
  }
})
