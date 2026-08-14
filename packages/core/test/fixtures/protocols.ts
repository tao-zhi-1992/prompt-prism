import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type ProtocolFixture = { request: Record<string, unknown>; response: Record<string, unknown>; error: Record<string, unknown>; sse: Record<string, unknown>[] };
export type ProtocolSources = { schema_version: number; fixtures: Record<string, { endpoint: string; sources: Array<{ url: string; revision?: string; accessed_at: string }>; covers: string[] }> };

const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'protocols');
export async function protocolFixture(id: string): Promise<ProtocolFixture> { return JSON.parse(await readFile(path.join(directory, `${id}.json`), 'utf8')) as ProtocolFixture; }
export async function protocolSources(): Promise<ProtocolSources> { return JSON.parse(await readFile(path.join(directory, 'sources.json'), 'utf8')) as ProtocolSources; }
export function sse(events: readonly Record<string, unknown>[], includeEventName = false): string { return events.map((event) => `${includeEventName && typeof event.type === 'string' ? `event: ${event.type}\n` : ''}data: ${JSON.stringify(event)}\n\n`).join(''); }
