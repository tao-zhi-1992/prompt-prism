import { mkdir, readFile, writeFile, appendFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

async function existsSize(file) {
  try { return (await stat(file)).size; }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
}

export class CaptureStore {
  constructor({ dataDir, maxBytes = 1024 ** 3 }) {
    this.dataDir = path.resolve(dataDir);
    this.maxBytes = maxBytes;
    this.capturesPath = path.join(this.dataDir, 'captures.jsonl');
    this.analysisPath = path.join(this.dataDir, 'analysis.jsonl');
    this.captures = [];
    this.pending = Promise.resolve();
    this.onEvict = null;
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true });
    try {
      const lines = (await readFile(this.capturesPath, 'utf8')).trim().split('\n').filter(Boolean);
      this.captures = lines.map(JSON.parse);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return this;
  }

  enqueue(capture, afterWrite) {
    const task = this.pending.then(async () => {
      const stored = await this.writeCapture(capture);
      if (stored && afterWrite) await afterWrite(stored);
      return stored;
    });
    this.pending = task.catch((error) => console.error('[prompt-prism] capture failed:', error.message));
    return task;
  }

  async writeCapture(capture) {
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
      file_ref: fileRef,
      messages: capture.messages
    };
    await appendFile(this.capturesPath, `${JSON.stringify(indexEntry)}\n`);
    this.captures.push(indexEntry);
    return indexEntry;
  }

  async evictUntilFits(incomingBytes) {
    let total = 0;
    for (const item of this.captures) total += await existsSize(path.join(this.dataDir, item.file_ref));
    let changed = false;
    while (this.captures.length && total + incomingBytes > this.maxBytes) {
      const oldestIndex = this.captures.reduce((best, item, index, list) =>
        new Date(item.timestamp) < new Date(list[best].timestamp) ? index : best, 0);
      const [oldest] = this.captures.splice(oldestIndex, 1);
      const file = path.join(this.dataDir, oldest.file_ref);
      total -= await existsSize(file);
      await unlink(file).catch((error) => { if (error.code !== 'ENOENT') throw error; });
      this.onEvict?.(oldest);
      changed = true;
    }
    if (changed) await this.rewriteCaptures();
  }

  async rewriteCaptures() {
    const content = this.captures.map((item) => JSON.stringify(item)).join('\n');
    await writeFile(this.capturesPath, content ? `${content}\n` : '');
  }

  async readCapture(id) {
    const item = this.captures.find((entry) => entry.id === id);
    if (!item) return null;
    try { return JSON.parse(await readFile(path.join(this.dataDir, item.file_ref), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
}
