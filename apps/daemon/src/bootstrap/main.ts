// @env node
import { createApp } from './app.js'
import { readOptions } from './options.js'

const options = readOptions()
const app = await createApp(options)
await app.listen(options.port, '127.0.0.1')
console.log(`Pi Workbench offline daemon http://127.0.0.1:${options.port};
real provider disabled`)
