#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.env.RELEASE_INFO_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..'));
const packagePath = path.join(root, 'packages/prompt-prism/package.json');
const changelogPath = path.join(root, 'CHANGELOG.md');
const tagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitOrEmpty(...args) {
  try { return git(...args); } catch { return ''; }
}

function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function parseVersion(value, label = 'version') {
  if (!versionPattern.test(value)) throw new Error(`${label} must be a stable SemVer (MAJOR.MINOR.PATCH): ${value}`);
  return value;
}

function latestTag() {
  const tags = gitOrEmpty('tag', '--list', 'v*').split('\n').filter(Boolean)
    .map((name) => ({ name, match: name.match(tagPattern) }))
    .filter(({ match }) => match)
    .sort((left, right) => compareVersions(right.match.slice(1, 4).join('.'), left.match.slice(1, 4).join('.')));
  return tags[0] ?? null;
}

function commitsSince(tag) {
  const main = gitOrEmpty('rev-parse', '--verify', 'origin/main^{commit}');
  const range = main ? `origin/main...HEAD` : tag ? `${tag.name}..HEAD` : 'HEAD';
  const output = gitOrEmpty('log', '--cherry-pick', '--right-only', '--no-merges', '--format=%H%x09%B%x1e', range);
  return output.split('\x1e').map((record) => record.trimStart()).filter(Boolean).map((record) => {
    const [hash, ...messageParts] = record.split('\t');
    const message = messageParts.join('\t').trim();
    const [subject = '', ...bodyLines] = message.split('\n');
    const body = bodyLines.join('\n').trim();
    return { hash, shortHash: hash.slice(0, 7), subject, body };
  });
}

function classify(commit) {
  const breaking = /BREAKING CHANGE(?:S)?\s*:/i.test(commit.body) || /^[a-z]+(?:\([^)]*\))?!:/i.test(commit.subject);
  if (breaking) return 'major';
  const type = commit.subject.match(/^([a-z]+)(?:\([^)]*\))?!?:\s/iu)?.[1]?.toLowerCase();
  if (type === 'feat') return 'minor';
  if (['fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore', 'revert'].includes(type)) return 'patch';
  return type ? 'patch' : 'none';
}

function bump(base, level) {
  const [major, minor, patch] = base.split('.').map(Number);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function deriveVersion(base, commits) {
  const levels = commits.map(classify);
  if (levels.includes('major')) return bump(base, 'major');
  if (levels.includes('minor')) return bump(base, 'minor');
  if (levels.includes('patch')) return bump(base, 'patch');
  return null;
}

function currentBranch() {
  return gitOrEmpty('branch', '--show-current') || '(detached HEAD)';
}

function preflight() {
  const branch = currentBranch();
  if (branch === 'main' || branch === '(detached HEAD)') throw new Error(`release preparation requires a named non-main branch, found ${branch}`);
  if (gitOrEmpty('status', '--porcelain')) throw new Error('worktree is not clean');
  if (!gitOrEmpty('rev-parse', '--verify', 'origin/main^{commit}')) throw new Error('origin/main is unavailable; fetch the remote before release preparation');
  console.log(JSON.stringify({ branch, clean: true, main: gitOrEmpty('rev-parse', '--verify', 'origin/main^{commit}') }, null, 2));
}

function readPackageVersion() {
  return JSON.parse(readFileSync(packagePath, 'utf8')).version;
}

function changelogHas(version) {
  const changelog = readFileSync(changelogPath, 'utf8');
  return changelog.split('\n').some((line) => line.startsWith(`## [${version}]`));
}

function screenshotDimensions() {
  const buffer = readFileSync(path.join(root, 'docs/dashboard.png'));
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || buffer.readUInt32BE(12) !== 0x49484452) throw new Error('docs/dashboard.png is not a valid PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function plan() {
  const tag = latestTag();
  const commits = commitsSince(tag);
  const base = tag?.match.slice(1, 4).join('.') ?? '0.0.0';
  const packageVersion = parseVersion(readPackageVersion(), 'package version');
  if (compareVersions(packageVersion, base) < 0) throw new Error(`package version ${packageVersion} is behind latest tag ${tag?.name ?? base}`);
  const releaseCommit = commits.find((commit) => commit.subject.match(/^chore\(release\): prepare v(\d+\.\d+\.\d+)$/i));
  const derivedVersion = deriveVersion(base, commits);
  const prepared = Boolean(releaseCommit && packageVersion === releaseCommit.subject.match(/v(\d+\.\d+\.\d+)$/i)?.[1] && changelogHas(packageVersion));
  const version = prepared
    ? packageVersion
    : derivedVersion;
  if (version && compareVersions(version, packageVersion) < 0) throw new Error(`derived version ${version} is lower than package version ${packageVersion}`);
  if (version && compareVersions(version, packageVersion) === 0 && !prepared) throw new Error(`derived version ${version} is already the package version; update the release baseline before retrying`);
  const result = {
    branch: currentBranch(),
    latestTag: tag?.name ?? null,
    latestTagCommit: tag ? gitOrEmpty('rev-list', '-n', '1', tag.name) : null,
    comparisonBase: gitOrEmpty('rev-parse', '--verify', 'origin/main^{commit}') ? 'origin/main' : tag?.name ?? 'HEAD',
    commitCount: commits.length,
    packageVersion,
    prepared,
    version,
    releaseBranch: version ? `release-prep/v${version}` : null,
    commits: commits.map((commit) => ({ ...commit, level: classify(commit) })),
  };
  console.log(JSON.stringify(result, null, 2));
  if (!version) process.exitCode = 2;
}

function validate(version) {
  parseVersion(version);
  const tag = latestTag();
  if (tag && compareVersions(version, tag.match.slice(1, 4).join('.')) <= 0) throw new Error(`version ${version} must be greater than latest tag ${tag.name}`);
  const packageVersion = parseVersion(readPackageVersion(), 'package version');
  if (packageVersion !== version) throw new Error(`package version is ${packageVersion}, expected ${version}`);
  if (!changelogHas(version)) throw new Error(`CHANGELOG.md has no entry for ${version}`);
  const dimensions = screenshotDimensions();
  if (dimensions.width !== 2400 || dimensions.height !== 1260) throw new Error(`docs/dashboard.png is ${dimensions.width}×${dimensions.height}, expected 2400×1260`);
  console.log(JSON.stringify({ version, branch: currentBranch(), packageVersion, screenshot: dimensions, changelog: true }, null, 2));
}

function usage() {
  console.error('Usage: release-info.mjs preflight | plan | validate --version MAJOR.MINOR.PATCH');
  process.exitCode = 2;
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'preflight' && args.length === 0) preflight();
  else if (command === 'plan' && args.length === 0) plan();
  else if (command === 'validate' && args[0] === '--version' && args[1]) validate(args[1]);
  else usage();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
