import { mkdir, readFile, writeFile, appendFile, stat, unlink, rm, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Capture, CaptureIndexEntry } from './types.js';
import { normalizeProviderProtocol } from './adapter/registry.js';

async function existsSize(file: string): Promise<number> {
  try { return (await stat(file)).size; }
  catch (error: unknown) { if (isMissingFile(error)) return 0; throw error; }
}

async function fileExists(filename: string): Promise<boolean> {
  try { return (await stat(filename)).isFile(); }
  catch (error: unknown) { if (isMissingFile(error)) return false; throw error; }
}

async function readOptionalFile(filename: string): Promise<string | null> {
  try { return await readFile(filename, 'utf8'); }
  catch (error: unknown) { if (isMissingFile(error)) return null; throw error; }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCaptureIndexEntry(value: unknown): value is CaptureIndexEntry {
  return isObject(value)
    && typeof value.id === 'string' && value.id.length > 0
    && typeof value.timestamp === 'string' && !Number.isNaN(Date.parse(value.timestamp))
    && typeof value.token_hash === 'string'
    && (typeof value.model === 'string' || value.model === null)
    && isObject(value.usage)
    && typeof value.file_ref === 'string' && value.file_ref.length > 0
    && Array.isArray(value.messages);
}

function resolveDataFile(dataDir: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error('Capture file path must be relative to the data directory');
  const normalized = path.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw new Error('Capture file path must stay within the data directory');
  const absolute = path.resolve(dataDir, normalized);
  if (!absolute.startsWith(`${dataDir}${path.sep}`)) throw new Error('Capture file path must stay within the data directory');
  return absolute;
}

function assertSafePathSegment(value: string, label: string): void {
  if (!value || value.length > 128 || !/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') {
    throw new Error(`${label} must be a safe path segment`);
  }
}

function parseCaptureIndex(content: string): { entries: CaptureIndexEntry[]; recoveredTail: boolean } {
  const lines = content.split('\n');
  const completeTail = content.endsWith('\n');
  const entries: CaptureIndexEntry[] = [];
  const ids = new Set<string>();
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    }
    catch (error: unknown) {
      if (!completeTail && index === lines.length - 1) return { entries, recoveredTail: true };
      throw new Error(`Invalid capture index record at line ${index + 1}`, { cause: error });
    }
    if (!isCaptureIndexEntry(value)) throw new Error(`Invalid capture index record at line ${index + 1}`);
    if (ids.has(value.id)) throw new Error(`Duplicate capture ID at line ${index + 1}: ${value.id}`);
    ids.add(value.id);
    entries.push(value);
  }
  return { entries, recoveredTail: content.length > 0 && !completeTail };
}

async function replaceFile(filename: string, content: string): Promise<void> {
  const temporaryPath = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { flag: 'wx' });
    await rename(temporaryPath, filename);
  } finally {
    await unlink(temporaryPath).catch((cleanupError: unknown) => { if (!isMissingFile(cleanupError)) throw cleanupError; });
  }
}

export class CaptureStore {
  readonly dataDir: string;
  readonly maxBytes: number;
  readonly capturesPath: string;
  readonly analysisPath: string;
  captures: CaptureIndexEntry[] = [];
  pending: Promise<unknown> = Promise.resolve();
  onEvict: ((item: CaptureIndexEntry) => void) | null = null;
  onClear: (() => Promise<void> | void) | null = null;

  constructor({ dataDir, maxBytes = 1024 ** 3 }: { dataDir: string; maxBytes?: number }) {
    this.dataDir = path.resolve(dataDir);
    this.maxBytes = maxBytes;
    this.capturesPath = path.join(this.dataDir, 'captures.jsonl');
    this.analysisPath = path.join(this.dataDir, 'analysis.jsonl');
  }

  async init(): Promise<this> {
    await mkdir(this.dataDir, { recursive: true });
    const content = await readOptionalFile(this.capturesPath);
    if (content !== null) {
      const { entries, recoveredTail } = parseCaptureIndex(content);
      let needsRewrite = recoveredTail;
      const captures: CaptureIndexEntry[] = [];
      for (const entry of entries) {
        const absolute = resolveDataFile(this.dataDir, entry.file_ref);
        if (!await fileExists(absolute)) {
          needsRewrite = true;
          continue;
        }
        if (entry.adapter_id) entry.adapter_id = normalizeProviderProtocol(entry.adapter_id);
        if (entry.prompt_input?.adapter_id) entry.prompt_input.adapter_id = normalizeProviderProtocol(entry.prompt_input.adapter_id);
        captures.push(entry);
      }
      this.captures = captures;
      if (needsRewrite) await this.rewriteCaptures();
    }
    return this;
  }

