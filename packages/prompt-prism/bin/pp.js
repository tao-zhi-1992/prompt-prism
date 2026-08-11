#!/usr/bin/env node
import { main } from '../dist/cli.js';

try {
  await main();
} catch (error) {
  console.error(`p2: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
