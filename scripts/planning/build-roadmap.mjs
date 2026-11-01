import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateData, mergeProgress, summarize } from './backlog-model.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../..');
const dataPath = join(root, 'docs/product/backlog.json');
let data = JSON.parse(readFileSync(dataPath, 'utf8'));
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === '--import')) throw new Error('用法：node scripts/planning/build-roadmap.mjs [--import <JSON 路径>]');
const errors = validateData(data);
if (errors.length) throw new Error(errors.join('\n'));
if (args[0] === '--import') data = mergeProgress(data, JSON.parse(readFileSync(resolve(args[1]), 'utf8')));
const serialized = JSON.stringify(data, null, 2) + '\n';
const revision = createHash('sha256').update(serialized).digest('hex').slice(0, 12);
const embedded = JSON.stringify({ ...data, revision }).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
const modelCode = readFileSync(join(directory, 'backlog-model.mjs'), 'utf8').replace(/^export /gm, '');
const appCode = readFileSync(join(directory, 'assets/roadmap-app.js'), 'utf8');
if (/<\/script/i.test(modelCode + appCode)) throw new Error('内联脚本中不能包含 script 结束标签');
let html = readFileSync(join(directory, 'templates/roadmap.html'), 'utf8');
for (const [token, value] of [['__BACKLOG_JSON__', embedded], ['__MODEL_JS__', modelCode], ['__APP_JS__', appCode]]) {
  if (!html.includes(token)) throw new Error(`模板缺少占位：${token}`);
  html = html.replace(token, () => value);
}
const stats = summarize(data);
const safe = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const lines = ['# Pi Workbench 全量功能清单', '', `基线：${data.baselineDate} · ${stats.total} 项功能 · ${data.modules.length} 个模块 · M0–M8`, '', `完整本地产品 M0–M7：${stats.verified}/${stats.core} 已验收；M8 候选扩展 ${stats.optional} 项单列。已有详细设计 ${stats.detailed} 项；文档不计作产品实现。`, '', '> 本文件由 `node scripts/planning/build-roadmap.mjs` 生成。请维护 backlog JSON，不要手工改本表。', '', '[交互看板](roadmap.html) · [产品规划](plan.md) · [数据源](backlog.json)', '', '## 交付阶段', '', '| 阶段 | 结果 | 功能数 | 已验收 |', '| --- | --- | ---: | ---: |'];
for (const stage of data.milestones) {
  const items = data.features.filter(feature => feature.milestone === stage.id);
  lines.push(`| ${stage.id} ${stage.name} | ${safe(stage.outcome)} | ${items.length} | ${items.filter(feature => feature.progress.status === 'verified').length} |`);
}
for (const module of data.modules) {
  lines.push('', `## ${module.id} ${module.name}`, '', module.goal, '', '| ID | 功能 | 阶段 | 优先级 | 设计 | 实现 | 依赖 |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const feature of data.features.filter(item => item.module === module.id)) lines.push(`| [${feature.id}](roadmap.html#feature=${feature.id}) | ${safe(feature.title)} | ${feature.milestone} | ${feature.priority} | ${data.definitionStatuses[feature.definition]} | ${data.statuses[feature.progress.status]} | ${feature.dependsOn.join(', ') || '—'} |`);
  for (const feature of data.features.filter(item => item.module === module.id)) {
    lines.push('', `### ${feature.id} ${feature.title}`, '', feature.summary, '', `实现来源：${data.supportLabels[feature.support]}。负责人：${feature.progress.owner || '未分配'}；目标日期：${feature.progress.targetDate || '未估算'}。`, '', ...feature.acceptance.map((criterion, index) => `- [${feature.progress.acceptanceChecked[index] ? 'x' : ' '}] ${criterion}`));
    if (feature.progress.note) lines.push('', `进展 / 阻塞：${feature.progress.note}`);
    if (feature.progress.evidence) lines.push('', `验证证据：${feature.progress.evidence}`);
  }
}
lines.push('', '## 进度说明', '', data.progressBasis, '', data.completionRule, '', '设计状态和实现状态分别维护。日期和工时未估算时保持为空，不以条目数量预测发布时间。', '');
if (args[0] === '--import') {
  const temporary = `${dataPath}.tmp`;
  writeFileSync(temporary, serialized, 'utf8');
  renameSync(temporary, dataPath);
}
writeFileSync(join(root, 'docs/product/roadmap.html'), html, 'utf8');
writeFileSync(join(root, 'docs/product/feature-list.md'), lines.join('\n'), 'utf8');
process.stdout.write(JSON.stringify({ validated: true, revision, ...stats, generated: ['docs/product/roadmap.html', 'docs/product/feature-list.md'], imported: args[0] === '--import' }) + '\n');
