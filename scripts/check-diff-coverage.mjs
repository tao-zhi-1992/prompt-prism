import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const minimum = Number(process.env.DIFF_COVERAGE_MIN ?? 90);

function gitDiff() {
  const configuredBase = process.env.DIFF_BASE;
  const hasBase = configuredBase && !/^0+$/.test(configuredBase);
  const args = hasBase
    ? ['diff', '--unified=0', `${configuredBase}...HEAD`]
    : ['diff', '--unified=0', 'HEAD'];
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  } catch (error) {
    if (hasBase) {
      return execFileSync('git', ['diff', '--unified=0', 'HEAD^'], { cwd: root, encoding: 'utf8' });
    }
    throw error;
  }
}

function changedLines() {
  const files = new Map();
  let file;
  for (const line of gitDiff().split('\n')) {
    const header = line.match(/^\+\+\+ b\/(.+)$/);
    if (header) {
      file = header[1];
      continue;
    }
    if (!file || !/\.(?:ts|tsx)$/.test(file)) continue;
    const hunk = line.match(/^@@ .* \+(\d+)(?:,(\d+))? @@/);
    if (!hunk) continue;
    const start = Number(hunk[1]);
    const count = Number(hunk[2] ?? 1);
    if (count === 0) continue;
    const lines = files.get(file) ?? new Set();
    for (let number = start; number < start + count; number += 1) lines.add(number);
    files.set(file, lines);
  }
  return files;
}

function lineCounts(entry) {
  const counts = new Map();
  for (const [statementId, statement] of Object.entries(entry.statementMap)) {
    const line = statement.start.line;
    const count = entry.s[statementId] ?? 0;
    counts.set(line, Math.max(counts.get(line) ?? 0, count));
  }
  return counts;
}

const changed = changedLines();
const sourceRoots = [
  'packages/builtins/src/',
  'packages/core/src/',
  'packages/dashboard-kit/src/',
  'packages/dashboard/src/',
  'packages/plugins/src/',
  'packages/prompt-prism/src/',
  'packages/ui/src/',
];

function isCoveredSourceFile(file) {
  return sourceRoots.some((root) => file.startsWith(root))
    && !/(?:\.test\.|\.spec\.|\/test\/|\/fixtures\/|\.d\.ts$)/.test(file)
    && !/(?:^|\/)(?:contracts|types|provider)\.ts$/.test(file)
    && !/(?:^|\/)vite\.config\.ts$/.test(file);
}

const coverageFiles = [
  'packages/dashboard-kit/coverage/coverage-final.json',
  'packages/builtins/coverage/coverage-final.json',
  'packages/plugins/coverage/coverage-final.json',
  'packages/core/coverage/coverage-final.json',
  'packages/prompt-prism/coverage/coverage-final.json',
  'packages/dashboard/coverage/coverage-final.json',
  'packages/ui/coverage/coverage-final.json',
];
const coverage = new Map();
for (const relative of coverageFiles) {
  if (!existsSync(path.join(root, relative))) continue;
  const entries = JSON.parse(readFileSync(path.join(root, relative), 'utf8'));
  for (const [file, entry] of Object.entries(entries)) coverage.set(path.relative(root, file), lineCounts(entry));
}

let executable = 0;
let covered = 0;
const failures = [];
for (const [file, lines] of changed) {
  const counts = coverage.get(file);
  if (!counts) {
    if (isCoveredSourceFile(file)) failures.push(`${file}: no coverage record`);
    continue;
  }
  let fileExecutable = 0;
  let fileCovered = 0;
  for (const line of lines) {
    if (!counts.has(line)) continue;
    fileExecutable += 1;
    if (counts.get(line) > 0) fileCovered += 1;
  }
  if (fileExecutable === 0) continue;
  executable += fileExecutable;
  covered += fileCovered;
  const percentage = (fileCovered / fileExecutable) * 100;
  if (percentage < minimum) failures.push(`${file}: ${percentage.toFixed(2)}% (${fileCovered}/${fileExecutable})`);
}

if (executable === 0) {
  console.log('Diff coverage: no changed executable source lines found.');
  process.exit(0);
}

const percentage = (covered / executable) * 100;
console.log(`Diff coverage: ${percentage.toFixed(2)}% (${covered}/${executable}), minimum ${minimum}%`);
if (failures.length > 0 || percentage < minimum) {
  if (failures.length > 0) console.error(`Files below diff coverage minimum:\n${failures.join('\n')}`);
  process.exit(1);
}
