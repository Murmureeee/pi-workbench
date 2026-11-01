import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { cloneData, mergeProgress, validateData, summarize } from './backlog-model.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const data = JSON.parse(readFileSync(join(root, 'docs/product/backlog.json'), 'utf8'));
let checks = 0;
function check(name, action) { action(); checks++; process.stdout.write(`PASS ${name}\n`); }
function progress(id, changes = {}) {
  const feature = data.features.find(item => item.id === id);
  return { id, acceptance: feature.acceptance, progress: { ...cloneData(feature.progress), ...changes } };
}
function payload(features) { return { schemaVersion: 1, product: data.product, features }; }
const evidence = '验证夹具：真实实现证据由用户在产品任务完成后填写；此字符串仅用于管理工具校验测试。';
const done = id => progress(id, { status: 'verified', acceptanceChecked: [true, true], evidence, updatedAt: '2026-10-31T00:00:00.000Z' });

check('current backlog definitions, dependencies and progress are valid', () => assert.deepEqual(validateData(data), []));
check('design coverage does not count as implementation', () => {
  const stats = summarize(data);
  assert.equal(stats.verified, data.features.filter(item => item.milestone !== 'M8' && item.progress.status === 'verified').length);
  assert.equal(stats.core + stats.optional, stats.total);
  assert.ok(stats.detailed > 0);
});
check('cannot mark done without acceptance or evidence', () => {
  assert.throws(() => mergeProgress(data, payload([progress('CORE-01', { status: 'verified', acceptanceChecked: [false, false], evidence: '' })])), /验收|证据/);
  assert.throws(() => mergeProgress(data, payload([progress('CORE-01', { status: 'verified', acceptanceChecked: [true, true], evidence: '' })])), /证据/);
});
check('unmet prerequisites prevent false completion', () => {
  const fixture = cloneData(data);
  fixture.features.find(item => item.id === 'CORE-01').progress.status = 'in_progress';
  assert.throws(() => mergeProgress(fixture, payload([done('CORE-02')])), /前置功能/);
});
check('batch import checks the whole resulting graph, regardless of row order', () => {
  const before = JSON.stringify(data);
  const next = mergeProgress(data, payload([done('CORE-02'), done('CORE-01')]));
  const unchangedVerified = data.features.filter(item => item.milestone !== 'M8'
    && !['CORE-01', 'CORE-02'].includes(item.id) && item.progress.status === 'verified').length;
  assert.equal(summarize(next).verified, unchangedVerified + 2);
  assert.equal(JSON.stringify(data), before);
});
check('failed import is atomic and cannot corrupt existing definitions', () => {
  const before = JSON.stringify(data);
  assert.throws(() => mergeProgress(data, payload([done('CORE-01'), progress('CORE-02', { status: 'unknown' })])), /未知实现状态/);
  assert.equal(JSON.stringify(data), before);
  const next = mergeProgress(data, payload([{ ...progress('CORE-01'), title: 'changed externally', dependsOn: [] }]));
  assert.equal(next.features[0].title, data.features[0].title);
});
check('unknown IDs and changed acceptance definitions are rejected', () => {
  assert.throws(() => mergeProgress(data, payload([{ id: 'FAKE-01', progress: {} }])), /不存在/);
  assert.throws(() => mergeProgress(data, payload([{ ...progress('CORE-01'), acceptance: ['different'] }])), /验收定义已变化/);
});
check('blocked status requires a cause and invalid dates are rejected', () => {
  assert.throws(() => mergeProgress(data, payload([progress('CORE-01', { status: 'blocked', note: '' })])), /填写原因/);
  assert.throws(() => mergeProgress(data, payload([progress('CORE-01', { targetDate: '2026-02-30' })])), /日期无效/);
});
check('cycles and dependencies in later stages are detected', () => {
  const next = cloneData(data);
  next.features[0].dependsOn = ['CORE-02'];
  assert.ok(validateData(next).some(error => error.includes('循环依赖')));
  next.features[0].dependsOn = ['REMOTE-01'];
  assert.ok(validateData(next).some(error => error.includes('更晚阶段')));
});
check('downgrading a prerequisite cannot leave dependent completion valid', () => {
  const next = mergeProgress(data, payload([done('CORE-01'), done('CORE-02')]));
  assert.throws(() => mergeProgress(next, payload([progress('CORE-01', { status: 'in_progress' })])), /前置功能/);
});
check('generated HTML embeds exactly the canonical scope and compiles', () => {
  const html = readFileSync(join(root, 'docs/product/roadmap.html'), 'utf8');
  const embedded = JSON.parse(html.match(/<script id="backlog-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(embedded.features, data.features);
  assert.deepEqual(embedded.decisions, data.decisions);
  assert.ok(!html.includes('__BACKLOG_JSON__') && !html.includes('__APP_JS__'));
  const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1];
  new Script(script);
  assert.ok(!/<script[^>]+src=|<link[^>]+stylesheet/i.test(html));
});
check('generated Markdown includes every stable feature and acceptance criterion', () => {
  const markdown = readFileSync(join(root, 'docs/product/feature-list.md'), 'utf8');
  for (const feature of data.features) {
    assert.ok(markdown.includes(`### ${feature.id} ${feature.title}`));
    for (const criterion of feature.acceptance) assert.ok(markdown.includes(criterion));
  }
});
process.stdout.write(`Verified ${checks} checks. Product progress unchanged.\n`);
