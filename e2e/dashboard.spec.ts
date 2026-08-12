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
  const body = JSON.stringify({
    model,
    max_tokens: 32,
    messages: [{ role: 'user', content: `hello ${model}` }],
    ...(model === 'e2e-tool-call' ? { tools: [{ name: 'read_file', description: 'Read a source file.', input_schema: { type: 'object', properties: { file_path: { type: 'string', description: 'Path to read.' } }, required: ['file_path'] } }] } : {}),
  });
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
      const toolCall = model === 'e2e-tool-call';
      const payload = JSON.stringify({
        id: `msg_${model}`,
        type: 'message',
        role: 'assistant',
        model,
        content: toolCall
          ? [{ type: 'tool_use', id: 'call_e2e_read', name: 'read_file', input: { file_path: '/tmp/example.ts' } }]
          : [{ type: 'text', text: `hello from ${model}` }],
        stop_reason: toolCall ? 'tool_use' : 'end_turn',
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
  await dialog.getByLabel('Upstream URL or Base URL').fill('https://user:secret@example.com/v1');
  await dialog.getByRole('button', { name: 'Generate' }).click();
  await expect(dialog.getByRole('alert')).toContainText('valid HTTP(S)');

  await dialog.getByLabel('Upstream URL or Base URL').fill('https://api.example.com/v1');
  await dialog.getByRole('button', { name: 'Generate' }).click();
  const result = dialog.getByLabel('Proxy Base URL');
  await expect(result).toHaveValue(/\/\_proxy\//);
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

test('renders expanded structured trace content with a single outer border', async ({ page }) => {
  await sendCapture('e2e-tool-call');
  await page.goto('./');
  await page.getByRole('button', { name: /e2e-tool-call/ }).click();

  const toolCall = page.getByRole('button', { name: /Tool call.*read_file/i });
  await toolCall.click();
  const event = toolCall.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " trace-event ")]');
  const content = event.locator('.structured-content');
  await expect(content).toBeVisible();
  await expect(event).toHaveCSS('border-top-width', '1px');
  for (const side of ['top', 'right', 'bottom', 'left']) {
    await expect(content).toHaveCSS(`border-${side}-width`, '0px');
  }
});

test('keeps Trace chevrons aligned to the right edge without event detail', async ({ page }) => {
  await sendCapture('e2e-tool-call');
  await page.goto('./');
  await page.getByRole('button', { name: /e2e-tool-call/ }).click();

  const event = page.locator('.trace-event').first();
  const chevron = event.locator('.trace-chevron');
  const [eventBox, chevronBox] = await Promise.all([event.boundingBox(), chevron.boundingBox()]);
  expect(eventBox).not.toBeNull();
  expect(chevronBox).not.toBeNull();
  expect(eventBox!.x + eventBox!.width - (chevronBox!.x + chevronBox!.width)).toBeCloseTo(21, 0);
});

test('keeps Output tool call content inset with its own border', async ({ page }) => {
  await sendCapture('e2e-tool-call');
  await page.goto('./');
  await page.getByRole('button', { name: /e2e-tool-call/ }).click();
  await page.getByRole('tab', { name: 'Output' }).click();

  const toolCall = page.locator('.output-tool-call');
  const header = toolCall.locator('.output-block-header');
  const content = toolCall.locator('.structured-content');
  await expect(content).toBeVisible();
  const [headerBox, contentBox] = await Promise.all([header.boundingBox(), content.boundingBox()]);
  expect(headerBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(contentBox!.x - headerBox!.x).toBeCloseTo(12, 0);
  expect(headerBox!.width - contentBox!.width).toBeCloseTo(24, 0);
  await expect(content).toHaveCSS('border-left-width', '1px');
});

test('keeps Output collapsible header height stable while toggling', async ({ page }) => {
  await sendCapture('e2e-model');
  await page.goto('./');
  await page.getByRole('button', { name: /e2e-model/ }).click();
  await page.getByRole('tab', { name: 'Output' }).click();

  const toggle = page.getByRole('button', { name: 'Text' });
  await expect(toggle).toHaveCSS('border-bottom-width', '0px');
  const expanded = await toggle.boundingBox();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveCSS('border-bottom-width', '0px');
  const collapsed = await toggle.boundingBox();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveCSS('border-bottom-width', '0px');
  await expect(toggle.locator('xpath=following-sibling::*[contains(concat(" ", normalize-space(@class), " "), " output-collapsible-panel ")]')).toHaveCSS('border-top-width', '1px');
  const reexpanded = await toggle.boundingBox();
  expect(expanded).not.toBeNull();
  expect(collapsed).not.toBeNull();
  expect(reexpanded).not.toBeNull();
  expect(collapsed!.height).toBeCloseTo(expanded!.height, 4);
  expect(reexpanded!.height).toBeCloseTo(expanded!.height, 4);
});

test('keeps Tools structured content inset with a single content border', async ({ page }) => {
  await sendCapture('e2e-tool-call');
  await page.goto('./');
  await page.getByRole('button', { name: /e2e-tool-call/ }).click();
  await page.getByRole('tab', { name: 'Tools' }).click();

  const card = page.locator('.tools-card');
  await card.locator('.tools-card-header').click();
  const body = card.locator('.tools-card-body');
  const content = card.locator('.structured-content').first();
  await expect(content).toBeVisible();
  const [cardBox, bodyBox, contentBox] = await Promise.all([card.boundingBox(), body.boundingBox(), content.boundingBox()]);
  expect(cardBox).not.toBeNull();
  expect(bodyBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(bodyBox!.x - cardBox!.x).toBeCloseTo(1, 0);
  expect(contentBox!.x - cardBox!.x).toBeCloseTo(13, 0);
  await expect(content).toHaveCSS('border-left-width', '1px');
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
