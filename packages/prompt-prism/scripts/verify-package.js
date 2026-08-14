import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { assertPublishManifest } from './publish-manifest.js';

const execFileAsync = promisify(execFile);
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratchDir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-package-'));
const tarballDir = path.join(scratchDir, 'tarballs');
const installDir = path.join(scratchDir, 'install');
const unpackDir = path.join(scratchDir, 'unpacked');
const npmCacheDir = path.join(scratchDir, 'npm-cache');
const npmEnv = { ...process.env, npm_config_cache: npmCacheDir };

try {
  await Promise.all([mkdir(tarballDir), mkdir(unpackDir), mkdir(npmCacheDir)]);
  await execFileAsync('npm', ['pack', '--pack-destination', tarballDir], { cwd: packageDir, env: npmEnv });
  const tarball = (await readdir(tarballDir)).find((name) => name.endsWith('.tgz'));
  if (!tarball) throw new Error('npm pack did not create a tarball');
  const tarballPath = path.join(tarballDir, tarball);

  await execFileAsync('tar', ['-xzf', tarballPath, '-C', unpackDir]);
  const packedDir = path.join(unpackDir, 'package');
  const packedManifest = JSON.parse(await readFile(path.join(packedDir, 'package.json'), 'utf8'));
  assertPublishManifest(packedManifest);

  const runtimeFiles = (await readdir(path.join(packedDir, 'dist'))).filter((name) => name.endsWith('.js'));
  for (const file of runtimeFiles) {
    const source = await readFile(path.join(packedDir, 'dist', file), 'utf8');
    if (/(?:from|import\(|require\()\s*['"]@prompt-prism\//.test(source)) {
      throw new Error(`Published runtime still imports a private workspace package: dist/${file}`);
    }
  }

  await execFileAsync('npm', ['install', '--prefix', installDir, tarballPath, '--ignore-scripts', '--no-package-lock'], { env: npmEnv });
  const { stdout } = await execFileAsync(process.execPath, [path.join(installDir, 'node_modules', 'prompt-prism', 'bin', 'pp.js'), '--version']);
  if (stdout.trim() !== packedManifest.version) throw new Error(`Installed CLI reported ${stdout.trim()} instead of ${packedManifest.version}`);
} finally {
  await rm(scratchDir, { recursive: true, force: true });
}
