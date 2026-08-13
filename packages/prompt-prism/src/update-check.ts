import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_CHECK_TIMEOUT_MS = 3_000;
export const UPDATE_CHECK_MAX_RESPONSE_BYTES = 64 * 1024;

export const UPDATE_REGISTRIES = [
  { id: 'npm', url: 'https://registry.npmjs.org/prompt-prism/latest' },
  { id: 'npmmirror', url: 'https://registry.npmmirror.com/prompt-prism/latest' },
] as const;

export type UpdateRegistry = (typeof UPDATE_REGISTRIES)[number]['id'];

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  registry: UpdateRegistry;
  checkedAt: number;
  fromCache: boolean;
}

export class UpdateCheckError extends Error {
  constructor(message = 'Unable to check for updates') {
    super(message);
    this.name = 'UpdateCheckError';
  }
}

interface CacheRecord {
  checked_at: number;
  latest_version?: string;
  registry?: UpdateRegistry;
  error?: string;
}

interface RegistryResponse {
  version: string;
}

export interface UpdateCheckOptions {
  currentVersion: string;
  cachePath?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  force?: boolean;
  registries?: readonly { id: UpdateRegistry; url: string }[];
  timeoutMs?: number;
  maxResponseBytes?: number;
}

function defaultCachePath(): string {
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Caches', 'prompt-prism', 'update-check.json');
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'prompt-prism', 'update-check.json');
  return path.join(process.env.XDG_CACHE_HOME ?? path.join(home, '.cache'), 'prompt-prism', 'update-check.json');
}

function parseVersion(value: string): [number, number, number] | null {
  const match = value.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new UpdateCheckError('Invalid stable version metadata');
  for (let index = 0; index < a.length; index += 1) {
    if (a[index]! !== b[index]!) return a[index]! > b[index]! ? 1 : -1;
  }
  return 0;
}

async function readCache(cachePath: string): Promise<CacheRecord | null> {
  try {
    const value = JSON.parse(await readFile(cachePath, 'utf8')) as Partial<CacheRecord>;
    if (typeof value.checked_at !== 'number' || !Number.isFinite(value.checked_at)) return null;
    if (value.latest_version !== undefined && typeof value.latest_version !== 'string') return null;
    if (value.registry !== undefined && value.registry !== 'npm' && value.registry !== 'npmmirror') return null;
    if (value.error !== undefined && typeof value.error !== 'string') return null;
    return value as CacheRecord;
  } catch {
    return null;
  }
}

async function writeCache(cachePath: string, value: CacheRecord): Promise<void> {
  try {
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, `${JSON.stringify(value)}\n`, 'utf8');
  } catch {
    // A read-only cache must never prevent a version check or proxy startup.
  }
}

async function readBody(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > maxBytes) throw new UpdateCheckError('Registry response is too large');
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw new UpdateCheckError('Registry response is too large');
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) throw new UpdateCheckError('Registry response is too large');
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

async function fetchLatest(url: string, fetchImpl: typeof fetch, timeoutMs: number, maxBytes: number): Promise<RegistryResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new UpdateCheckError(`Registry returned HTTP ${response.status}`);
    const value = JSON.parse(await readBody(response, maxBytes)) as { version?: unknown; ['dist-tags']?: { latest?: unknown } };
    const version = typeof value.version === 'string' ? value.version : typeof value['dist-tags']?.latest === 'string' ? value['dist-tags'].latest : null;
    if (!version || !parseVersion(version)) throw new UpdateCheckError('Registry returned an invalid stable version');
    return { version };
  } catch (error) {
    if (error instanceof UpdateCheckError) throw error;
    throw new UpdateCheckError(error instanceof Error ? error.message : 'Registry request failed');
  } finally {
    clearTimeout(timer);
  }
}

function result(currentVersion: string, latestVersion: string, registry: UpdateRegistry, checkedAt: number, fromCache: boolean): UpdateCheckResult {
  return { currentVersion, latestVersion, updateAvailable: compareVersions(latestVersion, currentVersion) > 0, registry, checkedAt, fromCache };
}

export async function checkForUpdate(options: UpdateCheckOptions): Promise<UpdateCheckResult> {
  const now = options.now ?? Date.now;
  const checkedAt = now();
  const cachePath = options.cachePath ?? defaultCachePath();
  const cache = options.force ? null : await readCache(cachePath);
  if (cache && checkedAt - cache.checked_at >= 0 && checkedAt - cache.checked_at < UPDATE_CHECK_INTERVAL_MS) {
    if (cache.error) throw new UpdateCheckError(cache.error);
    if (cache.latest_version && cache.registry) return result(options.currentVersion, cache.latest_version, cache.registry, cache.checked_at, true);
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const registries = options.registries ?? UPDATE_REGISTRIES;
  const errors: string[] = [];
  for (const registry of registries) {
    try {
      const latest = await fetchLatest(registry.url, fetchImpl, options.timeoutMs ?? UPDATE_CHECK_TIMEOUT_MS, options.maxResponseBytes ?? UPDATE_CHECK_MAX_RESPONSE_BYTES);
      await writeCache(cachePath, { checked_at: checkedAt, latest_version: latest.version, registry: registry.id });
      return result(options.currentVersion, latest.version, registry.id, checkedAt, false);
    } catch (error) {
      errors.push(`${registry.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const message = `All update registries failed (${errors.join('; ')})`;
  await writeCache(cachePath, { checked_at: checkedAt, error: message });
  throw new UpdateCheckError(message);
}

export function formatUpdateNotice(update: UpdateCheckResult, detailed = false): string | null {
  if (!update.updateAvailable) return detailed ? `Prompt Prism is up to date (${update.currentVersion}) [${update.registry}]` : null;
  const headline = `Prompt Prism update available: ${update.currentVersion} → ${update.latestVersion}`;
  return detailed ? `${headline} [${update.registry}]\nRun: npm install -g prompt-prism@latest` : `${headline}. Run npm install -g prompt-prism@latest`;
}

export async function runAutomaticUpdateCheck(currentVersion: string, options: Omit<UpdateCheckOptions, 'currentVersion'> = {}): Promise<void> {
  try {
    const update = await checkForUpdate({ ...options, currentVersion });
    const notice = formatUpdateNotice(update);
    if (notice) process.stderr.write(`${notice}\n`);
  } catch {
    // Automatic checks are best-effort and must never affect proxy startup.
  }
}

export function shouldRunAutomaticUpdateCheck(env: NodeJS.ProcessEnv = process.env, isTTY = Boolean(process.stderr.isTTY)): boolean {
  return isTTY && !env.CI && env.P2_NO_UPDATE_CHECK !== '1';
}
