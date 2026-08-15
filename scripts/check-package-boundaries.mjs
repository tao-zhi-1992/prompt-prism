import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';

const forbidden = [
  { root: 'packages/core/src', pattern: /@prompt-prism\/(?:builtins|plugins|dashboard|dashboard-kit)|from ['"]react['"]/, name: 'Core must not depend on product composition, plugins, Dashboard, or React' },
  { root: 'packages/dashboard/src', pattern: /@prompt-prism\/plugins\/dashboard/, name: 'Dashboard must receive tabs from Builtins, not the plugin registry' },
  { root: 'packages/dashboard-kit/src', pattern: /@prompt-prism\/(?:plugins|dashboard)(?:['"/])/, name: 'Dashboard Kit must not depend on Plugins or the Dashboard shell' },
];

for (const rule of forbidden) {
  for await (const file of glob(`${rule.root}/**/*.{ts,tsx}`, { exclude: ['**/*.test.*'] })) {
    const source = await readFile(file, 'utf8');
    if (rule.pattern.test(source)) throw new Error(`${rule.name}: ${file}`);
  }
}

try {
  await readFile('packages/plugins/src/content/StructuredContent.tsx');
  throw new Error('StructuredContent must live in Dashboard Kit, not Plugins');
} catch (error) {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
    // The old Plugins implementation has been removed as part of the boundary.
  } else {
    throw error;
  }
}
