import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve, sep } from 'node:path'
import { createServer } from 'vite'
import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { AccessService } from '../apps/daemon/dist/modules/security/access.service.js'
import { TrustService } from '../apps/daemon/dist/modules/security/trust.service.js'
import { SessionService } from '../apps/daemon/dist/modules/sessions/session.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { WorkspaceDatabase } from '../apps/daemon/dist/infrastructure/database/database.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { WorkspaceService } from '../apps/daemon/dist/modules/workspaces/workspace.service.js'
import { ProjectService } from '../apps/daemon/dist/modules/workspaces/project.service.js'
import { hostAccessRequestSchema } from '../packages/shared/dist/index.js'

const existing=process.argv.find(value=>value.startsWith('--directory='))?.slice(12)
const directory=existing?resolve(existing):mkdtempSync(resolve('.workbench/ws-06-native-'))
assert(directory.startsWith(resolve('.workbench')+sep))
const first=join(directory,'甲目录'),second=join(directory,'Beta'),pi=join(directory,'pi')
if(!existing){
 for(const path of [first,second,pi])mkdirSync(path,{recursive:true})
 for(const path of [first,second])writeFileSync(join(path,'保留文件.txt'),'WS-06 本地夹具，项目整理保留文件。\n')
 for(const [name,text]of Object.entries({'auth.json':'{}\n','models.json':'{"providers":{}}\n','settings.json':'{}\n'}))writeFileSync(join(pi,name),text)
}
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex')
const configHashes=()=>Object.fromEntries(['auth.json','models.json','settings.json'].map(name=>[name,hash(join(pi,name))]))
const configBefore=configHashes(),budgetBefore=hash('docs/validation/live-validation-budget.json')
const app=await createApp({dataDir:join(directory,'data'),port:4317,development:true,piAgentDir:pi})
const service=app.get(SessionService),store=app.get(SessionStore),kernels=app.get(KernelService),workspaces=app.get(WorkspaceService),projects=app.get(ProjectService)
let seedPrompts=0,fixturePrompts=0,uiPrompts=0,seedPhase=!existing
const original=kernels.prompt.bind(kernels)
kernels.prompt=(id,cwd,prompt,options)=>{
 if(seedPhase)seedPrompts++
 else if(prompt.text==='WS-06 原生后台夹具')fixturePrompts++
 else uiPrompts++
 return original(id,cwd,{...prompt,...prompt.text==='WS-06 原生后台夹具'?{fixture:'hold'}:{}},options)
}
const waitSettled=async receipt=>{
 const deadline=Date.now()+15000
 while(store.submission(receipt.submission.requestId)?.status!=='completed'){
  if(Date.now()>deadline)throw new Error('Seed did not complete')
  await new Promise(done=>setTimeout(done,100))
 }
}
if(!existing){
 const wa=await workspaces.open(first);assert(wa.ok)
 const a=await projects.create({requestId:randomUUID(),name:'同名项目',workspaceId:wa.workspace.id})
 const b=await projects.create({requestId:randomUUID(),name:'同名项目',workspaceId:null})
 for(const [project,text]of [[a,'目录项目的保留会话'],[b,'独立空间甲'],[b,'独立空间乙']]){
  const receipt=await service.submit({requestId:randomUUID(),sessionId:null,text,retryOf:null,configuration:{projectId:project.id,workspaceId:project.workspaceId,model:{kind:'local-fixture',provider:'piw-offline',model:'fixture'},thinking:'off'}})
  await waitSettled(receipt)
 }
}
seedPhase=false
await app.listen(4317,'127.0.0.1')
const vite=await createServer({root:resolve('apps/web'),configFile:resolve('apps/web/vite.config.ts')});await vite.listen()
const requireDesktop=createRequire(resolve('apps/desktop/package.json')),electron=requireDesktop('electron');assert(typeof electron==='string')
const environment={...process.env};delete environment.ELECTRON_RUN_AS_NODE
const desktop=spawn(electron,[resolve('apps/desktop'),`--user-data-dir=${join(directory,'profile')}`],{stdio:['ignore','pipe','pipe','ipc'],env:environment,windowsHide:false})
desktop.stdout.resume();desktop.stderr.on('data',data=>process.stderr.write(data))
desktop.on('message',message=>{const request=hostAccessRequestSchema.safeParse(message);if(request.success&&desktop.connected)desktop.send({type:'host-access-result',id:request.data.id,apiOrigin:'http://127.0.0.1:4317',ticket:app.get(AccessService).issueTicket(request.data.operation)})})
const historyHashes=()=>{
 const root=join(directory,'data','kernels')
 return existsSync(root)?Object.fromEntries(readdirSync(root,{recursive:true}).filter(name=>name.endsWith('.jsonl')).map(name=>[name,hash(join(root,name))])):{}
}
const audit=()=>({source:'Actual native Electron, daemon SQLite and SDK/local HTTP fixtures, no route interception',directory,first,second,restored:Boolean(existing),
 projects:projects.list(),projectRecords:app.get(WorkspaceDatabase).sqlite.prepare('SELECT id,name,workspace_id,pinned,position,revision,removed FROM projects ORDER BY pinned DESC,position,id').all(),
 recent:workspaces.recent(),sessions:store.managedSessions(),submissions:store.managedSessions().flatMap(session=>store.submissions(session.id).map(sub=>({requestId:sub.requestId,sessionId:sub.sessionId,status:sub.status,turnId:sub.turnId}))),
 resources:kernels.resources(),trustRecords:app.get(TrustService).inspect().records.length,historyHashes:historyHashes(),
 files:{first:hash(join(first,'保留文件.txt')),second:hash(join(second,'保留文件.txt'))},seedPrompts,fixturePrompts,uiPrompts,
 configBefore,configAfter:configHashes(),budgetBefore,budgetAfter:hash('docs/validation/live-validation-budget.json'),realProviderRequests:0})
