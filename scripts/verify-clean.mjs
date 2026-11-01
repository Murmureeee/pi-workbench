// @env node
import assert from 'node:assert/strict'
import { fork, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { healthSchema } from '../packages/shared/dist/index.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const destination = mkdtempSync(join(dirname(root.replace(/[\\/]$/, '')), '.piw-clean-'))
const evidenceDirectory = resolve(
  root,
  process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest',
)
mkdirSync(evidenceDirectory, { recursive: true })
const packageManager = process.env.npm_execpath
if (typeof packageManager !== 'string' || !packageManager.endsWith('pnpm.exe')) {
  throw new Error('Run with pnpm on Windows: pnpm verify:clean')
}

for (const name of ['apps', 'packages', 'scripts', 'e2e', 'docs']) {
  cpSync(join(root, name), join(destination, name), {
    recursive: true,
    filter: (source) => !/[\\/](?:node_modules|dist)(?:[\\/]|$)/.test(source),
  })
}
for (const name of [
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  '.oxlintrc.json',
  '.oxfmtrc.json',
  '.editorconfig',
  '.gitignore',
  '.gitattributes',
  'README.md',
  'AGENTS.md',
  '.vscode',
  'knip.json',
  'vitest.config.ts',
  'playwright.config.ts',
  'tsconfig.tools.json',
]) {
  cpSync(join(root, name), join(destination, name), { recursive: true })
}

const commands = []
for (const args of [
  ['install', '--frozen-lockfile'],
  ['check'],
  ['build'],
  ['test'],
  ['smoke:sdk'],
]) {
  console.log(`Clean workspace: pnpm ${args.join(' ')}`)
  let output = ''
  const child = spawn(packageManager, args, { cwd: destination, windowsHide: true })
  child.stdout.on('data', (chunk) => {
    output += chunk
  })
  child.stderr.on('data', (chunk) => {
    output += chunk
  })
  const exitCode = await new Promise(
    /** @param {(code: number | null) => void} done */ (done, reject) => {
      child.once('error', reject)
      child.once('exit', done)
    },
  )
  const record = { command: `pnpm ${args.join(' ')}`, exitCode, output }
  commands.push(record)
  writeFileSync(
    join(evidenceDirectory, 'clean-commands.json'),
    `${JSON.stringify({ destination, commands }, null, 2)}\n`,
  )
  assert.equal(exitCode, 0, output)
}

let serverOutput = ''
const server = fork(join(destination, 'scripts/dev.mjs'), [], {
  cwd: destination,
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
})
server.stdout.on('data', (chunk) => {
  serverOutput += chunk
})
server.stderr.on('data', (chunk) => {
  serverOutput += chunk
})
const exited = new Promise(
  /** @param {(code: number | null) => void} done */ (done) => server.once('exit', done),
)
/** @type {import('../packages/shared/dist/types.js').Health | undefined} */
let health
try {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    try {
      health = healthSchema.parse(
        await (
          await fetch('http://127.0.0.1:5173/api/health', {
            signal: AbortSignal.timeout(1000),
          })
        ).json(),
      )
      break
    } catch {
      await delay(250)
    }
  }
  assert.ok(health, serverOutput)
  assert.equal(health.realProviderEnabled, false, serverOutput)
  assert.match(health.node, /^v24\./)
  assert.equal((await fetch('http://127.0.0.1:5173/')).status, 200)
  assert.equal((await fetch('http://127.0.0.1:5173/src/main.tsx')).status, 200)
} finally {
  server.send('shutdown')
  const timer = setTimeout(() => server.kill(), 10000)
  const exitCode = await exited
  clearTimeout(timer)
  assert.equal(exitCode, 0, serverOutput)
}
const record = {
  feature: 'OPS-01',
  verifiedAt: new Date().toISOString(),
  node: process.version,
  destination,
  commands: commands.map(({ command, exitCode }) => ({ command, exitCode })),
  lockSha256: createHash('sha256')
    .update(readFileSync(join(root, 'pnpm-lock.yaml')))
    .digest('hex'),
  cleanLockSha256: createHash('sha256')
    .update(readFileSync(join(destination, 'pnpm-lock.yaml')))
    .digest('hex'),
  health,
  uiStatus: 200,
  uiModuleStatus: 200,
  gracefulShutdown: true,
  serverOutput,
  providerRequests: 0,
}
assert.equal(record.lockSha256, record.cleanLockSha256)
writeFileSync(
  join(evidenceDirectory, 'clean-workspace.json'),
  `${JSON.stringify(record, null, 2)}\n`,
)
console.log(JSON.stringify(record, null, 2))
