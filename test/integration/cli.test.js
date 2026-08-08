import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../../bin/pp.js', import.meta.url));

test('CLI documents upstream-url and removes the old routing options', async () => {
  const { stdout } = await run(process.execPath, [cli, '--help']);
  assert.match(stdout, /--upstream-url URL/);
  assert.doesNotMatch(stdout, /--base-url|--target|\btarget\b/i);
});

test('CLI reads and validates --upstream-url', async () => {
  await assert.rejects(
    run(process.execPath, [cli, 'start', '--upstream-url', 'file:///tmp/messages', '--no-open']),
    (error) => error.code === 1 && /Upstream URL must use http or https/.test(error.stderr)
  );
});
