import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, cp, mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type AgentSession, type ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { Model } from '@earendil-works/pi-ai';

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const demoDir = path.basename(runtimeDir) === 'dist' ? path.dirname(runtimeDir) : runtimeDir;
const publicDir = path.join(demoDir, 'public');
const fixtureDir = path.join(demoDir, 'fixture');
const defaultWorkspaceRoot = path.join(demoDir, '.workspaces');
const require = createRequire(import.meta.url);
const brandDir = path.dirname(require.resolve('prompt-prism/assets/logo-mark.png'));
const brandFiles = new Set(['logo-mark.png', 'favicon-32.png', 'apple-touch-icon.png']);

export const DEFAULT_DEMO_BASE_URL = 'http://127.0.0.1:8787';
const SYSTEM_PROMPT = `You are the Prompt Prism demo coding agent. Work only in the provided TypeScript REST-service workspace. Inspect before editing, make focused changes, and run tests before you finish. Every tool call requires a human approval. Explain your conclusion briefly after verification.`;

type Json = Record<string, unknown>;
type DemoEventType = 'session' | 'assistant_delta' | 'tool_call' | 'tool_status' | 'tool_result' | 'turn_complete' | 'aborted' | 'error';
type DemoEvent = { id: number; type: DemoEventType; [key: string]: unknown };
type TranscriptMessage = { id: string; role: 'user' | 'assistant'; content: string };
type PendingApproval = {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  resolve: (approved: boolean) => void;
};

type DemoSession = {
  id: string;
  workspace: string;
  agent: AgentSession;
  events: DemoEvent[];
  messages: TranscriptMessage[];
  pending: Map<string, PendingApproval>;
  clients: Set<ServerResponse>;
  active: boolean;
  aborted: boolean;
};

export type StartDemoOptions = {
  baseUrl?: string;
  providerToken?: string;
  model?: string;
  demoPort?: number | string;
  workspaceRoot?: string;
  fixtureRoot?: string;
  agentSessionFactory?: (options: Parameters<typeof createAgentSession>[0]) => ReturnType<typeof createAgentSession>;
};

export function parseBaseUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('DEMO_BASE_URL must be a valid absolute URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('DEMO_BASE_URL must use http or https');
  if (/\/v1(?:\/messages)?\/?$/.test(url.pathname)) throw new Error('DEMO_BASE_URL must be a base URL without /v1');
  return url;
}

export function messagesUrl(baseUrl: URL): URL {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/v1/messages`;
  url.search = '';
  url.hash = '';
  return url;
}

function numberOption(value: number | string | undefined, fallback: number, name: string): number {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result < 0 || result > 65535) throw new Error(`${name} must be an integer from 0 to 65535`);
  return result;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  response.end(body);
}

function notFound(response: ServerResponse): void { json(response, 404, { error: 'Not found' }); }

async function serveFile(response: ServerResponse, filename: 'index.html' | 'app.js', contentType: string): Promise<void> {
  try {
    const body = await readFile(path.join(publicDir, filename));
    response.writeHead(200, { 'content-type': contentType, 'content-length': body.length, 'cache-control': 'no-store' });
    response.end(body);
  } catch { notFound(response); }
}

async function serveBrand(response: ServerResponse, filename: string): Promise<void> {
  if (!brandFiles.has(filename)) return notFound(response);
  try {
    const body = await readFile(path.join(brandDir, filename));
    response.writeHead(200, { 'content-type': 'image/png', 'content-length': body.length, 'cache-control': 'public, max-age=31536000, immutable' });
    response.end(body);
  } catch { notFound(response); }
}

function readJson(request: IncomingMessage, maxBytes = 1024 * 1024): Promise<Json> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Request body is too large'), { statusCode: 413 }));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        resolve(value as Json);
      } catch { reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 })); }
    });
    request.on('error', reject);
  });
}

function eventPayload(event: DemoEvent): string { return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`; }

function publicSession(session: DemoSession): Json {
  return {
    id: session.id,
    workspace: session.workspace,
    active: session.active,
    messages: session.messages,
    pendingApprovals: [...session.pending.values()].map(({ toolCallId, toolName, input }) => ({ toolCallId, toolName, input })),
    events: session.events
  };
}

function modelFor(baseUrl: URL, modelId: string): Model<'anthropic-messages'> {
  return {
    id: modelId,
    name: modelId,
    provider: 'anthropic',
    api: 'anthropic-messages',
    baseUrl: baseUrl.href.replace(/\/$/, ''),
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 4_096
  };
}

function isSafeSessionId(value: string): boolean { return /^[a-f0-9-]{36}$/i.test(value); }

