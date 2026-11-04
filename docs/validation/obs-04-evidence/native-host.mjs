import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {appendFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {join,resolve} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {createServer} from 'vite'
import {createApp} from '../apps/daemon/dist/bootstrap/app.js'
import {AccessService} from '../apps/daemon/dist/modules/security/access.service.js'
import {KernelService} from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import {SessionService} from '../apps/daemon/dist/modules/sessions/session.service.js'
import {SessionStore} from '../apps/daemon/dist/modules/sessions/session.store.js'
import {hostAccessRequestSchema} from '../packages/shared/dist/index.js'

const existing=process.argv[2]
const directory=existing?resolve(existing):mkdtempSync(resolve('.workbench/obs04-native-'))
const data=join(directory,'data');mkdirSync(data,{recursive:true})
const hash=p=>existsSync(p)?createHash('sha256').update(readFileSync(p)).digest('hex'):null
const protectedFiles=['docs/validation/live-validation-budget.json','pnpm-lock.yaml',...['auth.json','models.json','settings.json'].map(n=>join(process.env.USERPROFILE,'.pi','agent',n))]
const protectedHashes=()=>Object.fromEntries(protectedFiles.map(p=>[p,hash(p)]))
const protectedBefore=protectedHashes()
const app=await createApp({dataDir:data,port:4317,development:true,resourceLimits:{modelTasks:2}})
const kernels=app.get(KernelService),store=app.get(SessionStore),service=app.get(SessionService),original=kernels.prompt.bind(kernels)
let prompts=0;const results=[]
kernels.prompt=(id,cwd,input,options)=>{prompts++;return original(id,cwd,{...input,fixture:input.text.includes('持续滚动')?'scrolling':input.text.includes('长内容')?'rendering-long':'reply'},options).then(result=>{results.push({sessionId:id,...result});return result})}
if(!existing){
 for(const text of ['OBS04 长内容阅读','OBS04 分页样本','OBS04 乙独立会话','OBS04 丙独立会话']){
  const receipt=await service.submit({requestId:randomUUID(),sessionId:null,configuration:{projectId:null,workspaceId:null,model:{kind:'local-fixture',provider:'piw-offline',model:'fixture'},thinking:'off'},text,retryOf:null})
  const deadline=Date.now()+20000
  while(store.submission(receipt.submission.requestId)?.status!=='completed'&&Date.now()<deadline)await delay(100)
  assert.equal(store.submission(receipt.submission.requestId)?.status,'completed')
  if(text.includes('分页样本')){
   const file=kernels.list().find(k=>k.sessionId===receipt.session.id)?.sessionFile;assert(file)
   await kernels.destroy(receipt.session.id)
   appendFileSync(file,Array.from({length:210},(_,i)=>JSON.stringify({type:'message',id:`native-page-${i}`,parentId:i?`native-page-${i-1}`:null,message:{role:'user',content:`分页样本第${i}条：`+'回看位置与历史保持。'.repeat(12)}})).join('\n')+'\n')
  }
 }
}
const histories=()=>existsSync(join(data,'kernels'))?Object.fromEntries(readdirSync(join(data,'kernels'),{recursive:true}).filter(n=>n.endsWith('.jsonl')).map(n=>[n,hash(join(data,'kernels',n))])):{}
const historyBefore=histories()
await app.listen(4317,'127.0.0.1')
const vite=await createServer({root:resolve('apps/web'),configFile:resolve('apps/web/vite.config.ts')});await vite.listen()
const electron=createRequire(resolve('apps/desktop/package.json'))('electron');assert.equal(typeof electron,'string')
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
const desktop=spawn(electron,[resolve('apps/desktop'),`--user-data-dir=${join(directory,'profile')}`],{env,stdio:['ignore','pipe','pipe','ipc'],windowsHide:false})
desktop.stdout.resume();desktop.stderr.on('data',chunk=>process.stderr.write(chunk))
desktop.on('message',m=>{const request=hostAccessRequestSchema.safeParse(m);if(request.success&&desktop.connected)desktop.send({type:'host-access-result',id:request.data.id,apiOrigin:'http://127.0.0.1:4317',ticket:app.get(AccessService).issueTicket(request.data.operation)})})
const audit=()=>({feature:'OBS-04',source:'Windows native SendInput/UIA; actual Electron/daemon/SQLite/SDK/local SSE. Pagination rows are explicitly synthetic file fixtures appended after SDK shutdown. No CDP or renderer routing.',directory,desktopPid:desktop.pid,prompts,results,sessions:store.managedSessions(),submissions:store.managedSessions().flatMap(s=>store.submissions(s.id)),resources:kernels.resources(),historyBefore,historyAfter:histories(),protectedBefore,protectedAfter:protectedHashes(),providerRequests:0})
const save=()=>writeFileSync(join(directory,'audit.json'),JSON.stringify(audit(),null,2)+'\n')
const timer=setInterval(save,700);save()
writeFileSync('.workbench/obs04-native-location.json',JSON.stringify({directory,desktopPid:desktop.pid,hostPid:process.pid},null,2)+'\n')
console.log(JSON.stringify({ready:true,directory,desktopPid:desktop.pid}))
let closing
async function close(){if(closing)return closing;closing=(async()=>{clearInterval(timer);const before=audit();await vite.close();await app.close();const pids=before.resources.kernels.map(k=>k.pid).filter(Boolean);writeFileSync(join(directory,existing?'restart-closed.json':'first-closed.json'),JSON.stringify({...before,closed:true,ownedProcessesExited:pids.every(pid=>{try{process.kill(pid,0);return false}catch{return true}})},null,2)+'\n');console.log('NATIVE_CLOSED_OK')})();return closing}
desktop.once('exit',()=>void close());process.once('SIGINT',()=>{desktop.kill();void close()})
