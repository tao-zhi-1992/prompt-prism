import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const outputPath = path.join(root, 'docs/dashboard.png');
const expectedWidth = 2400;
const expectedHeight = 1260;
const viewport = { width: 1200, height: 630 };

function listen(server, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const onError = (error) => { server.removeListener('listening', onListening); reject(error); };
    const onListening = () => {
      server.removeListener('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Server did not expose a TCP address'));
      resolve(address.port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, host);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((error) => error ? reject(error) : resolve());
  });
}

function request(port, pathname, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = fetch(`http://127.0.0.1:${port}${pathname}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body,
    });
    request.then(async (response) => resolve({ response, body: await response.text() }), reject);
  });
}

function jsonResponse(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

function createMockUpstream() {
  return createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      let input = {};
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* Prompt Prism still records the raw body. */ }
      const turn = Number(input.metadata?.turn ?? 1);
      const model = input.model ?? 'claude-sonnet-4-5';
      const payload = turn === 1
        ? {
            id: 'msg_checkout_1', type: 'message', role: 'assistant', model,
            content: [{ type: 'text', text: 'I will inspect the checkout flow.' }, { type: 'tool_use', id: 'toolu_read_checkout', name: 'read_file', input: { path: 'src/checkout.ts' } }],
            stop_reason: 'tool_use', usage: { input_tokens: 1520, output_tokens: 84, cache_read_input_tokens: 960, cache_creation_input_tokens: 320 },
          }
        : turn === 2
          ? {
              id: 'msg_checkout_2', type: 'message', role: 'assistant', model,
              content: [{ type: 'text', text: 'The focused tests pass and the pagination fix is verified.' }],
              stop_reason: 'end_turn', usage: { input_tokens: 1760, output_tokens: 84, cache_read_input_tokens: 960, cache_creation_input_tokens: 320 },
            }
          : {
              id: 'msg_checkout_3', type: 'message', role: 'assistant', model,
              content: [{ type: 'text', text: 'The implementation is ready for review.' }],
              stop_reason: 'end_turn', usage: { input_tokens: 1520, output_tokens: 84, cache_read_input_tokens: 960, cache_creation_input_tokens: 320 },
            };
      jsonResponse(response, 200, payload);
    });
  });
}

async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? signal}`)));
  });
}

function pngDimensions(buffer) {
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || buffer.readUInt32BE(12) !== 0x49484452) throw new Error('Screenshot is not a PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function contentType(file) {
  return file.endsWith('.html') ? 'text/html; charset=utf-8'
    : file.endsWith('.css') ? 'text/css; charset=utf-8'
      : file.endsWith('.png') ? 'image/png' : 'application/octet-stream';
}

function createLandingServer(candidatePath) {
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://landing.local').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      const file = relative === 'dashboard.png' ? candidatePath : path.resolve(root, 'docs', relative);
      const docsRoot = path.resolve(root, 'docs');
      if (relative !== 'dashboard.png' && !file.startsWith(`${docsRoot}${path.sep}`)) return response.writeHead(404).end();
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': contentType(file), 'content-length': body.length });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
}

async function assertDashboard(page, proxyPort, version) {
  await page.goto(`http://127.0.0.1:${proxyPort}/_pp/`, { waitUntil: 'networkidle' });
  const body = await page.locator('body').innerText();
  for (const text of [`v${version}`, /requests/i, /trace/i, /Proxy URL/]) if (typeof text === 'string' ? !body.includes(text) : !text.test(body)) throw new Error(`Dashboard is missing expected text: ${text}`);
  if (await page.getByRole('dialog').count() !== 0) throw new Error('Proxy URL dialog must remain closed');
  if (await page.getByRole('button', { name: /claude-sonnet-4-5/ }).count() === 0) throw new Error('Dashboard has no mock requests');
  if (await page.getByRole('button', { name: 'Proxy URL' }).count() === 0) throw new Error('Dashboard has no Proxy URL button');
  await page.getByRole('button', { name: /claude-sonnet-4-5/ }).first().click();
}

