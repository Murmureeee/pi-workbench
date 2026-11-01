const baseline = JSON.parse(document.getElementById('backlog-data').textContent);
const storageKey = 'pi-workbench-roadmap-progress-v1';
const byId = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const moduleOf = id => baseline.modules.find(item => item.id === id);
const stageOf = id => baseline.milestones.find(item => item.id === id);
let data = cloneData(baseline);
let storageAvailable = true;
let storedProblem = null;
let otherTabChanged = false;
let selectedFeature = null;
let detailDirty = false;
let lastTriggerId = null;
let toastTimer;
const filters = { module: '', milestone: '', status: '', priority: '', definition: '', search: '', page: 1 };
const pageSize = 25;

try {
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    try {
      const incoming = JSON.parse(saved);
      if (incoming.revision !== baseline.revision) throw new Error('项目基线已更新，请先导出旧副本，再对照当前基线导入需要保留的进度。');
      data = mergeProgress(baseline, incoming);
    }
    catch (error) { storedProblem = { raw: saved, message: error.message }; storageAvailable = false; }
  }
} catch { storageAvailable = false; }

function notify(message) {
  byId('toast').textContent = message;
  byId('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { byId('toast').hidden = true; }, 6000);
}

function progressPayload(current) {
  return { schemaVersion: current.schemaVersion, product: current.product, baselineDate: current.baselineDate, revision: baseline.revision, features: current.features.map(feature => ({ id: feature.id, acceptance: feature.acceptance, progress: feature.progress })) };
}

function persist(next, retryStorage = false) {
  if (otherTabChanged) throw new Error('另一个页面已更新本地进度。请先导出当前副本，再刷新对照，避免覆盖其他页面的修改。');
  if (retryStorage && storedProblem) downloadJson(storedProblem.raw, 'pi-workbench-unloaded-progress.json');
  let saved = false;
  if (storageAvailable || retryStorage) {
    try { localStorage.setItem(storageKey, JSON.stringify(progressPayload(next))); saved = true; storageAvailable = true; storedProblem = null; }
    catch { storageAvailable = false; }
  }
  data = next;
  renderAll();
  return saved;
}

function downloadJson(value, name) {
  const blob = new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderSummary() {
  const stats = summarize(data);
  byId('progressCount').textContent = `${stats.verified} / ${stats.core}`;
  byId('progressPercent').textContent = `${stats.percent}%`;
  byId('progressFill').style.width = `${stats.percent}%`;
  byId('globalProgress').setAttribute('aria-valuenow', String(stats.percent));
  byId('summaryMeta').innerHTML = `<span><strong>${stats.total}</strong>全量功能</span><span><strong>${stats.active}</strong>进行中</span><span><strong>${stats.blocked}</strong>受阻</span><span><strong>${stats.optional}</strong>可选扩展</span>`;
  byId('baselineTitle').textContent = `范围基线 ${data.baselineDate} · ${data.modules.length} 个模块 · M0–M8`;
  byId('baselineText').textContent = `已有详细设计 ${stats.detailed} 项，仍需对应校正与验证。${baseline.progressBasis}`;
  const note = byId('storageNote');
  note.classList.toggle('warning', !storageAvailable || otherTabChanged);
  if (otherTabChanged) note.textContent = '另一个页面已更新本地进度。请先导出当前副本，再刷新对照。';
  else if (storedProblem) note.innerHTML = `旧进度与当前基线不匹配，未自动载入。当前修改只保存在内存。<button type="button" id="downloadOldCopy">导出未加载的旧副本</button>`;
  else note.textContent = storageAvailable ? '进度修改保存于当前浏览器；导出最新总表后可回写项目 JSON。' : '当前环境无法使用浏览器存储；修改保存在本页内存，请在关闭页面前导出 JSON。';
}

function renderModules() {
  const counts = new Map(data.modules.map(module => [module.id, data.features.filter(feature => feature.module === module.id).length]));
  byId('modules').innerHTML = `<button type="button" class="module" data-module="" aria-pressed="${!filters.module}"><span>全部功能</span><span class="count">${data.features.length}</span></button>` + data.modules.map(module => `<button type="button" class="module" data-module="${module.id}" aria-pressed="${filters.module === module.id}"><span>${escapeHtml(module.name)}</span><span class="count">${counts.get(module.id)}</span></button>`).join('');
  byId('stageStrip').innerHTML = `<button type="button" class="stage-chip" data-stage="" aria-pressed="${!filters.milestone}">全部阶段</button><button type="button" class="stage-chip" data-stage="LOCAL" aria-pressed="${filters.milestone === 'LOCAL'}">本地完整版</button>` + data.milestones.map(stage => {
    const items = data.features.filter(feature => feature.milestone === stage.id);
    return `<button type="button" class="stage-chip" data-stage="${stage.id}" aria-pressed="${filters.milestone === stage.id}" title="${escapeHtml(stage.name)}">${stage.id}<span>${items.filter(feature => feature.progress.status === 'verified').length}/${items.length}</span></button>`;
  }).join('');
}

function visibleFeatures() {
  const query = filters.search.trim().toLocaleLowerCase();
  return data.features.filter(feature => (!filters.module || feature.module === filters.module)
    && (!filters.milestone || (filters.milestone === 'LOCAL' ? feature.milestone !== 'M8' : feature.milestone === filters.milestone))
    && (!filters.status || feature.progress.status === filters.status)
    && (!filters.priority || feature.priority === filters.priority)
    && (!filters.definition || feature.definition === filters.definition)
    && (!query || [feature.id, feature.title, feature.summary, moduleOf(feature.module).name, ...feature.acceptance, ...feature.dependsOn].join(' ').toLocaleLowerCase().includes(query)))
    .sort((left, right) => left.milestone.localeCompare(right.milestone) || data.modules.findIndex(module => module.id === left.module) - data.modules.findIndex(module => module.id === right.module) || left.id.localeCompare(right.id));
}

function renderFeatures() {
  const items = visibleFeatures();
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  filters.page = Math.min(filters.page, pages);
  const shown = items.slice((filters.page - 1) * pageSize, filters.page * pageSize);
  byId('featureRows').innerHTML = shown.map(feature => {
    const completeDependencies = feature.dependsOn.filter(id => data.features.find(item => item.id === id).progress.status === 'verified').length;
    const dependencyLabel = feature.dependsOn.length ? `${completeDependencies}/${feature.dependsOn.length} 已验收` : '无前置依赖';
    return `<tr><td class="namecell"><div class="id-cell">${feature.id} · ${escapeHtml(moduleOf(feature.module).name)}</div><button type="button" class="name-button" data-feature="${feature.id}" id="row-${feature.id}">${escapeHtml(feature.title)}</button><p class="row-summary">${escapeHtml(feature.summary)}</p></td><td><span class="mono">${feature.milestone}</span><div class="definition">${escapeHtml(stageOf(feature.milestone).name)}</div></td><td><span class="priority">${feature.priority}</span></td><td><span class="tag ${feature.progress.status}">${escapeHtml(data.statuses[feature.progress.status])}</span><div class="definition">${feature.definition === 'detailed' ? '已有详细设计' : '待进一步细化'}</div></td><td><span class="faint">${dependencyLabel}</span><div class="definition">${escapeHtml(feature.progress.owner || '负责人未分配')}</div></td></tr>`;
  }).join('');
  byId('emptyState').hidden = items.length !== 0;
  byId('resultCount').textContent = `显示 ${items.length} / ${data.features.length} 项${filters.module ? ` · ${moduleOf(filters.module).name}` : ''}${filters.milestone ? ` · ${filters.milestone === 'LOCAL' ? '本地完整版 M0–M7' : filters.milestone + ' ' + stageOf(filters.milestone).name}` : ''}`;
  byId('pageInfo').textContent = `第 ${filters.page} / ${pages} 页`;
  byId('previousPage').disabled = filters.page <= 1;
  byId('nextPage').disabled = filters.page >= pages;
}

function renderStages() {
  byId('view-stages').innerHTML = `<h2>按可验证结果推进</h2><p class="document-intro">每个阶段同时交付必要的服务、界面和验证能力。阶段进度按条目验收计算，跨功能验收门另需真实验证记录。M8 单独立项，不阻塞本地完整版。</p>` + data.milestones.map(stage => {
    const features = data.features.filter(feature => feature.milestone === stage.id);
    const done = features.filter(feature => feature.progress.status === 'verified').length;
    return `<article class="milestone"><div><div class="milestone-id">${stage.id}${stage.id === 'M8' ? ' · 可选' : ''}</div><h3>${escapeHtml(stage.name)}</h3><small>${done} / ${features.length} 项已验收</small><div class="bar"><i style="width:${Math.round(done / features.length * 100)}%"></i></div><small>${stage.dependsOn.length ? '前置：' + stage.dependsOn.join('、') : '建议从这里开始'}</small></div><div><p>${escapeHtml(stage.outcome)}</p><ul>${stage.gates.map(gate => `<li>${escapeHtml(gate)}</li>`).join('')}</ul><small>${done === features.length ? '条目已全部验收，发布前仍需核对以上阶段门。' : '阶段门尚待验收。条目证据与发布验收应分别保留。'}</small><br><button type="button" data-stage-jump="${stage.id}">查看本阶段 ${features.length} 项功能</button></div></article>`;
  }).join('');
}

function renderDecisions() {
  byId('view-decisions').innerHTML = `<h2>统一产品规则</h2><p class="document-intro">以下决定用于协调旧 PRD、技术草案与全量目标。细化相关功能时回填原文档。候选默认值用于开始验证，达到决定里程碑前应通过真实样本确认。</p>` + data.decisions.map(decision => `<article class="decision"><span class="mono faint">${decision.id}</span><div><h3>${escapeHtml(decision.title)}</h3><p>${escapeHtml(decision.text)}</p></div></article>`).join('') + `<p><a href="../architecture/implementation-plan.md">实施路线、技术栈、UI 时点与 M1 工作包</a></p><h2 style="margin-top:32px">决定与验证状态</h2>` + data.questions.map(question => `<article class="question"><h3><span class="mono faint">${question.id}</span> ${escapeHtml(question.title)} <span class="tag">${({resolved:"已验证（M0）",decided:"方案已定，待验证",open:"待细化 / 验证"})[question.status]||"待细化 / 验证"}</span> <span class="tag">${question.decideBy}</span></h3><p>${question.status === "open" ? "候选默认" : "决定"}：${escapeHtml(question.defaultDecision)}</p>${question.evidence ? `<p>已有证据：${escapeHtml(question.evidence)}</p>` : ""}<p>验证方式：${escapeHtml(question.method)} 负责人：${escapeHtml(question.owner)}。</p></article>`).join('');
}

function renderGuide() {
  byId('view-guide').innerHTML = `<h2>让进度对应实际证据</h2><p class="document-intro">${escapeHtml(data.progressBasis)} 完整范围已经列出，后续可按阶段继续拆成实施任务。</p><h3>完成率怎么算</h3><p>${escapeHtml(data.completionRule)} 设计状态单独记录，已有详细设计仍需校正；条目大小不同，不能将条目完成率用于推算日期。</p><h3>如何更新</h3><ol><li>按阶段和模块找到功能，打开详情填写负责人、状态、进展与证据。</li><li>实现通过验证后勾选验收项。只有全部验收通过、有证据且前置依赖已验收，才能保存为“已验收”。</li><li>页面内修改保存于本浏览器。导出最新总表携带到其他浏览器，或回写项目数据源。</li></ol><p>浏览器副本不会自动改写项目文件，也不跨设备同步。导入只采用既有功能的进度字段；验收定义已变化的副本需要重新核对。</p><pre><code>node scripts/planning/build-roadmap.mjs --import "导出的 JSON 文件路径"</code></pre><p>直接编辑 <code>docs/product/backlog.json</code> 后，运行 <code>pnpm docs:build</code> 重新生成看板、功能清单与 PRD，再用 <code>pnpm docs:check</code> 校验。不要手工修改生成的 HTML。</p><h3>建议的下一步</h3><p>M0 的 CORE-01–03 已通过阶段门，M1 OPS-01 工程与基础 UI 壳也已验收。下一步做 CORE-04 会话内核及 OPS-08 契约门禁；实施路线已定，见实施方案。每组实现后更新验收与证据，不以设计计完成。</p><h3>能力来源</h3><p>pi 提供的接口仍需集成；工作台自行实现的能力不因有原型而算完成；扩展和 M8 候选需要额外验证。类似 Codex 指能力与工作流参照，不承诺模型、云服务和账号权益相同。</p><h3>查阅资料 · ${data.baselineDate}</h3>` + data.sources.map(source => `<div class="source">${source.url && /^https:\/\//.test(source.url) ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a>` : `<strong>${escapeHtml(source.title)}</strong>`}${source.path ? `<p class="path">${escapeHtml(source.path)}</p>` : ''}<p>${escapeHtml(source.scope)}</p></div>`).join('');
}

function renderAll() { renderSummary(); renderModules(); renderFeatures(); renderStages(); renderDecisions(); renderGuide(); }

function showView(view, focus = false) {
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === view;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    if (active && focus) button.focus();
  });
  for (const id of ['features', 'stages', 'decisions', 'guide']) byId(`view-${id}`).hidden = id !== view;
}

function showStage(id) {
  Object.assign(filters, { module: '', milestone: id, status: '', priority: '', definition: '', search: '', page: 1 });
  byId('search').value = '';
  for (const id of ['statusFilter', 'priorityFilter', 'definitionFilter']) byId(id).value = '';
  renderModules(); renderFeatures(); showView('features', true);
}

function openFeature(id) {
  if (detailDirty && byId('detailDialog').open) { byId('detailError').textContent = '请先保存当前进度，或关闭详情放弃本次编辑，再查看其他功能。'; return; }
  const feature = data.features.find(item => item.id === id);
  if (!feature) { notify('没有找到该功能编号。'); return; }
  selectedFeature = id;
  lastTriggerId = id;
  detailDirty = false;
  byId('detailId').textContent = `${feature.id} · ${moduleOf(feature.module).name}`;
  byId('detailTitle').textContent = feature.title;
  const statusOptions = Object.entries(data.statuses).map(([value, label]) => `<option value="${value}" ${feature.progress.status === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
  const sourceLinks = feature.sources.map(id => data.sources.find(source => source.id === id)).filter(Boolean).map(source => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a>`).join(' · ');
  byId('detailContent').innerHTML = `<p>${escapeHtml(feature.summary)}</p><div class="detail-facts"><span class="tag">${feature.milestone} ${escapeHtml(stageOf(feature.milestone).name)}</span><span class="tag">${feature.priority}</span><span class="tag">${escapeHtml(data.definitionStatuses[feature.definition])}</span></div><p>实现来源：${escapeHtml(data.supportLabels[feature.support])}</p><section class="detail-section"><h3>前置依赖</h3>${feature.dependsOn.length ? feature.dependsOn.map(id => { const item = data.features.find(other => other.id === id); return `<button type="button" class="dependency ${item.progress.status === 'verified' ? 'done' : ''}" data-dependency="${id}" title="${escapeHtml(item.title)}">${id} · ${escapeHtml(data.statuses[item.progress.status])}</button>`; }).join('') : '<small>无前置依赖，可以从本项开始。</small>'}</section><section class="detail-section"><h3>验收项</h3>${feature.acceptance.map((criterion, index) => `<label class="criterion"><input type="checkbox" name="criterion" value="${index}" ${feature.progress.acceptanceChecked[index] ? 'checked' : ''}><span>${escapeHtml(criterion)}</span></label>`).join('')}</section><div class="detail-form"><div class="field-row"><label class="field" for="detailStatus">实现状态<select id="detailStatus">${statusOptions}</select></label><label class="field" for="detailOwner">负责人<input id="detailOwner" maxlength="120" value="${escapeHtml(feature.progress.owner)}" placeholder="未分配"></label><label class="field" for="detailDate">目标日期<input type="date" id="detailDate" value="${escapeHtml(feature.progress.targetDate)}"></label></div><label class="field" for="detailNote">进展或阻塞说明<textarea id="detailNote" maxlength="20000" placeholder="记录已经做了什么、当前限制和下一步。受阻或暂缓时必须填写。">${escapeHtml(feature.progress.note)}</textarea></label><label class="field" for="detailEvidence">实现与验证证据<textarea id="detailEvidence" maxlength="20000" placeholder="代码位置、提交、实际测试命令与结果，或可复现演示记录。">${escapeHtml(feature.progress.evidence)}</textarea><span class="help">待验收填写候选实现；已验收填写实际验证结果。本文档、SDK 安装或口头完成声明不算产品实现证据。</span></label><div id="detailError" class="form-error" role="alert"></div></div>${feature.legacy ? `<p><a href="prd.html#${feature.legacy}" target="_blank" rel="noopener">查看已有核心交互章节</a> · 旧章节与全量产品决定冲突时按新决定细化。</p>` : ''}${sourceLinks ? `<p>能力参考：${sourceLinks}</p>` : ''}<small>最近更新：${feature.progress.updatedAt ? escapeHtml(new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(feature.progress.updatedAt))) : '尚无实现进度更新'}；未估算的日期保持为空。</small>`;
  if (!byId('detailDialog').open) byId('detailDialog').showModal();
  byId('detailDialog').scrollTop = 0;
  history.replaceState(null, '', `${location.pathname}${location.search}#feature=${id}`);
}

function finishDetailClose() {
  if (byId('detailDialog').open) return;
  selectedFeature = null; detailDirty = false;
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  const trigger = byId(`row-${lastTriggerId}`);
  if (trigger) trigger.focus();
}

function closeDetail() {
  byId('detailDialog').close();
  finishDetailClose();
}

byId('detailDialog').addEventListener('close', finishDetailClose);
byId('detailDialog').addEventListener('cancel', event => {
  event.preventDefault();
  closeDetail();
});
byId('detailForm').addEventListener('input', () => { detailDirty = true; });
byId('detailForm').addEventListener('change', () => { detailDirty = true; });
byId('detailForm').addEventListener('submit', event => {
  event.preventDefault();
  const feature = data.features.find(item => item.id === selectedFeature);
  if (!feature) return;
  const next = cloneData(data);
  const target = next.features.find(item => item.id === feature.id);
  target.progress = { status: byId('detailStatus').value, owner: byId('detailOwner').value.trim(), targetDate: byId('detailDate').value, note: byId('detailNote').value.trim(), evidence: byId('detailEvidence').value.trim(), acceptanceChecked: Array.from(document.querySelectorAll('input[name="criterion"]'), input => input.checked), updatedAt: new Date().toISOString() };
  const errors = validateData(next);
  if (errors.length) { byId('detailError').textContent = errors.join('\n'); return; }
  try {
    const saved = persist(next);
    detailDirty = false;
    closeDetail();
    notify(saved ? `${feature.id} 进度已保存到本浏览器。导出后可回写项目。` : `${feature.id} 进度已暂存在本页内存，请导出 JSON 后再关闭。`);
  } catch (error) { byId('detailError').textContent = error.message; }
});

byId('closeDetail').addEventListener('click', closeDetail);
byId('detailContent').addEventListener('click', event => {
  const button = event.target.closest('[data-dependency]');
  if (button) openFeature(button.dataset.dependency);
});
byId('featureRows').addEventListener('click', event => {
  const button = event.target.closest('[data-feature]');
  if (button) openFeature(button.dataset.feature);
});
byId('modules').addEventListener('click', event => {
  const button = event.target.closest('[data-module]');
  if (!button) return;
  filters.module = button.dataset.module; filters.page = 1; renderModules(); renderFeatures();
  document.querySelector(`[data-module="${filters.module}"]`)?.focus();
});
byId('stageStrip').addEventListener('click', event => {
  const button = event.target.closest('[data-stage]');
  if (!button) return;
  filters.milestone = button.dataset.stage; filters.page = 1; renderModules(); renderFeatures();
  document.querySelector(`[data-stage="${filters.milestone}"]`)?.focus();
});
byId('search').addEventListener('input', event => { filters.search = event.target.value; filters.page = 1; renderFeatures(); });
for (const [element, key] of [['statusFilter', 'status'], ['priorityFilter', 'priority'], ['definitionFilter', 'definition']]) byId(element).addEventListener('change', event => { filters[key] = event.target.value; filters.page = 1; renderFeatures(); });
byId('clearFilters').addEventListener('click', () => showStage(''));
byId('previousPage').addEventListener('click', () => { filters.page--; renderFeatures(); });
byId('nextPage').addEventListener('click', () => { filters.page++; renderFeatures(); });
document.querySelector('.tabs').addEventListener('click', event => { const button = event.target.closest('[data-view]'); if (button) showView(button.dataset.view); });
document.querySelector('.tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const buttons = Array.from(document.querySelectorAll('[data-view]'));
  const index = buttons.findIndex(button => button === document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  showView(buttons[next].dataset.view, true);
});
byId('view-stages').addEventListener('click', event => { const button = event.target.closest('[data-stage-jump]'); if (button) showStage(button.dataset.stageJump); });
byId('storageNote').addEventListener('click', event => { if (event.target.id === 'downloadOldCopy' && storedProblem) downloadJson(storedProblem.raw, 'pi-workbench-unloaded-progress.json'); });
byId('exportButton').addEventListener('click', () => {
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  downloadJson({ ...data, exportedAt: new Date().toISOString() }, `pi-workbench-progress-${date}.json`);
  notify('最新总表已导出。要更新项目基线，请用生成器导入该 JSON。');
});
byId('importButton').addEventListener('click', () => byId('importInput').click());
byId('importInput').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('文件超过 5 MB，请确认选择的是本看板导出的 JSON。');
    const next = mergeProgress(data, JSON.parse(await file.text()));
    const saved = persist(next, true);
    notify(saved ? '进度已校验并导入本浏览器。项目源文件仍需用生成器回写。' : '进度已校验并载入内存；当前存储不可用，请导出保留。');
  } catch (error) { notify(`导入未应用，已有进度保持不变。\n${error.message}`); }
  event.target.value = '';
});
window.addEventListener('storage', event => {
  if (event.key !== storageKey) return;
  otherTabChanged = true; renderSummary(); notify('另一个页面更新了进度。请先导出本页副本，再刷新对照。');
});
window.addEventListener('hashchange', () => {
  const id = new URLSearchParams(location.hash.slice(1)).get('feature');
  if (id) openFeature(id);
});
byId('statusFilter').insertAdjacentHTML('beforeend', Object.entries(data.statuses).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join(''));
renderAll();
const initialFeature = new URLSearchParams(location.hash.slice(1)).get('feature');
if (initialFeature) openFeature(initialFeature);
