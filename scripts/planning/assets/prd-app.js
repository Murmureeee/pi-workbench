(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const uid = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
  const storeKey = 'pi-workbench-prototype-v2';
  const backlog = JSON.parse($('prdBacklog').textContent);
  const paths = {
    panel:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    compose:'<path d="m14 4 6 6M4 20l4-1 12-12a2 2 0 0 0-4-4L4 15v5Z"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    plus:'<path d="M12 5v14M5 12h14"/>', close:'<path d="m6 6 12 12M18 6 6 18"/>',
    folder:'<path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11H3V7Z"/>',
    chevron:'<path d="m7 10 5 5 5-5"/>', more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    settings:'<path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 3 3-1 2 2 3-2v-3l3-2-1-4-3-1-1-3H9Z"/><circle cx="11" cy="11" r="3"/>',
    'arrow-up':'<path d="M12 19V5m-6 6 6-6 6 6"/>', stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>',
    file:'<path d="M5 3h9l5 5v13H5V3Zm9 0v6h5M8 13h8M8 17h6"/>',
    changes:'<path d="M8 3v10a4 4 0 0 0 4 4h4M5 6l3-3 3 3m2 8 3 3-3 3"/><circle cx="18" cy="6" r="3"/>',
    terminal:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m6 9 3 3-3 3m6 0h5"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', inbox:'<path d="m5 4-3 10v6h20v-6L19 4H5Zm-3 10h6l2 3h4l2-3h6"/>',
    check:'<path d="m5 12 4 4L19 6"/>', branch:'<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 7v10m0-5c8 0 12 0 12-4"/>',
    shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    pin:'<path d="m9 3 9 9-4 1-3 5-2-4-4-2 5-3-1-6ZM4 20l5-6"/>',
    usage:'<path d="M4 20V10m6 10V4m6 16v-7m5 7H2"/>', arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
    play:'<path d="m7 4 13 8-13 8V4Z"/>', agent:'<rect x="4" y="6" width="16" height="14" rx="3"/><path d="M12 6V3M8 12h1m6 0h1m-8 4h8"/>',
    plan:'<path d="M9 5h11M9 12h11M9 19h11M3 5h1m-1 7h1m-1 7h1"/>', copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    alert:'<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3v1"/>', archive:'<path d="M4 8h16v13H4V8ZM3 3h18v5H3V3Zm6 9h6"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.file}</svg>`;
  const btn = (action, label, symbol, attrs='') => `<button type="button" class="icon-button" data-action="${action}" aria-label="${esc(label)}" title="${esc(label)}" ${attrs}>${icon(symbol)}</button>`;
  const actionButton = (action,label,attrs='',primary=false) => `<button type="button" class="button${primary?' primary':''}" data-action="${action}" ${attrs}>${esc(label)}</button>`;
  const statusNames = {idle:'空闲',running:'运行中',awaiting_approval:'待审批',waiting_input:'待输入',interrupted:'已中断',error:'运行失败',compacting:'压缩中'};
  const busy = s => s && ['running','awaiting_approval','waiting_input','compacting'].includes(s.status);
  const baseDraft = projectId => ({text:'',projectId:projectId || null,model:'Claude Sonnet · 示例',thinking:'标准',mode:'execute',contexts:[]});
  function makeFiles() {
    return [{path:'src/auth/redirect.ts',added:5,removed:2,verdict:'pending',conflict:false,lines:[['','12','12','export function resolveRedirect(next: string) {'],['del','13','','  return new URL(next).href;'],['add','','13','  const target = new URL(next, window.location.origin);'],['add','','14','  if (target.origin !== window.location.origin) {'],['add','','15',"    return '/';"],['add','','16','  }'],['add','','17','  return target.pathname + target.search;'],['','14','18','}']]},
      {path:'src/auth/redirect.test.ts',added:8,removed:0,verdict:'pending',conflict:false,lines:[['add','','1',"it('rejects redirects to another origin', () => {"],['add','','2',"  expect(resolveRedirect('https://other.test')).toBe('/');"],['add','','3','});'],['add','','4',"it('keeps the local path and query', () => {"],['add','','5',"  expect(resolveRedirect('/settings?tab=profile'))"],['add','','6',"    .toBe('/settings?tab=profile');"],['add','','7','});']]}];
  }
  function session(id,title,projectId,messages,files=[]) {
    return {id,title,titleSource:'manual',titleVersion:0,projectId,cwd:projectId==='p-design'?'~/Projects/design-system':projectId?'~/Projects/pi-workbench':`~/.pi-workbench/standalone/${id}`,status:'idle',messages:messages.map(m=>({id:uid('m'),...m})),queue:[],files,draft:baseDraft(projectId),updatedAt:Date.now(),pinned:false,archived:false,grants:[],runVersion:0};
  }
  function seed() {
    return {schemaVersion:2,activeId:null,newDraft:baseDraft(),projects:[{id:'p-workbench',name:'pi-workbench',cwd:'~/Projects/pi-workbench',open:true},{id:'p-design',name:'design-system',cwd:'~/Projects/design-system',open:true}],sessions:[
      session('sample-auth','修复登录回调重定向','p-workbench',[{role:'user',text:'修复登录回调在外部 URL 下跳转错误的问题，并补充测试。'},{role:'assistant',text:'已限制回调只能跳转到同源地址，并保留合法的路径和查询参数。'},{role:'tool',name:'read',title:'读取重定向逻辑与测试',status:'完成',text:'src/auth/redirect.ts\nsrc/auth/redirect.test.ts'},{role:'assistant',text:'这里是修改方案的模拟结果。右侧可以逐文件审查；接受只记录保留决定。验证尚未真实运行。',review:true}],makeFiles()),
      session('sample-plan','梳理工作台交互与页面结构','p-workbench',[{role:'user',text:'规划项目、会话、审批和变更审查的页面结构。'},{role:'assistant',text:'建议让任务对话处于中心，项目与会话在左侧，变更与文件在右侧按需打开，终端独立放在底部。'}]),
      session('sample-design','统一按钮的状态和间距','p-design',[{role:'user',text:'检查按钮的 hover、focus 和 disabled 状态。'},{role:'assistant',text:'为按钮建立统一的焦点轮廓、点击区域和状态反馈。'}]),
      session('sample-loose','帮我整理本周待办',null,[{role:'user',text:'帮我把这周工作分成设计、开发和验证。'},{role:'assistant',text:'可以先完成需求设计，再按依赖顺序开发，最后记录验证证据。这个会话没有项目，文件使用独立空间。'}])],layout:{panel:null,panelWidth:420,bottom:null,sidebarCollapsed:false},settings:{theme:'system',font:14,density:'comfortable',autoName:true,approval:'ask'},terminal:{},automations:[],inboxRead:[],connection:true};
  }
  let state;
  try { const saved = JSON.parse(localStorage.getItem(storeKey)); state = saved?.schemaVersion===2 && Array.isArray(saved.sessions) && Array.isArray(saved.projects) ? saved : seed(); }
  catch { state = seed(); }
  state.sessions.forEach(s => {if (busy(s)) {s.status='interrupted';s.grants=[];s.messages.push({id:uid('m'),role:'system',text:'原型已重新打开，未完成运行标记为已中断；不会自动重放工具或队列。'});}});
  let view='prototype', specTab='overview', dialogSubmit=null, dialogOrigin=null, searchTimer, toastTimer, saveTimer, composing=false, autoFollow=true, composerError='', selectedFile=0, selectedCode='src/auth/redirect.ts', settingsTab='appearance', activeSearch=0, searchMatches=[];
  const runTimers = new Map();
  const panelScroll = new Map();
  const viewportScroll = new Map();
  const active = () => state.sessions.find(s=>s.id===state.activeId) || null;
  const draft = () => active()?.draft || state.newDraft;
  const project = id => state.projects.find(p=>p.id===id);
  const projectName = id => project(id)?.name || '无项目';
  const cwd = () => active()?.cwd || draft().cwd || project(draft().projectId)?.cwd || '~/.pi-workbench/standalone/〈发送后分配〉';
  function save() { try {localStorage.setItem(storeKey,JSON.stringify(state));} catch {toast('原型存储不可用，当前演示仍可继续；刷新可能丢失更改。');} }
  function saveSoon() {clearTimeout(saveTimer);saveTimer=setTimeout(save,180);}
  function toast(text) { $('toast').textContent=text; $('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3800); }
  function installIcons(root=document) {root.querySelectorAll('[data-icon]').forEach(node=>node.innerHTML=icon(node.dataset.icon));}
  function options(selected, emptyLabel='无项目') {return `<option value=""${!selected?' selected':''}>${emptyLabel}</option>` + state.projects.map(p=>`<option value="${esc(p.id)}"${p.id===selected?' selected':''}>${esc(p.name)}</option>`).join('');}
  function rememberView() {const s=active();if(s) viewportScroll.set(s.id,{top:$('threadViewport').scrollTop,follow:autoFollow});rememberPanel();}
  function rememberPanel() {const body=$('contextPanel').querySelector('.context-body');if(body)panelScroll.set(`${state.activeId}:${state.layout.panel}`,body.scrollTop);}
  function renderNav() {
    const live=state.sessions.filter(s=>!s.archived).sort((a,b)=>b.updatedAt-a.updatedAt);
    const row=s=>`<div class="session-row${s.id===state.activeId?' active':''}" data-session-row="${esc(s.id)}"><button type="button" class="session-link" data-action="open-session" data-id="${esc(s.id)}" title="${esc(s.title)} · ${statusNames[s.status]}"${s.id===state.activeId?' aria-current="page"':''}><span class="session-dot ${s.status}" aria-hidden="true"></span><span class="session-title">${esc(s.title)}</span><span class="sr-only">${statusNames[s.status]}</span></button>${btn('session-menu',`${s.title} 的更多操作`,'more',`data-id="${s.id}"`)}</div>`;
    $('sessionNavigation').innerHTML=`${live.some(s=>s.pinned)?`<section class="nav-section"><div class="nav-section-header"><span>已置顶</span></div>${live.filter(s=>s.pinned).map(row).join('')}</section>`:''}<section class="nav-section"><div class="nav-section-header"><span>项目</span>${btn('add-project','添加项目','plus')}</div>${state.projects.map(p=>`<div class="project-row"><button type="button" class="project-toggle" data-action="toggle-project" data-id="${p.id}" aria-expanded="${p.open}">${icon('chevron').replace('<svg','<svg class="chevron"')}${icon('folder')}<span class="project-name">${esc(p.name)}</span></button>${btn('new-project-session',`在 ${p.name} 新建会话`,'plus',`data-id="${p.id}"`)}${btn('edit-project',`编辑项目 ${p.name}`,'more',`data-id="${p.id}"`)}</div><div class="project-sessions"${!p.open?' hidden':''}>${live.filter(s=>s.projectId===p.id&&!s.pinned).map(row).join('')||'<p class="nav-empty">还没有会话</p>'}</div>`).join('')}</section><section class="nav-section"><div class="nav-section-header"><span>最近 · 无项目</span></div>${live.filter(s=>!s.projectId&&!s.pinned).map(row).join('')||'<p class="nav-empty">发送任务后，会话会显示在这里</p>'}</section>`;
    $('inboxCount').textContent=String(2-state.inboxRead.length);
  }
  function renderHeader() {
    const s=active();
    $('threadHeader').innerHTML=`${btn('toggle-sidebar','展开或收起导航','panel')}<div class="thread-heading"><button type="button" class="project-label" data-action="environment" title="查看执行环境">${esc(projectName(draft().projectId))}</button><span class="separator">/</span>${s?`<button type="button" class="title-button" data-action="rename" data-id="${s.id}" title="重命名会话"><h1>${esc(s.title)}</h1></button>`:'<h1>新会话</h1>'}</div><div class="header-actions"><button class="panel-button${state.layout.panel==='changes'?' active':''}" data-action="toggle-panel" data-panel="changes" aria-label="打开变更审查">${icon('changes')}<span class="button-label">变更</span>${s?.files.length?`<span class="change-count">${s.files.length}</span>`:''}</button>${btn('files','打开文件面板','file')}${btn('terminal','打开终端','terminal')}${btn(s?'session-menu':'commands','更多操作','more',s?`data-id="${s.id}"`:'')}</div>`;
  }
  function messageHtml(m,s) {
    const tag=`id="message-${esc(m.id)}"`;
    if(m.role==='user')return `<article class="message user" ${tag}><div class="user-bubble">${esc(m.text)}</div></article>`;
    if(m.role==='system')return `<div class="system-message" ${tag}>${esc(m.text)}</div>`;
    if(m.role==='tool')return `<details class="tool-card" ${tag}><summary>${icon(m.status==='完成'?'check':'terminal')}<span>${esc(m.title)}</span><span class="tool-status">${esc(m.status)}</span></summary><div class="tool-content"><p>${esc(m.name)} · ${esc(s.cwd)}</p><pre>${esc(m.text)}</pre></div></details>`;
    if(m.role==='approval')return `<section class="approval-card" ${tag}><div class="approval-heading">${icon('shield')}<strong>${m.decision?'审批记录':'需要你确认'}</strong><span class="risk-badge">L${m.risk||2}</span></div><p>运行验证命令</p><pre>${esc(m.command||'npm test -- redirect')}</pre><p class="message-note">目录：${esc(s.cwd)}<br>命令可能生成测试缓存；外部副作用不属于文件回滚范围。</p>${m.decision?`<p class="status-chip">${esc(m.decision)}</p>`:`<p class="message-note">尚未执行 · 审批仅绑定此命令与目录</p><div class="approval-actions">${actionButton('approve','允许一次',`data-id="${m.id}" data-kind="once"`,true)}${m.risk!==3?actionButton('approve','本会话允许',`data-id="${m.id}" data-kind="session"`):''}${actionButton('approve','拒绝',`data-id="${m.id}" data-kind="deny"`)}</div>`}</section>`;
    if(m.role==='error')return `<div class="message error-message" ${tag}><strong>模型请求失败 · 429</strong><p>${esc(m.text)}</p><div class="card-actions">${actionButton('retry','重试本轮')}${actionButton('settings-models','检查模型配置')}${actionButton('recovery','恢复说明')}</div></div>`;
    if(m.role==='plan')return `<section class="plan-card" ${tag}><h3>执行计划</h3><p class="muted">计划阶段只读调查，确认前不写文件。</p>${['检查回调来源与现有测试','限制同源跳转并保留合法路径','覆盖外部 URL 与查询参数用例'].map((text,i)=>`<div class="plan-step"><span class="step-index">${i+1}</span><div>${text}<small>验收：${['定位相关文件与现有行为','不跳转到其他来源','实际运行定向测试并记录证据'][i]}</small></div></div>`).join('')}<div class="card-actions">${actionButton('execute-plan','确认并转为执行',busy(s)||s.messages.some(m=>m.role==='question'&&!m.answer)?'disabled':'',true)}${actionButton('edit-plan','调整计划')}</div></section>`;
    if(m.role==='question')return `<section class="question-card" ${tag}><h3>需要保留哪些回调目标？</h3>${m.answer?`<p>你的决定：${esc(m.answer)}</p>`:`<p class="muted">选择后记录决定，暂时关闭不会被当作同意。</p><div class="question-options"><label><input type="radio" name="clarification-${m.id}" value="仅允许同源路径" checked>仅允许同源路径（建议）</label><label><input type="radio" name="clarification-${m.id}" value="先讨论受信任域名白名单">先讨论受信任域名白名单</label></div>${actionButton('answer-question','提交决定',`data-id="${m.id}"`,true)}`}</section>`;
    if(m.role==='agents')return agentsHtml();
    return `<article class="message assistant" ${tag}><div class="assistant-label"><span class="pi-mark" aria-hidden="true">π</span><strong>Pi</strong></div><div class="message-text">${esc(m.text).replace(/\n/g,'<br>')}</div>${m.review?`<div class="card-actions">${actionButton('review','审查变更')}${actionButton('git','Git 与交付')}</div>`:''}<div class="message-actions"><button data-action="quote-message" data-id="${m.id}">引用</button><button data-action="fork" data-id="${m.id}">从这里分叉</button></div></article>`;
  }
  function renderThread(force=false) {
    const s=active(),viewport=$('threadViewport'),nearBottom=viewport.scrollHeight-viewport.scrollTop-viewport.clientHeight<90;
    const oldTop=viewport.scrollTop;
    const expanded=[...$('threadContent').querySelectorAll('details[open]')].map(n=>n.id);
    document.querySelector('.work-area').classList.toggle('is-new',!s);
    if(!s) $('threadContent').innerHTML=`<div class="welcome"><span class="pi-mark" aria-hidden="true">π</span><h2>今天想完成什么？</h2><p>从一个问题或任务开始，让工作在这里继续。</p><div class="suggestions"><button type="button" data-action="suggest" data-kind="discuss">${icon('file')}理解项目</button><button type="button" data-action="suggest" data-kind="plan">${icon('plan')}先规划一个改动</button><button type="button" data-action="review-example">${icon('changes')}查看审查示例</button></div></div>`;
    else $('threadContent').innerHTML=s.messages.map(m=>messageHtml(m,s)).join('')+`<div class="run-summary" aria-live="polite">${busy(s)?`${s.status==='awaiting_approval'?'等待审批，命令尚未执行':s.status==='waiting_input'?'等待你的决定':s.status==='compacting'?'正在整理上下文':'正在处理任务'} · ${icon('clock')}`:`${s.status==='interrupted'?'运行已中断，已完成的结果保留':s.status==='error'?'运行失败，已有修改保留':'本轮已结束'}${s.files.some(f=>f.verdict==='pending')?' · 仍有未审查变更':''}`}</div>`;
    expanded.forEach(id=>{const n=$(id);if(n)n.open=true;});
    if(force || (autoFollow&&nearBottom))viewport.scrollTop=viewport.scrollHeight;
    else viewport.scrollTop=oldTop;
    $('returnLatest').hidden=!s || autoFollow;
  }
  function renderComposer() {
    const s=active(),d=draft();
    if($('composerInput').value!==d.text)$('composerInput').value=d.text;
    $('projectSelect').innerHTML=options(d.projectId);
    $('projectSelect').disabled=!!s;
    $('projectSelect').title=s?'已有会话通过菜单整理项目归属':'会话项目可选';
    $('modelSelect').value=d.model; $('thinkingSelect').value=d.thinking; $('modeSelect').value=d.mode;
    $('modeSelect').disabled=busy(s);
    $('sendButton').disabled=!d.text.trim() || s?.status==='compacting' || !state.connection;
    $('stopButton').hidden=!busy(s);
    $('queueKindLabel').hidden=!busy(s);
    $('contextChips').innerHTML=(d.contexts||[]).map((c,i)=>`<div class="context-chip">${icon('file')}<span title="${esc(c.text)}">${esc(c.label)}</span><button data-action="remove-context" data-index="${i}" aria-label="移除 ${esc(c.label)}">×</button></div>`).join('')+(composerError?`<p class="composer-error" role="alert">${esc(composerError)}</p>`:'');
    $('executionContext').innerHTML=`<button class="text-button" data-action="environment" title="${esc(cwd())}">${icon('folder')} ${esc(cwd())}</button><span> · ${d.mode==='execute'?'按规则审批':d.mode==='plan'?'计划 · 只读调查':'讨论 · 不修改环境'}</span>`;
    $('queueList').innerHTML=(s?.queue||[]).map((q,i)=>`<div class="queue-item"><span class="queue-text">${q.kind==='steer'?'引导当前轮':'追加下一轮'} · ${esc(q.text)}</span><button data-action="edit-queue" data-index="${i}" aria-label="编辑排队消息 ${i+1}">编辑</button><button data-action="remove-queue" data-index="${i}" aria-label="移除排队消息 ${i+1}">×</button></div>`).join('')+(s?.queue.length&&!busy(s)?`<div class="queue-item"><span class="queue-text">队列已暂停，等待你继续</span>${actionButton('resume-queue','恢复队列')}${actionButton('clear-queue','清空')}</div>`:'');
  }
  function renderStatus() {
    const s=active();
    $('statusBar').innerHTML=`<span class="connection-dot" aria-hidden="true"></span><button data-action="connection">${state.connection?'本地服务 · 已连接':'连接中断 · 重连'}</button><span>${s?statusNames[s.status]:'准备开始'}</span><span class="spacer"></span><button data-action="environment" class="status-path" title="${esc(cwd())}">${esc(s?.branch || (draft().projectId?'main':'独立空间'))}</button><button data-action="usage">${s?'上下文 24%（示例）':'上下文'} </button>`;
  }
  function render() {
    document.documentElement.dataset.theme=state.settings.theme==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):state.settings.theme;
    document.documentElement.style.setProperty('--ui-size',`${state.settings.font}px`);
    document.documentElement.dataset.density=state.settings.density;
    $('workbench').style.setProperty('--panel-width',`${state.layout.panelWidth}px`);
    $('panelResizer').setAttribute('aria-valuenow',state.layout.panelWidth);
    $('workbench').classList.toggle('sidebar-collapsed',state.layout.sidebarCollapsed);
    $('workspace').classList.toggle('panel-open',!!state.layout.panel);
    renderNav();renderHeader();renderThread();renderComposer();renderPanel();renderBottom();renderStatus();
  }
  function newSession(projectId=null) {rememberView();state.activeId=null;state.newDraft.projectId=projectId;state.layout.panel=null;state.layout.bottom=null;composerError='';autoFollow=true;closeSidebar();save();render();$('composerInput').focus();}
  function openSession(id,messageId) {rememberView();const s=state.sessions.find(x=>x.id===id);if(!s)return;state.activeId=id;composerError='';closeSidebar();const prior=viewportScroll.get(id);autoFollow=prior?.follow??true;render();if(prior)$('threadViewport').scrollTop=prior.top;else $('threadViewport').scrollTop=$('threadViewport').scrollHeight;if(messageId){const n=$(`message-${messageId}`);n?.scrollIntoView({block:'center'});highlight(n);autoFollow=false;}save();}
  function togglePanel(name) {rememberPanel();state.layout.panel=state.layout.panel===name?null:name;closeSidebar();renderHeader();$('workspace').classList.toggle('panel-open',!!state.layout.panel);renderPanel();save();}
  function showPanel(name) {if(state.layout.panel!==name)togglePanel(name);else renderPanel();}
  function closeSidebar() {$('workbench').classList.remove('sidebar-open');}
  function showSidebar() {state.layout.sidebarCollapsed=false;$('workbench').classList.remove('sidebar-collapsed');if(innerWidth<=850){state.layout.panel=null;$('workspace').classList.remove('panel-open');$('workbench').classList.add('sidebar-open');}save();}
  function highlight(node) {if(!node)return;node.classList.add('highlight-region');setTimeout(()=>node.classList.remove('highlight-region'),1800);}
  function renderPanel() {
    const panel=$('contextPanel'),s=active(),tab=state.layout.panel;
    if(!tab){panel.innerHTML='';return;}
    const tabs=[['changes','变更'],['files','文件'],['git','Git'],['usage','用量']];
    const head=`<div class="context-tabs" role="tablist" aria-label="工作面板">${tabs.map(([id,label])=>`<button type="button" role="tab" aria-selected="${tab===id}" class="context-tab${tab===id?' active':''}" data-action="panel-tab" data-panel="${id}">${label}</button>`).join('')}${btn('close-panel','关闭工作面板','close')}</div>`;
    let content='',foot='';
    if(tab==='changes') {
      if(!s?.files.length)content=`<div class="panel-empty">${icon('changes')}<h3>还没有本轮文件变更</h3><p>写入结束后可以在这里审查。计划和讨论不会生成文件修改。</p><br>${actionButton('review-example','查看审查示例')}</div>`;
      else {
        selectedFile=Math.max(0,Math.min(selectedFile,s.files.length-1));
        const f=s.files[selectedFile],done=s.files.filter(f=>f.verdict!=='pending').length;
        content=`<div class="panel-summary"><h2>本轮变更</h2><p>基线：轮次开始前 → 本轮末态 · 模拟文件</p><select class="review-scope" aria-label="Diff 比较范围" id="reviewScope"><option value="turn">本轮修改</option><option value="working">未提交修改（示例）</option><option value="staged">暂存修改（示例）</option><option value="branch">与 main 比较（示例）</option></select><div class="review-progress"><span>${done} / ${s.files.length} 已处理</span><span class="track"><i style="width:${done/s.files.length*100}%"></i></span><span>${done===s.files.length?'全部已处理':'待审查'}</span></div></div>${s.files.map((file,i)=>`<div class="file-row${selectedFile===i?' active':''}">${icon('file')}<button data-action="select-file" data-index="${i}" title="${esc(file.path)}">${esc(file.path)}</button><span class="diff-stat">+${file.added} −${file.removed}</span><span class="file-state">${file.verdict==='accepted'?'已接受':file.verdict==='reverted'?'已回滚':'待审查'}</span></div>`).join('')}${f.conflict?'<div class="conflict-notice"><strong>当前文件又被外部修改</strong><br>与记录末态不一致，自动回滚已停用；整轮回滚也会在预检时停止。</div>':''}<div class="diff-file"><div class="diff-file-header">${icon('file')}${esc(f.path)}</div><div class="diff-hunk">@@ 本轮记录的修改 @@</div><div class="diff-lines">${f.lines.map(([kind,old,line,text])=>`<div class="diff-line ${kind}"><span class="ln">${old}</span><span class="ln">${line}</span><code>${kind==='add'?'+ ':kind==='del'?'- ':'  '}${esc(text)}</code></div>`).join('')}</div><div class="file-actions">${actionButton('file-verdict',f.verdict==='accepted'?'已接受':'接受此文件',`data-kind="accepted"${f.verdict!=='pending'?' disabled':''}`,true)}${actionButton('rollback-file','回滚此文件',f.verdict==='reverted'?'disabled':'')}${actionButton('inline-feedback','添加审查意见')}</div></div><div class="review-note"><strong>验证：尚未真实运行</strong>原型只展示审查状态。接受不会提交 Git；回滚不能撤销命令的外部副作用。</div>`;
        foot=`<div class="panel-footer">${actionButton('accept-all','全部接受')}${actionButton('rollback-all','回滚整轮')}<small>接受仅记录审阅</small></div>`;
      }
    } else if(tab==='files') {
      content=`<div class="panel-summary"><h2>工作区文件</h2><p>${esc(cwd())} · 示例文件树</p></div><div class="file-tree"><div class="tree-row">${icon('folder')} src / auth</div>${['src/auth/redirect.ts','src/auth/redirect.test.ts','package.json','README.md'].map(path=>`<button class="tree-row tree-indent${path===selectedCode?' active':''}" data-action="open-code" data-path="${path}">${icon('file')}${esc(path.split('/').pop())}</button>`).join('')}</div><div class="diff-file-header">${icon('file')}${esc(selectedCode)}</div><pre class="code-preview">${esc(codeFor(selectedCode))}</pre><div class="file-actions">${actionButton('attach-code','引用到草稿')}${actionButton('edit-code','轻量编辑')}${actionButton('preview','预览产物')}</div><div class="review-note">文件内容为示例；引用在发送前可移除。实际文件保存需版本冲突检查。</div>`;
    } else if(tab==='git') {
      const files=s?.files||[];
      content=`<div class="panel-summary"><h2>Git 与交付</h2><p>pi-workbench · ${esc(s?.branch||'main')} · 示例仓库</p><div class="delivery-actions">${actionButton('worktree','独立 Worktree')}${actionButton('code-review','代码审查')}</div></div><div class="usage-content"><h3>未提交修改</h3>${files.length?files.map((f,i)=>`<label class="checkbox-field"><input type="checkbox" class="stage-file" data-index="${i}" ${f.staged?'checked':''}><span>${esc(f.path)}<small>${f.staged?'已暂存（模拟）':'未暂存（模拟）'} · ${f.verdict==='reverted'?'记录为已回滚':'修改来源：当前轮'}</small></span></label>`).join(''):'<p class="muted">当前没有示例修改。可先打开变更审查场景。</p>'}<div class="delivery-actions">${actionButton('commit','预览提交')}${actionButton('pr','准备 Pull Request')}</div><div class="dialog-summary">提交、推送与发布 PR 均需单独预览目标与内容。原型只记录演示结果，不连接 Git 或托管平台。</div>${s?.commit?`<p class="status-ok">模拟提交：${esc(s.commit)}</p>`:''}${s?.pr?'<p class="status-ok">模拟 PR 已关联 · CI：未运行</p>':''}</div>`;
    } else {
      content=`<div class="usage-content"><h3>上下文与用量</h3><p class="muted">以下数值用于展示信息结构</p>${[['上下文占用','24% · 示例'],['消息与工具结果','18,400 token · 示例'],['项目指令与能力','6,200 token · 示例'],['本会话累计','42,800 token · 示例'],['费用','未知 · 尚未接入提供商'],['验证证据','未运行']].map(([label,value])=>`<div class="usage-row"><span>${label}</span><strong>${value}</strong></div>`).join('')}${actionButton('compact','压缩上下文')}${actionButton('context-sources','查看上下文来源')}<p class="settings-footnote">压缩保留原记录；价格缺失不显示为零。达到预算时停止并报告未完成项。</p></div>`;
    }
    panel.innerHTML=head+`<div class="context-body" tabindex="0" role="tabpanel" aria-label="${tabs.find(x=>x[0]===tab)?.[1]||'工作面板'}">${content}</div>`+foot;
    const body=panel.querySelector('.context-body');body.scrollTop=panelScroll.get(`${state.activeId}:${tab}`)||0;
  }
  function codeFor(path) {if(path==='package.json')return '{\n  "scripts": { "test": "vitest run" }\n}';if(path==='README.md')return '# Pi Workbench\n\n个人、本地优先的编码工作台。\n\n示例预览，不是产品运行结果。';return (makeFiles().find(f=>f.path===path)?.lines||[]).filter(l=>l[0]!=='del').map((line,i)=>`${String(i+1).padStart(2)}  ${line[3]}`).join('\n');}
  function terminalState() {const key=active()?.cwd || cwd();state.terminal[key] ||= {lines:['Pi Workbench 原型终端 · 仅模拟输入输出，不执行系统命令。'],lastOutput:'',tabs:1,active:1,tasks:[{id:'t-test',command:'npm test -- redirect',status:'未运行',output:'还没有执行记录。'}]};return state.terminal[key];}
  function renderBottom() {
    const tab=state.layout.bottom,panel=$('bottomPanel');panel.hidden=!tab;if(!tab)return;
    const t=terminalState();
    panel.innerHTML=`<div class="bottom-tabs"><button data-action="bottom-tab" data-tab="terminal" class="${tab==='terminal'?'active':''}">终端</button><button data-action="bottom-tab" data-tab="tasks" class="${tab==='tasks'?'active':''}">后台任务</button><span class="spacer"></span>${tab==='terminal'?`<select id="terminalTab" aria-label="终端标签">${Array.from({length:t.tabs},(_,i)=>`<option value="${i+1}"${t.active===i+1?' selected':''}>终端 ${i+1}</option>`).join('')}</select>${btn('new-terminal','新建终端标签','plus')}`:''}${btn('close-bottom','收起底部工具区','close')}</div>${tab==='terminal'?`<div class="terminal-content" id="terminalOutput">${t.lines.map(line=>`<div class="terminal-line">${esc(line)}</div>`).join('')}<form id="terminalForm" class="terminal-prompt"><span>❯</span><input id="terminalInput" aria-label="模拟终端命令" placeholder="试试 pwd / git status / npm test" autocomplete="off"></form></div><div class="terminal-hint"><span>模拟终端 ${t.active} · ${esc(cwd())}</span><button data-action="inject-terminal">将最近输出附加到草稿</button></div>`:`<div class="task-list">${t.tasks.map(task=>`<div class="task-row"><span>${esc(task.command)}<small class="muted"> · ${esc(task.status)}</small></span>${actionButton('task-run',task.status==='运行中'?'停止':'模拟运行',`data-id="${task.id}"`)}${actionButton('task-log','日志',`data-id="${task.id}"`)}</div>`).join('')}<div class="card-actions">${actionButton('add-task','新建后台命令')}${actionButton('agents','查看子 Agent')}</div><p class="settings-footnote">用户后台命令与 agent 工具分别标识来源，实际执行系统尚未接入。</p></div>`}`;
    if(tab==='terminal')$('terminalOutput').scrollTop=$('terminalOutput').scrollHeight;
    if(autoFollow)$('threadViewport').scrollTop=$('threadViewport').scrollHeight;
  }
  function bottom(tab='terminal') {state.layout.bottom=state.layout.bottom===tab?null:tab;renderBottom();save();}
  function modal(title,body,footer='',submit=null,wide=false) {
    const dialog=$('workbenchDialog');
    if(!dialog.open)dialogOrigin=document.activeElement;
    else dialog.close();
    dialog.className=`workbench-dialog${wide?' wide-dialog':''}`;
    dialog.innerHTML=`<form id="dialogForm"><div class="dialog-heading"><h2 id="dialogTitle">${esc(title)}</h2>${btn('close-dialog','关闭对话框','close')}</div><div class="dialog-content">${body}<p class="dialog-error" id="dialogError" role="alert"></p></div>${footer?`<div class="dialog-actions">${footer}</div>`:''}</form>`;
    dialogSubmit=submit;dialog.showModal();
    const target=dialog.querySelector('[autofocus]')||dialog.querySelector('input:not([type=checkbox]):not([type=radio]),textarea,select');target?.focus();
  }
  function closeDialog() {const d=$('workbenchDialog');if(!d.open)return;d.close();dialogSubmit=null;if(dialogOrigin?.isConnected)dialogOrigin.focus();else $('composerInput').focus();}
  const cancelButton=()=>actionButton('close-dialog','取消');
  const submitButton=label=>`<button type="submit" class="button primary">${esc(label)}</button>`;
  function renameSession(id) {const s=state.sessions.find(x=>x.id===id)||active();if(!s)return;modal('重命名会话',`<label class="field"><span>会话名称</span><input name="title" aria-label="会话名称" value="${esc(s.title)}" autofocus><small>1–80 字符，允许同名；人工标题优先于自动命名。</small></label>`,cancelButton()+submitButton('保存名称'),form=>{const title=new FormData(form).get('title').trim();if([...title].length<1||[...title].length>80)return $('dialogError').textContent='请输入 1–80 个字符。';s.title=title;s.titleSource='manual';s.titleVersion++;save();closeDialog();renderNav();renderHeader();toast('会话名称已保存。');});}
  function sessionMenu(id) {const s=state.sessions.find(x=>x.id===id)||active();if(!s)return;if(s.id!==state.activeId)openSession(s.id);modal(s.title,`<div class="menu-actions">${[['rename','重命名','compose'],['move','移动项目归属','folder'],['pin',s.pinned?'取消置顶':'置顶','pin'],['fork','分叉当前历史','branch'],['export-session','脱敏导出','file'],['grants','查看与撤销授权','shield'],['archive',s.archived?'恢复会话':'归档会话','archive']].map(([a,label,symbol])=>`<button type="button" data-action="${a}" data-id="${s.id}">${icon(symbol)}${label}</button>`).join('')}</div>`);}
  function projectDialog(id) {const p=project(id);modal(p?'编辑项目':'添加项目',`<label class="field"><span>项目名称</span><input name="name" aria-label="项目名称" value="${esc(p?.name||'')}" autofocus></label><label class="field"><span>默认执行目录（可留空）</span><input name="cwd" aria-label="默认执行目录" value="${esc(p?.cwd||'')}" placeholder="例如 ~/Projects/my-app"><small>原型不访问目录；产品需校验路径和信任。修改项目默认目录不会迁移已有会话。</small></label>`,cancelButton()+submitButton(p?'保存项目':'添加项目'),form=>{const data=new FormData(form),name=data.get('name').trim();if(!name||[...name].length>80)return $('dialogError').textContent='请输入 1–80 字符的项目名称。';if(p){p.name=name;p.cwd=data.get('cwd').trim();}else state.projects.push({id:uid('p'),name,cwd:data.get('cwd').trim(),open:true});save();closeDialog();render();toast(p?'项目已更新，已有会话目录保持原值。':'项目已添加，可在项目旁新建会话。');});}
  function migrationBlock(s) {return busy(s)?'当前会话仍在运行或等待决定':s.queue.length?'还有未处理的消息队列':s.files.some(f=>f.verdict==='pending')?'还有未审查的文件变更':'';}
  function moveSession(id) {const s=state.sessions.find(x=>x.id===id)||active();if(!s)return;const block=migrationBlock(s);modal('整理项目归属',`<label class="field"><span>所属项目</span><select name="project" aria-label="目标项目">${options(s.projectId)}</select></label><div class="dialog-summary">当前执行目录：${esc(s.cwd)}<br>默认只改项目归属，保留目录、历史和产物。</div><label class="checkbox-field"><input type="checkbox" name="migrate" ${block?'disabled':''}><span>同时迁移执行环境<small>${block?`暂不可用：${block}。`:'另行切换到目标默认目录或独立空间，清除旧环境授权。'}</small></span></label>`,cancelButton()+submitButton('预览变更'),form=>{const data=new FormData(form),target=data.get('project')||null,migrate=data.get('migrate')==='on';const targetCwd=project(target)?.cwd || `~/.pi-workbench/standalone/${s.id}`;if(migrate&&migrationBlock(s))return $('dialogError').textContent=migrationBlock(s);modal('确认项目归属',`<div class="dialog-summary">${esc(projectName(s.projectId))} → ${esc(projectName(target))}<br>执行目录：${esc(migrate?targetCwd:s.cwd)}<br>${migrate?'执行环境将改变，旧授权失效。':'执行目录保持原值。'}</div>`,cancelButton()+submitButton('保存归属'),()=>{s.projectId=target;s.draft.projectId=target;if(migrate){s.cwd=targetCwd;s.grants=[];s.messages.push({id:uid('m'),role:'system',text:`用户明确迁移执行环境至 ${targetCwd}；旧授权失效。`});}save();closeDialog();render();toast('项目归属已保存。');});});}
  function environment() {const s=active();modal('执行环境',`<div class="dialog-summary">项目归属：${esc(projectName(draft().projectId))}<br>实际目录：${esc(cwd())}<br>分支：${esc(s?.branch||(draft().projectId?'main':'独立空间'))}<br>模式：${draft().mode==='execute'?'执行 · 按规则审批':draft().mode==='plan'?'计划 · 只读调查':'讨论 · 不修改环境'}</div><p>整理项目只改归属。切换目录或 Worktree 必须明确操作；忙碌或有未审查修改时不能迁移。</p>`,actionButton('worktree','配置独立 Worktree')+(s?actionButton('move','整理归属',`data-id="${s.id}"`):'')+actionButton('close-dialog','关闭'));}
  function grants(id) {const s=state.sessions.find(x=>x.id===id)||active();modal('会话授权',`<p>仅对明确的工具、命令和目录范围有效。撤销影响后续调用，已经运行的操作需单独停止。</p>${s?.grants.length?s.grants.map((g,i)=>`<div class="setting-row"><div><strong>${esc(g.tool)}</strong><small>${esc(g.scope)}</small></div>${actionButton('revoke-grant','撤销',`data-index="${i}"`)}</div>`).join(''):'<div class="dialog-summary">当前没有会话授权。</div>'}`,actionButton('close-dialog','关闭'));}
  function stopDialog() {const s=active();if(!busy(s))return;modal('停止当前运行',`<p>已完成工具与已有变更会保留。尚未执行的审批将取消。</p><div class="dialog-summary">待送达：${s.queue.length} 条<br>默认保留队列，停止后不会自动继续。</div>`,cancelButton()+actionButton('stop-confirm','停止并清空队列','data-clear="true"')+actionButton('stop-confirm','停止，保留队列','',true));}
  function stopRun(clear=false) {const s=active();if(!s)return;s.runVersion++;s.status='interrupted';if(clear)s.queue=[];s.messages.filter(m=>m.role==='approval'&&!m.decision).forEach(m=>m.decision='已取消 · 运行已停止');s.messages.push({id:uid('m'),role:'system',text:`运行已停止；${clear?'队列已清空':'队列已保留，需显式恢复'}，已完成结果仍可查看。`});closeDialog();save();render();}
  function searchDialog() {
    modal('搜索会话',`<div class="search-field">${icon('search')}<input id="sessionSearch" aria-label="搜索会话内容" placeholder="搜索标题或消息正文" autocomplete="off" autofocus></div><div class="search-filters"><label>归属 <select id="searchProject" aria-label="搜索项目"><option value="*">全部项目与无项目</option>${options(null)}</select></label><label>状态 <select id="searchStatus" aria-label="搜索运行状态"><option value="">全部状态</option>${Object.entries(statusNames).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><label>时间 <select id="searchTime" aria-label="搜索时间"><option value="">全部时间</option><option value="1">最近一天</option><option value="7">最近七天</option></select></label><label><input type="checkbox" id="searchArchived">包含归档</label></div><div class="search-results" id="searchResults" role="listbox" aria-label="搜索结果"></div><div class="dialog-footnote">标题与用户 / 助手正文 · ↑ ↓ 选择，Enter 打开 · 工具日志高级检索 M6</div>`);
    $('workbenchDialog').classList.add('search-dialog');$('searchProject').value='*';activeSearch=0;renderSearch();
  }
  function renderSearch() {
    if(!$('sessionSearch'))return;
    const q=$('sessionSearch').value.trim().toLocaleLowerCase(),p=$('searchProject').value,st=$('searchStatus').value,days=Number($('searchTime').value),include=$('searchArchived').checked;
    searchMatches=state.sessions.filter(s=>(include||!s.archived)&&(p==='*'||(s.projectId||'')===p)&&(!st||s.status===st)&&(!days||Date.now()-s.updatedAt<days*86400000)).map(s=>{const hit=s.messages.find(m=>['user','assistant'].includes(m.role)&&m.text?.toLocaleLowerCase().includes(q));return {s,hit,titleHit:s.title.toLocaleLowerCase().includes(q)};}).filter(r=>!q||r.titleHit||r.hit).sort((a,b)=>b.s.updatedAt-a.s.updatedAt);
    activeSearch=Math.max(0,Math.min(activeSearch,searchMatches.length-1));
    const marked=text=>{const i=String(text).toLocaleLowerCase().indexOf(q);return q&&i>=0?esc(text.slice(0,i))+`<mark>${esc(text.slice(i,i+q.length))}</mark>`+esc(text.slice(i+q.length)):esc(text);};
    $('searchResults').innerHTML=searchMatches.length?searchMatches.map(({s,hit},i)=>`<button type="button" class="search-result" role="option" aria-selected="${i===activeSearch}" data-action="search-result" data-index="${i}"><strong>${marked(s.title)}</strong><small>${esc(projectName(s.projectId))} · ${statusNames[s.status]}${s.archived?' · 已归档':''}</small><p>${marked(hit?.text||s.messages.find(m=>m.role==='user')?.text||'没有正文')}</p></button>`).join(''):'<div class="panel-empty"><h3>没有匹配的会话</h3><p>试试更短的关键词，或清除筛选。</p>'+actionButton('clear-search','清除筛选')+'</div>';
  }
  function chooseSearch(index) {const match=searchMatches[index];if(!match)return;closeDialog();setView('prototype');openSession(match.s.id,match.titleHit?undefined:match.hit?.id);}
  function addMessage(s,role,text,extra={}) {const m={id:uid('m'),role,text,...extra};s.messages.push(m);return m;}
  function updateRunView(s) {s.updatedAt=Date.now();save();renderNav();if(s.id===state.activeId){renderThread();renderComposer();renderHeader();renderStatus();renderPanel();}}
  function later(s,delay,fn) {const version=s.runVersion;const id=setTimeout(()=>{if(s.runVersion!==version)return;fn();},delay);runTimers.set(s.id,id);}
  function generatedTitle(text) {const clean=text.replace(/^\/[\w-]+\s*/, '').replace(/\s+/g,' ').trim();return /回调|重定向/.test(clean)?'修复登录回调与同源跳转':/计划|结构|工作台/.test(clean)?'梳理工作台的实现计划':/测试/.test(clean)?'补充测试与验证行为':[...clean].slice(0,24).join('')||'新任务';}
  function scheduleTitle(s,text) {if(!state.settings.autoName)return;const version=s.titleVersion;setTimeout(()=>{if(s.titleVersion!==version||s.titleSource==='manual')return;s.title=generatedTitle(text);s.titleSource='auto';save();renderNav();if(active()?.id===s.id)renderHeader();},1600);}
  function send() {
    const d=draft(),text=d.text.trim();if(!text||composing||!state.connection)return;
    if(text.startsWith('/')) {const cmd=text.split(/\s+/)[0];if(!['/compact','/review','/plan','/skills'].includes(cmd)){composerError=`未知命令 ${cmd}。可用：/plan、/review、/compact、/skills。`;renderComposer();return;}d.text='';composerError='';if(cmd==='/compact'){renderComposer();compact();return;}if(cmd==='/review'){renderComposer();codeReview();return;}if(cmd==='/skills'){renderComposer();settings('capabilities');return;}d.mode='plan';d.text=text.slice(5).trim()||'分析当前任务并给出执行计划';}
    let s=active();
    if(s?.queue.length&&!busy(s)){composerError='先恢复或清空暂停的队列，再提交新任务。';renderComposer();return;}
    const task=d.text.trim();composerError='';
    if(!s) {const id=uid('chat'),p=project(d.projectId);s=session(id,[...task].slice(0,24).join(''),d.projectId,[]);s.titleSource='local';s.cwd=d.cwd||p?.cwd||`~/.pi-workbench/standalone/${id}`;s.branch=d.branch;s.draft=clone(d);state.sessions.unshift(s);state.activeId=id;state.newDraft=baseDraft();scheduleTitle(s,task);}
    if(busy(s)){s.queue.push({id:uid('q'),kind:$('queueKind').value,text:task,contexts:clone(s.draft.contexts||[])});s.draft.text='';s.draft.contexts=[];save();renderComposer();toast('消息已排队，尚未送达。');return;}
    const contexts=clone(s.draft.contexts||[]);s.draft.text='';s.draft.contexts=[];addMessage(s,'user',task+(contexts.length?'\n\n附加：'+contexts.map(c=>c.label).join('、'):''));startRun(s,task);autoFollow=true;render();$('threadViewport').scrollTop=$('threadViewport').scrollHeight;
  }
  function startRun(s,text) {
    s.runVersion++;s.status='running';addMessage(s,'assistant',s.draft.mode==='plan'?'我会先做只读分析，提出步骤与验收条件。':s.draft.mode==='discuss'?'我会围绕已有上下文解释问题，这一轮不修改文件。':'先读取相关逻辑，确认修改范围和验证方式。');updateRunView(s);
    later(s,850,()=>{addMessage(s,'tool','src/auth/redirect.ts\nsrc/auth/redirect.test.ts',{name:'read',title:'查看相关实现与测试',status:'完成'});updateRunView(s);later(s,900,()=>{
      if(s.draft.mode==='plan'){addMessage(s,'plan','');s.status='idle';finishQueue(s);return;}
      if(s.draft.mode==='discuss'){addMessage(s,'assistant','建议先明确输入、允许的访问范围与可验证结果。对话、计划、执行模式分别控制任务意图；执行权限还需要单独裁决。');s.status='idle';finishQueue(s);return;}
      deliverSteer(s);
      if(s.grants.some(g=>g.tool==='bash'&&g.scope===`npm test -- redirect @ ${s.cwd}`)){completeRun(s,true);return;}
      addMessage(s,'approval','',{command:'npm test -- redirect',risk:2});s.status='awaiting_approval';updateRunView(s);
    });});
  }
  function deliverSteer(s) {const steering=s.queue.filter(q=>q.kind==='steer');s.queue=s.queue.filter(q=>q.kind!=='steer');steering.forEach(q=>addMessage(s,'user',q.text));if(steering.length)addMessage(s,'system',`${steering.length} 条引导已在模型边界送达当前轮。`);}
  function approve(id,kind) {const s=active(),m=s?.messages.find(m=>m.id===id);if(!m||m.decision||s.status!=='awaiting_approval')return;m.decision=kind==='deny'?'已拒绝 · 工具未执行':kind==='session'?'已允许 · 限本会话的同一命令与目录':'已允许一次';if(kind==='session'&&m.risk!==3)s.grants.push({tool:'bash',scope:`${m.command} @ ${s.cwd}`});s.status='running';updateRunView(s);later(s,650,()=>completeRun(s,kind!=='deny'));}
  function completeRun(s,allowed) {deliverSteer(s);if(allowed){addMessage(s,'tool','模拟输出：2 tests passed\n退出码：0\n此输出为原型示例，未真实运行。',{name:'bash',title:'定向测试 · 模拟完成',status:'完成'});if(!s.files.length)s.files=makeFiles();addMessage(s,'assistant','已生成同源校验和测试的示例变更。可以在右侧逐文件审查；真实验证仍未运行。',{review:true});}else addMessage(s,'assistant','你拒绝了验证命令，工具没有执行，也没有生成这一步的文件变更。可以修改任务、继续讨论或停止。');s.status='idle';finishQueue(s);}
  function finishQueue(s) {updateRunView(s);const next=s.queue.find(q=>q.kind==='followup');if(next){later(s,600,()=>{s.queue=s.queue.filter(q=>q.id!==next.id);addMessage(s,'system','当前轮已 settled 且示例快照收尾完成，追加开启新轮。');addMessage(s,'user',next.text);startRun(s,next.text);});}else if(s.queue.length){deliverSteer(s);updateRunView(s);}}
  function retry() {const s=active();if(!s||busy(s))return;const last=[...s.messages].reverse().find(m=>m.role==='user');addMessage(s,'system','用户重试本轮，仅继续模型请求，不重放已完成工具。');startRun(s,last?.text||'继续处理当前任务');}
  function queueEdit(index) {const q=active()?.queue[index];if(!q)return;modal('编辑待送达消息',`<label class="field"><span>${q.kind==='steer'?'引导当前轮':'追加下一轮'}</span><textarea name="text" aria-label="待送达消息" rows="4" autofocus>${esc(q.text)}</textarea></label>`,cancelButton()+submitButton('保存队列消息'),form=>{const value=new FormData(form).get('text').trim();if(!value)return $('dialogError').textContent='消息不能为空。';q.text=value;closeDialog();save();renderComposer();});}
  function rollback(all=false) {const s=active();if(!s?.files.length)return;const selected=all?s.files.filter(f=>f.verdict!=='reverted'):[s.files[selectedFile]];if(selected.some(f=>f.conflict))return modal('回滚预检发现冲突',`<p>文件已在本轮之后被外部修改。${all?'整个批次均未写入。':'当前文件未写入。'}</p><div class="dialog-summary">${selected.filter(f=>f.conflict).map(f=>esc(f.path)).join('<br>')}</div><p>保留当前文件，先手动对比并解决冲突。不会提供静默强制覆盖。</p>`,actionButton('close-dialog','保留当前版本')+actionButton('files','查看文件'));
    modal(all?'回滚整轮':'回滚此文件',`<p>以下模拟文件将恢复到本轮基线，已存在的用户修改不在此操作范围。真实产品必须先验证当前末态与快照。</p><div class="dialog-summary">${selected.map(f=>esc(f.path)).join('<br>')}</div><p>不会撤销测试缓存、网络请求或其他命令副作用。</p>`,cancelButton()+submitButton('确认回滚'),()=>{selected.forEach(f=>f.verdict='reverted');addMessage(s,'system',`用户回滚了 ${selected.length} 个模拟文件，记录已保留；未执行真实文件操作。`);closeDialog();save();renderThread();renderPanel();renderComposer();toast('模拟回滚已记录。');});
  }
  function compact() {const s=active();if(!s)return toast('先发送任务创建会话，再管理上下文。');if(busy(s))return toast('先等待或停止当前运行，再压缩上下文。');modal('压缩上下文',`<p>将生成后续模型调用使用的摘要，保留原消息、审批、审查与执行证据。</p><p>原型只演示状态转换，不调用模型或删除历史。</p>`,cancelButton()+submitButton('开始压缩'),()=>{closeDialog();s.status='compacting';s.runVersion++;updateRunView(s);later(s,900,()=>{s.status='idle';addMessage(s,'system','上下文摘要已模拟生成，原始历史与证据保留。');updateRunView(s);});});}
  function settings(tab='appearance') {
    settingsTab=tab;
    const tabs=[['appearance','外观与操作'],['models','模型与提供商'],['permissions','权限'],['capabilities','技能与连接'],['data','数据与诊断']];
    let body='';
    if(tab==='appearance')body=`<div class="setting-row"><div><strong>主题</strong><small>仅作用于此原型。</small></div><select id="settingTheme" aria-label="主题"><option value="system"${state.settings.theme==='system'?' selected':''}>跟随系统</option><option value="dark"${state.settings.theme==='dark'?' selected':''}>深色</option><option value="light"${state.settings.theme==='light'?' selected':''}>浅色</option></select></div><div class="setting-row"><div><strong>字号</strong><small>正文与输入字号；布局保留窄屏适配。</small></div><select id="settingFont" aria-label="字号"><option value="14"${state.settings.font===14?' selected':''}>标准</option><option value="16"${state.settings.font===16?' selected':''}>较大</option></select></div><div class="setting-row"><div><strong>密度</strong><small>调整导航与工具行间距。</small></div><select id="settingDensity" aria-label="界面密度"><option value="comfortable"${state.settings.density==='comfortable'?' selected':''}>舒适</option><option value="compact"${state.settings.density==='compact'?' selected':''}>紧凑</option></select></div><label class="checkbox-field"><input type="checkbox" id="settingAutoName"${state.settings.autoName?' checked':''}><span>自动生成新会话名称<small>先生成本地摘要，后模拟异步优化；不覆盖人工名称。</small></span></label><h3>快捷键</h3><div class="dialog-summary">Ctrl N · 新会话<br>Ctrl K · 搜索会话<br>Ctrl Shift P · 命令面板<br>Ctrl + 反引号 · 终端<br>Enter / Shift Enter · 发送 / 换行<br>Escape · 关闭模态或抽屉</div>`;
    if(tab==='models')body=`<p>模型列表来自实际提供商能力。下列都是展示用配置，原型不会发送密钥或调用 API。</p><div class="setting-row"><div><strong>Claude Sonnet · 示例提供商</strong><small>全局配置 → 会话选择 · 连接尚未接入</small></div><span class="status-chip">示例</span></div><div class="setting-row"><div><strong>GPT · 示例提供商</strong><small>自定义端点、模型能力与凭证由实际 SDK 验证</small></div><span class="status-chip">示例</span></div><div class="setting-row"><div><strong>本地模型</strong><small>支持情况与视觉、工具能力需要单独探测</small></div><span class="status-chip">待配置</span></div><h3>生效来源</h3><div class="dialog-summary">全局默认 → 项目覆盖 → 会话覆盖<br>当前模型：${esc(draft().model)}<br>思考级别：${esc(draft().thinking)}<br>更改作用于下一次安全调用，正在运行请求保持原配置。</div>${actionButton('provider-design','查看提供商配置流程')}`;
    if(tab==='permissions')body=`<p>任务模式与执行权限独立。新会话默认仅经验证的受限读取自动；写文件与命令先审批。任意 Shell 命令不凭只读声明放行；显式会话授权限其范围，L3 始终单次。</p><div class="dialog-summary">执行目录：${esc(cwd())}<br>网络：无真实调用<br>系统级隔离：未接入 / 未验证<br>当前策略：按最终参数审批</div>${actionButton('grants','查看会话授权')}<h3>策略变化</h3><p>收紧立即作用于后续调用；放宽要展示工具、目录与网络影响并明确确认。待审批 / 显示失败不会自动放行，项目指令不构成授权。</p>${actionButton('approval-example','查看审批示例')}`;
    if(tab==='capabilities')body=`<p>已安装、已配置、已加载分别显示。当前会话由固定能力快照运行。</p>${[['技能 · review-code','项目 / .pi/skills/review-code','已加载 · 示例','只读审查说明，不额外授予权限。'],['MCP · project-docs','用户级 stdio 连接','连接失败 · 示例','未加载工具。SDK 模式需要显式装载扩展；认证与嵌套工具仍受裁决。'],['扩展 · workflow-tools','本地包 / 版本示例','已保存 · 下个会话生效','不会热替换运行中的工具。'],['工作流包','Pi Workbench 包规范','待细化','不承诺兼容其他产品的私有运行环境。']].map(([name,source,status,description])=>`<div class="capability-row"><header><span>${name}</span><span class="status-chip">${status}</span></header><p>${source}<br>${description}</p></div>`).join('')}<div class="card-actions">${actionButton('capability-diagnostics','连接诊断')}${actionButton('reload-capabilities','预览重载')}${actionButton('capability-import','查看添加流程')}</div>`;
    if(tab==='data')body=`<p>工作台数据默认 %LOCALAPPDATA%\\PiWorkbench，后续支持受控迁移；项目代码与 pi 模型配置保留原来源。原型存储与需求进度分开。</p><div class="dialog-summary">原型只保存当前浏览器的演示会话、草稿与布局。<br>需求基线：${esc(backlog.version)} · ${backlog.features.length} 项<br>实现进度：来自 backlog，本原型不修改。</div><div class="card-actions">${actionButton('diagnostics','诊断预览')}${actionButton('backup-design','备份与恢复流程')}${actionButton('recovery','窗口与服务生命周期')}${actionButton('reset-demo','重置演示数据')}</div><h3>保留规则</h3><p>审计、消息、快照与密钥分别管理；未审查所需快照不静默回收。升级前保护活动工作，失败有备份和回退。</p>`;
    modal('设置与能力',`<div class="dialog-tabs" role="group" aria-label="设置分类">${tabs.map(([id,title])=>`<button type="button" class="${id===tab?'active':''}" data-action="settings-tab" data-tab="${id}">${title}</button>`).join('')}</div>${body}<p class="settings-footnote">设置演示只影响原型；对应真实功能分 M2 / M4 / M5 / M6 验收。</p>`,actionButton('close-dialog','完成'),null,true);
  }
  function attach() {modal('添加上下文',`<p>选择示例引用。产品支持 @ 文件与行范围、技能、图片和文档，实际支持按模型与扩展能力显示。</p><div class="menu-actions"><button data-action="attach-example" data-kind="file">${icon('file')}src/auth/redirect.ts : 12–18<small>7 行 · 示例</small></button><button data-action="attach-example" data-kind="instruction">${icon('plan')}项目指令与优先级<small>只作上下文</small></button><button data-action="attach-example" data-kind="skill">${icon('agent')}/review-code 技能<small>项目来源 · 示例</small></button><button data-action="attachment-design">${icon('plus')}图片 / 文档附件<small>M6 支持边界</small></button></div>`);}
  function appendContext(label,text) {draft().contexts ||= [];draft().contexts.push({label,text});save();renderComposer();toast('已附加到草稿，尚未发送。');}
  function appendDraft(text) {draft().text=(draft().text?draft().text+'\n\n':'')+text;save();renderComposer();$('composerInput').focus();}
  function worktree() {const s=active();if(s&&migrationBlock(s))return modal('执行环境暂不可迁移',`<p>${esc(migrationBlock(s))}。</p><p>可以从项目新建另一个会话，并选择独立 Worktree。整理归属不会迁移代码。</p>`,actionButton('new-project-session','新建项目会话',`data-id="${s.projectId||''}"`)+actionButton('close-dialog','关闭'));
    modal('独立 Worktree · M6',`<p>先明确比较基线与文件复制策略。原型不会创建真实目录。</p><label class="field"><span>基线</span><select name="base" aria-label="Worktree 基线"><option>main · 示例提交 a31f4c2</option><option>当前分支 HEAD · 示例</option></select></label><label class="field"><span>分支名称</span><input name="branch" aria-label="Worktree 分支" value="pi/fix-auth" autofocus></label><label class="checkbox-field"><input type="checkbox" name="copy"><span>包含当前未提交修改<small>忽略文件需白名单，密钥不自动复制。</small></span></label><div class="dialog-summary">新目录：~/.pi-workbench/worktrees/fix-auth<br>初始化脚本：不自动运行，首次需确认信任。</div>`,cancelButton()+submitButton('预览并关联模拟环境'),form=>{const data=new FormData(form),branch=data.get('branch').trim();if(!/^[\w./-]+$/.test(branch))return $('dialogError').textContent='请输入有效的示例分支名。';if(s){s.cwd='~/.pi-workbench/worktrees/fix-auth';s.branch=branch;s.grants=[];addMessage(s,'system',`模拟关联独立 Worktree：${branch}；仅修改演示环境记录。`);}else {draft().cwd='~/.pi-workbench/worktrees/fix-auth';draft().branch=branch;}closeDialog();save();render();toast('模拟环境已关联，未创建真实 Worktree。');});}
  function codeReview() {modal('代码审查 · M6',`<label class="field"><span>比较范围</span><select aria-label="代码审查范围"><option>未提交修改</option><option>当前分支与 main</option><option>指定提交</option></select></label><p>审查默认只读。意见绑定版本，后续修改后需要复核。</p><div class="dialog-summary"><strong>示例意见 · P2 · src/auth/redirect.ts:13</strong><br>无效 URL 可能使 new URL 抛出异常。请明确非法输入的回退行为，并补充对应测试。<br>审查版本：示例末态 v1；证据：上述构造函数未处理异常。</div>`,actionButton('close-dialog','关闭')+actionButton('fix-finding','将意见转为修复草稿','',true));}
  function commit() {const s=active();if(!s)return toast('打开一个有修改的会话再预览提交。');if(busy(s))return toast('等待运行结束，再整理提交范围。');const files=s.files.filter(f=>f.staged&&f.verdict!=='reverted');if(!files.length)return toast('先勾选要暂存的文件，再预览提交。');modal('预览提交 · 模拟',`<div class="dialog-summary">仓库：pi-workbench<br>分支：${esc(s.branch||'main')}<br>提交范围：${files.map(f=>esc(f.path)).join('、')}<br>只包含以上已选择的文件。</div><label class="field"><span>提交信息</span><input name="message" aria-label="提交信息" value="fix(auth): restrict callback redirects" autofocus></label><p>原型不会执行 Git 命令。真实实现提交前还需显示实际暂存 Diff。</p>`,cancelButton()+submitButton('记录模拟提交'),form=>{const text=new FormData(form).get('message').trim();if(!text)return $('dialogError').textContent='提交信息不能为空。';s.commit=text;addMessage(s,'system',`模拟提交已记录：${text}。未执行 Git。`);closeDialog();save();renderPanel();renderThread();});}
  function pr() {const s=active();if(!s)return toast('先选择会话。');if(!s.branch||s.branch==='main')return modal('选择 Pull Request 源分支','<p>源分支与目标 main 相同。先选择独立任务分支，再准备 PR；不会默认替你切换分支。</p>',actionButton('close-dialog','关闭')+actionButton('worktree','配置独立 Worktree'));modal('准备 Pull Request · 模拟',`<div class="dialog-summary">目标仓库：example/pi-workbench（示例）<br>源：${esc(s.branch||'main')} → main<br>提交：${esc(s.commit||'尚未选择，真实发布需先完成提交预检')}<br>CI：未运行 · 不自动合并或部署</div><label class="field"><span>标题</span><input name="title" aria-label="PR 标题" value="修复登录回调的外部跳转"></label><label class="field"><span>正文</span><textarea name="body" aria-label="PR 正文" rows="4">限制回调目标为同源地址，保留路径和查询参数。\n\n验证：尚未真实运行，待补证据。</textarea></label><p>不会连接 GitHub、推送或发布。这里只演示发布前可检查的信息。</p>`,cancelButton()+submitButton('记录模拟 PR'),form=>{const data=new FormData(form);if(!data.get('title').trim())return $('dialogError').textContent='标题不能为空。';s.pr={title:data.get('title'),body:data.get('body')};addMessage(s,'system','模拟 PR 已关联。未向外部服务发布，CI 未运行。');closeDialog();save();renderPanel();renderThread();});}
  function agentsHtml() {return `<section class="agents-card"><h3>并行任务 · M7</h3><p class="muted">父任务：修复认证流程 · 并发上限 2 · 预算 $2.00（示例）</p>${[['a-read','分析回调逻辑','只读 · 当前目录','已完成 · 待验证'],['a-test','补充测试用例','独立 Worktree / auth-tests','结果待验证'],['a-review','审查合并结果','依赖前两项','等待依赖']].map(([id,title,env,status])=>`<div class="agent-row">${icon('agent')}<div>${title}<small>${env}</small></div><span class="status-chip">${status}</span><button data-action="agent-detail" data-id="${id}">查看</button></div>`).join('')}<div class="card-actions">${actionButton('agent-budget','预算与停止')}${actionButton('agent-summary','查看汇总与证据')}</div></section>`;}
  function agentDetail(id) {const label={'a-read':'分析回调逻辑','a-test':'补充测试用例','a-review':'审查合并结果'}[id];modal(label||'子任务',`<div class="dialog-summary">父任务：修复认证流程<br>模型：继承父任务的示例配置<br>权限：不超过父任务，独立工具范围<br>目录：${id==='a-test'?'~/.pi-workbench/worktrees/auth-tests':esc(cwd())}<br>执行：示例状态，尚未调度真实 Agent</div><h3>过程与产物</h3><p>检查回调入口、列出边界条件、输出补丁或审查意见。子任务自述完成仍需父任务核对证据。</p><h3>验证来源</h3><p>代码位置与测试运行待接入；费用与日志分别归属子任务，不混入其他任务。</p>`,actionButton('close-dialog','返回任务树')+actionButton('agent-budget','预算与停止'));}
  function automation() {
    const list=state.automations;
    modal('自动化 · M7',`<p>管理周期任务或当前会话的持续跟进。此原型只保存计划样例，不启动调度器。</p>${list.length?list.map(a=>`<div class="setting-row"><div><strong>${esc(a.name)}</strong><small>${esc(a.kind==='followup'?'当前会话跟进':'周期新运行')} · ${esc(a.timezone)}<br>${a.paused?'已暂停':'预览下次：'+esc(a.next)}</small></div>${actionButton('automation-toggle',a.paused?'恢复计划':'暂停计划',`data-id="${a.id}"`)}${actionButton('automation-detail','详情',`data-id="${a.id}"`)}</div>`).join(''):'<div class="dialog-summary">还没有演示计划。可以先预览周期、环境、授权和停止条件。</div>'}<div class="card-actions">${actionButton('create-automation','创建自动化','',true)}${actionButton('inbox','运行收件箱')}</div><p class="settings-footnote">服务退出或电脑睡眠时不会云端运行。错过执行按策略记录或合并补跑，避免重复副作用。</p>`,actionButton('close-dialog','返回工作台'),null,true);
  }
  function nextRun(timezone,frequency) {const offset=timezone==='Asia/Shanghai'?8:0,now=Date.now(),d=new Date(now+offset*3600000);d.setUTCHours(9,0,0,0);if(d.getTime()-offset*3600000<=now)d.setUTCDate(d.getUTCDate()+1);if(frequency==='weekly')while(d.getUTCDay()!==1)d.setUTCDate(d.getUTCDate()+1);return new Intl.DateTimeFormat('zh-CN',{timeZone:timezone,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(d.getTime()-offset*3600000));}
  function createAutomation() {modal('创建自动化 · 预览',`<label class="field"><span>名称</span><input name="name" aria-label="自动化名称" value="检查项目测试与待办" autofocus></label><label class="field"><span>类型</span><select name="kind" aria-label="自动化类型"><option value="scheduled">周期新运行</option><option value="followup"${!active()?' disabled':''}>当前会话持续跟进</option></select></label><label class="field"><span>任务与停止条件</span><textarea name="prompt" aria-label="自动化任务" rows="3">检查测试状态，有有意义的变化、失败或需要决定时通知；无变化保持安静。</textarea></label><label class="field"><span>时区</span><select id="automationTimezone" name="timezone" aria-label="自动化时区"><option>Asia/Shanghai</option><option>UTC</option></select></label><label class="field"><span>周期</span><select id="automationFrequency" name="frequency" aria-label="自动化周期"><option value="daily">每天 09:00</option><option value="weekly">每周一 09:00</option></select></label><div class="dialog-summary" id="automationPreview"></div><p>环境：${esc(cwd())}<br>授权：仅受限只读；未授权动作等待或拒绝，L3 不无人值守放行。<br>错过：记录一次错过，用户确认后单次补跑。</p>`,cancelButton()+submitButton('保存演示计划'),form=>{const data=new FormData(form),name=data.get('name').trim(),prompt=data.get('prompt').trim();if(!name||!prompt)return $('dialogError').textContent='名称和任务内容不能为空。';state.automations.push({id:uid('auto'),name,prompt,kind:data.get('kind'),timezone:data.get('timezone'),frequency:data.get('frequency'),next:nextRun(data.get('timezone'),data.get('frequency')),cwd:cwd(),sessionId:state.activeId,paused:false});save();automation();toast('演示计划已保存，未注册真实定时任务。');},true);updateAutomationPreview();}
  function updateAutomationPreview() {if($('automationPreview'))$('automationPreview').textContent=`下次运行预览：${nextRun($('automationTimezone').value,$('automationFrequency').value)} · ${$('automationTimezone').value}（当前时间计算）`;}
  function automationDetail(id) {const a=state.automations.find(a=>a.id===id);if(!a)return;modal(a.name,`<p>${esc(a.prompt)}</p><div class="dialog-summary">目录：${esc(a.cwd)}<br>时区：${esc(a.timezone)}<br>下次预览：${esc(a.next)}<br>权限：受限只读<br>错过执行：记录，不自动重复副作用<br>调度器：未连接，只有演示记录</div>`,actionButton('automation','返回计划')+actionButton('automation-toggle',a.paused?'恢复计划':'暂停计划',`data-id="${a.id}"`));}
  function inbox() {modal('运行收件箱 · 示例',`<p>集中处理有意义的变化、失败和待决定，正常无变化不产生新提醒。</p>${[['i-approval','需要决定','认证验证命令等待审批','approval'],['i-failure','运行失败','提供商限流，保留原会话与已完成结果','failure']].map(([id,status,text,scene])=>`<div class="setting-row"><div><strong>${status}${state.inboxRead.includes(id)?' · 已读':''}</strong><small>${text}<br>这是模拟运行，没有真实自动化在后台执行。</small></div>${actionButton('inbox-open','打开',`data-inbox="${id}" data-scene="${scene}"`)}</div>`).join('')}`,actionButton('automation','管理自动化')+actionButton('close-dialog','返回工作台'),null,true);}
  function recovery() {modal('中断与恢复',`<h3>连接与运行分开判断</h3><p>浏览器关闭只断开观察；服务仍可运行。重连通过快照和事件去重恢复。</p><h3>退出与重启</h3><p>桌面 × 默认收到托盘，已有任务和待审批继续；开机自启默认关闭。退出应用保存记录、取消待审批 / 排队并确认受管服务与进程停止；失败列出未停止对象。独立服务需显式退出。重启只恢复记录，不恢复旧授权或自动重放队列与工具。</p><h3>下一步</h3><p>保留历史、草稿、队列和变更；标记中断、清除失效授权，用户决定继续或处理变更。</p>`,actionButton('close-dialog','关闭')+actionButton('simulate-disconnect',state.connection?'模拟连接中断':'模拟恢复连接'));}
  function demoSession(name,title,messages,files=[]) {
    rememberView();const id=`demo-${name}`,old=state.sessions.find(s=>s.id===id);if(old)old.runVersion++;
    const s=session(id,title,'p-workbench',messages,files);const index=state.sessions.findIndex(x=>x.id===id);if(index<0)state.sessions.unshift(s);else state.sessions[index]=s;state.activeId=id;autoFollow=true;selectedFile=0;state.layout.panel=null;state.layout.bottom=null;render();save();return s;
  }
  function scene(name) {
    closeDialog();setView('prototype');$('demoScene').value=name;composerError='';
    if(name==='new'){newSession();return;}
    if(name==='search'){searchDialog();return;}
    if(name==='onboarding')return onboarding();
    if(name==='capabilities')return settings('capabilities');
    if(name==='automation')return automation();
    if(name==='layout')return settings('appearance');
    if(name==='optional')return optional();
    if(name==='plan'){const s=demoSession('plan','规划认证回调的修复方案',[{role:'user',text:'先分析登录回调问题，给出计划，暂时不要修改文件。'},{role:'assistant',text:'先确认允许的目标范围，再安排实现与测试。'},{role:'question'},{role:'plan'}]);s.draft.mode='plan';s.status='waiting_input';updateRunView(s);return;}
    if(name==='running'){const s=demoSession('running','运行过程与消息队列',[{role:'user',text:'检查认证回调并补充测试。'}]);startRun(s,'检查认证回调并补充测试');return;}
    if(name==='approval'){const s=demoSession('approval','确认认证测试命令',[{role:'user',text:'运行认证回调的定向测试。'},{role:'tool',name:'read',title:'查看测试脚本',text:'package.json: vitest run',status:'完成'},{role:'approval',command:'npm test -- redirect',risk:2}]);s.status='awaiting_approval';updateRunView(s);return;}
    if(name==='agents'){demoSession('agents','并行分析认证流程',[{role:'user',text:'将分析、测试和审查拆成有边界的任务。'},{role:'assistant',text:'下面展示委派、独立目录、预算与证据如何组织。当前没有真实子 Agent 在运行。'},{role:'agents'}]);return;}
    if(name==='failure'){const s=demoSession('failure','恢复限流后的任务',[{role:'user',text:'继续检查认证流程并说明结果。'},{role:'assistant',text:'相关文件已经读取，下一次模型请求遇到限流。'},{role:'error',text:'示例提供商返回 rate_limit_exceeded。已完成工具不会在重试时自动重放。'}]);s.status='error';updateRunView(s);return;}
    const s=demoSession(name,name==='conflict'?'处理回滚前的外部修改':'修复登录回调重定向',[{role:'user',text:'修复回调重定向并补充测试。'},{role:'tool',name:'read',title:'查看实现与测试',status:'完成',text:'src/auth/redirect.ts\nsrc/auth/redirect.test.ts'},{role:'assistant',text:'已准备示例修改。运行结束、审查进度与真实验证分别显示；这里没有执行实际文件修改或测试。',review:true}],makeFiles());
    if(name==='conflict')s.files[0].conflict=true;
    if(name==='git')s.branch='pi/fix-auth';
    state.layout.panel=name==='files'?'files':name==='git'?'git':'changes';
    if(name==='terminal')state.layout.bottom='terminal';
    render();save();
  }
  function onboarding() {modal('首次启动 · 环境检查',`<p>产品需要核实运行环境；以下仅为首次启动界面样例。</p>${[['pi 运行时','本机已发现接口，真实集成仍需 M0 验证'],['Git 与 Shell','产品启动时检测版本、路径与可用性'],['模型提供商','选择已有配置或添加，不要求先创建会话'],['项目与信任','添加目录可跳过，首次加载脚本 / 能力先检查来源'],['本机网页','配对到同一服务，不默认开放局域网']].map(([title,description])=>`<div class="setting-row"><div><strong>${title}</strong><small>${description}</small></div><span class="status-chip">待产品验证</span></div>`).join('')}`,actionButton('settings-models','配置模型')+actionButton('add-project','添加项目')+actionButton('onboarding-done','进入新会话','',true),null,true);}
  function optional() {modal('可选能力 · M8',`<p>M8 独立立项，不计入本地完整版分母。这里展示候选能力与边界，不启用网络或系统权限。</p>${[['远程与协作','局域网、SSH、云端、同步、团队、移动端'],['浏览器与多模态','网页搜索、浏览器操作、计算机操作、语音、图像 / 文档工具'],['外部事件','授权事件触发、去重、凭证与重试上限']].map(([title,text])=>`<div class="setting-row"><div><strong>${title}</strong><small>${text}</small></div><span class="status-chip">候选</span></div>`).join('')}`,actionButton('optional-spec','查看候选需求')+actionButton('close-dialog','关闭'));}
  function commands() {modal('命令面板',`<div class="field"><label for="commandQuery">查找操作</label><input id="commandQuery" placeholder="输入操作名称" autofocus></div><div class="menu-actions" id="commandActions">${[['new-session','新会话','compose','Ctrl N'],['search','搜索会话','search','Ctrl K'],['review','打开变更审查','changes',''],['files','打开文件','file',''],['terminal','展开终端','terminal','Ctrl `'],['agents','子任务与计划','agent','M7'],['automation','自动化','clock','M7'],['stop','停止运行','stop',''],['settings','设置与能力','settings','']].map(([action,title,symbol,key])=>`<button type="button" data-command-name="${title}" data-action="${action}">${icon(symbol)}${title}<small>${key}</small></button>`).join('')}</div>`);}
  function fork(id) {const s=active();if(!s)return;if(busy(s))return toast('先等待或停止当前会话，再分叉历史。');const index=s.messages.findIndex(m=>m.id===id),end=index<0?s.messages.length:index+1;modal('分叉会话历史',`<div class="dialog-summary">复制前 ${end} 条记录<br>执行目录沿用当前：${esc(s.cwd)}<br>使用当前文件，不恢复历史文件<br>不会复制审批授权</div>`,cancelButton()+submitButton('创建分叉会话'),()=>{const copy=session(uid('fork'),`${s.title} · 分叉`,s.projectId,clone(s.messages.slice(0,end)));copy.cwd=s.cwd;copy.branch=s.branch;copy.messages=copy.messages.filter(m=>m.role!=='approval'||m.decision);copy.messages.push({id:uid('m'),role:'system',text:'从历史分叉，继续使用当前文件，未恢复历史文件或复制授权。'});state.sessions.unshift(copy);closeDialog();openSession(copy.id);save();});}
  function exportSession(id) {const s=state.sessions.find(x=>x.id===id)||active();if(!s)return;modal('脱敏导出预览',`<p>包含标题、项目、用户 / 助手正文与工具摘要；不导出凭证或完整环境变量。原型中请只使用演示内容。</p><pre>${esc(JSON.stringify({title:s.title,project:projectName(s.projectId),messages:s.messages.filter(m=>['user','assistant','system'].includes(m.role)).map(m=>({role:m.role,text:m.text}))},null,2).slice(0,1400))}</pre>`,cancelButton()+actionButton('export-download','下载演示 JSON',`data-id="${s.id}"`,true));}
  function downloadSession(id) {const s=state.sessions.find(x=>x.id===id);if(!s)return;const payload={kind:'pi-workbench-prototype-session',title:s.title,project:projectName(s.projectId),messages:s.messages.filter(m=>['user','assistant','system'].includes(m.role)).map(m=>({role:m.role,text:m.text}))};const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));a.href=url;a.download='pi-workbench-demo-session.json';a.click();URL.revokeObjectURL(url);closeDialog();}
  function setView(next) {view=next;document.body.dataset.view=next;document.querySelectorAll('.review-views [data-view]').forEach(n=>n.setAttribute('aria-pressed',n.dataset.view===next));}
  function setSpecTab(name) {if(!$(`panel-${name}`))return;specTab=name;document.querySelectorAll('#docTabs [data-tab]').forEach(n=>{n.classList.toggle('active',n.dataset.tab===name);n.setAttribute('aria-current',n.dataset.tab===name?'page':'false');});document.querySelectorAll('.docCol>.tabPanel').forEach(n=>n.classList.toggle('hidden',n.id!==`panel-${name}`));$('docCol').scrollTop=0;if(name==='coverage')filterCoverage();}
  function jumpSpec(id) {setView(view==='compare'?'compare':'spec');const target=$(id);if(!target)return;const panel=target.closest('.tabPanel');if(panel)setSpecTab(panel.id.replace('panel-',''));if(target.tagName==='DETAILS')target.open=true;target.scrollIntoView({block:'start'});highlight(target);history.replaceState(null,'',`${location.pathname}${location.search}#${id}`);}
  function showRequirement(id) {$('coverageSearch').value='';$('coverageModule').value='';$('coverageMilestone').value='';filterCoverage();jumpSpec(`req-${id}`);}
  function prototypeFeature(id) {setView('prototype');if(id==='feature-workspace'){showSidebar();highlight($('sidebar'));environment();}else if(id==='feature-session'){showSidebar();highlight($('sessionNavigation'));}else if(id==='feature-compose'){highlight($('composerArea'));$('composerInput').focus();}else if(id==='feature-approval')scene('approval');else if(id==='feature-diff')scene('review');else if(id==='feature-terminal') {state.layout.bottom='terminal';renderBottom();highlight($('bottomPanel'));}else if(id==='feature-tasks'){state.layout.bottom='tasks';renderBottom();highlight($('bottomPanel'));}else if(id==='feature-config')settings('capabilities');else if(id==='feature-usage')showPanel('usage');else scene('running');}
  function filterCoverage() {const q=$('coverageSearch').value.trim().toLocaleLowerCase(),module=$('coverageModule').value,milestone=$('coverageMilestone').value;let count=0;$('panel-coverage').querySelectorAll('.requirement').forEach(node=>{const yes=(!module||node.dataset.module===module)&&(!milestone||node.dataset.milestone===milestone)&&(!q||node.textContent.toLocaleLowerCase().includes(q));node.hidden=!yes;if(yes)count++;});document.querySelectorAll('.coverage-module').forEach(n=>n.hidden=![...n.querySelectorAll('.requirement')].some(n=>!n.hidden));$('coverageCount').textContent=`显示 ${count} / ${backlog.features.length} 项 · 进度为生成时的 backlog 基线`;$('coverageEmpty').hidden=count>0;}
  const handlers = {
    suggest:el=>{draft().mode=el.dataset.kind;draft().text=el.dataset.kind==='plan'?'先分析当前项目，给出改动步骤、风险与验收条件，暂时不要修改文件。':'解释这个项目的入口、主要模块和运行方式。';save();renderComposer();$('composerInput').focus();},
    home:()=>{setView('prototype');newSession();},'new-session':()=>{closeDialog();newSession();},
    'new-project-session':el=>{closeDialog();newSession(el.dataset.id||null);},
    'toggle-sidebar':()=>{if(innerWidth<=850){$('workbench').classList.contains('sidebar-open')?closeSidebar():showSidebar();}else {state.layout.sidebarCollapsed=!state.layout.sidebarCollapsed;save();render();}},
    'close-sidebar':closeSidebar,'toggle-project':el=>{const p=project(el.dataset.id);p.open=!p.open;save();renderNav();},
    'add-project':()=>projectDialog(),'edit-project':el=>projectDialog(el.dataset.id),'open-session':el=>openSession(el.dataset.id),
    'session-menu':el=>sessionMenu(el.dataset.id),rename:el=>renameSession(el.dataset.id),move:el=>moveSession(el.dataset.id),
    pin:el=>{const s=state.sessions.find(s=>s.id===el.dataset.id)||active();s.pinned=!s.pinned;save();closeDialog();renderNav();},
    archive:el=>{const s=state.sessions.find(s=>s.id===el.dataset.id)||active();if(busy(s))return toast('运行或等待决定的会话需要先停止。');s.archived=!s.archived;s.grants=[];save();closeDialog();if(s.archived&&active()?.id===s.id)newSession();else renderNav();toast(s.archived?'会话已归档，可在搜索中恢复；文件未删除。':'会话已恢复。');},
    search:()=>{closeDialog();searchDialog();},'search-result':el=>chooseSearch(Number(el.dataset.index)),
    'clear-search':()=>{$('sessionSearch').value='';$('searchProject').value='*';$('searchStatus').value='';$('searchTime').value='';$('searchArchived').checked=false;activeSearch=0;renderSearch();},
    'close-dialog':closeDialog,send,stop:()=>{closeDialog();stopDialog();},'stop-confirm':el=>stopRun(el.dataset.clear==='true'),
    'edit-queue':el=>queueEdit(Number(el.dataset.index)),'remove-queue':el=>{active().queue.splice(Number(el.dataset.index),1);save();renderComposer();},
    'clear-queue':()=>{active().queue=[];save();renderComposer();},'resume-queue':()=>{const s=active(),q=s?.queue.shift();if(!q)return;addMessage(s,'user',q.text);startRun(s,q.text);},
    approve:el=>approve(el.dataset.id,el.dataset.kind),retry,
    'toggle-panel':el=>togglePanel(el.dataset.panel),'panel-tab':el=>{rememberPanel();state.layout.panel=el.dataset.panel;renderPanel();renderHeader();save();},
    'close-panel':()=>{rememberPanel();state.layout.panel=null;$('workspace').classList.remove('panel-open');renderHeader();save();},
    files:()=>{closeDialog();showPanel('files');},review:()=>{closeDialog();showPanel('changes');},usage:()=>showPanel('usage'),git:()=>{closeDialog();showPanel('git');},
    'select-file':el=>{rememberPanel();selectedFile=Number(el.dataset.index);renderPanel();},
    'file-verdict':()=>{const s=active();if(!s?.files[selectedFile])return;s.files[selectedFile].verdict='accepted';save();renderPanel();renderThread();toast('已接受此文件的模拟变更；未提交 Git。');},
    'accept-all':()=>{active()?.files.forEach(f=>{if(f.verdict==='pending')f.verdict='accepted';});save();renderPanel();renderThread();toast('全部变更已记录为接受。');},
    'rollback-file':()=>busy(active())?toast('等待当前写入结束，再回滚文件。'):rollback(false),'rollback-all':()=>busy(active())?toast('等待当前写入结束，再回滚整轮。'):rollback(true),
    'review-example':()=>scene('review'),'approval-example':()=>scene('approval'),
    terminal:()=>{closeDialog();bottom('terminal');},'bottom-tab':el=>{state.layout.bottom=el.dataset.tab;renderBottom();save();},'close-bottom':()=>{state.layout.bottom=null;renderBottom();save();},
    'new-terminal':()=>{const t=terminalState();t.buffers ||= {};t.buffers[t.active]={lines:clone(t.lines),lastOutput:t.lastOutput};t.tabs++;t.active=t.tabs;t.lines=['新终端标签 · 模拟，不执行真实命令'];t.lastOutput='';save();renderBottom();},
    'inject-terminal':()=>{const t=terminalState();if(!t.lastOutput)return toast('先输入一个示例命令。');appendContext(`终端 ${t.active} 输出`,`${cwd()}\n${t.lastOutput}`);},
    attach,'remove-context':el=>{draft().contexts.splice(Number(el.dataset.index),1);save();renderComposer();},
    'attach-example':el=>{const kind=el.dataset.kind;closeDialog();if(kind==='file')appendContext('src/auth/redirect.ts : 12–18',codeFor('src/auth/redirect.ts'));else if(kind==='skill')appendContext('/review-code · 项目技能','来源：项目 .pi/skills/review-code，只读审查，不额外授权。');else appendContext('项目指令与来源','来源优先级：全局 → 项目 → 会话。仓库说明不构成权限授权。');},
    'open-code':el=>{selectedCode=el.dataset.path;renderPanel();},'attach-code':()=>appendContext(`${selectedCode} · 示例行范围`,codeFor(selectedCode)),
    'edit-code':()=>modal('轻量编辑 · M6',`<p>这是模拟编辑，不写入本机文件；产品保存必须校验磁盘版本。</p><label class="field"><span>${esc(selectedCode)}</span><textarea name="code" aria-label="示例代码" rows="9">${esc(codeFor(selectedCode))}</textarea></label>`,cancelButton()+submitButton('演示保存冲突'),()=>modal('文件在磁盘上已变化',`<p>编辑期间另一个进程修改了此文件。当前内容未被覆盖。</p><p>产品应展示双方差异，再由用户决定保留、重新载入或明确覆盖。</p>`,actionButton('close-dialog','保留并取消保存')+actionButton('files','查看当前文件'))),
    preview:()=>modal('产物与网页预览 · M6',`<h3>README.md · 示例文档</h3><p>文件产物保留来源和版本。网页预览显示明确的开发服务器地址与状态。</p><div class="dialog-summary">开发服务器：未启动<br>地址：无<br>预览权限：与宿主工具隔离<br>不自动启动命令、不开放外部网络</div>`,actionButton('close-dialog','关闭')+actionButton('add-task','配置开发服务器命令')),
    settings:()=>{closeDialog();settings();},'settings-tab':el=>settings(el.dataset.tab),'settings-models':()=>settings('models'),environment,grants:el=>grants(el.dataset.id),
    'revoke-grant':el=>{active()?.grants.splice(Number(el.dataset.index),1);save();grants();},compact,
    'context-sources':()=>modal('上下文来源',`<div class="dialog-summary">全局指令 → 项目 AGENTS / 配置 → 当前会话<br>引用：${esc((draft().contexts||[]).map(c=>c.label).join('、')||'暂无草稿引用')}<br>能力快照：示例版本 v1</div><p>来源可解释上下文优先级，但不能授予额外权限。压缩摘要与原始历史独立保留。</p>`,actionButton('close-dialog','关闭')),
    'execute-plan':()=>{const s=active();if(!s||busy(s)||s.messages.some(m=>m.role==='question'&&!m.answer))return;modal('转为执行',`<p>按计划修改认证回调与测试，写入和命令仍按最终参数审批。计划模式不会自行触发执行。</p>`,cancelButton()+submitButton('确认开始模拟执行'),()=>{if(busy(s))return;s.draft.mode='execute';s.status='idle';addMessage(s,'user','按已审阅的计划执行，保留审批与验证证据。');closeDialog();startRun(s,'按计划执行');});},
    'edit-plan':()=>{appendDraft('调整计划：');toast('请在草稿中补充调整，尚未发送。');},
    'answer-question':el=>{const s=active(),m=s.messages.find(m=>m.id===el.dataset.id);m.answer=document.querySelector(`input[name="clarification-${m.id}"]:checked`)?.value||'未选择';s.status='idle';addMessage(s,'system',`已记录决定：${m.answer}`);save();render();},
    'quote-message':el=>{const m=active()?.messages.find(m=>m.id===el.dataset.id);if(m)appendContext('引用 Pi 回复',m.text);},
    fork:el=>{closeDialog();fork(el.dataset.id);},'export-session':el=>exportSession(el.dataset.id),'export-download':el=>downloadSession(el.dataset.id),
    'inline-feedback':()=>modal('添加审查意见',`<label class="field"><span>${esc(active()?.files[selectedFile]?.path)} · 示例版本 v1</span><textarea name="feedback" aria-label="审查意见" rows="3" placeholder="描述具体触发条件和期望行为" autofocus></textarea></label>`,cancelButton()+submitButton('附加到修复草稿'),form=>{const text=new FormData(form).get('feedback').trim();if(!text)return $('dialogError').textContent='请输入审查意见。';closeDialog();appendContext('审查意见 · 示例版本 v1',text);}),
    'fix-finding':()=>{closeDialog();appendDraft('请检查 src/auth/redirect.ts:13 对无效 URL 的处理，补充回退逻辑与测试。审查来源：示例版本 v1。');},
    'code-review':codeReview,worktree,commit,pr,
    agents:()=>{closeDialog();scene('agents');},'agent-detail':el=>agentDetail(el.dataset.id),
    'agent-budget':()=>modal('预算与级联停止',`<p>示例上限：并发 2、深度 2、费用 $2、时长 20 分钟。达到任一上限应暂停并报告未完成项。</p><p>当前没有真实子任务；下面仅记录级联停止的交互。</p>`,actionButton('close-dialog','返回')+actionButton('stop-agents','模拟停止父子任务')),
    'stop-agents':()=>{closeDialog();const s=active();if(s){addMessage(s,'system','模拟级联停止：未启动任务取消，已有产物保留并待验证。');renderThread();save();}toast('模拟停止记录已保留。');},
    'agent-summary':()=>modal('任务汇总与证据',`<div class="dialog-summary">分析：已产出结论，待父任务核对<br>测试：示例补丁待验证<br>审查：等待依赖<br>真实测试：未运行<br>合并：尚未执行，需冲突预检</div><p>父任务不能以子任务自述代替实际证据。每项结论保留任务来源，失败不会清除其他产物。</p>`,actionButton('close-dialog','返回')),
    automation,'create-automation':createAutomation,'automation-toggle':el=>{const a=state.automations.find(x=>x.id===el.dataset.id);if(a){a.paused=!a.paused;save();automation();}},'automation-detail':el=>automationDetail(el.dataset.id),inbox,
    'inbox-open':el=>{if(!state.inboxRead.includes(el.dataset.inbox))state.inboxRead.push(el.dataset.inbox);save();scene(el.dataset.scene);},
    recovery,connection:recovery,'simulate-disconnect':()=>{state.connection=!state.connection;save();closeDialog();renderStatus();renderComposer();toast(state.connection?'模拟重连已恢复，不重放工具。':'模拟观察连接中断；运行状态由服务决定。');},
    'onboarding-done':()=>{closeDialog();newSession();},'prototype-help':()=>modal('如何评审这份 PRD',`<p>原型：可点击演示，所有消息、命令、文件、Git、Agent 和调度均为模拟。</p><p>规格：全景、界面架构、16 条旅程、核心规格、146 项同源需求、状态与决定。</p><p>对照：一边操作一边查看规格。进度仍以需求看板和验证证据为准。</p><p>原型内容保存在此浏览器的独立存储，可在设置重置；请只输入演示内容。</p>`,actionButton('close-dialog','开始评审')),
    commands,feature:el=>jumpSpec(el.dataset.feature),'optional-spec':()=>{closeDialog();setView('spec');setSpecTab('coverage');$('coverageMilestone').value='M8';filterCoverage();},
    'clear-coverage':()=>{$('coverageSearch').value='';$('coverageModule').value='';$('coverageMilestone').value='';filterCoverage();},
    latest:()=>{autoFollow=true;$('threadViewport').scrollTop=$('threadViewport').scrollHeight;$('returnLatest').hidden=true;},
    'provider-design':()=>modal('添加提供商 · 交互设计',`<p>填写来源、端点、模型 ID 与凭证 → 校验地址与能力 → 显示连接结果 → 选择作用范围 → 保存。</p><p>凭证由宿主安全存储，只显示配置状态；连接失败保留配置。此原型不接收真实 API 密钥。</p>`,actionButton('settings-models','返回模型配置')),
    'capability-diagnostics':()=>modal('连接诊断 · 示例',`<div class="dialog-summary">MCP project-docs：启动超时<br>工具：0 / 未加载<br>原因示例：stdio 子进程未完成初始化<br>权限：未授予额外范围<br>恢复：检查命令 / 凭证，重新验证后加载</div>`,actionButton('close-dialog','关闭')),
    'reload-capabilities':()=>modal('重载能力预检',`<p>${busy(active())?'当前任务忙碌，不能热替换工具。请等待空闲或新建会话。':'当前可预览能力差异；正式实现重载前需列出新增工具、版本、信任与权限。'}</p><p>原型没有真实能力加载器，不会启动扩展进程。</p>`,actionButton('close-dialog','关闭')),
    'capability-import':()=>modal('添加能力 · 交互设计',`<p>选择技能 / MCP / 扩展来源 → 检查清单和版本 → 校验格式 / 连接 → 评估信任与权限 → 保存配置 → 在空闲边界重载或新会话生效。</p><p>安装记录不代表已加载；不支持的 TUI 需取消或降级，不能无限等待。</p>`,actionButton('close-dialog','关闭')),
    'attachment-design':()=>modal('图片与文档 · M6',`<p>选择或拖入 → 显示预览、大小与模型能力 → 对文档标明原件 / 提取文本和截断范围 → 用户确认后附加。</p><p>不支持、超限、扫描文档或读取失败保留草稿。此原型不上传文件。</p>`,actionButton('close-dialog','关闭')),
    diagnostics:()=>modal('诊断导出预览',`<pre>Pi Workbench 交互式 PRD v2\n模式：原型\n真实执行适配：未接入\n会话正文：不包含\n密钥 / 完整路径：不包含\n需求状态：只读基线</pre><p>真实产品需要收集版本、错误与受控日志，再由用户预览脱敏包；不自动外发。</p>`,actionButton('close-dialog','关闭')),
    'backup-design':()=>modal('备份与恢复',`<p>分类查看会话、配置、审计和快照占用 → 选择备份范围与目标 → 校验恢复数据 → 预览影响 → 保护当前工作后恢复。</p><p>仅升级前自动备份，其余手动，可选择其他磁盘；不启用每日备份或 7 份轮转。备份不含模型密钥，清单列出未包含的项目代码与外部历史；一致性保存数据库、管理历史和快照引用。恢复失败原数据仍可用，不恢复旧授权或自动执行。原型没有产品数据备份。</p>`,actionButton('close-dialog','关闭')),
    'reset-demo':()=>modal('重置原型演示',`<p>重置此浏览器的模拟会话、草稿、布局与自动化。需求看板和 backlog 不受影响。</p>`,cancelButton()+submitButton('重置演示'),()=>{state.sessions.forEach(s=>s.runVersion++);state=seed();save();closeDialog();render();toast('演示数据已重置。');}),
    'add-task':()=>modal('后台命令 · 模拟',`<label class="field"><span>命令</span><input name="command" aria-label="后台命令" value="npm run dev" autofocus></label><p>当前目录：${esc(cwd())}<br>只添加演示任务，不执行系统命令。</p>`,cancelButton()+submitButton('添加演示任务'),form=>{const value=new FormData(form).get('command').trim();if(!value)return $('dialogError').textContent='命令不能为空。';terminalState().tasks.push({id:uid('t'),command:value,status:'未运行',output:'未运行，没有验证证据。'});closeDialog();state.layout.bottom='tasks';save();renderBottom();}),
    'task-run':el=>{const task=terminalState().tasks.find(t=>t.id===el.dataset.id);if(!task)return;task.status=task.status==='运行中'?'已取消':'运行中';task.output=task.status==='运行中'?'模拟后台任务正在运行。未执行真实命令。':'模拟进程树已停止，日志保留。';save();renderBottom();},
    'task-log':el=>{const task=terminalState().tasks.find(t=>t.id===el.dataset.id);modal('任务日志 · 示例',`<div class="dialog-summary">${esc(task.command)}<br>目录：${esc(cwd())}<br>状态：${task.status}<br>真实退出码：未知</div><pre>${esc(task.output)}</pre>`,actionButton('close-dialog','关闭')+actionButton('inject-task','附加日志到草稿',`data-id="${task.id}"`));},
    'inject-task':el=>{const task=terminalState().tasks.find(t=>t.id===el.dataset.id);closeDialog();appendContext(`后台任务：${task.command}`,task.output);},
  };
  document.addEventListener('click',event=>{
    const action=event.target.closest('[data-action]');
    if(action&&!action.disabled){event.preventDefault();const handler=handlers[action.dataset.action];if(handler)handler(action);else toast('此入口的详细规则见需求映射。');return;}
    const v=event.target.closest('.review-views [data-view]');if(v){setView(v.dataset.view);return;}
    const t=event.target.closest('#docTabs [data-tab]');if(t){setSpecTab(t.dataset.tab);return;}
    const req=event.target.closest('[data-req]');if(req){showRequirement(req.dataset.req);return;}
    const jump=event.target.closest('[data-jump]');if(jump){jumpSpec(jump.dataset.jump);return;}
    const proto=event.target.closest('[data-proto]');if(proto){prototypeFeature(proto.dataset.proto);return;}
    const demo=event.target.closest('[data-scene]');if(demo){scene(demo.dataset.scene);return;}
  });
  document.addEventListener('submit',event=>{
    if(event.target.id==='dialogForm'){event.preventDefault();dialogSubmit?.(event.target);}
    if(event.target.id==='terminalForm'){
      event.preventDefault();const input=$('terminalInput'),command=input.value.trim();if(!command)return;
      const run=()=>{const t=terminalState();let output=command==='pwd'?cwd():command==='git status'?`On branch ${active()?.branch||draft().branch||'main'}\n2 modified files (示例状态)`:/^(npm|pnpm) test/.test(command)?'模拟测试输出：2 tests passed\n退出码示例：0\n未运行真实测试。':command==='clear'?'':`原型未执行：${command}\n支持演示 pwd、git status、npm test。`;if(command==='clear')t.lines=['模拟终端已清屏'];else {t.lines.push(`❯ ${command}`,output);t.lastOutput=output;}save();renderBottom();$('terminalInput')?.focus();};
      if(/[\r\n]/.test(command)||/\b(rm|del|remove-item|sudo|format)\b/i.test(command))modal('命令内容预览',`<p>多行或高风险模式需要先确认；本原型始终只模拟，不执行。</p><pre>${esc(command)}</pre>`,cancelButton()+submitButton('确认模拟输入'),()=>{closeDialog();run();});else run();
    }
  });
  document.addEventListener('input',event=>{
    const target=event.target;
    if(target.id==='composerInput'){draft().text=target.value;composerError='';$('sendButton').disabled=!target.value.trim()||!state.connection;saveSoon();}
    if(target.id==='sessionSearch'){clearTimeout(searchTimer);activeSearch=0;searchTimer=setTimeout(renderSearch,200);}
    if(target.id==='coverageSearch')filterCoverage();
    if(target.id==='commandQuery')document.querySelectorAll('[data-command-name]').forEach(n=>n.hidden=!n.dataset.commandName.includes(target.value.trim()));
  });
  document.addEventListener('change',event=>{
    const t=event.target,d=draft();
    if(t.id==='demoScene'&&t.value)scene(t.value);
    if(t.id==='projectSelect'){d.projectId=t.value||null;delete d.cwd;delete d.branch;save();renderHeader();renderComposer();renderStatus();}
    if(t.id==='modelSelect'||t.id==='thinkingSelect'||t.id==='modeSelect'){d[{modelSelect:'model',thinkingSelect:'thinking',modeSelect:'mode'}[t.id]]=t.value;save();renderComposer();toast(t.id==='modeSelect'?'任务模式已更改，实际权限仍按工具裁决。':'配置已保存，作用于下次安全调用。');}
    if(['searchProject','searchStatus','searchTime','searchArchived'].includes(t.id)){activeSearch=0;renderSearch();}
    if(['coverageModule','coverageMilestone'].includes(t.id))filterCoverage();
    if(t.id==='settingTheme'){state.settings.theme=t.value;save();render();}
    if(t.id==='settingFont'){state.settings.font=Number(t.value);save();render();}
    if(t.id==='settingDensity'){state.settings.density=t.value;save();render();}
    if(t.id==='settingAutoName'){state.settings.autoName=t.checked;save();}
    if(t.classList.contains('stage-file')){active().files[Number(t.dataset.index)].staged=t.checked;save();renderPanel();}
    if(t.id==='terminalTab'){const term=terminalState();term.buffers ||= {};term.buffers[term.active]={lines:clone(term.lines),lastOutput:term.lastOutput};term.active=Number(t.value);const buffer=term.buffers[term.active]||{lines:['模拟终端标签'],lastOutput:''};term.lines=clone(buffer.lines);term.lastOutput=buffer.lastOutput;save();renderBottom();}
    if(t.id==='reviewScope'){const names={turn:'本轮开始前 → 本轮末态',working:'HEAD → 工作目录',staged:'HEAD → 暂存区',branch:'main 合并基线 → 当前分支'};toast(`比较范围：${names[t.value]}。当前展示为同一组示例差异，真实基线切换在 M6 实现。`);}
    if(t.id==='automationTimezone'||t.id==='automationFrequency')updateAutomationPreview();
  });
  $('composerInput').addEventListener('compositionstart',()=>composing=true);
  $('composerInput').addEventListener('compositionend',()=>composing=false);
  document.addEventListener('keydown',event=>{
    if(event.isComposing||composing||event.keyCode===229)return;
    if(event.key==='Escape'){
      if($('workbenchDialog').open)return;
      if($('workbench').classList.contains('sidebar-open')){closeSidebar();return;}
      if(state.layout.panel&&innerWidth<=1180){handlers['close-panel']();$('threadHeader').querySelector('button')?.focus();return;}
    }
    if(event.target.id==='sessionSearch'&&['ArrowDown','ArrowUp','Enter'].includes(event.key)){
      event.preventDefault();clearTimeout(searchTimer);if(event.key==='Enter'){renderSearch();chooseSearch(activeSearch);}else {activeSearch=Math.max(0,Math.min(searchMatches.length-1,activeSearch+(event.key==='ArrowDown'?1:-1)));renderSearch();$('searchResults').querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});}return;
    }
    if(event.target.id==='composerInput'&&event.key==='Enter'&&!event.shiftKey){event.preventDefault();send();return;}
    if($('workbenchDialog').open)return;
    if((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key.toLowerCase()==='p'){event.preventDefault();commands();}
    else if((event.ctrlKey||event.metaKey)&&!event.shiftKey&&event.key.toLowerCase()==='n'){event.preventDefault();setView('prototype');newSession();}
    else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();searchDialog();}
    else if(event.ctrlKey&&event.code==='Backquote'){event.preventDefault();bottom('terminal');}
  });
  $('workbenchDialog').addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
  $('threadViewport').addEventListener('scroll',()=>{const n=$('threadViewport');autoFollow=n.scrollHeight-n.scrollTop-n.clientHeight<90;$('returnLatest').hidden=!active()||autoFollow;});
  const resizer=$('panelResizer');
  function resizePanel(value) {state.layout.panelWidth=Math.max(320,Math.min(640,value));$('workbench').style.setProperty('--panel-width',`${state.layout.panelWidth}px`);resizer.setAttribute('aria-valuenow',state.layout.panelWidth);}
  resizer.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();resizePanel(event.key==='Home'?320:event.key==='End'?640:state.layout.panelWidth+(event.key==='ArrowLeft'?20:-20));save();}});
  resizer.addEventListener('pointerdown',event=>{const start=event.clientX,width=state.layout.panelWidth;resizer.setPointerCapture(event.pointerId);const move=e=>resizePanel(width+start-e.clientX);const end=()=>{resizer.removeEventListener('pointermove',move);resizer.removeEventListener('pointerup',end);save();};resizer.addEventListener('pointermove',move);resizer.addEventListener('pointerup',end);});
  window.addEventListener('beforeunload',save);
  window.addEventListener('hashchange',()=>{const id=decodeURIComponent(location.hash.slice(1));if(id)jumpSpec(id);});
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(state.settings.theme==='system')render();});
  installIcons();render();filterCoverage();
  const initial=decodeURIComponent(location.hash.slice(1));if(initial)jumpSpec(initial);
})();
