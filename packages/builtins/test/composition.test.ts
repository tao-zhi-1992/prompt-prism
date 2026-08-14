import { describe, expect, it, vi } from 'vitest';
import type { ServerPluginContext } from '@prompt-prism/contracts/server';
import { defaultDashboardTabs } from '../src/dashboard.js';
import { createBuiltinServerPluginRuntime } from '../src/server.js';

describe('built-in composition', () => {
  it('exposes the stable default Dashboard tab order', () => {
    expect(defaultDashboardTabs.map(({ id }) => id)).toEqual([
      'input-diff', 'system-prompt', 'output', 'tools', 'trace', 'raw',
    ]);
  });

  it('assembles the default server plugins without exposing composition internals', async () => {
    const runtime = createBuiltinServerPluginRuntime();
    expect(runtime.plugins.map(({ id }) => id)).toEqual([
      'input-diff', 'output', 'tools', 'raw', 'system-prompt', 'insights',
    ]);
    expect(runtime.analyzer).toBeDefined();
    await runtime.init({
      analysisPath: '/tmp/prompt-prism-builtins-analysis.jsonl', captures: [], readCapture: async () => null,
      parseProviderRequest: vi.fn(), parseProviderResponse: vi.fn(), json: vi.fn(), reportError: vi.fn(),
    } satisfies ServerPluginContext);
    expect(runtime.analyzer?.analyses).toBeDefined();
  });
});
