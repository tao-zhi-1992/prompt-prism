import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.resolve(packageDir, '../prompt-prism/dist/internal');

await mkdir(outputDir, { recursive: true });
await build({
  entryPoints: [path.join(packageDir, 'src/server.ts')],
  outfile: path.join(outputDir, 'plugins.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  packages: 'bundle',
  logLevel: 'info',
});
