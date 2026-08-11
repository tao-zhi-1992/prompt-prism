import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptsDir, '..');
const repositoryDir = path.resolve(packageDir, '../..');
const docsDir = path.join(packageDir, 'docs');

await mkdir(docsDir, { recursive: true });
await Promise.all([
  copyFile(path.join(repositoryDir, 'README.md'), path.join(packageDir, 'README.md')),
  copyFile(path.join(repositoryDir, 'LICENSE'), path.join(packageDir, 'LICENSE')),
  ...['dashboard.png', 'guide.md', 'insights.md', 'development.md'].map((file) =>
    copyFile(path.join(repositoryDir, 'docs', file), path.join(docsDir, file))
  )
]);
