// @env node
import { readFile, realpath } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { legacyPrefixes, legacyRoutes } from './routes.mjs'

const docsRoot = await realpath(fileURLToPath(new URL('../../docs/', import.meta.url)))
const port = Number(process.env.PIW_DOCS_PORT || 8765)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PIW_DOCS_PORT must be between 1 and 65535')
}
const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/plain; charset=utf-8'],
  ['.log', 'text/plain; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
])

/**
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 */
async function serve(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end()
    return
  }
  /** @type {URL} */
  let url
  /** @type {string} */
  let pathname
  try {
    url = new URL(request.url || '/', 'http://127.0.0.1')
    pathname = decodeURIComponent(url.pathname)
  } catch {
    response.writeHead(400).end('Invalid URL')
    return
  }
  let redirect = legacyRoutes.get(pathname)
  if (!redirect) {
    for (const [prefix, replacement] of legacyPrefixes) {
      if (pathname.startsWith(prefix)) {
        redirect = replacement + pathname.slice(prefix.length)
        break
      }
    }
  }
  if (redirect) {
    response.writeHead(302, { Location: redirect + url.search }).end()
    return
  }
  if (pathname === '/') {
    pathname = '/index.html'
  }
  if (pathname === '/favicon.ico') {
    response.writeHead(204).end()
    return
  }
  const path = resolve(docsRoot, `.${pathname}`)
  if (
    !path.startsWith(docsRoot + sep) ||
    /(?:^|[\\/])(?:node_modules|dist|\.[^\\/]+)(?:[\\/]|$)/.test(pathname)
  ) {
    response.writeHead(404).end('Not found')
    return
  }
  const contentType = contentTypes.get(extname(path))
  if (!contentType) {
    response.writeHead(404).end('Not found')
    return
  }
  try {
    const actualPath = await realpath(path)
    if (!actualPath.startsWith(docsRoot + sep)) {
      response.writeHead(404).end('Not found')
      return
    }
    const body = await readFile(actualPath)
    response.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(request.method === 'HEAD' ? undefined : body)
  } catch {
    response.writeHead(404).end('Not found')
  }
}

const server = createServer((request, response) => {
  void serve(request, response).catch((error) => {
    console.error(error)
    if (!response.headersSent) {
      response.writeHead(500)
    }
    response.end()
  })
})
server.listen(port, '127.0.0.1', () => {
  console.log(`Pi Workbench docs http://127.0.0.1:${port}; serving docs/`)
})
function close() {
  server.closeAllConnections()
  server.close()
}
process.once('SIGINT', close)
process.once('SIGTERM', close)
