import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = path.join(packageDir, 'package.json');
const packageJsonBackupPath = path.join(packageDir, '.package.json.prepack');

try {
  const original = await readFile(packageJsonBackupPath, 'utf8');
  await writeFile(packageJsonPath, original, 'utf8');
  await rm(packageJsonBackupPath, { force: true });
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
