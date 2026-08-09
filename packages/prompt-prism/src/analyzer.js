import { appendFile, readFile } from 'node:fs/promises';
import { diffCharacters, divergencePoint } from './diff.js';

export function serializeMessages(messages) {
  return JSON.stringify(messages ?? []);
}

function commonMessagePrefix(left, right) {
  let count = 0;
  while (count < left.length && count < right.length && JSON.stringify(left[count]) === JSON.stringify(right[count])) count++;
  return count;
}

export class Analyzer {
  constructor({ analysisPath }) {
    this.analysisPath = analysisPath;
    this.index = new Map();
    this.analyses = new Map();
  }

  async init(captures = []) {
    try {
      const lines = (await readFile(this.analysisPath, 'utf8')).trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const item = JSON.parse(line);
        this.analyses.set(item.id, item);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const capture of captures) {
      if (capture.messages) this.addToIndex(capture.token_hash, { id: capture.id, messages: capture.messages });
    }
  }

  findParent(tokenHash, messages) {
    const candidates = this.index.get(tokenHash) ?? [];
    const text = serializeMessages(messages);
    let best = null;
    for (const candidate of candidates) {
      const candidateText = serializeMessages(candidate.messages);
      const score = {
        messages: commonMessagePrefix(candidate.messages, messages),
        chars: divergencePoint(candidateText, text)
      };
      if (!best || score.messages > best.score.messages || (score.messages === best.score.messages && score.chars > best.score.chars)) {
        best = { ...candidate, score };
      }
    }
    return best;
  }

  async analyze(capture) {
    const messages = capture.messages ?? [];
    const currentText = serializeMessages(messages);
    const parent = this.findParent(capture.token_hash, messages);
    const parentText = parent ? serializeMessages(parent.messages) : '';
    const point = parent ? divergencePoint(parentText, currentText) : 0;
    const actual = capture.usage?.cache_read_input_tokens ?? 0;
    const expected = Math.floor(point / 4);
    const analysis = {
      id: capture.id,
      timestamp: capture.timestamp,
      matched_parent_id: parent?.id ?? null,
      matched_message_count: parent?.score.messages ?? 0,
      divergence_point: point,
      diff: parent ? diffCharacters(parentText, currentText) : [{ type: 'insert', value: currentText }],
      estimated_cacheable_tokens: expected,
      actual_cache_read_tokens: actual,
      estimated_cache_miss: Math.max(0, expected - actual),
      cache_hit_below_expected: expected >= 32 && actual < expected * 0.8
    };
    await appendFile(this.analysisPath, `${JSON.stringify(analysis)}\n`);
    this.analyses.set(capture.id, analysis);
    this.addToIndex(capture.token_hash, { id: capture.id, messages });
    return analysis;
  }

  addToIndex(tokenHash, item) {
    const entries = this.index.get(tokenHash) ?? [];
    entries.push(item);
    this.index.set(tokenHash, entries);
  }

  remove(id, tokenHash) {
    this.analyses.delete(id);
    const entries = this.index.get(tokenHash) ?? [];
    this.index.set(tokenHash, entries.filter((item) => item.id !== id));
  }
}
