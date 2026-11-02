// @env node
import { AccessService } from '../modules/security/access.service.js'
import { pairingConsole } from '../modules/security/host-access.js'
import { createApp } from './app.js'
import { readOptions } from './options.js'

const options = readOptions()
const app = await createApp(options)
await app.listen(options.port, '127.0.0.1')
const closeConsole = pairingConsole(app.get(AccessService), null)
app.getHttpAdapter().getInstance().server.once('close', closeConsole)
console.log(`Pi Workbench offline daemon http://127.0.0.1:${options.port};
real provider disabled`)
