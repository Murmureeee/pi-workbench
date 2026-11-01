(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const params = new URLSearchParams(location.search);
  const embedded = params.get('embed') === '1';
  const preferenceKey = 'pi-workbench-design-review-preferences-v1';
  const sessionKey = 'pi-workbench-design-review-sessions-v1';
  const themes = ['system', 'light', 'dark'];
  const scenes = ['new','creating','create-failed','queued','running','approval','approval-invalid','settling','stopping','stopped','retrying','compacting','error','offline','reconnecting','review','conflict','snapshot-failed'];
  const phaseLabels = {new:'准备开始',creating:'正在保存会话','create-failed':'创建失败',queued:'等待执行资源',running:'正在执行',approval:'待审批','approval-invalid':'审批已失效',settling:'正在检查变更',stopping:'正在停止',stopped:'已停止',retrying:'等待重试',compacting:'正在压缩上下文',error:'请求失败',offline:'状态待确认',reconnecting:'正在同步',review:'本轮完成',conflict:'审查遇到冲突','snapshot-failed':'快照失败'};
  const advanceLabels = {creating:'模拟保存完成',queued:'模拟获得资源',running:'模拟回复结束',settling:'模拟收尾完成',stopping:'模拟停止确认',retrying:'模拟开始重试',compacting:'模拟压缩完成',reconnecting:'模拟同步完成'};
  let preferences = {}, savedSessions;
  try { preferences = JSON.parse(localStorage.getItem(preferenceKey)) || {}; savedSessions = JSON.parse(localStorage.getItem(sessionKey)); } catch { /* Offline / private previews can work without storage. */ }
  const paths = {
    compose:'<path d="m14 4 6 6M4 20l4-1 12-12a2 2 0 0 0-4-4L4 15v5Z"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    plus:'<path d="M12 5v14M5 12h14"/>', close:'<path d="m6 6 12 12M18 6 6 18"/>',
    folder:'<path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11H3V7Z"/>',
    chevron:'<path d="m7 10 5 5 5-5"/>',
    panel:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    expand:'<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
    file:'<path d="M5 3h9l5 5v13H5V3Zm9 0v6h5M8 13h8M8 17h6"/>',
    changes:'<path d="M8 3v10a4 4 0 0 0 4 4h4M5 6l3-3 3 3m2 8 3 3-3 3"/><circle cx="18" cy="6" r="3"/>',
    terminal:'<path d="m5 7 5 5-5 5m8 0h6"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    up:'<path d="M12 19V5m-6 6 6-6 6 6"/>', stop:'<rect x="5" y="5" width="14" height="14" rx="2"/>',
    copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    branch:'<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 7v10m0-5c8 0 12 0 12-4"/>',
    refresh:'<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    settings:'<path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 3 3-1 2 2 3-2v-3l3-2-1-4-3-1-1-3H9Z"/><circle cx="11" cy="11" r="3"/>',
    external:'<path d="M14 3h7v7m0-7L10 14m0-11H3v18h18v-7"/>',
    rollback:'<path d="M3 4v6h6M4 9a8 8 0 1 1 2 10"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
    alert:'<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3v1"/>',
    pin:'<path d="m9 3 9 9-4 1-3 5-2-4-4-2 5-3-1-6ZM4 20l5-6"/>',
  };
  const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.file}</svg>`;
  const ib = (action, label, glyph, attrs = '') => `<button type="button" class="icon-button" data-action="${action}" aria-label="${esc(label)}" title="${esc(label)}" ${attrs}>${icon(glyph)}</button>`;
  const button = (action, label, primary = false, attrs = '') => `<button type="button" class="button${primary ? ' primary' : ''}" data-action="${action}" ${attrs}>${label}</button>`;
  const primaryTitle = '修复登录过期后的重复跳转';
  const initialSessions = [
    { id:'auth', title:primaryTitle, project:'atlas', cwd:'D:\\Projects\\atlas-console', phase:'review', draft:'', message:'修复登录过期后重复跳转的问题，并补充测试。先检查现有逻辑，保留当前页面的回跳地址。', files:['pending','pending'], panel:'changes', queue:[], toolOpen:[] },
    { id:'layout', title:'梳理工作台的页面结构', project:'atlas', cwd:'D:\\Projects\\atlas-console', phase:'review', draft:'', message:'梳理项目、会话与审查工作区的页面结构。', files:[], panel:null, queue:[], toolOpen:[] },
    { id:'build', title:'检查构建产物与依赖', project:'atlas', cwd:'D:\\Projects\\atlas-console', phase:'approval', draft:'', message:'检查构建产物和依赖是否完整。', files:[], panel:null, queue:[], toolOpen:[] },
    { id:'notes', title:'整理下周的开发计划', project:null, cwd:'D:\\PiWorkbench\\standalone\\notes', phase:'review', draft:'', message:'帮我整理下周的开发计划。', files:[], panel:null, queue:[], toolOpen:[] },
  ];
  const validSaved = Array.isArray(savedSessions) && savedSessions.some(s => s.id === 'auth') && savedSessions.every(s => typeof s.id === 'string' && typeof s.title === 'string' && Array.isArray(s.files) && Array.isArray(s.queue) && Array.isArray(s.toolOpen));
  const sessions = embedded || !validSaved ? structuredClone(initialSessions) : savedSessions;
  let direction = ['hybrid','a','b'].includes(params.get('direction')) ? params.get('direction') : preferences.layoutVersion === 2 && ['hybrid','a','b'].includes(preferences.direction) ? preferences.direction : 'hybrid';
  let theme = themes.includes(params.get('theme')) ? params.get('theme') : themes.includes(preferences.theme) ? preferences.theme : 'system';
  let activeId = 'auth', currentScene = scenes.includes(params.get('scene')) ? params.get('scene') : 'new';
  let newDraft = { text:'', project:null, mode:'execute' };
  try { if (!embedded) newDraft = {...newDraft, ...JSON.parse(localStorage.getItem(`${sessionKey}-draft`))}; } catch { /* Draft persistence is optional in the preview. */ }
  let panel = ['review','conflict'].includes(currentScene) ? 'changes' : null, selectedFile = 0, terminal = false, comparison = false, navOpen = false;
  let contextAttached = false, toastTimer, dialogOrigin, composing = false, queueKind = 'followup', stopped = false;
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  const viewportObserver = new ResizeObserver(entries => entries.forEach(({target}) => {
    if (target === $('threadViewport') && target.dataset.following === 'true') target.scrollTop = target.scrollHeight;
  }));
  const active = () => sessions.find(s => s.id === activeId);
  const isNew = () => ['new','creating','create-failed'].includes(currentScene);
  const isBusy = () => ['running','approval','settling','retrying','compacting'].includes(currentScene) && !stopped;
  const layout = () => direction === 'hybrid' ? panel === 'changes' && !isNew() ? 'b' : 'a' : direction;
  const blocksSend = () => ['creating','queued','offline','reconnecting','stopping','approval-invalid','snapshot-failed'].includes(currentScene) || (!isNew() && stopped && active().queue.length > 0);
  const projectName = value => value === 'atlas' ? 'atlas-console' : value === 'ui' ? 'ui-kit' : '无项目';
  const executionPath = () => isNew() ? newDraft.project === 'atlas' ? 'D:\\Projects\\atlas-console' : newDraft.project === 'ui' ? 'D:\\Projects\\ui-kit' : '独立执行目录 · 首次发送时分配' : active().cwd;
  const filePaths = ['src/auth/session.ts','src/auth/session.test.ts'];
  const fileNames = ['session.ts','session.test.ts'];
  const rows = [
    [ ['','41','export function handleExpired(next: string) {'], ['','42','  const current = window.location.pathname;'], ['-','43',"  window.location.assign('/login?next=' + next);"], ['+','43','  if (redirecting) return;'], ['+','44','  redirecting = true;'], ['+','45','  const target = next || current;'], ['+','46',"  const query = new URLSearchParams({ next: target });"], ['+','47',"  window.location.replace(`/login?${query}`);"], ['','48','}'] ],
    [ ['+','1',"it('redirects only once for concurrent failures', () => {"], ['+','2',"  handleExpired('/settings');"], ['+','3',"  handleExpired('/settings');"], ['+','4','  expect(replace).toHaveBeenCalledTimes(1);'], ['+','5','});'], ['+','6',"it('preserves the return path', () => {"], ['+','7',"  handleExpired('/settings?tab=profile');"], ['+','8','  expect(replace).toHaveBeenCalledWith('], ['+','9',"    '/login?next=%2Fsettings%3Ftab%3Dprofile'"], ['+','10','  );'], ['+','11','});'] ],
  ];
  function persist() {
    if (embedded) return;
    try {
      localStorage.setItem(preferenceKey, JSON.stringify({direction,theme,layoutVersion:2}));
      localStorage.setItem(sessionKey, JSON.stringify(sessions));
      localStorage.setItem(`${sessionKey}-draft`, JSON.stringify(newDraft));
    } catch { /* Keep the current interaction available when storage is disabled. */ }
  }
  function applyTheme() {
    document.documentElement.dataset.theme = theme === 'system' ? systemTheme.matches ? 'dark' : 'light' : theme;
    $('themeSelect').value = theme;
  }
  systemTheme.addEventListener('change', () => { if (theme === 'system') applyTheme(); });
  function toast(message) {
    clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
    toastTimer = setTimeout(() => $('toast').hidden = true, 4200);
  }
  function rememberDraft() {
    const input = $('taskInput');
    if (input) { if (isNew()) newDraft.text = input.value; else active().draft = input.value; }
    if (!isNew()) {
      active().panel = panel; active().selectedFile = selectedFile;
      const viewport = $('threadViewport');
      if (viewport) {
        const top = viewport.getBoundingClientRect().top;
        const nodes = [...viewport.querySelector('.thread-content').children];
        const anchor = nodes.findIndex(n => n.getBoundingClientRect().bottom >= top);
        active().view = {phase:currentScene,anchor,offset:anchor >= 0 ? nodes[anchor].getBoundingClientRect().top - top : 0,follow:viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 36};
      }
    }
    persist();
  }
  function navRow(s, extra = '') {
    return `<button type="button" class="session-row ${s.project ? 'indented' : ''} ${!isNew() && activeId === s.id ? 'active' : ''} ${extra}" data-action="open-session" data-id="${esc(s.id)}" ${!isNew() && activeId === s.id ? 'aria-current="page"' : ''}><span>${esc(s.title)}</span>${s.phase === 'approval' && !s.stopped ? '<i class="wait-dot" aria-hidden="true"></i><small>待审批</small>' : ''}</button>`;
  }
  function renderNav() {
    const atlasSessions = sessions.filter(s => s.project === 'atlas');
    return `<aside class="sidebar" aria-label="项目与会话"><div class="sidebar-brand"><span class="pi-mark" aria-hidden="true">π</span><strong>Pi Workbench</strong>${ib('nav','收起导航','panel')}</div>
      <nav class="nav-actions" aria-label="会话操作"><button class="nav-button" data-action="new">${icon('compose')}<span>新会话</span><kbd>Ctrl N</kbd></button><button class="nav-button" data-action="search">${icon('search')}<span>搜索会话</span><kbd>Ctrl K</kbd></button></nav>
      <div class="sidebar-scroll"><section class="nav-section"><div class="nav-section-title">已置顶</div>${navRow(sessions.find(s => s.id === 'layout'))}</section>
      <section class="nav-section"><div class="nav-section-title">项目${ib('projects','项目管理','plus')}</div><div class="project-row">${icon('chevron')}${icon('folder')}<span>atlas-console</span>${ib('new-project-session','在 atlas-console 新建会话','plus','data-project="atlas"')}</div>${atlasSessions.filter(s => s.id !== 'layout').map(s => navRow(s)).join('')}
      <div class="project-row">${icon('folder')}<span>ui-kit</span>${ib('new-project-session','在 ui-kit 新建会话','plus','data-project="ui"')}</div>${sessions.filter(s => s.project === 'ui').map(s => navRow(s)).join('')}</section>
      <section class="nav-section"><div class="nav-section-title">最近 · 无项目</div>${sessions.filter(s => !s.project).map(s => navRow(s)).join('')}</section><section class="nav-section"><button class="nav-button" data-action="legacy-history">${icon('clock')}<span>旧 pi 历史</span><small>只读</small></button></section></div>
      <div class="sidebar-bottom"><button class="nav-button" data-action="settings">${icon('settings')}<span>设置</span></button><div class="sidebar-foot"><span class="local-avatar">本</span><span>本地工作台</span><i class="dot" aria-hidden="true"></i></div></div></aside>`;
  }
  function renderHeader() {
    return `<header class="thread-header"><button class="icon-button mobile-nav" data-action="nav" aria-label="展开导航">${icon('panel')}</button><div class="title-group"><div class="title-line">${isNew() ? '<span class="thread-title">新会话</span>' : `<button class="thread-title" data-action="session-menu" aria-label="会话菜单：${esc(active().title)}"><span>${esc(active().title)}</span>${icon('chevron')}</button>`}</div><div class="header-subline"><span class="project-name">${esc(projectName(isNew() ? newDraft.project : active().project))}</span><span class="path-divider">/</span><span class="path" title="${esc(executionPath())}">${esc(executionPath())}</span></div></div>
      <div class="header-actions"><button class="header-action" data-action="terminal" aria-label="打开终端" aria-pressed="${terminal}">${icon('terminal')}<span>终端</span></button><button class="header-action files-action" data-action="files" aria-label="打开文件" aria-pressed="${panel === 'files'}">${icon('folder')}<span>文件</span></button>${!isNew() && active().files.length && ['review','conflict','stopped'].includes(currentScene) ? `<button class="header-action" data-action="changes" aria-label="查看变更" aria-pressed="${panel === 'changes'}">${icon('changes')}<span>变更</span><span class="count">2</span></button>` : ''}</div></header>`;
  }
  function tools() {
    const done = ['review','conflict','approval'].includes(currentScene);
    const steps = [
      ['读取登录状态与请求拦截器','src/auth/session.ts\nsrc/api/client.ts','0.3s'],
      ['更新跳转保护与回归测试','edit src/auth/session.ts\nwrite src/auth/session.test.ts','0.8s'],
      [done && currentScene !== 'approval' ? '运行定向测试 · 6 项通过' : '准备运行定向测试',currentScene === 'approval' ? '等待审批，尚未执行。' : 'pnpm test -- src/auth/session.test.ts\nTests  6 passed (6)','1.2s'],
    ];
    const stack = `<div class="tool-stack">${steps.slice(0,currentScene === 'running' ? 2 : 3).map(([label,detail,time],i) => `<details class="tool-step" data-tool="${i}" ${active().toolOpen.includes(i) ? 'open' : ''}><summary>${icon(currentScene === 'approval' && i === 2 ? 'clock' : 'check',currentScene === 'approval' && i === 2 ? 'warning' : 'ok')}<span>${label}</span><span class="time">${currentScene === 'approval' && i === 2 ? '待决定' : time}</span>${icon('chevron','chevron')}</summary><pre>${esc(detail)}</pre></details>`).join('')}</div>`;
    if (layout() === 'a') return stack;
    return `<details class="run-group" data-tool="9" ${active().toolOpen.includes(9) || !['review','conflict'].includes(currentScene) ? 'open' : ''}><summary>${icon('changes')}<span>本轮过程 · ${currentScene === 'running' ? '2' : '3'} 个步骤</span><span class="spacer"></span><span>${currentScene === 'approval' ? '等待你决定' : ['review','conflict'].includes(currentScene) ? '2.3s' : '执行中'}</span>${icon('chevron','chevron')}</summary>${stack}</details>`;
  }
  function approvalCard() {
    return `<div class="phase-line waiting"><i class="phase-dot"></i>等待审批 · 命令尚未执行</div><section class="approval-card" aria-label="执行前审批"><div class="approval-head">${icon('shield')}<strong>允许运行这条测试命令？</strong><span class="pill">仅本次</span></div><div class="approval-body"><p>验证登录跳转保护与回跳地址。</p><pre>pnpm test -- src/auth/session.test.ts</pre><div class="approval-meta"><span>执行目录</span><span class="path">${esc(executionPath())}</span><span>影响范围</span><span>可能写入测试缓存；命令的外部副作用不在文件回滚范围。</span><span>授权绑定</span><span>当前命令、目录与最终参数；参数改变后重新审批。</span></div></div><div class="approval-foot"><span class="wait-note">持续等待你的决定</span>${button('cancel-approval','取消请求')}${button('deny','拒绝')}${button('allow','允许一次',true)}</div></section>`;
  }
  function lifecycleMessage() {
    const box = (title,text,actions = '',tone = '') => `<section class="state-card ${tone}" aria-label="${esc(title)}"><div class="state-card-heading">${icon(tone === 'attention' ? 'alert' : 'clock')}<h3>${title}</h3></div><p>${text}</p>${actions ? `<div class="button-row">${actions}</div>` : ''}</section>`;
    if (currentScene === 'queued') return box('等待执行资源','当前模型任务尚未启动。其他会话正在运行；获得执行资源后才开始本任务。',button('cancel-queued','取消排队'));
    if (currentScene === 'approval-invalid') return box('审批请求已失效','最终参数已改变，旧的允许决定不再适用。命令尚未执行，需要重新检查后发起新请求。',`${button('old-allow','旧请求不可批准',false,'disabled')}${button('renew-approval','重新检查',true)}`,'attention');
    if (currentScene === 'settling') return box('回复已结束，正在检查变更','正在等待工具、写入与快照收尾。本轮尚未完成，追加消息继续等待。',button('turn-detail','查看收尾说明'));
    if (currentScene === 'stopping') return box('正在停止本轮','已请求中止，等待执行系统确认。已完成的改动保留，剩余队列暂停。',button('stop','正在停止',false,'disabled'));
    if (currentScene === 'stopped') return box('本轮已停止','记录和已完成的改动已保留。未送达的消息保持暂停，确认后才能继续。',`${button('review-stopped','检查已完成改动',false,active().files.length ? '' : 'disabled')}${button('resume-stopped','确认继续',true)}`);
    if (currentScene === 'retrying') return box('等待重试 · 第 1 次','提供商返回 429。尚未发起下一次请求；可取消后保留当前任务。本稿使用手动推进样本，不运行自动重试。',button('cancel-retry','取消重试'));
    if (currentScene === 'compacting') return box('正在压缩上下文','压缩摘要尚未就绪。原始记录继续保留，待送达消息不会丢失；完成后再展示实际规模。',button('original-history','查看原记录'));
    if (currentScene === 'reconnecting') return box('正在同步会话状态','先读取权威状态与未接收事件，再恢复查看。不会自动重放结果不确定的命令。',button('connection-help','查看恢复方式'));
    if (currentScene === 'snapshot-failed') return box('基线快照失败，写入已暂停','本轮无法建立可靠的回滚基线。可以重试快照或取消任务；若选择继续，需要单独接受本轮无法回滚的风险。',`${button('cancel-snapshot','取消本轮')}${button('snapshot-risk','查看继续的影响')}${button('retry-snapshot','重试快照',true)}`,'attention');
    return '';
  }
  function renderMessages() {
    const authTask = activeId === 'auth';
    let body = `<div class="turn-heading">今天 14:32</div><div class="user-message">${esc(active().message)}</div><div class="agent-label"><span class="pi-mark" aria-hidden="true">π</span><span>Pi</span></div>`;
    const lifecycle = lifecycleMessage();
    if (lifecycle) return body + lifecycle;
    if (!authTask && activeId !== 'build') {
      body += `<div class="assistant-text"><p>${activeId === 'layout' ? '对话是工作台的中心。项目与会话保留在左侧，文件、变更与终端按任务需要打开。' : activeId === 'notes' ? '建议先完成工程基线，再接通真实对话与审批，随后完成修改审查和回滚。' : '已收到任务。可以继续补充约束，或查看本次操作的执行过程。'}</p></div>`;
      if (currentScene === 'running') body += `<div class="phase-line"><i class="phase-dot"></i>正在准备任务${stopped ? ' · 已停止' : ''}</div>`;
      else body += `<div class="result-strip">${icon(stopped ? 'stop' : 'check',stopped ? '' : 'ok')}<span>${stopped ? '本轮已停止' : '回复已完成'}</span></div>`;
      return body;
    }
    body += '<div class="assistant-text"><p>已定位问题：会话过期时，多个请求同时触发登录跳转。我会统一跳转入口，保留当前页面的回跳地址，并补上并发失败的测试。</p></div>';
    if (['error','offline'].includes(currentScene)) {
      body += currentScene === 'error' ? `<section class="error-block"><h3>请求失败 · 429</h3><p>提供商暂时限制请求。当前内容已保留，你可以稍后手动重试。</p><p>本轮未执行工具 · 费用未知</p><div class="button-row">${button('retry','重试本轮',true)}${button('model','查看模型配置')}</div></section>` : `<section class="error-block"><h3>与本地服务的连接中断</h3><p>正在显示最后收到的状态。无法确认任务是否仍在运行，已禁用新的发送与审批决定。</p><div class="button-row">${button('reconnect','重新连接',true)}${button('connection-help','查看恢复方式')}</div></section>`;
      return body;
    }
    body += tools();
    if (currentScene === 'approval' && !stopped) body += approvalCard();
    else if (currentScene === 'running' && !stopped) body += '<div class="phase-line"><i class="phase-dot"></i>正在检查跳转状态的边界条件…</div>';
    else if (stopped) body += `<section class="error-block"><h3>本轮已停止</h3><p>已保留本轮记录，未执行的请求已取消。后续运行需要重新决定。</p>${button('retry','继续本轮')}</section>`;
    else body += `<div class="assistant-text"><p>已完成修改：</p><ul><li>并发请求只触发一次跳转，避免登录页被重复打开。</li><li>通过 <code>URLSearchParams</code> 保留并编码回跳地址。</li><li>补充重复触发与带查询参数的回归测试。</li></ul><p>定向测试 6 项通过。尚未运行完整测试，也未提交代码。</p></div>${currentScene === 'conflict' ? '<div class="inline-warning">'+icon('alert')+'检测到本轮结束后的外部修改，回滚前需要处理冲突。</div>' : ''}<div class="result-strip"><span class="status-label">${icon('check','ok')}本轮已完成</span><span>2 个文件 <span class="ok">+16</span> <span class="danger">−1</span></span><button class="link-button" data-action="changes">审查变更</button></div><div class="reply-actions">${ib('copy','复制回复','copy')}${ib('turn-detail','查看本轮信息','info')}</div>`;
    return body;
  }
  function renderComposer() {
    const draft = isNew() ? newDraft.text : active().draft;
    const q = isNew() ? [] : active().queue;
    return `<div class="composer-area"><button class="latest-control" id="latestButton" data-action="latest" hidden>返回最新消息 ↓</button>${q.length ? `<div class="queue-bar">${icon('clock')}<span>${q.length} 条消息等待送达 · ${stopped || currentScene === 'stopping' ? '已暂停' : q.some(x=>x.kind==='steer') && q.some(x=>x.kind==='followup') ? '引导与追加分别排队' : q[0]?.kind === 'steer' ? '引导当前轮' : '追加下一轮'}</span><button data-action="view-queue">查看</button></div>` : ''}${contextAttached ? `<span class="context-chip">${icon('terminal')}<span>终端输出 · 6 项测试通过</span><button data-action="detach" aria-label="移除终端上下文">${icon('close')}</button></span>` : ''}<div class="composer-box"><label class="sr-only" for="taskInput">${isNew() ? '描述新任务' : '继续对话'}</label><textarea id="taskInput" ${currentScene === 'creating' ? 'readonly aria-busy="true"' : ''} placeholder="${isNew() ? '描述任务，或输入 / 查看操作' : isBusy() ? '补充说明，或排到下一轮…' : '继续提问，或描述下一步…'}" rows="3">${esc(draft)}</textarea><div class="composer-toolbar">${ib('attach','添加上下文','plus')}${isNew() ? `<button class="composer-option" data-action="select-project" ${currentScene === 'creating' ? 'disabled' : ''}>${icon('folder')}<span>${esc(projectName(newDraft.project))}</span>${icon('chevron')}</button>` : ''}<label class="composer-option"><span class="sr-only">任务模式</span><select id="modeSelect" ${currentScene === 'creating' ? 'disabled' : ''}><option value="execute" ${(isNew() ? newDraft.mode : active().mode) !== 'discuss' ? 'selected' : ''}>执行</option><option value="discuss" ${(isNew() ? newDraft.mode : active().mode) === 'discuss' ? 'selected' : ''}>讨论</option></select></label><button class="composer-option model" data-action="model"><span>当前配置模型</span>${icon('chevron')}</button>${isBusy() ? `<label class="composer-option"><span class="sr-only">发送方式</span><select id="queueSelect"><option value="followup" ${queueKind === 'followup' ? 'selected' : ''}>追加下一轮</option><option value="steer" ${queueKind === 'steer' ? 'selected' : ''} ${currentScene === 'settling' ? 'disabled' : ''}>引导当前轮</option></select></label>` : ''}<span class="spacer"></span>${isBusy() ? `<button class="send-button stop" data-action="stop" aria-label="停止本轮">${icon('stop')}</button>` : ''}${currentScene === 'creating' ? '<span class="saving-label">正在创建…</span>' : ''}<button class="send-button" id="sendButton" data-action="send" aria-label="发送消息" ${!draft?.trim() || blocksSend() ? 'disabled' : ''}>${icon('up')}</button></div></div><div class="composer-hint"><span class="path" title="${esc(executionPath())}">${icon('shield')} ${isNew() ? esc(executionPath()) : '执行前按权限规则确认'}</span><span class="spacer"></span><button data-action="usage">费用未知</button><span>Enter 发送 · Shift Enter 换行</span></div></div>`;
  }
  function renderNew() {
    return `<section class="conversation new-conversation" aria-label="新会话"><div class="new-content"><span class="pi-mark" aria-hidden="true">π</span><h1>${currentScene === 'creating' ? '正在保存你的会话' : currentScene === 'create-failed' ? '任务还在，重新试一次' : '从一个任务开始'}</h1><p>${currentScene === 'creating' ? '正在保存会话与首条消息，完成后才开始运行。' : currentScene === 'create-failed' ? '保存会话失败，草稿已保留，尚未创建会话或启动任务。' : '选择项目，或直接开始一段独立会话。'}</p></div>${renderComposer()}<div class="new-content"><div class="new-hint">${button('suggest-investigate',`${icon('search')} 了解这个项目`)}${button('suggest-fix',`${icon('changes')} 修复一个问题`)}</div></div></section>`;
  }
  function renderDiff() {
    return `<div class="diff-title"><span class="path" title="${esc(filePaths[selectedFile])}">${esc(filePaths[selectedFile])}</span><span>统一视图</span></div><div class="diff-hunk">@@ ${selectedFile === 0 ? '−41,4 +41,8' : '−0,0 +1,11'} @@</div><div class="diff-code">${rows[selectedFile].map(([type,num,line]) => `<div class="diff-row ${type === '+' ? 'add' : type === '-' ? 'del' : ''}"><span class="line-number">${num}</span><span class="diff-sign">${type || ' '}</span><span>${esc(line)}</span></div>`).join('')}</div>`;
  }
  function renderPanel() {
    if (!panel) return '';
    if (panel === 'files') return `<aside class="review-panel" aria-label="文件面板"><div class="panel-header">${icon('folder')}<strong>文件</strong>${ib('close-panel','关闭文件面板','close')}</div><div class="panel-scope"><strong>atlas-console</strong><div class="scope-baseline">${esc(executionPath())}</div></div><div class="file-list"><div class="file-group">src / auth</div>${filePaths.map((path,i) => `<button class="file-row" data-action="open-file" data-index="${i}">${icon('file')}<span class="file-path">${esc(path)}</span></button>`).join('')}</div><div class="panel-explain"><strong>把需要的文件加入对话</strong>打开文件后，可显式引用所需内容。浏览文件本身不会自动消耗上下文。</div></aside>`;
    const verdicts = active().files;
    const done = verdicts.filter(v => v !== 'pending').length;
    const verdictText = {pending:'待审查',accepted:'已接受',reverted:'已回滚'};
    const conflicted = currentScene === 'conflict' && selectedFile === 0;
    return `<aside class="review-panel" aria-label="变更审查面板"><div class="panel-header">${icon('changes')}<strong>${layout() === 'b' ? '审查工作区' : '变更'}</strong><span class="pill">本轮</span>${direction === 'hybrid' ? '' : ib('expand-review',layout() === 'a' ? '展开审查工作区' : '收起为轻量审查','expand')}${ib('close-panel','关闭审查面板','close')}</div><div class="panel-scope"><div class="scope-title"><strong>2 个文件变更</strong><span class="diff-stats"><span class="ok">+16</span><span class="danger">−1</span></span></div><div class="scope-baseline">${icon('clock')}本轮开始前 → 本轮结束时</div></div><div class="file-list">${layout() === 'b' ? '<div class="file-group">src / auth</div>' : ''}${filePaths.map((path,i) => `<button class="file-row ${selectedFile === i ? 'active' : ''}" data-action="select-file" data-index="${i}" aria-pressed="${selectedFile === i}">${icon('file')}<span class="file-path" title="${esc(path)}">${layout() === 'b' ? fileNames[i] : esc(path)}</span>${verdicts[i] !== 'pending' ? `<span class="file-verdict">${verdictText[verdicts[i]]}</span>` : `<span class="diff-stats"><span class="ok">+${i ? 11 : 5}</span><span class="danger">${i ? '' : '−1'}</span></span>`}</button>`).join('')}</div>${conflicted ? '<div class="panel-warning"><span>当前文件含外部修改，自动回滚已暂停。</span><button class="link-button" data-action="conflict-detail">检查</button></div>' : active().unprotected ? '<div class="panel-warning">本轮缺少基线快照，不可自动回滚。</div>' : ''}<div class="diff-workspace">${renderDiff()}<div class="panel-explain"><strong>${conflicted ? '检测到外部修改 · 回滚已暂停' : active().unprotected ? '本轮缺少快照 · 不可回滚' : verdicts[selectedFile] === 'reverted' ? '文件已回滚 · 保留本轮 Diff 记录' : '修改来源：本轮 Agent'}</strong>${conflicted ? '当前文件含本轮结束后的外部编辑，此 Diff 是本轮记录。先检查两个版本，当前文件不会被自动覆盖。' : active().unprotected ? '本轮曾显式选择在无基线快照的情况下继续。可以记录保留决定，不能自动恢复到轮前版本。' : verdicts[selectedFile] === 'reverted' ? '当前文件已恢复到本轮开始前；这里展示的仍是历史差异。' : '快照可用，未检测到外部编辑。接受只记录审查决定，不提交代码。'}${conflicted ? '<div class="button-row conflict-actions">'+button('conflict-detail','检查冲突',true)+button('keep-conflict','保留现场')+'</div>' : ''}<br><button class="link-button" data-action="rollback-scope">查看可回滚范围</button></div></div><footer class="review-footer"><div class="review-progress"><span>${done} / 2 个文件已处理</span><span class="progress-track"><span style="width:${done * 50}%"></span></span><span>${done === 2 ? '全部已处理' : '待你审查'}</span></div><div class="button-row">${button('revert',`${icon('rollback')} 回滚此文件`,false,verdicts[selectedFile] !== 'pending' || conflicted || active().unprotected ? 'disabled' : '')}${button('accept',`${icon('check')} ${verdicts[selectedFile] === 'accepted' ? '已接受' : '接受此文件'}`,true,verdicts[selectedFile] !== 'pending' || conflicted ? 'disabled' : '')}</div><p>本轮结果：完成；审查决定与运行结果分别记录。</p></footer></aside>`;
  }
  function renderTerminal() {
    if (!terminal) return '';
    return `<section class="terminal" aria-label="终端与后台任务"><header class="terminal-head">${icon('terminal')}<span>测试 · PowerShell</span>${button('attach-output','将输出加入上下文')}${ib('terminal','收起终端','close')}</header><pre><span class="syntax">PS ${esc(executionPath())}&gt;</span> pnpm test -- src/auth/session.test.ts\n<span class="ok">✓</span> src/auth/session.test.ts (6 tests)\n<span class="ok">Tests  6 passed (6)</span>\nDuration  1.2s</pre></section>`;
  }
  function render() {
    const origin = document.activeElement;
    const originId = origin?.id;
    const originAction = origin?.dataset?.action;
    applyTheme();
    document.body.classList.toggle('embed', embedded);
    $('sceneSelect').value = currentScene;
    document.querySelectorAll('[data-action="direction"]').forEach(b => b.setAttribute('aria-pressed',b.dataset.value === direction));
    $('directionNote').textContent = direction === 'hybrid' ? '已确认组合：日常对话 + 按需宽审查；字号 14 / 15 / 12 px。全部本地模拟，不调用模型。' : direction === 'a' ? 'A 对话优先：工具步骤内联，Diff 按需打开。所有消息、命令与文件为模拟，不调用模型。' : 'B 审查聚焦：过程按轮次归组，Diff 使用更宽工作区。同一任务、同一内容，全部本地模拟。';
    $('sampleAdvance').hidden = !advanceLabels[currentScene];
    $('sampleAdvance').textContent = advanceLabels[currentScene] || '';
    $('stage').dataset.direction = layout();
    $('stage').dataset.layout = direction;
    $('stage').classList.toggle('sidebar-open',navOpen);
    $('stage').innerHTML = `<button class="sidebar-scrim" data-action="nav" aria-label="关闭导航遮罩"></button>${renderNav()}<section class="app" aria-label="当前会话">${renderHeader()}${currentScene === 'offline' ? '<div class="banner">'+icon('alert')+'<span>连接中断 · 当前运行状态待确认</span><button class="link-button" data-action="reconnect">重连</button></div>' : ''}<div class="workspace ${panel && !isNew() ? 'panel-open' : ''}">${isNew() ? renderNew() : `<section class="conversation" aria-label="任务与对话"><div class="thread-viewport" id="threadViewport" tabindex="0" aria-label="会话消息"><div class="thread-content">${renderMessages()}</div></div>${renderComposer()}</section>`}${panel && !isNew() ? `<button class="panel-scrim" data-action="close-panel" aria-label="关闭面板遮罩"></button>${renderPanel()}` : ''}</div>${renderTerminal()}<footer class="status-bar"><i class="dot" ${currentScene === 'offline' ? 'style="background:var(--warn)"' : ''} aria-hidden="true"></i><span>${currentScene === 'offline' ? '本地服务连接中断' : '本地服务已连接'}</span><span class="spacer"></span><button data-action="turn-detail">${stopped ? '已停止' : phaseLabels[currentScene]}</button><button data-action="usage">上下文 ${isNew() ? '0' : '24'}%</button></footer></section>`;
    // Details retain expansion within each simulated session.
    document.querySelectorAll('details[data-tool]').forEach(n => n.addEventListener('toggle', () => {
      const index = Number(n.dataset.tool), s = active();
      s.toolOpen = n.open ? [...new Set([...s.toolOpen,index])] : s.toolOpen.filter(i => i !== index);
      persist();
    }));
    const viewport = $('threadViewport');
    viewportObserver.disconnect();
    if (viewport) {
      const view = active().view;
      if (view?.phase === currentScene) {
        if (view.follow) viewport.scrollTop = viewport.scrollHeight;
        else {
          const anchor = viewport.querySelector('.thread-content').children[view.anchor];
          if (anchor) viewport.scrollTop += anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top - view.offset;
        }
      } else if (currentScene === 'approval' && !stopped) viewport.scrollTop = viewport.scrollHeight;
      const updateLatest = () => {
        const following = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 36;
        viewport.dataset.following = String(following);
        if ($('latestButton')) $('latestButton').hidden = following;
      };
      viewport.addEventListener('scroll',updateLatest); updateLatest();
      viewportObserver.observe(viewport);
    }
    if (origin && !origin.isConnected) (originId ? $(originId) : originAction ? document.querySelector(`[data-action="${CSS.escape(originAction)}"]`) : null)?.focus({preventScroll:true});
    if (comparison) renderComparison();
  }
  function transition(value) {
    rememberDraft(); currentScene = value; active().phase = value; stopped = value === 'stopped'; active().stopped = stopped; delete active().view;
    if (value === 'review') panel = 'changes';
    render(); persist();
  }
  function setScene(value) {
    rememberDraft(); currentScene = value; stopped = value === 'stopped'; contextAttached = false; selectedFile = 0;
    if (!isNew()) { activeId = 'auth'; active().phase = value; active().stopped = stopped; active().unprotected = false; delete active().view; }
    if (['creating','create-failed'].includes(value) && !newDraft.text.trim()) newDraft.text = '修复登录过期后重复跳转的问题，并补充测试。';
    panel = ['review','conflict'].includes(value) ? 'changes' : null;
    if (value === 'settling') queueKind = 'followup';
    navOpen = false; render(); persist();
    if (isNew() && value !== 'creating') $('taskInput').focus();
  }
  function openSession(id) {
    rememberDraft(); activeId = id; currentScene = active().stopped ? 'stopped' : active().phase; stopped = !!active().stopped; panel = active().panel; selectedFile = active().selectedFile || 0; navOpen = false; render();
  }
  function closeDialog() { $('dialog').close(); dialogOrigin?.isConnected && dialogOrigin.focus(); }
  function modal(title, body, footer = '') {
    if ($('dialog').open) $('dialog').close();
    else dialogOrigin = document.activeElement;
    $('dialog').innerHTML = `<header class="dialog-header"><h2 id="dialogTitle">${esc(title)}</h2>${ib('close-dialog','关闭对话框','close')}</header><div class="dialog-body">${body}</div>${footer ? `<footer class="dialog-footer">${footer}</footer>` : ''}`;
    $('dialog').showModal();
    $('dialog').scrollTop = 0;
  }
  function rename() {
    modal('重命名会话',`<label for="renameInput">会话名称</label><input id="renameInput" value="${esc(active().title)}" maxlength="160"><div id="renameError" class="dialog-error" role="alert"></div>`,`${button('close-dialog','取消')}${button('save-name','保存',true)}`);
    $('renameInput').focus(); $('renameInput').select();
  }
  function chooseProject(moving = false) {
    const selected = moving ? active().project : newDraft.project;
    modal(moving ? '更改会话归属' : '选择项目',`<p>${moving ? '更改归属只整理会话。实际执行目录保持为：' : '项目可选。无项目会话会使用独立执行目录。'}</p>${moving ? `<p><code>${esc(active().cwd)}</code></p>` : ''}${[[null,'无项目','独立会话，不需要选择项目'],['atlas','atlas-console','D:\\Projects\\atlas-console'],['ui','ui-kit','D:\\Projects\\ui-kit']].map(([id,name,path]) => `<label class="choice-row"><input type="radio" name="project" value="${id || ''}" ${selected === id ? 'checked' : ''}><span>${name}<small>${esc(path)}</small></span></label>`).join('')}`,`${button('close-dialog','取消')}${button(moving ? 'move-project' : 'save-project','确定',true)}`);
  }
  function settings(tab = 'appearance') {
    const tabs = [['appearance','外观'],['permissions','权限'],['window','窗口与后台'],['data','数据'],['tools','工具'],['notifications','通知与更新']];
    if (!tabs.some(([id]) => id === tab)) tab = 'appearance';
    const nav = `<nav class="settings-nav" aria-label="设置分类">${tabs.map(([id,label]) => `<button class="button" data-action="settings-page" data-tab="${id}" aria-current="${tab === id ? 'page' : 'false'}">${label}</button>`).join('')}</nav>`;
    let body = '';
    if (tab === 'appearance') body = `<div class="setting-row"><div>主题<small>默认跟随系统；明暗两套使用同一语义。</small></div><select id="settingsTheme" aria-label="外观主题"><option value="system" ${theme === 'system' ? 'selected' : ''}>跟随系统</option><option value="light" ${theme === 'light' ? 'selected' : ''}>浅色</option><option value="dark" ${theme === 'dark' ? 'selected' : ''}>深色</option></select></div><div class="setting-row"><div>界面密度<small>界面 14 px / 消息 15 px / 辅助 12 px。</small></div><span class="pill">标准</span></div>`;
    if (tab === 'permissions') body = `<div class="setting-row"><div>新会话默认权限<small>来源：应用默认。新会话生效；已有授权按其范围独立检查。</small></div><span class="pill">先审批</span></div><dl class="policy-list"><dt>受限读取</dt><dd>经验证的只读工具在允许范围内自动执行；敏感文件、越界和未知能力重新裁决。</dd><dt>写文件与命令</dt><dd>执行前审批。任意 Shell 命令不因声明“只读”而直接放行。</dd><dt>会话授权</dt><dd>须显式授予并限定工具、目录与参数，可随时撤销。高危操作始终单次确认。</dd><dt>等待决定</dt><dd>无倒计时。关窗、切换会话或短暂断线继续等待；取消、参数或运行时失效终止旧请求。</dd></dl><div class="button-row">${button('session-grants','查看当前会话授权')}${button('approval-policy','查看审批规则')}</div>`;
    if (tab === 'window') body = `<dl class="policy-list"><dt>关闭桌面窗口 ×</dt><dd>收到托盘，已有任务与待审批继续。重新打开可恢复查看。</dd><dt>菜单“退出应用”</dt><dd>保存记录，取消待审批与排队，停止受管服务、Agent、命令和终端。确认停止后完成退出。</dd><dt>关闭浏览器</dt><dd>仅断开查看，服务和任务继续；重连先同步状态。</dd><dt>独立服务</dt><dd>独立启动的服务需显式退出，不随桌面关闭或退出而被误停。</dd><dt>开机自启</dt><dd>默认关闭。</dd><dt>重新启动</dt><dd>恢复记录与草稿；中断任务等待决定，旧授权与副作用不自动重放。</dd></dl><div class="button-row">${button('tray-preview','查看关窗行为')}${button('exit-preview','查看退出流程')}</div>`;
    if (tab === 'data') body = `<div class="setting-row"><div>数据位置<small>Windows 当前用户应用数据目录</small><code>%LOCALAPPDATA%\\PiWorkbench</code></div>${button('migration-preview','更改位置')}</div><p>项目代码保留原目录，pi 模型配置沿用现有来源。迁移前先检查任务、写入与目标空间，成功后才切换；失败保留原数据。</p><dl class="policy-list"><dt>旧 pi 历史</dt><dd>首版发现并只读查看。具备并发写入与冲突保护后再开放续聊。</dd><dt>备份</dt><dd>仅升级前自动，其余手动；可选择其他磁盘。不包含模型密钥，保留普通会话和未审查所需快照。</dd></dl><div class="button-row">${button('legacy-history','查看旧历史')}${button('backup-preview','手动备份')}${button('restore-preview','恢复备份')}</div>`;
    if (tab === 'tools') body = `<dl class="policy-list"><dt>默认 Shell</dt><dd>优先使用可用的 PowerShell 7；缺失时提示，并可选择 Windows PowerShell。可在设置更换，对新命令与终端生效，已有进程保持原 Shell。</dd><dt>外部编辑器</dt><dd>优先 VS Code，可选择其他编辑器；目标程序未安装或路径失效时提示处理。</dd></dl><p>打开文件使用校验后的路径和行号。终端输出仍须显式选择后加入对话。</p>`;
    if (tab === 'notifications') body = `<dl class="policy-list"><dt>系统通知</dt><dd>仅工作台在后台时通知需要审批、失败和完成。只显示通用状态，隐藏会话标题、正文与路径。</dd><dt>通知控制</dt><dd>支持关闭全部系统通知或仅保留待决定通知；应用内待办继续显示。点击通知定位会话，不自动批准。</dd><dt>Windows 安装</dt><dd>先提供当前用户安装包，尽量无需管理员；便携版后续提供。</dd><dt>应用更新</dt><dd>手动检查并确认后更新。运行中不自动重启，升级前备份失败时暂停升级。</dd></dl>`;
    modal('设置',`${nav}<section aria-label="${tabs.find(([id])=>id===tab)[1]}设置">${body}</section>`,`${button('reset','重置此设计稿')}${button('close-dialog','完成',true)}`);
    $('dialog').querySelector('[aria-current="page"]').focus({preventScroll:true});
    $('dialog').querySelector('[aria-current="page"]').scrollIntoView({block:'nearest',inline:'nearest'});
  }
  function search() {
    modal('搜索会话',`<label class="sr-only" for="searchInput">搜索标题或消息正文</label><div class="search-input">${icon('search')}<input type="search" id="searchInput" placeholder="搜索标题或消息正文" autocomplete="off"></div><label><span class="sr-only">项目筛选</span><select id="searchProject"><option value="all">全部项目与无项目会话</option><option value="atlas">atlas-console</option><option value="none">仅无项目</option></select></label><div class="search-results" id="searchResults"></div>`);
    filterSearch(); $('searchInput').focus();
  }
  function filterSearch() {
    const q = $('searchInput').value.trim().toLowerCase(), project = $('searchProject').value;
    const result = sessions.filter(s => (!q || `${s.title}\n${s.message}`.toLowerCase().includes(q)) && (project === 'all' || (project === 'none' ? !s.project : s.project === project)));
    const highlighted = value => { const idx = value.toLowerCase().indexOf(q); return !q || idx < 0 ? esc(value) : `${esc(value.slice(0,idx))}<mark>${esc(value.slice(idx,idx + q.length))}</mark>${esc(value.slice(idx + q.length))}`; };
    $('searchResults').innerHTML = result.length ? result.map(s => `<button class="search-result" data-action="search-open" data-id="${esc(s.id)}"><strong>${highlighted(s.title)}</strong><small>${projectName(s.project)}${s.phase === 'approval' ? ' · 待审批' : ''}</small>${q && s.message.toLowerCase().includes(q) ? `<p>${highlighted(s.message)}</p>` : ''}</button>`).join('') : '<div class="search-empty">没有匹配的会话。换个词试试。</div>';
  }
  function send() {
    const text = $('taskInput').value.trim();
    if (!text || composing || blocksSend()) return;
    if (isBusy()) {
      active().queue.push({text,kind:queueKind}); active().draft = ''; persist(); render(); toast(queueKind === 'steer' ? '已加入引导队列，等待当前工具边界。' : '已加入下一轮队列，等待本轮结束。'); return;
    }
    if (isNew()) {
      newDraft.text = text; currentScene = 'creating'; persist(); render(); toast('正在演示保存中状态。使用评审栏“模拟保存完成”推进样本。'); return;
    } else { active().message = text; active().draft = ''; active().phase = 'running'; }
    currentScene = 'running'; stopped = false; active().stopped = false; panel = null; persist(); render(); toast('会话已保存，标题使用本地摘要。此预览不发送模型请求。');
  }
  function completeCreation() {
    const text = newDraft.text.trim();
    if (!text || currentScene !== 'creating') return;
    const id = `draft-${Date.now().toString(36)}`;
    const title = Array.from(text.replace(/(?:sk-|api[_-]?key[=: ]+)\S+/gi,'[已隐藏]').replace(/\s+/g,' ')).slice(0,40).join('');
    sessions.unshift({id,title,project:newDraft.project,cwd:newDraft.project === 'atlas' ? 'D:\\Projects\\atlas-console' : newDraft.project === 'ui' ? 'D:\\Projects\\ui-kit' : `D:\\PiWorkbench\\standalone\\${id}`,phase:'running',draft:'',message:text,files:[],panel:null,queue:[],toolOpen:[],mode:newDraft.mode});
    activeId = id; newDraft = {text:'',project:null,mode:'execute'};
    currentScene = 'running'; panel = null; persist(); render(); toast('已模拟保存成功，使用本地摘要标题。没有发起模型请求。');
  }
  function renderComparison() {
    const url = (value) => `review.html?embed=1&direction=${direction}&theme=${value}&scene=${currentScene}`;
    $('comparison').innerHTML = `<div class="comparison-intro"><span>${direction === 'hybrid' ? '已确认组合' : '方向 '+direction.toUpperCase()} · 相同任务、相同内容、相同 1440 × 900 画布</span><span>缩放仅用于并排比较；打开完整稿可按实际字号体验。</span></div><div class="compare-grid">${[['light','浅色'],['dark','深色']].map(([value,label]) => `<article class="compare-card"><header>${label}<span><button class="link-button" data-action="full-theme" data-value="${value}">打开完整稿</button></span></header><div class="iframe-viewport"><iframe title="${label}方向稿" src="${url(value)}"></iframe></div></article>`).join('')}</div><p class="compare-caption">对比导航层级、消息可读性、输入区焦点、等待审批和新增 / 删除代码的语义。两套主题使用同一组件与布局。</p>`;
    resizeObserver.disconnect(); document.querySelectorAll('.iframe-viewport').forEach(n => resizeObserver.observe(n));
  }
  const resizeObserver = new ResizeObserver(entries => entries.forEach(e => { const frame = e.target.querySelector('iframe'); if (frame) frame.style.transform = `scale(${e.contentRect.width / 1440})`; }));
  function toggleComparison(value = !comparison) {
    comparison = value; $('stage').hidden = comparison; $('comparison').hidden = !comparison;
    document.querySelector('[data-action="compare"]').setAttribute('aria-pressed',comparison);
    if (comparison) renderComparison(); else resizeObserver.disconnect();
  }
  const handlers = {
    direction: target => { rememberDraft(); direction = target.dataset.value; render(); persist(); },
    compare: () => toggleComparison(),
    'full-theme': target => { theme = target.dataset.value; toggleComparison(false); applyTheme(); persist(); },
    guide: () => modal('核心页面评审',`<p>布局已确认：日常用 A，打开变更时采用 B，关闭后回到日常对话。字号基线为界面 14 px、消息 15 px、辅助 12 px。</p><h3>这次重点检查</h3><p>创建、运行、审批、收尾、停止、恢复及回滚冲突是否清楚；使用顶部场景选择器查看状态，使用评审栏的“模拟…”按钮推进需要真实服务确认的样本。</p><h3>已确认的使用规则</h3><p>默认受限读取自动、写文件和命令先审批；关窗到托盘继续，退出应用停受管任务，自启默认关。可在设置查看。</p><h3>开发验收预算</h3><p>日常开发离线；必要真实验收每里程碑最多新增 2 次底层请求、单次输出 512 token、失败不自动重试。本轮新增 0 次；这是开发政策，自动拦截待实现，不是产品日常会话限额。</p><h3>本轮边界</h3><p>消息、模型、命令、目录、文件、测试结果和连接均为本地模拟；未读取凭证或调用提供商。操作只保存到此设计稿的独立浏览器存储，不修改真实文件和需求进度。</p><p>名称 / π 标记暂用。完整设置、并发、长历史、系统权限和 M6–M8 细节继续按需求阶段完善。</p>`,button('close-dialog','继续体验',true)),
    'advance-sample': () => {
      if (currentScene === 'creating') { completeCreation(); return; }
      const next = {queued:'running',running:'settling',settling:'review',stopping:'stopped',retrying:'running',compacting:'review',reconnecting:'review'}[currentScene];
      if (next) { const prior = currentScene; transition(next); toast(prior === 'reconnecting' ? '已模拟同步完成，没有重放命令。' : '已推进本地样本，没有执行真实操作。'); }
    },
    latest: () => { const viewport = $('threadViewport'); if (viewport) viewport.scrollTop = viewport.scrollHeight; },
    nav: () => { navOpen = !navOpen; $('stage').classList.toggle('sidebar-open',navOpen); if (innerWidth > 900) { $('stage').classList.toggle('nav-collapsed'); } },
    new: () => setScene('new'),
    'new-project-session': target => { setScene('new'); newDraft.project = target.dataset.project; render(); persist(); $('taskInput').focus(); },
    'open-session': target => openSession(target.dataset.id),
    search,
    'search-open': target => { closeDialog(); openSession(target.dataset.id); if ($('searchInput')?.value) toast('已打开匹配会话。'); },
    'session-menu': () => modal('会话操作',`<p>${esc(active().title)}</p><div class="button-row">${button('rename','重命名')}${button('move','更改项目归属')}</div>`),
    rename, move: () => chooseProject(true), 'select-project': () => chooseProject(false),
    'save-name': () => { const value = $('renameInput').value.trim(); if (!value || Array.from(value).length > 80 || /[\u0000-\u001f\u007f]/.test(value)) { $('renameError').textContent = '请输入 1–80 个字符，不含控制字符。'; return; } active().title = value; closeDialog(); persist(); render(); toast('会话名称已保存。'); },
    'save-project': () => { newDraft.project = $('dialog').querySelector('input[name="project"]:checked').value || null; closeDialog(); persist(); render(); },
    'move-project': () => { active().project = $('dialog').querySelector('input[name="project"]:checked').value || null; closeDialog(); persist(); render(); toast('会话归属已更改，实际执行目录保持原值。'); },
    projects: () => modal('项目与执行目录',`<p>项目用于整理会话，执行目录用于实际读写。两者分别显示和管理。</p><h3>atlas-console</h3><p><code>D:\\Projects\\atlas-console</code></p><h3>ui-kit</h3><p><code>D:\\Projects\\ui-kit</code></p><p>完整新增 / 移除项目流程在选定方向后的页面组中细化。</p>`,button('close-dialog','关闭')),
    changes: () => { rememberDraft(); panel = panel === 'changes' ? null : 'changes'; render(); },
    files: () => { rememberDraft(); panel = panel === 'files' ? null : 'files'; render(); },
    'close-panel': () => { rememberDraft(); panel = null; render(); document.querySelector('.thread-header [data-action="changes"]')?.focus({preventScroll:true}); },
    'expand-review': () => { rememberDraft(); direction = direction === 'a' ? 'b' : 'a'; render(); persist(); },
    'select-file': target => { selectedFile = Number(target.dataset.index); const view = $('threadViewport'), scroll = view?.scrollTop; rememberDraft(); render(); if (view && $('threadViewport')) $('threadViewport').scrollTop = scroll; },
    accept: () => { active().files[selectedFile] = 'accepted'; rememberDraft(); render(); toast('已记录接受决定，文件内容保持当前版本，未提交。'); },
    revert: () => modal('回滚此文件？',`<p>将 <code>${esc(filePaths[selectedFile])}</code> 恢复到本轮开始前的快照。</p><p>本例快照可用、来源为本轮 Agent，未检测到外部编辑。正式执行前仍须重新检查文件是否变化。</p><p>只影响当前文件；另一文件的审查决定独立保留。</p>`,`${button('close-dialog','取消')}${button('confirm-revert','回滚此文件',true)}`),
    'confirm-revert': () => { active().files[selectedFile] = 'reverted'; closeDialog(); rememberDraft(); render(); toast('已模拟回滚；历史 Diff 记录继续保留。'); },
    'rollback-scope': () => modal('可回滚范围',`<p>当前示例：本轮 Agent 修改，快照可用，当前文件与轮末记录相符。</p><h3>遇到这些情况会停止自动回滚</h3><p>文件已有外部修改、来源混合 / 未知、快照失败，或属于忽略项、大文件、链接和外部路径。需要先检查差异、保留现场，再选择恢复方式。</p><p>命令的网络请求与其他外部副作用无法通过文件快照撤销。此稿不执行文件写入。</p>`,button('close-dialog','知道了',true)),
    'open-file': target => { selectedFile = Number(target.dataset.index); modal(filePaths[selectedFile],`${renderDiff()}<p>文件阅读不自动加入上下文。以下操作会显式添加引用。</p>`,`${button('close-dialog','关闭')}${button('attach-file','加入上下文',true)}`); },
    'attach-file': () => { closeDialog(); toast(`已选择文件引用：${filePaths[selectedFile]}。完整引用编辑在下一轮细化。`); },
    terminal: () => { rememberDraft(); terminal = !terminal; render(); },
    'attach-output': () => { rememberDraft(); contextAttached = true; render(); toast('终端输出已显式加入当前草稿。'); },
    detach: () => { rememberDraft(); contextAttached = false; render(); },
    attach: () => modal('添加上下文',`<p>本轮可体验显式引用终端输出。文件选择、图片与文本引用的完整页面将在选定方向后完善。</p>`,`${button('close-dialog','取消')}${button('attach-output-dialog','引用终端输出',true)}`),
    'attach-output-dialog': () => { closeDialog(); handlers['attach-output'](); },
    allow: () => { active().phase = 'running'; currentScene = 'running'; rememberDraft(); render(); toast('已允许这一次命令；接下来展示模拟执行状态。'); },
    deny: () => { transition('stopped'); toast('已拒绝，命令未执行。不会自动换一种形式重试。'); },
    'cancel-approval': () => { transition('stopped'); toast('审批请求已取消，命令未执行。'); },
    stop: () => { transition('stopping'); toast('正在等待执行系统确认，尚未标为已停止。'); },
    retry: () => { rememberDraft(); stopped = false; active().stopped = false; currentScene = 'running'; active().phase = 'running'; render(); toast('已开始模拟重试，没有发起提供商调用。'); },
    reconnect: () => { transition('reconnecting'); toast('先同步权威状态；使用评审栏推进完成样本。'); },
    'renew-approval': () => transition('approval'),
    'cancel-queued': () => { transition('stopped'); toast('已取消排队，模型任务未启动。'); },
    'cancel-retry': () => { transition('stopped'); toast('已取消重试，没有发起下一次请求。'); },
    'review-stopped': () => { rememberDraft(); panel = 'changes'; render(); },
    'resume-stopped': () => modal('继续此会话？',`<p>此前未执行的动作需要重新裁决。${active().queue.length ? `仍有 ${active().queue.length} 条未送达消息，继续后恢复其等待状态。` : '本次继续不会恢复旧的授权。'}</p>`,`${button('close-dialog','保持停止')}${button('confirm-resume','确认继续',true)}`),
    'confirm-resume': () => { closeDialog(); transition('running'); },
    'original-history': () => modal('原始记录 · 示例',`<p>压缩只改变后续模型上下文，不删除会话原始记录。</p><h3>用户任务</h3><p>${esc(active().message)}</p><h3>本地样本的工具记录</h3><p><code>read src/auth/session.ts</code><br><code>edit src/auth/session.ts</code></p><p>真实分页、摘要内容与前后规模在 MODEL-06 接入后单独验收。</p>`,button('close-dialog','返回')),
    'conflict-detail': () => modal('检查文件冲突',`<p><code>${esc(filePaths[selectedFile])}</code> 在本轮结束后又被外部修改。当前文件不会被覆盖。</p><h3>本轮结束时</h3><pre class="conflict-code">if (redirecting) return;</pre><h3>当前文件中的外部编辑</h3><pre class="conflict-code">if (redirecting || session.isRefreshing) return;</pre><p>先保留现场，再由你决定合并或恢复。这里不提供盲目整轮回滚，也不把历史 Diff 当作当前文件。</p>`,`${button('close-dialog','继续检查')}${button('keep-conflict-dialog','保留当前现场',true)}`),
    'keep-conflict': () => toast('已保留当前现场，没有写入或回滚文件。'),
    'keep-conflict-dialog': () => { closeDialog(); handlers['keep-conflict'](); },
    'retry-snapshot': () => { transition('running'); toast('已模拟重新建立基线，后续写入仍按权限裁决。'); },
    'cancel-snapshot': () => transition('stopped'),
    'snapshot-risk': () => modal('继续本轮的影响',`<p>这次写入没有可靠快照，不能承诺恢复到本轮开始前。忽略项、外部命令副作用也无法靠文件回滚撤销。</p><p>如果不接受这一点，请取消并检查快照失败原因。</p>`,`${button('close-dialog','返回检查')}${button('continue-without-snapshot','本轮接受不可回滚并继续',true)}`),
    'continue-without-snapshot': () => { active().unprotected = true; closeDialog(); transition('running'); toast('已记录本轮不可回滚的模拟决定，尚未执行真实写入。'); },
    'connection-help': () => modal('恢复连接',`<p>断线期间保留草稿、消息和待审批展示，禁止新的执行决定。重连先同步服务状态；结果不确定的命令不会自动重放。</p><p>关闭审批展示不代表允许，旧请求失效后需要重新发起。</p>`,button('close-dialog','关闭')),
    'view-queue': () => modal('等待送达的消息',`${active().queue.map((q,i) => `<h3>${i + 1}. ${q.kind === 'steer' ? '引导当前轮' : '追加下一轮'}</h3><p>${esc(q.text)}</p>`).join('')}<p>当前工具边界交付引导；宿主完成本轮结束检查与快照后才交付下一轮。此预览不会自动执行。</p>`,`${button('clear-queue','清空队列')}${button('close-dialog','关闭',true)}`),
    'clear-queue': () => { active().queue = []; closeDialog(); persist(); render(); toast('待送达消息已移除。'); },
    send,
    'suggest-investigate': () => { $('taskInput').value = '介绍这个项目的结构、启动方式和主要模块。'; newDraft.text = $('taskInput').value; updateSend(); persist(); $('taskInput').focus(); },
    'suggest-fix': () => { $('taskInput').value = '帮我定位并修复一个问题，先说明调查思路。'; newDraft.text = $('taskInput').value; updateSend(); persist(); $('taskInput').focus(); },
    model: () => modal('模型配置',`<p>沿用 pi 现有的唯一提供商和模型。设计稿不读取真实配置与凭证，也不假定具体模型名称。</p><div class="setting-row"><div>当前配置模型<small>模型命名润色默认关闭，标题使用本地摘要。</small></div><span class="pill">沿用 pi</span></div><p>费用受 token、工具循环与提供商定价影响。价格或用量不完整时显示“费用未知”。</p>`,button('close-dialog','关闭',true)),
    usage: () => modal('本轮用量',`<p>上下文占用 24% 是界面布局示例。此页没有调用提供商，不能作为实际 token、价格或账单证据。</p><p>正式产品在价格缺失、错误或中止用量不完整时显示“费用未知”，并区分主任务与可选命名开销。</p>`,button('close-dialog','关闭')),
    settings: () => settings(),
    'settings-page': target => settings(target.dataset.tab),
    'session-grants': () => modal('当前会话授权',`<p>${isNew() ? '新会话草稿尚未创建，没有会话授权。' : `${esc(active().title)}：尚无会话授权。`}</p><p>允许一次不会生成会话授权。显式授权后可在这里查看工具、目录与参数范围，撤销单条或全部；撤销约束后续执行，正在运行的动作需单独停止。</p>`,button('permissions-back','返回权限设置',true)),
    'permissions-back': () => settings('permissions'),
    'approval-policy': () => modal('审批规则',`<p>写文件与命令执行前展示最终参数、实际目录、影响和回滚边界；允许前不执行。显式有限会话授权只在其范围内复用，高危操作始终单次。</p><p>关闭展示或短暂断线继续等待，没有倒计时。取消、参数变化或运行时失效关闭旧请求；重启后不会恢复旧授权。收紧立即限制后续动作，放宽需明确确认。</p>`,button('permissions-back','返回权限设置',true)),
    'tray-preview': () => modal('关闭窗口后',`<h3>工作台收到托盘</h3><p>已有任务继续运行，待审批仍等待你的决定。可从托盘重新打开工作台。</p><p>需要停止所有受管任务时，使用菜单“退出应用”。</p>`,button('window-back','返回窗口设置',true)),
    'exit-preview': () => modal('退出应用的处理流程',`<ol class="exit-steps"><li>保存已收到的记录、草稿与中断信息。</li><li>取消待审批请求和排队，不再启动新任务。</li><li>停止受管 Agent、命令、终端和服务，确认停止后关闭应用。</li></ol><p>无法确认停止时列出未停止对象，保留恢复入口；不显示为已退出。独立服务与其他 CLI 不受影响。再次启动不自动重放副作用。</p>`,button('window-back','返回窗口设置',true)),
    'window-back': () => settings('window'),
    'data-back': () => settings('data'),
    'migration-preview': () => modal('更改数据位置',`<p>当前：<code>%LOCALAPPDATA%\\PiWorkbench</code></p><ol class="exit-steps"><li>选择可写目标，预览空间与迁移影响。</li><li>等待任务空闲，处理待审批与排队，暂停数据写入。</li><li>一致性复制并校验数据库、历史、快照与独立目录，验证管理路径重绑定。</li><li>成功后才切换启动位置；失败继续使用原数据，原件不会自动删除。</li></ol><p>用户项目、外部历史与 pi 模型配置不移动。</p>`,button('data-back','返回数据设置',true)),
    'backup-preview': () => modal('手动备份',`<p>可选择其他磁盘保存。一致性备份工作台数据库、管理的会话历史、快照引用与独立目录必要产物。</p><p>不包含提供商密钥配置、用户项目代码或外部只读历史；备份清单明确不包含项。会话正文仍可能含敏感内容。</p><p>默认只在升级前自动备份，不启用每日备份或自动 7 份轮转。</p>`,button('data-back','返回数据设置',true)),
    'restore-preview': () => modal('恢复备份',`<p>先检查版本、完整性与关联关系，预览将替换的数据，并保护当前数据后再恢复。失败保持原数据可用。</p><p>不覆盖项目代码，不恢复旧授权，也不自动执行中断任务。未审查所需快照不会静默丢弃。</p>`,button('data-back','返回数据设置',true)),
    'legacy-history': () => modal('旧 pi 历史 · 只读',`<p>来源：已有 pi 会话文件；原执行目录继续保留。当前只读查看，不启动运行时或修改源文件。</p><h3>梳理项目启动流程</h3><div class="setting-row"><div>用户<small>介绍项目的启动步骤。</small></div><span class="pill">只读</span></div><p>Pi：先核对依赖和启动命令，再检查配置项。</p><p>源文件变化后重新检查读取版本；不完整末行等待刷新。后续具备 CLI 并发写入、锁与版本冲突保护后再开放续聊。</p>`,`${button('close-dialog','关闭')}${button('legacy-send','后续支持续聊',false,'disabled')}`),
    reset: () => modal('重置设计稿？','<p>清除本页模拟会话、改名、草稿、审查决定和外观偏好。不会影响 PRD、需求进度或真实 pi 数据。</p>',`${button('close-dialog','取消')}${button('confirm-reset','重置',true)}`),
    'confirm-reset': () => { try { localStorage.removeItem(sessionKey); localStorage.removeItem(`${sessionKey}-draft`); localStorage.removeItem(preferenceKey); } catch {} location.reload(); },
    copy: async () => { try { await navigator.clipboard.writeText('已修复重复跳转并补充测试。此为设计稿模拟回复。'); toast('回复已复制。'); } catch { toast('浏览器不允许复制，请选择正文手动复制。'); } },
    'turn-detail': () => modal('本轮信息',`<p>运行结果、审查进度与文件适用性分别记录。收到模型结束事件后，还要等队列、工具与快照收尾才能确认轮次完成。</p><p>当前所有状态是可切换的设计样本，真实事件对接与故障恢复仍按 CORE / OBS 等功能验收。</p>`,button('close-dialog','关闭')),
    'close-dialog': closeDialog,
  };
  function updateSend() { $('sendButton').disabled = !$('taskInput').value.trim() || blocksSend(); }
  document.addEventListener('click',event => { const target = event.target.closest('[data-action]'); if (target && !target.disabled) handlers[target.dataset.action]?.(target); });
  document.addEventListener('input',event => {
    if (event.target.id === 'taskInput') { if (isNew()) newDraft.text = event.target.value; else active().draft = event.target.value; updateSend(); persist(); }
    if (event.target.id === 'searchInput') filterSearch();
  });
  document.addEventListener('change',event => {
    if (event.target.id === 'sceneSelect') setScene(event.target.value);
    if (['themeSelect','settingsTheme'].includes(event.target.id)) { theme = event.target.value; applyTheme(); persist(); }
    if (event.target.id === 'searchProject') filterSearch();
    if (event.target.id === 'modeSelect') { if (isNew()) newDraft.mode = event.target.value; else active().mode = event.target.value; persist(); toast(event.target.value === 'discuss' ? '讨论模式：不执行工具。' : '执行模式：工具仍按权限规则裁决。'); }
    if (event.target.id === 'queueSelect') queueKind = event.target.value;
  });
  document.addEventListener('compositionstart',() => composing = true);
  document.addEventListener('compositionend',() => composing = false);
  document.addEventListener('keydown',event => {
    if (composing || event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && event.target.id === 'renameInput') { event.preventDefault(); handlers['save-name'](); return; }
    if (event.key === 'Enter' && event.target.id === 'taskInput' && !event.shiftKey) { event.preventDefault(); send(); return; }
    if ($('dialog').open) {
      if (event.target.id === 'searchInput' && ['ArrowDown','Enter'].includes(event.key)) { event.preventDefault(); const result = $('searchResults').querySelector('button'); event.key === 'Enter' ? result?.click() : result?.focus(); }
      if (event.target.classList.contains('search-result') && ['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault(); (event.key === 'ArrowDown' ? event.target.nextElementSibling : event.target.previousElementSibling || $('searchInput'))?.focus(); }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); search(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); setScene('new'); }
    else if (event.ctrlKey && event.code === 'Backquote') { event.preventDefault(); handlers.terminal(); }
    else if (event.key === 'Escape') { if (navOpen) { navOpen = false; $('stage').classList.remove('sidebar-open'); } else if (panel) handlers['close-panel'](); }
  });
  $('dialog').addEventListener('cancel',event => { event.preventDefault(); closeDialog(); });
  window.addEventListener('beforeunload',rememberDraft);
  if (['creating','create-failed'].includes(currentScene) && !newDraft.text.trim()) newDraft.text = '修复登录过期后重复跳转的问题，并补充测试。';
  if (params.has('scene')) delete active().view;
  active().phase = isNew() ? active().phase : currentScene;
  stopped = currentScene === 'stopped';
  const chromeObserver = new ResizeObserver(() => {
    const viewport = $('threadViewport');
    const following = viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 36;
    const height = document.querySelector('.review-bar').getBoundingClientRect().height + document.querySelector('.review-note').getBoundingClientRect().height;
    document.documentElement.style.setProperty('--review-chrome',`${height}px`);
    if (following) requestAnimationFrame(() => { if (viewport === $('threadViewport')) viewport.scrollTop = viewport.scrollHeight; });
  });
  document.querySelectorAll('.review-bar,.review-note').forEach(n => chromeObserver.observe(n));
  render();
})();
