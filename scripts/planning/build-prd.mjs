import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { createHash } from 'node:crypto';
import { validateData } from './backlog-model.mjs';
import { journeys, surfaceMap } from './prd-flows.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../..');
const backlog = JSON.parse(readFileSync(join(root, 'docs/product/backlog.json'), 'utf8'));
const errors = validateData(backlog);
if (errors.length) throw new Error(errors.join('\n'));
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const questionStatus = q => ({resolved:"已验证（M0）",decided:"方案已定，待验证",open:"待细化 / 验证"}[q.status] || "待细化 / 验证");
const req = id => `<button type="button" class="req-link" data-req="${id}">${id}</button>`;
for (const flow of journeys) for (const id of flow.ids) if (!backlog.features.some(f=>f.id===id)) throw new Error(`${flow.id} 引用了不存在的功能 ${id}`);
const local = backlog.features.filter(f=>f.milestone!=='M8');
const replacements = {
  __BACKLOG_VERSION__:esc(backlog.version), __FEATURE_COUNT__:backlog.features.length, __MODULE_COUNT__:backlog.modules.length,
  __LOCAL_COUNT__:local.length, __OPTIONAL_COUNT__:backlog.features.length-local.length, __VERIFIED_COUNT__:local.filter(f=>f.progress.status==='verified').length,
  __PRD_MODULE_OPTIONS__:backlog.modules.map(m=>`<option value="${m.id}">${m.id} · ${esc(m.name)}</option>`).join(''),
  __PRD_MILESTONES__:backlog.milestones.map(m=>`<div class="milestone-row"><strong>${m.id}</strong><span>${esc(m.name)}</span><span>${esc(m.outcome)} · ${backlog.features.filter(f=>f.milestone===m.id).length} 项</span></div>`).join(''),
  __PRD_JOURNEY_NAV__:journeys.map(j=>`<button type="button" data-jump="journey-${j.id}">${j.id} ${esc(j.title)}</button>`).join(''),
  __PRD_JOURNEYS__:journeys.map(j=>`<section class="journey-section" id="journey-${j.id}"><div class="f-head"><h3>${j.id} ${esc(j.title)}</h3><button type="button" class="proto-btn" data-scene="${j.scene}">体验此流程</button></div><p><strong>入口：</strong>${esc(j.entry)}</p><ol>${j.steps.map(step=>`<li>${esc(step)}</li>`).join('')}</ol><p><strong>异常与等待：</strong>${esc(j.states)}</p><p><strong>结果：</strong>${esc(j.result)}</p><div>${j.ids.map(req).join(' ')}</div></section>`).join(''),
  __PRD_COVERAGE__:backlog.modules.map(m=>`<section class="coverage-module" data-module="${m.id}"><h3>${m.id} ${esc(m.name)}</h3><p>${esc(m.goal)} · 界面入口：${esc(surfaceMap[m.id])}</p>${backlog.features.filter(f=>f.module===m.id).map(f=>`<details class="requirement" id="req-${f.id}" data-module="${m.id}" data-milestone="${f.milestone}"><summary><span class="req-id">${f.id}</span><strong>${esc(f.title)}</strong><span class="status-chip">${f.milestone}</span><span class="status-chip">${esc(backlog.statuses[f.progress.status])}</span></summary><div class="requirement-body"><p>${esc(f.summary)}</p><p class="req-meta">界面：${esc(surfaceMap[m.id])}<br>设计：${esc(backlog.definitionStatuses[f.definition])}；来源：${esc(backlog.supportLabels[f.support])}<br>依赖：${f.dependsOn.map(req).join(' ')||'无'}<br>负责人：${esc(f.progress.owner||'未分配')}；目标日期：${esc(f.progress.targetDate||'未估算')}</p><h4>原始验收条件</h4><ol>${f.acceptance.map((a,i)=>`<li>${f.progress.acceptanceChecked[i]?'已勾选：':''}${esc(a)}</li>`).join('')}</ol>${f.progress.note?`<p>进展：${esc(f.progress.note)}</p>`:''}<p>实现 / 验证证据：${esc(f.progress.evidence||'暂无；原型不构成产品验收')}</p><p>${journeys.filter(j=>j.ids.includes(f.id)).map(j=>`<button type="button" class="req-link" data-jump="journey-${j.id}">${j.id} ${esc(j.title)}</button>`).join(' ')||'具体实现与验证按该模块专项验收。'} <a href="roadmap.html#feature=${f.id}">在看板中维护进度 ↗</a></p></div></details>`).join('')}</section>`).join(''),
  __PRD_DECISIONS__:backlog.decisions.map(d=>`<section class="decision-row" id="decision-${d.id}"><h3>${d.id} ${esc(d.title)}</h3><p>${esc(d.text)}</p></section>`).join(''),
  __PRD_QUESTIONS__:backlog.questions.map(q=>`<details class="requirement"><summary><span class="req-id">${q.id}</span><strong>${esc(q.title)}</strong><span class="status-chip">${esc(questionStatus(q))}</span><span class="status-chip">${q.decideBy}</span></summary><div class="requirement-body"><p>验证办法：${esc(q.method)}</p><p>${q.status === "open" ? "候选默认" : "决定"}：${esc(q.defaultDecision)}</p>${q.evidence ? `<p>已有证据：${esc(q.evidence)}</p>` : ""}</div></details>`).join(''),
};
const sources = Object.fromEntries([
  ['prd.template.html', 'templates/prd.html'],
  ['prd-document.html', 'templates/prd-document.html'],
  ['prd-ui.css', 'assets/prd-ui.css'],
  ['prd-app.js', 'assets/prd-app.js'],
].map(([name, source]) => [name, readFileSync(join(directory, source), 'utf8')]));
new Script(sources['prd-app.js']);
if (/<\/script/i.test(sources['prd-app.js'])) throw new Error('原型脚本不能包含 script 结束标签');
let html = sources['prd.template.html'];
for (const [token, source] of [['__PRD_DOCUMENT__', 'prd-document.html'], ['__PRD_CSS__', 'prd-ui.css'], ['__PRD_JS__', 'prd-app.js']]) {
  if (!html.includes(token)) throw new Error(`模板缺少 ${token}`);
  html = html.replace(token, () => sources[source]);
}
for (const [token,value] of Object.entries(replacements)) html=html.replaceAll(token,String(value));
html=html.replace('__PRD_BACKLOG__',()=>JSON.stringify(backlog).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029'));
if (/__[A-Z_]+__/.test(html)) throw new Error('仍有未替换的模板占位');
const revision = createHash('sha256').update(html).digest('hex').slice(0, 12);
html = html.replace('</head>', `<meta name="prd-revision" content="${revision}">\n</head>`);
writeFileSync(join(root, 'docs/product/prd.html'), html, 'utf8');
process.stdout.write(JSON.stringify({ generated: 'docs/product/prd.html', revision, selfContained: true, featureSections: [...html.matchAll(/class="feature-section"/g)].length, journeys:journeys.length, modules:backlog.modules.length, mappedFeatures:backlog.features.length, verified:local.filter(f=>f.progress.status==='verified').length }) + '\n');