export async function startDemo(options: StartDemoOptions = {}) {
  const baseUrlValue = options.baseUrl ?? process.env.DEMO_BASE_URL ?? DEFAULT_DEMO_BASE_URL;
  const token = options.providerToken ?? process.env.DEMO_MODEL_PROVIDER_TOKEN;
  const model = options.model ?? process.env.DEMO_AGENT_MODEL;
  if (!token) throw new Error('Missing DEMO_MODEL_PROVIDER_TOKEN');
  if (!model) throw new Error('Missing DEMO_AGENT_MODEL');
  const baseUrl = parseBaseUrl(baseUrlValue);
  const requestedDemoPort = numberOption(options.demoPort ?? process.env.DEMO_PORT, 3000, 'DEMO_PORT');
  const workspaceRoot = path.resolve(options.workspaceRoot ?? defaultWorkspaceRoot);
  const sourceFixture = path.resolve(options.fixtureRoot ?? fixtureDir);
  const agentSessionFactory = options.agentSessionFactory ?? createAgentSession;
  await mkdir(workspaceRoot, { recursive: true });
  const sessions = new Map<string, DemoSession>();

  const emit = (session: DemoSession, type: DemoEventType, payload: Json = {}) => {
    const event: DemoEvent = { id: session.events.length + 1, type, ...payload };
    session.events.push(event);
    for (const client of session.clients) client.write(eventPayload(event));
  };

  const createSession = async (): Promise<DemoSession> => {
    const id = randomUUID();
    const workspace = path.join(workspaceRoot, id);
    await cp(sourceFixture, workspace, { recursive: true, force: false });
    const modelRuntime = await ModelRuntime.create({
      authPath: path.join(workspace, '.pi-demo', 'auth.json'),
      modelsPath: null,
      refreshOnCreate: false
    });
    await modelRuntime.setRuntimeApiKey('anthropic', token);
    let state!: DemoSession;
    const approvalGate: ExtensionFactory = (pi) => {
      pi.on('tool_call', async (event) => {
        const input = event.input as Record<string, unknown>;
        emit(state, 'tool_call', { toolCallId: event.toolCallId, toolName: event.toolName, input });
        const approved = await new Promise<boolean>((resolve) => {
          state.pending.set(event.toolCallId, { toolCallId: event.toolCallId, toolName: event.toolName, input, resolve });
        });
        state.pending.delete(event.toolCallId);
        emit(state, 'tool_status', { toolCallId: event.toolCallId, status: approved ? 'approved' : 'denied' });
        return approved ? undefined : { block: true, reason: 'The user denied this tool call.' };
      });
    };
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const resourceLoader = new DefaultResourceLoader({
      cwd: workspace,
      agentDir: path.join(workspace, '.pi-demo'),
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: SYSTEM_PROMPT,
      extensionFactories: [approvalGate]
    });
    await resourceLoader.reload();
    const { session: agent } = await agentSessionFactory({
      cwd: workspace,
      agentDir: path.join(workspace, '.pi-demo'),
      model: modelFor(baseUrl, model),
      thinkingLevel: 'off',
      modelRuntime,
      resourceLoader,
      tools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'],
      sessionManager: SessionManager.inMemory(workspace),
      settingsManager
    });
    state = { id, workspace, agent, events: [], messages: [], pending: new Map(), clients: new Set(), active: false, aborted: false };
    let assistantMessageId: string | undefined;
    agent.subscribe((event) => {
      if (event.type === 'message_start' && event.message.role === 'assistant') assistantMessageId = randomUUID();
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
        const messageId = assistantMessageId ?? (assistantMessageId = randomUUID());
        let message = state.messages.find((candidate) => candidate.id === messageId);
        if (!message) {
          message = { id: messageId, role: 'assistant', content: '' };
          state.messages.push(message);
        }
        message.content += event.assistantMessageEvent.delta;
        emit(state, 'assistant_delta', { messageId, delta: event.assistantMessageEvent.delta });
      }
      if (event.type === 'tool_execution_start') emit(state, 'tool_status', { toolCallId: event.toolCallId, status: 'running' });
      if (event.type === 'tool_execution_end') {
        const rawContent: unknown[] = Array.isArray(event.result?.content) ? event.result.content : [];
        const content = rawContent.filter((part: unknown): part is { type: 'text'; text: string } => Boolean(part) && typeof part === 'object' && (part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string').map((part: { type: 'text'; text: string }) => part.text).join('\n');
        emit(state, 'tool_result', { toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError, content });
      }
    });
    sessions.set(id, state);
    emit(state, 'session', { sessionId: state.id, workspace: state.workspace });
    return state;
  };

  const getSession = (id: string): DemoSession | undefined => isSafeSessionId(id) ? sessions.get(id) : undefined;
  const abort = async (session: DemoSession) => {
    session.aborted = true;
    for (const approval of session.pending.values()) approval.resolve(false);
    await session.agent.abort();
    if (session.active) emit(session, 'aborted');
  };

  const demoServer = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const segments = url.pathname.split('/').filter(Boolean);
    if (request.method === 'GET' && url.pathname === '/') return void serveFile(response, 'index.html', 'text/html; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/app.js') return void serveFile(response, 'app.js', 'text/javascript; charset=utf-8');
    if (request.method === 'GET' && url.pathname.startsWith('/brand/')) return void serveBrand(response, decodeURIComponent(url.pathname.slice('/brand/'.length)));
    if (request.method === 'GET' && url.pathname === '/api/config') return void json(response, 200, { model, fixture: 'inventory-service' });
    if (request.method === 'POST' && url.pathname === '/api/sessions') {
      createSession().then((session) => json(response, 201, publicSession(session))).catch((error: unknown) => json(response, 500, { error: error instanceof Error ? error.message : 'Unable to create session' }));
      return;
    }
    if (segments[0] !== 'api' || segments[1] !== 'sessions' || !segments[2]) return void notFound(response);
    const session = getSession(segments[2]);
    if (!session) return void notFound(response);
    if (request.method === 'GET' && segments.length === 3) return void json(response, 200, publicSession(session));
    if (request.method === 'GET' && segments[3] === 'events' && segments.length === 4) {
      const after = Math.max(0, Number(url.searchParams.get('after') ?? '0') || 0);
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
      response.write(': connected\n\n');
      for (const event of session.events) if (event.id > after) response.write(eventPayload(event));
      session.clients.add(response);
      request.on('close', () => session.clients.delete(response));
      return;
    }
    if (request.method === 'POST' && segments[3] === 'messages' && segments.length === 4) {
      readJson(request).then(async (body) => {
        const content = typeof body.content === 'string' ? body.content.trim() : '';
        if (!content) return json(response, 400, { error: 'content must be a non-empty string' });
        if (session.active) return json(response, 409, { error: 'This session already has an active turn' });
        session.active = true;
        session.aborted = false;
        session.messages.push({ id: randomUUID(), role: 'user', content });
        json(response, 202, { accepted: true });
        void session.agent.prompt(content, { expandPromptTemplates: false }).then(() => {
          if (!session.aborted) emit(session, 'turn_complete');
        }).catch((error: unknown) => emit(session, 'error', { message: error instanceof Error ? error.message : 'Agent failed' })).finally(() => { session.active = false; });
      }).catch((error: { statusCode?: number; message: string }) => json(response, error.statusCode ?? 400, { error: error.message }));
      return;
    }
    if (request.method === 'POST' && segments[3] === 'approvals' && segments[4] && segments.length === 5) {
      readJson(request).then((body) => {
        const approval = session.pending.get(segments[4]!);
        if (!approval) return json(response, 409, { error: 'This tool call is no longer awaiting approval' });
        if (typeof body.approved !== 'boolean') return json(response, 400, { error: 'approved must be boolean' });
        approval.resolve(body.approved);
        json(response, 200, { approved: body.approved });
      }).catch((error: { statusCode?: number; message: string }) => json(response, error.statusCode ?? 400, { error: error.message }));
      return;
    }
    if (request.method === 'POST' && segments[3] === 'abort' && segments.length === 4) {
      abort(session).then(() => json(response, 200, { aborted: true })).catch((error: unknown) => json(response, 500, { error: error instanceof Error ? error.message : 'Unable to abort' }));
      return;
    }
    if (request.method === 'POST' && segments[3] === 'reset' && segments.length === 4) {
      (async () => {
        await abort(session);
        sessions.delete(session.id);
        if (!path.resolve(session.workspace).startsWith(`${workspaceRoot}${path.sep}`)) throw new Error('Unsafe workspace path');
        await rm(session.workspace, { recursive: true, force: true });
        const replacement = await createSession();
        json(response, 201, publicSession(replacement));
      })().catch((error: unknown) => json(response, 500, { error: error instanceof Error ? error.message : 'Unable to reset session' }));
      return;
    }
    notFound(response);
  });

  await new Promise<void>((resolve, reject) => {
    demoServer.once('error', reject);
    demoServer.listen(requestedDemoPort, '127.0.0.1', resolve);
  });
  const demoPort = (demoServer.address() as import('node:net').AddressInfo).port;
  const close = async () => {
    for (const session of sessions.values()) await abort(session);
    await new Promise<void>((resolve, reject) => demoServer.close((error) => error ? reject(error) : resolve()));
  };
  return { demoServer, demoPort, model, workspaceRoot, close };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const instance = await startDemo();
    console.log(`\n  Prompt Prism Coding Agent Demo is running\n\n  Chat   http://127.0.0.1:${instance.demoPort}/\n  Model  ${instance.model}\n\n  Model traffic is routed through Prompt Prism.\n  Every tool call requires browser approval.\n  Press Ctrl+C to stop.\n`);
  } catch (error) {
    console.error(`prompt-prism demo: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
