// @env node
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { legacyPrefixes, legacyRoutes } from './routes.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const docsRoot = resolve(root, 'docs')

/** @param {string} directory @returns {string[]} */
function documents(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = resolve(directory, entry.name)
    // Captured evidence retains its original paths and outputs.
    if (entry.isSymbolicLink() || entry.name.endsWith('-evidence')) {
      return []
    }
    if (entry.isDirectory()) {
      return documents(file)
    }
    return /\.(?:md|html)$/.test(entry.name) ? [file] : []
  })
}

const files = [resolve(root, 'README.md'), resolve(root, 'AGENTS.md'), ...documents(docsRoot)]
/** @type {string[]} */
const errors = []
let links = 0
for (const file of files) {
  let source = readFileSync(file, 'utf8')
  if (extname(file) === '.md') {
    source = source.replace(/^```[^\n]*\n[\s\S]*?^```/gm, '')
  }
  source = source.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>')
  const references = [
    ...source.matchAll(/(?:href|src)=["']([^"']+)["']/g),
    ...source.matchAll(/\]\(<?([^\s)>]+)>?\)/g),
  ]
  for (const reference of references) {
    const value = reference[1]
    if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value) || value.includes('${')) {
      continue
    }
    const pathname = value.split(/[?#]/)[0]
    if (!pathname) {
      continue
    }
    const target = pathname.startsWith('/')
      ? resolve(docsRoot, `.${decodeURIComponent(pathname)}`)
      : resolve(dirname(file), decodeURIComponent(pathname))
    links++
    if (!target.startsWith(resolve(root) + sep) || !existsSync(target)) {
      errors.push(`${relative(root, file)} -> ${value}`)
    }
  }
}
for (const [from, to] of legacyRoutes) {
  assert.ok(existsSync(resolve(docsRoot, `.${to}`)), `Legacy redirect target missing: ${from}`)
}
for (const [from, to] of legacyPrefixes) {
  assert.ok(
    statSync(resolve(docsRoot, `.${to}`)).isDirectory(),
    `Legacy prefix target missing: ${from}`,
  )
}
assert.ok(!existsSync(resolve(root, 'planning')), 'Planning sources belong in scripts/planning')
assert.deepEqual(
  readdirSync(root).filter((name) => name.startsWith('pi-workbench-')),
  [],
)
assert.deepEqual(errors, [], `Broken documentation links:\n${errors.join('\n')}`)

/** @type {unknown} */
const backlog = JSON.parse(readFileSync(resolve(docsRoot, 'product/backlog.json'), 'utf8'))
const prd = readFileSync(resolve(docsRoot, 'product/prd.html'), 'utf8')
const embedded = prd.match(/<script[^>]*id="prdBacklog"[^>]*>([\s\S]*?)<\/script>/)
assert.ok(embedded?.[1], 'Generated PRD must embed the backlog')
/** @type {unknown} */
const prdData = JSON.parse(embedded[1])
assert.deepEqual(prdData, backlog, 'PRD must match the canonical backlog')
console.log(
  `PASS documentation structure: ${files.length} documents, ${links} local links, legacy redirects and PRD data`,
)
