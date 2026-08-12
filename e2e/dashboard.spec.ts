import { test, expect } from '@playwright/test';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

type CreatePromptPrism = (typeof import('../packages/prompt-prism/dist/proxy.js'))['createPromptPrism'];

const proxyPort = Number(process.env.PP_E2E_PORT ?? 4173);
const proxyOrigin = `http://127.0.0.1:${proxyPort}`;

let createPromptPrism: CreatePromptPrism;
let prism: Awaited<ReturnType<CreatePromptPrism>>;
let upstream: http.Server;
let dataDir: string;

function listen(server: http.Server, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function sendCapture(model: string): Promise<void> {
  const body = JSON.stringify({ model, max_tokens: 32, messages: [{ role: 'user', content: `hello ${model}` }] });
  const response = await fetch(`${proxyOrigin}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'e2e-test-key' },
    body,
  });
  expect(response.ok).toBeTruthy();
  await response.arrayBuffer();
}

test.beforeAll(async () => {
  ({ createPromptPrism } = await import('../packages/prompt-prism/dist/proxy.js'));
  upstream = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      let model = 'e2e-model';
      try { model = String((JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model?: string }).model ?? model); } catch { /* keep the test fallback */ }
      const payload = JSON.stringify({
        id: `msg_${model}`,
        type: 'message',
        role: 'assistant',
        model,
        content: [{ type: 'text', text: `hello from ${model}` }],
        usage: { input_tokens: 3, output_tokens: 2 },
      });
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
      response.end(payload);
    });
  });
  const upstreamPort = await listen(upstream);
  dataDir = await mkdtemp(path.join(tmpdir(), 'prompt-prism-e2e-'));
  prism = await createPromptPrism({ upstreamUrl: `http://127.0.0.1:${upstreamPort}/v1/messages`, dataDir });
  await listen(prism.server, proxyPort);
});

test.afterAll(async () => {
  await close(prism.server);
  await close(upstream);
});

test.beforeEach(async ({ request }) => {
  const response = await request.delete(`${proxyOrigin}/_pp/api/logs`);
  expect(response.ok()).toBeTruthy();
});

test('shows the Proxy URL generator before captures exist and copies a generated URL', async ({ page }) => {
  await page.goto('./');

  const trigger = page.getByRole('button', { name: 'Proxy URL' });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Upstream Base URL').fill('https://user:secret@example.com/v1');
  await dialog.getByRole('button', { name: 'Generate' }).click();
  await expect(dialog.getByRole('alert')).toContainText('valid HTTP(S)');

  await dialog.getByLabel('Upstream Base URL').fill('https://api.example.com/v1');
  await dialog.getByRole('button', { name: 'Generate' }).click();
  const result = dialog.getByLabel('Proxy Base URL');
  await expect(result).toHaveValue(/\/\_pp\/up\//);
  await dialog.getByRole('button', { name: 'Copy' }).click();
  await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible();
  await expect(page.locator('.request-heading-actions > span').first()).toHaveText('0');
});

test('loads a capture and opens its normalized output', async ({ page }) => {
  await sendCapture('e2e-model');
  await page.goto('./');

  const request = page.getByRole('button', { name: /e2e-model/ });
  await expect(request).toBeVisible();
  await request.click();
  await page.getByRole('tab', { name: 'Output' }).click();
  await expect(page.getByText('hello from e2e-model')).toBeVisible();
});

test('loads older requests and stages then merges a new request', async ({ page }) => {
  for (let index = 0; index < 105; index += 1) await sendCapture(`e2e-${index}`);
  await page.goto('./');

  await expect(page.locator('.request-heading-actions > span').first()).toHaveText('105');
  await expect(page.getByRole('button', { name: /e2e-104/ })).toBeVisible();

  const viewport = page.locator('.scroll-viewport');
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect(page.getByRole('button', { name: /e2e-0/ })).toBeVisible();

  await sendCapture('e2e-new');
  const newRequests = page.getByRole('button', { name: '1 new requests' });
  await expect(newRequests).toBeVisible({ timeout: 10_000 });
  await newRequests.click();
  await expect(page.getByRole('button', { name: /e2e-new/ })).toBeVisible();
});
