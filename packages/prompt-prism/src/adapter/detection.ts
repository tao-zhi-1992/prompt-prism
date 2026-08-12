import type http from 'node:http';
import type { ApiFormatOption, ApiFormatResolution, ProviderProtocol } from '../types.js';
import { getProviderAdapter, normalizeProviderProtocol } from './registry.js';

export type DetectedProtocol = ProviderProtocol | 'openai-responses';

export function detectProtocolFromPath(pathname: string): DetectedProtocol | null {
  const path = pathname.replace(/\/+$/, '');
  if (/(?:^|\/)chat\/completions$/i.test(path)) return 'openai-chat-completions';
  if (/(?:^|\/)v1\/messages$/i.test(path)) return 'anthropic-messages';
  if (/(?:^|\/)responses$/i.test(path)) return 'openai-responses';
  return null;
}

export function detectProtocolFromBaseUrl(url: URL): ProviderProtocol | null {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if (/(?:^|\/)anthropic(?:\/|$)/.test(path) || host === 'api.anthropic.com' || (host === 'api.stepfun.com' && /(?:^|\/)step_plan(?:\/|$)/.test(path))) {
    return 'anthropic-messages';
  }
  if (/(?:^|\/)openai(?:\/|$)/.test(path)
    || host === 'api.openai.com'
    || host === 'api.deepseek.com'
    || host === 'api.groq.com'
    || host === 'api.together.xyz') {
    return 'openai-chat-completions';
  }
  return null;
}

export function detectProtocolFromHeaders(headers: http.IncomingHttpHeaders): ProviderProtocol | null {
  if (headers['anthropic-version'] !== undefined || headers['anthropic-beta'] !== undefined) return 'anthropic-messages';
  return null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function detectProtocolFromBody(body: Buffer | string): ProviderProtocol | null {
  let root: Record<string, unknown> | null = null;
  try { root = object(JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : body)); }
  catch { return null; }
  if (!root) return null;
  const messages = Array.isArray(root.messages) ? root.messages.map(object).filter(Boolean) as Record<string, unknown>[] : [];
  const tools = Array.isArray(root.tools) ? root.tools.map(object).filter(Boolean) as Record<string, unknown>[] : [];
  if (tools.some((tool) => 'input_schema' in tool) || messages.some((message) => {
    const content = Array.isArray(message.content) ? message.content.map(object).filter(Boolean) as Record<string, unknown>[] : [];
    return content.some((part) => part.type === 'tool_use' || part.type === 'tool_result' || 'cache_control' in part);
  })) return 'anthropic-messages';
  if (tools.some((tool) => tool.type === 'function' && object(tool.function))
    || messages.some((message) => message.role === 'developer' || message.role === 'tool' || Array.isArray(message.tool_calls))) {
    return 'openai-chat-completions';
  }
  return null;
}

export function detectProtocolFromResponse(body: Buffer | string): ProviderProtocol | null {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : body;
  if (/event:\s*(?:message_start|content_block_start)|"type"\s*:\s*"message_start"/.test(text)) return 'anthropic-messages';
  if (/"object"\s*:\s*"chat\.completion(?:\.chunk)?"/.test(text)) return 'openai-chat-completions';
  try {
    const root = object(JSON.parse(text));
    if (!root) return null;
    if (root.type === 'message' && Array.isArray(root.content)) return 'anthropic-messages';
    if (Array.isArray(root.choices) || root.object === 'chat.completion') return 'openai-chat-completions';
  } catch { /* SSE and malformed bodies are handled by the signatures above. */ }
  return null;
}

export function endpointPath(protocol: DetectedProtocol): string {
  if (protocol === 'anthropic-messages') return '/v1/messages';
  if (protocol === 'openai-chat-completions') return '/v1/chat/completions';
  return '/responses';
}

export class ApiFormatResolver {
  readonly resolution: ApiFormatResolution;
  readonly upstreamHint: DetectedProtocol | null;

  constructor(option: ApiFormatOption = 'auto', upstreamUrl?: URL, exact = false, useUpstreamHint = true) {
    if (option !== 'auto') {
      const canonical = normalizeProviderProtocol(option);
      getProviderAdapter(canonical);
      this.resolution = { mode: 'explicit', configured: canonical as ProviderProtocol, resolved: canonical as ProviderProtocol, source: 'explicit' };
      this.upstreamHint = null;
      return;
    }
    this.resolution = { mode: 'auto', configured: 'auto', resolved: null, source: null };
    this.upstreamHint = upstreamUrl && useUpstreamHint
      ? (exact ? detectProtocolFromPath(upstreamUrl.pathname) : detectProtocolFromBaseUrl(upstreamUrl))
      : null;
  }

  resolve(...evidence: Array<DetectedProtocol | null>): DetectedProtocol | null {
    return this.resolveWithUpstreamHint(this.upstreamHint, ...evidence);
  }

  resolveWithUpstreamHint(upstreamHint: DetectedProtocol | null, ...evidence: Array<DetectedProtocol | null>): DetectedProtocol | null {
    if (this.resolution.mode === 'explicit') return this.resolution.resolved;
    return evidence.find((protocol): protocol is DetectedProtocol => protocol !== null) ?? upstreamHint;
  }
}