async function assertLanding(browser, candidatePath) {
  const server = createLandingServer(candidatePath);
  const port = await listen(server);
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    for (const pageName of ['index.html', 'index.zh-CN.html']) {
      const response = await page.goto(`http://127.0.0.1:${port}/${pageName}`, { waitUntil: 'networkidle' });
      if (response?.status() !== 200) throw new Error(`${pageName} did not load successfully`);
      const image = page.locator('img[src="./dashboard.png"]');
      const metadata = await image.evaluate((element) => ({ width: element.naturalWidth, height: element.naturalHeight, alt: element.getAttribute('alt') ?? '' }));
      if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) throw new Error(`${pageName} loaded the wrong dashboard image dimensions`);
      if (!/Dashboard|仪表盘/i.test(metadata.alt) || !/Proxy URL|代理地址/i.test(metadata.alt)) throw new Error(`${pageName} is missing Dashboard/Proxy URL alt text`);
      if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error(`${pageName} has horizontal overflow`);
    }
    await context.close();
  } finally {
    await close(server);
  }
}

async function main() {
  const packageJson = JSON.parse(await readFile(path.join(root, 'packages/prompt-prism/package.json'), 'utf8'));
  const version = packageJson.version;
  await run('pnpm', ['--filter', 'prompt-prism', 'build:all']);

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'prompt-prism-dashboard-screenshot-'));
  const candidatePath = path.join(temporaryRoot, 'dashboard.png');
  const dataDir = path.join(temporaryRoot, 'data');
  const upstream = createMockUpstream();
  let prism;
  let browser;
  try {
    const upstreamPort = await listen(upstream);
    // The public package entry point assembles Core with the built-in server
    // plugins. Keep the screenshot workflow on the same runtime surface users
    // get from `prompt-prism`, rather than reaching into an internal module.
    const { createPromptPrism } = await import(path.join(root, 'packages/prompt-prism/dist/index.js'));
    prism = await createPromptPrism({ upstreamUrl: `http://127.0.0.1:${upstreamPort}/v1/messages`, dataDir });
    const proxyPort = await listen(prism.server);
    for (const turn of [1, 2, 3]) {
      const messages = turn === 1
        ? [{ role: 'user', content: 'Inspect the checkout flow and verify the pagination fix.' }]
        : turn === 2
          ? [{ role: 'user', content: 'Inspect the checkout flow and verify the pagination fix.' }, { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_read_checkout', name: 'read_file', input: { path: 'src/checkout.ts' } }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_read_checkout', content: 'export function checkout() {}' }] }]
          : [{ role: 'user', content: 'Confirm the final behavior and report any remaining risks.' }];
      const body = JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 256, metadata: { turn }, messages, ...(turn === 1 ? { tools: [{ name: 'read_file', description: 'Read a repository file', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }] } : {}) });
      const result = await request(proxyPort, '/v1/messages', body, { 'x-api-key': 'screenshot-demo-key', 'x-prompt-prism-trace-id': 'agent.checkout' });
      if (!result.response.ok) throw new Error(`Mock capture request failed with ${result.response.status}`);
    }
    const deadline = Date.now() + 5_000;
    while (prism.store.captures.length < 3 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    if (prism.store.captures.length < 3) throw new Error(`Expected 3 mock captures, found ${prism.store.captures.length}`);
    await prism.store.pending;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: 'dark' });
    await context.addInitScript(() => localStorage.setItem('prompt-prism-theme', 'dark'));
    const page = await context.newPage();
    await assertDashboard(page, proxyPort, version);
    await page.screenshot({ path: candidatePath });
    const dimensions = pngDimensions(await readFile(candidatePath));
    if (dimensions.width !== expectedWidth || dimensions.height !== expectedHeight) throw new Error(`Screenshot dimensions are ${dimensions.width}×${dimensions.height}, expected ${expectedWidth}×${expectedHeight}`);
    await assertLanding(browser, candidatePath);
    await context.close();
    await rename(candidatePath, outputPath);
    const finalSize = (await stat(outputPath)).size;
    console.log(`Dashboard screenshot updated: ${outputPath} (${expectedWidth}×${expectedHeight}, ${finalSize} bytes)`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (prism) await close(prism.server).catch(() => {});
    await close(upstream).catch(() => {});
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
