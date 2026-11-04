import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { WorkspaceDatabase } from '../apps/daemon/dist/infrastructure/database/database.js'
import { AccessService } from '../apps/daemon/dist/modules/security/access.service.js'
import { TrustService } from '../apps/daemon/dist/modules/security/trust.service.js'
import { SessionService } from '../apps/daemon/dist/modules/sessions/session.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { WorkspaceService } from '../apps/daemon/dist/modules/workspaces/workspace.service.js'
import { ProjectService } from '../apps/daemon/dist/modules/workspaces/project.service.js'
import { hostAccessRequestSchema } from '../packages/shared/dist/index.js'

// Isolated native acceptance: production Electron main/preload and actual daemon/SDK.
// No CDP, route interception, synthetic DOM input or overridden system dialog.
const existing = process.argv.find(value => value.startsWith('--directory='))?.slice(12)
const directory = existing ? resolve(existing) : mkdtempSync(join(tmpdir(), 'piw-session-07-native-'))
assert(directory.startsWith(join(tmpdir(), 'piw-session-07-native-')))
const pi = join(directory, 'pi'), data = join(directory, 'data'), projectDirectory = join(directory, '旧项目目录')
if (!existing) {
  for (const path of [pi, projectDirectory]) mkdirSync(path, { recursive: true })
  for (const name of ['auth.json', 'models.json', 'settings.json']) writeFileSync(join(pi, name), '{}\n')
  writeFileSync(join(pi, 'AGENTS.md'), 'Unconfirmed explicit global fixture context; never auto load.\n')
  writeFileSync(join(projectDirectory, 'AGENTS.md'), 'Previous project fixture; never inherit into a standalone session.\n')
}
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const configs = () => Object.fromEntries(['auth.json', 'models.json', 'settings.json', 'AGENTS.md'].map(name => [name, hash(join(pi, name))]))
const configBefore = configs(), budgetBefore = hash('docs/validation/live-validation-budget.json')
const app = await createApp({ dataDir: data, port: 4317, development: true, piAgentDir: pi })
const store = app.get(SessionStore), kernels = app.get(KernelService), service = app.get(SessionService)
const db = app.get(WorkspaceDatabase).sqlite
let seedPhase = !existing, seedPrompts = 0, uiPrompts = 0
const original = kernels.prompt.bind(kernels)
kernels.prompt = (id, cwd, prompt, options) => {
  if (seedPhase) seedPrompts++; else uiPrompts++
  return original(id, cwd, { ...prompt, ...(prompt.text === 'SESSION-07 原生后台任务' ? { fixture: 'hold' } : {}) }, options)
}
let seeds
if (!existing) {
  const ws = await app.get(WorkspaceService).open(projectDirectory, { remember: false }); assert(ws.ok)
  const project = await app.get(ProjectService).create({ requestId: randomUUID(), name: 'SESSION-07 整理目标', workspaceId: ws.workspace.id })
  const receipt = await service.submit({ requestId: randomUUID(), sessionId: null, text: 'SESSION-07 之前项目会话', retryOf: null, configuration: { projectId: project.id, workspaceId: ws.workspace.id, model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' }, thinking: 'off' } })
  const deadline = Date.now() + 15000
  while (store.submission(receipt.submission.requestId)?.status !== 'completed') {
    assert(Date.now() < deadline, 'SDK/local seed did not finish')
    await new Promise(done => setTimeout(done, 100))
  }
  seeds = { project, projectSession: receipt.session.id }
  writeFileSync(join(directory, 'seeds.json'), JSON.stringify(seeds, null, 2) + '\n')
} else seeds = JSON.parse(readFileSync(join(directory, 'seeds.json'), 'utf8'))
seedPhase = false
await app.listen(4317, '127.0.0.1')
const vite = await createServer({ root: resolve('apps/web'), configFile: resolve('apps/web/vite.config.ts') }); await vite.listen()
const electron = createRequire(resolve('apps/desktop/package.json'))('electron'); assert.equal(typeof electron, 'string')
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE
const desktop = spawn(electron, [resolve('apps/desktop'), `--user-data-dir=${join(directory, 'profile')}`], { env: environment, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: false })
desktop.stdout.resume(); desktop.stderr.on('data', chunk => process.stderr.write(chunk))
desktop.on('message', message => { const request = hostAccessRequestSchema.safeParse(message); if (request.success && desktop.connected) desktop.send({ type: 'host-access-result', id: request.data.id, apiOrigin: 'http://127.0.0.1:4317', ticket: app.get(AccessService).issueTicket(request.data.operation) }) })
const histories = () => existsSync(join(data, 'kernels')) ? Object.fromEntries(readdirSync(join(data, 'kernels'), { recursive: true }).filter(name => name.endsWith('.jsonl')).map(name => [name, hash(join(data, 'kernels', name))])) : {}
const historyBefore = histories()
let failureEnabled = false
const audit = () => {
  const sessions = store.managedSessions()
  for (const session of sessions.filter(row => row.title === 'SESSION-07 原生独立会话')) {
    assert.equal(session.cwd, join(data, 'standalone', session.id))
    const path = join(session.cwd, '外部验收夹具产物.txt')
    // This artifact is explicitly written by this external acceptance host, never by an SDK tool.
    if (!existsSync(path)) writeFileSync(path, 'External acceptance fixture artifact, not SDK-generated.\n')
  }
  return { source: 'Actual Windows native Electron/daemon/SQLite/SDK + local HTTP fixture; no CDP/route interception', directory, data, projectDirectory, seeds, restored: Boolean(existing), sessions, origins: sessions.map(row => store.origin(row.id)), submissions: sessions.flatMap(row => store.submissions(row.id).map(item => ({ sessionId: row.id, requestId: item.requestId, text: item.text, status: item.status }))), resources: kernels.resources(), artifacts: sessions.filter(row => row.title === 'SESSION-07 原生独立会话').map(row => ({ path: join(row.cwd, '外部验收夹具产物.txt'), sha256: hash(join(row.cwd, '外部验收夹具产物.txt')), projectHasCopy: existsSync(join(projectDirectory, '外部验收夹具产物.txt')) })), trustRecords: app.get(TrustService).inspect().records.length, failureEnabled, seedPrompts, uiPrompts, providerRequests: 0, historyBefore, historyAfter: histories(), configBefore, configAfter: configs(), budgetBefore, budgetAfter: hash('docs/validation/live-validation-budget.json') }
}
const save = () => writeFileSync(join(directory, 'native-audit.json'), JSON.stringify(audit(), null, 2) + '\n')
let commandId = existing && existsSync(join(directory, 'native-command.json')) ? JSON.parse(readFileSync(join(directory, 'native-command.json'), 'utf8')).id : ''
const timer = setInterval(() => {
  try {
    if (existsSync(join(directory, 'native-command.json'))) {
      const command = JSON.parse(readFileSync(join(directory, 'native-command.json'), 'utf8'))
      if (command.id !== commandId) {
        commandId = command.id
        if (command.action === 'fail-on') { db.exec("CREATE TRIGGER reject_native_membership BEFORE UPDATE OF project_id ON session_configurations BEGIN SELECT RAISE(ABORT,'external acceptance write failure'); END"); failureEnabled = true }
        else if (command.action === 'fail-off') { db.exec('DROP TRIGGER IF EXISTS reject_native_membership'); failureEnabled = false }
        else assert.equal(command.action, 'audit')
        save(); writeFileSync(join(directory, 'native-command-result.json'), JSON.stringify({ id: command.id, done: true }, null, 2) + '\n')
      }
    }
    save()
  } catch (error) { console.error(error) }
}, 700)
save()
writeFileSync('.workbench/session-07-native-location.json', JSON.stringify({ directory, seeds, pid: process.pid, desktopPid: desktop.pid }, null, 2) + '\n')
console.log(JSON.stringify({ ready: true, directory, desktopPid: desktop.pid }))
let closing
async function close() { if (closing) return closing; closing = (async () => {
  clearInterval(timer); const before = audit(); await vite.close(); await app.close()
  const pids = before.resources.kernels.map(row => row.pid).filter(Boolean)
  writeFileSync(join(directory, existing ? 'native-restart-closed.json' : 'native-first-closed.json'), JSON.stringify({ ...before, closed: true, ownedProcessesExited: pids.every(pid => { try { process.kill(pid, 0); return false } catch { return true } }) }, null, 2) + '\n')
  console.log('NATIVE_CLOSED_OK')
})(); return closing }
desktop.once('exit', () => void close()); process.once('SIGINT', () => { desktop.kill(); void close() })
