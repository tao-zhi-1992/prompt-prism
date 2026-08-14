import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublishManifest } from '../../scripts/publish-manifest.js';

test('accepts a publish manifest without runtime workspace dependencies', () => {
  assert.doesNotThrow(() => assertPublishManifest({
    name: 'prompt-prism',
    dependencies: {
      chalk: '^5.0.0',
    },
  }));
});

test('rejects private workspace packages and workspace protocols in runtime dependencies', () => {
  assert.throws(() => assertPublishManifest({
    name: 'prompt-prism',
    dependencies: { '@prompt-prism/core': 'workspace:*' },
  }), /private workspace package/);
  assert.throws(() => assertPublishManifest({
    name: 'prompt-prism',
    dependencies: { example: 'workspace:*' },
  }), /workspace protocol/);
});
