import { test, expect } from '@playwright/test';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { traceDisplayName } from '../packages/plugins/src/trace/dashboard/displayName.js';

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

async function sendCapture(model: string, traceId?: string): Promise<void> {
  const body = JSON.stringify({
    model,
    max_tokens: 32,
    messages: [{ role: 'user', content: `hello ${model}` }],
    ...(model === 'e2e-tool-call' ? { tools: [{ name: 'read_file', description: 'Read a source file.', input_schema: { type: 'object', properties: { file_path: { type: 'string', description: 'Path to read.' } }, required: ['file_path'] } }] } : {}),
  });
  const response = await fetch(`${proxyOrigin}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'e2e-test-key', ...(traceId ? { 'x-prompt-prism-trace-id': traceId } : {}) },
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

test('uses coordinated green selection styling across themes', async ({ page }) => {
  await sendCapture('e2e-selected-good', 'trace-selection');
  await page.goto('./');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });

  const request = page.locator('.request-item').filter({ hasText: 'e2e-selected-good' });
  await request.click();
  await expect(request).toHaveAttribute('data-selected', 'true');
  const readSelectionStyles = () => request.evaluate((element) => {
    const root = getComputedStyle(document.documentElement);
    const item = getComputedStyle(element);
    return {
      selectedBg: root.getPropertyValue('--selected-bg').trim(),
      background: item.backgroundColor,
      border: item.borderTopColor,
      indicator: getComputedStyle(element, '::before').backgroundColor,
    };
  });
  await expect.poll(async () => (await readSelectionStyles()).background).toContain('rgba(0, 189, 73');
  const darkStyles = await readSelectionStyles();
  expect(darkStyles.selectedBg).toMatch(/0, 189, 73|#00bd49/i);
  expect(darkStyles.background).toContain('rgba(0, 189, 73');
  expect(darkStyles.border).toMatch(/rgba?\(63, 107, 76/);
  expect(darkStyles.indicator).toBe('rgb(0, 189, 73)');
  await request.hover();
  await expect.poll(async () => (await readSelectionStyles()).background).toContain('rgba(0, 189, 73');
  await expect(request.locator('.status-label')).toHaveClass(/status-label--good/);
  const traceBadge = page.locator('.trace-badge[title="trace-selection"]');
  await expect(traceBadge).toHaveText(`trace:${traceDisplayName('trace-selection')} #1`);
  await expect(traceBadge.locator('svg')).toHaveCount(0);
  expect(await traceBadge.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(darkStyles.background);

  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await expect.poll(async () => (await readSelectionStyles()).background).toContain('rgba(0, 138, 53');
  const lightStyles = await readSelectionStyles();
  expect(lightStyles.selectedBg).toMatch(/0, 138, 53|#008a35/i);
  expect(lightStyles.background).toContain('rgba(0, 138, 53');
  expect(lightStyles.border).toMatch(/rgba?\((?:12[0-9]|13[0-9]|14[0-9]), (?:16[0-9]|17[0-9]|18[0-9]), (?:14[0-9]|15[0-9]|16[0-9])/);
  expect(lightStyles.indicator).toBe('rgb(0, 138, 53)');
  await request.hover();
  await expect.poll(async () => (await readSelectionStyles()).background).toContain('rgba(0, 138, 53');
  await expect(request.locator('.status-label')).toHaveClass(/status-label--good/);
});

test('opens a trace at its first capture with a unified trace style', async ({ page }) => {
  await sendCapture('e2e-trace-first', 'trace-a');
  await new Promise((resolve) => setTimeout(resolve, 10));
  await sendCapture('e2e-trace-second', 'trace-a');
  await sendCapture('e2e-trace-other', 'trace-b');
  await page.goto('./');

  const traceABadges = page.locator('.trace-badge[title="trace-a"]');
  const traceBBadge = page.locator('.trace-badge[title="trace-b"]');
  await expect(traceABadges).toHaveCount(2);
  await expect(traceBBadge).toHaveCount(1);
  await expect(traceABadges.first()).toContainText('#2');
  await expect(traceABadges.last()).toContainText('#1');
  await expect(traceBBadge).toContainText('#1');
  await expect(traceABadges.first()).toContainText(`trace:${traceDisplayName('trace-a')} #2`);
  await expect(traceBBadge).toContainText(`trace:${traceDisplayName('trace-b')} #1`);
  const traceAStyles = await traceABadges.first().evaluate((element) => {
    return {
      color: getComputedStyle(element).color,
      border: getComputedStyle(element).borderTopColor,
      background: getComputedStyle(element).backgroundColor,
    };
  });
  const traceBStyles = await traceBBadge.evaluate((element) => {
    return {
      color: getComputedStyle(element).color,
      border: getComputedStyle(element).borderTopColor,
      background: getComputedStyle(element).backgroundColor,
    };
  });
  expect(traceAStyles.color).toBe(traceBStyles.color);
  expect(traceAStyles.border).toBe(traceBStyles.border);
  expect(traceAStyles.background).toBe(traceBStyles.background);
  await expect(traceABadges.first().locator('svg')).toHaveCount(0);

  await traceABadges.last().click();
  await expect(page.locator('.request-item[data-selected]')).toContainText('e2e-trace-first');
  await expect(page.getByRole('tab', { name: 'Trace' })).toHaveAttribute('data-active');
  await expect(page.locator('.trace-summary-id')).toContainText(`trace:${traceDisplayName('trace-a')}`);
  await expect(page.locator('.trace-summary-id svg')).toHaveCount(0);
  const callMarker = page.locator('.trace-call').first();
  await expect(callMarker).not.toHaveClass(/trace-call-marker/);
  const markerStyles = await callMarker.evaluate((element) => {
    const style = getComputedStyle(element, '::after');
    return { color: style.backgroundColor };
  });
  expect(markerStyles.color).not.toBe('rgba(0, 0, 0, 0)');
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

test('keeps Input Diff section header height stable while toggling', async ({ page }) => {
  await sendCapture('e2e-model');
  await page.goto('./');
  await page.getByRole('button', { name: /e2e-model/ }).click();
  await page.getByRole('tab', { name: 'Input Diff' }).click();

  const toggle = page.getByRole('button', { name: 'Messages' });
  const panel = toggle.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " input-diff-section ")]').locator('.input-diff-section-panel');
  await expect(toggle).toHaveCSS('border-bottom-width', '0px');
  const expanded = await toggle.boundingBox();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveCSS('border-bottom-width', '0px');
  await expect(panel).toHaveCount(0);
  const collapsed = await toggle.boundingBox();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveCSS('border-bottom-width', '0px');
  await expect(panel).toHaveCSS('border-top-width', '1px');
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
