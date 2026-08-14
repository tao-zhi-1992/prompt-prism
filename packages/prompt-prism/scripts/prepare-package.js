import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublishManifest } from './publish-manifest.js';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptsDir, '..');
const repositoryDir = path.resolve(packageDir, '../..');
const docsDir = path.join(packageDir, 'docs');
const packageJsonPath = path.join(packageDir, 'package.json');
const packageJsonBackupPath = path.join(packageDir, '.package.json.prepack');

try {
  const previousBackup = await readFile(packageJsonBackupPath, 'utf8');
  await writeFile(packageJsonPath, previousBackup, 'utf8');
  await rm(packageJsonBackupPath, { force: true });
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const packageJsonSource = await readFile(packageJsonPath, 'utf8');
await writeFile(packageJsonBackupPath, packageJsonSource, 'utf8');
await writeFile(packageJsonPath, `${JSON.stringify(createPublishManifest(JSON.parse(packageJsonSource)), null, 2)}\n`, 'utf8');

await mkdir(docsDir, { recursive: true });
await Promise.all([
  copyFile(path.join(repositoryDir, 'README.md'), path.join(packageDir, 'README.md')),
  copyFile(path.join(repositoryDir, 'LICENSE'), path.join(packageDir, 'LICENSE')),
  ...['dashboard.png', 'guide.md', 'insights.md', 'development.md'].map((file) =>
    copyFile(path.join(repositoryDir, 'docs', file), path.join(docsDir, file))
  )
]);
