import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';

const forbidden = [
  { root: 'packages/core/src', pattern: /@prompt-prism\/(?:builtins|plugins|dashboard|dashboard-kit)|from ['"]react['"]/, name: 'Core must not depend on product composition, plugins, Dashboard, or React' },
  { root: 'packages/dashboard/src', pattern: /@prompt-prism\/plugins\/dashboard/, name: 'Dashboard must receive tabs from Builtins, not the plugin registry' },
];

for (const rule of forbidden) {
  for await (const file of glob(`${rule.root}/**/*.{ts,tsx}`, { exclude: ['**/*.test.*'] })) {
    const source = await readFile(file, 'utf8');
    if (rule.pattern.test(source)) throw new Error(`${rule.name}: ${file}`);
  }
}