const save=()=>writeFileSync(join(directory,'native-audit.json'),JSON.stringify(audit(),null,2)+'\n')
let commandId='',busy=false,background
if(existing&&existsSync(join(directory,'native-command.json')))commandId=JSON.parse(readFileSync(join(directory,'native-command.json'),'utf8')).id
const timer=setInterval(async()=>{if(busy)return;busy=true;try{
 const command=JSON.parse(readFileSync(join(directory,'native-command.json'),'utf8'))
 if(command.id!==commandId){commandId=command.id;const db=app.get(WorkspaceDatabase).sqlite
  if(command.action==='reject-save')db.exec("CREATE TRIGGER deny_project_native BEFORE UPDATE OF name ON projects BEGIN SELECT RAISE(ABORT,'native project fixture failure'); END")
  else if(command.action==='recover-save')db.exec('DROP TRIGGER IF EXISTS deny_project_native')
  else if(command.action==='start-background'){
   const session=store.managedSessions().find(row=>row.cwd===first);assert(session)
   background=await service.submit({requestId:randomUUID(),sessionId:session.id,text:'WS-06 原生后台夹具',retryOf:null,configuration:session.configuration})
  }else if(command.action==='stop-background'){assert(background);await kernels.abort(background.session.id,background.submission.turnId)}
  else if(command.action!=='audit')throw new Error('Unknown native fixture command')
  writeFileSync(join(directory,'native-command-result.json'),JSON.stringify({id:command.id,action:command.action,done:true},null,2)+'\n')
 }
}catch(error){if(error?.code!=='ENOENT')console.error(error.message)}finally{save();busy=false}},800)
save();writeFileSync('.workbench/ws-06-native-location.json',JSON.stringify({directory,first,second,pid:process.pid,desktopPid:desktop.pid},null,2)+'\n')
console.log(JSON.stringify({directory,pid:process.pid,desktopPid:desktop.pid,ready:true}))
let closing
async function close(){if(closing)return closing;closing=(async()=>{
 clearInterval(timer);const before=audit();await vite.close();await app.close()
 const pids=before.resources.kernels.map(row=>row.pid).filter(Boolean)
 writeFileSync(join(directory,'native-closed.json'),JSON.stringify({...before,closed:true,ownedProcessesExited:pids.every(pid=>{try{process.kill(pid,0);return false}catch{return true}})},null,2)+'\n')
 console.log('NATIVE_CLOSED_OK')
})();return closing}
desktop.once('exit',()=>void close());process.once('SIGINT',()=>{desktop.kill();void close()})
