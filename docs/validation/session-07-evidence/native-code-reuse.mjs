import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const source = process.cwd()
const clean = JSON.parse(readFileSync('.workbench/evidence/session-07/clean-workspace.json', 'utf8')).destination
assert.equal(typeof clean, 'string')
const files = []
function walk(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (['dist', 'node_modules', '.workbench', 'test-results', 'playwright-report'].includes(entry.name)) continue
    const file = join(path, entry.name)
    if (entry.isDirectory()) walk(file)
    else files.push(relative(source, file))
  }
}
for (const path of ['apps', 'packages', 'e2e', 'scripts']) walk(join(source, path))
for (const path of ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', '.oxlintrc.json', '.oxfmtrc.json', '.editorconfig', '.gitignore', '.gitattributes', 'knip.json', 'vitest.config.ts', 'playwright.config.ts', 'tsconfig.tools.json']) files.push(path)
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const rows = files.map(path => ({ path: path.replaceAll('\\', '/'), sha256: hash(join(source, path)), cleanSha256: existsSync(join(clean, path)) ? hash(join(clean, path)) : null }))
const differences = rows.filter(row => row.sha256 !== row.cleanSha256)
const result = { source, clean, checkedAt: new Date().toISOString(), fileCount: rows.length, differences, files: rows }
writeFileSync('.workbench/evidence/session-07/code-reuse-audit.json', `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify({ fileCount: rows.length, differences }))
assert.equal(differences.length, 0)
