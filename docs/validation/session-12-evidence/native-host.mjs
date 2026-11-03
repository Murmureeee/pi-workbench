import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve, sep } from 'node:path'
import { createServer } from 'vite'
import { createApp } from '../../../apps/daemon/dist/bootstrap/app.js'
import { AccessService } from '../../../apps/daemon/dist/modules/security/access.service.js'
import { SessionService } from '../../../apps/daemon/dist/modules/sessions/session.service.js'
import { SessionStore } from '../../../apps/daemon/dist/modules/sessions/session.store.js'
import { SearchService } from '../../../apps/daemon/dist/modules/search/search.service.js'
import { WorkspaceDatabase } from '../../../apps/daemon/dist/infrastructure/database/database.js'
import { KernelService } from '../../../apps/daemon/dist/modules/kernels/kernel.service.js'
import { ProjectService } from '../../../apps/daemon/dist/modules/workspaces/project.service.js'
import { WorkspaceService } from '../../../apps/daemon/dist/modules/workspaces/workspace.service.js'
import { seedSearchSession } from '../../../apps/daemon/test/helpers/search.ts'
import { hostAccessRequestSchema } from '../../../packages/shared/dist/index.js'

// Native-only harness: production main/preload/renderer, real SQLite and loopback SDK.
// Synthetic large histories are labeled; there is no CDP or browser route interception.
const existing=process.argv.find(value=>value.startsWith('--directory='))?.slice(12)
const directory=existing?resolve(existing):mkdtempSync(resolve('.workbench/session-12-native-'))
assert(directory.startsWith(resolve('.workbench')+sep))
const data=join(directory,'data'),pi=join(directory,'pi'),projectPath=join(directory,'中文项目目录')
if(!existing){
 for(const path of [data,pi,projectPath])mkdirSync(path,{recursive:true})
 for(const [name,text]of Object.entries({'auth.json':'{}\n','models.json':'{"providers":{}}\n','settings.json':'{}\n'}))writeFileSync(join(pi,name),text)
}
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex')
const configs=()=>Object.fromEntries(['auth.json','models.json','settings.json'].map(name=>[name,hash(join(pi,name))]))
const configBefore=configs(),budgetBefore=hash('docs/validation/live-validation-budget.json')
const app=await createApp({dataDir:data,port:4317,development:true,piAgentDir:pi})
const service=app.get(SessionService),store=app.get(SessionStore),kernels=app.get(KernelService),projects=app.get(ProjectService),search=app.get(SearchService)
let seedPhase=!existing,seedPrompts=0,fixturePrompts=0,uiPrompts=0,failSearch=false,background
const originalPrompt=kernels.prompt.bind(kernels)
kernels.prompt=(id,cwd,prompt,options)=>{
 if(seedPhase)seedPrompts++
 else if(prompt.text==='SESSION-12 原生后台夹具')fixturePrompts++
 else uiPrompts++
 return originalPrompt(id,cwd,{...prompt,...prompt.text==='SESSION-12 原生后台夹具'?{fixture:'hold'}:{}},options)
}
const waitSettled=async receipt=>{
 const deadline=Date.now()+15000
 while(store.submission(receipt.submission.requestId)?.status!=='completed'){
  if(Date.now()>deadline)throw new Error('Local SDK seed did not settle')
  await new Promise(done=>setTimeout(done,100))
 }
}
let seeds
if(!existing){
 const w=await app.get(WorkspaceService).open(projectPath);assert(w.ok)
 const a=await projects.create({requestId:randomUUID(),name:'同名项目',workspaceId:w.workspace.id})
 const b=await projects.create({requestId:randomUUID(),name:'同名项目',workspaceId:null})
 const first=await seedSearchSession(app,data,'中文标题甲',Array.from({length:132},(_,i)=>i===4?'芝麻用户定位，中文长历史第 4 条':i===5?'芝麻助手定位：这是旧消息':`合成历史上下文 ${i}`),a.id)
 const second=await seedSearchSession(app,data,'中文标题乙',['另一用户输入','尾部秘密 api_key=redact-me-search 后文助手可见'],b.id)
 const third=await seedSearchSession(app,data,'无项目备忘',['无项目用户内容','独立会话回答'])
 store.organize(third.session.id,{action:'archive',archived:true,expectedRevision:store.organizations().find(row=>row.sessionId===third.session.id).revision})
 for(let i=0;i<21;i++)await seedSearchSession(app,data,`分页最近 ${String(i+1).padStart(2,'0')}`)
 const real=await service.submit({requestId:randomUUID(),sessionId:null,text:'真实 SDK 离线索引',retryOf:null,configuration:{projectId:null,workspaceId:null,model:{kind:'local-fixture',provider:'piw-offline',model:'fixture'},thinking:'off'}})
 await waitSettled(real)
 service.rename(real.session.id,{title:'离线 SDK 留档',expectedVersion:1})
 seeds={first:first.session.id,second:second.session.id,third:third.session.id,real:real.session.id,projectA:a.id,projectB:b.id}
 writeFileSync(join(directory,'seed-identities.json'),JSON.stringify(seeds,null,2)+'\n')
}else seeds=JSON.parse(readFileSync(join(directory,'seed-identities.json'),'utf8'))
seedPhase=false
const searchCalls=[],searchOriginal=search.search.bind(search)
search.search=input=>{
 const record={at:Date.now(),querySha256:createHash('sha256').update(input.q).digest('hex'),queryCodepoints:Array.from(input.q).length,project:input.project,state:input.state,archive:input.archive,page:input.page}
 searchCalls.push(record)
 if(failSearch){record.failed=true;throw new Error('Native offline search failure fixture')}
 const result=searchOriginal(input)
 record.total=result.total;record.sessionIds=result.results.map(row=>row.sessionId);record.matches=result.results.map(row=>row.match)
 return result
}
await app.listen(4317,'127.0.0.1')
const vite=await createServer({root:resolve('apps/web'),configFile:resolve('apps/web/vite.config.ts')});await vite.listen()
const requireDesktop=createRequire(resolve('apps/desktop/package.json')),electron=requireDesktop('electron');assert(typeof electron==='string')
const environment={...process.env};delete environment.ELECTRON_RUN_AS_NODE
const desktop=spawn(electron,[resolve('apps/desktop'),`--user-data-dir=${join(directory,'profile')}`],{stdio:['ignore','pipe','pipe','ipc'],env:environment,windowsHide:false})
desktop.stdout.resume();desktop.stderr.on('data',data=>process.stderr.write(data))
desktop.on('message',message=>{const request=hostAccessRequestSchema.safeParse(message);if(request.success&&desktop.connected)desktop.send({type:'host-access-result',id:request.data.id,apiOrigin:'http://127.0.0.1:4317',ticket:app.get(AccessService).issueTicket(request.data.operation)})})
const historyHashes=()=>{
 const root=join(data,'kernels')
 return existsSync(root)?Object.fromEntries(readdirSync(root,{recursive:true}).filter(name=>name.endsWith('.jsonl')).map(name=>[name,hash(join(root,name))])):{}
}
const historyBefore=historyHashes()
const audit=()=>({source:'Actual native Electron + production main/preload; synthetic v3 history and real SDK/local HTTP fixture; no route interception',directory,restored:Boolean(existing),seeds,
 projects:projects.list(),sessions:store.managedSessions(),submissions:store.managedSessions().flatMap(session=>store.submissions(session.id).map(row=>({requestId:row.requestId,sessionId:row.sessionId,status:row.status,turnId:row.turnId}))),
 resources:kernels.resources(),indexDocuments:app.get(WorkspaceDatabase).sqlite.prepare('SELECT count(*) AS count FROM session_search_documents').get(),searchCalls,
 seedPrompts,fixturePrompts,uiPrompts,historyBefore,historyAfter:historyHashes(),configBefore,configAfter:configs(),budgetBefore,budgetAfter:hash('docs/validation/live-validation-budget.json'),realProviderRequests:0})