  private runExclusive<T>(label: string, operation: () => Promise<T>): Promise<T> {
    const task = this.pending.then(operation);
    this.pending = task.catch((error: unknown) => {
      console.error(`[prompt-prism] ${label} failed:`, error instanceof Error ? error.message : String(error));
    });
    return task;
  }

  enqueue(capture: Capture, afterWrite?: (stored: CaptureIndexEntry) => Promise<unknown> | unknown): Promise<CaptureIndexEntry | null> {
    return this.runExclusive('capture', async () => {
      const stored = await this.persistCapture(capture);
      if (stored && afterWrite) await afterWrite(stored);
      return stored;
    });
  }

  writeCapture(capture: Capture): Promise<CaptureIndexEntry | null> {
    return this.runExclusive('capture', () => this.persistCapture(capture));
  }

  protected async persistCapture(capture: Capture): Promise<CaptureIndexEntry | null> {
    assertSafePathSegment(capture.token_hash, 'Capture token hash');
    assertSafePathSegment(capture.id, 'Capture ID');
    if (this.captures.some(({ id }) => id === capture.id)) throw new Error(`Capture ID already exists: ${capture.id}`);
    const timestamp = new Date(capture.timestamp);
    if (Number.isNaN(timestamp.getTime())) throw new Error('Capture timestamp must be a valid date');
    const folder = resolveDataFile(this.dataDir, capture.token_hash);
    await mkdir(folder, { recursive: true });
    const filename = `${timestamp.toISOString().replace(/[:.]/g, '-')}_${capture.id}.json`;
    const absolute = path.join(folder, filename);
    const fileRef = path.relative(this.dataDir, absolute);
    const serialized = JSON.stringify(capture, null, 2);

    const incomingBytes = Buffer.byteLength(serialized);
    if (incomingBytes > this.maxBytes) return null;
    await this.evictUntilFits(incomingBytes);
    await writeFile(absolute, serialized, { flag: 'wx' });

    const indexEntry = {
      id: capture.id,
      timestamp: capture.timestamp,
      token_hash: capture.token_hash,
      model: capture.model,
      usage: capture.usage,
      response_status: capture.response?.status,
      upstream_host: capture.upstream_host,
      trace_id: capture.trace_id,
      timing: capture.timing,
      file_ref: fileRef,
      messages: capture.messages,
      adapter_id: capture.adapter_id,
      prompt_input: capture.prompt_input
    };
    try { await appendFile(this.capturesPath, `${JSON.stringify(indexEntry)}\n`); }
    catch (error: unknown) {
      await unlink(absolute).catch((cleanupError: unknown) => { if (!isMissingFile(cleanupError)) throw cleanupError; });
      throw error;
    }
    this.captures.push(indexEntry);
    return indexEntry;
  }

  async evictUntilFits(incomingBytes: number): Promise<void> {
    let total = 0;
    for (const item of this.captures) total += await existsSize(resolveDataFile(this.dataDir, item.file_ref));
    let changed = false;
    while (this.captures.length && total + incomingBytes > this.maxBytes) {
      const oldestIndex = this.captures.reduce((best, item, index, list) =>
        new Date(item.timestamp) < new Date(list[best]?.timestamp ?? Number.POSITIVE_INFINITY) ? index : best, 0);
      const [oldest] = this.captures.splice(oldestIndex, 1);
      if (!oldest) continue;
      const file = resolveDataFile(this.dataDir, oldest.file_ref);
      total -= await existsSize(file);
      await unlink(file).catch((error: unknown) => { if (!isMissingFile(error)) throw error; });
      this.onEvict?.(oldest);
      changed = true;
    }
    if (changed) await this.rewriteCaptures();
  }

  async rewriteCaptures(): Promise<void> {
    const content = this.captures.map((item) => JSON.stringify(item)).join('\n');
    await replaceFile(this.capturesPath, content ? `${content}\n` : '');
  }

  async readCapture(id: string): Promise<Capture | null> {
    const item = this.captures.find((entry) => entry.id === id);
    if (!item) return null;
    try { return JSON.parse(await readFile(resolveDataFile(this.dataDir, item.file_ref), 'utf8')) as Capture; }
    catch (error: unknown) { if (isMissingFile(error)) return null; throw error; }
  }

  clear(): Promise<void> {
    return this.runExclusive('clear', async () => {
      await rm(this.dataDir, { recursive: true, force: true });
      await mkdir(this.dataDir, { recursive: true });
      this.captures.length = 0;
      await this.onClear?.();
    });
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
