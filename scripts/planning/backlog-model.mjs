export function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

export function validateProgress(progress, feature, data) {
  const errors = [];
  const prefix = feature.id;
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return [`${prefix}: 进度必须为对象`];
  if (!Object.hasOwn(data.statuses, progress.status)) errors.push(`${prefix}: 未知实现状态`);
  for (const key of ['owner', 'targetDate', 'note', 'evidence']) {
    if (typeof progress[key] !== 'string' || progress[key].length > 20000) errors.push(`${prefix}: ${key} 必须为不超过 20000 字符的文本`);
  }
  if (typeof progress.targetDate === 'string' && progress.targetDate && (!/^\d{4}-\d{2}-\d{2}$/.test(progress.targetDate) || Number.isNaN(Date.parse(progress.targetDate)) || new Date(progress.targetDate).toISOString().slice(0, 10) !== progress.targetDate)) errors.push(`${prefix}: 目标日期无效`);
  if (!Array.isArray(progress.acceptanceChecked) || progress.acceptanceChecked.length !== feature.acceptance.length || progress.acceptanceChecked.some(value => typeof value !== 'boolean')) errors.push(`${prefix}: 验收勾选与当前验收项不匹配`);
  if (progress.updatedAt !== null && (typeof progress.updatedAt !== 'string' || Number.isNaN(Date.parse(progress.updatedAt)))) errors.push(`${prefix}: 更新时间无效`);
  if (['blocked', 'deferred'].includes(progress.status) && !String(progress.note || '').trim()) errors.push(`${prefix}: 受阻或暂缓必须填写原因`);
  if (['in_review', 'verified'].includes(progress.status) && !String(progress.evidence || '').trim()) errors.push(`${prefix}: 待验收或已验收必须记录候选实现或验证证据`);
  if (progress.status === 'verified') {
    if (!Array.isArray(progress.acceptanceChecked) || !progress.acceptanceChecked.length || !progress.acceptanceChecked.every(value => value === true)) errors.push(`${prefix}: 标记已验收前必须逐项确认验收通过`);
    const unmet = feature.dependsOn.filter(id => data.features.find(item => item.id === id)?.progress.status !== 'verified');
    if (unmet.length) errors.push(`${prefix}: 前置功能尚未验收：${unmet.join('、')}`);
  }
  return errors;
}

export function validateData(data) {
  const errors = [];
  if (!data || data.schemaVersion !== 1 || data.product !== 'Pi Workbench') return ['数据版本或产品不匹配'];
  if (!Array.isArray(data.features) || !data.features.length || !Array.isArray(data.modules) || !Array.isArray(data.milestones) || !data.statuses) return ['缺少功能、模块、阶段或状态定义'];
  const moduleIds = new Set(data.modules.map(item => item.id));
  const milestoneIds = new Set(data.milestones.map(item => item.id));
  if (moduleIds.size !== data.modules.length || milestoneIds.size !== data.milestones.length) errors.push('模块或阶段 ID 重复');
  const ids = new Set();
  for (const feature of data.features) {
    if (!feature || typeof feature.id !== 'string' || !/^[A-Z]+-\d{2}$/.test(feature.id)) { errors.push('功能 ID 格式无效'); continue; }
    if (ids.has(feature.id)) errors.push(`${feature.id}: ID 重复`);
    ids.add(feature.id);
    if (!moduleIds.has(feature.module) || !milestoneIds.has(feature.milestone)) errors.push(`${feature.id}: 模块或阶段不存在`);
    if (!['P0', 'P1', 'P2'].includes(feature.priority)) errors.push(`${feature.id}: 优先级无效`);
    if (!Object.hasOwn(data.definitionStatuses, feature.definition) || !Object.hasOwn(data.supportLabels, feature.support)) errors.push(`${feature.id}: 设计或能力来源无效`);
    if (typeof feature.title !== 'string' || !feature.title.trim() || typeof feature.summary !== 'string' || !feature.summary.trim()) errors.push(`${feature.id}: 缺少名称或范围`);
    if (!Array.isArray(feature.acceptance) || feature.acceptance.length < 2 || feature.acceptance.some(item => typeof item !== 'string' || !item.trim())) errors.push(`${feature.id}: 至少需要两项有效验收条件`);
    if (!Array.isArray(feature.dependsOn) || new Set(feature.dependsOn).size !== feature.dependsOn.length) errors.push(`${feature.id}: 依赖必须是无重复的数组`);
  }
  if (errors.length) return errors;
  const featureById = new Map(data.features.map(item => [item.id, item]));
  for (const feature of data.features) {
    for (const id of feature.dependsOn) {
      if (!featureById.has(id)) errors.push(`${feature.id}: 前置功能不存在：${id}`);
      else if (data.milestones.findIndex(item => item.id === featureById.get(id).milestone) > data.milestones.findIndex(item => item.id === feature.milestone)) errors.push(`${feature.id}: 依赖位于更晚阶段：${id}`);
    }
  }
  const visited = new Set();
  const active = new Set();
  function visit(id, path) {
    if (active.has(id)) { errors.push(`循环依赖：${[...path, id].join(' → ')}`); return; }
    if (visited.has(id) || !featureById.has(id)) return;
    active.add(id);
    for (const dependency of featureById.get(id).dependsOn) visit(dependency, [...path, id]);
    active.delete(id);
    visited.add(id);
  }
  for (const feature of data.features) visit(feature.id, []);
  for (const feature of data.features) errors.push(...validateProgress(feature.progress, feature, data));
  return errors;
}

export function mergeProgress(data, incoming) {
  if (!incoming || incoming.schemaVersion !== 1 || incoming.product !== data.product || !Array.isArray(incoming.features) || !incoming.features.length) throw new Error('请选择本看板导出的有效 JSON，产品、版本或进度列表不匹配。');
  const next = cloneData(data);
  const ids = new Set();
  for (const item of incoming.features) {
    if (!item || typeof item.id !== 'string' || ids.has(item.id)) throw new Error('导入包含无效或重复的功能 ID。');
    ids.add(item.id);
    const target = next.features.find(feature => feature.id === item.id);
    if (!target) throw new Error(`导入包含当前基线不存在的功能：${item.id}`);
    if (!item.progress || typeof item.progress !== 'object') throw new Error(`${item.id}: 缺少进度字段`);
    if (item.acceptance && JSON.stringify(item.acceptance) !== JSON.stringify(target.acceptance)) throw new Error(`${item.id}: 验收定义已变化，请对照新基线重新确认`);
    const progress = {};
    for (const key of ['status', 'owner', 'targetDate', 'note', 'evidence', 'acceptanceChecked', 'updatedAt']) progress[key] = item.progress[key];
    target.progress = progress;
  }
  const errors = validateData(next);
  if (errors.length) throw new Error(errors.slice(0, 8).join('\n'));
  return next;
}

export function summarize(data) {
  const core = data.features.filter(feature => feature.milestone !== 'M8');
  const verified = core.filter(feature => feature.progress.status === 'verified').length;
  return { total: data.features.length, core: core.length, optional: data.features.length - core.length, verified, percent: Math.round(verified / core.length * 100), active: core.filter(feature => feature.progress.status === 'in_progress').length, blocked: core.filter(feature => feature.progress.status === 'blocked').length, detailed: data.features.filter(feature => feature.definition === 'detailed').length };
}