let busy=false,commandId=existing&&existsSync(join(directory,'native-command.json'))?JSON.parse(readFileSync(join(directory,'native-command.json'),'utf8')).id:'',closing
const timer=setInterval(async()=>{if(busy)return;busy=true;try{
 if(existsSync(join(directory,'native-command.json'))){
  const command=JSON.parse(readFileSync(join(directory,'native-command.json'),'utf8'))
  if(command.id!==commandId){commandId=command.id
   if(command.action==='reject-search')failSearch=true
   else if(command.action==='recover-search')failSearch=false
   else if(command.action==='rename-first'){const current=store.managedSessions().find(row=>row.id===seeds.first);service.rename(current.id,{title:'索引更新后的中文标题',expectedVersion:current.titleVersion})}
   else if(command.action==='start-background'){
    const current=store.managedSessions().find(row=>row.id===seeds.real)
    background=await service.submit({requestId:randomUUID(),sessionId:current.id,text:'SESSION-12 原生后台夹具',retryOf:null,configuration:current.configuration})
   }else if(command.action==='stop-background'){assert(background);await kernels.abort(background.session.id,background.submission.turnId)}
   else if(command.action!=='audit')throw new Error('Unknown fixture command')
   writeFileSync(join(directory,'native-command-result.json'),JSON.stringify({id:command.id,action:command.action,done:true},null,2)+'\n')
  }
 }
 writeFileSync(join(directory,'native-audit.json'),JSON.stringify(audit(),null,2)+'\n')
}catch(error){console.error(error.message)}finally{busy=false}},800)
writeFileSync(join(directory,'native-audit.json'),JSON.stringify(audit(),null,2)+'\n')
writeFileSync('.workbench/session-12-native-location.json',JSON.stringify({directory,pid:process.pid,desktopPid:desktop.pid},null,2)+'\n')
console.log(JSON.stringify({directory,pid:process.pid,desktopPid:desktop.pid,ready:true}))
async function close(){if(closing)return closing;closing=(async()=>{
 clearInterval(timer);const before=audit();await vite.close();await app.close()
 const pids=before.resources.kernels.map(row=>row.pid).filter(Boolean)
 writeFileSync(join(directory,existing?'native-restart-closed.json':'native-closed.json'),JSON.stringify({...before,closed:true,ownedProcessesExited:pids.every(pid=>{try{process.kill(pid,0);return false}catch{return true}})},null,2)+'\n')
 console.log('NATIVE_CLOSED_OK')
})();return closing}
desktop.once('exit',()=>void close());process.once('SIGINT',()=>{desktop.kill();void close()})
