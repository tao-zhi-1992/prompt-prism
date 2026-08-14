import { build } from 'esbuild';

const common = { bundle: true, format: 'esm', platform: 'node', target: 'node20', packages: 'bundle', sourcemap: false };
await build({ ...common, entryPoints: ['src/index.ts'], outfile: 'dist/index.js' });
await build({ ...common, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js' });
