import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { UPDATE_CHECK_INTERVAL_MS, checkForUpdate, compareVersions, formatUpdateNotice, shouldRunAutomaticUpdateCheck } from './update-check.js';

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const registries = [{ id: 'npm' as const, url: 'https://npm.test/latest' }, { id: 'npmmirror' as const, url: 'https://mirror.test/latest' }];

test('compares stable versions and rejects prereleases', () => {
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('1.3.0', '1.2.9'), 1);
  assert.equal(compareVersions('1.2.2', '1.2.3'), -1);
  assert.throws(() => compareVersions('1.2.3-beta.1', '1.2.3'), /stable version/);
});

test('uses the official registry first and falls back to npmmirror', async () => {
  const cachePath = path.join(await mkdtemp(path.join(tmpdir(), 'prompt-prism-update-')), 'update.json');
  const calls: string[] = [];
  const update = await checkForUpdate({ currentVersion: '0.3.2', cachePath, registries, fetchImpl: async (url) => { calls.push(String(url)); return String(url).includes('npm.test') ? response({}, 503) : response({ version: '0.3.3' }); } });
  assert.deepEqual(calls, ['https://npm.test/latest', 'https://mirror.test/latest']);
  assert.equal(update.registry, 'npmmirror');
  assert.equal(update.updateAvailable, true);
  assert.equal(JSON.parse(await readFile(cachePath, 'utf8')).registry, 'npmmirror');
});

test('does not query the mirror after an official success and reuses fresh cache', async () => {
  const cachePath = path.join(await mkdtemp(path.join(tmpdir(), 'prompt-prism-update-')), 'update.json');
  let calls = 0;
  const first = await checkForUpdate({ currentVersion: '0.3.3', cachePath, registries, now: () => 1000, fetchImpl: async () => { calls += 1; return response({ 'dist-tags': { latest: '0.3.3' } }); } });
  const second = await checkForUpdate({ currentVersion: '0.3.2', cachePath, registries, now: () => 1000 + UPDATE_CHECK_INTERVAL_MS - 1, fetchImpl: async () => { calls += 1; return response({ version: '9.9.9' }); } });
  assert.equal(calls, 1);
  assert.equal(first.registry, 'npm');
  assert.equal(second.fromCache, true);
  assert.equal(second.latestVersion, '0.3.3');
});

test('caches failures for the interval and rejects after both registries fail', async () => {
  const cachePath = path.join(await mkdtemp(path.join(tmpdir(), 'prompt-prism-update-')), 'update.json');
  let calls = 0;
  await assert.rejects(checkForUpdate({ currentVersion: '0.3.2', cachePath, registries, now: () => 2000, fetchImpl: async () => { calls += 1; throw new Error('offline'); } }), /All update registries failed/);
  await assert.rejects(checkForUpdate({ currentVersion: '0.3.2', cachePath, registries, now: () => 2000 + UPDATE_CHECK_INTERVAL_MS - 1, fetchImpl: async () => { calls += 1; throw new Error('should not run'); } }), /All update registries failed/);
  assert.equal(calls, 2);
});

test('formats notices and gates automatic checks to interactive non-CI sessions', () => {
  const update = { currentVersion: '0.3.2', latestVersion: '0.3.3', updateAvailable: true, registry: 'npmmirror' as const, checkedAt: 0, fromCache: false };
  assert.match(formatUpdateNotice(update)!, /0\.3\.2 → 0\.3\.3/);
  assert.match(formatUpdateNotice(update, true)!, /npm install -g prompt-prism@latest/);
  assert.equal(formatUpdateNotice({ ...update, updateAvailable: false }), null);
  assert.equal(shouldRunAutomaticUpdateCheck({ CI: '', P2_NO_UPDATE_CHECK: '' }, true), true);
  assert.equal(shouldRunAutomaticUpdateCheck({ CI: '1', P2_NO_UPDATE_CHECK: '' }, true), false);
  assert.equal(shouldRunAutomaticUpdateCheck({ CI: '', P2_NO_UPDATE_CHECK: '1' }, true), false);
  assert.equal(shouldRunAutomaticUpdateCheck({}, false), false);
});
