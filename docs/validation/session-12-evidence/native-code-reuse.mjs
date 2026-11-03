import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs'
import {join,relative,resolve} from 'node:path'
const root=resolve('.'),report=JSON.parse(readFileSync('.workbench/session-12-evidence/clean/clean-workspace.json','utf8'))
const files=[]
const walk=path=>{for(const row of readdirSync(path,{withFileTypes:true})){if(['dist','node_modules'].includes(row.name))continue;const full=join(path,row.name);if(row.isDirectory())walk(full);else files.push(relative(root,full))}}
for(const dir of ['apps','packages','scripts','e2e'])walk(resolve(dir))
files.push('package.json','pnpm-workspace.yaml','pnpm-lock.yaml','.oxlintrc.json','.oxfmtrc.json','.editorconfig','.gitignore','.gitattributes','knip.json','vitest.config.ts','playwright.config.ts','tsconfig.tools.json')
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex')
const rows=files.sort().map(path=>({path,sha256:hash(join(root,path)),cleanSha256:existsSync(join(report.destination,path))?hash(join(report.destination,path)):null}))
const differences=rows.filter(row=>row.sha256!==row.cleanSha256)
const record={source:'Byte comparison of all product, tests, scripts and root tool configurations with the successful frozen clean input. Docs/progress/evidence may change separately.',at:new Date().toISOString(),cleanDirectory:report.destination,count:rows.length,differences,files:rows}
writeFileSync('.workbench/session-12-evidence/native-code-reuse-audit.json',JSON.stringify(record,null,2)+'\n')
assert.deepEqual(differences,[])
console.log(JSON.stringify({count:rows.length,differences:0,cleanDirectory:report.destination}))
