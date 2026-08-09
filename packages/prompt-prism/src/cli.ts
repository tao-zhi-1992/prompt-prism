import { parseArgs } from 'node:util';
import { startPromptPrism } from './proxy.js';

function usage(): void {
  console.log(`Prompt Prism

Usage:
  pp start [--upstream-url URL] [--port NUMBER] [--data-dir PATH]
           [--max-storage SIZE] [--open | --no-open]

Defaults:
  upstream-url https://api.anthropic.com/v1/messages
  port         8787
  data-dir     ./data
  max-storage  1GB`);
}

function parseBytes(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i);
  if (!match) throw new Error(`Invalid size: ${value}`);
  const units = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 } as const;
  const amount = Number(match[1]);
  const unit = (match[2] ?? 'b').toLowerCase() as keyof typeof units;
  return Math.floor(amount * units[unit]);
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const command = args[0];
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    usage();
    return;
  }
  if (command !== 'start') {
    console.error(`Unknown command: ${command}`);
    usage();
    process.exitCode = 1;
    return;
  }

  const { values } = parseArgs({
    args: args.slice(1),
    options: {
      'upstream-url': { type: 'string', default: 'https://api.anthropic.com/v1/messages' },
      port: { type: 'string', default: '8787' },
      'data-dir': { type: 'string', default: './data' },
      'max-storage': { type: 'string', default: '1GB' },
      open: { type: 'boolean', default: true },
      help: { type: 'boolean', short: 'h' }
    },
    allowNegative: true
  });
  if (values.help) {
    usage();
    return;
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid port: ${values.port}`);
  await startPromptPrism({
    upstreamUrl: values['upstream-url'],
    port,
    dataDir: values['data-dir'],
    maxBytes: parseBytes(values['max-storage']),
    open: values.open
  });
}
