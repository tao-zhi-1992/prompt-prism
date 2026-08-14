import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublishManifest } from '../../scripts/publish-manifest.js';

test('removes private workspace dependencies from the npm publish manifest', () => {
  const manifest = createPublishManifest({
    name: 'prompt-prism',
    dependencies: {
      '@prompt-prism/core': 'workspace:*',
      '@prompt-prism/builtins': 'workspace:*',
      '@prompt-prism/contracts': 'workspace:*',
      chalk: '^5.0.0',
    },
  });

  assert.deepEqual(manifest.dependencies, { chalk: '^5.0.0' });
});

test('does not add a dependency field when all dependencies are private workspace packages', () => {
  const manifest = createPublishManifest({
    name: 'prompt-prism',
    dependencies: { '@prompt-prism/core': 'workspace:*' },
  });

  assert.equal('dependencies' in manifest, false);
});
