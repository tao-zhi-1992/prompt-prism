import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPublishManifest } from './publish-manifest.js';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));
assertPublishManifest(manifest);
