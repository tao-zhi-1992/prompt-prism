import { mkdir, readFile, writeFile, appendFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Capture, CaptureIndexEntry } from './types.js';

async function existsSize(file: string): Promise<number> {
  try { return (await stat(file)).size; }
  catch (error: unknown) { if (isMissingFile(error)) return 0; throw error; }
}

export class CaptureStore {
  readonly dataDir: string;
  readonly maxBytes: number;
  readonly capturesPath: string;
  readonly analysisPath: string;
  captures: CaptureIndexEntry[] = [];
  pending: Promise<unknown> = Promise.resolve();
  onEvict: ((item: CaptureIndexEntry) => void) | null = null;

  constructor({ dataDir, maxBytes = 1024 ** 3 }: { dataDir: string; maxBytes?: number }) {
    this.dataDir = path.resolve(dataDir);
    this.maxBytes = maxBytes;
    this.capturesPath = path.join(this.dataDir, 'captures.jsonl');
    this.analysisPath = path.join(this.dataDir, 'analysis.jsonl');
  }

  async init(): Promise<this> {
    await mkdir(this.dataDir, { recursive: true });
    try {
      const lines = (await readFile(this.capturesPath, 'utf8')).trim().split('\n').filter(Boolean);
      this.captures = lines.map((line) => JSON.parse(line) as CaptureIndexEntry);
    } catch (error: unknown) { if (!isMissingFile(error)) throw error; }
    return this;
  }

  enqueue(capture: Capture, afterWrite?: (stored: CaptureIndexEntry) => Promise<unknown> | unknown): Promise<CaptureIndexEntry | null> {
    const task = this.pending.then(async () => {
      const stored = await this.writeCapture(capture);
      if (stored && afterWrite) await afterWrite(stored);
      return stored;
    });
    this.pending = task.catch((error: unknown) => console.error('[prompt-prism] capture failed:', error instanceof Error ? error.message : String(error)));
    return task;
  }

  async writeCapture(capture: Capture): Promise<CaptureIndexEntry | null> {
    const folder = path.join(this.dataDir, capture.token_hash);
    await mkdir(folder, { recursive: true });
    const filename = `${capture.timestamp.replace(/[:.]/g, '-')}_${capture.id}.json`;
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
      file_ref: fileRef,
      messages: capture.messages,
      adapter_id: capture.adapter_id,
      prompt_input: capture.prompt_input
    };
    await appendFile(this.capturesPath, `${JSON.stringify(indexEntry)}\n`);
    this.captures.push(indexEntry);
    return indexEntry;
  }

  async evictUntilFits(incomingBytes: number): Promise<void> {
    let total = 0;
    for (const item of this.captures) total += await existsSize(path.join(this.dataDir, item.file_ref));
    let changed = false;
    while (this.captures.length && total + incomingBytes > this.maxBytes) {
      const oldestIndex = this.captures.reduce((best, item, index, list) =>
        new Date(item.timestamp) < new Date(list[best]?.timestamp ?? Number.POSITIVE_INFINITY) ? index : best, 0);
      const [oldest] = this.captures.splice(oldestIndex, 1);
      if (!oldest) continue;
      const file = path.join(this.dataDir, oldest.file_ref);
      total -= await existsSize(file);
      await unlink(file).catch((error: unknown) => { if (!isMissingFile(error)) throw error; });
      this.onEvict?.(oldest);
      changed = true;
    }
    if (changed) await this.rewriteCaptures();
  }

  async rewriteCaptures(): Promise<void> {
    const content = this.captures.map((item) => JSON.stringify(item)).join('\n');
    await writeFile(this.capturesPath, content ? `${content}\n` : '');
  }

  async readCapture(id: string): Promise<Capture | null> {
    const item = this.captures.find((entry) => entry.id === id);
    if (!item) return null;
    try { return JSON.parse(await readFile(path.join(this.dataDir, item.file_ref), 'utf8')) as Capture; }
    catch (error: unknown) { if (isMissingFile(error)) return null; throw error; }
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
