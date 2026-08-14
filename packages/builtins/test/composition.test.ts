import { describe, expect, it } from 'vitest';
import { defaultDashboardTabs } from '../src/dashboard.js';
import { createBuiltinServerPluginRuntime } from '../src/server.js';

describe('built-in composition', () => {
  it('exposes the stable default Dashboard tab order', () => {
    expect(defaultDashboardTabs.map(({ id }) => id)).toEqual([
      'input-diff', 'system-prompt', 'output', 'tools', 'trace', 'raw',
    ]);
  });

  it('assembles the default server plugins without exposing composition internals', () => {
    const runtime = createBuiltinServerPluginRuntime();
    expect(runtime.plugins.map(({ id }) => id)).toEqual([
      'input-diff', 'output', 'tools', 'raw', 'system-prompt', 'insights',
    ]);
    expect(runtime.analyzer).toBeDefined();
  });
});
